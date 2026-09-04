import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExecutionRequest } from "../src/adapter-protocol.js";
import { CliHarnessAdapter } from "../src/adapter-process.js";
import { CodexAppServerAdapter } from "../adapters/codex/app-server.js";
import { attemptContextFixture, writeNodeExecutable } from "./helpers.js";

const FAKE_CODEX = `#!/usr/bin/env node
const mode = ${JSON.stringify("MODE")};
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.151.0\\n");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.stdout.write("Usage: codex app-server\\n");
  process.exit(0);
}
if (process.argv.includes("--review")) {
  process.stdout.write("direct review\\n");
  process.exit(0);
}
if (mode.startsWith("ignore-term")) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
  process.getBuiltinModule("node:fs").writeFileSync("fake.pid", String(process.pid));
}
let buffer = "";
let threadParams;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const terminal = (status, text = "") => {
  const items = text === "" ? [] : [{ type: "agentMessage", id: "agent-1", text }];
  return { method: "turn/completed", params: {
    threadId: "thread-1",
    turn: { id: "turn-1", status, items, error: status === "failed" ? { message: "failed" } : null },
  } };
};
const complete = (status, text = "") => send(terminal(status, text));
const handle = (message) => {
  if (message.method === "initialize") {
    if (mode === "stdin-error") process.stdin.destroy();
    send({ id: message.id, result: {
      userAgent: "fake", codexHome: process.cwd(), platformFamily: "test", platformOs: "test",
    } });
    if (mode === "stdin-error") setTimeout(() => {}, 10000);
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    threadParams = message.params;
    send({ id: message.id, result: {
      thread: { id: "thread-1", ephemeral: true },
      cwd: process.cwd(),
      approvalPolicy: message.params.approvalPolicy,
      sandbox: { type: message.params.sandbox === "workspace-write" ? "workspaceWrite" : "readOnly" },
    } });
    send({ method: "thread/started", params: { thread: { id: "thread-1" } } });
    return;
  }
  if (message.method === "turn/start") {
    if (mode === "admission-exit") {
      process.exit(18);
    }
    if (mode === "ignore-term-admission") {
      return;
    }
    const response = { id: message.id, result: {
      turn: { id: "turn-1", status: "inProgress", items: [], error: null },
    } };
    if (mode === "early-terminal") {
      process.stdout.write(JSON.stringify(response) + "\\n" + JSON.stringify(terminal("completed", "early completion")) + "\\n");
      return;
    }
    if (mode === "early-conflict") {
      process.stdout.write(JSON.stringify(response) + "\\n" + JSON.stringify(terminal("failed")) + "\\n" + JSON.stringify(terminal("completed")) + "\\n");
      return;
    }
    send(response);
    send({ method: "turn/started", params: {
      threadId: "thread-1", turn: { id: "turn-1", status: "inProgress", items: [], error: null },
    } });
    if (mode === "complete") {
      setImmediate(() => complete("completed", "cwdSupplied=" + Object.hasOwn(threadParams, "cwd") + ";secret=" + process.env.AUTOPILOT_CODEX_TEST_TOKEN));
    } else if (mode === "exit") {
      setImmediate(() => process.exit(17));
    } else if (mode === "wrong-terminal") {
      setImmediate(() => send({ method: "turn/completed", params: {
        threadId: "thread-1", turn: { id: "turn-other", status: "completed", items: [], error: null },
      } }));
    } else if (mode === "oversized" || mode === "ignore-term-oversized") {
      setImmediate(() => process.stdout.write(JSON.stringify({ method: "warning", params: { text: "x".repeat(4096) } }) + "\\n"));
    } else if (mode === "server-request") {
      setImmediate(() => send({ method: "item/tool/requestUserInput", id: 900, params: {
        threadId: "thread-1", turnId: "turn-1",
      } }));
    } else if (mode === "stderr-split") {
      process.stderr.write("abc");
      setTimeout(() => {
        process.stderr.write("def");
        complete("completed");
      }, 20);
    } else if (mode === "ignore-term") {
      setImmediate(() => complete("completed", "pid=" + process.pid));
    }
    return;
  }
  if (message.method === "turn/interrupt") {
    if (mode === "cancel-terminal-first") {
      complete("interrupted");
      return;
    }
    if (mode === "cancel-completed-first") {
      complete("completed", "natural completion");
      return;
    }
    if (mode === "cancel-ack-natural") {
      send({ id: message.id, result: {} });
      setImmediate(() => complete("completed", "natural completion after ack"));
      return;
    }
    send({ id: message.id, result: {} });
    setImmediate(() => complete("interrupted"));
    return;
  }
  if (message.id === 900) {
    const code = message.error && message.error.code;
    setImmediate(() => complete("completed", "serverRequestError=" + code));
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line !== "") handle(JSON.parse(line));
    newline = buffer.indexOf("\\n");
  }
});
`;

