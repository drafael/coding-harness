import { randomUUID } from "node:crypto";
import {
  type CancelResult,
  type CapabilityManifest,
  type ExecutionHandle,
  type ExecutionObservation,
  type ExecutionRequest,
  type HarnessPort,
} from "../../src/adapter-protocol.js";
import { renderAttemptContext } from "../../src/attempt-context.js";
import { AutopilotError } from "../../src/errors.js";
import { canonicalJson, isRecord, sha256 } from "../../src/json.js";
import { boundUtf8 } from "../../src/process.js";

export const PI_SUBAGENT_REQUEST_EVENT = "prompt-template:subagent:request";
export const PI_SUBAGENT_STARTED_EVENT = "prompt-template:subagent:started";
export const PI_SUBAGENT_UPDATE_EVENT = "prompt-template:subagent:update";
export const PI_SUBAGENT_RESPONSE_EVENT = "prompt-template:subagent:response";
export const PI_SUBAGENT_CANCEL_EVENT = "prompt-template:subagent:cancel";

export interface PiEventBus {
  on(event: string, handler: (value: unknown) => void): () => void;
  emit(event: string, value: unknown): void;
}

export interface PiInProcessAdapterOptions {
  readonly events: PiEventBus;
  readonly harnessInstanceId: string;
  readonly harnessVersion: string;
  readonly piSubagentsVersion: string;
  readonly reviewAdapter: HarnessPort;
  readonly onActivity?: (message: string) => void;
}

interface DelegationIdentity {
  readonly requestId: string;
  readonly ownerRunId: string;
  readonly nodeId: string;
  readonly subjectId: string;
}

interface PendingExecution {
  readonly request: ExecutionRequest;
  readonly identity: DelegationIdentity;
  readonly startedAt: string;
  readonly terminal: Promise<ExecutionObservation>;
  readonly rejectStarted: (error: Error) => void;
  readonly rejectTerminal: (error: Error) => void;
  readonly isTerminalAccepted: () => boolean;
  readonly disposeListeners: () => void;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function identityFor(request: ExecutionRequest): DelegationIdentity {
  const requestId = randomUUID();
  const ownerRunId = request.runId;
  const nodeId = `autopilot-${sha256(canonicalJson({
    runId: request.runId,
    itemId: request.itemId,
    attemptId: request.attemptId,
    leaseEpoch: request.context.leaseEpoch,
    contextHash: request.contextHash,
  })).slice(0, 40)}`;
  return {
    requestId,
    ownerRunId,
    nodeId,
    subjectId: sha256(canonicalJson({ requestId, ownerRunId, nodeId })),
  };
}

function delegationTuple(identity: DelegationIdentity): Pick<DelegationIdentity, "requestId" | "ownerRunId" | "nodeId"> {
  return { requestId: identity.requestId, ownerRunId: identity.ownerRunId, nodeId: identity.nodeId };
}

function exactIdentity(value: unknown, identity: DelegationIdentity): value is Record<string, unknown> {
  return isRecord(value) && value.requestId === identity.requestId
    && value.ownerRunId === identity.ownerRunId && value.nodeId === identity.nodeId;
}

function credentialEnvironmentNames(request: ExecutionRequest): ReadonlySet<string> {
  return new Set(request.grants
    .filter(({ actor, family }) => actor === "adapter" && family === "credentials.use")
    .flatMap(({ environmentNames }) => environmentNames ?? []));
}

function redactSecrets(text: string, request: ExecutionRequest): string {
  const grantedNames = credentialEnvironmentNames(request);
  return Object.entries(process.env).reduce((redacted, [name, value]) => {
    const granted = grantedNames.has(name);
    return value === undefined || value === ""
      || (!granted && !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/iu.test(name))
      ? redacted
      : redacted.replaceAll(value, "****");
  }, text);
}

function terminalObservation(
  request: ExecutionRequest,
  identity: DelegationIdentity,
  value: Record<string, unknown>,
): ExecutionObservation {
  const status = value.status;
  const result = isRecord(value.result) ? value.result : undefined;
  const text = result?.kind === "text" && typeof result.text === "string" ? result.text : undefined;
  const error = typeof value.error === "string" ? value.error : "";
  const boundedText = boundUtf8(redactSecrets(text ?? "", request), request.maximumOutputBytes);
  const boundedError = boundUtf8(redactSecrets(error, request), request.maximumOutputBytes);
  const completed = status === "completed" && text !== undefined && !boundedText.truncated;
  const observationStatus: ExecutionObservation["status"] = completed
    ? "completed"
    : status === "cancelled" || status === "interrupted" ? "cancelled"
      : status === "timed_out" ? "timed-out" : "failed";
  const malformed = status === "completed" && text === undefined
    ? "Pi structured delegation completed without the required text result"
    : status === "completed" && boundedText.truncated
      ? "Pi structured delegation result exceeded the Autopilot output bound"
      : undefined;
  return {
    protocolVersion: 1,
    adapterExecutionId: identity.requestId,
    status: observationStatus,
    exitCode: observationStatus === "completed" ? 0 : observationStatus === "timed-out" ? 124
      : observationStatus === "cancelled" ? 130 : 1,
    completedAt: new Date().toISOString(),
    stdout: completed ? boundedText.value : "",
    stderr: malformed ?? (boundedError.value || "Pi structured delegation ended without a valid completion result"),
    truncated: boundedText.truncated || boundedError.truncated,
  };
}

export class PiInProcessAdapter implements HarnessPort {
  readonly #options: PiInProcessAdapterOptions;
  readonly #pending = new Map<string, PendingExecution>();
  readonly #reviewHandles = new Set<string>();
  #active = true;

