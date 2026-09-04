import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pathToFileURL } from "node:url";
import { createClaudeCodeAdapter } from "../claude-code/index.js";
import {
  executionAssuranceFor,
  type CancelResult,
  type CapabilityManifest,
  type ExecutionHandle,
  type ExecutionObservation,
  type ExecutionRequest,
  type ExecutionSubject,
  type HarnessPort,
} from "../../src/adapter-protocol.js";
import {
  adapterCredentialNames,
  adapterEnvironment,
  redactSecrets,
  redactionValues,
} from "../../src/adapter-process.js";
import { renderAttemptContext } from "../../src/attempt-context.js";
import {
  CLAUDE_AGENT_SDK_CLI_ENVIRONMENT,
  inspectClaudeAgentSdkInstallation,
  isClaudeAgentSdkScriptCli,
  type ClaudeAgentSdkInstallation,
} from "../../src/claude-agent-sdk.js";
import { AutopilotError } from "../../src/errors.js";
import { canonicalJson, isRecord, sha256 } from "../../src/json.js";
import { boundUtf8, StreamingRedactor, terminateDirectChild } from "../../src/process.js";

const IMPLEMENTATION_TOOLS = ["Bash", "Edit", "Glob", "Grep", "Read", "Write"] as const;
const REQUIRED_CAPABILITIES = ["interrupt_receipt_v1", "interrupt_cancel_queued_v1", "msg_lifecycle_v1"] as const;
const CHILD_CLOSE_TIMEOUT_MS = 5_000;

interface ClaudeQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close(): void;
}

interface ClaudeAgentSdkModule {
  query(input: { readonly prompt: AsyncIterable<unknown>; readonly options: Readonly<Record<string, unknown>> }): ClaudeQuery;
}

export interface ClaudeAgentSdkAdapterOptions {
  readonly reviewAdapter: HarnessPort;
  readonly installation?: ClaudeAgentSdkInstallation;
  readonly sdk?: ClaudeAgentSdkModule;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

interface PendingExecution {
  readonly request: ExecutionRequest;
  readonly query: ClaudeQuery;
  readonly harnessInstanceId: string;
  readonly userMessageId: string;
  readonly subject: ExecutionSubject;
  readonly terminal: Promise<ExecutionObservation>;
  readonly interrupt: () => Promise<boolean>;
  readonly dispose: () => Promise<void>;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `${label} is malformed`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `${label} is malformed`);
  }
  return value;
}

function exactStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.every((item): item is string => typeof item === "string")
    && [...value].toSorted().join("\0") === [...expected].toSorted().join("\0");
}

function isInterruptedTerminalReason(value: unknown): boolean {
  return value === "aborted_tools" || value === "aborted_streaming";
}

function hasExactUserMessageIdentity(message: Readonly<Record<string, unknown>>, userMessageId: string): boolean {
  if (message.user_message_uuid !== userMessageId) {
    return false;
  }
  return message.user_message_uuids === undefined
    || (Array.isArray(message.user_message_uuids)
      && message.user_message_uuids.length === 1
      && message.user_message_uuids[0] === userMessageId);
}

function hasNoUserMessageIdentity(message: Readonly<Record<string, unknown>>): boolean {
  return message.user_message_uuid === undefined && message.user_message_uuids === undefined;
}

function assistantText(message: Readonly<Record<string, unknown>>): string {
  if (!isRecord(message.message) || !Array.isArray(message.message.content)) {
    return "";
  }
  return message.message.content.flatMap((part): readonly string[] =>
    isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []
  ).join("");
}

function resultText(message: Readonly<Record<string, unknown>>): string {
  if (typeof message.result === "string") {
    return message.result;
  }
  return Array.isArray(message.errors)
    ? message.errors.filter((value): value is string => typeof value === "string").join("\n")
    : "";
}

class LineBoundTransform extends Transform {
  readonly #maximumLineBytes: number;
  #lineBytes = 0;

  constructor(maximumLineBytes: number) {
    super();
    this.#maximumLineBytes = maximumLineBytes;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    for (const byte of chunk) {
      if (byte === 0x0a) {
        this.#lineBytes = 0;
      } else {
        this.#lineBytes += 1;
        if (this.#lineBytes > this.#maximumLineBytes) {
          callback(new AutopilotError(
            "EXECUTION_STATE_UNKNOWN",
            "Claude Agent SDK protocol record exceeded the configured line bound",
          ));
          return;
        }
      }
    }
    callback(undefined, chunk);
  }
}

