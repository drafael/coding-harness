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
            ...(object.retiredAt === undefined ? {} : { retiredAt: expectString(object.retiredAt, "lease.retiredAt") }),
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
export async function retireWriterLease(runDirectory, expected) {
    const current = await readLease(runDirectory, expected.itemId);
    if (current === undefined || current.attemptId !== expected.attemptId || current.epoch !== expected.epoch) {
        throw new Error(`writer lease identity changed before retirement for ${expected.itemId}`);
    }
    if (current.retiredAt !== undefined) {
        return current;
    }
    const retired = { ...current, retiredAt: new Date().toISOString() };
    await writeJsonAtomic(join(runDirectory, "leases", `${expected.itemId}.json`), retired);
    return retired;
}
export function leaseIsCurrent(lease, attemptId, now = Date.now()) {
    return lease.retiredAt === undefined && lease.attemptId === attemptId && Date.parse(lease.expiresAt) > now;
}
