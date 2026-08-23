import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./journal.js";
import { expectInteger, expectRecord, expectString } from "./json.js";

export interface WriterLease {
  readonly itemId: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly epoch: number;
  readonly attemptId: string;
  readonly expiresAt: string;
}

export async function readLease(runDirectory: string, itemId: string): Promise<WriterLease | undefined> {
  try {
    const object = expectRecord(JSON.parse(await readFile(join(runDirectory, "leases", `${itemId}.json`), "utf8")) as unknown, "lease");
    return {
      itemId: expectString(object.itemId, "lease.itemId"),
      branchName: expectString(object.branchName, "lease.branchName"),
      worktreePath: expectString(object.worktreePath, "lease.worktreePath"),
      epoch: expectInteger(object.epoch, "lease.epoch", 1),
      attemptId: expectString(object.attemptId, "lease.attemptId"),
      expiresAt: expectString(object.expiresAt, "lease.expiresAt"),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function acquireWriterLease(
  runDirectory: string,
  itemId: string,
  branchName: string,
  worktreePath: string,
  attemptId: string,
  timeoutMs: number,
): Promise<WriterLease> {
  const prior = await readLease(runDirectory, itemId);
  const lease: WriterLease = {
    itemId,
    branchName,
    worktreePath,
    epoch: (prior?.epoch ?? 0) + 1,
    attemptId,
    expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
  };
  await mkdir(join(runDirectory, "leases"), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(join(runDirectory, "leases", `${itemId}.json`), lease);
  return lease;
}

export function leaseIsCurrent(lease: WriterLease, attemptId: string, now = Date.now()): boolean {
  return lease.attemptId === attemptId && Date.parse(lease.expiresAt) > now;
}
