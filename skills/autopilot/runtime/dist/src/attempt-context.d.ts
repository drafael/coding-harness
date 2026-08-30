import type { AttemptContext } from "./adapter-protocol.js";
import type { RunCharter, WorkItem } from "./charter.js";
import type { PredicateEvidenceEntry, ReviewEvidenceFinding } from "./evidence-map.js";
import type { JournalRecord } from "./journal.js";
import { type RunProjection } from "./reducer.js";
import type { RepositoryObservation } from "./repository.js";
export interface AttemptContextInput {
    readonly charter: RunCharter;
    readonly item: WorkItem;
    readonly attemptId: string;
    readonly leaseEpoch: number;
    readonly observation: RepositoryObservation;
    readonly records: readonly JournalRecord[];
    readonly projection: RunProjection;
    readonly predicateEvidence: readonly PredicateEvidenceEntry[];
    readonly reviewFindings: readonly ReviewEvidenceFinding[];
    readonly sensitiveValues?: readonly string[];
}
export declare function buildAttemptContext(input: AttemptContextInput): AttemptContext;
export declare function attemptContextHash(context: AttemptContext): string;
export declare function renderAttemptContext(context: AttemptContext): string;
export declare function renderReviewContext(context: AttemptContext, focus: string): string;
