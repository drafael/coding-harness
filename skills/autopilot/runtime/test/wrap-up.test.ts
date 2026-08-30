import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import type { ProposedRunCharter, RunCharter } from "../src/charter.js";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, writeImmutableJson } from "../src/journal.js";
import { runChecked, runProcess } from "../src/process.js";
import { branchExists, ensureWorktree, remoteBranchCommit } from "../src/repository.js";
import { discoverWrapUpRuns, wrapUpRun } from "../src/wrap-up.js";
import { createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

type EventInput<T> = T extends LifecycleEvent
  ? Omit<T, "eventId" | "timestamp" | "source" | "reason">
  : never;

function event(value: EventInput<LifecycleEvent>): LifecycleEvent {
  return {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "wrap-up fixture",
    ...value,
  } as LifecycleEvent;
}

async function installFakeProvider(): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), "autopilot-wrap-provider-"));
  const gh = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "view") {
  const heads = JSON.parse(process.env.WRAP_HEADS ?? "{}");
  const bases = JSON.parse(process.env.WRAP_BASES ?? "{}");
  const urls = JSON.parse(process.env.WRAP_URLS ?? "{}");
  const id = args[2];
  console.log(JSON.stringify({number: Number(id), url: urls[id] ?? "https://example.invalid/pull/" + id, state: process.env.WRAP_STATE ?? "MERGED", headRefOid: heads[id] ?? process.env.WRAP_HEAD, baseRefName: bases[id] ?? "main", reviewDecision: "APPROVED"}));
} else if (args[0] === "--version") {
  console.log("gh version fake");
} else {
  console.log("[]");
}
`;
  const glab = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "mr" && args[1] === "view") {
  console.log(JSON.stringify({iid: 17, web_url: "https://example.invalid/merge_requests/17", state: (process.env.WRAP_STATE ?? "merged").toLowerCase(), diff_refs: {head_sha: process.env.WRAP_HEAD}, target_branch: "main", approved: true}));
} else if (args[0] === "--version") {
  console.log("glab version fake");
} else {
  console.log("[]");
}
`;
  await writeNodeExecutable(bin, "gh", gh);
  await writeNodeExecutable(bin, "glab", glab);
  return bin;
}

interface Fixture {
  readonly repository: { readonly root: string; readonly baseCommit: string };
  readonly stateRoot: string;
  readonly remote: string;
  readonly runId: string;
  readonly itemId: string;
  readonly branchName: string;
  readonly acceptedCommit: string;
  readonly worktreePath: string;
  readonly runDirectory: string;
  readonly charter: RunCharter;
}

