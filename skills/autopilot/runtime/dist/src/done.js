import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { countLiteral, receiptIsFresh } from "./evidence.js";
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
export async function evaluateItemDone(charter, item, worktreePath, subject, receipts) {
    const reasons = [];
    for (const predicate of item.acceptance) {
        switch (predicate.type) {
            case "gate-passed": {
                const gate = charter.gates.find(({ id }) => id === predicate.gateId);
                const receipt = gate === undefined
                    ? undefined
                    : receipts.find((candidate) => candidate.gateId === gate.id && receiptIsFresh(candidate, subject, gate));
                if (receipt === undefined || (receipt.status !== "PASSED" && receipt.status !== "WAIVED")) {
                    reasons.push(`gate ${predicate.gateId} is not satisfied for ${subject}`);
                }
                break;
            }
            case "path-present":
                if (!await exists(resolve(worktreePath, predicate.path))) {
                    reasons.push(`path is absent: ${predicate.path}`);
                }
                break;
            case "path-absent":
                if (await exists(resolve(worktreePath, predicate.path))) {
                    reasons.push(`path is still present: ${predicate.path}`);
                }
                break;
            case "search-count": {
                const observed = await countLiteral(worktreePath, predicate.paths, predicate.query);
                if (observed !== predicate.expectedCount) {
                    reasons.push(`search for ${JSON.stringify(predicate.query)} found ${observed}; expected ${predicate.expectedCount}`);
                }
                break;
            }
        }
    }
    return { outcome: reasons.length === 0 ? "met" : "not-met", reasons };
}
export function evaluateRunDone(itemOutcomes) {
    const reasons = itemOutcomes.flatMap(({ reasons }) => reasons);
    const blocked = itemOutcomes.some(({ outcome }) => outcome === "blocked");
    return { outcome: blocked ? "blocked" : reasons.length === 0 ? "met" : "not-met", reasons };
}
