export interface LockOwner {
    readonly host: string;
    readonly pid: number;
    readonly startedAt: string;
    readonly token: string;
}
export interface RunLock {
    readonly owner: LockOwner;
    relocate(path: string): Promise<void>;
    stopRequested(runId: string): Promise<boolean>;
    release(): Promise<void>;
}
export type StopRequestResult = {
    readonly status: "requested";
    readonly owner: LockOwner;
} | {
    readonly status: "unowned";
};
export declare function lockOwnerIsActive(owner: LockOwner): boolean;
export declare function readLockOwner(path: string): Promise<LockOwner | undefined>;
export declare function requestRunStop(path: string, runId: string): Promise<StopRequestResult>;
export declare function acquireRunLock(path: string, resource?: string): Promise<RunLock>;
export declare function acquireBranchOwnershipLock(stateRoot: string, branchName: string): Promise<RunLock>;
