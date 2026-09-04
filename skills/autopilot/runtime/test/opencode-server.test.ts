import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { OpenCodeServerAdapter } from "../adapters/opencode/server.js";
import type { ExecutionRequest } from "../src/adapter-protocol.js";
import { CliHarnessAdapter } from "../src/adapter-process.js";
import { attemptContextFixture, writeNodeExecutable } from "./helpers.js";

const FAKE_OPENCODE = `#!/usr/bin/env node
const mode = ${JSON.stringify("MODE")};
const fs = process.getBuiltinModule("node:fs");
const http = process.getBuiltinModule("node:http");
if (process.argv.includes("--version")) {
  process.stdout.write("1.18.25\\n");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.stdout.write("Usage: opencode serve\\n");
  process.exit(0);
}
if (process.argv.includes("run")) {
  process.stdout.write("direct review\\n");
  process.exit(0);
}
const version = "1.18.25";
const directory = process.cwd();
const sessionID = "ses_test";
const assistantID = "msg_assistant";
const streams = new Set();
const messages = new Map();
if (process.platform === "win32") {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
}
let completed = false;
const event = (type, properties = {}) => ({ type, properties });
const emit = (value) => {
  const data = "data: " + JSON.stringify(value) + "\\n\\n";
  for (const response of streams) response.write(data);
};
const json = (response, status, value) => {
  const body = value === undefined ? "" : JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
};
const readBody = async (request) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body === "" ? {} : JSON.parse(body);
};
const assistant = (error, parentID = sessionID) => ({
  info: {
    id: assistantID,
    sessionID,
    role: "assistant",
    parentID,
    time: { created: Date.now(), completed: Date.now() },
    finish: error ? "unknown" : "stop",
    ...(error ? { error } : {}),
  },
  parts: [{ type: "text", text: "completed secret=" + (process.env.AUTOPILOT_OPENCODE_TEST_TOKEN ?? "") }],
});
const complete = (error, parentID) => {
  if (completed) return;
  completed = true;
  const value = assistant(error, parentID ?? [...messages.keys()][0]);
  messages.set(assistantID, value);
  emit(event("message.updated", { sessionID, info: value.info }));
  emit(event("session.status", { sessionID, status: { type: "idle" } }));
};
const server = http.createServer(async (request, response) => {
  const expectedAuth = "Basic " + Buffer.from("autopilot:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
  if (request.headers.authorization !== expectedAuth || request.headers["x-opencode-directory"] !== directory) {
    json(response, 401, { error: "bad auth or directory" });
    return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/global/health") {
    json(response, 200, { healthy: true, version: mode === "wrong-version" ? "9.9.9" : version });
    return;
  }
  if (url.pathname === "/path") {
    json(response, 200, { directory, worktree: mode === "wrong-path" ? process.getBuiltinModule("node:os").tmpdir() : directory });
    return;
  }
  if (url.pathname === "/event") {
    response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
    streams.add(response);
    response.on("close", () => streams.delete(response));
    response.write("data: " + JSON.stringify(event("server.connected", {})) + "\\n\\n");
    return;
  }
  if (url.pathname === "/session" && request.method === "POST") {
    const input = await readBody(request);
    if (!Array.isArray(input.permission) || input.permission.at(-1)?.permission !== "external_directory"
      || process.env.OPENCODE_DISABLE_AUTOUPDATE !== "1") {
      json(response, 400, { error: "missing permissions or auto-update fence" });
      return;
    }
    json(response, 200, { id: sessionID, version, directory });
    return;
  }
  if (url.pathname === "/session/" + sessionID && request.method === "GET") {
    json(response, 200, {
      id: mode === "wrong-session" ? "ses_other" : sessionID,
      version,
      directory,
    });
    return;
  }
  if (url.pathname === "/session/" + sessionID + "/prompt_async") {
    const input = await readBody(request);
    messages.set(input.messageID, {
      info: { id: input.messageID, sessionID, role: "user", time: { created: Date.now() } },
      parts: input.parts,
    });
    if (mode === "response-loss") {
      request.socket.destroy();
    } else {
      json(response, 204);
    }
    setImmediate(() => {
      emit(event("session.status", { sessionID, status: { type: "busy" } }));
      if (mode === "disconnect") {
        for (const stream of streams) stream.end();
      } else if (mode === "malformed-event") {
        for (const stream of streams) stream.write("data: {\\n\\n");
      } else if (mode === "oversized-event") {
        for (const stream of streams) stream.write("data: " + "x".repeat(4096) + "\\n\\n");
      } else if (mode === "question") {
        emit(event("question.asked", { id: "que_test", sessionID, questions: [] }));
      } else if (mode === "permission") {
        emit(event("permission.asked", { id: "per_test", sessionID, permission: "bash", patterns: ["*"] }));
      } else if (mode === "stderr-split") {
        const secret = process.env.AUTOPILOT_OPENCODE_TEST_TOKEN ?? "";
        process.stderr.write(secret.slice(0, 3));
        setTimeout(() => {
          process.stderr.write(secret.slice(3));
          complete();
        }, 20);
      } else if (mode === "wrong-parent") {
        setTimeout(() => complete(undefined, "msg_other"), 10);
      } else if (mode === "session-error") {
        emit(event("session.error", { sessionID, error: { name: "ProviderError", message: "provider failed" } }));
        emit(event("session.status", { sessionID, status: { type: "idle" } }));
      } else if (mode === "assistant-error") {
        setTimeout(() => complete({ name: "ProviderError", message: "provider failed" }), 10);
      } else if (mode === "exit") {
        process.exit(17);
      } else if (mode === "instance-disposed") {
        emit(event("server.instance.disposed", { directory }));
      } else if (mode === "conflicting-terminals") {
        const first = assistant(undefined, input.messageID);
        const second = {
          info: { ...first.info, id: "msg_assistant_2", time: { ...first.info.time, completed: Date.now() + 1 } },
          parts: first.parts,
        };
        messages.set(assistantID, first);
        messages.set("msg_assistant_2", second);
        emit(event("message.updated", { sessionID, info: first.info }));
        emit(event("message.updated", { sessionID, info: second.info }));
        emit(event("session.status", { sessionID, status: { type: "idle" } }));
      } else if (mode === "unrelated-events") {
        const intermediate = {
          info: {
            id: "msg_tool_step",
            sessionID,
            role: "assistant",
            parentID: input.messageID,
            time: { created: Date.now(), completed: Date.now() },
            finish: "tool-calls",
          },
          parts: [],
        };
        messages.set("msg_tool_step", intermediate);
        emit(event("session.status", { sessionID: "ses_other", status: { type: "idle" } }));
        emit(event("message.updated", { sessionID, info: intermediate.info }));
        emit(event("session.status", { sessionID, status: { type: "busy" } }));
        setTimeout(() => complete(), 10);
      } else if (!mode.startsWith("hang") && mode !== "natural-wins" && mode !== "abort-ack-only") {
        setTimeout(() => complete(), 10);
      }
    });
    return;
  }
  const messagePrefix = "/session/" + sessionID + "/message/";
  if (url.pathname.startsWith(messagePrefix)) {
    const id = url.pathname.slice(messagePrefix.length);
    const value = messages.get(id);
    if (!value) {
      json(response, 404, { error: "missing" });
      return;
    }
    if (id === assistantID && mode === "fresh-conflict") {
      json(response, 200, { ...value, info: { ...value.info, parentID: "msg_conflict" } });
      return;
    }
    if (id !== assistantID && mode === "wrong-user-content") {
      json(response, 200, { ...value, parts: [{ type: "text", text: "changed" }] });
      return;
    }
    json(response, 200, value);
    return;
  }
  if (url.pathname === "/session/" + sessionID + "/abort" && request.method === "POST") {
    json(response, 200, true);
    if (mode === "natural-wins") {
      setImmediate(() => complete());
    } else if (mode !== "abort-ack-only") {
      setImmediate(() => complete({ name: "MessageAbortedError", message: "Aborted" }));
    }
    return;
  }
  if (url.pathname === "/question/que_test/reject" && request.method === "POST") {
    fs.writeFileSync("question-rejected", "yes");
    json(response, 204);
    return;
  }
  if (url.pathname === "/session/" + sessionID + "/permissions/per_test" && request.method === "POST") {
    const input = await readBody(request);
    if (input.response === "reject") fs.writeFileSync("permission-rejected", "yes");
    json(response, 200, true);
    return;
  }
  json(response, 404, { error: "not found", path: url.pathname });
});
if (mode.includes("ignore-term")) {
  fs.writeFileSync("fake.pid", String(process.pid));
  process.on("SIGTERM", () => {
    fs.writeFileSync("sigterm-seen", "yes");
    process.exit(0);
  });
}
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write("opencode server listening on http://127.0.0.1:" + address.port + "\\n");
});
`;

