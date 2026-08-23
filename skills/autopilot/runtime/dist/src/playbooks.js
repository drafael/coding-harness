import { expandBranchTemplate } from "./branch-template.js";
export function compileWorkGraph(requests, options) {
    return requests.map((request, index) => {
        const context = {
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