  constructor(options: PiInProcessAdapterOptions) {
    this.#options = options;
  }

  async describe(): Promise<CapabilityManifest> {
    if (!this.#active) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "the owning Pi extension context is no longer active");
    }
    return {
      protocolVersion: 1,
      adapterName: "pi",
      adapterVersion: "2",
      harnessVersion: this.#options.harnessVersion,
      families: ["files.read", "files.write", "process.execute", "network.access", "credentials.use"],
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
        review: {
          schemaVersion: 1,
          owner: "runtime",
          continuity: "session",
          terminality: "cooperative",
          admission: "single-shot",
        },
      },
      restrictions: "cooperative",
      limitations: [
        `Pi implementation workers use pi-subagents ${this.#options.piSubagentsVersion} process-local structured delegation.`,
        "Completion proves an exact logical terminal response from the uninterrupted Pi extension context, not OS process-tree quiescence.",
        "The process-local worker inherits the owning Pi process environment; grant restrictions remain cooperative.",
        "Independent review uses the direct session-scoped Pi adapter.",
      ],
    };
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    if (request.role === "review") {
      const handle = await this.#options.reviewAdapter.launch(request);
      this.#reviewHandles.add(handle.adapterExecutionId);
      return handle;
    }
    if (!this.#active) {
      throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "the owning Pi extension context is no longer active");
    }
    const identity = identityFor(request);
    const started = deferred<void>();
    const terminal = deferred<ExecutionObservation>();
    void terminal.promise.catch(() => undefined);
    let startedAccepted = false;
    let terminalAccepted = false;
    const cleanups: Array<() => void> = [];
    const disposeListeners = (): void => cleanups.splice(0).forEach((dispose) => dispose());
    const fail = (message: string): void => {
      if (terminalAccepted) {
        return;
      }
      terminalAccepted = true;
      const error = new AutopilotError("EXECUTION_STATE_UNKNOWN", message);
      if (!startedAccepted) {
        started.reject(error);
        this.#pending.delete(identity.requestId);
      }
      terminal.reject(error);
      disposeListeners();
    };
    cleanups.push(this.#options.events.on(PI_SUBAGENT_STARTED_EVENT, (value) => {
      if (!exactIdentity(value, identity) || startedAccepted || terminalAccepted) {
        return;
      }
      startedAccepted = true;
      resetIdleTimer();
      started.resolve();
      this.#options.onActivity?.(`Pi worker started · ${request.itemId}`);
    }));
    cleanups.push(this.#options.events.on(PI_SUBAGENT_UPDATE_EVENT, (value) => {
      if (!exactIdentity(value, identity) || terminalAccepted) {
        return;
      }
      const currentTool = typeof value.currentTool === "string"
        ? boundUtf8(redactSecrets(value.currentTool, request), 128).value : undefined;
      const fields = [
        currentTool,
        typeof value.toolCount === "number" && Number.isFinite(value.toolCount) && value.toolCount >= 0
          ? `${value.toolCount} tools` : undefined,
        typeof value.tokens === "number" && Number.isFinite(value.tokens) && value.tokens >= 0
          ? `${value.tokens} tokens` : undefined,
        typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0
          ? `${Math.round(value.durationMs / 1_000)}s` : undefined,
      ].filter((field) => field !== undefined);
      resetIdleTimer();
      if (fields.length > 0) {
        this.#options.onActivity?.(`Pi worker · ${fields.join(" · ")}`);
      }
    }));
    cleanups.push(this.#options.events.on(PI_SUBAGENT_RESPONSE_EVENT, (value) => {
      if (!exactIdentity(value, identity) || terminalAccepted) {
        return;
      }
      if (!startedAccepted) {
        fail("Pi structured delegation returned terminal state before exact admission was observed");
        return;
      }
      terminalAccepted = true;
      terminal.resolve(terminalObservation(request, identity, value));
      disposeListeners();
    }));
    const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
    const cancelForUnknownState = (message: string): void => {
      if (!terminalAccepted && this.#active) {
        try {
          this.#options.events.emit(PI_SUBAGENT_CANCEL_EVENT, delegationTuple(identity));
        } catch {
          fail(`${message}; cancellation delivery also failed`);
          return;
        }
      }
      fail(message);
    };
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        cancelForUnknownState("Pi structured delegation exceeded the harness idle timeout without an exact terminal response");
      }, request.idleTimeoutMs);
      idleTimer.unref();
    };
    resetIdleTimer();
    cleanups.push(() => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
    });
    const deadlineTimer = setTimeout(() => {
      cancelForUnknownState("Pi structured delegation did not return an exact terminal response before the attempt deadline");
    }, timeoutMs);
    deadlineTimer.unref();
    cleanups.push(() => clearTimeout(deadlineTimer));
    const pending: PendingExecution = {
      request,
      identity,
      startedAt: new Date().toISOString(),
      terminal: terminal.promise,
      rejectStarted: started.reject,
      rejectTerminal: terminal.reject,
      isTerminalAccepted: () => terminalAccepted,
      disposeListeners,
    };
    this.#pending.set(identity.requestId, pending);
    try {
      this.#options.events.emit(PI_SUBAGENT_REQUEST_EVENT, {
        requestId: identity.requestId,
        ownerRunId: identity.ownerRunId,
        nodeId: identity.nodeId,
        agent: "worker",
        task: renderAttemptContext(request.context),
        context: "fresh",
        cwd: request.worktreePath,
        timeoutMs,
        artifacts: true,
        result: { kind: "text" },
      });
    } catch (error) {
      fail(`Pi structured delegation request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await started.promise;
    return {
      protocolVersion: 1,
      adapterExecutionId: identity.requestId,
      startedAt: pending.startedAt,
      subject: {
        schemaVersion: 1,
        backendId: `pi-subagents-structured-v1@${this.#options.piSubagentsVersion}`,
        subjectId: identity.subjectId,
        harnessInstanceId: this.#options.harnessInstanceId,
      },
    };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    if (this.#reviewHandles.delete(handle.adapterExecutionId)) {
      return await this.#options.reviewAdapter.observe(handle);
    }
    const pending = this.#pending.get(handle.adapterExecutionId);
    if (pending === undefined || handle.subject?.subjectId !== pending.identity.subjectId
      || handle.subject.harnessInstanceId !== this.#options.harnessInstanceId) {
      throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Pi execution is not attached to the exact owning extension instance");
    }
    try {
      return await pending.terminal;
    } finally {
      this.#pending.delete(handle.adapterExecutionId);
    }
  }

  async cancel(handle: ExecutionHandle): Promise<CancelResult> {
    if (this.#reviewHandles.has(handle.adapterExecutionId)) {
      return await this.#options.reviewAdapter.cancel(handle);
    }
    const pending = this.#pending.get(handle.adapterExecutionId);
    if (!this.#active || pending === undefined || handle.subject?.subjectId !== pending.identity.subjectId
      || handle.subject.harnessInstanceId !== this.#options.harnessInstanceId) {
      return { protocolVersion: 1, accepted: false };
    }
    try {
      this.#options.events.emit(PI_SUBAGENT_CANCEL_EVENT, delegationTuple(pending.identity));
      return { protocolVersion: 1, accepted: true };
    } catch {
      return { protocolVersion: 1, accepted: false };
    }
  }

  invalidate(reason: string): void {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    for (const pending of this.#pending.values()) {
      if (pending.isTerminalAccepted()) {
        continue;
      }
      const error = new AutopilotError("EXECUTION_STATE_UNKNOWN", reason);
      pending.rejectStarted(error);
      pending.rejectTerminal(error);
      pending.disposeListeners();
      this.#pending.delete(pending.identity.requestId);
    }
  }
}
