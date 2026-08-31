import type { ExecutionAssurance } from "./adapter-protocol.js";
import type { RunCharter } from "./charter.js";
import type { LifecycleEvent, WaitingDetails } from "./events.js";
export type RunState = "COMPILED" | "RECONCILING" | "RUNNING" | "WAITING" | "VERIFYING" | "SUCCEEDED" | "STOPPED";
export type ItemState = "PENDING" | "READY" | "ACTIVE" | "VERIFYING" | "SATISFIED" | "BLOCKED" | "ABANDONED";
export type RestackState = "PENDING" | "PREPARING" | "VERIFYING" | "VERIFIED" | "COMMITTING" | "PUSHING" | "SATISFIED" | "BLOCKED";
export interface AttemptProjection {
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
    readonly executionAssurance?: ExecutionAssurance;
    readonly execution?: {
        readonly adapterName: string;
        readonly adapterVersion: string;
        readonly harnessVersion: string;
        readonly adapterExecutionId: string;
        readonly backendId: string;
        readonly subjectId: string;
        readonly harnessInstanceId?: string;
    };
    readonly deadline: string;
    readonly idempotencyKey: string;
    readonly outcome?: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
    readonly observedHeadCommit?: string;
    readonly observedTreeIdentity?: string;
    readonly budgetConsumed?: boolean;
    readonly quarantinedWorktreePath?: string;
    readonly adoptedTree?: {
        readonly worktreePath: string;
        readonly headCommit: string;
        readonly treeIdentity: string;
        readonly refIdentity: string;
        readonly auxiliaryRefIdentity: string;
        readonly externalRefIdentity: string;
        readonly configurationIdentity: string;
        readonly changedPaths: readonly string[];
    };
}
export interface VerifiedCheckpoint {
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
}
export interface ItemProjection {
    readonly itemId: string;
    readonly state: ItemState;
    readonly attempts: readonly AttemptProjection[];
    readonly replansUsed: number;
    readonly verified?: VerifiedCheckpoint;
    readonly subject?: string;
    readonly blocker?: string;
}
export interface RestackProjection {
    readonly itemId: string;
    readonly state: RestackState;
    readonly oldCommit?: string;
    readonly freshParentCommit?: string;
    readonly candidateCommit?: string;
    readonly treeIdentity?: string;
    readonly messageIdentity?: string;
    readonly temporaryWorktreePath?: string;
    readonly subject?: string;
    readonly receiptIds: readonly string[];
    readonly requiredGateIds: readonly string[];
    readonly requiredReviewGateIds: readonly string[];
    readonly sealedWaiverGateIds: readonly string[];
    readonly passingGateIds: readonly string[];
    readonly predicateReceiptPassed: boolean;
    readonly expectedProvider: "github" | "gitlab";
    readonly expectedChangeRequestId: string;
    readonly expectedChangeRequestUrl: string;
    readonly expectedBaseBranch: string;
    readonly localRefConfirmed?: boolean;
    readonly remotePushConfirmed?: boolean;
    readonly providerHeadConfirmed?: boolean;
    readonly blocker?: string;
}
export interface RunProjection {
    readonly runId: string;
    readonly charterHash: string;
    readonly state: RunState;
    readonly items: Readonly<Record<string, ItemProjection>>;
    readonly restacks: Readonly<Record<string, RestackProjection>>;
    readonly appliedEventIds: ReadonlySet<string>;
    readonly lastReason: string;
    readonly pauseRequestId?: string;
    readonly waiting?: WaitingDetails | {
        readonly kind: "legacy";
    };
    readonly stop?: {
        readonly errorCode: string;
        readonly remediation: string;
    };
}
export declare function initialProjection(charter: RunCharter): RunProjection;
export declare function reduce(projection: RunProjection, event: LifecycleEvent): RunProjection;
export declare function consumedAttempts(item: ItemProjection | undefined): number;
