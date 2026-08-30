import { randomUUID } from "node:crypto";
import { parseAdapterMessage, } from "./adapter-protocol.js";
import { renderAttemptContext, renderReviewContext } from "./attempt-context.js";
import { AutopilotError } from "./errors.js";
import { isRecord } from "./json.js";
import { runProcess } from "./process.js";
function adapterEnvironment(request) {
    const allowedCredentialNames = new Set(request.grants
        .filter(({ actor, family }) => actor === "adapter" && family === "credentials.use")
        .flatMap(({ environmentNames }) => environmentNames ?? []));
    return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name) || allowedCredentialNames.has(name)));
}
function executionPrompt(request) {
    return request.role === "review"
        ? renderReviewContext(request.context, request.reviewFocus ?? "Review the exact subject for actionable correctness defects.")
        : renderAttemptContext(request.context);
}
function stringValues(value) {
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
function parseFinding(value) {
    if (!isRecord(value) || typeof value.message !== "string" || value.message.length === 0) {
        return undefined;
    }
    if (value.path !== undefined && (typeof value.path !== "string" || value.path.length === 0)) {
        return undefined;
    }
    if (value.line !== undefined && (!Number.isSafeInteger(value.line) || value.line < 1)) {
        return undefined;
    }
    if (value.severity !== undefined && (typeof value.severity !== "string" || value.severity.length === 0)) {
        return undefined;
    }
    return {
        ...(value.path === undefined ? {} : { path: value.path }),
        ...(value.line === undefined ? {} : { line: value.line }),
        ...(value.severity === undefined ? {} : { severity: value.severity }),
        message: value.message,
    };
}
function normalizeReviewResult(value) {
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
    return { verdict: value.verdict, findings: findings };
}
export function parseReviewResult(stdout) {
    const marker = "AUTOPILOT_REVIEW_RESULT:";
    const candidates = [];
    for (const line of stdout.split("\n")) {
        if (line.length === 0) {
            continue;
        }
        let values = [line];
        try {
            values = stringValues(JSON.parse(line));
        }
        catch {
            // Some adapters may return a plain final response rather than a JSON event.
        }
        values.forEach((value) => {
            const position = value.indexOf(marker);
            if (position >= 0) {
                candidates.push(value.slice(position + marker.length).trim());
            }
        });
    }
    const parsed = candidates.flatMap((candidate) => {
        try {
            const result = normalizeReviewResult(JSON.parse(candidate));
            return result === undefined ? [] : [result];
        }
        catch {
            return [];
        }
    });
    const unique = new Map(parsed.map((result) => [JSON.stringify(result), result]));
    return unique.size === 1 ? [...unique.values()][0] : undefined;
}
function redactSecrets(text) {
    return Object.entries(process.env).reduce((current, [name, value]) => {
        if (value === undefined || value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)) {
            return current;
        }
        return current.replaceAll(value, "****");
    }, text);
}
function validateJsonLines(result, maximumLineBytes) {
    for (const [index, line] of result.stdout.split("\n").entries()) {
        if (line.length === 0) {
            continue;
        }
        if (Buffer.byteLength(line) > maximumLineBytes) {
            return `native event line ${index + 1} exceeded ${maximumLineBytes} bytes`;
        }
        try {
            JSON.parse(line);
        }
        catch {
            return `native event line ${index + 1} was not valid JSON`;
        }
    }
    return undefined;
}
export class CliHarnessAdapter {
    #configuration;
    #executions = new Map();
    #cancelledExecutions = new Set();
    constructor(configuration) {
        this.#configuration = configuration;
    }
    async describe() {
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
        const manifest = {
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
    async launch(request) {
        if (request.protocolVersion !== 1) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution request protocol version is not supported");
        }
        const adapterExecutionId = randomUUID();
        const startedAt = new Date().toISOString();
        const controller = new AbortController();
        const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
        const promise = runProcess({
            executable: this.#configuration.executable,
            arguments: this.#configuration.buildArguments(request, executionPrompt(request)),
            cwd: request.worktreePath,
            environment: adapterEnvironment(request),
            timeoutMs,
            idleTimeoutMs: request.idleTimeoutMs,
            maxOutputBytes: request.maximumOutputBytes,
            signal: controller.signal,
            ...(this.#configuration.displayStderrActivity === true ? {
                onStderrLine: (line) => {
                    process.stderr.write(`${redactSecrets(line)}\n`);
                },
            } : {}),
        }).then((result) => {
            const malformedJson = this.#configuration.expectsJsonLines ? validateJsonLines(result, request.maximumLineBytes) : undefined;
            const malformed = malformedJson ?? this.#configuration.validateResult?.(result.stdout, request);
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
            const parsedReviewResult = request.role === "review" ? parseReviewResult(result.stdout) : undefined;
            const reviewResult = parsedReviewResult === undefined ? undefined : {
                ...parsedReviewResult,
                findings: parsedReviewResult.findings.map((finding) => ({
                    ...finding,
                    message: redactSecrets(finding.message),
                })),
            };
            return {
                protocolVersion: 1,
                adapterExecutionId,
                status: terminal.status,
                exitCode: terminal.exitCode,
                completedAt: new Date().toISOString(),
                stdout: redactSecrets(result.stdout),
                stderr: redactSecrets(malformed === undefined ? result.stderr : `${result.stderr}\n${malformed}`.trim()),
                truncated: result.truncated,
                ...(reviewResult === undefined ? {} : { reviewResult }),
            };
        }).catch((error) => ({
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
    async observe(handle) {
        const execution = this.#executions.get(handle.adapterExecutionId);
        if (execution === undefined) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", `execution is not attached: ${handle.adapterExecutionId}`);
        }
        try {
            return await execution.promise;
        }
        finally {
            this.#executions.delete(handle.adapterExecutionId);
            this.#cancelledExecutions.delete(handle.adapterExecutionId);
        }
    }
    async cancel(handle) {
        const execution = this.#executions.get(handle.adapterExecutionId);
        if (execution === undefined || !this.#configuration.cancellation) {
            return { protocolVersion: 1, accepted: false };
        }
        this.#cancelledExecutions.add(handle.adapterExecutionId);
        execution.controller.abort();
        return { protocolVersion: 1, accepted: true };
    }
}
