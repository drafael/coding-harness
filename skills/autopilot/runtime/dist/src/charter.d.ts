export declare const GRANT_FAMILIES: readonly ["files.read", "files.write", "process.execute", "network.access", "credentials.use", "git.commit", "remote.push", "change-request.observe", "change-request.open", "change-request.update", "review-thread.resolve", "merge.execute"];
export type GrantFamily = (typeof GRANT_FAMILIES)[number];
export type EffectActor = "worker" | "runtime" | "adapter" | "delivery";
export type RunMode = "single" | "independent-queue" | "ordered-stack";
export type DeliveryMode = "local-commits" | "change-request-ready" | "merge-verified";
export type AssuranceLevel = "cooperative" | "enforced";
export type ResolutionSource = "invocation" | "project" | "user" | "default" | "repository";
export interface CapabilityGrant {
    readonly family: GrantFamily;
    readonly actor: EffectActor;
    readonly paths?: readonly string[];
    readonly commands?: readonly string[];
    readonly repositories?: readonly string[];
    readonly remotes?: readonly string[];
    readonly branchPrefixes?: readonly string[];
    readonly environmentNames?: readonly string[];
}
export interface CommandGate {
    readonly id: string;
    readonly type: "command";
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly workingDirectory: string;
    readonly environmentNames: readonly string[];
    readonly appliesTo: readonly string[];
}
export interface SearchGate {
    readonly id: string;
    readonly type: "search";
    readonly query: string;
    readonly paths: readonly string[];
    readonly expectedCount: number;
    readonly appliesTo: readonly string[];
}
export interface ReviewGate {
    readonly id: string;
    readonly type: "review";
    readonly focus: string;
    readonly appliesTo: readonly string[];
}
export type VerificationGate = CommandGate | SearchGate | ReviewGate;
export type Predicate = {
    readonly type: "gate-passed";
    readonly gateId: string;
} | {
    readonly type: "path-present";
    readonly path: string;
} | {
    readonly type: "path-absent";
    readonly path: string;
} | {
    readonly type: "search-count";
    readonly query: string;
    readonly paths: readonly string[];
    readonly expectedCount: number;
};
export interface EvidenceWaiver {
    readonly gateId: string;
    readonly failurePattern: string;
    readonly alternativeGateIds: readonly string[];
    readonly reason: string;
}
export interface RunLimits {
    readonly maxAttemptsPerItem: number;
    readonly maxReplans: number;
    readonly maxParallel: number;
    readonly attemptTimeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly maxAdapterLineBytes: number;
    readonly maxRetainedOutputBytes: number;
}
export interface RecordedAssumption {
    readonly statement: string;
    readonly source: string;
}
export interface RepositorySpec {
    readonly root: string;
    readonly baseRef: string;
    readonly baseCommit: string;
    readonly writableRoots: readonly string[];
}
export interface DeliveryTarget {
    readonly provider: "github" | "gitlab";
    readonly remote: string;
    readonly baseBranch: string;
}
export interface ProviderCheckWaitPolicy {
    readonly heartbeatMs: number;
    readonly timeoutMs: number;
}
export interface AmendmentReference {
    readonly runId: string;
    readonly itemId: string;
}
export interface RestackChangeRequestSnapshot {
    readonly provider: "github" | "gitlab";
    readonly id: string;
    readonly url: string;
    readonly baseBranch: string;
}
export interface RestackDescendantSnapshot {
    readonly itemId: string;
    readonly oldCommit: string;
    readonly oldTreeIdentity: string;
    readonly remote: string;
    readonly remoteCommit: string;
    readonly changeRequest: RestackChangeRequestSnapshot;
    readonly worktreePath: string;
    readonly gateIds: readonly string[];
}
export interface RestackSuccessor {
    readonly schemaVersion: 1;
    readonly predecessorRunId: string;
    readonly predecessorCharterHash: string;
    readonly amendedItemId: string;
    readonly amendedCommit: string;
    readonly descendants: readonly RestackDescendantSnapshot[];
}
export interface ReviewFeedbackThread {
    readonly threadId: string;
    readonly contentHash: string;
    readonly url: string;
    readonly resolve: boolean;
}
export interface ReviewFeedbackSnapshot {
    readonly observedHeadCommit: string;
    readonly threads: readonly ReviewFeedbackThread[];
}
export interface CommitPolicy {
    readonly preCommitHook: "run" | "skip";
    readonly writableRoots: readonly string[];
    readonly environmentNames: readonly string[];
}
export interface WorkItem {
    readonly id: string;
    readonly title?: string;
    readonly objective: string;
    readonly writableRoots: readonly string[];
    readonly dependsOn: readonly string[];
    readonly acceptance: readonly Predicate[];
    readonly branchName: string;
    readonly ticket?: string;
}
export interface ProposedRunCharter {
    readonly schemaVersion: 1;
    readonly runId: string;
    readonly sourceText: string;
    readonly createdAt: string;
    readonly repository: RepositorySpec;
    readonly harnessAdapter: "pi" | "claude-code" | "codex" | "opencode";
    readonly mode: RunMode;
    readonly work: readonly WorkItem[];
    readonly delivery: DeliveryMode;
    readonly deliveryTarget?: DeliveryTarget;
    readonly providerCheckWait?: ProviderCheckWaitPolicy;
    readonly grants: readonly CapabilityGrant[];
    readonly gates: readonly VerificationGate[];
    readonly waivers: readonly EvidenceWaiver[];
    readonly limits: RunLimits;
    readonly assumptions: readonly RecordedAssumption[];
    readonly minimumAssurance: AssuranceLevel;
    readonly resolutionSources: Readonly<Record<string, ResolutionSource>>;
    readonly predecessorRunId?: string;
    readonly amends?: AmendmentReference;
    readonly restack?: RestackSuccessor;
    readonly reviewFeedback?: ReviewFeedbackSnapshot;
    readonly commitPolicy?: CommitPolicy;
}
export interface RunCharter extends ProposedRunCharter {
    readonly charterHash: string;
}
export declare function restackGrantsAreValid(charter: ProposedRunCharter): boolean;
export declare function parseProposedCharter(value: unknown): ProposedRunCharter;
export declare function sealCharter(value: unknown): RunCharter;
export declare function parseSealedCharter(value: unknown): RunCharter;
export declare function defaultRunLimits(): RunLimits;
