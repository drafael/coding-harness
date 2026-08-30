import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import type {
  CancelResult,
  CapabilityManifest,
  ExecutionHandle,
  ExecutionObservation,
  ExecutionRequest,
  HarnessPort,
} from "../src/adapter-protocol.js";
import { loadAmendmentContext } from "../src/amendment.js";
import { sealCharter } from "../src/charter.js";
import { reviewThreadDigest, type ReviewThread } from "../src/delivery.js";
import { AutopilotEngine } from "../src/engine.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, readJournal, writeImmutableJson } from "../src/journal.js";
import { acquireWriterLease } from "../src/leases.js";
import { rebuildProjection } from "../src/projection.js";
import {
  commitAcceptedWork,
  observeRepository,
  pushAmendmentBranch,
  resolveWorktreePath,
  remoteBranchCommit,
} from "../src/repository.js";
import { runChecked, runProcess } from "../src/process.js";
import { createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

type EventInput<T> = T extends LifecycleEvent
  ? Omit<T, "eventId" | "timestamp" | "source" | "reason">
  : never;

function event(value: EventInput<LifecycleEvent>): LifecycleEvent {
  return {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "test fixture",
    ...value,
  } as LifecycleEvent;
}

class AmendmentAdapter implements HarnessPort {
  #launches = 0;

  async describe(): Promise<CapabilityManifest> {
    return {
      protocolVersion: 1,
      adapterName: "amendment-test",
      adapterVersion: "1",
      harnessVersion: "1",
      families: ["files.read", "files.write", "process.execute", "network.access", "credentials.use"],
      assurance: "cooperative",
      unattended: true,
      maxConcurrency: 1,
      eventStreaming: true,
      cancellation: true,
      restartReattachment: false,
      restrictions: "cooperative",
      limitations: [],
    };
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    this.#launches += 1;
    await writeFile(join(request.worktreePath, "result.txt"), `done\namended ${this.#launches}\n`);
    return { protocolVersion: 1, adapterExecutionId: request.attemptId, startedAt: new Date().toISOString() };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.adapterExecutionId,
      status: "completed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
      stdout: "",
      stderr: "",
      truncated: false,
    };
  }

  async cancel(_handle: ExecutionHandle): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: true };
  }
}

