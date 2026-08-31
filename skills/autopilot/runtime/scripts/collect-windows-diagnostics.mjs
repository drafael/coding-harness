#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

const diagnosticFiles = new Set([
  "child.json",
  "completion.json",
  "result.json",
  "status.json",
  "watchdog-ready.json",
]);

const helperFailureKinds = new Map([
  ["Windows Job Object broker is unavailable", "BROKER_UNAVAILABLE"],
  ["cannot connect to the Windows Job Object broker", "BROKER_CONNECT_FAILED"],
  ["Windows Job Object broker control failed", "BROKER_CONTROL_FAILED"],
  ["cannot publish Windows Job Object broker response", "BROKER_RESPONSE_FAILED"],
  ["cannot deny Job Object handle duplication from the broker", "HANDLE_DUPLICATION_DENIAL_FAILED"],
  ["cannot create the private Job Object", "JOB_CREATE_FAILED"],
  ["cannot configure private Job Object kill-on-close", "JOB_CONFIGURATION_FAILED"],
  ["cannot create the unique Windows Job Object broker channel", "BROKER_CHANNEL_CREATE_FAILED"],
  ["cannot start the Windows Job Object broker", "BROKER_START_FAILED"],
  ["cannot allocate the contained child launch request", "CHILD_REQUEST_ALLOCATION_FAILED"],
  ["cannot create the harness process suspended", "SUSPENDED_PROCESS_CREATE_FAILED"],
  ["cannot assign the suspended harness process to the private Job Object", "JOB_ASSIGNMENT_FAILED"],
  ["broker readiness was not observed before the launch deadline", "BROKER_READINESS_TIMEOUT"],
  ["cannot resume the contained harness process", "HARNESS_RESUME_FAILED"],
  ["cannot query private Job Object completion", "JOB_COMPLETION_QUERY_FAILED"],
  ["cannot quiesce descendants after harness completion", "DESCENDANT_QUIESCENCE_FAILED"],
  ["cannot prove private Job Object process quiescence", "QUIESCENCE_PROOF_FAILED"],
  ["private Job Object descendants did not quiesce within five seconds", "QUIESCENCE_TIMEOUT"],
  ["malformed Windows Job Object broker protocol", "BROKER_PROTOCOL_MALFORMED"],
  ["unsupported Windows Job Object broker protocol", "BROKER_PROTOCOL_UNSUPPORTED"],
  ["malformed Windows Job Object broker launch request", "BROKER_LAUNCH_REQUEST_MALFORMED"],
  ["malformed Windows Job Object broker control request", "BROKER_CONTROL_REQUEST_MALFORMED"],
  ["unsupported Windows Job Object broker operation", "BROKER_OPERATION_UNSUPPORTED"],
]);

const runtimeFailureKinds = new Map([
  ["attempt watchdog did not confirm readiness before harness launch", "WATCHDOG_READINESS_TIMEOUT"],
  ["Windows Job Object became empty before launch readiness", "JOB_EMPTY_BEFORE_READINESS"],
  ["Windows Job Object did not confirm assignment-before-resume readiness", "JOB_READINESS_TIMEOUT"],
  ["Windows Job Object helper identity changed before launch", "HELPER_IDENTITY_CHANGED_BEFORE_LAUNCH"],
  ["Windows Job Object helper exited before publishing its process identity", "HELPER_EXITED_BEFORE_IDENTITY"],
  ["Windows Job Object broker identity changed", "BROKER_IDENTITY_CHANGED"],
  ["Windows Job Object broker launch identity changed", "BROKER_LAUNCH_IDENTITY_CHANGED"],
  ["Windows Job Object query was not confirmed", "JOB_QUERY_UNCONFIRMED"],
  ["Windows Job Object helper identity changed before process-tree quiescence", "HELPER_IDENTITY_CHANGED_BEFORE_QUIESCENCE"],
  ["Windows Job Object did not become quiescent", "JOB_NOT_QUIESCENT"],
  ["Windows Job Object terminate was not confirmed", "JOB_TERMINATION_UNCONFIRMED"],
  ["Windows Job Object is empty but its attempt supervisor did not terminate", "SUPERVISOR_TERMINATION_TIMEOUT"],
  ["verified win32-x64 Job Object helper is unavailable", "VERIFIED_HELPER_UNAVAILABLE"],
]);

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function scalar(source, name, type) {
  const value = source[name];
  return typeof value === type ? { [name]: value } : {};
}

function integer(source, name, minimum = Number.MIN_SAFE_INTEGER) {
  const value = source[name];
  return Number.isSafeInteger(value) && value >= minimum ? { [name]: value } : {};
}

function knownStderrFailure(stderr) {
  const withoutNewline = stderr.endsWith("\r\n")
    ? stderr.slice(0, -2)
    : stderr.endsWith("\n") ? stderr.slice(0, -1) : stderr;
  if (withoutNewline.includes("\n") || withoutNewline.includes("\r")) {
    return { failureKind: "UNKNOWN" };
  }
  const win32Match = /^(.*) \(win32=([0-9]{1,10})\)$/u.exec(withoutNewline);
  const message = win32Match?.[1] ?? withoutNewline;
  const helperFailureKind = helperFailureKinds.get(message);
  if (helperFailureKind !== undefined) {
    if (win32Match === null) {
      return { failureKind: helperFailureKind };
    }
    const win32Code = Number(win32Match[2]);
    return Number.isSafeInteger(win32Code) && win32Code <= 0xffff_ffff
      ? { failureKind: helperFailureKind, win32Code }
      : { failureKind: "UNKNOWN" };
  }
  return win32Match === null && runtimeFailureKinds.has(message)
    ? { failureKind: runtimeFailureKinds.get(message) }
    : { failureKind: "UNKNOWN" };
}

