import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { canonicalJson, expectBoolean, expectInteger, expectRecord, expectString, expectStringArray, sha256 } from "./json.js";
import { writeImmutableJson, writeJsonAtomic } from "./journal.js";
const REQUEST_FILE = "request.json";
const STATUS_FILE = "status.json";
const RESULT_FILE = "result.json";
const CANCEL_FILE = "cancel.json";
const ACTIVITY_FILE = "stderr-activity.log";
const CHILD_FILE = "child.json";
const WATCHDOG_READY_FILE = "watchdog-ready.json";
const ACTIVITY_PULSE_FILE = "activity-pulse";
const COMPLETION_FILE = "completion.json";
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
        executable: expectString(object.executable, "supervisor request.executable"),
        arguments: expectStringArray(object.arguments, "supervisor request.arguments"),
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
export async function readSupervisedResult(directory) {
    const value = await readJson(join(directory, RESULT_FILE));
    return value === undefined ? undefined : parseProcessResult(value, "supervisor result");
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
async function waitForStatus(directory, requestHash, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await readSupervisedStatus(directory);
        if (status !== undefined) {
            if (status.requestHash !== requestHash) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status request identity changed");
            }
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor did not publish bootstrap status");
}
export async function launchSupervisedProcess(directory, request, environment) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const created = await publishRequest(directory, request);
    const persistedRequest = await readSupervisedRequest(directory);
    if (persistedRequest === undefined) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor request disappeared after publication");
    }
    const requestHash = supervisorRequestHash(persistedRequest);
    const existingStatus = await readSupervisedStatus(directory);
    if (existingStatus !== undefined) {
        if (existingStatus.requestHash !== requestHash) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status does not match its immutable request");
        }
        return {
            schemaVersion: 1,
            executionId: request.executionId,
            directory,
            requestHash,
            startedAt: existingStatus.startedAt,
        };
    }
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
    const status = await waitForStatus(directory, requestHash, 5_000);
    return {
        schemaVersion: 1,
        executionId: request.executionId,
        directory,
        requestHash,
        startedAt: status.startedAt,
    };
}
export async function reattachSupervisedProcess(directory, request) {
    const existing = await readSupervisedRequest(directory);
    if (existing === undefined) {
        return undefined;
    }
    if (supervisorRequestIdentity(existing) !== supervisorRequestIdentity(request)) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised execution request changed before reattachment");
    }
    const requestHash = supervisorRequestHash(existing);
    const status = await readSupervisedStatus(directory);
    if (status === undefined || status.requestHash !== requestHash) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervised execution bootstrap is incomplete");
    }
    return { schemaVersion: 1, executionId: request.executionId, directory, requestHash, startedAt: status.startedAt };
}
export async function observeSupervisedProcess(handle, onActivityLine) {
    let activityBytes = 0;
    const deadline = Date.now() + 15_000 + Math.max(1, Date.parse((await readSupervisedRequest(handle.directory))?.deadline ?? "") - Date.now());
    while (Date.now() < deadline) {
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
        const status = await readSupervisedStatus(handle.directory);
        if (status === undefined || status.executionId !== handle.executionId || status.requestHash !== handle.requestHash) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor status identity changed during observation");
        }
        if (["completed", "failed", "cancelled", "timed-out"].includes(status.state)) {
            const result = await readSupervisedResult(handle.directory);
            if (result === undefined) {
                throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "supervisor terminal status is missing its result");
            }
            return { result, state: status.state };
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
    activityPulse: ACTIVITY_PULSE_FILE,
    completion: COMPLETION_FILE,
};
