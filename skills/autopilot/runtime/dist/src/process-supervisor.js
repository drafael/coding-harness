import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { canonicalJson, expectBoolean, expectInteger, expectRecord, expectString, expectStringArray, sha256 } from "./json.js";
import { writeImmutableJson, writeJsonAtomic } from "./journal.js";
import { queryWindowsJob, verifiedWindowsJobHelperSha256, windowsBrokerIdentity, } from "./windows-job.js";
const REQUEST_FILE = "request.json";
const STATUS_FILE = "status.json";
const RESULT_FILE = "result.json";
const CANCEL_FILE = "cancel.json";
const ACTIVITY_FILE = "stderr-activity.log";
const CHILD_FILE = "child.json";
const WATCHDOG_READY_FILE = "watchdog-ready.json";
const WATCHDOG_ERROR_FILE = "watchdog-error.json";
const ACTIVITY_PULSE_FILE = "activity-pulse";
const COMPLETION_FILE = "completion.json";
const RESULT_TERMINAL_STATES = ["completed", "failed", "cancelled", "timed-out"];
function parseArguments(value) {
    if (!Array.isArray(value) || value.some((argument) => typeof argument !== "string")) {
        throw new AutopilotError("CHARTER_INVALID", "supervisor request.arguments must be an array of strings");
    }
    return value;
}
function parseRequest(value) {
    const object = expectRecord(value, "supervisor request");
    if (object.schemaVersion !== 1) {
        throw new AutopilotError("ADAPTER_MALFORMED", "supervisor request schema is unsupported");
    }
    return {
        schemaVersion: 1,
        executionId: expectString(object.executionId, "supervisor request.executionId"),
        runId: expectString(object.runId, "supervisor request.runId"),
        itemId: expectString(object.itemId, "supervisor request.itemId"),
        attemptId: expectString(object.attemptId, "supervisor request.attemptId"),
        contextHash: expectString(object.contextHash, "supervisor request.contextHash"),
        ...(object.windowsHelperSha256 === undefined
            ? {}
            : { windowsHelperSha256: expectString(object.windowsHelperSha256, "supervisor request.windowsHelperSha256") }),
        executable: expectString(object.executable, "supervisor request.executable"),
        arguments: parseArguments(object.arguments),
        cwd: expectString(object.cwd, "supervisor request.cwd"),
        environmentNames: expectStringArray(object.environmentNames, "supervisor request.environmentNames"),
        credentialEnvironmentNames: expectStringArray(object.credentialEnvironmentNames, "supervisor request.credentialEnvironmentNames"),
        deadline: expectString(object.deadline, "supervisor request.deadline"),
        idleTimeoutMs: expectInteger(object.idleTimeoutMs, "supervisor request.idleTimeoutMs", 1),
        maximumOutputBytes: expectInteger(object.maximumOutputBytes, "supervisor request.maximumOutputBytes", 1),
        displayStderrActivity: expectBoolean(object.displayStderrActivity, "supervisor request.displayStderrActivity"),
    };
}
function parseStatus(value) {
    const object = expectRecord(value, "supervisor status");
    if (object.schemaVersion !== 1) {
        throw new AutopilotError("ADAPTER_MALFORMED", "supervisor status schema is unsupported");
    }
    const state = expectString(object.state, "supervisor status.state");
    if (!["starting", "running", "completed", "failed", "cancelled", "timed-out", "state-unknown"].includes(state)) {
        throw new AutopilotError("ADAPTER_MALFORMED", `unsupported supervisor state: ${state}`);
    }
    return {
        schemaVersion: 1,
        executionId: expectString(object.executionId, "supervisor status.executionId"),
        requestHash: expectString(object.requestHash, "supervisor status.requestHash"),
        state: state,
        supervisorPid: expectInteger(object.supervisorPid, "supervisor status.supervisorPid", 1),
        startedAt: expectString(object.startedAt, "supervisor status.startedAt"),
        updatedAt: expectString(object.updatedAt, "supervisor status.updatedAt"),
        ...(object.completedAt === undefined ? {} : { completedAt: expectString(object.completedAt, "supervisor status.completedAt") }),
        ...(object.exitCode === undefined ? {} : { exitCode: expectInteger(object.exitCode, "supervisor status.exitCode") }),
    };
}
export function supervisedExecutionId(runId, itemId, attemptId, role, contextHash) {
    return sha256(canonicalJson({ runId, itemId, attemptId, role, contextHash }));
}
export function supervisorDirectory(runDirectory, executionId) {
    return join(runDirectory, "executions", executionId);
}
export function supervisorRequestHash(request) {
    return sha256(canonicalJson(request));
}
function supervisorRequestIdentity(request) {
    return canonicalJson({ ...request, environmentNames: [] });
}
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
export async function readSupervisedRequest(directory) {
    const value = await readJson(join(directory, REQUEST_FILE));
    return value === undefined ? undefined : parseRequest(value);
}
export async function readSupervisedStatus(directory) {
    const value = await readJson(join(directory, STATUS_FILE));
    return value === undefined ? undefined : parseStatus(value);
}
async function failIfWatchdogErrored(directory, executionId, requestHash) {
    try {
        const value = await readJson(join(directory, WATCHDOG_ERROR_FILE));
        if (value === undefined) {
            return;
        }
        const object = expectRecord(value, "supervisor watchdog error");
        if (object.schemaVersion !== 1
            || expectString(object.executionId, "supervisor watchdog error.executionId") !== executionId
            || expectString(object.requestHash, "supervisor watchdog error.requestHash") !== requestHash) {
            throw new Error("identity mismatch");
        }
        const failedAt = expectString(object.failedAt, "supervisor watchdog error.failedAt");
        if (!Number.isFinite(Date.parse(failedAt))) {
            throw new Error("timestamp is malformed");
        }
        expectString(object.error, "supervisor watchdog error.error");
    }
    catch {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor watchdog error identity is malformed or changed");
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor watchdog failed before terminal publication");
}
function parseProcessResult(value, label) {
    const object = expectRecord(value, label);
    if (typeof object.stdout !== "string" || typeof object.stderr !== "string") {
        throw new AutopilotError("ADAPTER_MALFORMED", `${label} output is malformed`);
    }
    return {
        exitCode: expectInteger(object.exitCode, `${label}.exitCode`),
        stdout: object.stdout,
        stderr: object.stderr,
        truncated: expectBoolean(object.truncated, `${label}.truncated`),
    };
}
export async function readWindowsBrokerIdentity(directory) {
    const value = await readJson(join(directory, CHILD_FILE));
    if (value === undefined) {
        return undefined;
    }
    const object = expectRecord(value, "Windows Job Object broker identity");
    if (object.schemaVersion !== 1 || typeof object.executionId !== "string" || typeof object.requestHash !== "string"
        || typeof object.brokerName !== "string" || typeof object.brokerToken !== "string"
        || typeof object.helperSha256 !== "string") {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "persisted Windows Job Object broker identity is malformed");
    }
    return {
        schemaVersion: 1,
        executionId: object.executionId,
        requestHash: object.requestHash,
        brokerName: object.brokerName,
        brokerToken: object.brokerToken,
        helperSha256: object.helperSha256,
    };
}
export async function readSupervisedResult(directory) {
    const value = await readJson(join(directory, RESULT_FILE));
    return value === undefined ? undefined : parseProcessResult(value, "supervisor result");
}
async function readValidTerminalResult(directory, status) {
    return RESULT_TERMINAL_STATES.includes(status.state)
        ? await readSupervisedResult(directory)
        : undefined;
}
export async function readSupervisedCompletion(directory) {
    const value = await readJson(join(directory, COMPLETION_FILE));
    if (value === undefined) {
        return undefined;
    }
    const object = expectRecord(value, "supervisor completion");
    const state = expectString(object.state, "supervisor completion.state");
    if (state !== "completed" && state !== "failed" && state !== "state-unknown") {
        throw new AutopilotError("ADAPTER_MALFORMED", "supervisor completion state is malformed");
    }
    const completedAt = Date.parse(expectString(object.completedAt, "supervisor completion.completedAt"));
    if (!Number.isFinite(completedAt)) {
        throw new AutopilotError("ADAPTER_MALFORMED", "supervisor completion timestamp is malformed");
    }
    return { state, result: parseProcessResult(object.result, "supervisor completion.result"), completedAt };
}
async function publishRequest(directory, request) {
    const path = join(directory, REQUEST_FILE);
    try {
        await writeImmutableJson(path, request);
        return true;
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
            throw error;
        }
        const existing = await readSupervisedRequest(directory);
        if (existing === undefined || supervisorRequestIdentity(existing) !== supervisorRequestIdentity(request)) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised execution request identity changed");
        }
        return false;
    }
}
async function validateWindowsHelperIdentity(request) {
    if (process.platform !== "win32") {
        return;
    }
    const helperSha256 = await verifiedWindowsJobHelperSha256();
    if (request.windowsHelperSha256 === undefined || helperSha256 === undefined
        || request.windowsHelperSha256 !== helperSha256) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised Windows execution helper identity is missing or changed");
    }
}
async function waitForStatus(directory, executionId, requestHash, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await readSupervisedStatus(directory);
        if (status !== undefined) {
            if (status.executionId !== executionId || status.requestHash !== requestHash) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status request identity changed");
            }
            if (await readValidTerminalResult(directory, status) !== undefined) {
                return status;
            }
        }
        await failIfWatchdogErrored(directory, executionId, requestHash);
        if (status !== undefined && (process.platform !== "win32" || status.state !== "starting")) {
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor did not publish bootstrap status");
}
export async function launchSupervisedProcess(directory, request, environment) {
    await validateWindowsHelperIdentity(request);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const created = await publishRequest(directory, request);
    const persistedRequest = await readSupervisedRequest(directory);
    if (persistedRequest === undefined) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor request disappeared after publication");
    }
    const requestHash = supervisorRequestHash(persistedRequest);
    const existingStatus = await readSupervisedStatus(directory);
    if (existingStatus !== undefined) {
        if (existingStatus.executionId !== request.executionId || existingStatus.requestHash !== requestHash) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status does not match its immutable request");
        }
        if (await readValidTerminalResult(directory, existingStatus) === undefined) {
            await failIfWatchdogErrored(directory, request.executionId, requestHash);
        }
        return {
            schemaVersion: 1,
            executionId: request.executionId,
            directory,
            requestHash,
            startedAt: existingStatus.startedAt,
        };
    }
    await failIfWatchdogErrored(directory, request.executionId, requestHash);
    if (!created) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor request exists without bootstrap status");
    }
    const helper = fileURLToPath(new URL("./supervisor-child.js", import.meta.url));
    const child = spawn(process.execPath, [helper, directory], {
        detached: true,
        stdio: "ignore",
        env: { ...environment },
        windowsHide: true,
    });
    child.unref();
    const status = await waitForStatus(directory, request.executionId, requestHash, 5_000);
    return {
        schemaVersion: 1,
        executionId: request.executionId,
        directory,
        requestHash,
        startedAt: status.startedAt,
    };
}
export async function reattachSupervisedProcess(directory, request) {
    await validateWindowsHelperIdentity(request);
    const existing = await readSupervisedRequest(directory);
    if (existing === undefined) {
        return undefined;
    }
    if (supervisorRequestIdentity(existing) !== supervisorRequestIdentity(request)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised execution request changed before reattachment");
    }
    const requestHash = supervisorRequestHash(existing);
    const status = await readSupervisedStatus(directory);
    if (status === undefined || status.executionId !== request.executionId || status.requestHash !== requestHash) {
        await failIfWatchdogErrored(directory, request.executionId, requestHash);
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised execution bootstrap is incomplete");
    }
    const terminalResult = await readValidTerminalResult(directory, status);
    if (terminalResult === undefined) {
        await failIfWatchdogErrored(directory, request.executionId, requestHash);
    }
    if (process.platform === "win32" && !["completed", "failed", "cancelled", "timed-out", "state-unknown"].includes(status.state)) {
        const expected = await windowsBrokerIdentity(request.executionId, requestHash);
        const persisted = await readWindowsBrokerIdentity(directory);
        if (persisted !== undefined && canonicalJson(persisted) !== canonicalJson(expected)) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "persisted Windows Job Object broker identity changed before reattachment");
        }
        const reconciliationDeadline = Date.now() + 5_000;
        while (true) {
            const completion = await readSupervisedCompletion(directory);
            if (completion !== undefined) {
                break;
            }
            const observation = await queryWindowsJob(expected);
            if (observation.state === "ready" || observation.state === "starting") {
                break;
            }
            if (Date.now() >= reconciliationDeadline) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object is absent before terminal publication");
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    return { schemaVersion: 1, executionId: request.executionId, directory, requestHash, startedAt: status.startedAt };
}
export async function observeSupervisedProcess(handle, onActivityLine) {
    let activityBytes = 0;
    const deadline = Date.now() + 15_000 + Math.max(1, Date.parse((await readSupervisedRequest(handle.directory))?.deadline ?? "") - Date.now());
    while (Date.now() < deadline) {
        const status = await readSupervisedStatus(handle.directory);
        if (status === undefined || status.executionId !== handle.executionId || status.requestHash !== handle.requestHash) {
            await failIfWatchdogErrored(handle.directory, handle.executionId, handle.requestHash);
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status identity changed during observation");
        }
        const terminalResult = await readValidTerminalResult(handle.directory, status);
        if (terminalResult === undefined) {
            await failIfWatchdogErrored(handle.directory, handle.executionId, handle.requestHash);
        }
        if (onActivityLine !== undefined) {
            try {
                const activity = await readFile(join(handle.directory, ACTIVITY_FILE), "utf8");
                const pending = Buffer.from(activity).subarray(activityBytes).toString("utf8");
                pending.split("\n").filter(Boolean).forEach(onActivityLine);
                activityBytes = Buffer.byteLength(activity);
            }
            catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                    throw error;
                }
            }
        }
        if (terminalResult !== undefined) {
            return { result: terminalResult, state: status.state };
        }
        if (RESULT_TERMINAL_STATES.includes(status.state)) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor terminal status is missing its result");
        }
        if (status.state === "state-unknown") {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor cannot prove execution state");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor did not publish a terminal result by its bounded deadline");
}
export async function supervisedCancellationAt(directory, executionId, requestHash) {
    try {
        const cancellation = expectRecord(JSON.parse(await readFile(join(directory, CANCEL_FILE), "utf8")), "supervisor cancellation");
        if (cancellation.executionId !== executionId || cancellation.requestHash !== requestHash) {
            return undefined;
        }
        const requestedAt = Date.parse(expectString(cancellation.requestedAt, "supervisor cancellation.requestedAt"));
        return Number.isFinite(requestedAt) ? requestedAt : undefined;
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        return undefined;
    }
}
export async function cancelSupervisedProcess(handle) {
    await writeJsonAtomic(join(handle.directory, CANCEL_FILE), {
        schemaVersion: 1,
        executionId: handle.executionId,
        requestHash: handle.requestHash,
        requestedAt: new Date().toISOString(),
    });
}
export const supervisorArtifactNames = {
    request: REQUEST_FILE,
    status: STATUS_FILE,
    result: RESULT_FILE,
    cancel: CANCEL_FILE,
    activity: ACTIVITY_FILE,
    child: CHILD_FILE,
    watchdogReady: WATCHDOG_READY_FILE,
    watchdogError: WATCHDOG_ERROR_FILE,
    activityPulse: ACTIVITY_PULSE_FILE,
    completion: COMPLETION_FILE,
};
