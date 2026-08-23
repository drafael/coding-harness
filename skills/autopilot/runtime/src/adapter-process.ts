import { randomUUID } from "node:crypto";
import {
  parseAdapterMessage,
  type CancelResult,
  type CapabilityManifest,
  type ExecutionHandle,
  type ExecutionObservation,
  type ExecutionRequest,
  type HarnessPort,
} from "./adapter-protocol.js";
import { AutopilotError } from "./errors.js";
import { runProcess, type ProcessResult } from "./process.js";

export interface CliHarnessConfiguration {
  readonly name: string;
  readonly executable: string;
  readonly versionArguments: readonly string[];
  readonly buildArguments: (request: ExecutionRequest, prompt: string) => readonly string[];
  readonly assurance: "cooperative" | "enforced";
  readonly maxConcurrency: number;
  readonly cancellation: boolean;
  readonly limitations: readonly string[];
  readonly expectsJsonLines: boolean;
  readonly validateResult?: (stdout: string) => string | undefined;
  readonly displayStderrActivity?: boolean;
}

interface ExecutionEntry {
  readonly controller: AbortController;
  readonly promise: Promise<ExecutionObservation>;
}

function adapterEnvironment(request: ExecutionRequest): NodeJS.ProcessEnv {
  const allowedCredentialNames = new Set(
    request.grants
      .filter(({ actor, family }) => actor === "adapter" && family === "credentials.use")
      .flatMap(({ environmentNames }) => environmentNames ?? []),
  );
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name) || allowedCredentialNames.has(name),
  ));
}

function workerPrompt(request: ExecutionRequest): string {
  return [
    "You are a bounded Autopilot implementation worker.",
    `Objective: ${request.objective}`,
    `Acceptance: ${request.acceptanceSummary}`,
    `Writable repository-relative roots: ${request.writableRoots.join(", ")}`,
    "Edit only those roots. Do not commit, push, create or update change requests, merge, reset, clean, or modify Git refs.",
    "Run only exploratory checks needed to implement the objective. The Autopilot runtime independently verifies and owns lifecycle decisions.",
    "When finished, summarize edits and unresolved blockers. Your summary is not completion evidence.",
  ].join("\n\n");
}

function redactSecrets(text: string): string {
  return Object.entries(process.env).reduce((current, [name, value]) => {
    if (value === undefined || value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)) {
      return current;
    }
    return current.replaceAll(value, "****");
  }, text);
}

function validateJsonLines(result: ProcessResult, maximumLineBytes: number): string | undefined {
  for (const [index, line] of result.stdout.split("\n").entries()) {
    if (line.length === 0) {
      continue;
    }
    if (Buffer.byteLength(line) > maximumLineBytes) {
      return `native event line ${index + 1} exceeded ${maximumLineBytes} bytes`;
    }
    try {
      JSON.parse(line) as unknown;
    } catch {
      return `native event line ${index + 1} was not valid JSON`;
    }
  }
  return undefined;
}

export class CliHarnessAdapter implements HarnessPort {
  readonly #configuration: CliHarnessConfiguration;
  readonly #executions = new Map<string, ExecutionEntry>();
  readonly #cancelledExecutions = new Set<string>();

  constructor(configuration: CliHarnessConfiguration) {
    this.#configuration = configuration;
  }

