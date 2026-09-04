import assert from "node:assert/strict";
import { access, chmod, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  CancelResult,
  CapabilityManifest,
  ExecutionHandle,
  ExecutionObservation,
  ExecutionRequest,
  HarnessPort,
} from "../src/adapter-protocol.js";
import {
  ClaudeAgentSdkAdapter,
  createClaudeAgentSdkAdapter,
} from "../adapters/claude-agent-sdk/index.js";
import {
  CLAUDE_AGENT_SDK_CLI_ENVIRONMENT,
  CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT,
  inspectClaudeAgentSdkInstallation,
  isSupportedClaudeAgentSdkVersion,
  type ClaudeAgentSdkInstallation,
} from "../src/claude-agent-sdk.js";
import { attemptContextFixture } from "./helpers.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

interface FakeScenario {
  readonly init?: Readonly<Record<string, unknown>>;
  readonly reply?: "exact" | "missing" | "foreign" | "merged" | "none";
  readonly secondReply?: "exact" | "missing" | "foreign" | "merged";
  readonly secondReplyOutput?: string;
  readonly result?: "completed" | "failed" | "missing" | "foreign" | "merged" | "none";
  readonly iteratorFailure?: boolean;
  readonly iteratorFailureMessage?: string;
  readonly waitForInterrupt?: boolean;
  readonly interruptReceipt?: unknown;
  readonly interruptHangs?: boolean;
  readonly interruptThrowsSynchronously?: boolean;
  readonly interruptDelayMs?: number;
  readonly cancellationResult?: "aborted_tools" | "aborted_streaming" | "completed" | "error" | "none";
  readonly child?: "idle" | "exit" | "exit-stderr" | "oversized" | "stderr";
  readonly secondSpawn?: boolean;
  readonly scriptCliPath?: string;
  readonly noSpawn?: boolean;
  readonly spawnEnvironment?: "missing-config" | "foreign-config" | "extra";
  readonly output?: string;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class FakeReviewAdapter implements HarnessPort {
  failNextObservation = false;

  async describe(): Promise<CapabilityManifest> {
    return {
      protocolVersion: 1,
      adapterName: "claude-code",
      adapterVersion: "1",
      harnessVersion: "2.1.260",
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

  async launch(): Promise<ExecutionHandle> {
    return { protocolVersion: 1, adapterExecutionId: "review", startedAt: new Date().toISOString() };
  }

  async observe(): Promise<ExecutionObservation> {
    if (this.failNextObservation) {
      this.failNextObservation = false;
      throw new Error("review observation failed");
    }
    return {
      protocolVersion: 1,
      adapterExecutionId: "review",
      status: "completed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
      stdout: "direct review",
      stderr: "",
      truncated: false,
    };
  }

  async cancel(): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: true };
  }
}

function request(worktreePath: string, attemptId: string, role: ExecutionRequest["role"] = "implementation"): ExecutionRequest {
  return {
    protocolVersion: 1,
    role,
    runId: "run",
    itemId: "item",
    attemptId,
    worktreePath,
    objective: "test Claude Agent SDK",
    acceptanceSummary: "test",
    context: attemptContextFixture(attemptId),
    contextHash: `context-${attemptId}`,
    writableRoots: ["."],
    grants: [{ family: "credentials.use", actor: "adapter", environmentNames: ["AUTOPILOT_CLAUDE_TEST_TOKEN"] }],
    deadline: new Date(Date.now() + 10_000).toISOString(),
    idleTimeoutMs: 500,
    maximumLineBytes: 1024,
    maximumOutputBytes: 4096,
  };
}

function installation(cliPath = process.execPath): ClaudeAgentSdkInstallation {
  return {
    root: "/operator/sdk",
    modulePath: "/operator/sdk/sdk.mjs",
    cliPath,
    sdkVersion: "0.3.260",
    claudeCodeVersion: "2.1.260",
  };
}

function identityFields(kind: FakeScenario["reply"] | FakeScenario["result"], userMessageId: string): Readonly<Record<string, unknown>> {
  switch (kind) {
    case "exact":
    case "completed":
    case "failed":
      return { user_message_uuid: userMessageId, user_message_uuids: [userMessageId] };
    case "foreign":
      return { user_message_uuid: "foreign", user_message_uuids: ["foreign"] };
    case "merged":
      return { user_message_uuid: userMessageId, user_message_uuids: ["foreign", userMessageId] };
    case "missing":
    case "none":
    case undefined:
      return {};
  }
}

function fakeSdk(scenario: FakeScenario, captured: { options?: Readonly<Record<string, unknown>>; pid?: number }): {
  query(input: { readonly prompt: AsyncIterable<unknown>; readonly options: Readonly<Record<string, unknown>> }): {
    readonly interrupt: () => Promise<unknown>;
    readonly close: () => void;
    readonly [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
  };
} {
  return {
    query(input) {
      captured.options = input.options;
      const spawnProcess = input.options.spawnClaudeCodeProcess;
      if (typeof spawnProcess !== "function") {
        throw new Error("missing spawn hook");
      }
      const childMode = scenario.child ?? "idle";
      const childScript = childMode === "exit"
        ? "process.exit(17)"
        : childMode === "exit-stderr"
          ? 'process.stderr.write("abc"); process.nextTick(() => { process.stderr.write("def"); process.exit(0); })'
          : childMode === "oversized"
          ? `process.stdout.write("x".repeat(4096) + "\\n"); setInterval(() => {}, 1000)`
          : childMode === "stderr"
            ? `process.stderr.write("abc"); setTimeout(() => process.stderr.write("def"), 5); setInterval(() => {}, 1000)`
            : "setInterval(() => {}, 1000)";
      if (!scenario.noSpawn) {
        const spawnEnvironment: NodeJS.ProcessEnv = {
          ...(input.options.env as Readonly<Record<string, string | undefined>>),
          CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
          CLAUDE_AGENT_SDK_VERSION: "0.3.260",
        };
        if (scenario.spawnEnvironment === "missing-config") {
          delete spawnEnvironment.CLAUDE_CONFIG_DIR;
        } else if (scenario.spawnEnvironment === "foreign-config") {
          spawnEnvironment.CLAUDE_CONFIG_DIR = "/ambient/config";
        } else if (scenario.spawnEnvironment === "extra") {
          spawnEnvironment.AUTOPILOT_UNEXPECTED = "1";
        }
        const spawned = spawnProcess({
          command: scenario.scriptCliPath === undefined ? process.execPath : "node",
          args: scenario.scriptCliPath === undefined ? ["-e", childScript] : [scenario.scriptCliPath],
          cwd: input.options.cwd,
          env: spawnEnvironment,
          signal: new AbortController().signal,
        }) as { readonly pid?: number };
        if (spawned.pid !== undefined) {
          captured.pid = spawned.pid;
        }
        if (scenario.secondSpawn) {
          spawnProcess({
            command: process.execPath,
            args: ["-e", childScript],
            cwd: input.options.cwd,
            env: input.options.env,
            signal: new AbortController().signal,
          });
        }
      }
      const interrupted = deferred<void>();
      let closed = false;
      const messages = (async function*(): AsyncGenerator<unknown, void> {
        const promptIterator = input.prompt[Symbol.asyncIterator]();
        const first = await promptIterator.next();
        const userMessage = first.value as { readonly uuid: string };
        const userMessageId = userMessage.uuid;
        const cwd = input.options.cwd;
        if (scenario.child === "oversized" || scenario.child === "exit" || scenario.child === "exit-stderr") {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const init = {
          type: "system",
          subtype: "init",
          session_id: "session-1",
          claude_code_version: "2.1.260",
          cwd,
          permissionMode: "dontAsk",
          tools: ["Bash", "Edit", "Glob", "Grep", "Read", "Write"],
          mcp_servers: [],
          skills: [],
          plugins: [],
          capabilities: ["interrupt_receipt_v1", "interrupt_cancel_queued_v1", "msg_lifecycle_v1"],
          ...scenario.init,
        };
        yield init;
        if (scenario.child === "stderr") {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (scenario.reply !== "none") {
          yield {
            type: "assistant",
            session_id: "session-1",
            parent_tool_use_id: null,
            message: { content: [{ type: "text", text: scenario.output ?? "worker output abcdef" }] },
            ...identityFields(scenario.reply ?? "exact", userMessageId),
          };
        }
        if (scenario.secondReply !== undefined) {
          yield {
            type: "assistant",
            session_id: "session-1",
            parent_tool_use_id: null,
            message: { content: [{ type: "text", text: scenario.secondReplyOutput ?? "second reply" }] },
            ...identityFields(scenario.secondReply, userMessageId),
          };
        }
        if (scenario.iteratorFailure) {
          throw new Error(scenario.iteratorFailureMessage ?? "iterator failed");
        }
        if (scenario.waitForInterrupt) {
          await interrupted.promise;
          if (scenario.cancellationResult === "none") {
            await new Promise<void>(() => undefined);
          }
          const terminalReason = scenario.cancellationResult ?? "aborted_tools";
          yield {
            type: "result",
            subtype: terminalReason === "completed" ? "success" : "error_during_execution",
            is_error: terminalReason !== "completed",
            result: terminalReason === "completed" ? "natural completion" : undefined,
            errors: terminalReason === "completed" ? undefined : ["cancelled"],
            terminal_reason: terminalReason,
            session_id: "session-1",
            ...identityFields("completed", userMessageId),
          };
          return;
        }
        if (scenario.result === "none") {
          return;
        }
        const resultKind = scenario.result ?? "completed";
        yield {
          type: "result",
          subtype: resultKind === "failed" ? "error_during_execution" : "success",
          is_error: resultKind === "failed",
          result: resultKind === "completed" ? scenario.output ?? "worker output abcdef" : undefined,
          errors: resultKind === "failed" ? ["provider failed abcdef"] : undefined,
          terminal_reason: resultKind === "failed" ? "error" : "completed",
          session_id: "session-1",
          ...identityFields(resultKind, userMessageId),
        };
      })();
      return {
        interrupt: () => {
          if (scenario.interruptThrowsSynchronously) {
            throw new Error("synchronous interrupt failure");
          }
          return (async () => {
            interrupted.resolve();
            if (scenario.interruptHangs) {
              await new Promise<void>(() => undefined);
            }
            if (scenario.interruptDelayMs !== undefined) {
              await new Promise((resolve) => setTimeout(resolve, scenario.interruptDelayMs));
            }
            return Object.hasOwn(scenario, "interruptReceipt")
              ? scenario.interruptReceipt
              : { still_queued: [] };
          })();
        },
        close: () => {
          closed = true;
        },
        [Symbol.asyncIterator]: () => ({
          next: async () => closed ? { done: true, value: undefined } : await messages.next(),
        }),
      };
    },
  };
}

async function createAdapter(
  scenario: FakeScenario,
  installationValue = installation(),
): Promise<{
  readonly adapter: ClaudeAgentSdkAdapter;
  readonly reviewAdapter: FakeReviewAdapter;
  readonly worktreePath: string;
  readonly captured: { options?: Readonly<Record<string, unknown>>; pid?: number };
}> {
  const worktreePath = await mkdtemp(join(tmpdir(), "autopilot-claude-agent-sdk-test-"));
  const captured: { options?: Readonly<Record<string, unknown>>; pid?: number } = {};
  const reviewAdapter = new FakeReviewAdapter();
  return {
    worktreePath,
    captured,
    reviewAdapter,
    adapter: new ClaudeAgentSdkAdapter({
      reviewAdapter,
      installation: installationValue,
      sdk: fakeSdk(scenario, captured),
    }),
  };
}

function isExecutionUnknown(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXECUTION_STATE_UNKNOWN";
}

test("Claude Agent SDK discovery accepts only an explicit supported package and executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-claude-agent-sdk-discovery-"));
  const cliPath = process.execPath;
  const cliVersion = process.versions.node;
  await writeFile(join(root, "sdk.mjs"), "export const query = () => undefined;\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.260",
    claudeCodeVersion: cliVersion,
  }));

