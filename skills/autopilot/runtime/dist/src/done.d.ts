import type { Predicate, RunCharter, WorkItem } from "./charter.js";
import { type VerificationReceipt } from "./evidence.js";
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
export declare function predicateIdentity(itemId: string, predicateIndex: number, predicate: Predicate): string;
export declare function evaluateItemDone(charter: RunCharter, item: WorkItem, worktreePath: string, subject: string, receipts: readonly VerificationReceipt[]): Promise<PredicateEvaluation>;
export declare function createPredicateEvaluationReceipt(charter: RunCharter, item: WorkItem, subject: string, evaluation: PredicateEvaluation, completedAt?: string): PredicateEvaluationReceipt;
export declare function evaluateRunDone(itemOutcomes: readonly PredicateEvaluation[]): PredicateEvaluation;
