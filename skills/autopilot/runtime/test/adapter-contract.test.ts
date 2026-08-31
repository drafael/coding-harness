import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { parseAdapterMessage, type ExecutionRequest } from "../src/adapter-protocol.js";
import { CliHarnessAdapter, parseReviewResult } from "../src/adapter-process.js";
import { boundUtf8, runProcess, terminateProcessTree } from "../src/process.js";
import { windowsRestartReattachmentAvailable } from "../src/windows-job.js";
import { attemptContextFixture, writeNodeExecutable } from "./helpers.js";

test("UTF-8 output bounds retain only complete code points", () => {
  const bounded = boundUtf8("é", 1);

  assert.equal(bounded.value, "");
  assert.equal(Buffer.byteLength(bounded.value), 0);
  assert.equal(bounded.truncated, true);
});

test("Windows CLI adapters advertise restart reattachment only with the verified x64 helper", {
  skip: process.platform !== "win32",
}, async () => {
  const adapter = new CliHarnessAdapter({
    name: "fake",
    executable: process.execPath,
    versionArguments: ["--version"],
    buildArguments: () => ["--version"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: false,
  });

  assert.equal((await adapter.describe()).restartReattachment, await windowsRestartReattachmentAvailable());
});

test("Windows supervised launch and reattach fail closed when the packaged helper is unavailable", {
  skip: process.platform !== "win32" || await windowsRestartReattachmentAvailable(),
}, async () => {
  const adapter = new CliHarnessAdapter({
    name: "fake",
    executable: process.execPath,
    versionArguments: ["--version"],
    buildArguments: () => ["--version"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: false,
  });
  const supervisionDirectory = await mkdtemp(join(tmpdir(), "autopilot-missing-windows-helper-"));
  const request: ExecutionRequest = {
    protocolVersion: 1,
    role: "implementation",
    runId: "run",
    itemId: "item",
    attemptId: "missing-helper",
    worktreePath: process.cwd(),
    objective: "test",
    acceptanceSummary: "test",
    context: attemptContextFixture("missing-helper"),
    contextHash: "context-hash",
    writableRoots: ["."],
    grants: [],
    deadline: new Date(Date.now() + 10_000).toISOString(),
    idleTimeoutMs: 5_000,
    maximumLineBytes: 1024,
    maximumOutputBytes: 4096,
    supervisionDirectory,
  };
  const isUnknown = (error: unknown): boolean =>
    error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN";

  assert.equal((await adapter.describe()).restartReattachment, false);
  await assert.rejects(adapter.launch(request), isUnknown);
  await assert.rejects(adapter.reattach(request), isUnknown);
});

test("adapter protocol parses normalized lifecycle messages", () => {
  const message = parseAdapterMessage(JSON.stringify({
    protocolVersion: 1,
    type: "terminal",
    executionId: "execution-1",
    status: "completed",
    exitCode: 0,
  }), 1024);

  assert.equal(message.type, "terminal");
});

test("adapter protocol rejects old, malformed, and oversized messages", () => {
  assert.throws(() => parseAdapterMessage("not json", 1024), /not valid JSON/);
  assert.throws(() => parseAdapterMessage(JSON.stringify({ protocolVersion: 2, type: "started", executionId: "x" }), 1024), /not supported/);
  assert.throws(() => parseAdapterMessage(JSON.stringify({ protocolVersion: 1, type: "started", executionId: "x".repeat(100) }), 10), /exceeds/);
});

test("process runner streams complete stderr activity lines", async () => {
  const lines: string[] = [];

  await runProcess({
    executable: process.execPath,
    arguments: ["-e", "process.stderr.write('first\\nsecond\\n')"],
    cwd: process.cwd(),
    onStderrLine: (line) => lines.push(line),
  });

  assert.deepEqual(lines, ["first", "second"]);
});

test("silent adapter process reaches the idle deadline", async () => {
  await assert.rejects(runProcess({
    executable: process.execPath,
    arguments: ["-e", "setTimeout(() => {}, 10000)"],
    cwd: process.cwd(),
    idleTimeoutMs: 20,
    timeoutMs: 5_000,
  }), /exceeded its deadline/);
});

test("process deadlines terminate descendants before reporting completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-process-tree-"));
  const marker = join(directory, "descendant-survived");
  const descendant = `setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 300); setTimeout(() => {}, 1000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}, ${JSON.stringify(marker)}], { stdio: "ignore" }); setTimeout(() => {}, 10000);`;

  await assert.rejects(runProcess({
    executable: process.execPath,
    arguments: ["-e", parent],
    cwd: process.cwd(),
    idleTimeoutMs: 20,
    timeoutMs: 5_000,
  }), /exceeded its deadline/);
  await new Promise((resolve) => setTimeout(resolve, 500));

  await assert.rejects(readFile(marker), /ENOENT/);
});

