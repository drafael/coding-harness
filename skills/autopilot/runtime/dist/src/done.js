import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { countLiteral, receiptIsFresh } from "./evidence.js";
import { canonicalJson, sha256 } from "./json.js";
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
export function predicateIdentity(itemId, predicateIndex, predicate) {
    return sha256(canonicalJson({ itemId, predicateIndex, predicate }));
}
function result(item, predicate, predicateIndex, subject, outcome, reason, observed, expected, evidenceReceiptIds = []) {
    return {
        predicateId: predicateIdentity(item.id, predicateIndex, predicate),
        predicateIndex,
        predicate,
        outcome,
        subject,
        reason,
        evidenceReceiptIds,
        observed,
        expected,
    };
}
export async function evaluateItemDone(charter, item, worktreePath, subject, receipts) {
    const results = await Promise.all(item.acceptance.map(async (predicate, predicateIndex) => {
        switch (predicate.type) {
            case "gate-passed": {
                const gate = charter.gates.find(({ id }) => id === predicate.gateId);
                const receipt = gate === undefined
                    ? undefined
                    : receipts.find((candidate) => candidate.gateId === gate.id && receiptIsFresh(candidate, subject, gate));
                const met = receipt?.status === "PASSED" || receipt?.status === "WAIVED";
                return result(item, predicate, predicateIndex, subject, met ? "met" : "not-met", met
                    ? `gate ${predicate.gateId} passed for ${subject}`
                    : `gate ${predicate.gateId} is not satisfied for ${subject}`, receipt?.status ?? null, "PASSED_OR_WAIVED", receipt === undefined ? [] : [receipt.receiptId]);
            }
            case "path-present": {
                const observed = await exists(resolve(worktreePath, predicate.path));
                return result(item, predicate, predicateIndex, subject, observed ? "met" : "not-met", observed ? `path is present: ${predicate.path}` : `path is absent: ${predicate.path}`, observed, true);
            }
            case "path-absent": {
                const observed = await exists(resolve(worktreePath, predicate.path));
                return result(item, predicate, predicateIndex, subject, observed ? "not-met" : "met", observed ? `path is still present: ${predicate.path}` : `path is absent as required: ${predicate.path}`, observed, false);
            }
            case "search-count": {
                const observed = await countLiteral(worktreePath, predicate.paths, predicate.query);
                const met = observed === predicate.expectedCount;
                return result(item, predicate, predicateIndex, subject, met ? "met" : "not-met", `search for ${JSON.stringify(predicate.query)} found ${observed}; expected ${predicate.expectedCount}`, observed, predicate.expectedCount);
            }
        }
    }));
    const reasons = results.filter(({ outcome }) => outcome !== "met").map(({ reason }) => reason);
    const blocked = results.some(({ outcome }) => outcome === "blocked");
    return { outcome: blocked ? "blocked" : reasons.length === 0 ? "met" : "not-met", reasons, results };
}
export function createPredicateEvaluationReceipt(charter, item, subject, evaluation, completedAt = new Date().toISOString()) {
    const status = evaluation.outcome === "met"
        ? "PASSED"
        : evaluation.outcome === "not-met" ? "FAILED" : "UNVERIFIED";
    const receipt = {
        schemaVersion: 1,
        type: "predicate-evaluation",
        runId: charter.runId,
        itemId: item.id,
        subject,
        status,
        completedAt,
        results: evaluation.results,
    };
    return { ...receipt, receiptId: sha256(canonicalJson(receipt)) };
}
export function evaluateRunDone(itemOutcomes) {
    const results = itemOutcomes.flatMap(({ results: itemResults }) => itemResults);
    const reasons = results.filter(({ outcome }) => outcome !== "met").map(({ reason }) => reason);
    const blocked = results.some(({ outcome }) => outcome === "blocked");
    return { outcome: blocked ? "blocked" : reasons.length === 0 ? "met" : "not-met", reasons, results };
}
