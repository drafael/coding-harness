import type {
  ChangeRequestRef,
  ChangeRequestState,
  CheckObservation,
  CreateChangeRequest,
  DeliveryCapabilities,
  DeliveryPort,
  MergeOutcome,
  MergeRequest,
  ReviewThread,
} from "../../src/delivery.js";
import { AutopilotError } from "../../src/errors.js";
import { expectInteger, expectLiteral, expectRecord, expectString, isRecord } from "../../src/json.js";
import { runChecked } from "../../src/process.js";

async function gh(repositoryRoot: string, arguments_: readonly string[]): Promise<string> {
  return (await runChecked({ executable: "gh", arguments: arguments_, cwd: repositoryRoot })).stdout.trim();
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `${path} returned malformed JSON`, { cause: String(error) });
  }
}

function pullRequestRef(value: unknown): ChangeRequestRef {
  const object = expectRecord(value, "GitHub pull request");
  return { provider: "github", id: String(expectInteger(object.number, "GitHub pull request.number", 1)), url: expectString(object.url, "GitHub pull request.url") };
}

async function repositoryIdentity(repositoryRoot: string): Promise<{ readonly owner: string; readonly name: string }> {
  const repository = expectRecord(parseJson(
    await gh(repositoryRoot, ["repo", "view", "--json", "nameWithOwner"]),
    "gh repo view",
  ), "GitHub repository");
  const [owner, name] = expectString(repository.nameWithOwner, "GitHub repository.nameWithOwner").split("/");
  if (owner === undefined || name === undefined || owner.length === 0 || name.length === 0) {
    throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitHub repository identity is malformed");
  }
  return { owner, name };
}

async function paginatedGitHubArray(repositoryRoot: string, endpoint: string, label: string): Promise<readonly unknown[]> {
  const entries: unknown[] = [];
  let page = 1;
  while (true) {
    const output = parseJson(await gh(repositoryRoot, [
      "api", endpoint, "--method", "GET", "-F", "per_page=100", "-F", `page=${page}`,
    ]), label);
    if (!Array.isArray(output)) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `${label} did not return an array`);
    }
    entries.push(...output);
    if (output.length < 100) {
      return entries;
    }
    page += 1;
  }
}

function authorLogin(value: unknown, path: string): string {
  if (value === null) {
    return "deleted-user";
  }
  const author = expectRecord(value, path);
  return typeof author.login === "string" && author.login.length > 0 ? author.login : "deleted-user";
}

function reviewThread(value: unknown, index: number): ReviewThread {
  const thread = expectRecord(value, `GitHub reviewThreads[${index}]`);
  const commentsConnection = expectRecord(thread.comments, `GitHub reviewThreads[${index}].comments`);
  const pageInfo = expectRecord(commentsConnection.pageInfo, `GitHub reviewThreads[${index}].comments.pageInfo`);
  if (pageInfo.hasNextPage === true) {
    throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitHub review thread has more than 100 comments; refusing a truncated snapshot");
  }
  if (!Array.isArray(commentsConnection.nodes)) {
    throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `GitHub reviewThreads[${index}].comments.nodes is malformed`);
  }
  const comments = commentsConnection.nodes.map((entry, commentIndex) => {
    const comment = expectRecord(entry, `GitHub reviewThreads[${index}].comments[${commentIndex}]`);
    return {
      id: expectString(comment.id, `GitHub reviewThreads[${index}].comments[${commentIndex}].id`),
      author: authorLogin(comment.author, `GitHub reviewThreads[${index}].comments[${commentIndex}].author`),
      body: expectString(comment.body, `GitHub reviewThreads[${index}].comments[${commentIndex}].body`),
      url: expectString(comment.url, `GitHub reviewThreads[${index}].comments[${commentIndex}].url`),
      createdAt: expectString(comment.createdAt, `GitHub reviewThreads[${index}].comments[${commentIndex}].createdAt`),
    };
  });
  return {
    id: expectString(thread.id, `GitHub reviewThreads[${index}].id`),
    resolved: thread.isResolved === true,
    outdated: thread.isOutdated === true,
    resolvable: true,
    ...(typeof thread.path === "string" ? { path: thread.path } : {}),
    ...(typeof thread.line === "number" && Number.isInteger(thread.line) ? { line: thread.line } : {}),
    comments,
  };
}

export class GitHubDeliveryAdapter implements DeliveryPort {
  async describe(): Promise<DeliveryCapabilities> {
    const providerVersion = (await gh(process.cwd(), ["--version"])).split("\n")[0] ?? "unknown";
    return {
      provider: "github",
      providerVersion,
      changeRequests: true,
      checks: true,
      approvals: true,
      mergeQueue: false,
      mergeTrain: false,
    };
  }

