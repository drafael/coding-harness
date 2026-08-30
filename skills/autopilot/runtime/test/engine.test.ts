import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import type {
  CancelResult,
  CapabilityManifest,
  ExecutionHandle,
  ExecutionObservation,
  ExecutionRequest,
  HarnessPort,
} from "../src/adapter-protocol.js";
import { sealCharter } from "../src/charter.js";
import { AutopilotEngine } from "../src/engine.js";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal, writeImmutableJson } from "../src/journal.js";
import { buildAttemptContext, attemptContextHash } from "../src/attempt-context.js";
import { canonicalJson, isRecord, sha256 } from "../src/json.js";
import { rebuildProjection } from "../src/projection.js";
import { runChecked } from "../src/process.js";
import { observeRepository } from "../src/repository.js";
import { createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

function event(reason: string) {
  return { eventId: newEventId(), timestamp: new Date().toISOString(), source: "runtime" as const, reason };
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

class BlockingAdapter implements HarnessPort {
  cancelCalls = 0;
  readonly launched: Promise<void>;
  #resolveLaunched: (() => void) | undefined;
  #resolveObservation: ((observation: ExecutionObservation) => void) | undefined;
  #cancelledHandle: ExecutionHandle | undefined;

  constructor() {
    this.launched = new Promise((resolve) => {
      this.#resolveLaunched = resolve;
    });
  }

  async describe(): Promise<CapabilityManifest> {
    return {
      protocolVersion: 1,
      adapterName: "blocking-fake",
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
    this.#resolveLaunched?.();
    return { protocolVersion: 1, adapterExecutionId: request.attemptId, startedAt: new Date().toISOString() };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    if (this.#cancelledHandle?.adapterExecutionId === handle.adapterExecutionId) {
      return this.#cancelledObservation(handle);
    }
    return await new Promise((resolve) => {
      this.#resolveObservation = resolve;
    });
  }

  #cancelledObservation(handle: ExecutionHandle): ExecutionObservation {
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.adapterExecutionId,
      status: "cancelled",
      exitCode: 143,
      completedAt: new Date().toISOString(),
      stdout: "",
      stderr: "cancelled by operator",
      truncated: false,
    };
  }

  async cancel(handle: ExecutionHandle): Promise<CancelResult> {
    this.cancelCalls += 1;
    this.#cancelledHandle = handle;
    this.#resolveObservation?.(this.#cancelledObservation(handle));
    return { protocolVersion: 1, accepted: true };
  }
}

class FakeAdapter implements HarnessPort {
  readonly #requests = new Map<string, ExecutionRequest>();

  async describe(): Promise<CapabilityManifest> {
    return {
      protocolVersion: 1,
      adapterName: "fake",
      adapterVersion: "1",
      harnessVersion: "1",
      families: ["files.read", "files.write", "process.execute", "network.access", "credentials.use"],
      assurance: "cooperative",
      unattended: true,
      maxConcurrency: 2,
      eventStreaming: true,
      cancellation: true,
      restartReattachment: false,
      restrictions: "cooperative",
      limitations: [],
    };
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    this.#requests.set(request.attemptId, request);
    if (request.role === "review") {
      return { protocolVersion: 1, adapterExecutionId: request.attemptId, startedAt: new Date().toISOString() };
    }
    if (request.objective.includes("replace the configured pre-commit hook")) {
      const hooks = (await runChecked({
        executable: "git",
        arguments: ["config", "--get", "core.hooksPath"],
        cwd: request.worktreePath,
      })).stdout.trim();
      await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\ntouch hook-was-executed\n");
      await chmod(join(hooks, "pre-commit"), 0o755);
    }
    const file = request.itemId === "item-1"
      ? request.objective.includes("result.txt") ? "result.txt" : "one.txt"
      : "two.txt";
    await writeFile(join(request.worktreePath, file), "done\n");
    return { protocolVersion: 1, adapterExecutionId: request.attemptId, startedAt: new Date().toISOString() };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    const request = this.#requests.get(handle.adapterExecutionId);
    assert.ok(request !== undefined);
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.adapterExecutionId,
      status: "completed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
      stdout: "{}\n",
      stderr: "",
      truncated: false,
      ...(request.role === "review" ? { reviewResult: { verdict: "clean" as const, findings: [] } } : {}),
    };
  }

  async cancel(_handle: ExecutionHandle): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: true };
  }
}

class TrackingAdapter extends FakeAdapter {
  launches = 0;

  override async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    this.launches += 1;
    return await super.launch(request);
  }
}

class ReviewFindingsThenCleanAdapter extends FakeAdapter {
  readonly implementationContexts: ExecutionRequest["context"][] = [];
  readonly #reviewHandles = new Set<string>();
  #reviewCount = 0;

