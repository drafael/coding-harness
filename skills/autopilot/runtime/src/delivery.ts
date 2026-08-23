import { canonicalJson, sha256 } from "./json.js";

const FALLBACK_TITLE_LENGTH = 72;

export function changeRequestTitle(item: { readonly title?: string; readonly objective: string }): string {
  if (item.title !== undefined) {
    return item.title;
  }
  const normalized = item.objective.replace(/\s+/gu, " ").trim();
  const clause = normalized.split(/(?:[.!?](?:\s|$)|;)/u, 1)[0] ?? normalized;
  if (clause.length <= FALLBACK_TITLE_LENGTH) {
    return clause;
  }
  const lastWholeWord = clause.lastIndexOf(" ", FALLBACK_TITLE_LENGTH - 1);
  const end = lastWholeWord > 0 ? lastWholeWord : FALLBACK_TITLE_LENGTH - 1;
  return `${clause.slice(0, end).trimEnd()}…`;
}

export interface DeliveryCapabilities {
  readonly provider: "github" | "gitlab";
  readonly providerVersion: string;
  readonly changeRequests: boolean;
  readonly checks: boolean;
  readonly approvals: boolean;
  readonly mergeQueue: boolean;
  readonly mergeTrain: boolean;
}

export interface ChangeRequestRef {
  readonly provider: "github" | "gitlab";
  readonly id: string;
  readonly url: string;
}

export interface ChangeRequestState {
  readonly ref: ChangeRequestRef;
  readonly state: "open" | "merged" | "closed";
  readonly headCommit: string;
  readonly baseBranch: string;
  readonly approved: boolean;
}

export interface CreateChangeRequest {
  readonly repositoryRoot: string;
  readonly runId: string;
  readonly itemId: string;
  readonly title: string;
  readonly body: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly expectedHeadCommit: string;
}

export interface ReviewComment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
}

export interface ReviewThread {
  readonly id: string;
  readonly resolved: boolean;
  readonly outdated: boolean;
  readonly resolvable: boolean;
  readonly path?: string;
  readonly line?: number;
  readonly comments: readonly ReviewComment[];
}

export function reviewThreadDigest(thread: ReviewThread): string {
  return sha256(canonicalJson({
    id: thread.id,
    ...(thread.path === undefined ? {} : { path: thread.path }),
    comments: thread.comments,
  }));
}

export interface CheckObservation {
  readonly name: string;
  readonly status: "passed" | "failed" | "pending" | "unknown";
  readonly subjectCommit: string;
  readonly detailsUrl?: string;
}

export interface MergeRequest {
  readonly repositoryRoot: string;
  readonly ref: ChangeRequestRef;
  readonly expectedHeadCommit: string;
  readonly method: "merge" | "squash" | "rebase";
}

export interface MergeOutcome {
  readonly merged: boolean;
  readonly observedHeadCommit: string;
  readonly mergeCommit?: string;
}

export interface DeliveryPort {
  describe(): Promise<DeliveryCapabilities>;
  observeChangeRequest(repositoryRoot: string, ref: ChangeRequestRef): Promise<ChangeRequestState>;
  findChangeRequest(repositoryRoot: string, runId: string, itemId: string): Promise<ChangeRequestRef | undefined>;
  createChangeRequest(request: CreateChangeRequest): Promise<ChangeRequestRef>;
  observeReviewThreads(repositoryRoot: string, ref: ChangeRequestRef): Promise<readonly ReviewThread[]>;
  resolveReviewThreads(repositoryRoot: string, ref: ChangeRequestRef, threadIds: readonly string[]): Promise<readonly string[]>;
  observeChecks(repositoryRoot: string, subjectCommit: string): Promise<readonly CheckObservation[]>;
  merge(request: MergeRequest): Promise<MergeOutcome>;
}
