import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runChecked } from "../src/process.js";

const collector = join(process.cwd(), "scripts", "collect-windows-diagnostics.mjs");

function stderrMetadata(stderr: string, failureKind: string, win32Code?: number) {
  return {
    stderrByteLength: Buffer.byteLength(stderr),
    stderrSha256: createHash("sha256").update(stderr).digest("hex"),
    failureKind,
    ...(win32Code === undefined ? {} : { win32Code }),
  };
}

function statusErrorMetadata(error: string, failureKind: string) {
  return {
    errorByteLength: Buffer.byteLength(error),
    errorSha256: createHash("sha256").update(error).digest("hex"),
    errorFailureKind: failureKind,
  };
}

test("Windows diagnostic collector emits typed metadata without secret process output", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-diagnostics-test-"));
  const executionRoot = join(root, "autopilot-supervisor-fixture", "runs", "run-1", "executions");
  const execution = join(executionRoot, "execution-1");
  const knownFailureExecution = join(executionRoot, "execution-2");
  const ignoredExecution = join(root, "unrelated-fixture", "executions", "execution-2");
  const output = join(root, "diagnostics", "windows.json");
  const secretStderr = "SECRET_TOKEN=hunter2\ncannot connect to the Windows Job Object broker (win32=5)\n";
  const knownStderr = "cannot connect to the Windows Job Object broker (win32=5)\n";
  const secretStatusError = "Windows Job Object query was not confirmed SECRET_TOKEN=status-hunter2";
  const secretWatchdogError = "rename failed SECRET_TOKEN=watchdog-hunter2";
  const knownStatusError = "Windows Job Object query was not confirmed";
  await mkdir(execution, { recursive: true });
  await mkdir(knownFailureExecution, { recursive: true });
  await mkdir(ignoredExecution, { recursive: true });
  await writeFile(join(execution, "status.json"), JSON.stringify({
    schemaVersion: 1,
    executionId: "execution-1",
    requestHash: "request-hash",
    state: "state-unknown",
    supervisorPid: process.pid,
    startedAt: { nestedSecret: "status-start-secret" },
    updatedAt: ["status-update-secret"],
    exitCode: { nestedSecret: "status-exit-secret" },
    error: secretStatusError,
    environment: { SECRET_TOKEN: "secret" },
  }));
  await writeFile(join(execution, "completion.json"), JSON.stringify({
    state: "failed",
    completedAt: "2026-08-31T00:00:00.000Z",
    result: {
      exitCode: { nestedSecret: "completion-exit-secret" },
      stdout: "private output",
      stderr: secretStderr,
      truncated: ["completion-truncated-secret"],
    },
  }));
  await writeFile(join(execution, "result.json"), JSON.stringify({
    exitCode: 1,
    stdout: "private output",
    stderr: knownStderr,
    truncated: false,
    nested: { secret: "result-nested-secret" },
  }));
  await writeFile(join(execution, "child.json"), JSON.stringify({
    schemaVersion: 1,
    executionId: "execution-1",
    requestHash: "request-hash",
    brokerName: { nestedSecret: "broker-name-secret" },
    brokerToken: "broker-secret",
    helperSha256: "a".repeat(64),
    helperPid: process.pid,
    childPid: ["child-pid-secret"],
    supervisorPid: process.pid,
    startedAt: { nestedSecret: "child-start-secret" },
  }));
  await writeFile(join(execution, "watchdog-error.json"), JSON.stringify({
    schemaVersion: 1,
    executionId: "execution-1",
    requestHash: "request-hash",
    failedAt: "2026-08-31T00:00:00.000Z",
    error: secretWatchdogError,
    environment: { SECRET_TOKEN: "secret" },
  }));
  await writeFile(join(execution, "watchdog-ready.json"), JSON.stringify({
    schemaVersion: 1,
    executionId: "execution-1",
    requestHash: ["watchdog-request-secret"],
    supervisorPid: process.pid,
    readyAt: "2026-08-31T00:00:00.000Z",
  }));
  await writeFile(join(knownFailureExecution, "status.json"), JSON.stringify({
    schemaVersion: 1,
    executionId: "execution-2",
    state: "state-unknown",
    error: knownStatusError,
  }));
  await writeFile(join(execution, "request.json"), JSON.stringify({ environment: { SECRET_TOKEN: "secret" } }));
  await writeFile(join(execution, "events.jsonl"), "canonical lifecycle state must not be collected\n");
  await writeFile(join(ignoredExecution, "status.json"), JSON.stringify({ executionId: "ignored" }));

  await runChecked({
    executable: process.execPath,
    arguments: [collector, "--root", root, "--output", output],
    cwd: root,
  });
  const report: unknown = JSON.parse(await readFile(output, "utf8"));

  assert.deepEqual(report, {
    schemaVersion: 1,
    diagnostics: [
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/child.json",
        file: "child.json",
        value: {
          schemaVersion: 1,
          executionId: "execution-1",
          requestHash: "request-hash",
          helperSha256: "a".repeat(64),
          helperPid: process.pid,
          supervisorPid: process.pid,
        },
        pidLiveness: [
          { field: "helperPid", pid: process.pid, state: "alive" },
          { field: "supervisorPid", pid: process.pid, state: "alive" },
        ],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/completion.json",
        file: "completion.json",
        value: {
          state: "failed",
          completedAt: "2026-08-31T00:00:00.000Z",
          resultStderrByteLength: Buffer.byteLength(secretStderr),
          resultStderrSha256: createHash("sha256").update(secretStderr).digest("hex"),
          resultFailureKind: "UNKNOWN",
        },
        pidLiveness: [],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/result.json",
        file: "result.json",
        value: {
          exitCode: 1,
          truncated: false,
          ...stderrMetadata(knownStderr, "BROKER_CONNECT_FAILED", 5),
        },
        pidLiveness: [],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/status.json",
        file: "status.json",
        value: {
          schemaVersion: 1,
          executionId: "execution-1",
          requestHash: "request-hash",
          state: "state-unknown",
          supervisorPid: process.pid,
          ...statusErrorMetadata(secretStatusError, "UNKNOWN"),
        },
        pidLiveness: [{ field: "supervisorPid", pid: process.pid, state: "alive" }],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/watchdog-error.json",
        file: "watchdog-error.json",
        value: {
          schemaVersion: 1,
          executionId: "execution-1",
          requestHash: "request-hash",
          failedAt: "2026-08-31T00:00:00.000Z",
          ...statusErrorMetadata(secretWatchdogError, "UNKNOWN"),
        },
        pidLiveness: [],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-1/watchdog-ready.json",
        file: "watchdog-ready.json",
        value: {
          schemaVersion: 1,
          executionId: "execution-1",
          supervisorPid: process.pid,
          readyAt: "2026-08-31T00:00:00.000Z",
        },
        pidLiveness: [{ field: "supervisorPid", pid: process.pid, state: "alive" }],
      },
      {
        path: "autopilot-supervisor-fixture/runs/run-1/executions/execution-2/status.json",
        file: "status.json",
        value: {
          schemaVersion: 1,
          executionId: "execution-2",
          state: "state-unknown",
          ...statusErrorMetadata(knownStatusError, "JOB_QUERY_UNCONFIRMED"),
        },
        pidLiveness: [],
      },
    ],
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /hunter2|broker-secret|private output|SECRET_TOKEN|canonical lifecycle/u);
  assert.doesNotMatch(serialized, /status-start-secret|completion-exit-secret|result-nested-secret|watchdog-request-secret/u);
});

test("Windows diagnostic collector continues past an unreadable execution subtree", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-diagnostics-unreadable-test-"));
  const readable = join(root, "autopilot-readable", "executions", "execution-1");
  const unreadable = join(root, "autopilot-unreadable", "executions");
  const output = join(root, "diagnostics", "windows.json");
  await mkdir(readable, { recursive: true });
  await mkdir(unreadable, { recursive: true });
  await writeFile(join(readable, "status.json"), JSON.stringify({ schemaVersion: 1, state: "running" }));
  await chmod(unreadable, 0o000);

  try {
    await runChecked({
      executable: process.execPath,
      arguments: [collector, "--root", root, "--output", output],
      cwd: root,
    });
  } finally {
    await chmod(unreadable, 0o700);
  }
  const report: unknown = JSON.parse(await readFile(output, "utf8"));

  assert.deepEqual(report, {
    schemaVersion: 1,
    diagnostics: [
      {
        path: "autopilot-readable/executions/execution-1/status.json",
        file: "status.json",
        value: { schemaVersion: 1, state: "running" },
        pidLiveness: [],
      },
      {
        path: "autopilot-unreadable/executions",
        kind: "subtree",
        readState: "unavailable",
      },
    ],
  });
});
