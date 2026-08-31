import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { executionAssuranceFor, } from "../../src/adapter-protocol.js";
import { adapterCredentialNames, adapterEnvironment, redactSecrets, redactionValues, } from "../../src/adapter-process.js";
import { renderAttemptContext } from "../../src/attempt-context.js";
import { AutopilotError } from "../../src/errors.js";
import { canonicalJson, isRecord, sha256 } from "../../src/json.js";
import { boundUtf8, runProcess, StreamingRedactor } from "../../src/process.js";
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
async function threadIdentity(value, worktreePath) {
    const response = requiredRecord(value, "Codex thread/start response");
    const thread = requiredRecord(response.thread, "Codex thread/start response.thread");
    const threadId = requiredString(thread.id, "Codex thread id");
    if (thread.ephemeral !== true) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server did not admit an ephemeral thread");
    }
    const cwd = requiredString(response.cwd, "Codex thread cwd");
    const [admittedCwd, expectedCwd] = await Promise.all([realpath(cwd), realpath(worktreePath)]);
    if (admittedCwd !== expectedCwd) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server admitted a different working directory");
    }
    if (response.approvalPolicy !== "never") {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server changed the unattended approval policy");
    }
    const sandbox = requiredRecord(response.sandbox, "Codex thread sandbox");
    if (sandbox.type !== "workspaceWrite") {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server changed the implementation sandbox");
    }
    return threadId;
}
function turnIdentity(value) {
    const response = requiredRecord(value, "Codex turn/start response");
    const turn = requiredRecord(response.turn, "Codex turn/start response.turn");
    return requiredString(turn.id, "Codex turn id");
}
function turnFromNotification(value) {
    const params = requiredRecord(value, "Codex turn/completed notification");
    const turn = requiredRecord(params.turn, "Codex turn/completed notification.turn");
    const items = Array.isArray(turn.items) ? turn.items : [];
    const agentOutput = items.flatMap((item) => isRecord(item) && item.type === "agentMessage" && typeof item.text === "string" ? [item.text] : []);
    const turnError = isRecord(turn.error) && typeof turn.error.message === "string" ? turn.error.message : undefined;
    return {
        threadId: requiredString(params.threadId, "Codex terminal thread id"),
        turnId: requiredString(turn.id, "Codex terminal turn id"),
        status: requiredString(turn.status, "Codex terminal turn status"),
        ...(turnError === undefined ? {} : { error: turnError }),
        agentOutput,
    };
}
async function waitForChildClose(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return true;
    }
    return await new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
            child.off("close", onClose);
            resolvePromise(false);
        }, timeoutMs);
        timer.unref();
        const onClose = () => {
            clearTimeout(timer);
            resolvePromise(true);
        };
        child.once("close", onClose);
    });
}
async function terminateAppServer(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    child.kill();
    if (await waitForChildClose(child, 5_000)) {
        return;
    }
    child.kill("SIGKILL");
    if (!await waitForChildClose(child, 5_000)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server process did not terminate after forced cleanup");
    }
}
class AppServerConnection {
    #child;
    #maximumLineBytes;
    #pendingRequests = new Map();
    #onNotification;
    #onFailure;
    #buffer = Buffer.alloc(0);
    #nextRequestId = 1;
    #closed = false;
    #termination;
    constructor(options) {
        this.#child = options.child;
        this.#maximumLineBytes = options.maximumLineBytes;
        this.#onNotification = options.onNotification;
        this.#onFailure = options.onFailure;
        this.#child.stdin.on("error", this.#onStdinError);
        this.#child.stdout.on("data", this.#onData);
        this.#child.stdout.on("end", this.#onEnd);
        this.#child.stdout.on("error", this.#onStdoutError);
        this.#child.stderr.on("error", this.#onStderrError);
        this.#child.on("error", this.#onProcessError);
        this.#child.on("close", this.#onProcessClose);
    }
    async request(method, params) {
        if (this.#closed) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server connection is no longer authoritative");
        }
        const id = this.#nextRequestId;
        this.#nextRequestId += 1;
        const pending = deferred();
        this.#pendingRequests.set(id, { resolve: pending.resolve, reject: pending.reject });
        try {
            this.#write({ method, id, params });
        }
        catch (error) {
            this.#pendingRequests.delete(id);
            throw error;
        }
        return await pending.promise;
    }
    notify(method) {
        this.#write({ method });
    }
    async close() {
        if (!this.#closed) {
            this.#closed = true;
            this.#rejectPending(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server connection closed"));
        }
        await this.#cleanup();
    }
    #write(message) {
        if (this.#closed || !this.#child.stdin.writable) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server request channel is unavailable");
        }
        this.#child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    #onData = (chunk) => {
        if (this.#closed) {
            return;
        }
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        let newline = this.#buffer.indexOf(0x0a);
        while (newline >= 0) {
            const line = this.#buffer.subarray(0, newline);
            this.#buffer = this.#buffer.subarray(newline + 1);
            if (line.byteLength > this.#maximumLineBytes) {
                this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server event exceeded the configured line bound"));
                return;
            }
            if (line.byteLength > 0) {
                this.#acceptLine(line);
                if (this.#closed) {
                    return;
                }
            }
            newline = this.#buffer.indexOf(0x0a);
        }
        if (this.#buffer.byteLength > this.#maximumLineBytes) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server event exceeded the configured line bound"));
        }
    };
    #onEnd = () => {
        if (!this.#closed && this.#buffer.byteLength > 0) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server ended with an incomplete event"));
        }
    };
    #onStdinError = (error) => {
        this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server request channel failed", {
            cause: error.message,
        }));
    };
    #onStdoutError = (error) => {
        this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server event channel failed", {
            cause: error.message,
        }));
    };
    #onStderrError = (error) => {
        this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server diagnostic channel failed", {
            cause: error.message,
        }));
    };
    #onProcessError = (error) => {
        this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server process failed", { cause: error.message }));
    };
    #onProcessClose = (code, signal) => {
        if (!this.#closed) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server exited before the exact turn reached terminal state", { code, signal }));
        }
    };
    #acceptLine(line) {
        let value;
        try {
            value = JSON.parse(line.toString("utf8"));
        }
        catch (error) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server emitted malformed JSON", {
                cause: errorMessage(error),
            }));
            return;
        }
        if (!isRecord(value)) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server emitted a malformed message"));
            return;
        }
        if (typeof value.method === "string" && value.id !== undefined) {
            try {
                this.#write({
                    id: value.id,
                    error: { code: -32601, message: "Autopilot unattended execution rejects server requests" },
                });
            }
            catch (error) {
                this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex server-request rejection failed", {
                    cause: errorMessage(error),
                }));
            }
            return;
        }
        if (typeof value.method === "string") {
            try {
                this.#onNotification(value.method, value.params);
            }
            catch (error) {
                this.#fail(error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }
        if (typeof value.id !== "number" || !Number.isSafeInteger(value.id)) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server response identity is malformed"));
            return;
        }
        const pending = this.#pendingRequests.get(value.id);
        if (pending === undefined) {
            this.#fail(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server returned an unknown response identity"));
            return;
        }
        this.#pendingRequests.delete(value.id);
        if (value.error !== undefined) {
            const rpcError = isRecord(value.error) && typeof value.error.message === "string"
                ? value.error.message : "Codex app-server request failed";
            pending.reject(new AutopilotError("EXECUTION_STATE_UNKNOWN", rpcError));
            return;
        }
        if (!("result" in value)) {
            pending.reject(new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server response has no result"));
            return;
        }
        pending.resolve(value.result);
    }
    #fail(error) {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.#rejectPending(error);
        this.#onFailure(error);
        void this.#cleanup().catch(() => undefined);
    }
    async #cleanup() {
        this.#termination ??= (async () => {
            this.#removeListeners();
            this.#child.stdin.destroy();
            this.#child.stdout.destroy();
            this.#child.stderr.destroy();
            try {
                await terminateAppServer(this.#child);
            }
            finally {
                this.#child.stdin.off("error", this.#onStdinError);
                this.#child.stdout.off("error", this.#onStdoutError);
                this.#child.stderr.off("error", this.#onStderrError);
                this.#child.unref();
            }
        })();
        await this.#termination;
    }
    #rejectPending(error) {
        this.#pendingRequests.forEach(({ reject }) => reject(error));
        this.#pendingRequests.clear();
    }
    #removeListeners() {
        this.#child.stdout.off("data", this.#onData);
        this.#child.stdout.off("end", this.#onEnd);
        this.#child.off("error", this.#onProcessError);
        this.#child.off("close", this.#onProcessClose);
    }
}
export class CodexAppServerAdapter {
    #options;
    #pending = new Map();
    #reviewHandles = new Set();
    #harnessVersion;
    constructor(options) {
        this.#options = options;
    }
    async describe() {
        const directManifest = await this.#options.reviewAdapter.describe();
        const appServer = await runProcess({
            executable: this.#options.executable,
            arguments: ["app-server", "--help"],
            cwd: process.cwd(),
            timeoutMs: 10_000,
            maxOutputBytes: 65_536,
        });
        if (appServer.exitCode !== 0) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "Codex app-server is unavailable");
        }
        this.#harnessVersion = directManifest.harnessVersion;
        return {
            protocolVersion: 1,
            adapterName: "codex-app-server",
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
                "Codex app-server implementation completion requires an exact thread and turn terminal notification on the uninterrupted stdio connection.",
                "Coordinator, connection, or app-server loss is execution-state-unknown and cannot launch a replacement turn.",
                "Logical turn completion does not prove operating-system process-tree quiescence or rollback external effects.",
                "The app-server process starts in the attempt worktree and thread/start omits cwd to avoid Codex persisting project trust.",
                "Independent review uses the direct Codex CLI adapter and remains session-scoped.",
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
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "Codex app-server capabilities must be loaded before launch");
        }
        const harnessVersion = this.#harnessVersion;
        const adapterExecutionId = randomUUID();
        const harnessInstanceId = randomUUID();
        const startedAt = new Date().toISOString();
        const credentials = adapterCredentialNames(request);
        const stderrRedactor = new StreamingRedactor(redactionValues(credentials));
        const stderr = { value: "", truncated: false, finished: false };
        let threadId;
        let turnId;
        let provisionalTurnId;
        let earlyTerminal;
        let output = "";
        let outputTruncated = false;
        let terminalAccepted = false;
        let failure;
        let disposal;
        const terminal = deferred();
        void terminal.promise.catch(() => undefined);
        const timeoutMs = Math.max(1, Date.parse(request.deadline) - Date.now());
        let idleTimer;
        let deadlineTimer;
        let connection;
        const appendOutput = (text) => {
            const combined = output.length === 0 ? text : `${output}\n${text}`;
            const bounded = boundUtf8(redactSecrets(combined, credentials), request.maximumOutputBytes);
            output = bounded.value;
            outputTruncated ||= bounded.truncated;
        };
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
                failUnknown("Codex app-server exceeded the harness idle timeout without an exact terminal response");
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
                await connection?.close();
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
            failure = error;
            terminal.reject(error);
            void dispose().catch(() => undefined);
        };
        const observeTurnId = (value) => {
            if (!isRecord(value) || typeof value.threadId !== "string" || value.threadId !== threadId) {
                return undefined;
            }
            const notificationTurn = typeof value.turnId === "string"
                ? value.turnId
                : isRecord(value.turn) && typeof value.turn.id === "string" ? value.turn.id : undefined;
            if (notificationTurn === undefined) {
                return undefined;
            }
            if (turnId !== undefined) {
                return notificationTurn === turnId ? notificationTurn : undefined;
            }
            if (provisionalTurnId !== undefined && provisionalTurnId !== notificationTurn) {
                failUnknown("Codex app-server emitted conflicting pre-admission turn identities");
                return undefined;
            }
            provisionalTurnId = notificationTurn;
            return notificationTurn;
        };
        const acceptTerminal = (params) => {
            if (terminalAccepted) {
                return;
            }
            const completed = turnFromNotification(params);
            if (completed.threadId !== threadId || completed.turnId !== turnId) {
                return;
            }
            if (!["completed", "interrupted", "failed"].includes(completed.status)) {
                failUnknown("Codex app-server emitted a nonterminal turn/completed status");
                return;
            }
            if (completed.agentOutput.length > 0) {
                output = "";
                completed.agentOutput.forEach(appendOutput);
            }
            finishStderr();
            terminalAccepted = true;
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
            }
            if (deadlineTimer !== undefined) {
                clearTimeout(deadlineTimer);
            }
            const status = completed.status === "completed"
                ? "completed" : completed.status === "interrupted" ? "cancelled" : "failed";
            const stderrOutput = boundUtf8(completed.error === undefined
                ? stderr.value
                : `${stderr.value}${redactSecrets(completed.error, credentials)}`, request.maximumOutputBytes);
            terminal.resolve({
                protocolVersion: 1,
                adapterExecutionId,
                status,
                exitCode: status === "completed" ? 0 : status === "cancelled" ? 130 : 1,
                completedAt: new Date().toISOString(),
                stdout: output,
                stderr: stderrOutput.value,
                truncated: outputTruncated || stderr.truncated || stderrOutput.truncated,
            });
        };
        const onNotification = (method, params) => {
            const exactTurn = observeTurnId(params);
            if (exactTurn === undefined) {
                return;
            }
            resetIdleTimer();
            if (method === "item/completed" && isRecord(params)) {
                const item = params.item;
                if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") {
                    appendOutput(item.text);
                }
            }
            if (method === "error" && isRecord(params) && isRecord(params.error)
                && typeof params.error.message === "string") {
                appendStderr(redactSecrets(params.error.message, credentials));
            }
            if (method === "turn/completed") {
                if (turnId === undefined) {
                    if (earlyTerminal !== undefined) {
                        failUnknown("Codex app-server emitted duplicate terminal state before exact admission");
                        return;
                    }
                    earlyTerminal = params;
                }
                else {
                    acceptTerminal(params);
                }
            }
        };
        try {
            const child = spawn(this.#options.executable, ["app-server", "--listen", "stdio://"], {
                cwd: request.worktreePath,
                env: { ...adapterEnvironment(request) },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
            child.stderr.on("data", (chunk) => appendStderr(stderrRedactor.write(chunk)));
            connection = new AppServerConnection({
                child,
                maximumLineBytes: request.maximumLineBytes,
                onNotification,
                onFailure: (error) => failUnknown("Codex app-server continuity was lost", error),
            });
            resetIdleTimer();
            deadlineTimer = setTimeout(() => {
                if (threadId !== undefined && turnId !== undefined) {
                    void connection?.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
                }
                failUnknown("Codex app-server did not return an exact terminal response before the attempt deadline");
            }, timeoutMs);
            deadlineTimer.unref();
            await connection.request("initialize", {
                clientInfo: { name: "coding_harness_autopilot", title: "Coding Harness Autopilot", version: "0.1.0" },
                capabilities: null,
            });
            connection.notify("initialized");
            resetIdleTimer();
            // An explicit writable cwd makes Codex persist project trust. The child already runs in the exact worktree.
            const thread = await connection.request("thread/start", {
                approvalPolicy: "never",
                sandbox: "workspace-write",
                ephemeral: true,
                serviceName: "coding-harness-autopilot",
            });
            threadId = await threadIdentity(thread, request.worktreePath);
            resetIdleTimer();
            const turn = await connection.request("turn/start", {
                threadId,
                input: [{ type: "text", text: renderAttemptContext(request.context), textElements: [] }],
            });
            if (failure !== undefined) {
                throw failure;
            }
            turnId = turnIdentity(turn);
            if (provisionalTurnId !== undefined && provisionalTurnId !== turnId) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex turn/start response changed the observed turn identity");
            }
            resetIdleTimer();
            if (earlyTerminal !== undefined) {
                acceptTerminal(earlyTerminal);
            }
            const subject = {
                schemaVersion: 1,
                backendId: `codex-app-server-v2@${harnessVersion}`,
                subjectId: sha256(canonicalJson({ harnessInstanceId, threadId, turnId })),
                harnessInstanceId,
            };
            const pending = {
                request,
                connection,
                harnessInstanceId,
                threadId,
                turnId,
                subject,
                terminal: terminal.promise,
                isTerminalAccepted: () => terminalAccepted,
                dispose,
            };
            this.#pending.set(adapterExecutionId, pending);
            return { protocolVersion: 1, adapterExecutionId, startedAt, subject };
        }
        catch (error) {
            failUnknown("Codex app-server admission did not return an exact thread and turn identity", error);
            await dispose().catch(() => undefined);
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex app-server admission did not return an exact thread and turn identity", { cause: errorMessage(error) });
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
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Codex turn is not attached to the exact app-server instance");
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
        const interrupt = pending.connection.request("turn/interrupt", {
            threadId: pending.threadId,
            turnId: pending.turnId,
        }).then(() => ({ kind: "response" }));
        const terminal = pending.terminal.then((observation) => ({ kind: "terminal", observation }));
        const first = await Promise.race([interrupt, terminal]);
        const observation = first.kind === "terminal" ? first.observation : await pending.terminal;
        return { protocolVersion: 1, accepted: observation.status === "cancelled" };
    }
}