  const found = await inspectClaudeAgentSdkInstallation(root, cliPath);

  assert.equal(found.root, await realpath(root));
  assert.equal(found.cliPath, await realpath(cliPath));
  assert.equal(found.sdkVersion, "0.3.260");
  assert.equal(isSupportedClaudeAgentSdkVersion("0.3.245"), false);
  assert.equal(isSupportedClaudeAgentSdkVersion("0.3.246"), true);
  assert.equal(isSupportedClaudeAgentSdkVersion("1.0.0"), true);
  await assert.rejects(inspectClaudeAgentSdkInstallation(undefined, undefined), /must name an operator-provided/);

  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.245",
    claudeCodeVersion: cliVersion,
  }));
  await assert.rejects(inspectClaudeAgentSdkInstallation(root, cliPath), /older than 0\.3\.246/);

  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.260",
    claudeCodeVersion: "0.0.0",
  }));
  await assert.rejects(inspectClaudeAgentSdkInstallation(root, cliPath), /version could not be verified/);

  const scriptCliPath = join(root, "claude.mjs");
  await writeFile(
    scriptCliPath,
    "if (process.argv.includes('--version')) console.log('2.1.260'); else setInterval(() => {}, 1000);\n",
  );
  await chmod(scriptCliPath, 0o755);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.260",
    claudeCodeVersion: "2.1.260",
  }));
  assert.equal((await inspectClaudeAgentSdkInstallation(root, scriptCliPath)).cliPath, await realpath(scriptCliPath));

  const previousRoot = process.env[CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT];
  const previousCli = process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT];
  process.env[CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT] = root;
  process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT] = scriptCliPath;
  try {
    assert.equal((await createClaudeAgentSdkAdapter().describe()).adapterName, "claude-agent-sdk");
  } finally {
    if (previousRoot === undefined) {
      delete process.env[CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT];
    } else {
      process.env[CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT] = previousRoot;
    }
    if (previousCli === undefined) {
      delete process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT];
    } else {
      process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT] = previousCli;
    }
  }
  await assert.rejects(inspectClaudeAgentSdkInstallation(root, root), (error: unknown) =>
    error instanceof Error && "details" in error && JSON.stringify(error.details).includes("not a regular file")
  );

  const { adapter, worktreePath } = await createAdapter(
    { scriptCliPath },
    installation(scriptCliPath),
  );
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "script-cli"));
  assert.equal((await adapter.observe(handle)).status, "completed");
});