async function addSuccessfulRun(
  repository: Fixture["repository"],
  stateRoot: string,
  remote: string,
  runId: string,
  provider: "github" | "gitlab" = "github",
): Promise<Fixture> {
  const itemId = "item-1";
  const branchName = `autopilot/${runId}/item-1`;
  const proposed = proposedCharter(repository.root, repository.baseCommit, "single", runId);
  const deliveryGrants: ProposedRunCharter["grants"] = [
    ...proposed.grants,
    { family: "remote.push", actor: "runtime", remotes: ["origin"] },
    { family: "change-request.open", actor: "delivery" },
  ];
  const charter = sealCharter({
    ...proposed,
    work: [{ ...proposed.work[0], branchName }],
    delivery: "change-request-ready",
    deliveryTarget: { provider, remote: "origin", baseBranch: "main" },
    grants: deliveryGrants,
  });
  const item = charter.work[0];
  if (item === undefined) {
    throw new Error("expected work item");
  }
  const worktreePath = await ensureWorktree(charter, item);
  await writeFile(join(worktreePath, "result.txt"), "done\n");
  await runChecked({ executable: "git", arguments: ["add", "result.txt"], cwd: worktreePath });
  await runChecked({
    executable: "git",
    arguments: ["commit", "-m", `accepted\n\nAutopilot-Run: ${runId}\nAutopilot-Item: ${itemId}`],
    cwd: worktreePath,
  });
  const acceptedCommit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: worktreePath })).stdout.trim();
  await runChecked({ executable: "git", arguments: ["push", "origin", `${branchName}:${branchName}`], cwd: worktreePath });
  const runDirectory = join(stateRoot, "runs", runId);
  await mkdir(join(runDirectory, "reports"), { recursive: true });
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  const attemptId = `${runId}-attempt`;
  const changeRequestUrl = provider === "github"
    ? "https://example.invalid/pull/17"
    : "https://example.invalid/merge_requests/17";
  const events: LifecycleEvent[] = [
    event({ type: "CHARTER_COMPILED" }),
    event({ type: "RECONCILIATION_STARTED" }),
    event({ type: "RECONCILIATION_COMPLETED" }),
    event({ type: "ITEM_READY", itemId }),
    event({ type: "ATTEMPT_STARTED", itemId, attemptId, leaseEpoch: 1, expectedBaseCommit: repository.baseCommit,
      deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: `${runId}-attempt-key` }),
    event({ type: "ATTEMPT_FINISHED", itemId, attemptId, observedHeadCommit: repository.baseCommit, outcome: "completed" }),
    event({ type: "ITEM_VERIFYING", itemId, attemptId }),
    event({ type: "EFFECT_CONFIRMED", itemId, effect: "git.commit", idempotencyKey: `${runId}-commit`, observedState: acceptedCommit }),
    event({ type: "EFFECT_CONFIRMED", itemId, effect: "remote.push", idempotencyKey: `${runId}-push`, observedState: acceptedCommit }),
    event({ type: "EFFECT_CONFIRMED", itemId, effect: "change-request.open", idempotencyKey: `${runId}-cr`, observedState: changeRequestUrl }),
    event({ type: "ITEM_SATISFIED", itemId, attemptId, subject: "tree:accepted" }),
    event({ type: "RUN_VERIFYING" }),
    event({ type: "RUN_SUCCEEDED", predicateSummary: "satisfied" }),
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(join(runDirectory, "events.jsonl"), lifecycleEvent);
  }
  return { repository, stateRoot, remote, runId, itemId, branchName, acceptedCommit, worktreePath, runDirectory, charter };
}

async function createFixture(runId = "wrap-run", provider: "github" | "gitlab" = "github"): Promise<Fixture> {
  const created = await createRepository();
  const repository = { ...created, root: await realpath(created.root) };
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-wrap-state-")));
  const remote = await mkdtemp(join(tmpdir(), "autopilot-wrap-remote-"));
  await runChecked({ executable: "git", arguments: ["init", "--bare"], cwd: remote });
  await runChecked({ executable: "git", arguments: ["remote", "add", "origin", remote], cwd: repository.root });
  return await addSuccessfulRun(repository, stateRoot, remote, runId, provider);
}

