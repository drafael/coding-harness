import { type AssuranceLevel, type CapabilityGrant, type GrantFamily, type Predicate, type VerificationGate } from "./charter.js";
export interface CapabilityManifest {
    readonly protocolVersion: 1;
    readonly adapterName: string;
    readonly adapterVersion: string;
    readonly harnessVersion: string;
    readonly families: readonly GrantFamily[];
    readonly assurance: AssuranceLevel;
    readonly unattended: boolean;
    readonly maxConcurrency: number;
    readonly eventStreaming: boolean;
    readonly cancellation: boolean;
    readonly restartReattachment: boolean;
    readonly restrictions: "enforced" | "cooperative";
    readonly limitations: readonly string[];
}
export interface AttemptContextEvidence {
    readonly predicateId: string;
    readonly outcome: "met" | "not-met" | "blocked";
    readonly subject: string;
    readonly reason: string;
    readonly receiptIds: readonly string[];
    readonly observed: string | number | boolean | null;
    readonly expected: string | number | boolean;
}
export interface AttemptContextFailure {
    readonly attemptId?: string;
    readonly errorCode: string;
    readonly reason: string;
}
export interface AttemptContext {
    readonly schemaVersion: 1;
    readonly charterHash: string;
    readonly sourceJournalSequence: number;
    readonly sourceJournalRecordHash: string | null;
    readonly runId: string;
    readonly itemId: string;
    readonly attemptId: string;
    readonly leaseEpoch: number;
    readonly expectedBaseCommit: string;
    readonly currentTreeIdentity: string;
    readonly title?: string;
    readonly objective: string;
    readonly predicates: readonly Predicate[];
    readonly gates: readonly VerificationGate[];
    readonly dependencyCommits: readonly {
        readonly itemId: string;
        readonly commit: string;
    }[];
    readonly evidence: readonly AttemptContextEvidence[];
    readonly priorFailures: readonly AttemptContextFailure[];
    readonly reviewFindings: readonly {
        readonly gateId: string;
        readonly path?: string;
        readonly line?: number;
        readonly message: string;
    }[];
    readonly remainingAttempts: number;
    readonly remainingReplans: number;
    readonly attemptTimeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly assumptions: readonly {
        readonly statement: string;
        readonly source: string;
    }[];
    readonly writableRoots: readonly string[];
    readonly grants: readonly CapabilityGrant[];
    readonly forbiddenEffects: readonly string[];
    readonly requiredResult: readonly string[];
}
export interface ReviewFinding {
    readonly path?: string;
    readonly line?: number;
    readonly severity?: string;
    readonly message: string;
}
export interface ReviewResult {
    readonly verdict: "clean" | "findings" | "inconclusive";
    readonly findings: readonly ReviewFinding[];
}
export interface ExecutionRequest {
    readonly protocolVersion: 1;
    readonly role: "implementation" | "review";
    readonly runId: string;
    readonly itemId: string;
    readonly attemptId: string;
    readonly worktreePath: string;
    readonly objective: string;
    readonly acceptanceSummary: string;
    readonly context: AttemptContext;
    readonly contextHash: string;
    readonly reviewFocus?: string;
    readonly writableRoots: readonly string[];
    readonly grants: readonly CapabilityGrant[];
    readonly deadline: string;
    readonly idleTimeoutMs: number;
    readonly maximumLineBytes: number;
    readonly maximumOutputBytes: number;
    readonly supervisionDirectory?: string;
}
export interface ExecutionHandle {
    readonly protocolVersion: 1;
    readonly adapterExecutionId: string;
    readonly startedAt: string;
    readonly supervisor?: {
        readonly schemaVersion: 1;
        readonly directory: string;
        readonly requestHash: string;
    };
}
export interface ExecutionObservation {
    readonly protocolVersion: 1;
    readonly adapterExecutionId: string;
    readonly status: "completed" | "failed" | "cancelled" | "timed-out";
    readonly exitCode: number;
    readonly completedAt: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
    readonly reviewResult?: ReviewResult;
}
export interface CancelResult {
    readonly protocolVersion: 1;
    readonly accepted: boolean;
}
export interface HarnessPort {
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    reattach?(request: ExecutionRequest): Promise<ExecutionHandle | undefined>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
export type AdapterMessage = {
    readonly protocolVersion: 1;
    readonly type: "capabilities";
    readonly manifest: CapabilityManifest;
} | {
    readonly protocolVersion: 1;
    readonly type: "started";
    readonly executionId: string;
} | {
    readonly protocolVersion: 1;
    readonly type: "progress";
    readonly executionId: string;
    readonly cursor: string;
} | {
    readonly protocolVersion: 1;
    readonly type: "terminal";
    readonly executionId: string;
    readonly status: ExecutionObservation["status"];
    readonly exitCode: number;
};
export declare function parseAdapterMessage(line: string, maximumBytes: number): AdapterMessage;
export declare function parseCancelResult(value: unknown): CancelResult;
