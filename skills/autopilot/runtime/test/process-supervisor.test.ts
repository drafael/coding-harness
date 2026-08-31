import assert from "node:assert/strict";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  queryWindowsJob,
  terminateWindowsJob,
  verifiedWindowsJobHelperSha256,
  windowsRestartReattachmentAvailable,
} from "../src/windows-job.js";
import {
  cancelSupervisedProcess,
  launchSupervisedProcess,
  observeSupervisedProcess,
  readSupervisedRequest,
  reattachSupervisedProcess,
  supervisedExecutionId,
  supervisorDirectory,
  type SupervisedProcessRequest,
} from "../src/process-supervisor.js";

const windowsHelperSha256 = process.platform === "win32" ? await verifiedWindowsJobHelperSha256() : undefined;
const windowsJobSupported = process.platform === "win32" && await windowsRestartReattachmentAvailable();
const supervisedTest = process.platform === "win32" && !windowsJobSupported ? test.skip : test;

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
    ...(windowsHelperSha256 === undefined ? {} : { windowsHelperSha256 }),
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
  if (process.platform === "win32") {
    await assert.rejects(
      reattachSupervisedProcess(directory, { ...request, windowsHelperSha256: "0".repeat(64) }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN",
    );
  }
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

test("Windows broker preserves npm shim argv and environment casing end to end", {
  skip: !windowsJobSupported,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-windows-argv-"));
  const bin = join(root, "bin");
  const entry = join(bin, "adapter-entry.mjs");
  const shim = join(bin, "adapter.cmd");
  await mkdir(bin);
  await writeFile(entry, `console.log(JSON.stringify({ arguments: process.argv.slice(2), environment: process.env.MiXeD_Value }));\n`);
  await writeFile(shim, [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    'endLocal & "%_prog%" "%dp0%\\adapter-entry.mjs" %*',
    "",
  ].join("\r\n"));
  const arguments_ = ["", "quote\"value", "trailing\\", "ユニコード"];
  const environment = {
    SystemRoot: process.env.SystemRoot,
    Path: bin,
    PATHEXT: ".EXE;.CMD",
    MiXeD_Value: "Case-Preserved",
  };
  const base = requestFor(root, entry);
  const request = {
    ...base,
    executable: "adapter",
    arguments: arguments_,
    environmentNames: Object.keys(environment),
  };
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, environment);

  const observed = await observeSupervisedProcess(handle);

  assert.equal(observed.state, "completed");
  assert.deepEqual(JSON.parse(observed.result.stdout), {
    arguments: arguments_,
    environment: "Case-Preserved",
  });
});

test("Windows broker retries transient unauthenticated contention before exact termination", {
  skip: !windowsJobSupported,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-broker-busy-"));
  const script = join(root, "child.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n");
  const request = requestFor(root, script, 30_000);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);
  const identity = JSON.parse(await readFile(join(directory, "child.json"), "utf8")) as {
    schemaVersion: 1;
    executionId: string;
    requestHash: string;
    brokerName: string;
    brokerToken: string;
    helperSha256: string;
  };
  const occupier = createConnection(identity.brokerName);
  await once(occupier, "connect");

  assert.deepEqual(await queryWindowsJob(identity), { state: "busy", activeProcesses: 0 });
  const termination = await terminateWindowsJob(identity);
  occupier.destroy();

  assert.deepEqual(termination, { state: "terminated", activeProcesses: 0 });
  assert.equal((await observeSupervisedProcess(handle)).state, "failed");
});

test("Windows launch-helper death closes the Job Object and leaves no harness descendant", {
  skip: !windowsJobSupported,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-supervisor-helper-death-"));
  const script = join(root, "child.mjs");
  const marker = join(root, "escaped-child");
  await writeFile(script, `import { writeFileSync } from "node:fs"; setTimeout(() => writeFileSync(${JSON.stringify(marker)}, "escaped"), 2000); setInterval(() => {}, 1000);\n`);
  const request = requestFor(root, script, 30_000);
  const directory = supervisorDirectory(root, request.executionId);
  const handle = await launchSupervisedProcess(directory, request, process.env);
  await waitForFile(join(directory, "child.json"));
  const child = JSON.parse(await readFile(join(directory, "child.json"), "utf8")) as { helperPid: number };

  process.kill(child.helperPid);
  const observed = await observeSupervisedProcess(handle);
  await new Promise((resolve) => setTimeout(resolve, 2_250));

  assert.equal(observed.state, "failed");
  await assert.rejects(readFile(marker), /ENOENT/u);
});