async function amendmentFixture() {
  const createdRepository = await createRepository();
  const repository = { ...createdRepository, root: await realpath(createdRepository.root) };
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-amendment-state-")));
  const remote = await mkdtemp(join(tmpdir(), "autopilot-amendment-remote-"));
  await runChecked({ executable: "git", arguments: ["init", "--bare"], cwd: remote });
  await runChecked({ executable: "git", arguments: ["remote", "add", "origin", remote], cwd: repository.root });
  const runId = "original-run";
  const itemId = "item-1";
  const branchName = "autopilot/original/item-1";
  const proposed = proposedCharter(repository.root, repository.baseCommit, "single", runId);
  const predecessor = sealCharter({
    ...proposed,
    work: [{ ...proposed.work[0], branchName }],
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [...proposed.grants, { family: "remote.push", actor: "runtime", remotes: ["origin"] }, {
      family: "change-request.open",
      actor: "delivery",
    }],
  });
  const predecessorItem = predecessor.work[0];
  if (predecessorItem === undefined) {
    throw new Error("expected predecessor item");
  }
  const worktreePath = await resolveWorktreePath(predecessor, predecessorItem);
  await runChecked({
    executable: "git",
    arguments: ["worktree", "add", "-b", branchName, worktreePath, repository.baseCommit],
    cwd: repository.root,
  });
  await writeFile(join(worktreePath, "result.txt"), "done\n");
  await runChecked({ executable: "git", arguments: ["add", "result.txt"], cwd: worktreePath });
  await runChecked({
    executable: "git",
    arguments: ["commit", "--no-verify", "-m", `accepted\n\nAutopilot-Run: ${runId}\nAutopilot-Item: ${itemId}`],
    cwd: worktreePath,
  });
  const acceptedCommit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: worktreePath })).stdout.trim();
  await runChecked({ executable: "git", arguments: ["push", "origin", `${branchName}:${branchName}`], cwd: worktreePath });
  const runDirectory = join(stateRoot, "runs", runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), predecessor);
  const attemptId = "attempt-1";
  const events: LifecycleEvent[] = [
    event({ type: "CHARTER_COMPILED" }),
    event({ type: "RECONCILIATION_STARTED" }),
    event({ type: "RECONCILIATION_COMPLETED" }),
    event({ type: "ITEM_READY", itemId }),
    event({
      type: "ATTEMPT_STARTED",
      itemId,
      attemptId,
      leaseEpoch: 1,
      expectedBaseCommit: repository.baseCommit,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "attempt-key",
    }),
    event({ type: "ATTEMPT_FINISHED", itemId, attemptId, observedHeadCommit: repository.baseCommit, outcome: "completed" }),
    event({ type: "ITEM_VERIFYING", itemId, attemptId }),
    event({ type: "EFFECT_CONFIRMED", itemId, effect: "git.commit", idempotencyKey: "commit-key", observedState: acceptedCommit }),
    event({ type: "EFFECT_CONFIRMED", itemId, effect: "remote.push", idempotencyKey: "push-key", observedState: acceptedCommit }),
    event({
      type: "EFFECT_CONFIRMED",
      itemId,
      effect: "change-request.open",
      idempotencyKey: "change-request-key",
      observedState: "https://github.example.test/owner/repository/pull/69",
    }),
    event({ type: "ITEM_SATISFIED", itemId, attemptId, subject: "tree:accepted" }),
    event({ type: "RUN_VERIFYING" }),
    event({ type: "RUN_SUCCEEDED", predicateSummary: "satisfied" }),
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(join(runDirectory, "events.jsonl"), lifecycleEvent);
  }
  const successorBase = proposedCharter(repository.root, acceptedCommit, "single", "successor-run");
  const successor = sealCharter({
    ...successorBase,
    repository: { ...successorBase.repository, baseRef: branchName, baseCommit: acceptedCommit },
    work: [{ ...successorBase.work[0], branchName }],
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    predecessorRunId: runId,
    amends: { runId, itemId },
    grants: [
      ...successorBase.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "network.access", actor: "runtime" },
      { family: "credentials.use", actor: "runtime" },
      { family: "network.access", actor: "delivery" },
      { family: "credentials.use", actor: "delivery" },
      { family: "change-request.update", actor: "delivery" },
    ],
  });
  return { acceptedCommit, branchName, remote, repository, stateRoot, successor, worktreePath };
}

test("loadAmendmentContext adopts only the clean exact predecessor worktree", async () => {
  const fixture = await amendmentFixture();

  const context = await loadAmendmentContext(fixture.stateRoot, fixture.successor);

  assert.equal(context?.acceptedCommit, fixture.acceptedCommit);
  assert.equal(context?.worktreePath, fixture.worktreePath);
  assert.equal(context?.changeRequest.id, "69");

  await writeFile(join(fixture.worktreePath, "untracked.txt"), "manual\n");

  await assert.rejects(loadAmendmentContext(fixture.stateRoot, fixture.successor), /changed after completion/);
});

test("amendment context rejects a foreign clone replacing the retained sibling", async () => {
  const fixture = await amendmentFixture();
  await runChecked({
    executable: "git",
    arguments: ["worktree", "remove", fixture.worktreePath],
    cwd: fixture.repository.root,
  });
  await rm(fixture.worktreePath, { recursive: true, force: true });
  await runChecked({
    executable: "git",
    arguments: ["clone", fixture.repository.root, fixture.worktreePath],
    cwd: fixture.repository.root,
  });
  await runChecked({
    executable: "git",
    arguments: ["checkout", "-b", fixture.branchName, fixture.acceptedCommit],
    cwd: fixture.worktreePath,
  });

  await assert.rejects(
    loadAmendmentContext(fixture.stateRoot, fixture.successor),
    /not registered to the charter repository/,
  );
});

