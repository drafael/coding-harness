import type { Predicate, RunMode, WorkItem } from "./charter.js";
export interface WorkRequest {
    readonly id: string;
    readonly objective: string;
    readonly writableRoots: readonly string[];
    readonly acceptance: readonly Predicate[];
    readonly ticket?: string;
}
export interface CompileWorkGraphOptions {
    readonly mode: RunMode;
    readonly runId: string;
    readonly branchTemplate: string;
    readonly date: string;
}
export declare function compileWorkGraph(requests: readonly WorkRequest[], options: CompileWorkGraphOptions): readonly WorkItem[];