function request(worktreePath: string, attemptId: string, role: ExecutionRequest["role"] = "implementation"): ExecutionRequest {
  return {
    protocolVersion: 1,
    role,
    runId: "run",
    itemId: "item",
    attemptId,
    worktreePath,
    objective: "test Codex app-server",
    acceptanceSummary: "test",
    context: attemptContextFixture(attemptId),
    contextHash: `context-${attemptId}`,
    writableRoots: ["."],
    grants: [{ family: "credentials.use", actor: "adapter", environmentNames: ["AUTOPILOT_CODEX_TEST_TOKEN"] }],
    deadline: new Date(Date.now() + 10_000).toISOString(),
    idleTimeoutMs: 500,
    maximumLineBytes: 1024,
    maximumOutputBytes: 4096,
  };
}

async function createAdapter(mode: string): Promise<{
  readonly adapter: CodexAppServerAdapter;
  readonly worktreePath: string;
}> {
  const worktreePath = await mkdtemp(join(tmpdir(), "autopilot-codex-app-server-"));
  const executable = await writeNodeExecutable(worktreePath, "codex", FAKE_CODEX.replace('"MODE"', JSON.stringify(mode)));
  const reviewAdapter = new CliHarnessAdapter({
    name: "codex",
    executable,
    versionArguments: ["--version"],
    buildArguments: () => ["--review"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: false,
  });
  return {
    worktreePath,
    adapter: new CodexAppServerAdapter({ executable, reviewAdapter }),
  };
}

function isExecutionUnknown(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN";
}

test("Codex app-server admits an exact ephemeral turn without persisting cwd trust", async () => {
  process.env.AUTOPILOT_CODEX_TEST_TOKEN = "codex-test-secret";
  try {
    const { adapter, worktreePath } = await createAdapter("complete");

    const manifest = await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, "complete"));
    const observation = await adapter.observe(handle);

    assert.equal(manifest.adapterName, "codex-app-server");
    assert.equal(manifest.restartReattachment, false);
    assert.deepEqual(manifest.executionAssurance?.implementation, {
      schemaVersion: 1,
      owner: "harness",
      continuity: "same-harness-instance",
      terminality: "cooperative",
      admission: "single-shot",
    });
    assert.match(handle.subject?.backendId ?? "", /^codex-app-server-v2@codex-cli 0\.151\.0$/);
    assert.ok(handle.subject?.harnessInstanceId);
    assert.equal(observation.status, "completed");
    assert.match(observation.stdout, /cwdSupplied=false/);
    assert.doesNotMatch(observation.stdout, /codex-test-secret/);
    assert.match(observation.stdout, /secret=\*\*\*\*/);
  } finally {
    delete process.env.AUTOPILOT_CODEX_TEST_TOKEN;
  }
});

test("Codex app-server cancellation requires the exact interrupted turn terminal", async () => {
  const { adapter, worktreePath } = await createAdapter("cancel");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cancel"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, true);
  assert.equal(observation.status, "cancelled");
  assert.equal(observation.exitCode, 130);
});

test("Codex app-server accepts exact terminal cancellation before the interrupt reply", async () => {
  const { adapter, worktreePath } = await createAdapter("cancel-terminal-first");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cancel-terminal-first"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, true);
  assert.equal(observation.status, "cancelled");
});

test("Codex app-server reports a natural completion that wins the cancellation race", async () => {
  const { adapter, worktreePath } = await createAdapter("cancel-completed-first");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cancel-completed-first"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, false);
  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "natural completion");
});

test("Codex app-server does not treat an interrupt acknowledgment as terminal cancellation", async () => {
  const { adapter, worktreePath } = await createAdapter("cancel-ack-natural");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cancel-ack-natural"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, false);
  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "natural completion after ack");
});

test("Codex app-server rejects a handle from another harness instance", async () => {
  const { adapter, worktreePath } = await createAdapter("cancel");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "wrong-handle"));
  if (handle.subject === undefined) {
    throw new Error("Codex app-server handle did not include its exact subject");
  }
  const wrongHandle = {
    ...handle,
    subject: { ...handle.subject, harnessInstanceId: "other-instance" },
  };
  const wrongBackend = {
    ...handle,
    subject: { ...handle.subject, backendId: "other-backend" },
  };

  assert.equal((await adapter.cancel(wrongBackend)).accepted, false);
  await assert.rejects(adapter.observe(wrongHandle), isExecutionUnknown);
  await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "cancelled");
});

test("Codex app-server accepts one exact terminal that arrives with the turn response", async () => {
  const { adapter, worktreePath } = await createAdapter("early-terminal");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "early-terminal"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "early completion");
});

