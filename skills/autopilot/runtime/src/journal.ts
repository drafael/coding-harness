import { randomUUID } from "node:crypto";
import { open, readFile, rename, truncate, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AutopilotError } from "./errors.js";
import { parseLifecycleEvent, type LifecycleEvent } from "./events.js";
import { canonicalJson, expectInteger, expectRecord, expectString, sha256 } from "./json.js";

export interface JournalRecord {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly previousHash: string | null;
  readonly event: LifecycleEvent;
  readonly recordHash: string;
}

export interface JournalReadResult {
  readonly records: readonly JournalRecord[];
  readonly truncatedTailBytes: number;
}

function hashRecord(record: Omit<JournalRecord, "recordHash">): string {
  return sha256(canonicalJson(record));
}

function parseRecord(value: unknown, expectedSequence: number, expectedPreviousHash: string | null): JournalRecord {
  const object = expectRecord(value, `journal record ${expectedSequence}`);
  if (object.schemaVersion !== 1) {
    throw new AutopilotError("JOURNAL_CORRUPT", `journal record ${expectedSequence} has an unsupported schema`);
  }
  const sequence = expectInteger(object.sequence, `journal record ${expectedSequence}.sequence`, 1);
  const previousHash = object.previousHash === null ? null : expectString(object.previousHash, `journal record ${expectedSequence}.previousHash`);
  let event: LifecycleEvent;
  try {
    event = parseLifecycleEvent(object.event);
  } catch (error) {
    throw new AutopilotError("JOURNAL_CORRUPT", `journal event is malformed at sequence ${expectedSequence}`, { cause: String(error) });
  }
  const recordHash = expectString(object.recordHash, `journal record ${expectedSequence}.recordHash`);
  if (sequence !== expectedSequence || previousHash !== expectedPreviousHash) {
    throw new AutopilotError("JOURNAL_CORRUPT", `journal chain mismatch at sequence ${expectedSequence}`);
  }
  const expectedHash = hashRecord({ schemaVersion: 1, sequence, previousHash, event });
  if (recordHash !== expectedHash) {
    throw new AutopilotError("JOURNAL_CORRUPT", `journal hash mismatch at sequence ${expectedSequence}`);
  }
  return { schemaVersion: 1, sequence, previousHash, event, recordHash };
}

export async function readJournal(path: string): Promise<JournalReadResult> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { records: [], truncatedTailBytes: 0 };
    }
    throw error;
  }
  if (content.length === 0) {
    return { records: [], truncatedTailBytes: 0 };
  }
  const lastNewline = content.lastIndexOf("\n");
  const complete = lastNewline < 0 ? "" : content.slice(0, lastNewline + 1);
  const truncatedTailBytes = Buffer.byteLength(content.slice(lastNewline + 1));
  const lines = complete.split("\n").filter((line) => line.length > 0);
  const records: JournalRecord[] = [];
  let previousHash: string | null = null;
  lines.forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new AutopilotError("JOURNAL_CORRUPT", `journal record ${index + 1} is not valid JSON`, { cause: String(error) });
    }
    const record = parseRecord(parsed, index + 1, previousHash);
    records.push(record);
    previousHash = record.recordHash;
  });
  return { records, truncatedTailBytes };
}

export async function repairTruncatedJournal(path: string): Promise<number> {
  const content = await readFile(path);
  const lastNewline = content.lastIndexOf(10);
  const validLength = lastNewline < 0 ? 0 : lastNewline + 1;
  const removed = content.length - validLength;
  if (removed > 0) {
    await truncate(path, validLength);
  }
  return removed;
}

export async function appendEvent(path: string, event: LifecycleEvent): Promise<JournalRecord> {
  const current = await readJournal(path);
  if (current.truncatedTailBytes > 0) {
    throw new AutopilotError("JOURNAL_TRUNCATED", "journal has an incomplete final record; repair it before appending", {
      truncatedTailBytes: current.truncatedTailBytes,
    });
  }
  const sequence = current.records.length + 1;
  const previousHash = current.records.at(-1)?.recordHash ?? null;
  const withoutHash = { schemaVersion: 1 as const, sequence, previousHash, event };
  const record: JournalRecord = { ...withoutHash, recordHash: hashRecord(withoutHash) };
  const file = await open(path, "a", 0o600);
  try {
    await file.write(`${JSON.stringify(record)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  return record;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporaryPath, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