test("Claude Agent SDK admits exact identity with an isolated authority surface", async () => {
  process.env.AUTOPILOT_CLAUDE_TEST_TOKEN = "abcdef";
  try {
    const { adapter, worktreePath, captured } = await createAdapter({ child: "stderr" });

    const manifest = await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, "complete"));
    const observation = await adapter.observe(handle);

    assert.equal(manifest.adapterName, "claude-agent-sdk");
    assert.equal(manifest.restartReattachment, false);
    assert.deepEqual(manifest.executionAssurance?.implementation, {
      schemaVersion: 1,
      owner: "harness",
      continuity: "same-harness-instance",
      terminality: "cooperative",
      admission: "single-shot",
    });
    assert.match(handle.subject?.backendId ?? "", /^claude-agent-sdk@0\.3\.260\/claude-code@2\.1\.260$/u);
    assert.ok(handle.subject?.harnessInstanceId);
    assert.equal(observation.status, "completed");
    await assert.rejects(adapter.observe(handle), isExecutionUnknown);
    assert.equal((await adapter.cancel(handle)).accepted, false);
    assert.doesNotMatch(observation.stdout, /abcdef/u);
    assert.match(observation.stdout, /\*\*\*\*/u);
    assert.doesNotMatch(observation.stderr, /abcdef/u);
    assert.match(observation.stderr, /\*\*\*\*/u);
    assert.deepEqual(captured.options?.settingSources, []);
    assert.deepEqual(captured.options?.mcpServers, {});
    assert.deepEqual(captured.options?.skills, []);
    assert.deepEqual(captured.options?.plugins, []);
    assert.deepEqual(captured.options?.extraArgs, { "disable-slash-commands": null });
    assert.equal(captured.options?.persistSession, false);
    assert.equal(captured.options?.permissionMode, "dontAsk");
    const hookConfiguration = captured.options?.hooks as {
      readonly PreToolUse: readonly [{
        readonly hooks: readonly [(input: unknown) => Promise<{
          readonly hookSpecificOutput: { readonly permissionDecision: string };
        }>];
      }];
    };
    const preToolUse = hookConfiguration.PreToolUse[0].hooks[0];
    assert.equal((await preToolUse({ tool_name: "Read" })).hookSpecificOutput.permissionDecision, "allow");
    assert.equal((await preToolUse({ tool_name: "Task" })).hookSpecificOutput.permissionDecision, "deny");
    const environment = captured.options?.env as Readonly<Record<string, string | undefined>>;
    const configDirectory = environment.CLAUDE_CONFIG_DIR;
    if (configDirectory === undefined) {
      throw new Error("missing isolated Claude configuration directory");
    }
    assert.ok(configDirectory.includes("autopilot-claude-agent-sdk-"));
    await assert.rejects(access(configDirectory));
  } finally {
    delete process.env.AUTOPILOT_CLAUDE_TEST_TOKEN;
  }
});