test("Codex app-server fails closed on conflicting pre-admission terminal events", async () => {
  const { adapter, worktreePath } = await createAdapter("early-conflict");
  await adapter.describe();

  await assert.rejects(adapter.launch(request(worktreePath, "early-conflict")), isExecutionUnknown);
});

test("Codex app-server converts an asynchronous stdin failure into unknown state", async () => {
  const { adapter, worktreePath } = await createAdapter("stdin-error");
  await adapter.describe();

  await assert.rejects(adapter.launch(request(worktreePath, "stdin-error")), isExecutionUnknown);
});

test("Codex app-server admission loss is execution-state-unknown without a subject", async () => {
  const { adapter, worktreePath } = await createAdapter("admission-exit");
  await adapter.describe();

  await assert.rejects(adapter.launch(request(worktreePath, "admission-exit")), isExecutionUnknown);
});

test("Codex app-server process loss is execution-state-unknown", async () => {
  const { adapter, worktreePath } = await createAdapter("exit");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "exit"));

  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
});

test("Codex app-server ignores a mismatched terminal identity and fails closed on continuity loss", async () => {
  const { adapter, worktreePath } = await createAdapter("wrong-terminal");
  await adapter.describe();
  const executionRequest = { ...request(worktreePath, "wrong-terminal"), idleTimeoutMs: 50 };
  const execution = adapter.launch(executionRequest).then(async (handle) => await adapter.observe(handle));

  await assert.rejects(execution, isExecutionUnknown);
});

test("Codex app-server enforces the inbound protocol line bound", async () => {
  const { adapter, worktreePath } = await createAdapter("oversized");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "oversized"));

  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
});

test("Codex app-server redacts a credential split across bounded stderr chunks", async () => {
  process.env.AUTOPILOT_CODEX_TEST_TOKEN = "abcdef";
  try {
    const { adapter, worktreePath } = await createAdapter("stderr-split");
    await adapter.describe();
    const executionRequest = { ...request(worktreePath, "stderr-split"), maximumOutputBytes: 2 };
    const handle = await adapter.launch(executionRequest);

    const observation = await adapter.observe(handle);

    assert.equal(observation.status, "completed");
    assert.doesNotMatch(observation.stderr, /[a-f]/);
    assert.equal(observation.truncated, true);
  } finally {
    delete process.env.AUTOPILOT_CODEX_TEST_TOKEN;
  }
});

test("Codex app-server force-stops a direct child that ignores graceful cleanup", {
  skip: process.platform === "win32",
}, async () => {
  const { adapter, worktreePath } = await createAdapter("ignore-term");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "ignore-term"));

  const observation = await adapter.observe(handle);
  const pid = Number.parseInt(observation.stdout.replace("pid=", ""), 10);

  assert.equal(observation.status, "completed");
  assert.ok(Number.isSafeInteger(pid));
  assert.throws(() => process.kill(pid, 0), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "ESRCH"
  );
});

test("Codex app-server awaits forced direct-child cleanup on unknown admission, timeout, and protocol paths", {
  skip: process.platform === "win32",
}, async () => {
  for (const scenario of ["admission", "timeout", "oversized"] as const) {
    const { adapter, worktreePath } = await createAdapter(`ignore-term-${scenario}`);
    await adapter.describe();
    const baseRequest = request(worktreePath, `ignore-term-${scenario}`);
    const executionRequest = scenario === "admission"
      ? { ...baseRequest, idleTimeoutMs: 50 }
      : scenario === "timeout"
        ? { ...baseRequest, deadline: new Date(Date.now() + 2_000).toISOString() }
        : baseRequest;

    if (scenario === "admission") {
      await assert.rejects(adapter.launch(executionRequest), isExecutionUnknown);
    } else {
      const handle = await adapter.launch(executionRequest);
      await assert.rejects(adapter.observe(handle), isExecutionUnknown);
    }
    const pid = Number.parseInt(await readFile(join(worktreePath, "fake.pid"), "utf8"), 10);

    assert.throws(() => process.kill(pid, 0), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ESRCH"
    );
  }
});

test("Codex app-server denies server requests without expanding unattended authority", async () => {
  const { adapter, worktreePath } = await createAdapter("server-request");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "server-request"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "serverRequestError=-32601");
});

test("Codex app-server keeps independent review on the direct CLI adapter", async () => {
  const { adapter, worktreePath } = await createAdapter("complete");
  await adapter.describe();

  const handle = await adapter.launch(request(worktreePath, "review", "review"));
  const observation = await adapter.observe(handle);

  assert.equal(handle.subject?.backendId, "direct-process");
  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout, "direct review\n");
});