  override async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    const handle = await super.launch(request);
    if (request.role === "review") {
      this.#reviewHandles.add(handle.adapterExecutionId);
    } else {
      this.implementationContexts.push(request.context);
    }
    return handle;
  }

  override async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    const observation = await super.observe(handle);
    if (!this.#reviewHandles.delete(handle.adapterExecutionId)) {
      return observation;
    }
    this.#reviewCount += 1;
    return this.#reviewCount === 1
      ? {
          ...observation,
          reviewResult: {
            verdict: "findings",
            findings: [{ path: "result.txt", line: 1, severity: "major", message: "Review the generated value." }],
          },
        }
      : { ...observation, reviewResult: { verdict: "clean", findings: [] } };
  }
}

class MutatingReviewAdapter extends FakeAdapter {
  override async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    const handle = await super.launch(request);
    if (request.role === "review") {
      await writeFile(join(request.worktreePath, "reviewer-mutation.txt"), "not allowed\n");
    }
    return handle;
  }
}

async function runMode(
  mode: "single" | "independent-queue" | "ordered-stack",
  preCommitHook: false | "allowed" | "outside" | "ref" | "config" | "content" = false,
  gateConfig: false | "config" | "review" = false,
  adapter: HarnessPort = new FakeAdapter(),
) {
  const repository = await createRepository();
  if (preCommitHook !== false) {
    const hooks = await mkdtemp(join(tmpdir(), "autopilot-hooks-"));
    const hook = join(hooks, "pre-commit");
    const changedPath = preCommitHook === "allowed" ? "hook-output.txt" : "forbidden.txt";
    const script = preCommitHook === "ref"
      ? "#!/bin/sh\ngit branch hook-created-ref\n"
      : preCommitHook === "config"
        ? "#!/bin/sh\ngit config remote.origin.url https://attacker.invalid/repository.git\n"
        : preCommitHook === "content"
          ? "#!/bin/sh\nexit 0\n"
          : `#!/bin/sh\nprintf 'hooked\\n' >> ${changedPath}\ngit add ${changedPath}\n`;
    await writeFile(hook, script);
    await chmod(hook, 0o755);
    await runChecked({ executable: "git", arguments: ["config", "core.hooksPath", hooks], cwd: repository.root });
  }
  const proposed = proposedCharter(repository.root, repository.baseCommit, mode, `run-${mode}`);
  const charter = sealCharter({
    ...proposed,
    work: proposed.work.map((item) => ({
      ...item,
      ...(preCommitHook === "content" ? { objective: `${item.objective}; replace the configured pre-commit hook` } : {}),
      ...(gateConfig === "review"
        ? { acceptance: [...item.acceptance, { type: "gate-passed" as const, gateId: "independent-review" }] }
        : {}),
    })),
    limits: gateConfig === "review" ? { ...proposed.limits, maxReplans: 1 } : proposed.limits,
    grants: [
      ...proposed.grants,
      ...(preCommitHook === "allowed"
        ? [{ family: "files.write" as const, actor: "runtime" as const, paths: [join(repository.root, "hook-output.txt")] }]
        : []),
      ...(gateConfig === "config"
        ? [{ family: "process.execute" as const, actor: "runtime" as const, commands: ["git"] }]
        : []),
    ],
    gates: gateConfig === "config"
      ? [{ id: "result-search", type: "command", executable: "git", arguments: ["config", "remote.origin.url", "https://attacker.invalid"],
          workingDirectory: ".", environmentNames: [], appliesTo: ["item-1"] }]
      : gateConfig === "review"
        ? [...proposed.gates, { id: "independent-review", type: "review", focus: "Correctness defects", appliesTo: ["item-1"] }]
        : proposed.gates,
    commitPolicy: {
      preCommitHook: preCommitHook === false ? "skip" : "run",
      writableRoots: preCommitHook === "allowed" ? ["hook-output.txt"] : [],
      environmentNames: [],
    },
  });
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-state-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));
  const engine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter,
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
  });

  const report = await engine.run();
  return { repository, charter, report, runDirectory };
}

test("engine cancellation stops active work before verification or runtime effects", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "single", "run-stop-active"));
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-stop-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));
  const adapter = new BlockingAdapter();
  const engine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter,
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
  });

  const running = engine.run();
  await adapter.launched;
  await engine.requestStop();
  await engine.requestStop();
  const report = await running;
  const finalJournal = await readJournal(join(runDirectory, "events.jsonl"));

  assert.equal(report.state, "STOPPED");
  assert.equal(report.items[0]?.blocker, "OPERATOR_STOP");
  assert.equal(adapter.cancelCalls, 1);
  assert.equal(finalJournal.records.filter(({ event }) => event.type === "RUN_STOPPED").length, 1);
  assert.equal(finalJournal.records.some(({ event }) => event.type === "ITEM_VERIFYING"), false);
  assert.equal(finalJournal.records.some(({ event }) => event.type === "EFFECT_INTENDED"), false);
});

