export type EventSource = "runtime" | "operator" | "reconciler";
export type WaitingDetails = {
    readonly kind: "operator-pause";
    readonly requestId: string;
} | {
    readonly kind: "execution-unknown";
    readonly itemId: string;
    readonly attemptId: string;
} | {
    readonly kind: "provider-checks";
    readonly provider: "github" | "gitlab";
    readonly itemId: string;
    readonly changeRequestId: string;
    readonly changeRequestUrl: string;
    readonly subjectCommit: string;
    readonly baseBranch: string;
    readonly heartbeatMs: number;
    readonly deadline: string;
};
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
    readonly type: "RUN_PAUSE_REQUESTED";
    readonly requestId: string;
}) | (EventBase & {
    readonly type: "RUN_WAITING";
    readonly waiting?: WaitingDetails;
}) | (EventBase & {
    readonly type: "RUN_WOKEN";
    readonly observationId: string;
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
    readonly expectedTreeIdentity?: string;
    readonly expectedRefIdentity?: string;
    readonly expectedExternalRefIdentity?: string;
    readonly expectedConfigurationIdentity?: string;
    readonly expectedHookIdentity?: string;
    readonly expectedHookPath?: string;
    readonly contextHash?: string;
    readonly contextJournalSequence?: number;
    readonly executionSupervised?: boolean;
    readonly deadline: string;
    readonly idempotencyKey: string;
}) | (EventBase & {
    readonly type: "ATTEMPT_FINISHED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly observedHeadCommit: string;
    readonly observedTreeIdentity?: string;
    readonly outcome: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
}) | (EventBase & {
    readonly type: "ITEM_VERIFYING";
    readonly itemId: string;
    readonly attemptId: string;
}) | (EventBase & {
    readonly type: "ATTEMPT_PAUSED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly budgetConsumed?: boolean;
}) | (EventBase & {
    readonly type: "ITEM_VERIFIED";
    readonly itemId: string;
    readonly attemptId: string;
    readonly subject: string;
    readonly headCommit: string;
    readonly treeIdentity: string;
    readonly auxiliaryRefIdentity: string;
    readonly externalRefIdentity?: string;
    readonly configurationIdentity: string;
    readonly hookIdentity?: string;
    readonly hookPath?: string;
    readonly commitRequired: boolean;
    readonly receiptIds: readonly string[];
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
    readonly type: "RESTACK_DESCENDANT_STARTED";
    readonly itemId: string;
    readonly oldCommit: string;
    readonly freshParentCommit: string;
}) | (EventBase & {
    readonly type: "RESTACK_DESCENDANT_TREE_PREPARED";
    readonly itemId: string;
    readonly candidateCommit: string;
    readonly treeIdentity: string;
    readonly messageIdentity: string;
    readonly oldCommit: string;
    readonly freshParentCommit: string;
    readonly temporaryWorktreePath: string;
}) | (EventBase & {
    readonly type: "RESTACK_DESCENDANT_VERIFIED";
    readonly itemId: string;
    readonly subject: string;
    readonly receiptIds: readonly string[];
}) | (EventBase & {
    readonly type: "RESTACK_PROVIDER_HEAD_CONFIRMED";
    readonly itemId: string;
    readonly provider: "github" | "gitlab";
    readonly changeRequestId: string;
    readonly changeRequestUrl: string;
    readonly headCommit: string;
    readonly baseBranch: string;
    readonly state: "open";
}) | (EventBase & {
    readonly type: "RESTACK_DESCENDANT_SATISFIED";
    readonly itemId: string;
    readonly subject: string;
}) | (EventBase & {
    readonly type: "RESTACK_DESCENDANT_BLOCKED";
    readonly itemId: string;
    readonly errorCode: string;
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
    readonly repositoryAuxiliaryRefIdentity?: string;
    readonly repositoryExternalRefIdentity?: string;
}) | (EventBase & {
    readonly type: "RECEIPT_RECORDED";
    readonly receiptId: string;
    readonly gateId?: string;
    readonly receiptKind?: "gate" | "predicate" | "review" | "remote-checks";
    readonly subject?: string;
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
