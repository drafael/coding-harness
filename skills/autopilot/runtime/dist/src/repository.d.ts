import type { RunCharter, WorkItem } from "./charter.js";
import { type ProcessResult } from "./process.js";
export interface ManagedBranchExpectation {
    readonly branchName: string;
    readonly expectedCommit: string;
    readonly required: boolean;
}
export interface RepositoryObservation {
    readonly headCommit: string;
    readonly treeIdentity: string;
    readonly changedPaths: readonly string[];
    readonly clean: boolean;
    readonly refIdentity: string;
    readonly auxiliaryRefIdentity: string;
    readonly externalRefIdentity: string;
    readonly configurationIdentity: string;
}
export declare function resolveCommit(repositoryRoot: string, ref: string): Promise<string>;
export declare function currentBranch(repositoryRoot: string): Promise<string>;
export declare function inspectCommit(repositoryRoot: string, commit: string): Promise<{
    readonly parents: readonly string[];
    readonly treeIdentity: string;
    readonly message: string;
}>;
export declare function inspectRepository(repositoryRoot: string): Promise<{
    readonly headCommit: string;
    readonly clean: boolean;
}>;
export declare function validateBaseCommit(charter: RunCharter): Promise<void>;
export declare function branchExists(repositoryRoot: string, branchName: string): Promise<boolean>;
export declare function validateBranchName(repositoryRoot: string, branchName: string): Promise<void>;
export declare function resolveWorktreePath(charter: RunCharter, item: WorkItem): Promise<string>;
export declare function assertRegisteredWorktree(repositoryRoot: string, worktreePath: string): Promise<void>;
export declare function ensureWorktree(charter: RunCharter, item: WorkItem, baseCommit?: string, ownedCommits?: readonly string[]): Promise<string>;
export declare function assertWritablePaths(worktreePath: string, changed: readonly string[], writableRoots: readonly string[]): Promise<void>;
export declare function observeRepository(worktreePath: string, managedBranches?: readonly ManagedBranchExpectation[]): Promise<RepositoryObservation>;
export declare function remoteBranchCommit(repositoryRoot: string, remote: string, branchName: string): Promise<string | undefined>;
export declare function pushBranch(worktreePath: string, remote: string, branchName: string, expectedCommit: string): Promise<string>;
export declare function pushAmendmentBranch(worktreePath: string, remote: string, branchName: string, previousCommit: string, expectedCommit: string, beforePush?: () => void): Promise<string>;
export interface PreCommitHookSnapshot {
    readonly identity: string;
    readonly path?: string;
}
export interface PreCommitHookResult {
    readonly status: "PASSED" | "FAILED" | "NOT_CONFIGURED";
    readonly path?: string;
    readonly result?: ProcessResult;
}
export declare function inspectPreCommitHook(worktreePath: string): Promise<PreCommitHookSnapshot>;
export declare function runPreCommitHook(worktreePath: string, expectedHook: PreCommitHookSnapshot, environmentNames: readonly string[], timeoutMs: number, maximumOutputBytes: number): Promise<PreCommitHookResult>;
export declare function commitAcceptedWork(worktreePath: string, charter: RunCharter, item: WorkItem, attemptId: string, expectedTree: string, expectedParent: string): Promise<string>;
export interface RestackCandidate {
    readonly commit: string;
    readonly treeIdentity: string;
    readonly messageIdentity: string;
    readonly temporaryWorktreePath: string;
}
export declare function prepareRestackCandidate(repositoryRoot: string, runId: string, itemId: string, oldCommit: string, freshParentCommit: string, retainedWorktreePath: string): Promise<RestackCandidate>;
export declare function installRestackCandidate(repositoryRoot: string, branchName: string, retainedWorktreePath: string, temporaryWorktreePath: string, oldCommit: string, candidateCommit: string, candidateTreeIdentity: string, beforeMutation?: () => void): Promise<void>;
export declare function runVerificationCommand(executable: string, arguments_: readonly string[], cwd: string, environmentNames: readonly string[], timeoutMs: number, maximumOutputBytes: number): Promise<ProcessResult>;
