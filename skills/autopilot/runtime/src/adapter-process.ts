import { randomUUID } from "node:crypto";
import {
  parseAdapterMessage,
  type CancelResult,
  type CapabilityManifest,
  type ExecutionHandle,
  type ExecutionObservation,
  type ExecutionRequest,
  type HarnessPort,
  type ReviewFinding,
  type ReviewResult,
} from "./adapter-protocol.js";
import { renderAttemptContext, renderReviewContext } from "./attempt-context.js";
import { AutopilotError } from "./errors.js";
import { isRecord } from "./json.js";
import {
  cancelSupervisedProcess,
  launchSupervisedProcess,
  observeSupervisedProcess,
  reattachSupervisedProcess,
  supervisedExecutionId,
  supervisorDirectory,
  type SupervisedProcessRequest,
} from "./process-supervisor.js";
import { boundUtf8, runProcess, type ProcessResult } from "./process.js";

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
  readonly validateResult?: (stdout: string, request: ExecutionRequest) => string | undefined;
  readonly displayStderrActivity?: boolean;
}

interface ExecutionEntry {
  readonly controller: AbortController;
  readonly promise: Promise<ExecutionObservation>;
}

function adapterCredentialNames(request: ExecutionRequest): readonly string[] {
  return [...new Set(request.grants
    .filter(({ actor, family }) => actor === "adapter" && family === "credentials.use")
    .flatMap(({ environmentNames }) => environmentNames ?? []))].sort();
}

function adapterEnvironment(request: ExecutionRequest): NodeJS.ProcessEnv {
  const allowedCredentialNames = new Set(adapterCredentialNames(request));
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name) || allowedCredentialNames.has(name),
  ));
}

function executionPrompt(request: ExecutionRequest): string {
  return request.role === "review"
    ? renderReviewContext(request.context, request.reviewFocus ?? "Review the exact subject for actionable correctness defects.")
    : renderAttemptContext(request.context);
}

function supervisedRequest(
  configuration: CliHarnessConfiguration,
  request: ExecutionRequest,
  environment: Readonly<NodeJS.ProcessEnv>,
): { readonly directory: string; readonly request: SupervisedProcessRequest } | undefined {
  if (request.supervisionDirectory === undefined || process.platform === "win32") {
    return undefined;
  }
  const executionId = supervisedExecutionId(request.runId, request.itemId, request.attemptId, request.role, request.contextHash);
  return {
    directory: supervisorDirectory(request.supervisionDirectory, executionId),
    request: {
      schemaVersion: 1,
      executionId,
      runId: request.runId,
      itemId: request.itemId,
      attemptId: request.attemptId,
      contextHash: request.contextHash,
      executable: configuration.executable,
      arguments: configuration.buildArguments(request, executionPrompt(request)),
      cwd: request.worktreePath,
      environmentNames: Object.keys(environment).sort(),
      credentialEnvironmentNames: adapterCredentialNames(request),
      deadline: request.deadline,
      idleTimeoutMs: request.idleTimeoutMs,
      maximumOutputBytes: request.maximumOutputBytes,
      displayStderrActivity: configuration.displayStderrActivity === true,
    },
  };
}

function stringValues(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringValues);
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap(stringValues);
  }
  return [];
}

function parseFinding(value: unknown): ReviewFinding | undefined {
  if (!isRecord(value) || typeof value.message !== "string" || value.message.length === 0) {
    return undefined;
  }
  if (value.path !== undefined && (typeof value.path !== "string" || value.path.length === 0)) {
    return undefined;
  }
  if (value.line !== undefined && (!Number.isSafeInteger(value.line) || (value.line as number) < 1)) {
    return undefined;
  }
  if (value.severity !== undefined && (typeof value.severity !== "string" || value.severity.length === 0)) {
    return undefined;
  }
  return {
    ...(value.path === undefined ? {} : { path: value.path as string }),
    ...(value.line === undefined ? {} : { line: value.line as number }),
    ...(value.severity === undefined ? {} : { severity: value.severity as string }),
    message: value.message,
  };
}

function normalizeReviewResult(value: unknown): ReviewResult | undefined {
  if (!isRecord(value) || !Array.isArray(value.findings)
    || (value.verdict !== "clean" && value.verdict !== "findings" && value.verdict !== "inconclusive")) {
    return undefined;
  }
  const findings = value.findings.map(parseFinding);
  if (findings.some((finding) => finding === undefined)
    || (value.verdict === "clean" && findings.length > 0)
    || (value.verdict === "findings" && findings.length === 0)) {
    return undefined;
  }
  return { verdict: value.verdict, findings: findings as ReviewFinding[] };
}

