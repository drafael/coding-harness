import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { Predicate, RunCharter, WorkItem } from "./charter.js";
import { countLiteral, receiptIsFresh, type VerificationReceipt } from "./evidence.js";
import { canonicalJson, sha256 } from "./json.js";

export type PredicateOutcome = "met" | "not-met" | "blocked";

export interface PredicateResult {
  readonly predicateId: string;
  readonly predicateIndex: number;
  readonly predicate: Predicate;
  readonly outcome: PredicateOutcome;
  readonly subject: string;
  readonly reason: string;
  readonly evidenceReceiptIds: readonly string[];
  readonly observed: string | number | boolean | null;
  readonly expected: string | number | boolean;
}

export interface PredicateEvaluation {
  readonly outcome: PredicateOutcome;
  readonly reasons: readonly string[];
  readonly results: readonly PredicateResult[];
}

export interface PredicateEvaluationReceipt {
  readonly schemaVersion: 1;
  readonly type: "predicate-evaluation";
  readonly receiptId: string;
  readonly runId: string;
  readonly itemId: string;
  readonly subject: string;
  readonly status: "PASSED" | "FAILED" | "UNVERIFIED";
  readonly completedAt: string;
  readonly results: readonly PredicateResult[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function predicateIdentity(itemId: string, predicateIndex: number, predicate: Predicate): string {
  return sha256(canonicalJson({ itemId, predicateIndex, predicate }));
}

function result(
  item: WorkItem,
  predicate: Predicate,
  predicateIndex: number,
  subject: string,
  outcome: PredicateOutcome,
  reason: string,
  observed: PredicateResult["observed"],
  expected: PredicateResult["expected"],
  evidenceReceiptIds: readonly string[] = [],
): PredicateResult {
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

export async function evaluateItemDone(
  charter: RunCharter,
  item: WorkItem,
  worktreePath: string,
  subject: string,
  receipts: readonly VerificationReceipt[],
): Promise<PredicateEvaluation> {
  const results = await Promise.all(item.acceptance.map(async (predicate, predicateIndex): Promise<PredicateResult> => {
    switch (predicate.type) {
      case "gate-passed": {
        const gate = charter.gates.find(({ id }) => id === predicate.gateId);
        const receipt = gate === undefined
          ? undefined
          : receipts.find((candidate) => candidate.gateId === gate.id && receiptIsFresh(candidate, subject, gate));
        const met = receipt?.status === "PASSED" || receipt?.status === "WAIVED";
        return result(
          item,
          predicate,
          predicateIndex,
          subject,
          met ? "met" : "not-met",
          met
            ? `gate ${predicate.gateId} passed for ${subject}`
            : `gate ${predicate.gateId} is not satisfied for ${subject}`,
          receipt?.status ?? null,
          "PASSED_OR_WAIVED",
          receipt === undefined ? [] : [receipt.receiptId],
        );
      }
      case "path-present": {
        const observed = await exists(resolve(worktreePath, predicate.path));
        return result(
          item,
          predicate,
          predicateIndex,
          subject,
          observed ? "met" : "not-met",
          observed ? `path is present: ${predicate.path}` : `path is absent: ${predicate.path}`,
          observed,
          true,
        );
      }
      case "path-absent": {
        const observed = await exists(resolve(worktreePath, predicate.path));
        return result(
          item,
          predicate,
          predicateIndex,
          subject,
          observed ? "not-met" : "met",
          observed ? `path is still present: ${predicate.path}` : `path is absent as required: ${predicate.path}`,
          observed,
          false,
        );
      }
      case "search-count": {
        const observed = await countLiteral(worktreePath, predicate.paths, predicate.query);
        const met = observed === predicate.expectedCount;
        return result(
          item,
          predicate,
          predicateIndex,
          subject,
          met ? "met" : "not-met",
          `search for ${JSON.stringify(predicate.query)} found ${observed}; expected ${predicate.expectedCount}`,
          observed,
          predicate.expectedCount,
        );
      }
    }
  }));
  const reasons = results.filter(({ outcome }) => outcome !== "met").map(({ reason }) => reason);
  const blocked = results.some(({ outcome }) => outcome === "blocked");
  return { outcome: blocked ? "blocked" : reasons.length === 0 ? "met" : "not-met", reasons, results };
}

export function createPredicateEvaluationReceipt(
  charter: RunCharter,
  item: WorkItem,
  subject: string,
  evaluation: PredicateEvaluation,
  completedAt = new Date().toISOString(),
): PredicateEvaluationReceipt {
  const status: PredicateEvaluationReceipt["status"] = evaluation.outcome === "met"
    ? "PASSED"
    : evaluation.outcome === "not-met" ? "FAILED" : "UNVERIFIED";
  const receipt = {
    schemaVersion: 1 as const,
    type: "predicate-evaluation" as const,
    runId: charter.runId,
    itemId: item.id,
    subject,
    status,
    completedAt,
    results: evaluation.results,
  };
  return { ...receipt, receiptId: sha256(canonicalJson(receipt)) };
}

export function evaluateRunDone(itemOutcomes: readonly PredicateEvaluation[]): PredicateEvaluation {
  const results = itemOutcomes.flatMap(({ results: itemResults }) => itemResults);
  const reasons = results.filter(({ outcome }) => outcome !== "met").map(({ reason }) => reason);
  const blocked = results.some(({ outcome }) => outcome === "blocked");
  return { outcome: blocked ? "blocked" : reasons.length === 0 ? "met" : "not-met", reasons, results };
}
