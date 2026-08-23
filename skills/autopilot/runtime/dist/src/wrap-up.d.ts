import type { RunCharter } from "./charter.js";
export interface WrapUpCandidate {
    readonly runId: string;
    readonly completedAt: string;
    readonly mode: RunCharter["mode"];
    readonly itemCount: number;
    readonly branches: readonly string[];
    readonly provider: "github" | "gitlab";
    readonly changeRequests: readonly string[];
}
export interface WrapUpDiscovery {
    readonly kind: "selection";
    readonly candidates: readonly WrapUpCandidate[];
    readonly excluded: readonly {
        readonly runId: string;
        readonly reason: string;
    }[];
    readonly corrupt: readonly {
        readonly name: string;
        readonly reason: string;
    }[];
}
export interface WrapUpResult {
    readonly kind: "completed";
    readonly runId: string;
    readonly deletedRunIds: readonly string[];
    readonly deletedRemoteBranches: readonly string[];
    readonly removedWorktrees: readonly string[];
    readonly deletedLocalBranches: readonly string[];
    readonly handoffPaths: readonly string[];
}
export declare function discoverWrapUpRuns(stateRoot: string, repositoryRoot: string): Promise<WrapUpDiscovery>;
export declare function wrapUpRun(stateRoot: string, runId: string, handoff: boolean): Promise<WrapUpResult>;