test("amendment context reconciles a runtime commit interrupted before journal confirmation", async () => {
  const fixture = await amendmentFixture();
  await writeFile(join(fixture.worktreePath, "result.txt"), "done\ninterrupted commit\n");
  const observation = await observeRepository(fixture.worktreePath);
  const runDirectory = join(fixture.stateRoot, "runs", fixture.successor.runId);
  await mkdir(runDirectory, { recursive: true });
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, event({
    type: "WORKTREE_ADOPTED",
    itemId: "item-1",
    predecessorRunId: "original-run",
    predecessorItemId: "item-1",
    worktreePath: fixture.worktreePath,
    branchName: fixture.branchName,
    acceptedCommit: fixture.acceptedCommit,
    changeRequestUrl: "https://github.example.test/owner/repository/pull/69",
  }));
  const idempotencyKey = "interrupted-commit";
  await appendEvent(journalPath, event({
    type: "EFFECT_INTENDED",
    itemId: "item-1",
    attemptId: "attempt-interrupted",
    effect: "git.commit",
    idempotencyKey,
    expectedState: observation.treeIdentity,
  }));
  const item = fixture.successor.work[0];
  if (item === undefined) {
    throw new Error("expected successor item");
  }
  const commit = await commitAcceptedWork(
    fixture.worktreePath,
    fixture.successor,
    item,
    "attempt-interrupted",
    observation.treeIdentity,
    observation.headCommit,
  );
  const journal = await readJournal(journalPath);

  const context = await loadAmendmentContext(fixture.stateRoot, fixture.successor, journal.records);

  assert.deepEqual(context?.reconciledCommit, {
    idempotencyKey,
    commit,
    treeIdentity: observation.treeIdentity,
    attemptId: "attempt-interrupted",
  });
});

