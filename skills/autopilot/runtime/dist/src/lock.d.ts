export interface LockOwner {
    readonly host: string;
    readonly pid: number;
    readonly startedAt: string;
    readonly token: string;
}
export type ControlAction = "pause" | "stop";
export interface RunLock {
    readonly owner: LockOwner;
    relocate(path: string): Promise<void>;
    controlRequested(runId: string): Promise<ControlAction | undefined>;
    stopRequested(runId: string): Promise<boolean>;
    release(): Promise<void>;
}
export type ControlRequestResult = {
    readonly status: "requested";
    readonly owner: LockOwner;
} | {
    readonly status: "unowned";
};
export type StopRequestResult = ControlRequestResult;
export declare function lockOwnerIsActive(owner: LockOwner): boolean;
export declare function readLockOwner(path: string): Promise<LockOwner | undefined>;
export declare function requestRunControl(path: string, runId: string, action: ControlAction): Promise<ControlRequestResult>;
export declare function requestRunStop(path: string, runId: string): Promise<StopRequestResult>;
export declare function requestRunPause(path: string, runId: string): Promise<ControlRequestResult>;
export declare function acquireRunLock(path: string, resource?: string): Promise<RunLock>;
export declare function acquireBranchOwnershipLock(stateRoot: string, branchName: string): Promise<RunLock>;