test("Claude Agent SDK reports exact structured provider failure", async () => {
  const { adapter, worktreePath } = await createAdapter({ result: "failed" });
  await adapter.describe();

  const handle = await adapter.launch(request(worktreePath, "failure"));
  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "failed");
  assert.equal(observation.exitCode, 1);
  assert.match(observation.stdout, /provider failed/u);
});

test("Claude Agent SDK cancellation requires an empty receipt and exact aborted result", async () => {
  for (const cancellationResult of ["aborted_tools", "aborted_streaming"] as const) {
    const { adapter, worktreePath } = await createAdapter({
      waitForInterrupt: true,
      interruptDelayMs: 20,
      cancellationResult,
    });
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, cancellationResult));

    const cancellation = await adapter.cancel(handle);
    const observation = await adapter.observe(handle);

    assert.equal(cancellation.accepted, true);
    assert.equal(observation.status, "cancelled");
    assert.equal(observation.exitCode, 130);
  }
});

test("Claude Agent SDK exact completion or failure wins a hanging cancellation race", async () => {
  for (const [cancellationResult, expectedStatus] of [
    ["completed", "completed"],
    ["error", "failed"],
  ] as const) {
    const { adapter, worktreePath } = await createAdapter({
      waitForInterrupt: true,
      interruptHangs: true,
      cancellationResult,
    });
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, cancellationResult));

    const cancellation = await adapter.cancel(handle);
    const observation = await adapter.observe(handle);

    assert.equal(cancellation.accepted, false);
    assert.equal(observation.status, expectedStatus);
  }
});

