export type EventSource = "runtime" | "operator" | "reconciler";
interface EventBase {
    readonly eventId: string;
    readonly timestamp: string;
    readonly source: EventSource;
    readonly reason: string;
    readonly itemId?: string;
    readonly attemptId?: string;
    readonly evidence?: readonly string[];
}
export type LifecycleEvent = (EventBase & {
    readonly type: "CHARTER_COMPILED";
}) | (EventBase & {
    readonly type: "RECONCILIATION_STARTED";
}) | (EventBase & {
    readonly type: "RECONCILIATION_COMPLETED";
}) | (EventBase & {
    readonly type: "RUN_WAITING";
}) | (EventBase & {
    readonly type: "RUN_RESUMED";
}) | (EventBase & {
    readonly type: "RUN_VERIFYING";
}) | (EventBase & {
    readonly type: "RUN_SUCCEEDED";
    readonly predicateSummary: string;
}) | (EventBase & {
    readonly type: "RUN_STOPPED";
    readonly errorCode: string;
    readonly remediation: string;
}) | (EventBase & {
    readonly type: "WRAP_UP_STARTED";
    readonly chainRunIds: readonly string[];
    readonly handoff: boolean;
}) | (EventBase & {
    readonly type: "WORKTREE_ADOPTED";
    readonly itemId: string;
    readonly predecessorRunId: string;
    readonly predecessorItemId: string;
    readonly worktreePath: string;
    readonly branchName: string;
    readonly acceptedCommit: string;
    readonly changeRequestUrl: string;
}) | (EventBase & {
    readonly type: "ITEM_READY";
    readonly itemId: string;
}) | (EventBase & {
    readonly type: "ATTEMPT_STARTED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly leaseEpoch: number;
    readonly expectedBaseCommit: string;
    readonly expectedRefIdentity?: string;
    readonly expectedConfigurationIdentity?: string;
    readonly expectedHookIdentity?: string;
    readonly expectedHookPath?: string;
    readonly deadline: string;
    readonly idempotencyKey: string;
}) | (EventBase & {
    readonly type: "ATTEMPT_FINISHED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly observedHeadCommit: string;
    readonly outcome: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
}) | (EventBase & {
    readonly type: "ITEM_VERIFYING";
    readonly itemId: string;
    readonly attemptId: string;
}) | (EventBase & {
    readonly type: "ITEM_SATISFIED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly subject: string;
}) | (EventBase & {
    readonly type: "ITEM_BLOCKED";
    readonly itemId: string;
    readonly errorCode: string;
}) | (EventBase & {
    readonly type: "ITEM_ABANDONED";
    readonly itemId: string;
}) | (EventBase & {
    readonly type: "EFFECT_INTENDED";
    readonly effect: string;
    readonly idempotencyKey: string;
    readonly expectedState: string;
}) | (EventBase & {
    readonly type: "EFFECT_CONFIRMED";
    readonly effect: string;
    readonly idempotencyKey: string;
    readonly observedState: string;
}) | (EventBase & {
    readonly type: "RECEIPT_RECORDED";
    readonly receiptId: string;
    readonly status: "PASSED" | "FAILED" | "WAIVED" | "UNVERIFIED";
}) | (EventBase & {
    readonly type: "PRE_COMMIT_HOOK_FINISHED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly status: "PASSED" | "FAILED" | "NOT_CONFIGURED";
    readonly beforeTree: string;
    readonly afterTree: string;
    readonly exitCode: number;
}) | (EventBase & {
    readonly type: "DECISION_RECORDED";
    readonly decision: string;
    readonly basis: string;
});
export declare function newEventId(): string;
export declare function parseLifecycleEvent(value: unknown): LifecycleEvent;
export {};