test("engine pauses only after cancellation quiesces and resumes with an uncharged replacement attempt", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "single", "run-pause-active"));
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-pause-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, { ...event("compiled"), type: "CHARTER_COMPILED" });
  const initialJournal = await readJournal(journalPath);
  const blockingAdapter = new BlockingAdapter();
  const firstEngine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter: blockingAdapter,
    records: initialJournal.records,
    projection: rebuildProjection(charter, initialJournal.records),
  });

  const running = firstEngine.run();
  await blockingAdapter.launched;
  await firstEngine.requestPause();
  const pausedReport = await running;
  const pausedJournal = await readJournal(journalPath);

  assert.equal(pausedReport.state, "WAITING");
  assert.equal(pausedReport.waiting?.kind, "operator-pause");
  assert.equal(pausedReport.items[0]?.attempts, 1);
  assert.equal(pausedReport.items[0]?.chargedAttempts, 0);
  assert.equal(blockingAdapter.cancelCalls, 1);
  assert.equal(pausedJournal.records.some(({ event: lifecycleEvent }) => lifecycleEvent.type === "ATTEMPT_PAUSED"), true);
  const leaseValue: unknown = JSON.parse(await readFile(join(runDirectory, "leases", "item-1.json"), "utf8"));
  assert.ok(isRecord(leaseValue));
  assert.equal(typeof leaseValue.retiredAt, "string");

  const resumeAdapter = new TrackingAdapter();
  const resumedEngine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter: resumeAdapter,
    records: pausedJournal.records,
    projection: rebuildProjection(charter, pausedJournal.records),
  });
  const resumedReport = await resumedEngine.run();

  assert.equal(resumedReport.state, "SUCCEEDED");
  assert.equal(resumedReport.items[0]?.attempts, 2);
  assert.equal(resumedReport.items[0]?.chargedAttempts, 1);
  assert.equal(resumeAdapter.launches, 1);
});

test("engine fails closed when an interrupted attempt context artifact is missing", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "single", "run-missing-context"));
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-context-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, { ...event("compiled"), type: "CHARTER_COMPILED" });
  await appendEvent(journalPath, { ...event("reconciling"), type: "RECONCILIATION_STARTED" });
  await appendEvent(journalPath, { ...event("running"), type: "RECONCILIATION_COMPLETED" });
  await appendEvent(journalPath, { ...event("ready"), type: "ITEM_READY", itemId: "item-1" });
  await appendEvent(journalPath, {
    ...event("attempt"),
    type: "ATTEMPT_STARTED",
    itemId: "item-1",
    attemptId: "attempt-missing-context",
    leaseEpoch: 1,
    expectedBaseCommit: repository.baseCommit,
    contextHash: "missing-context-hash",
    contextJournalSequence: 4,
    deadline: new Date(Date.now() + 30_000).toISOString(),
    idempotencyKey: "attempt:missing",
  });
  const journal = await readJournal(journalPath);
  const engine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter: new FakeAdapter(),
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
  });

  const report = await engine.run();

  assert.equal(report.state, "STOPPED");
  assert.match(report.lastReason, /context artifact is missing or malformed/);
});

test("engine does not launch a replacement when interrupted execution quiescence is unknown", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "single", "run-unknown-execution"));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-unknown-execution-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  const attemptsDirectory = join(runDirectory, "reports", "attempts");
  await mkdir(attemptsDirectory, { recursive: true });
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, { ...event("compiled"), type: "CHARTER_COMPILED" });
  await appendEvent(journalPath, { ...event("reconciling"), type: "RECONCILIATION_STARTED" });
  await appendEvent(journalPath, { ...event("running"), type: "RECONCILIATION_COMPLETED" });
  await appendEvent(journalPath, { ...event("ready"), type: "ITEM_READY", itemId: item.id });
  const beforeAttempt = await readJournal(journalPath);
  const observation = await observeRepository(repository.root);
  const attemptId = "attempt-orphaned";
  const context = buildAttemptContext({
    charter,
    item,
    attemptId,
    leaseEpoch: 1,
    observation,
    records: beforeAttempt.records,
    projection: rebuildProjection(charter, beforeAttempt.records),
    predicateEvidence: [],
    reviewFindings: [],
  });
  const contextHash = attemptContextHash(context);
  await writeImmutableJson(join(attemptsDirectory, `${attemptId}.context.json`), context);
  await appendEvent(journalPath, {
    ...event("attempt launched before coordinator loss"),
    type: "ATTEMPT_STARTED",
    itemId: item.id,
    attemptId,
    leaseEpoch: 1,
    expectedBaseCommit: observation.headCommit,
    contextHash,
    contextJournalSequence: context.sourceJournalSequence,
    deadline: new Date(Date.now() + 30_000).toISOString(),
    idempotencyKey: "attempt:orphaned",
  });
  const journal = await readJournal(journalPath);
  const adapter = new TrackingAdapter();
  const engine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter,
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
  });

  await engine.requestPause();
  const report = await engine.run();
  const finalJournal = await readJournal(journalPath);

  assert.equal(report.state, "WAITING");
  assert.equal(report.waiting?.kind, "execution-unknown");
  assert.equal(report.items[0]?.blocker, "EXECUTION_STATE_UNKNOWN");
  assert.equal(report.items[0]?.attempts, 1);
  assert.equal(report.items[0]?.chargedAttempts, 1);
  assert.equal(adapter.launches, 0);
  assert.equal(finalJournal.records.some(({ event: lifecycleEvent }) =>
    lifecycleEvent.type === "RUN_WAITING" && lifecycleEvent.waiting?.kind === "operator-pause"
  ), false);
});