test("Claude Agent SDK rejects missing or surviving interrupt receipts", async () => {
  for (const interruptReceipt of [undefined, { still_queued: ["queued"] }] as const) {
    const scenario = interruptReceipt === undefined
      ? { waitForInterrupt: true, cancellationResult: "aborted_tools" as const, interruptReceipt: null }
      : { waitForInterrupt: true, cancellationResult: "aborted_tools" as const, interruptReceipt };
    const { adapter, worktreePath } = await createAdapter(scenario);
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, `receipt-${String(interruptReceipt)}`));

    await assert.rejects(adapter.cancel(handle), isExecutionUnknown);
    await assert.rejects(adapter.observe(handle), isExecutionUnknown);
  }

  const { adapter, worktreePath } = await createAdapter({
    waitForInterrupt: true,
    interruptThrowsSynchronously: true,
  });
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "synchronous-interrupt-failure"));
  await assert.rejects(adapter.cancel(handle), isExecutionUnknown);
  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
});

test("Claude Agent SDK rejects missing, foreign, and merged terminal user-message identities", async () => {
  for (const result of ["missing", "foreign", "merged"] as const) {
    const { adapter, worktreePath } = await createAdapter({ result });
    await adapter.describe();
    const execution = adapter.launch(request(worktreePath, result)).then(async (handle) => await adapter.observe(handle));

    await assert.rejects(execution, isExecutionUnknown);
  }
});

