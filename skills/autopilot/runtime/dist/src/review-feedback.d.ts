import { type ChangeRequestRef, type ReviewThread } from "./delivery.js";
import { type CorruptRun } from "./run-discovery.js";
export interface ReviewFeedbackCandidate {
    readonly runId: string;
    readonly shortId: string;
    readonly title: string;
    readonly updatedAt: string;
}
export interface ReviewFeedbackSelection {
    readonly kind: "review-feedback-selection";
    readonly candidates: readonly ReviewFeedbackCandidate[];
    readonly corrupt: readonly CorruptRun[];
}
export interface ReviewFeedbackResult {
    readonly kind: "review-feedback";
    readonly runId: string;
    readonly itemId: string;
    readonly provider: "github" | "gitlab";
    readonly changeRequest: ChangeRequestRef;
    readonly observedHeadCommit: string;
    readonly threads: readonly (ReviewThread & {
        readonly contentHash: string;
    })[];
}
export declare function observeReviewFeedback(stateRoot: string, repositoryRoot: string, selector?: string): Promise<ReviewFeedbackSelection | ReviewFeedbackResult>;