function request(
  worktreePath: string,
  attemptId: string,
  role: ExecutionRequest["role"] = "implementation",
  timeoutMs = 10_000,
): ExecutionRequest {
  return {
    protocolVersion: 1,
    role,
    runId: "run",
    itemId: "item",
    attemptId,
    worktreePath,
    objective: "test OpenCode server",
    acceptanceSummary: "test",
    context: attemptContextFixture(attemptId),
    contextHash: `context-${attemptId}`,
    writableRoots: ["."],
    grants: [{ family: "credentials.use", actor: "adapter", environmentNames: ["AUTOPILOT_OPENCODE_TEST_TOKEN"] }],
    deadline: new Date(Date.now() + timeoutMs).toISOString(),
    idleTimeoutMs: Math.min(500, timeoutMs),
    maximumLineBytes: 2_048,
    maximumOutputBytes: 4_096,
  };
}

async function createAdapter(mode: string): Promise<{
  readonly adapter: OpenCodeServerAdapter;
  readonly worktreePath: string;
}> {
  const worktreePath = await mkdtemp(join(tmpdir(), "autopilot-opencode-server-"));
  const executable = await writeNodeExecutable(worktreePath, "opencode", FAKE_OPENCODE.replace('"MODE"', JSON.stringify(mode)));
  const reviewAdapter = new CliHarnessAdapter({
    name: "opencode",
    executable,
    versionArguments: ["--version"],
    buildArguments: () => ["run"],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [],
    expectsJsonLines: false,
  });
  return {
    worktreePath,
    adapter: new OpenCodeServerAdapter({ executable, reviewAdapter }),
  };
}