export function parseReviewResult(stdout: string): ReviewResult | undefined {
  const marker = "AUTOPILOT_REVIEW_RESULT:";
  const candidates: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let values: readonly string[] = [line];
    try {
      values = stringValues(JSON.parse(line) as unknown);
    } catch {
      // Some adapters may return a plain final response rather than a JSON event.
    }
    values.forEach((value) => {
      const position = value.indexOf(marker);
      if (position >= 0) {
        candidates.push(value.slice(position + marker.length).trim());
      }
    });
  }
  const parsed = candidates.flatMap((candidate): readonly ReviewResult[] => {
    try {
      const result = normalizeReviewResult(JSON.parse(candidate) as unknown);
      return result === undefined ? [] : [result];
    } catch {
      return [];
    }
  });
  const unique = new Map(parsed.map((result) => [JSON.stringify(result), result]));
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}

function redactionValues(credentialEnvironmentNames: readonly string[]): readonly string[] {
  const credentialNames = new Set(credentialEnvironmentNames);
  return Object.entries(process.env).flatMap(([name, value]) => {
    const explicitlyGranted = credentialNames.has(name);
    return value === undefined || value.length === 0
      || (!explicitlyGranted && (value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)))
      ? []
      : [value];
  });
}

function redactSecrets(text: string, credentialEnvironmentNames: readonly string[] = []): string {
  const credentialNames = new Set(credentialEnvironmentNames);
  return Object.entries(process.env).reduce((current, [name, value]) => {
    const explicitlyGranted = credentialNames.has(name);
    if (value === undefined || value.length === 0
      || (!explicitlyGranted && (value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)))) {
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
  readonly #requests = new Map<string, ExecutionRequest>();

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
      restartReattachment: process.platform !== "win32",
      restrictions: this.#configuration.assurance,
      limitations: [
        ...this.#configuration.limitations,
        "Independent review does not require a different model or provider from implementation.",
      ],
    };
    const normalized = parseAdapterMessage(JSON.stringify({ protocolVersion: 1, type: "capabilities", manifest }), 1_048_576);
    if (normalized.type !== "capabilities") {
      throw new AutopilotError("ADAPTER_MALFORMED", "adapter capability normalization failed");
    }
    return normalized.manifest;
  }

  #normalizeResult(
    adapterExecutionId: string,
    request: ExecutionRequest,
    result: ProcessResult,
    statusHint?: ExecutionObservation["status"],
  ): ExecutionObservation {
    const malformedJson = this.#configuration.expectsJsonLines ? validateJsonLines(result, request.maximumLineBytes) : undefined;
    const malformed = malformedJson ?? this.#configuration.validateResult?.(result.stdout, request);
    const status = statusHint ?? (this.#cancelledExecutions.has(adapterExecutionId)
      ? "cancelled"
      : result.exitCode === 0 && malformed === undefined ? "completed" : "failed");
    const terminal = parseAdapterMessage(JSON.stringify({
      protocolVersion: 1,
      type: "terminal",
      executionId: adapterExecutionId,
      status: malformed === undefined ? status : "failed",
      exitCode: result.exitCode,
    }), request.maximumLineBytes);
    if (terminal.type !== "terminal") {
      throw new AutopilotError("ADAPTER_MALFORMED", "adapter terminal normalization failed");
    }
    const stdout = boundUtf8(
      redactSecrets(result.stdout, adapterCredentialNames(request)),
      request.maximumOutputBytes,
    );
    const stderr = boundUtf8(
      redactSecrets(
        malformed === undefined ? result.stderr : `${result.stderr}\n${malformed}`.trim(),
        adapterCredentialNames(request),
      ),
      request.maximumOutputBytes,
    );
    const parsedReviewResult = request.role === "review" ? parseReviewResult(stdout.value) : undefined;
    const reviewResult = parsedReviewResult === undefined ? undefined : {
      ...parsedReviewResult,
      findings: parsedReviewResult.findings.map((finding) => ({
        ...finding,
        message: redactSecrets(finding.message, adapterCredentialNames(request)),
      })),
    };
    return {
      protocolVersion: 1,
      adapterExecutionId,
      status: terminal.status,
      exitCode: terminal.exitCode,
      completedAt: new Date().toISOString(),
      stdout: stdout.value,
      stderr: stderr.value,
      truncated: result.truncated || stdout.truncated || stderr.truncated,
      ...(reviewResult === undefined ? {} : { reviewResult }),
    };
  }

  async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    if (request.protocolVersion !== 1) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution request protocol version is not supported");
    }
    const environment = adapterEnvironment(request);
    const supervised = supervisedRequest(this.#configuration, request, environment);
    if (supervised !== undefined) {
      const handle = await launchSupervisedProcess(supervised.directory, supervised.request, environment);
      this.#requests.set(handle.executionId, request);
      return {
        protocolVersion: 1,
        adapterExecutionId: handle.executionId,
        startedAt: handle.startedAt,
        supervisor: { schemaVersion: 1, directory: handle.directory, requestHash: handle.requestHash },
      };
    }
    const adapterExecutionId = randomUUID();
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const promise = runProcess({
      executable: this.#configuration.executable,
      arguments: this.#configuration.buildArguments(request, executionPrompt(request)),
      cwd: request.worktreePath,
      environment,
      timeoutMs: Math.max(1, Date.parse(request.deadline) - Date.now()),
      idleTimeoutMs: request.idleTimeoutMs,
      maxOutputBytes: request.maximumOutputBytes,
      redactValues: redactionValues(adapterCredentialNames(request)),
      signal: controller.signal,
      ...(this.#configuration.displayStderrActivity === true ? {
        onStderrLine: (line: string): void => {
          process.stderr.write(`${redactSecrets(line, adapterCredentialNames(request))}\n`);
        },
      } : {}),
    }).then((result) => this.#normalizeResult(adapterExecutionId, request, result)).catch((error: unknown): ExecutionObservation => ({
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
    this.#requests.set(adapterExecutionId, request);
    return { protocolVersion: 1, adapterExecutionId, startedAt };
  }

  async reattach(request: ExecutionRequest): Promise<ExecutionHandle | undefined> {
    const environment = adapterEnvironment(request);
    const supervised = supervisedRequest(this.#configuration, request, environment);
    if (supervised === undefined) {
      return undefined;
    }
    const handle = await reattachSupervisedProcess(supervised.directory, supervised.request);
    if (handle === undefined) {
      return undefined;
    }
    this.#requests.set(handle.executionId, request);
    return {
      protocolVersion: 1,
      adapterExecutionId: handle.executionId,
      startedAt: handle.startedAt,
      supervisor: { schemaVersion: 1, directory: handle.directory, requestHash: handle.requestHash },
    };
  }

  async observe(handle: ExecutionHandle): Promise<ExecutionObservation> {
    const request = this.#requests.get(handle.adapterExecutionId);
    if (handle.supervisor !== undefined) {
      if (request === undefined) {
        throw new AutopilotError("ADAPTER_UNSUPPORTED", `supervised execution request is not attached: ${handle.adapterExecutionId}`);
      }
      try {
        const observed = await observeSupervisedProcess(
          {
            schemaVersion: 1,
            executionId: handle.adapterExecutionId,
            directory: handle.supervisor.directory,
            requestHash: handle.supervisor.requestHash,
            startedAt: handle.startedAt,
          },
          this.#configuration.displayStderrActivity === true
            ? (line: string): void => {
                process.stderr.write(`${line}\n`);
              }
            : undefined,
        );
        const status = observed.state === "cancelled"
          ? "cancelled"
          : observed.state === "timed-out" ? "timed-out" : undefined;
        return this.#normalizeResult(handle.adapterExecutionId, request, observed.result, status);
      } finally {
        this.#requests.delete(handle.adapterExecutionId);
      }
    }
    const execution = this.#executions.get(handle.adapterExecutionId);
    if (execution === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", `execution is not attached: ${handle.adapterExecutionId}`);
    }
    try {
      return await execution.promise;
    } finally {
      this.#executions.delete(handle.adapterExecutionId);
      this.#cancelledExecutions.delete(handle.adapterExecutionId);
      this.#requests.delete(handle.adapterExecutionId);
    }
  }

  async cancel(handle: ExecutionHandle): Promise<CancelResult> {
    if (!this.#configuration.cancellation) {
      return { protocolVersion: 1, accepted: false };
    }
    if (handle.supervisor !== undefined) {
      await cancelSupervisedProcess({
        schemaVersion: 1,
        executionId: handle.adapterExecutionId,
        directory: handle.supervisor.directory,
        requestHash: handle.supervisor.requestHash,
        startedAt: handle.startedAt,
      });
      return { protocolVersion: 1, accepted: true };
    }
    const execution = this.#executions.get(handle.adapterExecutionId);
    if (execution === undefined) {
      return { protocolVersion: 1, accepted: false };
    }
    this.#cancelledExecutions.add(handle.adapterExecutionId);
    execution.controller.abort();
    return { protocolVersion: 1, accepted: true };
  }
}