function failureMetadata(value, prefix) {
  if (typeof value !== "string") {
    return {};
  }
  const classification = knownStderrFailure(value);
  return {
    [`${prefix}ByteLength`]: Buffer.byteLength(value),
    [`${prefix}Sha256`]: createHash("sha256").update(value).digest("hex"),
    [`${prefix}FailureKind`]: classification.failureKind,
    ...(classification.win32Code === undefined ? {} : { [`${prefix}Win32Code`]: classification.win32Code }),
  };
}

function stderrMetadata(value) {
  const metadata = failureMetadata(value, "stderr");
  return metadata.stderrFailureKind === undefined ? {} : {
    stderrByteLength: metadata.stderrByteLength,
    stderrSha256: metadata.stderrSha256,
    failureKind: metadata.stderrFailureKind,
    ...(metadata.stderrWin32Code === undefined ? {} : { win32Code: metadata.stderrWin32Code }),
  };
}

function sanitizeResult(value, prefix = "") {
  const source = record(value);
  const exitCode = integer(source, "exitCode");
  const truncated = scalar(source, "truncated", "boolean");
  const prefixed = (fields) => Object.fromEntries(Object.entries(fields).map(([name, fieldValue]) => [
    `${prefix}${name[0].toUpperCase()}${name.slice(1)}`,
    fieldValue,
  ]));
  return prefix === ""
    ? { ...exitCode, ...truncated, ...stderrMetadata(source.stderr) }
    : prefixed({ ...exitCode, ...truncated, ...stderrMetadata(source.stderr) });
}

function sanitizeDiagnostic(name, value) {
  const source = record(value);
  switch (name) {
    case "status.json":
      return {
        ...integer(source, "schemaVersion", 1),
        ...scalar(source, "executionId", "string"),
        ...scalar(source, "requestHash", "string"),
        ...scalar(source, "state", "string"),
        ...integer(source, "supervisorPid", 1),
        ...scalar(source, "startedAt", "string"),
        ...scalar(source, "updatedAt", "string"),
        ...scalar(source, "completedAt", "string"),
        ...integer(source, "exitCode"),
        ...failureMetadata(source.error, "error"),
      };
    case "completion.json":
      return {
        ...scalar(source, "state", "string"),
        ...scalar(source, "completedAt", "string"),
        ...sanitizeResult(source.result, "result"),
      };
    case "result.json":
      return sanitizeResult(source);
    case "child.json":
      return {
        ...integer(source, "schemaVersion", 1),
        ...scalar(source, "executionId", "string"),
        ...scalar(source, "requestHash", "string"),
        ...scalar(source, "brokerName", "string"),
        ...scalar(source, "helperSha256", "string"),
        ...integer(source, "helperPid", 1),
        ...integer(source, "childPid", 1),
        ...integer(source, "processGroupId", 1),
        ...integer(source, "supervisorPid", 1),
        ...scalar(source, "startedAt", "string"),
      };
    case "watchdog-ready.json":
      return {
        ...integer(source, "schemaVersion", 1),
        ...scalar(source, "executionId", "string"),
        ...scalar(source, "requestHash", "string"),
        ...integer(source, "supervisorPid", 1),
        ...scalar(source, "readyAt", "string"),
      };
    default:
      return {};
  }
}

function pidLiveness(value) {
  return ["helperPid", "childPid", "processGroupId", "supervisorPid"].flatMap((field) => {
    const pid = value[field];
    if (!Number.isSafeInteger(pid) || pid < 1) {
      return [];
    }
    try {
      process.kill(pid, 0);
      return [{ field, pid, state: "alive" }];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return [{ field, pid, state: "absent" }];
      }
      const permissionDenied = error instanceof Error && "code" in error && error.code === "EPERM";
      return [{ field, pid, state: permissionDenied ? "alive" : "unknown" }];
    }
  });
}

function diagnosticPath(root, path) {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
}

async function collectEntries(root) {
  const files = [];
  const unavailable = [];
  const visit = async (path) => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      unavailable.push({ path: diagnosticPath(root, path), kind: "subtree", readState: "unavailable" });
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (diagnosticFiles.has(entry.name) && relative(root, child).split(sep).includes("executions")) {
        files.push(child);
      }
    }
  };
  let topLevel;
  try {
    topLevel = await readdir(root, { withFileTypes: true });
  } catch {
    return { files, unavailable: [{ path: ".", kind: "subtree", readState: "unavailable" }] };
  }
  for (const entry of topLevel.filter((entry) => entry.isDirectory() && entry.name.startsWith("autopilot-"))) {
    await visit(join(root, entry.name));
  }
  files.sort((left, right) => left.localeCompare(right));
  unavailable.sort((left, right) => left.path.localeCompare(right.path));
  return { files, unavailable };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const root = argument("--root");
  const output = argument("--output");
  const collected = await collectEntries(root);
  const diagnostics = [...collected.unavailable];
  for (const path of collected.files) {
    const name = basename(path);
    try {
      const sanitized = sanitizeDiagnostic(name, JSON.parse(await readFile(path, "utf8")));
      diagnostics.push({
        path: diagnosticPath(root, path),
        file: name,
        value: sanitized,
        pidLiveness: pidLiveness(sanitized),
      });
    } catch {
      diagnostics.push({
        path: diagnosticPath(root, path),
        file: name,
        readState: "unavailable",
      });
    }
  }
  diagnostics.sort((left, right) => left.path.localeCompare(right.path));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, diagnostics }, null, 2)}\n`, { mode: 0o600 });
}

await main();