function isExecutionUnknown(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN";
}

test("OpenCode server admits one exact session and reconciles completion", async () => {
  process.env.AUTOPILOT_OPENCODE_TEST_TOKEN = "opencode-test-secret";
  try {
    const { adapter, worktreePath } = await createAdapter("complete");

    const manifest = await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, "complete"));
    const observation = await adapter.observe(handle);

    assert.equal(manifest.adapterName, "opencode-server");
    assert.equal(manifest.restartReattachment, false);
    assert.deepEqual(manifest.executionAssurance?.implementation, {
      schemaVersion: 1,
      owner: "harness",
      continuity: "same-harness-instance",
      terminality: "cooperative",
      admission: "single-shot",
    });
    assert.equal(handle.subject?.backendId, "opencode-server@1.18.25");
    assert.ok(handle.subject?.harnessInstanceId);
    assert.equal(observation.status, "completed");
    assert.match(observation.stdout, /completed secret=\*\*\*\*/);
    assert.doesNotMatch(observation.stdout, /opencode-test-secret/);
  } finally {
    delete process.env.AUTOPILOT_OPENCODE_TEST_TOKEN;
  }
});

test("OpenCode server accepts cancellation only after exact MessageAbortedError reconciliation", async () => {
  const { adapter, worktreePath } = await createAdapter("hang");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cancel"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, true);
  assert.equal(observation.status, "cancelled");
  assert.equal(observation.exitCode, 130);
});

test("OpenCode server lets natural completion win cancellation", async () => {
  const { adapter, worktreePath } = await createAdapter("natural-wins");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "natural-wins"));

  const cancellation = await adapter.cancel(handle);
  const observation = await adapter.observe(handle);

  assert.equal(cancellation.accepted, false);
  assert.equal(observation.status, "completed");
});

test("OpenCode server rejects wrong subject identities", async () => {
  const { adapter, worktreePath } = await createAdapter("hang");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "wrong-subject", "implementation", 5_000));
  assert.ok(handle.subject);
  const wrong = {
    ...handle,
    subject: { ...handle.subject, backendId: "opencode-server@other" },
  };

  assert.deepEqual(await adapter.cancel(wrong), { protocolVersion: 1, accepted: false });
  await assert.rejects(adapter.observe(wrong), isExecutionUnknown);
  assert.deepEqual(await adapter.cancel(handle), { protocolVersion: 1, accepted: true });
  assert.equal((await adapter.observe(handle)).status, "cancelled");
});

for (const [mode, label] of [
  ["disconnect", "event-stream loss"],
  ["malformed-event", "malformed SSE JSON"],
  ["oversized-event", "oversized SSE events"],
  ["wrong-parent", "wrong parent identity"],
  ["fresh-conflict", "fresh message conflicts"],
  ["wrong-session", "fresh session conflicts"],
  ["wrong-user-content", "fresh user-message content conflicts"],
  ["conflicting-terminals", "conflicting terminal assistants"],
  ["session-error", "session errors without a fresh terminal message"],
  ["exit", "server-process loss"],
  ["instance-disposed", "worktree-instance disposal"],
] as const) {
  test(`OpenCode server fails closed on ${label}`, async () => {
    const { adapter, worktreePath } = await createAdapter(mode);
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, mode));

    await assert.rejects(adapter.observe(handle), isExecutionUnknown);
  });
}

