import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./journal.js";
import { expectInteger, expectRecord, expectString } from "./json.js";
export async function readLease(runDirectory, itemId) {
    try {
        const object = expectRecord(JSON.parse(await readFile(join(runDirectory, "leases", `${itemId}.json`), "utf8")), "lease");
        return {
            itemId: expectString(object.itemId, "lease.itemId"),
            branchName: expectString(object.branchName, "lease.branchName"),
            worktreePath: expectString(object.worktreePath, "lease.worktreePath"),
            epoch: expectInteger(object.epoch, "lease.epoch", 1),
            attemptId: expectString(object.attemptId, "lease.attemptId"),
            expiresAt: expectString(object.expiresAt, "lease.expiresAt"),
        };
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
export async function acquireWriterLease(runDirectory, itemId, branchName, worktreePath, attemptId, timeoutMs) {
    const prior = await readLease(runDirectory, itemId);
    const lease = {
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
export function leaseIsCurrent(lease, attemptId, now = Date.now()) {
    return lease.attemptId === attemptId && Date.parse(lease.expiresAt) > now;
}