test("engine retries a durably finished attempt instead of treating it as an orphan", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "single", "run-finished-execution"));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-finished-execution-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  const attemptsDirectory = join(runDirectory, "reports", "attempts");
  await mkdir(attemptsDirectory, { recursive: true });
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, { ...event("compiled"), type: "CHARTER_COMPILED" });
  await appendEvent(journalPath, { ...event("reconciling"), type: "RECONCILIATION_STARTED" });
  await appendEvent(journalPath, { ...event("running"), type: "RECONCILIATION_COMPLETED" });
  await appendEvent(journalPath, { ...event("ready"), type: "ITEM_READY", itemId: item.id });
  const beforeAttempt = await readJournal(journalPath);
  const observation = await observeRepository(repository.root);
  const attemptId = "attempt-finished";
  const context = buildAttemptContext({
    charter,
    item,
    attemptId,
    leaseEpoch: 1,
    observation,
    records: beforeAttempt.records,
    projection: rebuildProjection(charter, beforeAttempt.records),
    predicateEvidence: [],
    reviewFindings: [],
  });
  const contextHash = attemptContextHash(context);
  await writeImmutableJson(join(attemptsDirectory, `${attemptId}.context.json`), context);
  await appendEvent(journalPath, {
    ...event("attempt launched"), type: "ATTEMPT_STARTED", itemId: item.id, attemptId, leaseEpoch: 1,
    expectedBaseCommit: observation.headCommit, contextHash, contextJournalSequence: context.sourceJournalSequence,
    deadline: new Date(Date.now() + 30_000).toISOString(), idempotencyKey: "attempt:finished",
  });
  await appendEvent(journalPath, {
    ...event("execution completed before coordinator loss"), type: "ATTEMPT_FINISHED", itemId: item.id, attemptId,
    observedHeadCommit: observation.headCommit, observedTreeIdentity: observation.treeIdentity, outcome: "completed",
  });
  const journal = await readJournal(journalPath);
  const adapter = new TrackingAdapter();
  const engine = new AutopilotEngine({
    stateRoot,
    runDirectory,
    charter,
    adapter,
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
  });

  const report = await engine.run();
  const finalJournal = await readJournal(journalPath);

  assert.equal(report.state, "SUCCEEDED");
  assert.equal(report.items[0]?.attempts, 2);
  assert.equal(adapter.launches, 1);
  assert.equal(finalJournal.records.some(({ event: lifecycleEvent }) =>
    lifecycleEvent.type === "ITEM_BLOCKED" && lifecycleEvent.errorCode === "EXECUTION_STATE_UNKNOWN"
  ), false);
});

test("engine stop after push prevents later change-request mutation", async () => {
  const repository = await createRepository();
  const remote = await mkdtemp(join(tmpdir(), "autopilot-engine-stop-remote-"));
  await runChecked({ executable: "git", arguments: ["init", "--bare"], cwd: remote });
  await runChecked({ executable: "git", arguments: ["remote", "add", "origin", remote], cwd: repository.root });
  const proposed = proposedCharter(repository.root, repository.baseCommit, "single", "run-stop-delivery");
  const charter = sealCharter({
    ...proposed,
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [
      ...proposed.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "network.access", actor: "runtime" },
      { family: "credentials.use", actor: "runtime" },
      { family: "network.access", actor: "delivery" },
      { family: "credentials.use", actor: "delivery" },
      { family: "change-request.open", actor: "delivery" },
    ],
  });
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-stop-delivery-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));
  const bin = await mkdtemp(join(tmpdir(), "autopilot-engine-stop-gh-"));
  const described = join(bin, "described");
  const created = join(bin, "created");
  await writeNodeExecutable(bin, "gh", `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  writeFileSync(process.env.AUTOPILOT_GH_DESCRIBED, "described\\n");
  setTimeout(() => { console.log("gh version fake"); }, 500);
} else if (args[0] === "pr" && args[1] === "create") {
  writeFileSync(process.env.AUTOPILOT_GH_CREATED, "created\\n");
  console.log("https://example.invalid/pull/1");
} else if (args[0] === "pr" && args[1] === "list") {
  console.log("[]");
} else {
  console.log("{}");
}
`);
  const previousPath = process.env.PATH;
  const previousDescribed = process.env.AUTOPILOT_GH_DESCRIBED;
  const previousCreated = process.env.AUTOPILOT_GH_CREATED;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.AUTOPILOT_GH_DESCRIBED = described;
  process.env.AUTOPILOT_GH_CREATED = created;
  try {
    const engine = new AutopilotEngine({
      stateRoot,
      runDirectory,
      charter,
      adapter: new FakeAdapter(),
      records: journal.records,
      projection: rebuildProjection(charter, journal.records),
    });

    const running = engine.run();
    await waitForFile(described);
    await engine.requestStop();
    const report = await running;
    const finalJournal = await readJournal(join(runDirectory, "events.jsonl"));

    assert.equal(report.state, "STOPPED");
    assert.equal(report.items[0]?.blocker, "OPERATOR_STOP");
    assert.equal(finalJournal.records.some(({ event }) =>
      event.type === "EFFECT_CONFIRMED" && event.effect === "remote.push"
    ), true);
    assert.equal(finalJournal.records.some(({ event }) =>
      event.type === "EFFECT_INTENDED" && event.effect === "change-request.open"
    ), false);
    await assert.rejects(access(created), /ENOENT/);
  } finally {
    process.env.PATH = previousPath;
    if (previousDescribed === undefined) {
      delete process.env.AUTOPILOT_GH_DESCRIBED;
    } else {
      process.env.AUTOPILOT_GH_DESCRIBED = previousDescribed;
    }
    if (previousCreated === undefined) {
      delete process.env.AUTOPILOT_GH_CREATED;
    } else {
      process.env.AUTOPILOT_GH_CREATED = previousCreated;
    }
  }
});

