import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { newEventId } from "./events.js";
import { appendEvent, readJournal } from "./journal.js";
import { canonicalJson, sha256 } from "./json.js";
import { readLease, retireWriterLease } from "./leases.js";
import { writeSnapshot } from "./projection.js";
import { reduce } from "./reducer.js";
import { assertWritablePaths, observeRepository, quarantineWorktree } from "./repository.js";
export async function recoverUnknownExecution(runDirectory, charter, projection, lock, request) {
    if (request.attestation.trim().length === 0 || Buffer.byteLength(request.attestation) > 4_096) {
        throw new AutopilotError("CHARTER_INVALID", "unknown-execution recovery requires a bounded explicit operator attestation");
    }
    const item = charter.work.find(({ id }) => id === request.itemId);
    const projectedItem = projection.items[request.itemId];
    const attempt = projectedItem?.attempts.at(-1);
    if (item === undefined || projection.waiting?.kind !== "execution-unknown"
        || projection.waiting.itemId !== request.itemId || projection.waiting.attemptId !== request.attemptId
        || projectedItem?.state !== "BLOCKED" || projectedItem.blocker !== "EXECUTION_STATE_UNKNOWN"
        || attempt?.attemptId !== request.attemptId || attempt.leaseEpoch !== request.leaseEpoch) {
        throw new AutopilotError("ILLEGAL_TRANSITION", "recovery identity does not match the current unknown execution");
    }
    const lease = await readLease(runDirectory, request.itemId);
    if (lease === undefined || lease.itemId !== request.itemId || lease.attemptId !== request.attemptId
        || lease.epoch !== request.leaseEpoch) {
        throw new AutopilotError("ILLEGAL_TRANSITION", "recovery lease fence does not match the unknown execution");
    }
    await lock.assertOwned();
    const base = {
        eventId: newEventId(),
        timestamp: new Date().toISOString(),
        source: "operator",
        itemId: request.itemId,
        attemptId: request.attemptId,
        lockTokenHash: sha256(lock.owner.token),
        attestation: request.attestation.trim(),
    };
    let event;
    if (request.action === "stop") {
        event = {
            ...base,
            type: "RUN_STOPPED",
            reason: "Operator stopped a run with unknown execution state",
            errorCode: "OPERATOR_STOP",
            leaseEpoch: request.leaseEpoch,
            remediation: "The quarantined execution evidence remains available for manual inspection.",
        };
    }
    else if (request.action === "adopt") {
        const observation = await observeRepository(lease.worktreePath);
        if (request.expectedTreeIdentity === undefined || request.expectedTreeIdentity !== observation.treeIdentity) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "adopted tree does not match --tree");
        }
        await assertWritablePaths(lease.worktreePath, observation.changedPaths, item.writableRoots);
        await retireWriterLease(runDirectory, lease);
        event = {
            ...base,
            type: "EXECUTION_UNKNOWN_TREE_ADOPTED",
            reason: "Operator sealed the exact unknown worktree for verification without another implementation worker",
            leaseEpoch: request.leaseEpoch,
            worktreePath: lease.worktreePath,
            headCommit: observation.headCommit,
            treeIdentity: observation.treeIdentity,
            refIdentity: observation.refIdentity,
            auxiliaryRefIdentity: observation.auxiliaryRefIdentity,
            externalRefIdentity: observation.externalRefIdentity,
            configurationIdentity: observation.configurationIdentity,
            changedPaths: observation.changedPaths,
        };
    }
    else {
        let before;
        try {
            await lstat(lease.worktreePath);
            before = await observeRepository(lease.worktreePath);
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
        const quarantined = await quarantineWorktree(charter.repository.root, lease.worktreePath, charter.runId, item.id, request.attemptId);
        if (before !== undefined && (before.headCommit !== quarantined.observation.headCommit
            || before.treeIdentity !== quarantined.observation.treeIdentity
            || before.refIdentity !== quarantined.observation.refIdentity
            || before.configurationIdentity !== quarantined.observation.configurationIdentity
            || canonicalJson(before.changedPaths) !== canonicalJson(quarantined.observation.changedPaths))) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "worktree changed while it was being quarantined");
        }
        await retireWriterLease(runDirectory, lease);
        event = {
            ...base,
            type: "EXECUTION_UNKNOWN_ABANDONED",
            reason: "Operator abandoned the unknown execution and permanently quarantined its worktree",
            leaseEpoch: request.leaseEpoch,
            originalWorktreePath: lease.worktreePath,
            quarantineWorktreePath: quarantined.path,
            headCommit: quarantined.observation.headCommit,
            treeIdentity: quarantined.observation.treeIdentity,
            refIdentity: quarantined.observation.refIdentity,
            auxiliaryRefIdentity: quarantined.observation.auxiliaryRefIdentity,
            externalRefIdentity: quarantined.observation.externalRefIdentity,
            configurationIdentity: quarantined.observation.configurationIdentity,
            changedPaths: quarantined.observation.changedPaths,
        };
    }
    await lock.assertOwned();
    const next = reduce(projection, event);
    await appendEvent(join(runDirectory, "events.jsonl"), event);
    const journal = await readJournal(join(runDirectory, "events.jsonl"));
    await writeSnapshot(join(runDirectory, "snapshot.json"), next, journal.records);
    return next;
}
