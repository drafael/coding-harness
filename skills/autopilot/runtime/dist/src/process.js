import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { AutopilotError } from "./errors.js";
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
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        const stderrDecoder = new StringDecoder("utf8");
        let stderrLineBuffer = "";
        let truncated = false;
        let timedOut = false;
        let forceTimer;
        const signalProcess = (signal) => {
            if (process.platform === "win32") {
                child.kill(signal);
                return;
            }
            const pid = child.pid;
            if (pid === undefined) {
                child.kill(signal);
                return;
            }
            try {
                process.kill(-pid, signal);
            }
            catch {
                child.kill(signal);
            }
        };
        const terminate = () => {
            if (timedOut) {
                return;
            }
            timedOut = true;
            signalProcess("SIGTERM");
            forceTimer = setTimeout(() => signalProcess("SIGKILL"), 5_000);
            forceTimer.unref();
        };
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
        const appendStdout = (chunk) => {
            resetIdleTimer();
            const next = appendBounded(stdout, chunk, maximum);
            stdout = next.value;
            truncated ||= next.truncated;
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
        const appendStderr = (chunk) => {
            resetIdleTimer();
            emitStderrLines(chunk);
            const next = appendBounded(stderr, chunk, maximum);
            stderr = next.value;
            truncated ||= next.truncated;
        };
        child.stdout.on("data", appendStdout);
        child.stderr.on("data", appendStderr);
        child.once("error", rejectPromise);
        resetIdleTimer();
        const abort = () => terminate();
        request.signal?.addEventListener("abort", abort, { once: true });
        child.once("close", (code, signal) => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            if (idleTimer !== undefined) {
                clearTimeout(idleTimer);
            }
            if (forceTimer !== undefined) {
                clearTimeout(forceTimer);
            }
            request.signal?.removeEventListener("abort", abort);
            if (request.onStderrLine !== undefined) {
                stderrLineBuffer += stderrDecoder.end();
                if (stderrLineBuffer !== "") {
                    request.onStderrLine(stderrLineBuffer.replace(/\r$/u, ""));
                }
            }
            if (timedOut) {
                rejectPromise(new AutopilotError("ADAPTER_TIMEOUT", `${request.executable} exceeded its deadline`, { signal }));
                return;
            }
            resolvePromise({
                exitCode: code ?? 128,
                stdout: stdout.toString("utf8"),
                stderr: stderr.toString("utf8"),
                truncated,
            });
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
