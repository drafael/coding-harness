import type { ProcessResult } from "./process.js";
import { type WindowsBrokerIdentity } from "./windows-job.js";
export interface SupervisedProcessRequest {
    readonly schemaVersion: 1;
    readonly executionId: string;
    readonly runId: string;
    readonly itemId: string;
    readonly attemptId: string;
    readonly contextHash: string;
    readonly windowsHelperSha256?: string;
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly environmentNames: readonly string[];
    readonly credentialEnvironmentNames: readonly string[];
    readonly deadline: string;
    readonly idleTimeoutMs: number;
    readonly maximumOutputBytes: number;
    readonly displayStderrActivity: boolean;
}
export interface SupervisedProcessHandle {
    readonly schemaVersion: 1;
    readonly executionId: string;
    readonly directory: string;
    readonly requestHash: string;
    readonly startedAt: string;
}
export interface SupervisedProcessStatus {
    readonly schemaVersion: 1;
    readonly executionId: string;
    readonly requestHash: string;
    readonly state: "starting" | "running" | "completed" | "failed" | "cancelled" | "timed-out" | "state-unknown";
    readonly supervisorPid: number;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly completedAt?: string;
    readonly exitCode?: number;
}
export declare function supervisedExecutionId(runId: string, itemId: string, attemptId: string, role: string, contextHash: string): string;
export declare function supervisorDirectory(runDirectory: string, executionId: string): string;
export declare function supervisorRequestHash(request: SupervisedProcessRequest): string;
export declare function readSupervisedRequest(directory: string): Promise<SupervisedProcessRequest | undefined>;
export declare function readSupervisedStatus(directory: string): Promise<SupervisedProcessStatus | undefined>;
export declare function readWindowsBrokerIdentity(directory: string): Promise<WindowsBrokerIdentity | undefined>;
export declare function readSupervisedResult(directory: string): Promise<ProcessResult | undefined>;
export declare function readSupervisedCompletion(directory: string): Promise<{
    readonly state: "completed" | "failed" | "state-unknown";
    readonly result: ProcessResult;
    readonly completedAt: number;
} | undefined>;
export declare function launchSupervisedProcess(directory: string, request: SupervisedProcessRequest, environment: Readonly<NodeJS.ProcessEnv>): Promise<SupervisedProcessHandle>;
export declare function reattachSupervisedProcess(directory: string, request: SupervisedProcessRequest): Promise<SupervisedProcessHandle | undefined>;
export declare function observeSupervisedProcess(handle: SupervisedProcessHandle, onActivityLine?: (line: string) => void): Promise<{
    readonly result: ProcessResult;
    readonly state: SupervisedProcessStatus["state"];
}>;
export declare function supervisedCancellationAt(directory: string, executionId: string, requestHash: string): Promise<number | undefined>;
export declare function cancelSupervisedProcess(handle: SupervisedProcessHandle): Promise<void>;
export declare const supervisorArtifactNames: {
    readonly request: "request.json";
    readonly status: "status.json";
    readonly result: "result.json";
    readonly cancel: "cancel.json";
    readonly activity: "stderr-activity.log";
    readonly child: "child.json";
    readonly watchdogReady: "watchdog-ready.json";
    readonly activityPulse: "activity-pulse";
    readonly completion: "completion.json";
};