  async describe(): Promise<CapabilityManifest> {
    const version = await runProcess({
      executable: this.#configuration.executable,
      arguments: this.#configuration.versionArguments,
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxOutputBytes: 65_536,
    });
    if (version.exitCode !== 0) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", `${this.#configuration.name} is missing or did not report a version`);
    }
    const manifest: CapabilityManifest = {
      protocolVersion: 1,
      adapterName: this.#configuration.name,
      adapterVersion: "1",
      harnessVersion: `${version.stdout}\n${version.stderr}`.trim().split("\n")[0] ?? "unknown",
      families: ["files.read", "files.write", "process.execute", "network.access", "credentials.use"],
      assurance: this.#configuration.assurance,
      unattended: true,
      maxConcurrency: this.#configuration.maxConcurrency,
      eventStreaming: this.#configuration.expectsJsonLines,
      cancellation: this.#configuration.cancellation,
      restartReattachment: false,
      restrictions: this.#configuration.assurance,
      limitations: this.#configuration.limitations,
    };
    const normalized = parseAdapterMessage(JSON.stringify({ protocolVersion: 1, type: "capabilities", manifest }), 1_048_576);
    if (normalized.type !== "capabilities") {
      throw new AutopilotError("ADAPTER_MALFORMED", "adapter capability normalization failed");
    }
    return normalized.manifest;
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    if (request.protocolVersion !== 1) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution request protocol version is not supported");
    }
    const adapterExecutionId = randomUUID();
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
    const promise = runProcess({
      executable: this.#configuration.executable,
      arguments: this.#configuration.buildArguments(request, workerPrompt(request)),
      cwd: request.worktreePath,
      environment: adapterEnvironment(request),
      timeoutMs,
      idleTimeoutMs: request.idleTimeoutMs,
      maxOutputBytes: request.maximumOutputBytes,
      signal: controller.signal,
      ...(this.#configuration.displayStderrActivity === true ? {
        onStderrLine: (line: string): void => {
          process.stderr.write(`${redactSecrets(line)}\n`);
        },
      } : {}),
    }).then((result): ExecutionObservation => {
      const malformedJson = this.#configuration.expectsJsonLines ? validateJsonLines(result, request.maximumLineBytes) : undefined;
      const malformed = malformedJson ?? this.#configuration.validateResult?.(result.stdout);
      const terminal = parseAdapterMessage(JSON.stringify({
        protocolVersion: 1,
        type: "terminal",
        executionId: adapterExecutionId,
        status: this.#cancelledExecutions.has(adapterExecutionId)
          ? "cancelled"
          : result.exitCode === 0 && malformed === undefined ? "completed" : "failed",
        exitCode: result.exitCode,
      }), request.maximumLineBytes);
      if (terminal.type !== "terminal") {
        throw new AutopilotError("ADAPTER_MALFORMED", "adapter terminal normalization failed");
      }
      return {
        protocolVersion: 1,
        adapterExecutionId,
        status: terminal.status,
        exitCode: terminal.exitCode,
        completedAt: new Date().toISOString(),
        stdout: redactSecrets(result.stdout),
        stderr: redactSecrets(malformed === undefined ? result.stderr : `${result.stderr}\n${malformed}`.trim()),
        truncated: result.truncated,
      };
    }).catch((error: unknown): ExecutionObservation => ({
      protocolVersion: 1,
      adapterExecutionId,
      status: this.#cancelledExecutions.has(adapterExecutionId)
        ? "cancelled"
        : error instanceof AutopilotError && error.code === "ADAPTER_TIMEOUT" ? "timed-out" : "failed",
      exitCode: 124,
      completedAt: new Date().toISOString(),
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
    }));
    this.#executions.set(adapterExecutionId, { controller, promise });
    return { protocolVersion: 1, adapterExecutionId, startedAt };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    const execution = this.#executions.get(handle.adapterExecutionId);
    if (execution === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", `execution is not attached: ${handle.adapterExecutionId}`);
    }
    try {
      return await execution.promise;
    } finally {
      this.#executions.delete(handle.adapterExecutionId);
      this.#cancelledExecutions.delete(handle.adapterExecutionId);
    }
  }

  async cancel(handle: ExecutionHandle): Promise<CancelResult> {
    const execution = this.#executions.get(handle.adapterExecutionId);
    if (execution === undefined || !this.#configuration.cancellation) {
      return { protocolVersion: 1, accepted: false };
    }
    this.#cancelledExecutions.add(handle.adapterExecutionId);
    execution.controller.abort();
    return { protocolVersion: 1, accepted: true };
  }
}