test("OpenCode server ignores unrelated events and nonterminal tool-step assistants", async () => {
  const { adapter, worktreePath } = await createAdapter("unrelated-events");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "unrelated-events"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "completed");
});

test("OpenCode server maps a fresh exact assistant error to failure", async () => {
  const { adapter, worktreePath } = await createAdapter("assistant-error");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "assistant-error"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "failed");
  assert.match(observation.stderr, /provider failed/);
});

for (const [mode, marker] of [
  ["question", "question-rejected"],
  ["permission", "permission-rejected"],
] as const) {
  test(`OpenCode server rejects unattended ${mode} requests and fails closed`, async () => {
    const { adapter, worktreePath } = await createAdapter(mode);
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, mode));

    await assert.rejects(adapter.observe(handle), isExecutionUnknown);
    assert.equal(await readFile(join(worktreePath, marker), "utf8"), "yes");
  });
}

test("OpenCode server treats prompt response loss as unknown admission", async () => {
  const { adapter, worktreePath } = await createAdapter("response-loss");
  await adapter.describe();

  await assert.rejects(adapter.launch(request(worktreePath, "response-loss")), isExecutionUnknown);
});

for (const [mode, label] of [
  ["wrong-version", "observed version"],
  ["wrong-path", "observed worktree"],
] as const) {
  test(`OpenCode server rejects admission with a changed ${label}`, async () => {
    const { adapter, worktreePath } = await createAdapter(mode);
    await adapter.describe();

    await assert.rejects(adapter.launch(request(worktreePath, mode)), isExecutionUnknown);
  });
}

test("OpenCode server does not accept abort acknowledgment without an exact aborted message", async () => {
  const { adapter, worktreePath } = await createAdapter("abort-ack-only");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "abort-ack-only", "implementation", 1_000));
  const observation = adapter.observe(handle);

  await assert.rejects(adapter.cancel(handle), isExecutionUnknown);
  await assert.rejects(observation, isExecutionUnknown);
});

test("OpenCode server redacts secrets split across stderr chunks", async () => {
  process.env.AUTOPILOT_OPENCODE_TEST_TOKEN = "abcdef";
  try {
    const { adapter, worktreePath } = await createAdapter("stderr-split");
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, "stderr-split"));

    const observation = await adapter.observe(handle);

    assert.equal(observation.status, "completed");
    assert.equal(observation.stderr, "****");
    assert.doesNotMatch(observation.stdout, /abcdef/);
  } finally {
    delete process.env.AUTOPILOT_OPENCODE_TEST_TOKEN;
  }
});

test("OpenCode server awaits cleanup after idle continuity loss", {
  skip: process.platform === "win32",
}, async () => {
  const { adapter, worktreePath } = await createAdapter("hang-ignore-term");
  await adapter.describe();
  const baseRequest = request(worktreePath, "idle-cleanup", "implementation", 5_000);
  const handle = await adapter.launch({ ...baseRequest, idleTimeoutMs: 120 });

  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
  await delay(30);
  assert.equal(await readFile(join(worktreePath, "sigterm-seen"), "utf8"), "yes");
  const pid = Number.parseInt(await readFile(join(worktreePath, "fake.pid"), "utf8"), 10);
  assert.throws(() => process.kill(pid, 0), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "ESRCH"
  );
});

test("OpenCode server fails closed at the attempt deadline", async () => {
  const { adapter, worktreePath } = await createAdapter("hang");
  await adapter.describe();
  const baseRequest = request(worktreePath, "deadline", "implementation", 1_000);
  const handle = await adapter.launch({ ...baseRequest, idleTimeoutMs: 5_000 });

  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
});

test("OpenCode server awaits cleanup after normal completion", {
  skip: process.platform === "win32",
}, async () => {
  const { adapter, worktreePath } = await createAdapter("complete-ignore-term");
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "complete-cleanup"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "completed");
  const pid = Number.parseInt(await readFile(join(worktreePath, "fake.pid"), "utf8"), 10);
  assert.throws(() => process.kill(pid, 0), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "ESRCH"
  );
});

test("OpenCode server preserves direct OpenCode review", async () => {
  const { adapter, worktreePath } = await createAdapter("complete");
  const manifest = await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "review", "review"));

  const observation = await adapter.observe(handle);

  assert.equal(manifest.executionAssurance?.review.owner, "runtime");
  assert.equal(observation.status, "completed");
  assert.equal(observation.stdout.trim(), "direct review");
});
