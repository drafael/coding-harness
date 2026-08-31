import { appendFileSync, closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutopilotError } from "./errors.js";
import { expectRecord, expectString } from "./json.js";
import { writeJsonAtomic } from "./journal.js";
import { readSupervisedRequest, supervisorArtifactNames, supervisorRequestHash, } from "./process-supervisor.js";
import { boundUtf8, runProcess } from "./process.js";
import { launchWindowsJob, queryWindowsJob, resolveWindowsCommand, windowsBrokerIdentity, } from "./windows-job.js";
function redactionValues(environment, credentialEnvironmentNames) {
    const credentialNames = new Set(credentialEnvironmentNames);
    return Object.entries(environment).flatMap(([name, value]) => {
        const explicitlyGranted = credentialNames.has(name);
        return value === undefined || value.length === 0
            || (!explicitlyGranted && (value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)))
            ? []
            : [value];
    });
}
function redactSecrets(text, environment, credentialEnvironmentNames) {
    const credentialNames = new Set(credentialEnvironmentNames);
    return Object.entries(environment).reduce((current, [name, value]) => {
        const explicitlyGranted = credentialNames.has(name);
        if (value === undefined || value.length === 0
            || (!explicitlyGranted && (value.length < 4 || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name)))) {
            return current;
        }
        return current.replaceAll(value, "****");
    }, text);
}
function writeChildIdentity(directory, value) {
    const path = join(directory, supervisorArtifactNames.child);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const descriptor = openSync(temporaryPath, "wx", 0o600);
    try {
        writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        fsyncSync(descriptor);
    }
    finally {
        closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
    if (process.platform !== "win32") {
        const directoryDescriptor = openSync(directory, "r");
        try {
            fsyncSync(directoryDescriptor);
        }
        finally {
            closeSync(directoryDescriptor);
        }
    }
}
async function waitForWatchdogReady(directory, requestHash) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            const object = expectRecord(JSON.parse(await readFile(join(directory, supervisorArtifactNames.watchdogReady), "utf8")), "supervisor watchdog readiness");
            if (expectString(object.requestHash, "supervisor watchdog readiness.requestHash") === requestHash) {
                return;
            }
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "attempt watchdog did not confirm readiness before harness launch");
}
async function waitForWindowsJobReady(identity) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const observation = await queryWindowsJob(identity);
        if (observation.state === "ready") {
            return;
        }
        if (observation.state === "empty") {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object became empty before launch readiness");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object did not confirm assignment-before-resume readiness");
}
async function main() {
    const directory = process.argv[2];
    if (directory === undefined) {
        process.exitCode = 2;
        return;
    }
    const request = await readSupervisedRequest(directory);
    if (request === undefined) {
        process.exitCode = 2;
        return;
    }
    const requestHash = supervisorRequestHash(request);
    const startedAt = new Date().toISOString();
    const baseStatus = {
        schemaVersion: 1,
        executionId: request.executionId,
        requestHash,
        supervisorPid: process.pid,
        startedAt,
    };
    const publishStatus = async (state, terminal) => {
        await writeJsonAtomic(join(directory, supervisorArtifactNames.status), {
            ...baseStatus,
            state,
            updatedAt: new Date().toISOString(),
            ...(terminal === undefined ? {} : terminal),
        });
    };
    await publishStatus("starting");
    const environment = Object.fromEntries(request.environmentNames.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
    }));
    const watchdog = fileURLToPath(new URL("./supervisor-watchdog.js", import.meta.url));
    const watchdogProcess = spawn(process.execPath, [watchdog, directory], {
        detached: true,
        stdio: "ignore",
        env: { ...environment },
        windowsHide: true,
    });
    watchdogProcess.unref();
    await waitForWatchdogReady(directory, requestHash);
    let activityBytes = 0;
    let lastActivityPulse = 0;
    const recordActivity = (force = false) => {
        const now = Date.now();
        const pulseInterval = Math.max(1, Math.min(100, Math.floor(request.idleTimeoutMs / 2)));
        if (force || now - lastActivityPulse >= pulseInterval) {
            const pulsePath = join(directory, supervisorArtifactNames.activityPulse);
            const temporaryPulsePath = `${pulsePath}.${process.pid}.tmp`;
            writeFileSync(temporaryPulsePath, `${now}\n`, { mode: 0o600 });
            renameSync(temporaryPulsePath, pulsePath);
            lastActivityPulse = now;
        }
    };
    recordActivity(true);
    const onStderrLine = request.displayStderrActivity ? (line) => {
        const remaining = request.maximumOutputBytes - activityBytes;
        if (remaining <= 0) {
            return;
        }
        const value = Buffer.from(`${redactSecrets(line, environment, request.credentialEnvironmentNames)}\n`);
        const bounded = value.subarray(0, remaining);
        appendFileSync(join(directory, supervisorArtifactNames.activity), bounded, { mode: 0o600 });
        activityBytes += bounded.length;
    } : undefined;
    const sensitiveValues = redactionValues(environment, request.credentialEnvironmentNames);
    let result;
    let state;
    try {
        if (process.platform === "win32") {
            const identity = await windowsBrokerIdentity(request.executionId, requestHash);
            if (request.windowsHelperSha256 === undefined || identity.helperSha256 !== request.windowsHelperSha256) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object helper identity changed before launch");
            }
            const command = await resolveWindowsCommand(request.executable, request.arguments, request.cwd, environment);
            let resolveHelperPid = () => undefined;
            const helperPid = new Promise((resolve) => {
                resolveHelperPid = resolve;
            });
            const launch = launchWindowsJob(identity, {
                executable: command.executable,
                arguments: command.arguments,
                cwd: request.cwd,
                environment,
            }, {
                maximumOutputBytes: request.maximumOutputBytes,
                redactValues: sensitiveValues,
                onActivity: recordActivity,
                ...(onStderrLine === undefined ? {} : { onStderrLine }),
                onSpawn: resolveHelperPid,
            });
            void launch.catch(() => undefined);
            const launchedHelperPid = await Promise.race([
                helperPid,
                launch.then(() => {
                    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object helper exited before publishing its process identity");
                }),
            ]);
            await waitForWindowsJobReady(identity);
            writeChildIdentity(directory, {
                ...identity,
                helperPid: launchedHelperPid,
                supervisorPid: process.pid,
                startedAt: new Date().toISOString(),
            });
            await publishStatus("running");
            result = await launch;
        }
        else {
            await publishStatus("running");
            result = await runProcess({
                executable: request.executable,
                arguments: request.arguments,
                cwd: request.cwd,
                environment,
                maxOutputBytes: request.maximumOutputBytes,
                redactValues: sensitiveValues,
                detached: false,
                terminationProcessGroupId: process.pid,
                onActivity: recordActivity,
                onSpawn: (childPid) => {
                    writeChildIdentity(directory, {
                        schemaVersion: 1,
                        executionId: request.executionId,
                        requestHash,
                        childPid,
                        supervisorPid: process.pid,
                        startedAt: new Date().toISOString(),
                    });
                },
                ...(onStderrLine === undefined ? {} : { onStderrLine }),
            });
        }
        state = result.exitCode === 0 ? "completed" : "failed";
    }
    catch (error) {
        state = "state-unknown";
        result = {
            exitCode: 1,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            truncated: false,
        };
    }
    const stdout = boundUtf8(redactSecrets(result.stdout, environment, request.credentialEnvironmentNames), request.maximumOutputBytes);
    const stderr = boundUtf8(redactSecrets(result.stderr, environment, request.credentialEnvironmentNames), request.maximumOutputBytes);
    const redactedResult = {
        ...result,
        stdout: stdout.value,
        stderr: stderr.value,
        truncated: result.truncated || stdout.truncated || stderr.truncated,
    };
    await writeJsonAtomic(join(directory, supervisorArtifactNames.completion), {
        state,
        result: redactedResult,
        completedAt: new Date().toISOString(),
    });
    await new Promise(() => {
        setInterval(() => undefined, 1_000);
    });
}
main().catch(async (error) => {
    const directory = process.argv[2];
    if (directory !== undefined) {
        try {
            await writeJsonAtomic(join(directory, supervisorArtifactNames.status), {
                schemaVersion: 1,
                executionId: "unknown",
                requestHash: "unknown",
                state: "state-unknown",
                supervisorPid: process.pid,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                exitCode: 1,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        catch {
            // The coordinator will fail closed when bootstrap status is absent.
        }
    }
    process.exitCode = 1;
});
