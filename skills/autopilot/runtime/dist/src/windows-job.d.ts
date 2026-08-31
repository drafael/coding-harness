import { type ProcessResult } from "./process.js";
export declare const WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES = 16777216;
export declare const WINDOWS_BROKER_MAXIMUM_FIELD_BYTES = 1048576;
export declare const WINDOWS_BROKER_MAXIMUM_LIST_ENTRIES = 16384;
export interface WindowsJobHelperLocation {
    readonly executable: string;
    readonly manifest: string;
}
export interface WindowsBrokerIdentity {
    readonly schemaVersion: 1;
    readonly executionId: string;
    readonly requestHash: string;
    readonly brokerName: string;
    readonly brokerToken: string;
    readonly helperSha256: string;
}
export interface WindowsJobObservation {
    readonly state: "ready" | "starting" | "busy" | "empty" | "absent" | "terminated";
    readonly activeProcesses: number;
}
export interface WindowsResolvedCommand {
    readonly executable: string;
    readonly arguments: readonly string[];
}
interface LaunchRequest {
    readonly operation: "launch";
    readonly brokerName: string;
    readonly brokerToken: string;
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly environment: Readonly<NodeJS.ProcessEnv>;
}
interface ControlRequest {
    readonly operation: "query" | "terminate";
    readonly brokerName: string;
    readonly brokerToken: string;
}
export declare function packagedWindowsJobHelper(): WindowsJobHelperLocation;
export declare function verifyWindowsJobHelper(location?: WindowsJobHelperLocation, platform?: NodeJS.Platform, architecture?: string): Promise<{
    readonly available: boolean;
    readonly sha256?: string;
}>;
export declare function verifiedWindowsJobHelperSha256(): Promise<string | undefined>;
export declare function windowsRestartReattachmentAvailable(): Promise<boolean>;
export declare function windowsBrokerIdentity(executionId: string, requestHash: string): Promise<WindowsBrokerIdentity>;
export declare function windowsBrokerName(executionId: string, requestHash: string): string;
export declare function resolveWindowsCommand(executable: string, arguments_: readonly string[], cwd: string, environment: Readonly<NodeJS.ProcessEnv>): Promise<WindowsResolvedCommand>;
export declare function encodeWindowsJobRequest(request: LaunchRequest | ControlRequest): Buffer;
export declare function parseWindowsJobObservation(stdout: string): WindowsJobObservation;
export declare function queryWindowsJob(identity: WindowsBrokerIdentity): Promise<WindowsJobObservation>;
export declare function terminateWindowsJob(identity: WindowsBrokerIdentity): Promise<WindowsJobObservation>;
export declare function launchWindowsJob(identity: WindowsBrokerIdentity, request: Omit<LaunchRequest, "operation" | "brokerName" | "brokerToken">, processOptions: {
    readonly maximumOutputBytes: number;
    readonly redactValues: readonly string[];
    readonly onActivity: () => void;
    readonly onStderrLine?: (line: string) => void;
    readonly onSpawn: (helperPid: number) => void;
}): Promise<ProcessResult>;
export {};