  async observeChangeRequest(repositoryRoot: string, ref: ChangeRequestRef): Promise<ChangeRequestState> {
    const object = expectRecord(
      parseJson(await gh(repositoryRoot, ["pr", "view", ref.id, "--json", "number,url,state,headRefOid,baseRefName,reviewDecision"]), "gh pr view"),
      "GitHub pull request",
    );
    const state = expectLiteral(expectString(object.state, "GitHub pull request.state").toUpperCase(), ["OPEN", "MERGED", "CLOSED"], "GitHub pull request.state");
    return {
      ref: pullRequestRef(object),
      state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
      headCommit: expectString(object.headRefOid, "GitHub pull request.headRefOid"),
      baseBranch: expectString(object.baseRefName, "GitHub pull request.baseRefName"),
      approved: object.reviewDecision === "APPROVED",
    };
  }

  async findChangeRequest(repositoryRoot: string, runId: string, itemId: string): Promise<ChangeRequestRef | undefined> {
    const { owner, name } = await repositoryIdentity(repositoryRoot);
    let page = 1;
    while (true) {
      const output = parseJson(await gh(repositoryRoot, [
        "api", `repos/${owner}/${name}/pulls`, "--method", "GET", "-F", "state=all", "-F", "per_page=100", "-F", `page=${page}`,
      ]), "gh api pull requests");
      if (!Array.isArray(output)) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "gh api pull requests did not return an array");
      }
      const match = output.find((entry) => isRecord(entry)
        && typeof entry.body === "string"
        && entry.body.includes(`Autopilot-Run: ${runId}`)
        && entry.body.includes(`Autopilot-Item: ${itemId}`));
      if (match !== undefined) {
        const pullRequest = expectRecord(match, "GitHub pull request");
        return {
          provider: "github",
          id: String(expectInteger(pullRequest.number, "GitHub pull request.number", 1)),
          url: expectString(pullRequest.html_url, "GitHub pull request.html_url"),
        };
      }
      if (output.length < 100) {
        return undefined;
      }
      page += 1;
    }
  }

  async createChangeRequest(request: CreateChangeRequest): Promise<ChangeRequestRef> {
    const existing = await this.findChangeRequest(request.repositoryRoot, request.runId, request.itemId);
    if (existing !== undefined) {
      return existing;
    }
    const body = `${request.body}\n\nAutopilot-Run: ${request.runId}\nAutopilot-Item: ${request.itemId}\nAutopilot-Head: ${request.expectedHeadCommit}`;
    const url = await gh(request.repositoryRoot, [
      "pr", "create", "--head", request.headBranch, "--base", request.baseBranch, "--title", request.title, "--body", body,
    ]);
    const id = url.split("/").at(-1);
    if (id === undefined || id.length === 0) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "gh pr create did not return a pull request URL");
    }
    return { provider: "github", id, url };
  }

  async observeReviewThreads(repositoryRoot: string, ref: ChangeRequestRef): Promise<readonly ReviewThread[]> {
    const { owner, name } = await repositoryIdentity(repositoryRoot);
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id,isResolved,isOutdated,path,line,comments(first:100){nodes{id,author{login},body,url,createdAt},pageInfo{hasNextPage}}},pageInfo{hasNextPage,endCursor}}}}}`;
    const threads: ReviewThread[] = [];
    let cursor: string | undefined;
    do {
      const arguments_ = ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${ref.id}`];
      if (cursor !== undefined) {
        arguments_.push("-f", `cursor=${cursor}`);
      }
      const response = expectRecord(parseJson(await gh(repositoryRoot, arguments_), "gh api graphql review threads"), "GitHub GraphQL response");
      const data = expectRecord(response.data, "GitHub GraphQL response.data");
      const repository = expectRecord(data.repository, "GitHub GraphQL response.data.repository");
      const pullRequest = expectRecord(repository.pullRequest, "GitHub GraphQL response.data.repository.pullRequest");
      const connection = expectRecord(pullRequest.reviewThreads, "GitHub pull request.reviewThreads");
      if (!Array.isArray(connection.nodes)) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitHub reviewThreads.nodes is malformed");
      }
      threads.push(...connection.nodes.map(reviewThread));
      const pageInfo = expectRecord(connection.pageInfo, "GitHub reviewThreads.pageInfo");
      cursor = pageInfo.hasNextPage === true ? expectString(pageInfo.endCursor, "GitHub reviewThreads.pageInfo.endCursor") : undefined;
    } while (cursor !== undefined);
    const issueComments = await paginatedGitHubArray(
      repositoryRoot,
      `repos/${owner}/${name}/issues/${ref.id}/comments`,
      "gh api pull request comments",
    );
    const reviewSummaries = await paginatedGitHubArray(
      repositoryRoot,
      `repos/${owner}/${name}/pulls/${ref.id}/reviews`,
      "gh api pull request reviews",
    );
    const nonResolvable = [...issueComments.map((entry, index): ReviewThread => {
      const comment = expectRecord(entry, `GitHub issue comments[${index}]`);
      const id = String(expectInteger(comment.id, `GitHub issue comments[${index}].id`, 1));
      return {
        id: `issue-comment:${id}`,
        resolved: false,
        outdated: false,
        resolvable: false,
        comments: [{
          id,
          author: authorLogin(comment.user, `GitHub issue comments[${index}].user`),
          body: expectString(comment.body, `GitHub issue comments[${index}].body`),
          url: expectString(comment.html_url, `GitHub issue comments[${index}].html_url`),
          createdAt: expectString(comment.created_at, `GitHub issue comments[${index}].created_at`),
        }],
      };
    }), ...reviewSummaries.flatMap((entry, index): readonly ReviewThread[] => {
      const review = expectRecord(entry, `GitHub reviews[${index}]`);
      if (review.state === "PENDING" || typeof review.body !== "string" || review.body.trim().length === 0) {
        return [];
      }
      const id = String(expectInteger(review.id, `GitHub reviews[${index}].id`, 1));
      return [{
        id: `review:${id}`,
        resolved: false,
        outdated: false,
        resolvable: false,
        comments: [{
          id,
          author: authorLogin(review.user, `GitHub reviews[${index}].user`),
          body: review.body,
          url: expectString(review.html_url, `GitHub reviews[${index}].html_url`),
          createdAt: typeof review.submitted_at === "string"
            ? review.submitted_at
            : expectString(review.created_at, `GitHub reviews[${index}].created_at`),
        }],
      }];
    })];
    return [...threads, ...nonResolvable];
  }

  async resolveReviewThreads(repositoryRoot: string, _ref: ChangeRequestRef, threadIds: readonly string[]): Promise<readonly string[]> {
    const mutation = "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id,isResolved}}}";
    return await Promise.all(threadIds.map(async (threadId) => {
      const response = expectRecord(parseJson(await gh(repositoryRoot, [
        "api", "graphql", "-f", `query=${mutation}`, "-f", `threadId=${threadId}`,
      ]), "gh api graphql resolve review thread"), "GitHub GraphQL response");
      const data = expectRecord(response.data, "GitHub GraphQL response.data");
      const result = expectRecord(data.resolveReviewThread, "GitHub resolveReviewThread");
      const thread = expectRecord(result.thread, "GitHub resolveReviewThread.thread");
      if (thread.isResolved !== true || expectString(thread.id, "GitHub resolveReviewThread.thread.id") !== threadId) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `GitHub did not confirm resolution of review thread ${threadId}`);
      }
      return threadId;
    }));
  }

  async observeChecks(repositoryRoot: string, subjectCommit: string): Promise<readonly CheckObservation[]> {
    const repository = expectRecord(parseJson(await gh(repositoryRoot, ["repo", "view", "--json", "nameWithOwner"]), "gh repo view"), "GitHub repository");
    const ownerAndName = expectString(repository.nameWithOwner, "GitHub repository.nameWithOwner");
    const response = expectRecord(
      parseJson(await gh(repositoryRoot, ["api", `repos/${ownerAndName}/commits/${subjectCommit}/check-runs`]), "gh api check-runs"),
      "GitHub check-runs",
    );
    if (!Array.isArray(response.check_runs)) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "GitHub check-runs response is malformed");
    }
    return response.check_runs.map((entry, index) => {
      const check = expectRecord(entry, `GitHub check-runs[${index}]`);
      const status = expectString(check.status, `GitHub check-runs[${index}].status`);
      const conclusion = typeof check.conclusion === "string" ? check.conclusion : "";
      return {
        name: expectString(check.name, `GitHub check-runs[${index}].name`),
        status: status !== "completed" ? "pending" : ["success", "neutral", "skipped"].includes(conclusion) ? "passed" : "failed",
        subjectCommit,
        ...(typeof check.details_url === "string" && check.details_url.length > 0 ? { detailsUrl: check.details_url } : {}),
      };
    });
  }

  async merge(request: MergeRequest): Promise<MergeOutcome> {
    const current = await this.observeChangeRequest(request.repositoryRoot, request.ref);
    if (current.headCommit !== request.expectedHeadCommit) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "pull request head changed before merge", {
        expected: request.expectedHeadCommit,
        observed: current.headCommit,
      });
    }
    const methodFlag = request.method === "squash" ? "--squash" : request.method === "rebase" ? "--rebase" : "--merge";
    await gh(request.repositoryRoot, ["pr", "merge", request.ref.id, methodFlag, "--match-head-commit", request.expectedHeadCommit]);
    const merged = await this.observeChangeRequest(request.repositoryRoot, request.ref);
    return { merged: merged.state === "merged", observedHeadCommit: merged.headCommit };
  }
}
