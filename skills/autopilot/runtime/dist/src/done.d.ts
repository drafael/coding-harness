import type { RunCharter, WorkItem } from "./charter.js";
import { type VerificationReceipt } from "./evidence.js";
export interface PredicateEvaluation {
    readonly outcome: "met" | "not-met" | "blocked";
    readonly reasons: readonly string[];
}
export declare function evaluateItemDone(charter: RunCharter, item: WorkItem, worktreePath: string, subject: string, receipts: readonly VerificationReceipt[]): Promise<PredicateEvaluation>;
export declare function evaluateRunDone(itemOutcomes: readonly PredicateEvaluation[]): PredicateEvaluation;
