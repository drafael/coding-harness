import { type AssuranceLevel, type CapabilityGrant, type GrantFamily } from "./charter.js";
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
export interface ExecutionRequest {
    readonly protocolVersion: 1;
    readonly runId: string;
    readonly itemId: string;
    readonly attemptId: string;
    readonly worktreePath: string;
    readonly objective: string;
    readonly acceptanceSummary: string;
    readonly writableRoots: readonly string[];
    readonly grants: readonly CapabilityGrant[];
    readonly deadline: string;
    readonly idleTimeoutMs: number;
    readonly maximumLineBytes: number;
    readonly maximumOutputBytes: number;
}
export interface ExecutionHandle {
    readonly protocolVersion: 1;
    readonly adapterExecutionId: string;
    readonly startedAt: string;
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
}
export interface CancelResult {
    readonly protocolVersion: 1;
    readonly accepted: boolean;
}
export interface HarnessPort {
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
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