async function createMultiFixture(
  mode: "independent-queue" | "ordered-stack" = "independent-queue",
  delivery: "change-request-ready" | "merge-verified" = "change-request-ready",
): Promise<{
  readonly repository: Fixture["repository"];
  readonly stateRoot: string;
  readonly runId: string;
  readonly branches: readonly string[];
  readonly commits: readonly string[];
  readonly worktrees: readonly string[];
}> {
  const created = await createRepository();
  const repository = { ...created, root: await realpath(created.root) };
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-wrap-multi-state-")));
  const remote = await mkdtemp(join(tmpdir(), "autopilot-wrap-multi-remote-"));
  await runChecked({ executable: "git", arguments: ["init", "--bare"], cwd: remote });
  await runChecked({ executable: "git", arguments: ["remote", "add", "origin", remote], cwd: repository.root });
  const runId = mode === "ordered-stack" ? "stack-run" : "multi-run";
  const proposed = proposedCharter(repository.root, repository.baseCommit, mode, runId);
  const charter = sealCharter({
    ...proposed,
    delivery,
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [
      ...proposed.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "change-request.open", actor: "delivery" },
      ...(delivery === "merge-verified" ? [{ family: "merge.execute" as const, actor: "delivery" as const }] : []),
    ],
  });
  const commits: string[] = [];
  const worktrees: string[] = [];
  for (const [index, item] of charter.work.entries()) {
    const baseCommit = mode === "ordered-stack" && index > 0
      ? commits[index - 1]
      : repository.baseCommit;
    if (baseCommit === undefined) {
      throw new Error("expected stack predecessor commit");
    }
    const worktree = await ensureWorktree(charter, item, baseCommit);
    const output = item.writableRoots[0];
    if (output === undefined) {
      throw new Error("expected writable output");
    }
    await writeFile(join(worktree, output), "done\n");
    await runChecked({ executable: "git", arguments: ["add", output], cwd: worktree });
    await runChecked({
      executable: "git",
      arguments: ["commit", "-m", `accepted\n\nAutopilot-Run: ${runId}\nAutopilot-Item: ${item.id}`],
      cwd: worktree,
    });
    const commit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: worktree })).stdout.trim();
    await runChecked({ executable: "git", arguments: ["push", "origin", `${item.branchName}:${item.branchName}`], cwd: worktree });
    commits.push(commit);
    worktrees.push(worktree);
  }
  const runDirectory = join(stateRoot, "runs", runId);
  await mkdir(join(runDirectory, "reports"), { recursive: true });
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  const lifecycleEvents: LifecycleEvent[] = [
    event({ type: "CHARTER_COMPILED" }),
    event({ type: "RECONCILIATION_STARTED" }),
    event({ type: "RECONCILIATION_COMPLETED" }),
  ];
  for (const [index, item] of charter.work.entries()) {
    const attemptId = `${item.id}-attempt`;
    const commit = commits[index];
    if (commit === undefined) {
      throw new Error("expected accepted commit");
    }
    lifecycleEvents.push(
      event({ type: "ITEM_READY", itemId: item.id }),
      event({ type: "ATTEMPT_STARTED", itemId: item.id, attemptId, leaseEpoch: 1,
        expectedBaseCommit: repository.baseCommit, deadline: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: `${item.id}-attempt-key` }),
      event({ type: "ATTEMPT_FINISHED", itemId: item.id, attemptId,
        observedHeadCommit: repository.baseCommit, outcome: "completed" }),
      event({ type: "ITEM_VERIFYING", itemId: item.id, attemptId }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "git.commit",
        idempotencyKey: `${item.id}-commit`, observedState: commit }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "remote.push",
        idempotencyKey: `${item.id}-push`, observedState: commit }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "change-request.open",
        idempotencyKey: `${item.id}-cr`, observedState: `https://example.invalid/pull/${index + 17}` }),
      event({ type: "ITEM_SATISFIED", itemId: item.id, attemptId, subject: `tree:${commit}` }),
    );
  }
  lifecycleEvents.push(event({ type: "RUN_VERIFYING" }), event({ type: "RUN_SUCCEEDED", predicateSummary: "satisfied" }));
  for (const lifecycleEvent of lifecycleEvents) {
    await appendEvent(join(runDirectory, "events.jsonl"), lifecycleEvent);
  }
  return {
    repository,
    stateRoot,
    runId,
    branches: charter.work.map(({ branchName }) => branchName),
    commits,
    worktrees,
  };
}

