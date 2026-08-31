import type { RunCharter, WorkItem } from "./charter.js";
import { consumedAttempts, type RunProjection } from "./reducer.js";

export function runnableFrontier(charter: RunCharter, projection: RunProjection, adapterConcurrency: number): readonly WorkItem[] {
  const maximum = Math.max(1, Math.min(charter.limits.maxParallel, adapterConcurrency));
  return charter.work
    .filter((item) => {
      const state = projection.items[item.id]?.state;
      const itemProjection = projection.items[item.id];
      const attemptsUsed = consumedAttempts(itemProjection);
      const unknownRetryAvailable = itemProjection?.blocker !== "UNKNOWN_FAILURE" || attemptsUsed < 2;
      const replanAvailable = itemProjection?.blocker !== "PREDICATE_NOT_MET"
        || itemProjection.replansUsed < charter.limits.maxReplans;
      const nonRetryable = itemProjection?.attempts.at(-1)?.adoptedTree !== undefined
        || itemProjection?.blocker === "CAPABILITY_DENIED"
        || itemProjection?.blocker === "BRANCH_COLLISION"
        || itemProjection?.blocker === "UNEXPECTED_COMMIT"
        || itemProjection?.blocker === "PRE_COMMIT_HOOK_FAILED"
        || itemProjection?.blocker === "POST_HOOK_PREDICATE_NOT_MET"
        || itemProjection?.blocker === "EXECUTION_STATE_UNKNOWN"
        || itemProjection?.blocker === "EFFECT_RECONCILIATION_FAILED"
        || itemProjection?.blocker === "RECEIPT_STALE";
      return (state === "PENDING" || state === "READY" || state === "BLOCKED")
        && !nonRetryable
        && attemptsUsed < charter.limits.maxAttemptsPerItem
        && unknownRetryAvailable
        && replanAvailable
        && item.dependsOn.every((dependency) => projection.items[dependency]?.state === "SATISFIED");
    })
    .slice(0, charter.mode === "ordered-stack" ? 1 : maximum);
}

export function blockedByDependency(charter: RunCharter, projection: RunProjection): readonly WorkItem[] {
  return charter.work.filter((item) =>
    projection.items[item.id]?.state === "PENDING"
    && item.dependsOn.some((dependency) => ["BLOCKED", "ABANDONED"].includes(projection.items[dependency]?.state ?? "PENDING")),
  );
}