test("engine expires a bounded exact-head check wait and resumes without rerunning implementation", async () => {
  const repository = await createRepository();
  const remote = await mkdtemp(join(tmpdir(), "autopilot-engine-wait-remote-"));
  await runChecked({ executable: "git", arguments: ["init", "--bare"], cwd: remote });
  await runChecked({ executable: "git", arguments: ["remote", "add", "origin", remote], cwd: repository.root });
  const proposed = proposedCharter(repository.root, repository.baseCommit, "single", "run-provider-wait");
  const charter = sealCharter({
    ...proposed,
    delivery: "merge-verified",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    providerCheckWait: { heartbeatMs: 20, timeoutMs: 80 },
    grants: [
      ...proposed.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "network.access", actor: "runtime" },
      { family: "credentials.use", actor: "runtime" },
      { family: "network.access", actor: "delivery" },
      { family: "credentials.use", actor: "delivery" },
      { family: "change-request.open", actor: "delivery" },
      { family: "merge.execute", actor: "delivery" },
    ],
  });
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-engine-provider-wait-"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(join(runDirectory, "receipts"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  const journalPath = join(runDirectory, "events.jsonl");
  await appendEvent(journalPath, { ...event("compiled"), type: "CHARTER_COMPILED" });
  const journal = await readJournal(journalPath);
  const bin = await mkdtemp(join(tmpdir(), "autopilot-engine-provider-wait-gh-"));
  const created = join(bin, "created");
  const merged = join(bin, "merged");
  const checks = join(bin, "checks");
  const observedSubject = join(bin, "observed-subject");
  const allowPass = join(bin, "allow-pass");
  const listCalls = join(bin, "list-calls");
  await writeNodeExecutable(bin, "gh", `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const head = () => spawnSync("git", ["ls-remote", "origin", "refs/heads/autopilot/*"], {encoding:"utf8"}).stdout.trim().split(/\\s+/)[0];
if (args[0] === "--version") { console.log("gh version test"); process.exit(0); }
if (args[0] === "api" && args[1] === "repos/owner/repository/pulls") {
  appendFileSync(process.env.AUTOPILOT_GH_LIST_CALLS, "list\\n");
  console.log(existsSync(process.env.AUTOPILOT_GH_CREATED) ? JSON.stringify([{number:1,html_url:"https://example.invalid/pull/1",body:"Autopilot-Run: run-provider-wait\\nAutopilot-Item: item-1"}]) : "[]"); process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") { writeFileSync(process.env.AUTOPILOT_GH_CREATED, "created\\n"); console.log("https://example.invalid/pull/1"); process.exit(0); }
if (args[0] === "pr" && args[1] === "view") { console.log(JSON.stringify({number:1,url:"https://example.invalid/pull/1",state:existsSync(process.env.AUTOPILOT_GH_MERGED)?"MERGED":"OPEN",headRefOid:head(),baseRefName:"main",reviewDecision:"APPROVED"})); process.exit(0); }
if (args[0] === "repo" && args[1] === "view") { console.log(JSON.stringify({nameWithOwner:"owner/repository"})); process.exit(0); }
if (args[0] === "api" && args[1].includes("/check-runs")) {
  appendFileSync(process.env.AUTOPILOT_GH_CHECKS, "check\\n");
  writeFileSync(process.env.AUTOPILOT_GH_SUBJECT, args[1] + "\\n");
  const mergeAfterPassing = existsSync(process.env.AUTOPILOT_GH_ALLOW_PASS);
  if (mergeAfterPassing) {
    writeFileSync(process.env.AUTOPILOT_GH_MERGED, "merged externally\\n");
  }
  console.log(JSON.stringify({check_runs:[{name:"build",status:mergeAfterPassing ? "completed" : "in_progress",conclusion:mergeAfterPassing ? "success" : null}]})); process.exit(0);
}
if (args[0] === "pr" && args[1] === "merge") { writeFileSync(process.env.AUTOPILOT_GH_MERGED, "merged\\n"); process.exit(0); }
console.error(JSON.stringify(args)); process.exit(2);
`);
  const previousEnvironment = {
    path: process.env.PATH,
    created: process.env.AUTOPILOT_GH_CREATED,
    merged: process.env.AUTOPILOT_GH_MERGED,
    checks: process.env.AUTOPILOT_GH_CHECKS,
    subject: process.env.AUTOPILOT_GH_SUBJECT,
    allowPass: process.env.AUTOPILOT_GH_ALLOW_PASS,
    listCalls: process.env.AUTOPILOT_GH_LIST_CALLS,
  };
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  process.env.AUTOPILOT_GH_CREATED = created;
  process.env.AUTOPILOT_GH_MERGED = merged;
  process.env.AUTOPILOT_GH_CHECKS = checks;
  process.env.AUTOPILOT_GH_SUBJECT = observedSubject;
  process.env.AUTOPILOT_GH_ALLOW_PASS = allowPass;
  process.env.AUTOPILOT_GH_LIST_CALLS = listCalls;
  try {
    const firstAdapter = new TrackingAdapter();
    const engine = new AutopilotEngine({
      stateRoot,
      runDirectory,
      charter,
      adapter: firstAdapter,
      records: journal.records,
      projection: rebuildProjection(charter, journal.records),
    });

    const waitingReport = await engine.run();
    const waitingJournal = await readJournal(journalPath);

    assert.equal(waitingReport.state, "WAITING");
    assert.equal(waitingReport.waiting?.kind, "provider-checks");
    assert.equal(waitingReport.items[0]?.blocker, undefined);
    assert.equal(firstAdapter.launches, 1);
    assert.equal(waitingJournal.records.filter(({ event: lifecycleEvent }) => lifecycleEvent.type === "RUN_WAITING").length, 1);
    assert.equal(waitingJournal.records.filter(({ event: lifecycleEvent }) => lifecycleEvent.type === "RUN_WOKEN").length, 0);
    const listCallsBeforeResume = (await readFile(listCalls, "utf8")).trim().split(/\n/u).length;
    const pauseEngine = new AutopilotEngine({
      stateRoot,
      runDirectory,
      charter,
      adapter: new TrackingAdapter(),
      records: waitingJournal.records,
      projection: rebuildProjection(charter, waitingJournal.records),
    });
    await pauseEngine.requestPause();
    const pausedReport = await pauseEngine.run();
    const pausedJournal = await readJournal(journalPath);
    const leaseValue: unknown = JSON.parse(await readFile(join(runDirectory, "leases", "item-1.json"), "utf8"));
    assert.equal(pausedReport.waiting?.kind, "operator-pause");
    assert.ok(isRecord(leaseValue));
    assert.equal(typeof leaseValue.retiredAt, "string");
    await writeFile(allowPass, "merge during next wait\n");

    const resumedAdapter = new TrackingAdapter();
    const resumedEngine = new AutopilotEngine({
      stateRoot,
      runDirectory,
      charter,
      adapter: resumedAdapter,
      records: pausedJournal.records,
      projection: rebuildProjection(charter, pausedJournal.records),
    });
    const report = await resumedEngine.run();
    const finalJournal = await readJournal(journalPath);
    const acceptedCommit = finalJournal.records.flatMap(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "EFFECT_CONFIRMED" && lifecycleEvent.effect === "git.commit" ? [lifecycleEvent.observedState] : []
    ).at(-1);

    assert.equal(report.state, "SUCCEEDED");
    assert.equal(resumedAdapter.launches, 0);
    assert.equal((await readFile(listCalls, "utf8")).trim().split(/\n/u).length, listCallsBeforeResume);
    assert.equal(finalJournal.records.filter(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "RUN_WAITING" && lifecycleEvent.waiting?.kind === "provider-checks"
    ).length, 1);
    assert.equal(finalJournal.records.filter(({ event: lifecycleEvent }) => lifecycleEvent.type === "RUN_WOKEN").length, 0);
    assert.ok((await readFile(checks, "utf8")).trim().split(/\n/u).length >= 2);
    assert.match(await readFile(observedSubject, "utf8"), new RegExp(`/commits/${acceptedCommit}/check-runs`));
    assert.equal(finalJournal.records.some(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "RECEIPT_RECORDED" && lifecycleEvent.receiptKind === "remote-checks" && lifecycleEvent.status === "UNVERIFIED"
    ), true);
    assert.equal(finalJournal.records.some(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "EFFECT_CONFIRMED" && lifecycleEvent.effect === "merge.execute"
    ), true);
  } finally {
    process.env.PATH = previousEnvironment.path;
    for (const [name, value] of [
      ["AUTOPILOT_GH_CREATED", previousEnvironment.created],
      ["AUTOPILOT_GH_MERGED", previousEnvironment.merged],
      ["AUTOPILOT_GH_CHECKS", previousEnvironment.checks],
      ["AUTOPILOT_GH_SUBJECT", previousEnvironment.subject],
      ["AUTOPILOT_GH_ALLOW_PASS", previousEnvironment.allowPass],
      ["AUTOPILOT_GH_LIST_CALLS", previousEnvironment.listCalls],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test("verified continuation fails closed when a checkpoint receipt is missing", async () => {
  const completed = await runMode("single");
  const journalPath = join(completed.runDirectory, "events.jsonl");
  const completeLines = (await readFile(journalPath, "utf8")).trimEnd().split("\n");
  const completeJournal = await readJournal(journalPath);
  const confirmationIndex = completeJournal.records.findIndex(({ event: lifecycleEvent }) =>
    lifecycleEvent.type === "EFFECT_CONFIRMED" && lifecycleEvent.effect === "git.commit"
  );
  assert.ok(confirmationIndex >= 0);
  const prefixLines = completeLines.slice(0, confirmationIndex + 1);
  await writeFile(journalPath, `${prefixLines.join("\n")}\n`);
  const interruptedJournal = await readJournal(journalPath);
  const checkpoint = interruptedJournal.records.findLast(({ event: lifecycleEvent }) =>
    lifecycleEvent.type === "ITEM_VERIFIED"
  )?.event;
  assert.equal(checkpoint?.type, "ITEM_VERIFIED");
  if (checkpoint?.type !== "ITEM_VERIFIED" || checkpoint.receiptIds[0] === undefined) {
    throw new Error("expected verified checkpoint receipt");
  }
  await unlink(join(completed.runDirectory, "receipts", `${checkpoint.receiptIds[0]}.json`));
  const adapter = new TrackingAdapter();
  const engine = new AutopilotEngine({
    stateRoot: dirname(dirname(completed.runDirectory)),
    runDirectory: completed.runDirectory,
    charter: completed.charter,
    adapter,
    records: interruptedJournal.records,
    projection: rebuildProjection(completed.charter, interruptedJournal.records),
  });

  const report = await engine.run();

  assert.equal(report.state, "STOPPED");
  assert.equal(report.items[0]?.blocker, "RECEIPT_STALE");
  assert.equal(adapter.launches, 0);
});

test("engine completes a local single-objective run with a tree-bound receipt and runtime commit", async () => {
  const result = await runMode("single");
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));
  const attempt = journal.records.find(({ event }) => event.type === "ATTEMPT_STARTED")?.event;
  assert.equal(attempt?.type, "ATTEMPT_STARTED");
  assert.ok(attempt?.type === "ATTEMPT_STARTED");
  const contextValue: unknown = JSON.parse(await readFile(join(
    result.runDirectory,
    "reports",
    "attempts",
    `${attempt.attemptId}.context.json`,
  ), "utf8"));
  assert.ok(isRecord(contextValue));

  assert.equal(sha256(canonicalJson(contextValue)), attempt.contextHash);
  assert.equal(contextValue.sourceJournalSequence, attempt.contextJournalSequence);
  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(result.report.items[0]?.state, "SATISFIED");
  const leaseValue: unknown = JSON.parse(await readFile(join(result.runDirectory, "leases", "item-1.json"), "utf8"));
  assert.ok(isRecord(leaseValue));
  assert.equal(typeof leaseValue.retiredAt, "string");
  assert.equal(dirname(result.report.worktrees[0]?.path ?? ""), dirname(await realpath(result.repository.root)));
  assert.notEqual(dirname(result.report.worktrees[0]?.path ?? ""), dirname(dirname(result.runDirectory)));
  assert.equal(result.report.evidenceMap.length, 1);
  assert.equal(result.report.evidenceMap[0]?.outcome, "met");
  assert.equal(result.report.continuity.items[0]?.unmetPredicateIds.length, 0);
  const log = (await runChecked({ executable: "git", arguments: ["log", "-1", "--format=%B", result.charter.work[0]?.branchName ?? ""], cwd: result.repository.root })).stdout;
  assert.match(log, /Autopilot-Run:/);
});

test("engine records a clean exact-subject independent review", async () => {
  const result = await runMode("single", false, "review");
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));
  const reviewEvent = journal.records.find(({ event }) =>
    event.type === "RECEIPT_RECORDED" && event.reason.includes("Independent review")
  )?.event;

  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(result.report.evidenceMap.length, 2);
  assert.ok(result.report.evidenceMap.every(({ outcome }) => outcome === "met"));
  assert.equal(reviewEvent?.type, "RECEIPT_RECORDED");
  assert.ok(reviewEvent?.type === "RECEIPT_RECORDED");
  assert.equal(reviewEvent.status, "PASSED");
  const receipt: unknown = JSON.parse(await readFile(join(result.runDirectory, "receipts", `${reviewEvent.receiptId}.json`), "utf8"));
  assert.ok(isRecord(receipt));
  assert.equal(receipt.reviewVerdict, "clean");
});