async function addSuccessfulAmendment(predecessor: Fixture, runId: string): Promise<Fixture> {
  const proposed = proposedCharter(predecessor.repository.root, predecessor.acceptedCommit, "single", runId);
  const charter = sealCharter({
    ...proposed,
    repository: {
      ...proposed.repository,
      baseRef: predecessor.branchName,
      baseCommit: predecessor.acceptedCommit,
    },
    work: [{ ...proposed.work[0], branchName: predecessor.branchName }],
    delivery: "change-request-ready",
    deliveryTarget: predecessor.charter.deliveryTarget,
    predecessorRunId: predecessor.runId,
    amends: { runId: predecessor.runId, itemId: predecessor.itemId },
    grants: [
      ...proposed.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "change-request.update", actor: "delivery" },
    ],
  });
  const runDirectory = join(predecessor.stateRoot, "runs", runId);
  await mkdir(join(runDirectory, "reports"), { recursive: true });
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  const attemptId = `${runId}-attempt`;
  const events: LifecycleEvent[] = [
    event({ type: "CHARTER_COMPILED" }),
    event({ type: "WORKTREE_ADOPTED", itemId: predecessor.itemId, predecessorRunId: predecessor.runId,
      predecessorItemId: predecessor.itemId, worktreePath: predecessor.worktreePath, branchName: predecessor.branchName,
      acceptedCommit: predecessor.acceptedCommit, changeRequestUrl: "https://example.invalid/pull/17" }),
    event({ type: "RECONCILIATION_STARTED" }),
    event({ type: "RECONCILIATION_COMPLETED" }),
    event({ type: "ITEM_READY", itemId: predecessor.itemId }),
    event({ type: "ATTEMPT_STARTED", itemId: predecessor.itemId, attemptId, leaseEpoch: 1,
      expectedBaseCommit: predecessor.acceptedCommit, deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `${runId}-attempt-key` }),
    event({ type: "ATTEMPT_FINISHED", itemId: predecessor.itemId, attemptId,
      observedHeadCommit: predecessor.acceptedCommit, outcome: "completed" }),
    event({ type: "ITEM_VERIFYING", itemId: predecessor.itemId, attemptId }),
    event({ type: "EFFECT_CONFIRMED", itemId: predecessor.itemId, effect: "git.commit",
      idempotencyKey: `${runId}-commit`, observedState: predecessor.acceptedCommit }),
    event({ type: "EFFECT_CONFIRMED", itemId: predecessor.itemId, effect: "remote.push",
      idempotencyKey: `${runId}-push`, observedState: predecessor.acceptedCommit }),
    event({ type: "EFFECT_CONFIRMED", itemId: predecessor.itemId, effect: "change-request.update",
      idempotencyKey: `${runId}-cr`, observedState: "https://example.invalid/pull/17" }),
    event({ type: "ITEM_SATISFIED", itemId: predecessor.itemId, attemptId, subject: "tree:accepted" }),
    event({ type: "RUN_VERIFYING" }),
    event({ type: "RUN_SUCCEEDED", predicateSummary: "satisfied" }),
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(join(runDirectory, "events.jsonl"), lifecycleEvent);
  }
  return { ...predecessor, runId, runDirectory, charter };
}

