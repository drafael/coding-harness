export function runnableFrontier(charter, projection, adapterConcurrency) {
    const maximum = Math.max(1, Math.min(charter.limits.maxParallel, adapterConcurrency));
    return charter.work
        .filter((item) => {
        const state = projection.items[item.id]?.state;
        const itemProjection = projection.items[item.id];
        const unknownRetryAvailable = itemProjection?.blocker !== "UNKNOWN_FAILURE" || itemProjection.attempts.length < 2;
        const replanAvailable = itemProjection?.blocker !== "PREDICATE_NOT_MET"
            || itemProjection.attempts.length <= charter.limits.maxReplans;
        const nonRetryable = itemProjection?.blocker === "CAPABILITY_DENIED"
            || itemProjection?.blocker === "BRANCH_COLLISION"
            || itemProjection?.blocker === "UNEXPECTED_COMMIT"
            || itemProjection?.blocker === "PRE_COMMIT_HOOK_FAILED"
            || itemProjection?.blocker === "POST_HOOK_PREDICATE_NOT_MET";
        return (state === "PENDING" || state === "READY" || state === "BLOCKED")
            && !nonRetryable
            && (itemProjection?.attempts.length ?? 0) < charter.limits.maxAttemptsPerItem
            && unknownRetryAvailable
            && replanAvailable
            && item.dependsOn.every((dependency) => projection.items[dependency]?.state === "SATISFIED");
    })
        .slice(0, charter.mode === "ordered-stack" ? 1 : maximum);
}
export function blockedByDependency(charter, projection) {
    return charter.work.filter((item) => projection.items[item.id]?.state === "PENDING"
        && item.dependsOn.some((dependency) => ["BLOCKED", "ABANDONED"].includes(projection.items[dependency]?.state ?? "PENDING")));
}
