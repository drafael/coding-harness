import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { createPiAdapter } from "../adapters/pi/index.js";
import {
  PiInProcessAdapter,
  PI_SUBAGENT_CANCEL_EVENT,
  PI_SUBAGENT_REQUEST_EVENT,
  PI_SUBAGENT_RESPONSE_EVENT,
  PI_SUBAGENT_STARTED_EVENT,
  type PiEventBus,
} from "../adapters/pi/in-process.js";
import { registerAutopilotPiExtension } from "../src/pi-extension.js";
import type {
  CancelResult,
  CapabilityManifest,
  ExecutionHandle,
  ExecutionObservation,
  ExecutionRequest,
  HarnessPort,
} from "../src/adapter-protocol.js";
import { findPiSubagentsInstallation, probePiSubagentsOwner } from "../src/pi-subagents.js";
import { attemptContextFixture, createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

async function fakeInstallation(root: string, version: string): Promise<string> {
  const packageRoot = join(root, "npm", "node_modules", "pi-subagents");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "pi-subagents", version }));
  const extensionPath = join(packageRoot, "index.ts");
  await writeFile(extensionPath, "export default function () {}\n");
  return extensionPath;
}

function request(role: "implementation" | "review" = "implementation", maximumOutputBytes = 262_144): ExecutionRequest {
  return {
    protocolVersion: 1,
    role,
    runId: "run-12345678",
    itemId: "item-1",
    attemptId: "attempt-1",
    worktreePath: process.cwd(),
    objective: "Create result.txt",
    acceptanceSummary: "result.txt exists",
    context: attemptContextFixture("attempt-1"),
    contextHash: "context-hash",
    writableRoots: ["result.txt"],
    grants: [],
    deadline: new Date(Date.now() + 30_000).toISOString(),
    idleTimeoutMs: 10_000,
    maximumLineBytes: 65_536,
    maximumOutputBytes,
    ...(role === "review" ? { reviewFocus: "Review the exact tree." } : {}),
  };
}

class FakeEventBus implements PiEventBus {
  readonly emitted: Array<{ readonly event: string; readonly value: unknown }> = [];
  readonly #listeners = new Map<string, Set<(value: unknown) => void>>();
  onEmit?: (event: string, value: unknown) => void;

  on(event: string, handler: (value: unknown) => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(handler);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(handler);
  }

  emit(event: string, value: unknown): void {
    this.emitted.push({ event, value });
    this.onEmit?.(event, value);
    this.#listeners.get(event)?.forEach((handler) => handler(value));
  }
}

interface FakeCommandContext {
  readonly cwd: string;
  readonly sessionManager: { getSessionId(): string };
  readonly ui: { notify(message: string, level: "info" | "warning" | "error"): void };
}

class FakePiExtension {
  readonly events = new FakeEventBus();
  readonly commands = new Map<string, (arguments_: string, context: FakeCommandContext) => Promise<void>>();
  readonly shutdownHandlers: Array<(event: { readonly reason: string }) => void> = [];

  on(event: "session_shutdown", handler: (event: { readonly reason: string }) => void): void {
    assert.equal(event, "session_shutdown");
    this.shutdownHandlers.push(handler);
  }

  registerCommand(name: string, options: {
    readonly description: string;
    readonly handler: (arguments_: string, context: FakeCommandContext) => Promise<void>;
  }): void {
    assert.notEqual(options.description, "");
    this.commands.set(name, options.handler);
  }
}

class FakeReviewAdapter implements HarnessPort {
  launches = 0;

  async describe(): Promise<CapabilityManifest> {
    throw new Error("review adapter describe is not used by the in-process adapter");
  }

  async launch(_request: ExecutionRequest): Promise<ExecutionHandle> {
    this.launches += 1;
    return { protocolVersion: 1, adapterExecutionId: "review-1", startedAt: new Date().toISOString() };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.adapterExecutionId,
      status: "completed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
      stdout: "AUTOPILOT_REVIEW_RESULT:{\"verdict\":\"clean\",\"findings\":[]}",
      stderr: "",
      truncated: false,
      reviewResult: { verdict: "clean", findings: [] },
    };
  }

  async cancel(_handle: ExecutionHandle): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: true };
  }
}

function inProcessAdapter(bus: FakeEventBus, reviewAdapter = new FakeReviewAdapter()): PiInProcessAdapter {
  return new PiInProcessAdapter({
    events: bus,
    harnessInstanceId: "session-1:extension-1",
    harnessVersion: "0.84.4",
    piSubagentsVersion: "0.60.0",
    reviewAdapter,
  });
}