test("CLI rejects a dirty amendment before creating successor state", async () => {
  const fixture = await amendmentFixture();
  await writeFile(join(fixture.worktreePath, "manual.txt"), "unmanaged\n");
  const charterPath = join(await mkdtemp(join(tmpdir(), "autopilot-amendment-charter-")), "charter.json");
  const { charterHash, ...proposed } = fixture.successor;
  assert.ok(charterHash.length > 0);
  await writeFile(charterPath, JSON.stringify(proposed));

  const result = await runProcess({
    executable: process.execPath,
    arguments: [join(process.cwd(), "dist", "src", "cli.js"), "--json", "--state-dir", fixture.stateRoot, "start", charterPath],
    cwd: fixture.repository.root,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /changed after completion/);
  await assert.rejects(readFile(join(fixture.stateRoot, "runs", fixture.successor.runId, "charter.json")), /ENOENT/);
});

test("engine adopts the predecessor worktree, updates its change request, and resolves sealed review feedback", async () => {
  const fixture = await amendmentFixture();
  const reviewUrl = "https://github.example.test/owner/repository/pull/69#discussion_r1";
  const reviewThread: ReviewThread = {
    id: "thread-1",
    resolved: false,
    outdated: false,
    resolvable: true,
    path: "result.txt",
    line: 1,
    comments: [{
      id: "comment-1",
      author: "reviewer",
      body: "Update the result",
      url: reviewUrl,
      createdAt: "2026-08-23T00:00:00Z",
    }],
  };
  const nonResolvableUrl = "https://github.example.test/owner/repository/pull/69#issuecomment-2";
  const nonResolvableFeedback: ReviewThread = {
    id: "issue-comment:2",
    resolved: false,
    outdated: false,
    resolvable: false,
    comments: [{
      id: "2",
      author: "reviewer",
      body: "Keep the public behavior documented",
      url: nonResolvableUrl,
      createdAt: "2026-08-23T00:01:00Z",
    }],
  };
  const { charterHash: _charterHash, ...successorProposal } = fixture.successor;
  const successor = sealCharter({
    ...successorProposal,
    reviewFeedback: {
      observedHeadCommit: fixture.acceptedCommit,
      threads: [
        { threadId: reviewThread.id, contentHash: reviewThreadDigest(reviewThread), url: reviewUrl, resolve: true },
        {
          threadId: nonResolvableFeedback.id,
          contentHash: reviewThreadDigest(nonResolvableFeedback),
          url: nonResolvableUrl,
          resolve: false,
        },
      ],
    },
    grants: [...successorProposal.grants, { family: "review-thread.resolve", actor: "delivery" }],
  });
  const predecessorJournal = join(fixture.stateRoot, "runs", "original-run", "events.jsonl");
  const predecessorBefore = await readFile(predecessorJournal, "utf8");
  const runDirectory = join(fixture.stateRoot, "runs", fixture.successor.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await mkdir(join(runDirectory, "reports"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), successor);
  await appendEvent(join(runDirectory, "events.jsonl"), event({ type: "CHARTER_COMPILED" }));
  const journal = await readJournal(join(runDirectory, "events.jsonl"));
  const bin = await mkdtemp(join(tmpdir(), "autopilot-fake-gh-"));
  await writeNodeExecutable(bin, "gh", `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("gh version test"); process.exit(0); }
if (args[0] === "pr" && args[1] === "list") { process.exit(3); }
if (args[0] === "repo" && args[1] === "view") { console.log(JSON.stringify({nameWithOwner:"owner/repository"})); process.exit(0); }
if (args[0] === "api" && args[1] === "graphql") {
  const resolvedMarker = process.env.AUTOPILOT_GH_RESOLVED;
  if (args.join(" ").includes("resolveReviewThread")) {
    writeFileSync(resolvedMarker, "resolved\\n");
    console.log(JSON.stringify({data:{resolveReviewThread:{thread:{id:"thread-1",isResolved:true}}}})); process.exit(0);
  }
  console.log(JSON.stringify({data:{repository:{pullRequest:{reviewThreads:{nodes:[{
    id:"thread-1",isResolved:existsSync(resolvedMarker),isOutdated:false,path:"result.txt",line:1,
    comments:{nodes:[{id:"comment-1",author:{login:"reviewer"},body:"Update the result",url:"https://github.example.test/owner/repository/pull/69#discussion_r1",createdAt:"2026-08-23T00:00:00Z"}],pageInfo:{hasNextPage:false}}
  }],pageInfo:{hasNextPage:false,endCursor:null}}}}}})); process.exit(0);
}
if (args[0] === "api" && args[1].includes("/issues/")) {
  console.log(JSON.stringify([{id:2,user:{login:"reviewer"},body:"Keep the public behavior documented",html_url:"https://github.example.test/owner/repository/pull/69#issuecomment-2",created_at:"2026-08-23T00:01:00Z"}])); process.exit(0);
}
if (args[0] === "api") { console.log("[]"); process.exit(0); }
if (args[0] === "pr" && args[1] === "view") {
  const result = spawnSync("git", ["ls-remote", "origin", "refs/heads/autopilot/original/item-1"], {encoding:"utf8"});
  const head = result.stdout.trim().split(/\\s+/)[0];
  const marker = process.env.AUTOPILOT_GH_FAIL_ONCE;
  if (marker && head !== process.env.AUTOPILOT_GH_PREDECESSOR && !existsSync(marker)) {
    writeFileSync(marker, "failed once\\n"); process.exit(2);
  }
  console.log(JSON.stringify({number:69,url:"https://github.example.test/owner/repository/pull/69",state:"OPEN",headRefOid:head,baseRefName:"main",reviewDecision:""}));
  process.exit(0);
}
console.error(JSON.stringify(args)); process.exit(2);
`);
  const previousPath = process.env.PATH;
  const previousFailureMarker = process.env.AUTOPILOT_GH_FAIL_ONCE;
  const previousPredecessor = process.env.AUTOPILOT_GH_PREDECESSOR;
  const previousResolved = process.env.AUTOPILOT_GH_RESOLVED;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.AUTOPILOT_GH_FAIL_ONCE = join(bin, "failed-once");
  process.env.AUTOPILOT_GH_PREDECESSOR = fixture.acceptedCommit;
  process.env.AUTOPILOT_GH_RESOLVED = join(bin, "resolved");
  try {
    const engine = new AutopilotEngine({
      stateRoot: fixture.stateRoot,
      runDirectory,
      charter: successor,
      adapter: new AmendmentAdapter(),
      records: journal.records,
      projection: rebuildProjection(successor, journal.records),
    });

    const report = await engine.run();
    const successorJournal = await readJournal(join(runDirectory, "events.jsonl"));

    assert.equal(report.state, "SUCCEEDED");
    assert.equal(report.items[0]?.attempts, 2);
    assert.equal(report.worktrees[0]?.path, fixture.worktreePath);
    assert.ok(successorJournal.records.some(({ event: lifecycleEvent }) => lifecycleEvent.type === "WORKTREE_ADOPTED"));
    assert.ok(successorJournal.records.some(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "EFFECT_CONFIRMED" && lifecycleEvent.effect === "change-request.update"
    ));
    assert.ok(successorJournal.records.some(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "EFFECT_CONFIRMED" && lifecycleEvent.effect === "review-thread.resolve"
    ));
    assert.equal(await readFile(predecessorJournal, "utf8"), predecessorBefore);

    const latestCommit = await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName);
    assert.notEqual(latestCommit, undefined);
    if (latestCommit === undefined) {
      throw new Error("expected amended remote commit");
    }
    const nextBase = proposedCharter(fixture.repository.root, latestCommit, "single", "next-successor");
    const nextSuccessor = sealCharter({
      ...nextBase,
      repository: { ...nextBase.repository, baseRef: fixture.branchName, baseCommit: latestCommit },
      work: [{ ...nextBase.work[0], branchName: fixture.branchName }],
      delivery: "change-request-ready",
      deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
      predecessorRunId: successor.runId,
      amends: { runId: successor.runId, itemId: "item-1" },
      grants: successor.grants,
    });
    const nextContext = await loadAmendmentContext(fixture.stateRoot, nextSuccessor);
    assert.equal(nextContext?.worktreePath, fixture.worktreePath);
    const nextDirectory = join(fixture.stateRoot, "runs", nextSuccessor.runId);
    await mkdir(join(nextDirectory, "receipts"), { recursive: true });
    await mkdir(join(nextDirectory, "reports"), { recursive: true });
    await writeImmutableJson(join(nextDirectory, "charter.json"), nextSuccessor);
    await appendEvent(join(nextDirectory, "events.jsonl"), event({ type: "CHARTER_COMPILED" }));
    const nextJournal = await readJournal(join(nextDirectory, "events.jsonl"));
    const nextEngine = new AutopilotEngine({
      stateRoot: fixture.stateRoot,
      runDirectory: nextDirectory,
      charter: nextSuccessor,
      adapter: new AmendmentAdapter(),
      records: nextJournal.records,
      projection: rebuildProjection(nextSuccessor, nextJournal.records),
    });

    const nextReport = await nextEngine.run();

    assert.equal(nextReport.state, "SUCCEEDED");
    assert.equal(nextReport.worktrees[0]?.path, fixture.worktreePath);

    const finalBaseCommit = await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName);
    if (finalBaseCommit === undefined) {
      throw new Error("expected second amendment remote commit");
    }
    const finalBase = proposedCharter(fixture.repository.root, finalBaseCommit, "single", "final-successor");
    const finalSuccessor = sealCharter({
      ...finalBase,
      repository: { ...finalBase.repository, baseRef: fixture.branchName, baseCommit: finalBaseCommit },
      work: [{ ...finalBase.work[0], branchName: fixture.branchName }],
      delivery: "change-request-ready",
      deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
      predecessorRunId: nextSuccessor.runId,
      amends: { runId: nextSuccessor.runId, itemId: "item-1" },
      grants: successor.grants,
      limits: { ...finalBase.limits, maxAttemptsPerItem: 1 },
    });
    const finalDirectory = join(fixture.stateRoot, "runs", finalSuccessor.runId);
    await mkdir(join(finalDirectory, "receipts"), { recursive: true });
    await mkdir(join(finalDirectory, "reports"), { recursive: true });
    await writeImmutableJson(join(finalDirectory, "charter.json"), finalSuccessor);
    const finalAttempt = "final-attempt";
    const beforeInterruptedCommit = await observeRepository(fixture.worktreePath);
    await writeFile(join(fixture.worktreePath, "result.txt"), "done\nreconciled final attempt\n");
    const interruptedTree = await observeRepository(fixture.worktreePath);
    const finalEvents: LifecycleEvent[] = [
      event({ type: "CHARTER_COMPILED" }),
      event({ type: "RECONCILIATION_STARTED" }),
      event({ type: "RECONCILIATION_COMPLETED" }),
      event({ type: "WORKTREE_ADOPTED", itemId: "item-1", predecessorRunId: nextSuccessor.runId,
        predecessorItemId: "item-1", worktreePath: fixture.worktreePath, branchName: fixture.branchName,
        acceptedCommit: finalBaseCommit, changeRequestUrl: "https://github.example.test/owner/repository/pull/69" }),
      event({ type: "ITEM_READY", itemId: "item-1" }),
      event({ type: "ATTEMPT_STARTED", itemId: "item-1", attemptId: finalAttempt, leaseEpoch: 1,
        expectedBaseCommit: beforeInterruptedCommit.headCommit,
        expectedRefIdentity: beforeInterruptedCommit.auxiliaryRefIdentity,
        expectedConfigurationIdentity: beforeInterruptedCommit.configurationIdentity,
        deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "final-attempt-key" }),
      event({ type: "ATTEMPT_FINISHED", itemId: "item-1", attemptId: finalAttempt,
        observedHeadCommit: beforeInterruptedCommit.headCommit, outcome: "completed" }),
      event({ type: "ITEM_VERIFYING", itemId: "item-1", attemptId: finalAttempt }),
      event({ type: "EFFECT_INTENDED", itemId: "item-1", attemptId: finalAttempt, effect: "git.commit",
        idempotencyKey: "final-commit-key", expectedState: interruptedTree.treeIdentity }),
    ];
    for (const lifecycleEvent of finalEvents) {
      await appendEvent(join(finalDirectory, "events.jsonl"), lifecycleEvent);
    }
    const finalItem = finalSuccessor.work[0];
    if (finalItem === undefined) {
      throw new Error("expected final successor item");
    }
    await commitAcceptedWork(fixture.worktreePath, finalSuccessor, finalItem, finalAttempt,
      interruptedTree.treeIdentity, interruptedTree.headCommit);
    await acquireWriterLease(
      finalDirectory,
      "item-1",
      fixture.branchName,
      fixture.worktreePath,
      finalAttempt,
      finalSuccessor.limits.attemptTimeoutMs,
    );
    const finalJournal = await readJournal(join(finalDirectory, "events.jsonl"));
    const finalEngine = new AutopilotEngine({
      stateRoot: fixture.stateRoot,
      runDirectory: finalDirectory,
      charter: finalSuccessor,
      adapter: new AmendmentAdapter(),
      records: finalJournal.records,
      projection: rebuildProjection(finalSuccessor, finalJournal.records),
    });

    const finalReport = await finalEngine.run();

    assert.equal(finalReport.state, "SUCCEEDED");
    assert.equal(finalReport.items[0]?.attempts, 1);
  } finally {
    process.env.PATH = previousPath;
    if (previousFailureMarker === undefined) {
      delete process.env.AUTOPILOT_GH_FAIL_ONCE;
    } else {
      process.env.AUTOPILOT_GH_FAIL_ONCE = previousFailureMarker;
    }
    if (previousPredecessor === undefined) {
      delete process.env.AUTOPILOT_GH_PREDECESSOR;
    } else {
      process.env.AUTOPILOT_GH_PREDECESSOR = previousPredecessor;
    }
    if (previousResolved === undefined) {
      delete process.env.AUTOPILOT_GH_RESOLVED;
    } else {
      process.env.AUTOPILOT_GH_RESOLVED = previousResolved;
    }
  }
});

