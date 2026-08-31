import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeImmutableJson, writeJsonAtomic } from "../src/journal.js";
import { runProcess } from "../src/process.js";
import {
  cancelSupervisedProcess,
  launchSupervisedProcess,
  observeSupervisedProcess,
  readSupervisedRequest,
  reattachSupervisedProcess,
  supervisedExecutionId,
  supervisorArtifactNames,
  supervisorDirectory,
  supervisorRequestHash,
  type SupervisedProcessRequest,
} from "../src/process-supervisor.js";

const supervisedTest = process.platform === "win32" ? test.skip : test;

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
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

function requestFor(root: string, script: string, deadlineMs = 10_000): SupervisedProcessRequest {
  const executionId = supervisedExecutionId("run-1", "item-1", "attempt-1", "implementation", "context-hash");
  return {
    schemaVersion: 1,
    executionId,
    runId: "run-1",
    itemId: "item-1",
    attemptId: "attempt-1",
    contextHash: "context-hash",
    executable: process.execPath,
    arguments: [script],
    cwd: root,
    environmentNames: Object.keys(process.env).sort(),
    credentialEnvironmentNames: [],
    deadline: new Date(Date.now() + deadlineMs).toISOString(),
    idleTimeoutMs: deadlineMs,
    maximumOutputBytes: 65_536,
    displayStderrActivity: false,
  };
}

test("supervisor request preserves empty process arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-empty-argument-"));
  const request = requestFor(root, "child.mjs");
  const directory = supervisorDirectory(root, request.executionId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "request.json"), JSON.stringify({ ...request, arguments: [""] }));

  assert.deepEqual((await readSupervisedRequest(directory))?.arguments, [""]);
});

test("watchdog errors fail nonterminal execution without poisoning valid terminal results", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-watchdog-fatal-"));
  const request = requestFor(root, join(root, "child.mjs"), 30_000);
  const directory = supervisorDirectory(root, request.executionId);
  const requestHash = supervisorRequestHash(request);
  const startedAt = new Date().toISOString();
  const runningStatus = {
    schemaVersion: 1,
    executionId: request.executionId,
    requestHash,
    state: "running",
    supervisorPid: process.pid,
    startedAt,
    updatedAt: startedAt,
  };
  await mkdir(directory, { recursive: true });
  await writeImmutableJson(join(directory, supervisorArtifactNames.request), request);
  await writeJsonAtomic(join(directory, supervisorArtifactNames.status), runningStatus);
  await mkdir(join(directory, supervisorArtifactNames.activityPulse));

  const watchdog = join(process.cwd(), "dist", "src", "supervisor-watchdog.js");
  const result = await runProcess({
    executable: process.execPath,
    arguments: [watchdog, directory],
    cwd: root,
    timeoutMs: 10_000,
  });
  const watchdogError = JSON.parse(
    await readFile(join(directory, supervisorArtifactNames.watchdogError), "utf8"),
  ) as { schemaVersion: number; executionId: string; requestHash: string; failedAt: string; error: string };
  const status = JSON.parse(
    await readFile(join(directory, supervisorArtifactNames.status), "utf8"),
  ) as { executionId: string; requestHash: string; state: string; exitCode: number };

  assert.equal(result.exitCode, 1);
  assert.equal(watchdogError.schemaVersion, 1);
  assert.equal(watchdogError.executionId, request.executionId);
  assert.equal(watchdogError.requestHash, requestHash);
  assert.ok(Number.isFinite(Date.parse(watchdogError.failedAt)));
  assert.ok(watchdogError.error.length > 0);
  assert.equal(status.executionId, request.executionId);
  assert.equal(status.requestHash, requestHash);
  assert.equal(status.state, "state-unknown");
  assert.equal(status.exitCode, 1);

  await writeJsonAtomic(join(directory, supervisorArtifactNames.status), runningStatus);
  const handle = {
    schemaVersion: 1 as const,
    executionId: request.executionId,
    directory,
    requestHash,
    startedAt,
  };
  await assert.rejects(
    observeSupervisedProcess(handle),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN",
  );
  await writeJsonAtomic(join(directory, supervisorArtifactNames.watchdogError), {
    ...watchdogError,
    requestHash: "changed-request-hash",
  });
  await assert.rejects(
    observeSupervisedProcess(handle),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN",
  );
  await writeJsonAtomic(join(directory, supervisorArtifactNames.watchdogError), watchdogError);

  const terminalResult = { exitCode: 124, stdout: "", stderr: "cancelled", truncated: false };
  const completedAt = new Date().toISOString();
  await writeJsonAtomic(join(directory, supervisorArtifactNames.result), terminalResult);
  await writeJsonAtomic(join(directory, supervisorArtifactNames.status), {
    ...runningStatus,
    state: "cancelled",
    updatedAt: completedAt,
    completedAt,
    exitCode: terminalResult.exitCode,
  });

  if (process.platform !== "win32") {
    const launched = await launchSupervisedProcess(directory, request, process.env);
    const reattached = await reattachSupervisedProcess(directory, request);
    assert.ok(reattached !== undefined);
    assert.equal(launched.requestHash, requestHash);
    assert.equal(reattached.requestHash, requestHash);
  }
  assert.deepEqual(await observeSupervisedProcess(handle), {
    state: "cancelled",
    result: terminalResult,
  });
});

