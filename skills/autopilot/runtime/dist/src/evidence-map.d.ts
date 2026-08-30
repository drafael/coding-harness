import type { RunCharter } from "./charter.js";
import { type PredicateResult } from "./done.js";
import type { JournalRecord } from "./journal.js";
import type { RunProjection } from "./reducer.js";
export interface PredicateEvidenceEntry extends PredicateResult {
    readonly itemId: string;
    readonly evaluationReceiptId: string | null;
}
export interface ReviewEvidenceFinding {
    readonly itemId: string;
    readonly gateId: string;
    readonly path?: string;
    readonly line?: number;
    readonly message: string;
}
export declare function projectReviewFindings(runDirectory: string, records: readonly JournalRecord[]): Promise<readonly ReviewEvidenceFinding[]>;
export declare function projectPredicateEvidence(runDirectory: string, charter: RunCharter, projection: RunProjection, records: readonly JournalRecord[]): Promise<readonly PredicateEvidenceEntry[]>;