test("engine passes normalized review findings to the fresh remediation attempt", async () => {
  const adapter = new ReviewFindingsThenCleanAdapter();
  const result = await runMode("single", false, "review", adapter);

  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(adapter.implementationContexts.length, 2);
  assert.deepEqual(adapter.implementationContexts[0]?.reviewFindings, []);
  assert.deepEqual(adapter.implementationContexts[1]?.reviewFindings, [{
    gateId: "independent-review",
    path: "result.txt",
    line: 1,
    message: "Review the generated value.",
  }]);
});

test("engine rejects a reviewer mutation before lifecycle effects", async () => {
  const result = await runMode("single", false, "review", new MutatingReviewAdapter());
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));

  assert.equal(result.report.state, "STOPPED");
  assert.equal(journal.records.some(({ event }) => event.type === "RUN_SUCCEEDED"), false);
  assert.equal(journal.records.some(({ event }) => event.type === "EFFECT_INTENDED" && event.effect === "git.commit"), false);
});

test("engine reruns exact-tree review after a pre-commit hook changes the tree", async () => {
  const result = await runMode("single", "allowed", "review");
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));

  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(journal.records.filter(({ event }) =>
    event.type === "RECEIPT_RECORDED" && event.receiptKind === "review"
  ).length, 2);
});