test("Claude Agent SDK rejects a first reply without exact user-message identity", async () => {
  for (const reply of ["missing", "foreign", "merged"] as const) {
    const { adapter, worktreePath } = await createAdapter({ reply });
    await adapter.describe();

    await assert.rejects(adapter.launch(request(worktreePath, `reply-${reply}`)), isExecutionUnknown);
  }
});

test("Claude Agent SDK validates post-admission identity without dropping repeated replies", async () => {
  for (const secondReply of ["foreign", "merged"] as const) {
    const { adapter, worktreePath } = await createAdapter({ secondReply });
    await adapter.describe();
    const execution = adapter.launch(request(worktreePath, `second-${secondReply}`))
      .then(async (handle) => await adapter.observe(handle));

    await assert.rejects(execution, isExecutionUnknown);
  }

  for (const secondReply of ["missing", "exact"] as const) {
    const { adapter, worktreePath } = await createAdapter({
      secondReply,
      secondReplyOutput: "worker output abcdef",
      result: "failed",
    });
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, `repeated-assistant-${secondReply}`));
    const observation = await adapter.observe(handle);
    assert.equal(observation.stdout, "worker output abcdef\nworker output abcdef\nprovider failed abcdef");
  }
});

test("Claude Agent SDK rejects changed init authority and identity", async () => {
  const worktreePath = await mkdtemp(join(tmpdir(), "autopilot-claude-wrong-cwd-"));
  const cases: readonly Readonly<Record<string, unknown>>[] = [
    { claude_code_version: "2.1.259" },
    { permissionMode: "default" },
    { tools: ["Read"] },
    { mcp_servers: [{ name: "ambient", status: "connected" }] },
    { skills: ["ambient"] },
    { plugins: [{ name: "ambient", path: "/tmp/ambient" }] },
    { capabilities: ["msg_lifecycle_v1"] },
    { cwd: tmpdir() },
  ];
  for (const [index, init] of cases.entries()) {
    const captured: { options?: Readonly<Record<string, unknown>>; pid?: number } = {};
    const adapter = new ClaudeAgentSdkAdapter({
      reviewAdapter: new FakeReviewAdapter(),
      installation: installation(),
      sdk: fakeSdk({ init }, captured),
    });
    await adapter.describe();

    await assert.rejects(adapter.launch(request(worktreePath, `init-${index}`)), isExecutionUnknown);
  }
});

test("Claude Agent SDK redacts credential values from lifecycle errors", async () => {
  process.env.AUTOPILOT_CLAUDE_TEST_TOKEN = "abcdef";
  try {
    const { adapter, worktreePath } = await createAdapter({
      iteratorFailure: true,
      iteratorFailureMessage: "iterator failed with abcdef",
    });
    await adapter.describe();
    const handle = await adapter.launch(request(worktreePath, "redacted-error"));

    await assert.rejects(adapter.observe(handle), (error: unknown) => {
      const serialized = JSON.stringify(error);
      return !serialized.includes("abcdef") && serialized.includes("****");
    });
  } finally {
    delete process.env.AUTOPILOT_CLAUDE_TEST_TOKEN;
  }
});

test("Claude Agent SDK rejects changes to the isolated child environment", async () => {
  for (const spawnEnvironment of ["missing-config", "foreign-config", "extra"] as const) {
    const { adapter, worktreePath } = await createAdapter({ spawnEnvironment });
    await adapter.describe();

    await assert.rejects(adapter.launch(request(worktreePath, spawnEnvironment)), isExecutionUnknown);
  }
});

test("Claude Agent SDK accepts an exact terminal result and drains stderr buffered across child exit", async () => {
  const { adapter, worktreePath } = await createAdapter({ child: "exit-stderr" });
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "buffered-exit"));

  const observation = await adapter.observe(handle);

  assert.equal(observation.status, "completed");
  assert.equal(observation.stderr, "abcdef");
});