test("process spawn callback failure terminates the new process tree before rejecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-process-bootstrap-failure-"));
  const marker = join(directory, "process-survived");
  const child = `setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 300); setTimeout(() => {}, 10000);`;

  await assert.rejects(runProcess({
    executable: process.execPath,
    arguments: ["-e", child, marker],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    onSpawn: () => {
      throw new Error("bootstrap publication failed");
    },
  }), /bootstrap publication failed/);
  await new Promise((resolve) => setTimeout(resolve, 500));

  await assert.rejects(readFile(marker), /ENOENT/);
});

test("process deadlines wait for signal-resistant descendants to be force-stopped", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-process-tree-resistant-"));
  const marker = join(directory, "descendant-survived");
  const descendant = `process.on("SIGTERM", () => {}); setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 5500); setTimeout(() => {}, 10000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}, ${JSON.stringify(marker)}], { stdio: "ignore" }); setTimeout(() => {}, 10000);`;
  const startedAt = Date.now();

  await assert.rejects(runProcess({
    executable: process.execPath,
    arguments: ["-e", parent],
    cwd: process.cwd(),
    idleTimeoutMs: 100,
    timeoutMs: 10_000,
  }), /exceeded its deadline/);
  assert.ok(Date.now() - startedAt >= 5_000);
  await new Promise((resolve) => setTimeout(resolve, 750));

  await assert.rejects(readFile(marker), /ENOENT/);
});

