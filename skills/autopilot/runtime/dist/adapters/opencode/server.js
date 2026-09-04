import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { executionAssuranceFor, } from "../../src/adapter-protocol.js";
import { adapterCredentialNames, adapterEnvironment, redactionValues } from "../../src/adapter-process.js";
import { renderAttemptContext } from "../../src/attempt-context.js";
import { AutopilotError } from "../../src/errors.js";
import { canonicalJson, isRecord, sha256 } from "../../src/json.js";
import { boundUtf8, runProcess, StreamingRedactor, terminateDirectChild } from "../../src/process.js";
function deferred() {
    let resolvePromise = () => undefined;
    let rejectPromise = () => undefined;
    const promise = new Promise((resolvePromiseValue, rejectPromiseValue) => {
        resolvePromise = resolvePromiseValue;
        rejectPromise = rejectPromiseValue;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function requiredRecord(value, label) {
    if (!isRecord(value)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `${label} is malformed`);
    }
    return value;
}
function requiredString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `${label} is malformed`);
    }
    return value;
}
function redact(text, values) {
    return [...new Set(values.filter((value) => value.length > 0))]
        .sort((left, right) => right.length - left.length)
        .reduce((current, value) => current.split(value).join("****"), text);
}
function nestedStrings(value) {
    if (typeof value === "string") {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(nestedStrings);
    }
    if (isRecord(value)) {
        return Object.values(value).flatMap(nestedStrings);
    }
    return [];
}
function isTerminalAssistant(info, messageId) {
    if (info.role !== "assistant" || info.parentID !== messageId || !isRecord(info.time)
        || typeof info.time.completed !== "number" || !Number.isFinite(info.time.completed)) {
        return false;
    }
    if (info.error !== undefined) {
        return true;
    }
    return typeof info.finish === "string" && !["tool-calls", "unknown"].includes(info.finish);
}
function isAbortedError(value) {
    return isRecord(value) && value.name === "MessageAbortedError";
}
function textOutput(value) {
    const response = requiredRecord(value, "OpenCode assistant message");
    const parts = Array.isArray(response.parts) ? response.parts : [];
    return parts.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("");
}
async function responseBody(response, maximumBytes, label) {
    if (response.body === null) {
        return "";
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const item = await reader.read();
        if (item.done) {
            break;
        }
        const chunk = Buffer.from(item.value);
        size += chunk.byteLength;
        if (size > maximumBytes) {
            await reader.cancel();
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `${label} exceeded the configured protocol bound`);
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
function createHttpClient(options) {
    const authorization = `Basic ${Buffer.from(`autopilot:${options.password}`).toString("base64")}`;
    const headers = {
        authorization,
        "x-opencode-directory": options.worktreePath,
    };
    const request = async (path, init = {}) => {
        let response;
        try {
            response = await fetch(`${options.baseUrl}${path}`, {
                ...init,
                headers: { ...headers, ...init.headers },
                signal: options.signal,
            });
        }
        catch (error) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `OpenCode server request failed: ${path}`, {
                cause: errorMessage(error),
            });
        }
        if (!response.ok) {
            const body = await responseBody(response, options.maximumBytes, "OpenCode error response");
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `OpenCode server request failed: ${path}`, {
                status: response.status,
                body: redact(body, options.redactionValues),
            });
        }
        return response;
    };
    return {
        async json(path, init = {}) {
            const response = await request(path, init);
            if (response.status === 204) {
                return undefined;
            }
            const body = await responseBody(response, options.maximumBytes, "OpenCode JSON response");
            try {
                return JSON.parse(body);
            }
            catch (error) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server returned malformed JSON", {
                    cause: errorMessage(error),
                });
            }
        },
        async eventResponse() {
            const response = await request("/event", { headers: { accept: "text/event-stream" } });
            if (response.body === null) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server returned an empty event stream");
            }
            return response;
        },
    };
}
async function consumeEvents(options) {
    if (options.response.body === null) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server returned an empty event stream");
    }
    const reader = options.response.body.getReader();
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let eventData = [];
    for (;;) {
        const item = await reader.read();
        if (item.done) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server event stream ended before terminal state");
        }
        buffer += decoder.write(Buffer.from(item.value));
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            let line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.endsWith("\r")) {
                line = line.slice(0, -1);
            }
            if (Buffer.byteLength(line) > options.maximumLineBytes) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server event exceeded the configured line bound");
            }
            if (line.length === 0) {
                if (eventData.length > 0) {
                    const data = eventData.join("\n");
                    eventData = [];
                    let value;
                    try {
                        value = JSON.parse(data);
                    }
                    catch (error) {
                        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server emitted malformed event JSON", {
                            cause: errorMessage(error),
                        });
                    }
                    await options.onEvent(value);
                }
            }
            else if (line.startsWith("data:")) {
                const data = line.slice(5).trimStart();
                const size = Buffer.byteLength(eventData.join("\n")) + Buffer.byteLength(data);
                if (size > options.maximumLineBytes) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server event exceeded the configured line bound");
                }
                eventData.push(data);
            }
            else if (!line.startsWith(":")) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server emitted an unsupported SSE field");
            }
            newline = buffer.indexOf("\n");
        }
        if (Buffer.byteLength(buffer) > options.maximumLineBytes) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server event exceeded the configured line bound");
        }
    }
}
async function validatePath(value, worktreePath) {
    const response = requiredRecord(value, "OpenCode path response");
    const [expected, directory, worktree] = await Promise.all([
        realpath(worktreePath),
        realpath(requiredString(response.directory, "OpenCode directory")),
        realpath(requiredString(response.worktree, "OpenCode worktree")),
    ]);
    if (directory !== expected || worktree !== expected) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server selected a different worktree");
    }
}
export class OpenCodeServerAdapter {
    #options;
    #pending = new Map();
    #reviewHandles = new Set();
    #harnessVersion;
    constructor(options) {
        this.#options = options;
    }
    async describe() {
        const directManifest = await this.#options.reviewAdapter.describe();
        const server = await runProcess({
            executable: this.#options.executable,
            arguments: ["serve", "--help"],
            cwd: process.cwd(),
            timeoutMs: 10_000,
            maxOutputBytes: 65_536,
        });
        if (server.exitCode !== 0) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "OpenCode server is unavailable");
        }
        this.#harnessVersion = directManifest.harnessVersion;
        return {
            protocolVersion: 1,
            adapterName: "opencode-server",
            adapterVersion: "1",
            harnessVersion: directManifest.harnessVersion,
            families: directManifest.families,
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
                review: executionAssuranceFor(directManifest, "review"),
            },
            restrictions: "cooperative",
            limitations: [
                "OpenCode server implementation completion requires one uninterrupted event stream plus fresh reconciliation of the exact session and caller-selected message.",
                "Coordinator, event-stream, server-process, or identity loss is execution-state-unknown and cannot launch a replacement prompt.",
                "Logical completion and abort do not prove operating-system process-tree quiescence, filesystem confinement, or rollback external effects.",
                "OpenCode session data can persist in the provider data store after the per-attempt server process exits.",
                "Independent review uses the direct OpenCode CLI adapter.",
            ],
        };
    }
    async launch(request) {
        if (request.role === "review") {
            const handle = await this.#options.reviewAdapter.launch(request);
            this.#reviewHandles.add(handle.adapterExecutionId);
            return handle;
        }
        if (request.protocolVersion !== 1) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution request protocol version is not supported");
        }
        if (this.#harnessVersion === undefined) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "OpenCode server capabilities must be loaded before launch");
        }
        const harnessVersion = this.#harnessVersion;
        const adapterExecutionId = randomUUID();
        const harnessInstanceId = randomUUID();
        const password = randomBytes(24).toString("hex");
        const startedAt = new Date().toISOString();
        const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
        const credentials = adapterCredentialNames(request);
        const secrets = [...redactionValues(credentials), password];
        const stderrRedactor = new StreamingRedactor(secrets);
        const stderr = { value: "", truncated: false, finished: false };
        const terminal = deferred();
        const serverConnected = deferred();
        const startupUrl = deferred();
        void terminal.promise.catch(() => undefined);
        void serverConnected.promise.catch(() => undefined);
        void startupUrl.promise.catch(() => undefined);
        let child;
        let client;
        let sessionId;
        let startupOrigin;
        let outputTruncated = false;
        let terminalAccepted = false;
        let executionUnknown;
        let seenBusy = false;
        let seenSessionError = false;
        let reconciling = false;
        let disposal;
        let idleTimer;
        let deadlineTimer;
        const fetchController = new AbortController();
        const assistantInfos = new Map();
        const prompt = renderAttemptContext(request.context);
        const maximumResponseBytes = Math.max(request.maximumLineBytes, request.maximumOutputBytes, Buffer.byteLength(prompt) + request.maximumLineBytes);
        const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
        const appendStderr = (text) => {
            const bounded = boundUtf8(`${stderr.value}${text}`, request.maximumOutputBytes);
            stderr.value = bounded.value;
            stderr.truncated ||= bounded.truncated;
        };
        const finishStderr = () => {
            if (!stderr.finished) {
                stderr.finished = true;
                appendStderr(stderrRedactor.end());
            }
        };
        const resetIdleTimer = () => {
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(() => {
                failUnknown("OpenCode server exceeded the harness idle timeout without an exact terminal response");
            }, request.idleTimeoutMs);
            idleTimer.unref();
        };
        const dispose = () => {
            disposal ??= (async () => {
                if (idleTimer !== undefined) {
                    clearTimeout(idleTimer);
                }
                if (deadlineTimer !== undefined) {
                    clearTimeout(deadlineTimer);
                }
                fetchController.abort();
                if (child !== undefined) {
                    child.stdin.destroy();
                    child.stdout.destroy();
                    child.stderr.destroy();
                    try {
                        await terminateDirectChild(child, "OpenCode server");
                    }
                    finally {
                        child.unref();
                    }
                }
            })();
            return disposal;
        };
        const failUnknown = (message, cause) => {
            if (terminalAccepted) {
                return;
            }
            terminalAccepted = true;
            const error = new AutopilotError("EXECUTION_STATE_UNKNOWN", message, {
                ...(cause === undefined ? {} : { cause: errorMessage(cause) }),
            });
            executionUnknown = error;
            terminal.reject(error);
            serverConnected.reject(error);
            startupUrl.reject(error);
            void dispose().catch(() => undefined);
        };
        const assertAdmissionContinuity = () => {
            if (executionUnknown !== undefined) {
                throw executionUnknown;
            }
        };
        const resolveTerminal = (observation) => {
            if (terminalAccepted) {
                return;
            }
            terminalAccepted = true;
            finishStderr();
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
            }
            if (deadlineTimer !== undefined) {
                clearTimeout(deadlineTimer);
            }
            terminal.resolve(observation);
        };
        const reconcile = async () => {
            if (terminalAccepted || reconciling || !seenBusy || client === undefined || sessionId === undefined) {
                return;
            }
            reconciling = true;
            try {
                const session = requiredRecord(await client.json(`/session/${sessionId}`), "OpenCode session response");
                if (session.id !== sessionId || session.version !== harnessVersion) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server changed the exact session identity");
                }
                const [expectedDirectory, observedDirectory] = await Promise.all([
                    realpath(request.worktreePath),
                    realpath(requiredString(session.directory, "OpenCode session directory")),
                ]);
                if (expectedDirectory !== observedDirectory) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server changed the exact session directory");
                }
                const user = requiredRecord(await client.json(`/session/${sessionId}/message/${messageId}`), "OpenCode user message");
                const userInfo = requiredRecord(user.info, "OpenCode user message info");
                const userParts = Array.isArray(user.parts) ? user.parts : [];
                if (userInfo.id !== messageId || userInfo.sessionID !== sessionId || userInfo.role !== "user"
                    || userParts.length !== 1 || !isRecord(userParts[0]) || userParts[0].type !== "text"
                    || userParts[0].text !== prompt) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server changed the admitted user message identity or content");
                }
                const candidates = [...assistantInfos.values()].filter((info) => isTerminalAssistant(info, messageId));
                if (candidates.length !== 1) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", seenSessionError
                        ? "OpenCode reported a session error without one fresh exact terminal assistant message"
                        : "OpenCode server did not expose one exact terminal assistant message");
                }
                const candidate = candidates[0];
                if (candidate === undefined) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server terminal assistant identity is missing");
                }
                const assistantId = requiredString(candidate.id, "OpenCode assistant message id");
                const assistant = requiredRecord(await client.json(`/session/${sessionId}/message/${assistantId}`), "OpenCode assistant message");
                const assistantInfo = requiredRecord(assistant.info, "OpenCode assistant message info");
                const candidateTime = requiredRecord(candidate.time, "OpenCode event assistant completion time");
                const assistantTime = requiredRecord(assistantInfo.time, "OpenCode fresh assistant completion time");
                if (assistantInfo.id !== assistantId || assistantInfo.sessionID !== sessionId
                    || assistantInfo.parentID !== messageId || !isTerminalAssistant(assistantInfo, messageId)
                    || assistantTime.completed !== candidateTime.completed
                    || canonicalJson(assistantInfo.error) !== canonicalJson(candidate.error)
                    || assistantInfo.finish !== candidate.finish) {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode fresh terminal observation changed exact identity");
                }
                const boundedOutput = boundUtf8(redact(textOutput(assistant), secrets), request.maximumOutputBytes);
                outputTruncated ||= boundedOutput.truncated;
                const status = assistantInfo.error === undefined
                    ? "completed" : isAbortedError(assistantInfo.error) ? "cancelled" : "failed";
                finishStderr();
                const errorText = status === "failed" ? redact(nestedStrings(assistantInfo.error).join(" "), secrets) : "";
                const boundedError = boundUtf8(`${stderr.value}${errorText}`, request.maximumOutputBytes);
                resolveTerminal({
                    protocolVersion: 1,
                    adapterExecutionId,
                    status,
                    exitCode: status === "completed" ? 0 : status === "cancelled" ? 130 : 1,
                    completedAt: new Date().toISOString(),
                    stdout: boundedOutput.value,
                    stderr: boundedError.value,
                    truncated: outputTruncated || stderr.truncated || boundedError.truncated,
                });
            }
            catch (error) {
                failUnknown("OpenCode server terminal reconciliation failed", error);
            }
            finally {
                reconciling = false;
            }
        };
        const rejectInteractiveRequest = async (type, properties) => {
            if (client === undefined || sessionId === undefined || properties.sessionID !== sessionId) {
                return;
            }
            const id = requiredString(properties.id, `OpenCode ${type} request id`);
            if (type === "permission.asked") {
                await client.json(`/session/${sessionId}/permissions/${id}`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ response: "reject" }),
                });
            }
            else {
                await client.json(`/question/${id}/reject`, { method: "POST" });
            }
            failUnknown("OpenCode server requested interactive authority during unattended execution");
        };
        const onEvent = async (value) => {
            const event = requiredRecord(value, "OpenCode server event");
            const type = requiredString(event.type, "OpenCode server event type");
            const properties = requiredRecord(event.properties, "OpenCode server event properties");
            if (type === "server.connected") {
                serverConnected.resolve();
                return;
            }
            if (type === "server.instance.disposed") {
                failUnknown("OpenCode server disposed the admitted worktree instance before terminal state");
                return;
            }
            if (type === "permission.asked" || type === "question.asked") {
                await rejectInteractiveRequest(type, properties);
                return;
            }
            if (sessionId === undefined || properties.sessionID !== sessionId) {
                return;
            }
            resetIdleTimer();
            if (type === "message.updated") {
                const info = requiredRecord(properties.info, "OpenCode message.updated info");
                if (info.role === "assistant" && info.parentID === messageId) {
                    assistantInfos.set(requiredString(info.id, "OpenCode assistant message id"), info);
                }
                return;
            }
            if (type === "session.error") {
                seenSessionError = true;
                return;
            }
            if (type === "session.status") {
                const status = requiredRecord(properties.status, "OpenCode session status");
                if (status.type === "busy") {
                    seenBusy = true;
                    return;
                }
                if (status.type === "idle" && seenBusy) {
                    await reconcile();
                }
            }
        };
        try {
            child = spawn(this.#options.executable, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"], {
                cwd: request.worktreePath,
                env: {
                    ...adapterEnvironment(request),
                    OPENCODE_DISABLE_AUTOUPDATE: "1",
                    OPENCODE_SERVER_USERNAME: "autopilot",
                    OPENCODE_SERVER_PASSWORD: password,
                },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
            const stdoutDecoder = new StringDecoder("utf8");
            let stdoutBuffer = "";
            child.stdout.on("data", (chunk) => {
                stdoutBuffer += stdoutDecoder.write(chunk);
                let newline = stdoutBuffer.indexOf("\n");
                while (newline >= 0) {
                    const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
                    stdoutBuffer = stdoutBuffer.slice(newline + 1);
                    if (Buffer.byteLength(line) > request.maximumLineBytes) {
                        failUnknown("OpenCode server startup output exceeded the configured line bound");
                        return;
                    }
                    const match = line.match(/opencode server listening on (http:\/\/[^\s]+)/);
                    if (match?.[1] !== undefined) {
                        const parsed = new URL(match[1]);
                        if (parsed.hostname !== "127.0.0.1") {
                            failUnknown("OpenCode server selected a non-loopback endpoint");
                            return;
                        }
                        if (startupOrigin !== undefined && startupOrigin !== parsed.origin) {
                            failUnknown("OpenCode server reported conflicting loopback endpoints");
                            return;
                        }
                        startupOrigin = parsed.origin;
                        startupUrl.resolve(parsed.origin);
                    }
                    newline = stdoutBuffer.indexOf("\n");
                }
                if (Buffer.byteLength(stdoutBuffer) > request.maximumLineBytes) {
                    failUnknown("OpenCode server startup output exceeded the configured line bound");
                }
            });
            child.stdout.on("error", (error) => failUnknown("OpenCode server stdout failed", error));
            child.stderr.on("data", (chunk) => appendStderr(stderrRedactor.write(chunk)));
            child.stderr.on("error", (error) => failUnknown("OpenCode server stderr failed", error));
            child.stdin.on("error", (error) => failUnknown("OpenCode server stdin failed", error));
            child.on("error", (error) => failUnknown("OpenCode server process failed", error));
            child.on("close", (code, signal) => {
                if (!terminalAccepted) {
                    failUnknown("OpenCode server exited before exact terminal state", { code, signal });
                }
            });
            resetIdleTimer();
            deadlineTimer = setTimeout(() => {
                if (client !== undefined && sessionId !== undefined) {
                    void client.json(`/session/${sessionId}/abort`, { method: "POST" }).catch(() => undefined);
                }
                failUnknown("OpenCode server did not return exact terminal state before the attempt deadline");
            }, timeoutMs);
            deadlineTimer.unref();
            const baseUrl = await startupUrl.promise;
            client = createHttpClient({
                baseUrl,
                password,
                worktreePath: await realpath(request.worktreePath),
                maximumBytes: maximumResponseBytes,
                redactionValues: secrets,
                signal: fetchController.signal,
            });
            const health = requiredRecord(await client.json("/global/health"), "OpenCode health response");
            if (health.healthy !== true || health.version !== harnessVersion) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server health changed the expected version");
            }
            await validatePath(await client.json("/path"), request.worktreePath);
            const eventResponse = await client.eventResponse();
            void consumeEvents({ response: eventResponse, maximumLineBytes: request.maximumLineBytes, onEvent })
                .catch((error) => failUnknown("OpenCode server event continuity was lost", error));
            await serverConnected.promise;
            resetIdleTimer();
            const session = requiredRecord(await client.json("/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    title: `Autopilot ${request.runId}/${request.itemId}/${request.attemptId}`,
                    permission: [
                        { permission: "*", pattern: "*", action: "allow" },
                        { permission: "question", pattern: "*", action: "deny" },
                        { permission: "external_directory", pattern: "*", action: "deny" },
                    ],
                }),
            }), "OpenCode session creation response");
            sessionId = requiredString(session.id, "OpenCode session id");
            if (session.version !== harnessVersion) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode session version changed during admission");
            }
            const [expectedDirectory, admittedDirectory] = await Promise.all([
                realpath(request.worktreePath),
                realpath(requiredString(session.directory, "OpenCode admitted session directory")),
            ]);
            if (expectedDirectory !== admittedDirectory) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode admitted a session in another directory");
            }
            resetIdleTimer();
            await client.json(`/session/${sessionId}/prompt_async`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    messageID: messageId,
                    parts: [{ type: "text", text: prompt }],
                }),
            });
            assertAdmissionContinuity();
            resetIdleTimer();
            const subject = {
                schemaVersion: 1,
                backendId: `opencode-server@${harnessVersion}`,
                subjectId: sha256(canonicalJson({ harnessInstanceId, sessionId, messageId })),
                harnessInstanceId,
            };
            this.#pending.set(adapterExecutionId, {
                harnessInstanceId,
                subject,
                terminal: terminal.promise,
                isTerminalAccepted: () => terminalAccepted,
                abort: async () => {
                    if (client === undefined) {
                        return false;
                    }
                    const result = await client.json(`/session/${sessionId}/abort`, { method: "POST" });
                    return result === true;
                },
                dispose,
            });
            return { protocolVersion: 1, adapterExecutionId, startedAt, subject };
        }
        catch (error) {
            failUnknown("OpenCode server admission did not return an exact session and message identity", error);
            await dispose().catch(() => undefined);
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode server admission did not return an exact session and message identity", { cause: errorMessage(error) });
        }
    }
    async observe(handle) {
        if (this.#reviewHandles.delete(handle.adapterExecutionId)) {
            return await this.#options.reviewAdapter.observe(handle);
        }
        const pending = this.#pending.get(handle.adapterExecutionId);
        if (pending === undefined || handle.subject?.backendId !== pending.subject.backendId
            || handle.subject.subjectId !== pending.subject.subjectId
            || handle.subject.harnessInstanceId !== pending.harnessInstanceId) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "OpenCode execution is not attached to the exact server instance");
        }
        try {
            return await pending.terminal;
        }
        finally {
            try {
                await pending.dispose();
            }
            finally {
                this.#pending.delete(handle.adapterExecutionId);
            }
        }
    }
    async cancel(handle) {
        if (this.#reviewHandles.has(handle.adapterExecutionId)) {
            return await this.#options.reviewAdapter.cancel(handle);
        }
        const pending = this.#pending.get(handle.adapterExecutionId);
        if (pending === undefined || pending.isTerminalAccepted()
            || handle.subject?.backendId !== pending.subject.backendId
            || handle.subject.subjectId !== pending.subject.subjectId
            || handle.subject.harnessInstanceId !== pending.harnessInstanceId) {
            return { protocolVersion: 1, accepted: false };
        }
        const abort = pending.abort().then(() => ({ kind: "response" }));
        const terminal = pending.terminal.then((observation) => ({ kind: "terminal", observation }));
        const first = await Promise.race([abort, terminal]);
        const observation = first.kind === "terminal" ? first.observation : await pending.terminal;
        return { protocolVersion: 1, accepted: observation.status === "cancelled" };
    }
}
