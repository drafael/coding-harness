export interface WriterLease {
    readonly itemId: string;
    readonly branchName: string;
    readonly worktreePath: string;
    readonly epoch: number;
    readonly attemptId: string;
    readonly expiresAt: string;
}
export declare function readLease(runDirectory: string, itemId: string): Promise<WriterLease | undefined>;
export declare function acquireWriterLease(runDirectory: string, itemId: string, branchName: string, worktreePath: string, attemptId: string, timeoutMs: number): Promise<WriterLease>;
export declare function leaseIsCurrent(lease: WriterLease, attemptId: string, now?: number): boolean;