test("engine verifies and commits the tree produced by an enabled pre-commit hook", async () => {
  const result = await runMode("single", "allowed");

  const committed = (await runChecked({
    executable: "git",
    arguments: ["show", `${result.charter.work[0]?.branchName}:hook-output.txt`],
    cwd: result.repository.root,
  })).stdout;
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));

  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(committed, "hooked\n");
  assert.ok(journal.records.some(({ event }) => event.type === "PRE_COMMIT_HOOK_FINISHED" && event.status === "PASSED"));
  assert.equal(result.report.commitPolicy.preCommitHook, "run");
});

test("engine rejects files changed outside writable roots by a pre-commit hook", async () => {
  const result = await runMode("single", "outside");

  assert.equal(result.report.state, "STOPPED");
  assert.equal(result.report.items[0]?.blocker, "CAPABILITY_DENIED");
});

test("engine rejects a Git ref created by a pre-commit hook", async () => {
  const result = await runMode("single", "ref");
  const journal = await readJournal(join(result.runDirectory, "events.jsonl"));

  assert.equal(result.report.state, "STOPPED");
  assert.ok(journal.records.some(({ event }) =>
    event.type === "ITEM_BLOCKED" && event.errorCode === "BRANCH_COLLISION"
  ));
});

test("engine rejects Git configuration changed by a pre-commit hook", async () => {
  const result = await runMode("single", "config");

  assert.equal(result.report.state, "STOPPED");
  assert.equal(result.report.items[0]?.blocker, "CAPABILITY_DENIED");
  assert.equal(result.report.items[0]?.attempts, 1);
});