function startOnRequest(bus: FakeEventBus): void {
  bus.onEmit = (event, value) => {
    if (event === PI_SUBAGENT_REQUEST_EVENT) {
      bus.emit(PI_SUBAGENT_STARTED_EVENT, value);
    }
  };
}

function emittedRequest(bus: FakeEventBus): Record<string, unknown> {
  const value = bus.emitted.filter(({ event }) => event === PI_SUBAGENT_REQUEST_EVENT).at(-1)?.value;
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("pi-subagents discovery requires the supported structured delegation version", async () => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "autopilot-pi-agent-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  try {
    await fakeInstallation(agentDirectory, "0.52.0");
    assert.equal(findPiSubagentsInstallation(), undefined);

    const extensionPath = await fakeInstallation(agentDirectory, "0.53.0");
    assert.deepEqual(findPiSubagentsInstallation(), { extensionPath, version: "0.53.0" });
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

test("process-local pi-subagents owner probe requires an exact RPC ping reply", async () => {
  const available = new FakeEventBus();
  available.onEmit = (event, value) => {
    if (event === "subagents:rpc:v1:request" && typeof value === "object" && value !== null) {
      const requestValue = value as Record<string, unknown>;
      available.emit(`subagents:rpc:v1:reply:${String(requestValue.requestId)}`, {
        version: 1,
        requestId: requestValue.requestId,
        success: true,
        data: { version: 1, methods: ["ping", "status"] },
      });
    }
  };

  assert.equal(await probePiSubagentsOwner(available, 50), true);
  assert.equal(await probePiSubagentsOwner(new FakeEventBus(), 10), false);
});

test("Pi adapter uses the direct worker fallback without loading another extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-pi-direct-"));
  const agentDirectory = join(root, "agent");
  const bin = join(root, "bin");
  const marker = join(root, "arguments.json");
  await fakeInstallation(agentDirectory, "0.60.0");
  await mkdir(bin, { recursive: true });
  await writeNodeExecutable(bin, "pi", `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(process.env.AUTOPILOT_PI_ARGUMENTS, JSON.stringify(args));
console.log(JSON.stringify({type:"agent_settled"}));
`);
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const previousPath = process.env.PATH;
  const previousMarker = process.env.AUTOPILOT_PI_ARGUMENTS;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.AUTOPILOT_PI_ARGUMENTS = marker;
  try {
    const adapter = createPiAdapter();

    const handle = await adapter.launch(request());
    const observation = await adapter.observe(handle);
    const arguments_: unknown = JSON.parse(await readFile(marker, "utf8"));

    assert.equal(observation.status, "completed");
    assert.ok(Array.isArray(arguments_));
    assert.ok(arguments_.includes("read,bash,edit,write"));
    assert.ok(!arguments_.includes("--extension"));
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
    process.env.PATH = previousPath;
    if (previousMarker === undefined) {
      delete process.env.AUTOPILOT_PI_ARGUMENTS;
    } else {
      process.env.AUTOPILOT_PI_ARGUMENTS = previousMarker;
    }
  }
});

test("Pi in-process adapter binds exact admission and preserves terminal completion across shutdown", async () => {
  const bus = new FakeEventBus();
  startOnRequest(bus);
  const adapter = inProcessAdapter(bus);
  const manifest = await adapter.describe();

  const handle = await adapter.launch(request());
  const delegation = emittedRequest(bus);
  assert.equal(manifest.executionAssurance?.implementation.owner, "harness");
  assert.equal(manifest.executionAssurance?.implementation.continuity, "same-harness-instance");
  assert.equal(handle.adapterExecutionId, delegation.requestId);
  assert.equal(handle.subject?.harnessInstanceId, "session-1:extension-1");
  assert.notEqual(delegation.nodeId, "item-1");

  bus.emit(PI_SUBAGENT_RESPONSE_EVENT, {
    requestId: "other-request",
    ownerRunId: delegation.ownerRunId,
    nodeId: delegation.nodeId,
    status: "completed",
    result: { kind: "text", text: "wrong" },
  });
  bus.emit(PI_SUBAGENT_RESPONSE_EVENT, {
    requestId: delegation.requestId,
    ownerRunId: delegation.ownerRunId,
    nodeId: delegation.nodeId,
    status: "completed",
    result: { kind: "text", text: "done" },
  });
  adapter.invalidate("extension reloaded after terminal response");

  const observation = await adapter.observe(handle);
  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "done");
});

