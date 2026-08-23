import type { WorkItem } from "./charter.js";
export declare const DEFAULT_BRANCH_TEMPLATE = "autopilot/{run-short}/{item-slug}";
export interface BranchTemplateSources {
    readonly invocation?: string;
    readonly project?: string;
    readonly user?: string;
}
export interface BranchTemplateContext {
    readonly runId: string;
    readonly itemId: string;
    readonly itemObjective: string;
    readonly ticket?: string;
    readonly date: string;
}
export declare function selectBranchTemplate(sources: BranchTemplateSources): {
    readonly template: string;
    readonly source: "invocation" | "project" | "user" | "default";
};
export declare function expandBranchTemplate(template: string, context: BranchTemplateContext): string;
export declare function validateResolvedBranches(repositoryRoot: string, items: readonly WorkItem[]): Promise<void>;
