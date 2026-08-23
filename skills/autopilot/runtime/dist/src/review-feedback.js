import { realpath } from "node:fs/promises";
import { createDeliveryAdapter } from "./delivery-adapters.js";
import { reviewThreadDigest } from "./delivery.js";
import { AutopilotError } from "./errors.js";
import { runChecked } from "./process.js";
import { loadAvailableRuns } from "./run-discovery.js";
function confirmedState(records, itemId, effect) {
    return records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === effect ? [event.observedState] : []).at(-1);
}
function changeRequestRef(charter, records, itemId) {
    const target = charter.deliveryTarget;
    const url = confirmedState(records, itemId, "change-request.open")
        ?? confirmedState(records, itemId, "change-request.update");
    const id = url?.replace(/\/+$/u, "").split("/").at(-1);
    if (target === undefined || url === undefined || id === undefined || id.length === 0) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "run has no confirmed change-request identity");
    }
    return { provider: target.provider, id, url };
}
function shortIds(runIds) {
    return new Map(runIds.map((runId) => {
        let length = Math.min(8, runId.length);
        while (length < runId.length && runIds.some((candidate) => candidate !== runId && candidate.startsWith(runId.slice(0, length)))) {
            length += 1;
        }
        return [runId, runId.slice(0, length)];
    }));
}
function previouslyAddressedNonResolvable(run, runs) {
    const byId = new Map(runs.map((candidateRun) => [candidateRun.charter.runId, candidateRun]));
    const addressed = new Set();
    let current = run;
    while (current !== undefined) {
        current.charter.reviewFeedback?.threads.filter(({ resolve }) => !resolve).forEach(({ threadId, contentHash }) => {
            addressed.add(`${threadId}:${contentHash}`);
        });
        const predecessorId = current.charter.amends?.runId;
        current = predecessorId === undefined ? undefined : byId.get(predecessorId);
    }
    return addressed;
}
function candidate(run, shortId) {
    return {
        runId: run.charter.runId,
        shortId,
        title: run.charter.work[0]?.title ?? run.charter.runId,
        updatedAt: run.records.at(-1)?.event.timestamp ?? run.charter.createdAt,
    };
}
export async function observeReviewFeedback(stateRoot, repositoryRoot, selector) {
    const topLevel = (await runChecked({ executable: "git", arguments: ["rev-parse", "--show-toplevel"], cwd: repositoryRoot })).stdout.trim();
    const canonicalRepository = await realpath(topLevel);
    const available = await loadAvailableRuns(stateRoot);
    const runs = available.runs.filter(({ charter, projection }) => charter.repository.root === canonicalRepository
        && !available.supersededRunIds.has(charter.runId)
        && projection.state === "SUCCEEDED"
        && charter.delivery === "change-request-ready"
        && charter.deliveryTarget !== undefined
        && charter.work.length === 1);
    const selected = selector === undefined
        ? runs
        : runs.filter(({ charter }) => charter.runId === selector || charter.runId.startsWith(selector));
    const ids = shortIds(runs.map(({ charter }) => charter.runId));
    const candidates = selected.map((run) => candidate(run, ids.get(run.charter.runId) ?? run.charter.runId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId));
    if (available.corrupt.length > 0 || selected.length !== 1) {
        return { kind: "review-feedback-selection", candidates, corrupt: available.corrupt };
    }
    const run = selected[0];
    if (run === undefined) {
        return { kind: "review-feedback-selection", candidates, corrupt: available.corrupt };
    }
    const item = run.charter.work[0];
    const target = run.charter.deliveryTarget;
    if (item === undefined || target === undefined) {
        throw new AutopilotError("CHARTER_INVALID", "review feedback requires one provider-delivered item");
    }
    const acceptedCommit = confirmedState(run.records, item.id, "remote.push");
    if (acceptedCommit === undefined) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "run has no confirmed remote commit");
    }
    const reference = changeRequestRef(run.charter, run.records, item.id);
    const delivery = createDeliveryAdapter(target.provider);
    await delivery.describe();
    const observed = await delivery.observeChangeRequest(canonicalRepository, reference);
    if (observed.ref.url !== reference.url || observed.state !== "open" || observed.headCommit !== acceptedCommit
        || observed.baseBranch !== target.baseBranch) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "change request is not open at the successful Autopilot head");
    }
    const addressed = previouslyAddressedNonResolvable(run, available.runs);
    const threads = (await delivery.observeReviewThreads(canonicalRepository, reference))
        .filter(({ resolved }) => !resolved)
        .map((thread) => ({ ...thread, contentHash: reviewThreadDigest(thread) }))
        .filter(({ id, contentHash, resolvable }) => resolvable || !addressed.has(`${id}:${contentHash}`));
    return {
        kind: "review-feedback",
        runId: run.charter.runId,
        itemId: item.id,
        provider: target.provider,
        changeRequest: reference,
        observedHeadCommit: observed.headCommit,
        threads,
    };
}
