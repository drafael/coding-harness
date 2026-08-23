import { readFile, rm } from "node:fs/promises";
import type { RunCharter } from "./charter.js";
import type { JournalRecord } from "./journal.js";
import { writeJsonAtomic } from "./journal.js";
import { expectInteger, expectRecord, expectString } from "./json.js";
import { initialProjection, reduce, type RunProjection } from "./reducer.js";

interface Snapshot {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly lastRecordHash: string | null;
  readonly projection: Omit<RunProjection, "appliedEventIds"> & { readonly appliedEventIds: readonly string[] };
}

export function rebuildProjection(charter: RunCharter, records: readonly JournalRecord[]): RunProjection {
  return records.reduce((projection, record) => reduce(projection, record.event), initialProjection(charter));
}

export async function writeSnapshot(path: string, projection: RunProjection, records: readonly JournalRecord[]): Promise<void> {
  const snapshot: Snapshot = {
    schemaVersion: 1,
    sequence: records.length,
    lastRecordHash: records.at(-1)?.recordHash ?? null,
    projection: { ...projection, appliedEventIds: [...projection.appliedEventIds] },
  };
  await writeJsonAtomic(path, snapshot);
}

export async function loadProjection(path: string, charter: RunCharter, records: readonly JournalRecord[]): Promise<RunProjection> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    const snapshot = expectRecord(raw, "snapshot");
    const projection = expectRecord(snapshot.projection, "snapshot.projection");
    const expectedHash = records.at(-1)?.recordHash ?? null;
    if (
      snapshot.schemaVersion !== 1
      || expectInteger(snapshot.sequence, "snapshot.sequence") !== records.length
      || snapshot.lastRecordHash !== expectedHash
      || expectString(projection.runId, "snapshot.projection.runId") !== charter.runId
      || expectString(projection.charterHash, "snapshot.projection.charterHash") !== charter.charterHash
    ) {
      throw new Error("snapshot identity mismatch");
    }
    const rebuilt = rebuildProjection(charter, records);
    await writeSnapshot(path, rebuilt, records);
    return rebuilt;
  } catch {
    await rm(path, { force: true });
    const rebuilt = rebuildProjection(charter, records);
    await writeSnapshot(path, rebuilt, records);
    return rebuilt;
  }
}