function subjectMatches(pending: PendingExecution, handle: ExecutionHandle): boolean {
  return handle.subject?.schemaVersion === 1
    && handle.subject.backendId === pending.subject.backendId
    && handle.subject.subjectId === pending.subject.subjectId
    && handle.subject.harnessInstanceId === pending.harnessInstanceId;
}

export class ClaudeAgentSdkAdapter implements HarnessPort {
  readonly #options: ClaudeAgentSdkAdapterOptions;
  readonly #pending = new Map<string, PendingExecution>();
  readonly #reviewHandles = new Set<string>();
  #installation: ClaudeAgentSdkInstallation | undefined;
  #sdk: ClaudeAgentSdkModule | undefined;

  constructor(options: ClaudeAgentSdkAdapterOptions) {
    this.#options = options;
  }

  async describe(): Promise<CapabilityManifest> {
    const [reviewManifest, loaded] = await Promise.all([
      this.#options.reviewAdapter.describe(),
      this.#loadSdk(),
    ]);
    this.#installation = loaded.installation;
    this.#sdk = loaded.sdk;
    return {
      protocolVersion: 1,
      adapterName: "claude-agent-sdk",
      adapterVersion: "1",
      harnessVersion: `claude-agent-sdk ${loaded.installation.sdkVersion} / Claude Code ${loaded.installation.claudeCodeVersion}`,
      families: reviewManifest.families,
      assurance: "cooperative",
      unattended: true,
      maxConcurrency: 1,
      eventStreaming: true,
      cancellation: true,
      restartReattachment: false,
      executionAssurance: {
        schemaVersion: 1,
        implementation: {
          schemaVersion: 1,
          owner: "harness",
          continuity: "same-harness-instance",
          terminality: "cooperative",
          admission: "single-shot",
        },
        review: executionAssuranceFor(reviewManifest, "review"),
      },
      restrictions: "cooperative",
      limitations: [
        "Implementation terminality requires the exact uninterrupted Agent SDK query, child, session, and caller-selected user-message identity.",
        "Coordinator, query, iterator, or child loss is execution-state-unknown and cannot launch a replacement or resume a transcript.",
        "Tool restrictions are cooperative and do not provide operating-system filesystem, network, subprocess, or descendant containment.",
        "The SDK and matching Claude Code executable must be supplied explicitly; Autopilot never installs or discovers them from private caches.",
        "Independent review uses the direct Claude Code CLI adapter and remains session-scoped.",
      ],
    };
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    if (request.role === "review") {
      const handle = await this.#options.reviewAdapter.launch(request);
      this.#reviewHandles.add(handle.adapterExecutionId);
      return handle;
    }
    if (request.protocolVersion !== 1) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution request protocol version is not supported");
    }
    if (this.#installation === undefined || this.#sdk === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "Claude Agent SDK capabilities must be loaded before launch");
    }

    const installation = this.#installation;
    const sdk = this.#sdk;
    const adapterExecutionId = randomUUID();
    const harnessInstanceId = randomUUID();
    const userMessageId = randomUUID();
    const startedAt = new Date().toISOString();
    const admission = deferred<ExecutionHandle>();
    const terminal = deferred<ExecutionObservation>();
    void admission.promise.catch(() => undefined);
    void terminal.promise.catch(() => undefined);
    const releaseInput = deferred<void>();
    void releaseInput.promise.catch(() => undefined);
    const credentials = adapterCredentialNames(request);
    const stderrRedactor = new StreamingRedactor(redactionValues(credentials));
    const stderr = { value: "", truncated: false, finished: false };
    const expectedCwd = await realpath(request.worktreePath);
    const configDirectory = await mkdtemp(join(tmpdir(), "autopilot-claude-agent-sdk-"));
    const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
    let child: ChildProcessWithoutNullStreams | undefined;
    let childClosed: Promise<void> | undefined;
    let protocolOutput: LineBoundTransform | undefined;
    let query: ClaudeQuery | undefined;
    let sessionId: string | undefined;
    let subject: ExecutionSubject | undefined;
    let admitted = false;
    let terminalAccepted = false;
    let settledResult: Readonly<Record<string, unknown>> | undefined;
    let cancelRequested = false;
    let interruptReceiptAccepted = false;
    let interruption: Promise<boolean> | undefined;
    let output = "";
    let outputTruncated = false;
    let spawnCount = 0;
    let idleTimer: NodeJS.Timeout | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let disposal: Promise<void> | undefined;
    let disposing = false;

