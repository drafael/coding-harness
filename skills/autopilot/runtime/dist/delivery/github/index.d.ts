import type { ChangeRequestRef, ChangeRequestState, CheckObservation, CreateChangeRequest, DeliveryCapabilities, DeliveryPort, MergeOutcome, MergeRequest, ReviewThread } from "../../src/delivery.js";
export declare class GitHubDeliveryAdapter implements DeliveryPort {
    describe(): Promise<DeliveryCapabilities>;
    observeChangeRequest(repositoryRoot: string, ref: ChangeRequestRef): Promise<ChangeRequestState>;
    findChangeRequest(repositoryRoot: string, runId: string, itemId: string): Promise<ChangeRequestRef | undefined>;
    createChangeRequest(request: CreateChangeRequest): Promise<ChangeRequestRef>;
    observeReviewThreads(repositoryRoot: string, ref: ChangeRequestRef): Promise<readonly ReviewThread[]>;
    resolveReviewThreads(repositoryRoot: string, _ref: ChangeRequestRef, threadIds: readonly string[]): Promise<readonly string[]>;
    observeChecks(repositoryRoot: string, subjectCommit: string): Promise<readonly CheckObservation[]>;
    merge(request: MergeRequest): Promise<MergeOutcome>;
}
