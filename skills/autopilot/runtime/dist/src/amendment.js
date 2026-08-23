import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseSealedCharter } from "./charter.js";
import { AutopilotError } from "./errors.js";
import { readJournal } from "./journal.js";
import { canonicalJson } from "./json.js";
import { rebuildProjection } from "./projection.js";
import { assertRegisteredWorktree, currentBranch, inspectCommit, inspectRepository, resolveCommit, resolveWorktreePath, } from "./repository.js";
import { runDirectory } from "./state-path.js";
function confirmedState(records, itemId, effect) {
    return records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === effect ? [event.observedState] : []).at(-1);
}
function pendingCommitIntent(records, itemId) {
    const confirmed = new Set(records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === "git.commit" ? [event.idempotencyKey] : []));
    return records.flatMap(({ event }) => event.type === "EFFECT_INTENDED" && event.itemId === itemId && event.effect === "git.commit"
        && !confirmed.has(event.idempotencyKey)
        && event.attemptId !== undefined
        ? [{ idempotencyKey: event.idempotencyKey, expectedTree: event.expectedState, attemptId: event.attemptId }]
        : []).at(-1);
}
function changeRequestRef(provider, url) {
    const id = url.replace(/\/+$/u, "").split("/").at(-1);
    if (id === undefined || id.length === 0) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "predecessor change-request evidence has no provider identifier");
    }
    return { provider, id, url };
}
export async function loadAmendmentContext(stateRoot, charter, currentRecords = []) {
    const amendment = charter.amends;
    if (amendment === undefined) {
        return undefined;
    }
    const predecessorDirectory = runDirectory(stateRoot, amendment.runId);
    let predecessorCharter;
    try {
        predecessorCharter = parseSealedCharter(JSON.parse(await readFile(join(predecessorDirectory, "charter.json"), "utf8")));
    }
    catch (error) {
        throw new AutopilotError("CHARTER_INVALID", `could not load sealed predecessor run ${amendment.runId}`, { cause: String(error) });
    }
    const predecessorItem = predecessorCharter.work.find(({ id }) => id === amendment.itemId);
    if (predecessorItem === undefined) {
        throw new AutopilotError("CHARTER_INVALID", `predecessor run has no item ${amendment.itemId}`);
    }
    const journal = await readJournal(join(predecessorDirectory, "events.jsonl"));
    const projection = rebuildProjection(predecessorCharter, journal.records);
    if (projection.state !== "SUCCEEDED" || projection.items[amendment.itemId]?.state !== "SATISFIED") {
        throw new AutopilotError("ILLEGAL_TRANSITION", "only a satisfied item from a successful run can be amended");
    }
    const successorItem = charter.work[0];
    if (successorItem === undefined || successorItem.branchName !== predecessorItem.branchName) {
        throw new AutopilotError("CHARTER_INVALID", "an amendment must preserve the predecessor branch");
    }
    if (charter.repository.root !== predecessorCharter.repository.root
        || canonicalJson(charter.deliveryTarget) !== canonicalJson(predecessorCharter.deliveryTarget)) {
        throw new AutopilotError("CHARTER_INVALID", "an amendment must preserve repository and delivery identity");
    }
    const acceptedCommit = confirmedState(journal.records, amendment.itemId, "remote.push");
    const changeRequestUrl = confirmedState(journal.records, amendment.itemId, "change-request.open")
        ?? confirmedState(journal.records, amendment.itemId, "change-request.update");
    const target = predecessorCharter.deliveryTarget;
    if (acceptedCommit === undefined || changeRequestUrl === undefined || target === undefined) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "predecessor has no confirmed remote branch and change request");
    }
    if (charter.repository.baseCommit !== acceptedCommit) {
        throw new AutopilotError("CHARTER_INVALID", "amendment baseCommit must equal the predecessor's confirmed remote commit");
    }
    const adoptedPath = journal.records.flatMap(({ event }) => event.type === "WORKTREE_ADOPTED" && event.itemId === amendment.itemId ? [event.worktreePath] : []).at(-1);
    const worktreePath = adoptedPath ?? await resolveWorktreePath(predecessorCharter, predecessorItem);
    const canonicalWorktree = await realpath(worktreePath);
    if (canonicalWorktree !== worktreePath) {
        throw new AutopilotError("CAPABILITY_DENIED", "predecessor worktree path is not the canonical managed sibling");
    }
    await assertRegisteredWorktree(charter.repository.root, worktreePath);
    const repository = await inspectRepository(worktreePath);
    const branch = await currentBranch(worktreePath);
    const branchCommit = await resolveCommit(charter.repository.root, successorItem.branchName);
    const adopted = currentRecords.some(({ event }) => event.type === "WORKTREE_ADOPTED");
    let currentCommit = confirmedState(currentRecords, amendment.itemId, "git.commit");
    let reconciledCommit;
    const pendingIntent = pendingCommitIntent(currentRecords, amendment.itemId);
    const expectedParent = currentCommit ?? acceptedCommit;
    if (adopted && currentCommit !== repository.headCommit && pendingIntent !== undefined && repository.clean) {
        const commit = await inspectCommit(worktreePath, repository.headCommit);
        const ownedMessage = commit.message.includes(`Autopilot-Run: ${charter.runId}`)
            && commit.message.includes(`Autopilot-Item: ${amendment.itemId}`);
        if (commit.parents.length === 1 && commit.parents[0] === expectedParent
            && commit.treeIdentity === pendingIntent.expectedTree && ownedMessage) {
            currentCommit = repository.headCommit;
            reconciledCommit = {
                idempotencyKey: pendingIntent.idempotencyKey,
                commit: repository.headCommit,
                treeIdentity: pendingIntent.expectedTree,
                attemptId: pendingIntent.attemptId,
            };
        }
    }
    const expectedHead = currentCommit ?? acceptedCommit;
    if ((!adopted && !repository.clean) || repository.headCommit !== expectedHead || branchCommit !== expectedHead || branch !== successorItem.branchName) {
        throw new AutopilotError("BRANCH_COLLISION", "predecessor worktree, branch, or accepted commit changed after completion", {
            expectedCommit: expectedHead,
            observedHead: repository.headCommit,
            observedBranchCommit: branchCommit,
            clean: repository.clean,
        });
    }
    return {
        predecessorCharter,
        predecessorItem,
        worktreePath,
        acceptedCommit,
        deliveryBaseCommit: confirmedState(currentRecords, amendment.itemId, "remote.push") ?? acceptedCommit,
        changeRequest: changeRequestRef(target.provider, changeRequestUrl),
        ...(reconciledCommit === undefined ? {} : { reconciledCommit }),
    };
}