test("engine rejects Git configuration changed by a verification gate", async () => {
  const result = await runMode("single", false, "config");

  assert.equal(result.report.state, "STOPPED");
  assert.equal(result.report.items[0]?.blocker, "CAPABILITY_DENIED");
  assert.equal(result.report.items[0]?.attempts, 1);
});

test("engine does not execute pre-commit hook content replaced after attempt start", async () => {
  const result = await runMode("single", "content");

  assert.equal(result.report.state, "STOPPED");
  assert.equal(result.report.items[0]?.blocker, "PRE_COMMIT_HOOK_FAILED");
  await assert.rejects(readFile(join(result.report.worktrees[0]?.path ?? "", "hook-was-executed")), /ENOENT/);
});

test("engine preserves independent queue siblings and ordered stack ancestry", async () => {
  const queue = await runMode("independent-queue");
  const stack = await runMode("ordered-stack");

  assert.equal(queue.report.state, "SUCCEEDED", JSON.stringify(queue.report, null, 2));
  assert.equal(queue.report.items.filter(({ state }) => state === "SATISFIED").length, 2);
  assert.equal(stack.report.state, "SUCCEEDED");
  const first = stack.charter.work[0]?.branchName ?? "";
  const second = stack.charter.work[1]?.branchName ?? "";
  const ancestry = await runChecked({ executable: "git", arguments: ["merge-base", "--is-ancestor", first, second], cwd: stack.repository.root });
  assert.equal(ancestry.exitCode, 0);
});