test("Pi in-process adapter makes admission or observation loss unknown without another request", async () => {
  const beforeAdmission = new FakeEventBus();
  const firstAdapter = inProcessAdapter(beforeAdmission);
  const launch = firstAdapter.launch(request());
  firstAdapter.invalidate("extension reloaded before exact admission");
  await assert.rejects(launch, /before exact admission/);
  assert.equal(beforeAdmission.emitted.filter(({ event }) => event === PI_SUBAGENT_REQUEST_EVENT).length, 1);

  const afterAdmission = new FakeEventBus();
  startOnRequest(afterAdmission);
  const secondAdapter = inProcessAdapter(afterAdmission);
  const handle = await secondAdapter.launch(request());
  secondAdapter.invalidate("session replaced before terminal response");
  await assert.rejects(secondAdapter.observe(handle), /not attached|session replaced/);
  assert.equal(afterAdmission.emitted.filter(({ event }) => event === PI_SUBAGENT_REQUEST_EVENT).length, 1);

  const idleBus = new FakeEventBus();
  idleBus.onEmit = (event, value) => {
    if (event === PI_SUBAGENT_REQUEST_EVENT) {
      idleBus.emit(PI_SUBAGENT_STARTED_EVENT, value);
    } else if (event === PI_SUBAGENT_CANCEL_EVENT) {
      throw new Error("cancel listener failed");
    }
  };
  const idleAdapter = inProcessAdapter(idleBus);
  const idleHandle = await idleAdapter.launch({ ...request(), idleTimeoutMs: 5 });
  await assert.rejects(idleAdapter.observe(idleHandle), /idle timeout.*cancellation delivery also failed/);
  assert.equal(idleBus.emitted.filter(({ event }) => event === PI_SUBAGENT_CANCEL_EVENT).length, 1);
});

test("Pi in-process cancellation emits the exact tuple and waits for terminal cancellation", async () => {
  const bus = new FakeEventBus();
  startOnRequest(bus);
  const adapter = inProcessAdapter(bus);
  const handle = await adapter.launch(request());
  const delegation = emittedRequest(bus);

  assert.deepEqual(await adapter.cancel(handle), { protocolVersion: 1, accepted: true });
  const cancellation = bus.emitted.find(({ event }) => event === PI_SUBAGENT_CANCEL_EVENT)?.value;
  assert.deepEqual(cancellation, {
    requestId: delegation.requestId,
    ownerRunId: delegation.ownerRunId,
    nodeId: delegation.nodeId,
  });

  bus.emit(PI_SUBAGENT_RESPONSE_EVENT, {
    requestId: delegation.requestId,
    ownerRunId: delegation.ownerRunId,
    nodeId: delegation.nodeId,
    status: "cancelled",
  });
  const observation = await adapter.observe(handle);
  assert.equal(observation.status, "cancelled");
});

test("Pi in-process adapter fails a bounded malformed result and keeps review direct", async () => {
  const bus = new FakeEventBus();
  startOnRequest(bus);
  const reviewAdapter = new FakeReviewAdapter();
  const adapter = inProcessAdapter(bus, reviewAdapter);
  const handle = await adapter.launch(request("implementation", 4));
  const delegation = emittedRequest(bus);
  bus.emit(PI_SUBAGENT_RESPONSE_EVENT, {
    requestId: delegation.requestId,
    ownerRunId: delegation.ownerRunId,
    nodeId: delegation.nodeId,
    status: "completed",
    result: { kind: "text", text: "oversized" },
  });

  const observation = await adapter.observe(handle);
  assert.equal(observation.status, "failed");
  assert.match(observation.stderr, /output bound/);

  const previousSecret = process.env.AUTOPILOT_SECRET_TOKEN;
  process.env.AUTOPILOT_SECRET_TOKEN = "x";
  try {
    const failedHandle = await adapter.launch(request());
    const failedDelegation = emittedRequest(bus);
    bus.emit(PI_SUBAGENT_RESPONSE_EVENT, {
      requestId: failedDelegation.requestId,
      ownerRunId: failedDelegation.ownerRunId,
      nodeId: failedDelegation.nodeId,
      status: "failed",
      error: "failure included x",
    });
    assert.equal((await adapter.observe(failedHandle)).stderr, "failure included ****");
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AUTOPILOT_SECRET_TOKEN;
    } else {
      process.env.AUTOPILOT_SECRET_TOKEN = previousSecret;
    }
  }

  const reviewHandle = await adapter.launch(request("review"));
  const reviewObservation = await adapter.observe(reviewHandle);
  assert.equal(reviewAdapter.launches, 1);
  assert.deepEqual(reviewObservation.reviewResult, { verdict: "clean", findings: [] });
});

