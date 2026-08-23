import { AutopilotError } from "./errors.js";
import { branchExists, validateBranchName } from "./repository.js";
export const DEFAULT_BRANCH_TEMPLATE = "autopilot/{run-short}/{item-slug}";
const PLACEHOLDERS = new Set(["run", "run-short", "item", "item-slug", "ticket", "date"]);
export function selectBranchTemplate(sources) {
    if (sources.invocation !== undefined) {
        return { template: sources.invocation, source: "invocation" };
    }
    if (sources.project !== undefined) {
        return { template: sources.project, source: "project" };
    }
    if (sources.user !== undefined) {
        return { template: sources.user, source: "user" };
    }
    return { template: DEFAULT_BRANCH_TEMPLATE, source: "default" };
}
function slug(value) {
    const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return result.length === 0 ? "item" : result;
}
export function expandBranchTemplate(template, context) {
    const unknown = [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "").filter((name) => !PLACEHOLDERS.has(name));
    if (unknown.length > 0) {
        throw new AutopilotError("CHARTER_INVALID", `unknown branch template placeholders: ${unknown.join(", ")}`);
    }
    const values = {
        run: context.runId,
        "run-short": context.runId.slice(0, 8),
        item: context.itemId,
        "item-slug": slug(context.itemObjective),
        ticket: context.ticket ?? "no-ticket",
        date: context.date,
    };
    return template.replace(/\{([^}]+)\}/g, (_match, name) => values[name] ?? "");
}
export async function validateResolvedBranches(repositoryRoot, items) {
    const names = new Set(items.map(({ branchName }) => branchName));
    if (names.size !== items.length) {
        throw new AutopilotError("BRANCH_COLLISION", "resolved branch names are not unique");
    }
    for (const item of items) {
        await validateBranchName(repositoryRoot, item.branchName);
        if (await branchExists(repositoryRoot, item.branchName)) {
            throw new AutopilotError("BRANCH_COLLISION", `branch already exists: ${item.branchName}`);
        }
    }
}