    const appendOutput = (text: string, deduplicateWholeOutput = false): void => {
      if (text.length === 0) {
        return;
      }
      const combined = output.length === 0 || (deduplicateWholeOutput && output === text)
        ? text : `${output}\n${text}`;
      const bounded = boundUtf8(redactSecrets(combined, credentials), request.maximumOutputBytes);
      output = bounded.value;
      outputTruncated ||= bounded.truncated;
    };
    const appendStderr = (text: string): void => {
      const bounded = boundUtf8(`${stderr.value}${text}`, request.maximumOutputBytes);
      stderr.value = bounded.value;
      stderr.truncated ||= bounded.truncated;
    };
    const finishStderr = (): void => {
      if (!stderr.finished) {
        stderr.finished = true;
        appendStderr(stderrRedactor.end());
      }
    };
    const resetIdleTimer = (): void => {
      if (disposing || terminalAccepted) {
        return;
      }
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        failUnknown("Claude Agent SDK exceeded the harness idle timeout without an exact terminal result");
      }, request.idleTimeoutMs);
      idleTimer.unref();
    };
    const dispose = (): Promise<void> => {
      disposal ??= (async () => {
        disposing = true;
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
        }
        if (deadlineTimer !== undefined) {
          clearTimeout(deadlineTimer);
        }
        releaseInput.resolve();
        try {
          try {
            query?.close();
          } catch {
            // Query.close() is cleanup only; terminality was established separately.
          }
          protocolOutput?.destroy();
          if (child !== undefined) {
            child.stdout.destroy();
            try {
              await terminateDirectChild(child, "Claude Agent SDK");
              if (childClosed === undefined) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK child close observation is unavailable");
              }
              let closeTimer: NodeJS.Timeout | undefined;
              try {
                await Promise.race([
                  childClosed,
                  new Promise<void>((_resolve, reject) => {
                    closeTimer = setTimeout(() => {
                      reject(new AutopilotError(
                        "EXECUTION_STATE_UNKNOWN",
                        "Claude Agent SDK child streams did not close after direct-child termination",
                      ));
                    }, CHILD_CLOSE_TIMEOUT_MS);
                    closeTimer.unref();
                  }),
                ]);
              } finally {
                if (closeTimer !== undefined) {
                  clearTimeout(closeTimer);
                }
              }
              finishStderr();
            } finally {
              child.stdin.destroy();
              child.stderr.destroy();
              child.unref();
            }
          }
        } finally {
          await rm(configDirectory, { recursive: true, force: true });
        }
      })();
      return disposal;
    };
    const rejectAfterCleanup = (error: AutopilotError): void => {
      void dispose().then(() => {
        if (admitted) {
          terminal.reject(error);
        } else {
          admission.reject(error);
          terminal.reject(error);
        }
      }, (cleanupError) => {
        const combined = new AutopilotError("EXECUTION_STATE_UNKNOWN", error.message, {
          ...error.details,
          cleanup: redactSecrets(errorMessage(cleanupError), credentials),
        });
        if (admitted) {
          terminal.reject(combined);
        } else {
          admission.reject(combined);
          terminal.reject(combined);
        }
      });
    };
    const failUnknown = (message: string, cause?: unknown): void => {
      if (terminalAccepted) {
        return;
      }
      terminalAccepted = true;
      rejectAfterCleanup(new AutopilotError("EXECUTION_STATE_UNKNOWN", message, {
        ...(cause === undefined ? {} : { cause: redactSecrets(errorMessage(cause), credentials) }),
      }));
    };
    const validateInit = async (message: Readonly<Record<string, unknown>>): Promise<void> => {
      if (sessionId !== undefined || spawnCount !== 1 || child === undefined) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK emitted a conflicting initialization identity");
      }
      const initSessionId = requiredString(message.session_id, "Claude Agent SDK session id");
      const cwd = requiredString(message.cwd, "Claude Agent SDK working directory");
      const actualCwd = await realpath(cwd);
      if (actualCwd !== expectedCwd) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK admitted a different working directory");
      }
      if (message.claude_code_version !== installation.claudeCodeVersion) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK reported a different Claude Code version");
      }
      if (message.permissionMode !== "dontAsk" || !exactStringSet(message.tools, IMPLEMENTATION_TOOLS)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK changed the unattended tool or permission surface");
      }
      if (!Array.isArray(message.mcp_servers) || message.mcp_servers.length !== 0
        || !Array.isArray(message.skills) || message.skills.length !== 0
        || !Array.isArray(message.plugins) || message.plugins.length !== 0) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK admitted ambient MCP, skill, or plugin authority");
      }
      const capabilities = message.capabilities;
      if (!Array.isArray(capabilities)
        || !REQUIRED_CAPABILITIES.every((capability) => capabilities.includes(capability))) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK lacks required identity or interruption capabilities");
      }
      sessionId = initSessionId;
    };
    const admit = (): void => {
      if (admitted || sessionId === undefined) {
        return;
      }
      subject = {
        schemaVersion: 1,
        backendId: `claude-agent-sdk@${installation.sdkVersion}/claude-code@${installation.claudeCodeVersion}`,
        subjectId: sha256(canonicalJson({ harnessInstanceId, sessionId, userMessageId })),
        harnessInstanceId,
      };
      admitted = true;
      admission.resolve({ protocolVersion: 1, adapterExecutionId, startedAt, subject });
    };
    const finalize = (): void => {
      if (terminalAccepted || settledResult === undefined || !admitted) {
        return;
      }
      const terminalReason = settledResult.terminal_reason;
      const interrupted = isInterruptedTerminalReason(terminalReason);
      if (cancelRequested && interrupted && !interruptReceiptAccepted) {
        return;
      }
      terminalAccepted = true;
      const completed = settledResult.subtype === "success"
        && settledResult.is_error === false
        && terminalReason === "completed";
      const cancelled = cancelRequested && interruptReceiptAccepted && interrupted;
      appendOutput(resultText(settledResult), true);
      void dispose().then(() => terminal.resolve({
        protocolVersion: 1,
        adapterExecutionId,
        status: completed ? "completed" : cancelled ? "cancelled" : "failed",
        exitCode: completed ? 0 : cancelled ? 130 : 1,
        completedAt: new Date().toISOString(),
        stdout: output,
        stderr: stderr.value,
        truncated: outputTruncated || stderr.truncated,
      }), (error) => {
        terminal.reject(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK cleanup could not prove direct-child termination", {
          cause: redactSecrets(errorMessage(error), credentials),
        }));
      });
    };

    const environment = {
      ...adapterEnvironment(request),
      CLAUDE_CONFIG_DIR: configDirectory,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_TELEMETRY: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      DISABLE_AUTOUPDATER: "1",
    };
    async function* prompt(): AsyncGenerator<unknown, void> {
      yield {
        type: "user",
        message: { role: "user", content: renderAttemptContext(request.context) },
        parent_tool_use_id: null,
        uuid: userMessageId,
        session_id: "",
      };
      await releaseInput.promise;
    }

    try {
      query = sdk.query({
        prompt: prompt(),
        options: {
          cwd: request.worktreePath,
          pathToClaudeCodeExecutable: installation.cliPath,
          env: environment,
          settingSources: [],
          tools: [...IMPLEMENTATION_TOOLS],
          allowedTools: [...IMPLEMENTATION_TOOLS],
          disallowedTools: ["WebFetch", "WebSearch", "Task", "Skill", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
          permissionMode: "dontAsk",
          persistSession: false,
          strictMcpConfig: true,
          mcpServers: {},
          skills: [],
          plugins: [],
          additionalDirectories: [],
          extraArgs: { "disable-slash-commands": null },
          hooks: {
            PreToolUse: [{
              hooks: [async (input: unknown) => {
                const hookInput = requiredRecord(input, "Claude Agent SDK pre-tool hook input");
                const allowed = typeof hookInput.tool_name === "string" && IMPLEMENTATION_TOOLS.includes(
                  hookInput.tool_name as (typeof IMPLEMENTATION_TOOLS)[number],
                );
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: allowed ? "allow" : "deny",
                    permissionDecisionReason: allowed
                      ? "Tool is within the sealed implementation surface"
                      : "Autopilot rejects tools outside the sealed implementation surface",
                  },
                };
              }],
            }],
          },
          spawnClaudeCodeProcess: (spawnOptions: unknown) => {
            spawnCount += 1;
            if (spawnCount !== 1) {
              throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK attempted to spawn more than one child");
            }
            const options = requiredRecord(spawnOptions, "Claude Agent SDK spawn request");
            const scriptCli = isClaudeAgentSdkScriptCli(installation.cliPath);
            const expectedCommand = scriptCli ? "node" : installation.cliPath;
            if (options.command !== expectedCommand
              || !Array.isArray(options.args)
              || options.args.some((value) => typeof value !== "string")
              || (scriptCli && options.args[0] !== installation.cliPath)
              || typeof options.cwd !== "string"
              || !isRecord(options.env)
              || Object.values(options.env).some((value) => value !== undefined && typeof value !== "string")) {
              throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK changed the admitted process identity");
            }
            const processEnvironment: NodeJS.ProcessEnv = {
              ...environment,
              CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
              CLAUDE_AGENT_SDK_VERSION: installation.sdkVersion,
            };
            const suppliedEnvironment = options.env as NodeJS.ProcessEnv;
            const expectedEnvironmentEntries = Object.entries(processEnvironment);
            if (Object.keys(suppliedEnvironment).length !== expectedEnvironmentEntries.length
              || expectedEnvironmentEntries.some(([name, value]) => suppliedEnvironment[name] !== value)) {
              throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK changed the isolated process environment");
            }
            child = spawn(scriptCli ? process.execPath : installation.cliPath, options.args as string[], {
              cwd: request.worktreePath,
              env: processEnvironment,
              signal: options.signal instanceof AbortSignal ? options.signal : undefined,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            });
            childClosed = new Promise((resolve) => {
              child?.once("close", () => resolve());
            });
            protocolOutput = new LineBoundTransform(request.maximumLineBytes);
            child.stdout.pipe(protocolOutput);
            protocolOutput.once("error", (error) => {
              failUnknown("Claude Agent SDK protocol stream failed", error);
            });
            child.stderr.on("data", (chunk: Buffer) => {
              resetIdleTimer();
              appendStderr(stderrRedactor.write(chunk));
            });
            child.stderr.once("end", finishStderr);
            child.once("error", (error) => {
              failUnknown("Claude Agent SDK child process failed", error);
            });
            return {
              pid: child.pid,
              stdin: child.stdin,
              stdout: protocolOutput,
              get killed() { return child?.killed ?? true; },
              get exitCode() { return child?.exitCode ?? null; },
              get signalCode() { return child?.signalCode ?? null; },
              kill: (signal: NodeJS.Signals) => child?.kill(signal) ?? false,
              on: (event: "exit" | "error", listener: (...arguments_: unknown[]) => void) => {
                child?.on(event, listener);
              },
              once: (event: "exit" | "error", listener: (...arguments_: unknown[]) => void) => {
                child?.once(event, listener);
              },
              off: (event: "exit" | "error", listener: (...arguments_: unknown[]) => void) => {
                child?.off(event, listener);
              },
            };
          },
        },
      });
    } catch (error) {
      failUnknown("Claude Agent SDK query launch failed", error);
      return await admission.promise;
    }

    const activeQuery = query;
    resetIdleTimer();
    deadlineTimer = setTimeout(() => {
      failUnknown("Claude Agent SDK exceeded the attempt deadline without an exact terminal result");
    }, timeoutMs);
    deadlineTimer.unref();

    void (async () => {
      try {
        for await (const value of activeQuery) {
          if (terminalAccepted) {
            break;
          }
          resetIdleTimer();
          const message = requiredRecord(value, "Claude Agent SDK message");
          if (message.type === "system" && message.subtype === "init") {
            await validateInit(message);
            continue;
          }
          if (sessionId !== undefined && message.session_id !== undefined && message.session_id !== sessionId) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK message changed the admitted session identity");
          }
          if (message.type === "assistant") {
            const exactUserMessageIdentity = hasExactUserMessageIdentity(message, userMessageId);
            // Claude omits the UUID on later tool-use replies; the admitted one-query session retains that identity.
            const mayInheritAdmittedIdentity = admitted && hasNoUserMessageIdentity(message);
            if (sessionId === undefined || message.session_id !== sessionId
              || (!exactUserMessageIdentity && !mayInheritAdmittedIdentity)) {
              throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK reply lacks the exact session or user-message identity");
            }
            if (!admitted) {
              admit();
            }
            appendOutput(assistantText(message));
            continue;
          }
          if (message.type === "result") {
            if (settledResult !== undefined || sessionId === undefined || message.session_id !== sessionId
              || !hasExactUserMessageIdentity(message, userMessageId)) {
              throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK terminal result identity is missing or conflicting");
            }
            if (!admitted) {
              admit();
            }
            settledResult = message;
            finalize();
          }
        }
        const awaitingInterruptReceipt = cancelRequested && settledResult !== undefined
          && isInterruptedTerminalReason(settledResult.terminal_reason) && !interruptReceiptAccepted;
        if (!terminalAccepted && !awaitingInterruptReceipt) {
          failUnknown("Claude Agent SDK iterator ended before exact terminal acceptance");
        }
      } catch (error) {
        failUnknown("Claude Agent SDK iterator failed before exact terminal acceptance", error);
      }
    })();

    const handle = await admission.promise;
    if (subject === undefined || handle.subject !== subject) {
      failUnknown("Claude Agent SDK admission did not produce an exact subject");
      throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK admission did not produce an exact subject");
    }

    const pending: PendingExecution = {
      request,
      query: activeQuery,
      harnessInstanceId,
      userMessageId,
      subject,
      terminal: terminal.promise,
      interrupt: async (): Promise<boolean> => {
        if (terminalAccepted) {
          return false;
        }
        cancelRequested = true;
        interruption ??= (async () => {
          let interruptRequest: Promise<unknown>;
          try {
            interruptRequest = activeQuery.interrupt();
          } catch (error) {
            failUnknown("Claude Agent SDK interrupt request failed", error);
            await terminal.promise;
            return false;
          }
          const interrupt = interruptRequest.then(
            (receipt) => ({ kind: "receipt" as const, receipt }),
            (error: unknown) => ({ kind: "error" as const, error }),
          );
          const terminalResult = terminal.promise.then(
            (observation) => ({ kind: "terminal" as const, observation }),
          );
          const first = await Promise.race([interrupt, terminalResult]);
          if (first.kind === "terminal") {
            return first.observation.status === "cancelled";
          }
          if (first.kind === "error") {
            failUnknown("Claude Agent SDK interrupt request failed", first.error);
            await terminal.promise;
            return false;
          }
          const { receipt } = first;
          if (!isRecord(receipt) || !Array.isArray(receipt.still_queued)
            || receipt.still_queued.some((value) => typeof value !== "string")
            || receipt.still_queued.length !== 0) {
            failUnknown("Claude Agent SDK interrupt did not prove an empty surviving queue");
            await terminal.promise;
            return false;
          }
          interruptReceiptAccepted = true;
          finalize();
          const observation = await terminal.promise;
          return observation.status === "cancelled";
        })();
        return await interruption;
      },
      dispose,
    };
    this.#pending.set(adapterExecutionId, pending);
    return handle;
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    if (this.#reviewHandles.has(handle.adapterExecutionId)) {
      try {
        return await this.#options.reviewAdapter.observe(handle);
      } finally {
        this.#reviewHandles.delete(handle.adapterExecutionId);
      }
    }
    const pending = this.#pending.get(handle.adapterExecutionId);
    if (pending === undefined || !subjectMatches(pending, handle)) {
      throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Claude Agent SDK handle is not owned by this harness instance");
    }
    try {
      return await pending.terminal;
    } finally {
      try {
        await pending.dispose();
      } finally {
        this.#pending.delete(handle.adapterExecutionId);
      }
    }
  }

  async cancel(handle: ExecutionHandle): Promise<CancelResult> {
    if (this.#reviewHandles.has(handle.adapterExecutionId)) {
      return await this.#options.reviewAdapter.cancel(handle);
    }
    const pending = this.#pending.get(handle.adapterExecutionId);
    if (pending === undefined || !subjectMatches(pending, handle)) {
      return { protocolVersion: 1, accepted: false };
    }
    return { protocolVersion: 1, accepted: await pending.interrupt() };
  }

  async #loadSdk(): Promise<{ readonly installation: ClaudeAgentSdkInstallation; readonly sdk: ClaudeAgentSdkModule }> {
    const installation = this.#options.installation ?? await inspectClaudeAgentSdkInstallation();
    if (this.#options.sdk !== undefined) {
      return { installation, sdk: this.#options.sdk };
    }
    let moduleValue: unknown;
    try {
      moduleValue = await import(pathToFileURL(installation.modulePath).href) as unknown;
    } catch (error) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied Claude Agent SDK could not be loaded", {
        cause: errorMessage(error),
      });
    }
    if (!isRecord(moduleValue) || typeof moduleValue.query !== "function") {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied Claude Agent SDK does not export query()");
    }
    return { installation, sdk: moduleValue as unknown as ClaudeAgentSdkModule };
  }
}

export function createClaudeAgentSdkAdapter(): ClaudeAgentSdkAdapter {
  const reviewExecutable = process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT] || "claude";
  return new ClaudeAgentSdkAdapter({ reviewAdapter: createClaudeCodeAdapter(reviewExecutable) });
}