test("Pi extension invokes the runtime core and completes through process-local delegation", async () => {
  const repository = await createRepository();
  const repositoryRoot = await realpath(repository.root);
  const runId = "run-pi-extension";
  const charterPath = join(repositoryRoot, "charter.json");
  await writeFile(charterPath, JSON.stringify(proposedCharter(repositoryRoot, repository.baseCommit, "single", runId)));
  const agentDirectory = await mkdtemp(join(tmpdir(), "autopilot-pi-extension-agent-"));
  await fakeInstallation(agentDirectory, "0.60.0");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const pi = new FakePiExtension();
  const notifications: string[] = [];
  let completeDelegations = true;
  pi.events.onEmit = (event, value) => {
    if (event === "subagents:rpc:v1:request" && typeof value === "object" && value !== null) {
      const rpc = value as Record<string, unknown>;
      pi.events.emit(`subagents:rpc:v1:reply:${String(rpc.requestId)}`, {
        version: 1,
        requestId: rpc.requestId,
        success: true,
        data: { version: 1, methods: ["ping"] },
      });
      return;
    }
    if (event === PI_SUBAGENT_REQUEST_EVENT && typeof value === "object" && value !== null) {
      const delegation = value as Record<string, unknown>;
      pi.events.emit(PI_SUBAGENT_STARTED_EVENT, delegation);
      if (completeDelegations) {
        void writeFile(join(String(delegation.cwd), "result.txt"), "done\n").then(() => {
          pi.events.emit(PI_SUBAGENT_RESPONSE_EVENT, {
            requestId: delegation.requestId,
            ownerRunId: delegation.ownerRunId,
            nodeId: delegation.nodeId,
            status: "completed",
            result: { kind: "text", text: "created result.txt" },
          });
        });
      }
    }
  };
  try {
    registerAutopilotPiExtension(pi, { piVersion: "0.84.4" });
    const start = pi.commands.get("autopilot-start");
    assert.ok(start !== undefined);
    await start(charterPath, {
      cwd: repositoryRoot,
      sessionManager: { getSessionId: () => "pi-session-1" },
      ui: { notify: (message) => notifications.push(message) },
    });

    const report: unknown = JSON.parse(await readFile(
      join(repositoryRoot, ".git", "autopilot", "runs", runId, "reports", "final.json"),
      "utf8",
    ));
    assert.ok(typeof report === "object" && report !== null);
    assert.equal((report as Record<string, unknown>).state, "SUCCEEDED");
    assert.match(notifications.join("\n"), /process-local structured delegation/);
    const journal = await readFile(
      join(repositoryRoot, ".git", "autopilot", "runs", runId, "events.jsonl"),
      "utf8",
    );
    assert.match(journal, /ATTEMPT_EXECUTION_ADMITTED/);
    assert.match(journal, /pi-subagents-structured-v1@0\.60\.0/);

    completeDelegations = false;
    const reloadRunId = "reload31-extension";
    const reloadCharterPath = join(repositoryRoot, "charter-reload.json");
    await writeFile(
      reloadCharterPath,
      JSON.stringify(proposedCharter(repositoryRoot, repository.baseCommit, "single", reloadRunId)),
    );
    const reloadExecution = start(reloadCharterPath, {
      cwd: repositoryRoot,
      sessionManager: { getSessionId: () => "pi-session-1" },
      ui: { notify: (message) => notifications.push(message) },
    });
    const reloadJournalPath = join(
      repositoryRoot,
      ".git",
      "autopilot",
      "runs",
      reloadRunId,
      "events.jsonl",
    );
    let admissionObserved = false;
    for (let attempt = 0; attempt < 100 && !admissionObserved; attempt += 1) {
      try {
        admissionObserved = (await readFile(reloadJournalPath, "utf8")).includes("ATTEMPT_EXECUTION_ADMITTED");
      } catch {
        // The coordinator has not published the run directory yet.
      }
      if (!admissionObserved) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      }
    }
    assert.equal(admissionObserved, true);
    pi.shutdownHandlers[0]?.({ reason: "reload" });
    await reloadExecution;
    const reloadReport: unknown = JSON.parse(await readFile(
      join(repositoryRoot, ".git", "autopilot", "runs", reloadRunId, "reports", "status.json"),
      "utf8",
    ));
    assert.ok(typeof reloadReport === "object" && reloadReport !== null);
    assert.equal((reloadReport as Record<string, unknown>).state, "WAITING");
    assert.match(JSON.stringify(reloadReport), /execution-unknown/);
    assert.equal((await readFile(reloadJournalPath, "utf8")).match(/ATTEMPT_STARTED/g)?.length, 1);
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  }
});