test("pushAmendmentBranch updates an existing remote branch only by fast-forward", async () => {
  const fixture = await amendmentFixture();
  await writeFile(join(fixture.worktreePath, "result.txt"), "done\namended\n");
  await runChecked({ executable: "git", arguments: ["add", "result.txt"], cwd: fixture.worktreePath });
  await runChecked({ executable: "git", arguments: ["commit", "--no-verify", "-m", "amend"], cwd: fixture.worktreePath });
  const amendedCommit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: fixture.worktreePath })).stdout.trim();

  await assert.rejects(
    pushAmendmentBranch(
      fixture.worktreePath,
      "origin",
      fixture.branchName,
      fixture.acceptedCommit,
      amendedCommit,
      () => {
        throw new Error("push fenced");
      },
    ),
    /push fenced/,
  );
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), fixture.acceptedCommit);

  const observed = await pushAmendmentBranch(
    fixture.worktreePath,
    "origin",
    fixture.branchName,
    fixture.acceptedCommit,
    amendedCommit,
  );

  assert.equal(observed, amendedCommit);
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), amendedCommit);

  await writeFile(join(fixture.worktreePath, "result.txt"), "done\namended again\n");
  await runChecked({ executable: "git", arguments: ["add", "result.txt"], cwd: fixture.worktreePath });
  await runChecked({ executable: "git", arguments: ["commit", "--no-verify", "-m", "amend again"], cwd: fixture.worktreePath });
  const nextCommit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: fixture.worktreePath })).stdout.trim();

  await assert.rejects(
    pushAmendmentBranch(fixture.worktreePath, "origin", fixture.branchName, fixture.acceptedCommit, nextCommit),
    /changed from/,
  );
  assert.equal(await remoteBranchCommit(fixture.repository.root, "origin", fixture.branchName), amendedCommit);
});