test("Claude Agent SDK maps iterator, child, and protocol loss to unknown", async () => {
  for (const scenario of [
    { iteratorFailure: true },
    { result: "none" as const },
    { child: "exit" as const, result: "none" as const },
    { child: "oversized" as const },
    { secondSpawn: true },
    { noSpawn: true },
  ]) {
    const { adapter, worktreePath } = await createAdapter(scenario);
    await adapter.describe();
    const execution = adapter.launch(request(worktreePath, `loss-${JSON.stringify(scenario)}`))
      .then(async (handle) => await adapter.observe(handle));

    await assert.rejects(execution, isExecutionUnknown);
  }
});

test("Claude Agent SDK rejects handles from another harness instance", async () => {
  const { adapter, worktreePath } = await createAdapter({ waitForInterrupt: true });
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "wrong-handle"));
  if (handle.subject === undefined) {
    throw new Error("missing exact subject");
  }

  await assert.rejects(adapter.observe({
    ...handle,
    subject: { ...handle.subject, harnessInstanceId: "other" },
  }), isExecutionUnknown);
  assert.equal((await adapter.cancel({
    ...handle,
    subject: { ...handle.subject, backendId: "other" },
  })).accepted, false);

  await adapter.cancel(handle);
});

test("Claude Agent SDK idle and deadline expiry remain execution-state-unknown", async () => {
  for (const timing of [
    { idleTimeoutMs: 20, deadline: new Date(Date.now() + 10_000).toISOString() },
    { idleTimeoutMs: 10_000, deadline: new Date(Date.now() + 200).toISOString() },
  ]) {
    const { adapter, worktreePath } = await createAdapter({ waitForInterrupt: true });
    await adapter.describe();
    const base = request(worktreePath, `timing-${timing.idleTimeoutMs}`);
    const handle = await adapter.launch({ ...base, ...timing });

    await assert.rejects(adapter.observe(handle), isExecutionUnknown);
  }
});

test("Claude Agent SDK bounds retained output before observation", async () => {
  const { adapter, worktreePath } = await createAdapter({ output: "é".repeat(100) });
  await adapter.describe();
  const base = request(worktreePath, "bounded-output");
  const handle = await adapter.launch({ ...base, maximumOutputBytes: 9 });

  const observation = await adapter.observe(handle);

  assert.equal(Buffer.byteLength(observation.stdout), 9);
  assert.equal(observation.truncated, true);
  assert.doesNotMatch(observation.stdout, /�/u);
});

test("Claude Agent SDK awaits direct-child cleanup after terminal acceptance", {
  skip: process.platform === "win32",
}, async () => {
  const { adapter, worktreePath, captured } = await createAdapter({});
  await adapter.describe();
  const handle = await adapter.launch(request(worktreePath, "cleanup"));

  await adapter.observe(handle);

  assert.ok(captured.pid !== undefined);
  assert.throws(() => process.kill(captured.pid as number, 0), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "ESRCH"
  );
});

test("Claude Agent SDK keeps independent review on the direct adapter", async () => {
  const { adapter, reviewAdapter, worktreePath } = await createAdapter({});
  await adapter.describe();

  const failedHandle = await adapter.launch(request(worktreePath, "review-failure", "review"));
  reviewAdapter.failNextObservation = true;
  await assert.rejects(adapter.observe(failedHandle), /review observation failed/);
  assert.equal((await adapter.cancel(failedHandle)).accepted, false);

  const handle = await adapter.launch(request(worktreePath, "review", "review"));
  const observationPromise = adapter.observe(handle);

  assert.equal(handle.adapterExecutionId, "review");
  assert.equal((await adapter.cancel(handle)).accepted, true);
  const observation = await observationPromise;
  assert.equal(observation.stdout, "direct review");
  assert.equal((await adapter.cancel(handle)).accepted, false);
  await assert.rejects(adapter.observe(handle), isExecutionUnknown);
});
