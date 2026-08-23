import type { Predicate, RunMode, WorkItem } from "./charter.js";
import { expandBranchTemplate, type BranchTemplateContext } from "./branch-template.js";

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

export function compileWorkGraph(requests: readonly WorkRequest[], options: CompileWorkGraphOptions): readonly WorkItem[] {
  return requests.map((request, index) => {
    const context: BranchTemplateContext = {
      runId: options.runId,
      itemId: request.id,
      itemObjective: request.objective,
      date: options.date,
      ...(request.ticket === undefined ? {} : { ticket: request.ticket }),
    };
    const predecessor = index === 0 ? undefined : requests.at(index - 1);
    return {
      id: request.id,
      objective: request.objective,
      writableRoots: request.writableRoots,
      dependsOn: options.mode === "ordered-stack" && predecessor !== undefined ? [predecessor.id] : [],
      acceptance: request.acceptance,
      branchName: expandBranchTemplate(options.branchTemplate, context),
      ...(request.ticket === undefined ? {} : { ticket: request.ticket }),
    };
  });
}
