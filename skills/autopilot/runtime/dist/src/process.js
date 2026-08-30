import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { TextDecoder } from "node:util";
import { AutopilotError } from "./errors.js";
async function waitForPosixProcessGroupExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            process.kill(-pid, 0);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ESRCH") {
                return true;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
}
export async function terminateProcessTree(pid, executable) {
    if (process.platform === "win32") {
        await new Promise((resolveTermination, rejectTermination) => {
            const terminator = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
                detached: false,
                stdio: "ignore",
                windowsHide: true,
            });
            const terminatorTimer = setTimeout(() => {
                terminator.kill();
                rejectTermination(new AutopilotError("EXECUTION_STATE_UNKNOWN", `${executable} process-tree termination was not confirmed within five seconds`, { pid }));
            }, 5_000);
            terminator.once("error", (error) => {
                clearTimeout(terminatorTimer);
                rejectTermination(new AutopilotError("EXECUTION_STATE_UNKNOWN", `cannot prove that ${executable} descendants stopped`, { cause: String(error), pid }));
            });
            terminator.once("close", (code) => {
                clearTimeout(terminatorTimer);
                if (code === 0) {
                    resolveTermination();
                }
                else {
                    rejectTermination(new AutopilotError("EXECUTION_STATE_UNKNOWN", `taskkill could not confirm that ${executable} descendants stopped`, { exitCode: code, pid }));
                }
            });
        });
        return;
    }
    try {
        process.kill(-pid, "SIGTERM");
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") {
            return;
        }
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `cannot signal ${executable} process group`, {
            cause: String(error),
            pid,
        });
    }
    if (await waitForPosixProcessGroupExit(pid, 5_000)) {
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `cannot force-stop ${executable} process group`, {
                cause: String(error),
                pid,
            });
        }
    }
    if (!await waitForPosixProcessGroupExit(pid, 5_000)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `cannot prove that ${executable} descendants stopped`, { pid });
    }
}
class StreamingRedactor {
    #decoder = new StringDecoder("utf8");
    #values;
    #pending = "";
    constructor(values) {
        this.#values = [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => right.length - left.length);
    }
    write(chunk) {
        this.#pending += this.#decoder.write(chunk);
        const maximumLength = this.#values.reduce((current, value) => Math.max(current, value.length), 1);
        return this.#consume(Math.max(0, this.#pending.length - maximumLength + 1));
    }
    end() {
        this.#pending += this.#decoder.end();
        return this.#consume(this.#pending.length);
    }
    #consume(minimumSourceCharacters) {
        let consumed = 0;
        let output = "";
        while (consumed < minimumSourceCharacters) {
            const secret = this.#values.find((value) => this.#pending.startsWith(value, consumed));
            if (secret === undefined) {
                output += this.#pending[consumed] ?? "";
                consumed += 1;
            }
            else {
                output += "****";
                consumed += secret.length;
            }
        }
        this.#pending = this.#pending.slice(consumed);
        return output;
    }
}
function decodeUtf8Prefix(bytes, maximumBytes) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let length = Math.min(bytes.length, maximumBytes); length >= 0; length -= 1) {
        try {
            return decoder.decode(bytes.subarray(0, length));
        }
        catch {
            // Try the preceding complete UTF-8 boundary.
        }
    }
    return "";
}
export function boundUtf8(text, maximumBytes) {
    const bytes = Buffer.from(text);
    return bytes.length <= maximumBytes
        ? { value: text, truncated: false }
        : { value: decodeUtf8Prefix(bytes, maximumBytes), truncated: true };
}
function appendBounded(current, chunk, maximum) {
    if (current.length >= maximum) {
        return { value: current, truncated: true };
    }
    const remaining = maximum - current.length;
    return chunk.length > remaining
        ? { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: true }
        : { value: Buffer.concat([current, chunk]), truncated: false };
}
export async function runProcess(request) {
    const maximum = request.maxOutputBytes ?? 4_194_304;
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(request.executable, [...request.arguments], {
            cwd: request.cwd,
            env: request.environment === undefined ? process.env : { ...request.environment },
            detached: request.detached ?? process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        const stdoutRedactor = new StreamingRedactor(request.redactValues ?? []);
        const stderrRedactor = new StreamingRedactor(request.redactValues ?? []);
        const stderrDecoder = new StringDecoder("utf8");
        let stderrLineBuffer = "";
        let truncated = false;
        let timedOut = false;
        let spawnCallbackError;
        let termination;
        const terminate = () => {
            if (timedOut) {
                return;
            }
            timedOut = true;
            const pid = request.terminationProcessGroupId ?? child.pid;
            if (pid === undefined) {
                child.kill("SIGTERM");
                termination = Promise.reject(new AutopilotError("EXECUTION_STATE_UNKNOWN", `cannot prove that ${request.executable} descendants stopped because the process ID is unavailable`));
            }
            else {
                termination = terminateProcessTree(pid, request.executable);
            }
            void termination.catch(rejectPromise);
        };
        if (child.pid !== undefined && request.onSpawn !== undefined) {
            try {
                request.onSpawn(child.pid);
            }
            catch (error) {
                spawnCallbackError = error;
                terminate();
            }
        }
        const timer = request.timeoutMs === undefined ? undefined : setTimeout(terminate, request.timeoutMs);
        timer?.unref();
        let idleTimer;
        const resetIdleTimer = () => {
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
            }
            if (request.idleTimeoutMs !== undefined) {
                idleTimer = setTimeout(terminate, request.idleTimeoutMs);
                idleTimer.unref();
            }
        };
        const appendStdoutText = (text) => {
            const next = appendBounded(stdout, Buffer.from(text), maximum);
            stdout = next.value;
            truncated ||= next.truncated;
        };
        const appendStdout = (chunk) => {
            resetIdleTimer();
            request.onActivity?.();
            appendStdoutText(stdoutRedactor.write(chunk));
        };
        const emitStderrLines = (chunk) => {
            if (request.onStderrLine === undefined) {
                return;
            }
            stderrLineBuffer += stderrDecoder.write(chunk);
            let newlineIndex = stderrLineBuffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = stderrLineBuffer.slice(0, newlineIndex).replace(/\r$/u, "");
                stderrLineBuffer = stderrLineBuffer.slice(newlineIndex + 1);
                request.onStderrLine(line);
                newlineIndex = stderrLineBuffer.indexOf("\n");
            }
        };
        const appendStderrText = (text) => {
            const next = appendBounded(stderr, Buffer.from(text), maximum);
            stderr = next.value;
            truncated ||= next.truncated;
        };
        const appendStderr = (chunk) => {
            resetIdleTimer();
            request.onActivity?.();
            emitStderrLines(chunk);
            appendStderrText(stderrRedactor.write(chunk));
        };
        child.stdout.on("data", appendStdout);
        child.stderr.on("data", appendStderr);
        child.once("error", rejectPromise);
        resetIdleTimer();
        const abort = () => terminate();
        request.signal?.addEventListener("abort", abort, { once: true });
        child.once("close", (code, signal) => {
            void (async () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                }
                if (idleTimer !== undefined) {
                    clearTimeout(idleTimer);
                }
                request.signal?.removeEventListener("abort", abort);
                if (request.onStderrLine !== undefined) {
                    stderrLineBuffer += stderrDecoder.end();
                    if (stderrLineBuffer !== "") {
                        request.onStderrLine(stderrLineBuffer.replace(/\r$/u, ""));
                    }
                }
                appendStdoutText(stdoutRedactor.end());
                appendStderrText(stderrRedactor.end());
                try {
                    await termination;
                }
                catch (error) {
                    rejectPromise(error);
                    return;
                }
                if (spawnCallbackError !== undefined) {
                    rejectPromise(spawnCallbackError);
                    return;
                }
                if (timedOut) {
                    rejectPromise(new AutopilotError("ADAPTER_TIMEOUT", `${request.executable} exceeded its deadline`, { signal }));
                    return;
                }
                resolvePromise({
                    exitCode: code ?? 128,
                    stdout: decodeUtf8Prefix(stdout, maximum),
                    stderr: decodeUtf8Prefix(stderr, maximum),
                    truncated,
                });
            })().catch(rejectPromise);
        });
        if (request.stdin === undefined) {
            child.stdin.end();
        }
        else {
            child.stdin.end(request.stdin);
        }
    });
}
export async function runChecked(request) {
    const result = await runProcess(request);
    if (result.exitCode !== 0) {
        throw new AutopilotError("GIT_FAILED", `${request.executable} exited with ${result.exitCode}`, {
            stderr: result.stderr,
            stdout: result.stdout,
        });
    }
    return result;
}
