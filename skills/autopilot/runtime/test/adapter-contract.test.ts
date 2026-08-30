import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdapterMessage, type ExecutionRequest } from "../src/adapter-protocol.js";
import { CliHarnessAdapter, parseReviewResult } from "../src/adapter-process.js";
import { runProcess } from "../src/process.js";
import { attemptContextFixture } from "./helpers.js";

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

test("process deadlines terminate inherited descendant handles", async () => {
  const startedAt = Date.now();
  await assert.rejects(runProcess({
    executable: process.execPath,
    arguments: [
      "-e",
      `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "inherit" }); setTimeout(() => {}, 10000);`,
    ],
    cwd: process.cwd(),
    idleTimeoutMs: 20,
    timeoutMs: 5_000,
  }), /exceeded its deadline/);

  assert.ok(Date.now() - startedAt < 5_000);
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
