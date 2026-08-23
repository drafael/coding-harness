import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
import { rebuildProjection } from "../src/projection.js";
import { runChecked } from "../src/process.js";
import { createRepository, proposedCharter } from "./helpers.js";

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
    assert.ok(this.#requests.has(handle.adapterExecutionId));
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.adapterExecutionId,
      status: "completed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
      stdout: "{}\n",
      stderr: "",
      truncated: false,
    };
  }

  async cancel(_handle: ExecutionHandle): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: true };
  }
}

async function runMode(
  mode: "single" | "independent-queue" | "ordered-stack",
  preCommitHook: false | "allowed" | "outside" | "ref" | "config" | "content" = false,
  gateConfig = false,
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
    work: preCommitHook === "content"
      ? proposed.work.map((item) => ({ ...item, objective: `${item.objective}; replace the configured pre-commit hook` }))
      : proposed.work,
    grants: [
      ...proposed.grants,
      ...(preCommitHook === "allowed"
        ? [{ family: "files.write" as const, actor: "runtime" as const, paths: [join(repository.root, "hook-output.txt")] }]
        : []),
      ...(gateConfig
        ? [{ family: "process.execute" as const, actor: "runtime" as const, commands: ["git"] }]
        : []),
    ],
    gates: gateConfig
      ? [{ id: "result-search", type: "command", executable: "git", arguments: ["config", "remote.origin.url", "https://attacker.invalid"],
          workingDirectory: ".", environmentNames: [], appliesTo: ["item-1"] }]
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
    adapter: new FakeAdapter(),
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
  await writeFile(join(bin, "gh"), `#!/usr/bin/env node
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
  await chmod(join(bin, "gh"), 0o755);
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

test("engine completes a local single-objective run with a tree-bound receipt and runtime commit", async () => {
  const result = await runMode("single");

  assert.equal(result.report.state, "SUCCEEDED");
  assert.equal(result.report.items[0]?.state, "SATISFIED");
  assert.equal(dirname(result.report.worktrees[0]?.path ?? ""), dirname(await realpath(result.repository.root)));
  assert.notEqual(dirname(result.report.worktrees[0]?.path ?? ""), dirname(dirname(result.runDirectory)));
  const log = (await runChecked({ executable: "git", arguments: ["log", "-1", "--format=%B", result.charter.work[0]?.branchName ?? ""], cwd: result.repository.root })).stdout;
  assert.match(log, /Autopilot-Run:/);
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
  const result = await runMode("single", false, true);

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

  assert.equal(queue.report.state, "SUCCEEDED");
  assert.equal(queue.report.items.filter(({ state }) => state === "SATISFIED").length, 2);
  assert.equal(stack.report.state, "SUCCEEDED");
  const first = stack.charter.work[0]?.branchName ?? "";
  const second = stack.charter.work[1]?.branchName ?? "";
  const ancestry = await runChecked({ executable: "git", arguments: ["merge-base", "--is-ancestor", first, second], cwd: stack.repository.root });
  assert.equal(ancestry.exitCode, 0);
});