async function withProvider<T>(
  head: string | Readonly<Record<string, string>>,
  state: string,
  action: () => Promise<T>,
  options: {
    readonly bases?: Readonly<Record<string, string>>;
    readonly urls?: Readonly<Record<string, string>>;
  } = {},
): Promise<T> {
  const bin = await installFakeProvider();
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${priorPath ?? ""}`;
  if (typeof head === "string") {
    process.env.WRAP_HEAD = head;
  } else {
    process.env.WRAP_HEADS = JSON.stringify(head);
  }
  if (options.bases !== undefined) {
    process.env.WRAP_BASES = JSON.stringify(options.bases);
  }
  if (options.urls !== undefined) {
    process.env.WRAP_URLS = JSON.stringify(options.urls);
  }
  process.env.WRAP_STATE = state;
  try {
    return await action();
  } finally {
    process.env.PATH = priorPath;
    delete process.env.WRAP_HEAD;
    delete process.env.WRAP_HEADS;
    delete process.env.WRAP_BASES;
    delete process.env.WRAP_URLS;
    delete process.env.WRAP_STATE;
  }
}

test("wrap-up removes merged remote branch, worktree, local branch, and run state", async () => {
  const fixture = await createFixture();

  const result = await withProvider(fixture.acceptedCommit, "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false));

  assert.equal(result.kind, "completed");
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), undefined);
  assert.equal(await branchExists(fixture.repository.root, fixture.branchName), false);
  await assert.rejects(access(fixture.worktreePath), /ENOENT/);
  await assert.rejects(access(fixture.runDirectory), /ENOENT/);
  await assert.rejects(access(join(fixture.repository.root, ".autopilot", "handoffs", `${fixture.runId}.json`)), /ENOENT/);
});

test("wrap-up reconciles a legacy lease worktree at a merged fast-forward descendant", async () => {
  const fixture = await createFixture("legacy-run");
  const legacyWorktree = join(fixture.stateRoot, "worktrees", fixture.runId, fixture.itemId);
  await mkdir(join(legacyWorktree, ".."), { recursive: true });
  await runChecked({
    executable: "git",
    arguments: ["worktree", "move", fixture.worktreePath, legacyWorktree],
    cwd: fixture.repository.root,
  });
  await mkdir(join(fixture.runDirectory, "leases"), { recursive: true });
  await writeFile(join(fixture.runDirectory, "leases", `${fixture.itemId}.json`), `${JSON.stringify({
    itemId: fixture.itemId,
    branchName: fixture.branchName,
    worktreePath: legacyWorktree,
    epoch: 1,
    attemptId: "legacy-attempt",
    expiresAt: "2026-08-22T00:00:00.000Z",
  }, null, 2)}\n`);
  await writeFile(join(legacyWorktree, "legacy-review.txt"), "reviewed\n");
  await runChecked({ executable: "git", arguments: ["add", "legacy-review.txt"], cwd: legacyWorktree });
  await runChecked({ executable: "git", arguments: ["commit", "-m", "legacy review update"], cwd: legacyWorktree });
  const mergedHead = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: legacyWorktree })).stdout.trim();
  await runChecked({ executable: "git", arguments: ["push", "origin", fixture.branchName], cwd: legacyWorktree });

  const result = await withProvider(mergedHead, "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false));

  assert.equal(result.kind, "completed");
  assert.deepEqual(result.removedWorktrees, [legacyWorktree]);
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), undefined);
  assert.equal(await branchExists(fixture.repository.root, fixture.branchName), false);
  await assert.rejects(access(legacyWorktree), /ENOENT/);
  await assert.rejects(access(fixture.runDirectory), /ENOENT/);
});

test("wrap-up supports GitLab merged-state verification", async () => {
  const fixture = await createFixture("gitlab-run", "gitlab");

  const result = await withProvider(fixture.acceptedCommit, "merged",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false));

  assert.equal(result.kind, "completed");
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), undefined);
});

test("wrap-up refuses an open change request without mutating Git or state", async () => {
  const fixture = await createFixture("open-run");

  await assert.rejects(
    withProvider(fixture.acceptedCommit, "OPEN", async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false)),
    /not merged at the accepted head/,
  );

  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), fixture.acceptedCommit);
  assert.equal(await branchExists(fixture.repository.root, fixture.branchName), true);
  await access(fixture.worktreePath);
  await access(fixture.runDirectory);
});

test("wrap-up verifies the exact recorded change-request identity", async () => {
  const fixture = await createFixture("identity-run");

  await assert.rejects(
    withProvider(fixture.acceptedCommit, "MERGED",
      async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false),
      { urls: { "17": "https://other.example.invalid/pull/17" } }),
    /not merged at the accepted head/,
  );

  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), fixture.acceptedCommit);
});

test("wrap-up refuses a dirty retained worktree before deleting the remote branch", async () => {
  const fixture = await createFixture("dirty-run");
  await writeFile(join(fixture.worktreePath, "dirty.txt"), "dirty\n");

  await assert.rejects(
    withProvider(fixture.acceptedCommit, "MERGED", async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false)),
    /dirty or changed/,
  );

  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), fixture.acceptedCommit);
  await access(fixture.runDirectory);
});

test("multi-item wrap-up completes no deletion when any item fails preflight", async () => {
  const fixture = await createMultiFixture();
  const secondWorktree = fixture.worktrees[1];
  if (secondWorktree === undefined) {
    throw new Error("expected second worktree");
  }
  await writeFile(join(secondWorktree, "dirty.txt"), "dirty\n");

  await assert.rejects(
    withProvider({ "17": fixture.commits[0] ?? "", "18": fixture.commits[1] ?? "" }, "MERGED",
      async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false)),
    /dirty or changed/,
  );

  for (const [index, branch] of fixture.branches.entries()) {
    assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", branch), fixture.commits[index]);
    assert.equal(await branchExists(fixture.repository.root, branch), true);
  }
});

test("ordered-stack wrap-up verifies each item against its topology base", async () => {
  const fixture = await createMultiFixture("ordered-stack");
  const firstBranch = fixture.branches[0];
  if (firstBranch === undefined) {
    throw new Error("expected stack root branch");
  }

  const result = await withProvider(
    { "17": fixture.commits[0] ?? "", "18": fixture.commits[1] ?? "" },
    "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false),
    { bases: { "17": "main", "18": firstBranch } },
  );

  assert.equal(result.kind, "completed");
  for (const branch of fixture.branches) {
    assert.equal(await branchExists(fixture.repository.root, branch), false);
  }
});

test("merge-verified ordered-stack wrap-up expects the configured target base", async () => {
  const fixture = await createMultiFixture("ordered-stack", "merge-verified");

  const result = await withProvider(
    { "17": fixture.commits[0] ?? "", "18": fixture.commits[1] ?? "" },
    "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false),
    { bases: { "17": "main", "18": "main" } },
  );

  assert.equal(result.kind, "completed");
});

test("wrap-up writes optional project handoff files before deleting state", async () => {
  const fixture = await createFixture("handoff-run");

  const result = await withProvider(fixture.acceptedCommit, "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, true));

  const jsonPath = join(fixture.repository.root, ".autopilot", "handoffs", `${fixture.runId}.json`);
  const markdownPath = join(fixture.repository.root, ".autopilot", "handoffs", `${fixture.runId}.md`);
  const handoff: unknown = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(result.handoffPaths.length, 2);
  assert.match(await readFile(markdownPath, "utf8"), /remote branches, sibling worktrees, local branches/);
  assert.equal((handoff as { runId?: unknown }).runId, fixture.runId);
  await assert.rejects(access(fixture.runDirectory), /ENOENT/);
});

test("wrap-up removes the complete successful amendment state chain", async () => {
  const predecessor = await createFixture("predecessor-run");
  const successor = await addSuccessfulAmendment(predecessor, "successor-run");

  await assert.rejects(
    withProvider(predecessor.acceptedCommit, "MERGED",
      async () => await wrapUpRun(predecessor.stateRoot, predecessor.runId, false)),
    /retained amendment successor/,
  );
  const result = await withProvider(successor.acceptedCommit, "MERGED",
    async () => await wrapUpRun(successor.stateRoot, successor.runId, false));

  assert.deepEqual(result.deletedRunIds, ["successor-run", "predecessor-run"]);
  await assert.rejects(access(successor.runDirectory), /ENOENT/);
  await assert.rejects(access(predecessor.runDirectory), /ENOENT/);
});

test("corrupt retained successor blocks predecessor discovery and explicit cleanup", async () => {
  const predecessor = await createFixture("corrupt-predecessor");
  const successor = await addSuccessfulAmendment(predecessor, "corrupt-successor");
  await writeFile(join(successor.runDirectory, "events.jsonl"), "{broken\n");

  const discovery = await discoverWrapUpRuns(predecessor.stateRoot, predecessor.repository.root);

  assert.equal(discovery.candidates.length, 0);
  assert.ok(discovery.corrupt.some(({ name }) => name === successor.runId));
  await assert.rejects(
    wrapUpRun(predecessor.stateRoot, predecessor.runId, false),
    /corrupt retained run state/,
  );
  await access(predecessor.worktreePath);
});

test("wrap-up resumes after a predecessor state directory was already removed", async () => {
  const predecessor = await createFixture("resume-predecessor");
  const successor = await addSuccessfulAmendment(predecessor, "resume-successor");
  await appendEvent(join(successor.runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "operator",
    reason: "fault injection after wrap-up preflight",
    type: "WRAP_UP_STARTED",
    chainRunIds: [successor.runId, predecessor.runId],
    handoff: false,
  });
  await rm(predecessor.runDirectory, { recursive: true });

  const result = await withProvider(successor.acceptedCommit, "MERGED",
    async () => await wrapUpRun(successor.stateRoot, successor.runId, false));

  assert.deepEqual(result.deletedRunIds, [successor.runId, predecessor.runId]);
  await assert.rejects(access(successor.runDirectory), /ENOENT/);
});

test("wrap-up reloads terminal state after an interrupted confirmed cleanup effect", async () => {
  const fixture = await createFixture("resume-effect-run");
  await appendEvent(join(fixture.runDirectory, "events.jsonl"), {
    eventId: newEventId(), timestamp: new Date().toISOString(), source: "operator", reason: "fault injection",
    type: "WRAP_UP_STARTED", chainRunIds: [fixture.runId], handoff: false,
  });
  await appendEvent(join(fixture.runDirectory, "events.jsonl"), {
    eventId: newEventId(), timestamp: new Date().toISOString(), source: "operator", reason: "fault injection",
    type: "EFFECT_INTENDED", itemId: fixture.itemId, effect: "remote.branch.delete",
    idempotencyKey: "interrupted-delete", expectedState: fixture.acceptedCommit,
  });
  await runChecked({
    executable: "git",
    arguments: ["push", "origin", `:refs/heads/${fixture.branchName}`],
    cwd: fixture.repository.root,
  });
  await appendEvent(join(fixture.runDirectory, "events.jsonl"), {
    eventId: newEventId(), timestamp: new Date().toISOString(), source: "operator", reason: "fault injection",
    type: "EFFECT_CONFIRMED", itemId: fixture.itemId, effect: "remote.branch.delete",
    idempotencyKey: "interrupted-delete", observedState: "absent",
  });

  const result = await withProvider(fixture.acceptedCommit, "MERGED",
    async () => await wrapUpRun(fixture.stateRoot, fixture.runId, false));

  assert.equal(result.kind, "completed");
  await assert.rejects(access(fixture.runDirectory), /ENOENT/);
});

test("compiled CLI auto-selects one zero-argument wrap-up candidate", async () => {
  const fixture = await createFixture("cli-auto-run");
  const bin = await installFakeProvider();
  const cli = join(process.cwd(), "dist", "src", "cli.js");

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cli, "--state-dir", fixture.stateRoot, "--json", "wrap-up"],
    cwd: fixture.repository.root,
    environment: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      WRAP_HEAD: fixture.acceptedCommit,
      WRAP_STATE: "MERGED",
    },
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const output: unknown = JSON.parse(result.stdout);
  assert.equal((output as { runId?: unknown }).runId, fixture.runId);
  await assert.rejects(access(fixture.runDirectory), /ENOENT/);
});

test("discovery removes only validated interrupted wrap-up trash", async () => {
  const fixture = await createFixture("trash-run");
  const trash = join(fixture.stateRoot, "wrap-up-trash", "old-run.12345678-1234-1234-1234-123456789abc");
  await mkdir(trash, { recursive: true });
  await writeFile(join(trash, "partial"), "partial\n");

  const discovery = await discoverWrapUpRuns(fixture.stateRoot, fixture.repository.root);

  assert.deepEqual(discovery.candidates.map(({ runId }) => runId), [fixture.runId]);
  await assert.rejects(access(trash), /ENOENT/);
});

test("zero-argument discovery resolves one leaf and lists multiple candidates", async () => {
  const first = await createFixture("first-run");

  const single = await discoverWrapUpRuns(first.stateRoot, first.repository.root);

  assert.deepEqual(single.candidates.map(({ runId }) => runId), ["first-run"]);
  await addSuccessfulRun(first.repository, first.stateRoot, first.remote, "second-run");

  const multiple = await discoverWrapUpRuns(first.stateRoot, first.repository.root);

  assert.deepEqual(multiple.candidates.map(({ runId }) => runId), ["first-run", "second-run"]);
});
