import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AutopilotError } from "./errors.js";
import { expectInteger, expectLiteral, expectRecord } from "./json.js";
import { runProcess } from "./process.js";
const PROTOCOL_MAGIC = Buffer.from("APJOB001", "ascii");
const PROTOCOL_VERSION = 1;
const OPERATION = { launch: 1, query: 2, terminate: 3 };
const X64_PE_MACHINE = 0x8664;
export const WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES = 16_777_216;
export const WINDOWS_BROKER_MAXIMUM_FIELD_BYTES = 1_048_576;
export const WINDOWS_BROKER_MAXIMUM_LIST_ENTRIES = 16_384;
export function packagedWindowsJobHelper() {
    return {
        executable: fileURLToPath(new URL("../native/win32-x64/job-helper.exe", import.meta.url)),
        manifest: fileURLToPath(new URL("../native/win32-x64/job-helper.json", import.meta.url)),
    };
}
function parseManifest(value) {
    const object = expectRecord(value, "Windows Job Object helper manifest");
    if (object.schemaVersion !== 1 || object.platform !== "win32" || object.architecture !== "x64"
        || object.protocolVersion !== 1 || object.provenance !== "github-actions-workflow-dispatch"
        || typeof object.sourceCommit !== "string" || !/^[a-f0-9]{40,64}$/u.test(object.sourceCommit)
        || typeof object.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(object.sourceSha256)
        || typeof object.workflowRunId !== "string" || !/^[1-9][0-9]*$/u.test(object.workflowRunId)
        || typeof object.workflowRunAttempt !== "string" || !/^[1-9][0-9]*$/u.test(object.workflowRunAttempt)
        || typeof object.workflowSha !== "string" || !/^[a-f0-9]{40,64}$/u.test(object.workflowSha)
        || object.workflowName !== "Autopilot Windows Job Object helper"
        || typeof object.workflowRef !== "string"
        || !/^drafael\/coding-harness\/\.github\/workflows\/autopilot-windows-helper\.yml@refs\/heads\/[A-Za-z0-9._\/-]+$/u.test(object.workflowRef)
        || object.workflowEvent !== "workflow_dispatch" || object.repository !== "drafael/coding-harness"
        || typeof object.toolset !== "string" || object.toolset.length === 0
        || typeof object.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(object.sha256)) {
        throw new AutopilotError("ADAPTER_UNSUPPORTED", "Windows Job Object helper manifest is invalid");
    }
    return {
        schemaVersion: 1,
        platform: "win32",
        architecture: "x64",
        protocolVersion: 1,
        provenance: "github-actions-workflow-dispatch",
        sourceCommit: object.sourceCommit,
        sourceSha256: object.sourceSha256,
        workflowRunId: object.workflowRunId,
        workflowRunAttempt: object.workflowRunAttempt,
        workflowSha: object.workflowSha,
        workflowName: "Autopilot Windows Job Object helper",
        workflowRef: object.workflowRef,
        workflowEvent: "workflow_dispatch",
        repository: "drafael/coding-harness",
        toolset: object.toolset,
        sha256: object.sha256,
    };
}
function peMachine(bytes) {
    if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
        return undefined;
    }
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 > bytes.length || bytes.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0") {
        return undefined;
    }
    return bytes.readUInt16LE(peOffset + 4);
}
export async function verifyWindowsJobHelper(location = packagedWindowsJobHelper(), platform = process.platform, architecture = process.arch) {
    if (platform !== "win32" || architecture !== "x64") {
        return { available: false };
    }
    try {
        const [executable, manifestValue] = await Promise.all([
            readFile(location.executable),
            readFile(location.manifest, "utf8"),
        ]);
        const manifest = parseManifest(JSON.parse(manifestValue));
        const sha256 = createHash("sha256").update(executable).digest("hex");
        return manifest.sha256 === sha256 && peMachine(executable) === X64_PE_MACHINE
            ? { available: true, sha256 }
            : { available: false };
    }
    catch {
        return { available: false };
    }
}
export async function verifiedWindowsJobHelperSha256() {
    const verified = await verifyWindowsJobHelper();
    return verified.available ? verified.sha256 : undefined;
}
export async function windowsRestartReattachmentAvailable() {
    return await verifiedWindowsJobHelperSha256() !== undefined;
}
export async function windowsBrokerIdentity(executionId, requestHash) {
    const helper = await checkedHelper();
    return {
        schemaVersion: 1,
        executionId,
        requestHash,
        brokerName: windowsBrokerName(executionId, requestHash),
        brokerToken: createHash("sha256").update(`broker-token\0${executionId}\0${requestHash}`, "utf8").digest("hex"),
        helperSha256: helper.sha256,
    };
}
export function windowsBrokerName(executionId, requestHash) {
    const identity = createHash("sha256").update(`${executionId}\0${requestHash}`, "utf8").digest("hex");
    return `\\\\.\\pipe\\AutopilotBroker_${identity}`;
}
function environmentValue(environment, name) {
    const entry = Object.entries(environment).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase());
    return entry?.[1];
}
async function existingFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
async function resolveNpmCommandShim(commandPath, arguments_) {
    const content = await readFile(commandPath, "utf8");
    const normalized = content.replaceAll("\r\n", "\n");
    const matches = [...normalized.matchAll(/["']%dp0%[\\/]([^"']+\.(?:cjs|mjs|js))["']\s+%\*/giu)];
    if (matches.length !== 1 || !/^@ECHO off\n/iu.test(normalized) || !normalized.includes("CALL :find_dp0")) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "Windows command shim is not a recognized npm argv-preserving launcher");
    }
    const relativeScript = matches[0]?.[1];
    if (relativeScript === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "Windows npm command shim entry point is missing");
    }
    const script = resolve(dirname(commandPath), relativeScript);
    if (!await existingFile(script)) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "Windows npm command shim entry point is unavailable");
    }
    const adjacentNode = join(dirname(commandPath), "node.exe");
    return {
        executable: await existingFile(adjacentNode) ? adjacentNode : process.execPath,
        arguments: [script, ...arguments_],
    };
}
export async function resolveWindowsCommand(executable, arguments_, cwd, environment) {
    const hasPath = isAbsolute(executable) || /[\\/]/u.test(executable);
    const extensions = extname(executable) === ""
        ? (environmentValue(environment, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
        : [""];
    const directories = hasPath
        ? [""]
        : [cwd, ...(environmentValue(environment, "PATH") ?? "").split(";").filter(Boolean)];
    const base = hasPath ? (isAbsolute(executable) ? executable : resolve(cwd, executable)) : executable;
    let resolvedPath;
    for (const directory of directories) {
        for (const extension of extensions) {
            const candidate = hasPath ? `${base}${extension}` : join(directory, `${base}${extension}`);
            if (await existingFile(candidate)) {
                resolvedPath = resolve(candidate);
                break;
            }
        }
        if (resolvedPath !== undefined) {
            break;
        }
    }
    if (resolvedPath === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", `Windows executable is unavailable: ${executable}`);
    }
    const extension = extname(resolvedPath).toLowerCase();
    if (extension === ".cmd") {
        return await resolveNpmCommandShim(resolvedPath, arguments_);
    }
    if (extension !== ".exe" && extension !== ".com") {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", `Windows executable is not CreateProcess-compatible: ${resolvedPath}`);
    }
    return { executable: resolvedPath, arguments: arguments_ };
}
function appendUInt32(parts, value) {
    const bytes = Buffer.allocUnsafe(4);
    bytes.writeUInt32LE(value);
    parts.push(bytes);
}
function appendString(parts, value) {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > WINDOWS_BROKER_MAXIMUM_FIELD_BYTES) {
        throw new AutopilotError("ADAPTER_MALFORMED", "Windows Job Object broker field exceeds the protocol bound");
    }
    appendUInt32(parts, bytes.length);
    parts.push(bytes);
}
export function encodeWindowsJobRequest(request) {
    const parts = [PROTOCOL_MAGIC];
    appendUInt32(parts, PROTOCOL_VERSION);
    appendUInt32(parts, OPERATION[request.operation]);
    appendString(parts, request.brokerName);
    appendString(parts, request.brokerToken);
    if (request.operation === "launch") {
        if (request.arguments.length > WINDOWS_BROKER_MAXIMUM_LIST_ENTRIES) {
            throw new AutopilotError("ADAPTER_MALFORMED", "Windows Job Object broker argument count exceeds the protocol bound");
        }
        appendString(parts, request.executable);
        appendString(parts, request.cwd);
        appendUInt32(parts, request.arguments.length);
        request.arguments.forEach((argument) => appendString(parts, argument));
        const environment = Object.entries(request.environment)
            .filter((entry) => entry[1] !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        if (environment.length > WINDOWS_BROKER_MAXIMUM_LIST_ENTRIES) {
            throw new AutopilotError("ADAPTER_MALFORMED", "Windows Job Object broker environment count exceeds the protocol bound");
        }
        appendUInt32(parts, environment.length);
        environment.forEach(([name, value]) => {
            appendString(parts, name);
            appendString(parts, value);
        });
    }
    const encoded = Buffer.concat(parts);
    if (encoded.length > WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES) {
        throw new AutopilotError("ADAPTER_MALFORMED", "Windows Job Object helper request exceeds the protocol bound");
    }
    return encoded;
}
export function parseWindowsJobObservation(stdout) {
    let value;
    try {
        value = JSON.parse(stdout.trim());
    }
    catch (error) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object helper returned malformed control output", {
            cause: String(error),
        });
    }
    const object = expectRecord(value, "Windows Job Object helper response");
    if (object.schemaVersion !== 1 || object.protocolVersion !== 1) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object helper response version changed");
    }
    return {
        state: expectLiteral(object.state, ["ready", "starting", "busy", "empty", "absent", "terminated"], "Windows Job Object helper response.state"),
        activeProcesses: expectInteger(object.activeProcesses, "Windows Job Object helper response.activeProcesses", 0),
    };
}
async function checkedHelper() {
    const location = packagedWindowsJobHelper();
    const verified = await verifyWindowsJobHelper(location);
    if (!verified.available || verified.sha256 === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "verified win32-x64 Job Object helper is unavailable");
    }
    return { location, sha256: verified.sha256 };
}
function canonicalIdentity(identity) {
    return [
        identity.schemaVersion,
        identity.executionId,
        identity.requestHash,
        identity.brokerName,
        identity.brokerToken,
        identity.helperSha256,
    ].join("\0");
}
function helperEnvironment(source = process.env) {
    return Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "PATHEXT"].flatMap((name) => {
        const value = environmentValue(source, name);
        return value === undefined ? [] : [[name, value]];
    }));
}
async function terminateControlHelper(pid) {
    try {
        process.kill(pid);
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
            throw error;
        }
    }
}
async function control(operation, identity) {
    const helper = await checkedHelper();
    const expected = await windowsBrokerIdentity(identity.executionId, identity.requestHash);
    if (canonicalIdentity(identity) !== canonicalIdentity(expected) || helper.sha256 !== identity.helperSha256) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object broker identity changed");
    }
    const result = await runProcess({
        executable: helper.location.executable,
        arguments: [],
        cwd: process.cwd(),
        environment: helperEnvironment(),
        stdin: encodeWindowsJobRequest({
            operation,
            brokerName: identity.brokerName,
            brokerToken: identity.brokerToken,
        }),
        timeoutMs: 10_000,
        terminate: terminateControlHelper,
        maxOutputBytes: 65_536,
        detached: false,
    });
    if (result.exitCode !== 0 || result.stderr !== "") {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", `Windows Job Object ${operation} was not confirmed`, {
            exitCode: result.exitCode,
            stderr: result.stderr,
        });
    }
    return parseWindowsJobObservation(result.stdout);
}
export async function queryWindowsJob(identity) {
    return await control("query", identity);
}
export async function terminateWindowsJob(identity) {
    const deadline = Date.now() + 5_000;
    while (true) {
        const observation = await control("terminate", identity);
        if (observation.state === "terminated" || observation.state === "absent" || observation.state === "empty") {
            return observation;
        }
        if (observation.state !== "busy" || Date.now() >= deadline) {
            throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object did not become quiescent");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}
export async function launchWindowsJob(identity, request, processOptions) {
    const helper = await checkedHelper();
    const expected = await windowsBrokerIdentity(identity.executionId, identity.requestHash);
    if (canonicalIdentity(identity) !== canonicalIdentity(expected) || helper.sha256 !== identity.helperSha256) {
        throw new AutopilotError("EXECUTION_STATE_UNKNOWN", "Windows Job Object broker launch identity changed");
    }
    return await runProcess({
        executable: helper.location.executable,
        arguments: [],
        cwd: request.cwd,
        environment: helperEnvironment(request.environment),
        stdin: encodeWindowsJobRequest({
            ...request,
            operation: "launch",
            brokerName: identity.brokerName,
            brokerToken: identity.brokerToken,
        }),
        maxOutputBytes: processOptions.maximumOutputBytes,
        redactValues: processOptions.redactValues,
        detached: false,
        onActivity: processOptions.onActivity,
        ...(processOptions.onStderrLine === undefined ? {} : { onStderrLine: processOptions.onStderrLine }),
        onSpawn: processOptions.onSpawn,
    });
}