supervisedTest("supervised process survives client replacement and returns its durable result", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-"));
  const script = join(root, "child.mjs");
  const journal = join(root, "events.jsonl");
  await writeFile(script, "setTimeout(() => console.log(JSON.stringify({done:true})), 250);\n");
  await writeFile(journal, "canonical-journal\n");
  const request = requestFor(root, script);
  const directory = supervisorDirectory(root, request.executionId);

  await launchSupervisedProcess(directory, request, process.env);
  const reattached = await reattachSupervisedProcess(directory, request);
  assert.ok(reattached !== undefined);
  const observed = await observeSupervisedProcess(reattached);

  assert.equal(observed.state, "completed");
  assert.equal(observed.result.exitCode, 0);
  assert.equal(observed.result.stdout, "{\"done\":true}\n");
  assert.equal(await readFile(journal, "utf8"), "canonical-journal\n");
});

supervisedTest("supervised process request identity is immutable", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-identity-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "console.log('done');\n");
  const request = requestFor(root, script);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  assert.ok(await reattachSupervisedProcess(directory, {
    ...request,
    environmentNames: [...request.environmentNames, "INNOCUOUS_RESTART_VARIABLE"],
  }));
  await assert.rejects(
    reattachSupervisedProcess(directory, { ...request, contextHash: "changed" }),
    /request changed/u,
  );
  await observeSupervisedProcess(handle);
});

supervisedTest("watchdog terminates the supervisor process group without child identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-watchdog-"));
  const script = join(root, "child.mjs");
  const marker = join(root, "orphan-survived");
  await writeFile(script, `import { writeFileSync } from "node:fs"; setTimeout(() => writeFileSync(${JSON.stringify(marker)}, "survived"), 2000); setInterval(() => {}, 1000);\n`);
  const request = requestFor(root, script, 30_000);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);
  await waitForFile(join(directory, "watchdog-ready.json"));
  await waitForFile(join(directory, "child.json"));
  await unlink(join(directory, "child.json"));
  const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8")) as { supervisorPid: number };

  process.kill(status.supervisorPid, "SIGKILL");
  const observed = await observeSupervisedProcess(handle);
  await new Promise((resolve) => setTimeout(resolve, 2_250));

  assert.equal(observed.state, "failed");
  await assert.rejects(readFile(marker), /ENOENT/);
});

supervisedTest("successful harness completion quiesces inherited-group descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-completion-"));
  const script = join(root, "child.mjs");
  const marker = join(root, "descendant-survived");
  await writeFile(script, `import { spawn } from "node:child_process"; spawn(process.execPath, ["-e", ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 500); setTimeout(() => {}, 10000);`)}], { stdio: "ignore", detached: false }).unref();\n`);
  const request = requestFor(root, script);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  const observed = await observeSupervisedProcess(handle);
  await new Promise((resolve) => setTimeout(resolve, 750));

  assert.equal(observed.state, "completed");
  await assert.rejects(readFile(marker), /ENOENT/);
});

supervisedTest("watchdog prefers an earlier cancellation over later harness completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-cancel-race-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "setTimeout(() => {}, 200);\n");
  const request = requestFor(root, script);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);
  await waitForFile(join(directory, "child.json"));
  await new Promise((resolve) => setTimeout(resolve, 100));

  await cancelSupervisedProcess(handle);
  const observed = await observeSupervisedProcess(handle);

  assert.equal(observed.state, "cancelled");
});

supervisedTest("watchdog prefers an earlier deadline over later harness completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-deadline-race-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "setTimeout(() => {}, 250);\n");
  const request = requestFor(root, script, 150);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  const observed = await observeSupervisedProcess(handle);

  assert.equal(observed.state, "timed-out");
});

supervisedTest("watchdog enforces the supervised harness idle deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-idle-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n");
  const base = requestFor(root, script);
  const request = { ...base, idleTimeoutMs: 100 };
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  const observed = await observeSupervisedProcess(handle);

  assert.equal(observed.state, "timed-out");
});

supervisedTest("supervisor bounds retained stderr activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-activity-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "for (let i = 0; i < 1000; i += 1) console.error('activity-' + i);\n");
  const base = requestFor(root, script);
  const request = { ...base, maximumOutputBytes: 512, displayStderrActivity: true };
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  await observeSupervisedProcess(handle);

  assert.ok((await stat(join(directory, "stderr-activity.log"))).size <= 512);
});

supervisedTest("supervised cancellation waits for a terminal process-tree observation", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-cancel-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n");
  const request = requestFor(root, script, 30_000);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);

  await cancelSupervisedProcess(handle);
  const observed = await observeSupervisedProcess(handle);

  assert.equal(observed.state, "cancelled");
  assert.equal(observed.result.exitCode, 124);
});