test("Windows process-tree termination failure remains execution-state-unknown", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-taskkill-failure-"));
  const bin = join(directory, "bin");
  await mkdir(bin, { recursive: true });
  await writeNodeExecutable(bin, "taskkill", "#!/usr/bin/env node\nprocess.exit(1);\n");
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${priorPath ?? ""}`;
  try {
    await assert.rejects(terminateProcessTree(999_999, "fake"), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN"
    );
  } finally {
    process.env.PATH = priorPath;
  }
});

test("adapter observation redacts credential-like environment values", async () => {
  process.env.AUTOPILOT_TEST_TOKEN = "test-secret-value";
  try {
    const adapter = new CliHarnessAdapter({
      name: "fake",
      executable: process.execPath,
      versionArguments: ["--version"],
      buildArguments: () => ["-e", "console.log(JSON.stringify({value: process.env.AUTOPILOT_TEST_TOKEN}))"],
      assurance: "cooperative",
      maxConcurrency: 1,
      cancellation: true,
      limitations: [],
      expectsJsonLines: true,
    });
    const request: ExecutionRequest = {
      protocolVersion: 1,
      role: "implementation",
      runId: "run",
      itemId: "item",
      attemptId: "attempt",
      worktreePath: process.cwd(),
      objective: "test",
      acceptanceSummary: "test",
      context: attemptContextFixture("attempt"),
      contextHash: "context-hash",
      writableRoots: ["."],
      grants: [{ family: "credentials.use", actor: "adapter", environmentNames: ["AUTOPILOT_TEST_TOKEN"] }],
      deadline: new Date(Date.now() + 10_000).toISOString(),
      idleTimeoutMs: 5_000,
      maximumLineBytes: 1024,
      maximumOutputBytes: 4096,
    };

    const handle = await adapter.launch(request);
    const observation = await adapter.observe(handle);

    assert.doesNotMatch(observation.stdout, /test-secret-value/);
    assert.match(observation.stdout, /\*\*\*\*/);
  } finally {
    delete process.env.AUTOPILOT_TEST_TOKEN;
  }
});

test("supervised reattachment redacts and re-bounds an explicitly granted one-byte credential", {
  skip: process.platform === "win32",
}, async () => {
  const supervisionDirectory = await mkdtemp(join(tmpdir(), "autopilot-adapter-credential-"));
  process.env.S = "a";
  process.env.DSN = "long-credential-value-".repeat(8);
  const longCredentialPrefix = process.env.DSN.slice(0, 40);
  const createAdapter = (): CliHarnessAdapter => new CliHarnessAdapter({
    name: "fake",
    executable: process.execPath,
    versionArguments: ["--version"],
    buildArguments: () => ["-e", "setTimeout(() => console.log(process.env.DSN + process.env.S.repeat(100)), 100)"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: true,
  });
  const request: ExecutionRequest = {
    protocolVersion: 1,
    role: "implementation",
    runId: "run",
    itemId: "item",
    attemptId: "supervised-credential-attempt",
    worktreePath: process.cwd(),
    objective: "test",
    acceptanceSummary: "test",
    context: attemptContextFixture("supervised-credential-attempt"),
    contextHash: "context-hash",
    writableRoots: ["."],
    grants: [{ family: "credentials.use", actor: "adapter", environmentNames: ["DSN", "S"] }],
    deadline: new Date(Date.now() + 10_000).toISOString(),
    idleTimeoutMs: 5_000,
    maximumLineBytes: 1024,
    maximumOutputBytes: 64,
    supervisionDirectory,
  };

  try {
    await createAdapter().launch(request);
    const reattachedAdapter = createAdapter();
    const handle = await reattachedAdapter.reattach(request);
    assert.ok(handle !== undefined);
    const observation = await reattachedAdapter.observe(handle);
    const retainedResult = JSON.parse(
      await readFile(join(handle.supervisor?.directory ?? "", "result.json"), "utf8"),
    ) as { stdout: string; truncated: boolean };

    assert.doesNotMatch(observation.stdout, /a/);
    assert.doesNotMatch(observation.stdout, new RegExp(longCredentialPrefix));
    assert.match(observation.stdout, /\*\*\*\*/);
    assert.ok(Buffer.byteLength(observation.stdout) <= 64);
    assert.ok(Buffer.byteLength(retainedResult.stdout) <= 64);
    assert.equal(retainedResult.truncated, true);
  } finally {
    delete process.env.S;
    delete process.env.DSN;
  }
});

test("adapter cancellation is reported as cancelled rather than timed out", async () => {
  const adapter = new CliHarnessAdapter({
    name: "fake",
    executable: process.execPath,
    versionArguments: ["--version"],
    buildArguments: () => ["-e", "setInterval(() => {}, 1000)"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: false,
  });
  const request: ExecutionRequest = {
    protocolVersion: 1,
    role: "implementation",
    runId: "run",
    itemId: "item",
    attemptId: "cancelled-attempt",
    worktreePath: process.cwd(),
    objective: "test cancellation",
    acceptanceSummary: "cancelled",
    context: attemptContextFixture("cancelled-attempt"),
    contextHash: "context-hash",
    writableRoots: ["."],
    grants: [],
    deadline: new Date(Date.now() + 10_000).toISOString(),
    idleTimeoutMs: 5_000,
    maximumLineBytes: 1024,
    maximumOutputBytes: 4096,
  };

  const handle = await adapter.launch(request);
  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, true);
  assert.equal(observation.status, "cancelled");
});

test("review result parser accepts one structured marker and rejects contradictory output", () => {
  const clean = parseReviewResult(JSON.stringify({
    type: "message",
    text: 'AUTOPILOT_REVIEW_RESULT:{"verdict":"clean","findings":[]}',
  }));
  const findings = parseReviewResult(JSON.stringify({
    type: "message",
    text: 'AUTOPILOT_REVIEW_RESULT:{"verdict":"findings","findings":[{"path":"src/a.ts","line":4,"message":"Wrong branch"}]}',
  }));
  const contradictory = parseReviewResult(JSON.stringify({
    type: "message",
    text: 'AUTOPILOT_REVIEW_RESULT:{"verdict":"clean","findings":[{"message":"still broken"}]}',
  }));
  const inconclusive = parseReviewResult(JSON.stringify({
    type: "message",
    text: 'AUTOPILOT_REVIEW_RESULT:{"verdict":"inconclusive","findings":[]}',
  }));
  const withPromptEcho = parseReviewResult([
    JSON.stringify({ type: "request", text: "Return AUTOPILOT_REVIEW_RESULT:{template}" }),
    JSON.stringify({ type: "message", text: 'AUTOPILOT_REVIEW_RESULT:{"verdict":"clean","findings":[]}' }),
  ].join("\n"));

  assert.deepEqual(clean, { verdict: "clean", findings: [] });
  assert.equal(findings?.findings[0]?.path, "src/a.ts");
  assert.deepEqual(inconclusive, { verdict: "inconclusive", findings: [] });
  assert.deepEqual(withPromptEcho, { verdict: "clean", findings: [] });
  assert.equal(contradictory, undefined);
});

test("adapter protocol parses a complete capability manifest", () => {
  const message = parseAdapterMessage(JSON.stringify({
    protocolVersion: 1,
    type: "capabilities",
    manifest: {
      protocolVersion: 1,
      adapterName: "fake",
      adapterVersion: "1",
      harnessVersion: "1",
      families: ["files.read"],
      assurance: "cooperative",
      unattended: true,
      maxConcurrency: 1,
      eventStreaming: true,
      cancellation: true,
      restartReattachment: false,
      restrictions: "cooperative",
      limitations: [],
    },
  }), 4096);

  assert.equal(message.type, "capabilities");
});
