import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  encodeWindowsJobRequest,
  packagedWindowsJobHelper,
  parseWindowsJobObservation,
  resolveWindowsCommand,
  verifyWindowsJobHelper,
  WINDOWS_BROKER_MAXIMUM_FIELD_BYTES,
  WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES,
  windowsBrokerName,
} from "../src/windows-job.js";
import { runProcess } from "../src/process.js";

function x64PeImage(): Buffer {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128, "binary");
  bytes.writeUInt16LE(0x8664, 132);
  return bytes;
}

const token = "a".repeat(64);
const helperProvenance = {
  provenance: "github-actions-workflow-dispatch",
  sourceCommit: "b".repeat(40),
  sourceSha256: "d".repeat(64),
  workflowRunId: "123",
  workflowRunAttempt: "1",
  workflowSha: "c".repeat(40),
  workflowName: "Autopilot Windows Job Object helper",
  workflowRef: "drafael/coding-harness/.github/workflows/autopilot-windows-helper.yml@refs/heads/feature",
  workflowEvent: "workflow_dispatch",
  repository: "drafael/coding-harness",
  toolset: "MSVC 19.44.35217",
} as const;

function maximumProtocolRequest(): Buffer {
  const fixture = {
    operation: "launch" as const,
    brokerName: windowsBrokerName("execution", "boundary"),
    brokerToken: token,
    executable: "C:\\runtime.exe",
    arguments: Array.from({ length: 16 }, () => ""),
    cwd: "C:\\worktree",
    environment: {},
  };
  const base = encodeWindowsJobRequest(fixture);
  let remaining = WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES - base.length;
  const arguments_ = fixture.arguments.map(() => {
    const length = Math.min(remaining, WINDOWS_BROKER_MAXIMUM_FIELD_BYTES);
    remaining -= length;
    return "x".repeat(length);
  });
  assert.equal(remaining, 0);
  return encodeWindowsJobRequest({ ...fixture, arguments: arguments_ });
}

test("Windows Job Object broker identity is deterministic and request-bound", () => {
  const first = windowsBrokerName("execution", "request-a");
  const repeated = windowsBrokerName("execution", "request-a");
  const changed = windowsBrokerName("execution", "request-b");

  assert.equal(first, repeated);
  assert.notEqual(first, changed);
  assert.match(first, /^\\\\\.\\pipe\\AutopilotBroker_[a-f0-9]{64}$/u);
});

test("Windows Job Object broker protocol preserves arguments and environment without shell syntax", () => {
  const encoded = encodeWindowsJobRequest({
    operation: "launch",
    brokerName: windowsBrokerName("execution", "request"),
    brokerToken: token,
    executable: "C:\\Program Files\\runtime.exe",
    arguments: ["", "value with spaces", "literal&operator", "quote\"value", "trailing\\", "ユニコード"],
    cwd: "C:\\worktree",
    environment: { Path: "C:\\bin", SAFE: "value", SECRET_TOKEN: "not-persisted" },
  });

  assert.equal(encoded.subarray(0, 8).toString("ascii"), "APJOB001");
  assert.equal(encoded.readUInt32LE(8), 1);
  assert.equal(encoded.readUInt32LE(12), 1);
  assert.ok(encoded.includes(Buffer.from("literal&operator", "utf8")));
  assert.ok(encoded.includes(Buffer.from("SECRET_TOKEN", "utf8")));
  assert.equal(encoded.includes(Buffer.from("cmd.exe", "utf8")), false);
});

test("Windows Job Object broker protocol accepts the exact maximum and rejects one byte more", () => {
  const exact = maximumProtocolRequest();

  assert.equal(exact.length, WINDOWS_BROKER_MAXIMUM_PROTOCOL_BYTES);
  assert.throws(() => encodeWindowsJobRequest({
    operation: "launch",
    brokerName: windowsBrokerName("execution", "field-boundary"),
    brokerToken: token,
    executable: "C:\\runtime.exe",
    arguments: ["x".repeat(WINDOWS_BROKER_MAXIMUM_FIELD_BYTES + 1)],
    cwd: "C:\\worktree",
    environment: {},
  }), /field exceeds the protocol bound/u);
});

test("native Windows broker accepts the exact protocol maximum and rejects one byte more", {
  skip: process.platform !== "win32" || process.arch !== "x64",
}, async (context) => {
  const helper = packagedWindowsJobHelper();
  const verified = await verifyWindowsJobHelper(helper);
  if (!verified.available) {
    context.skip("verified packaged helper is absent");
    return;
  }
  const exact = maximumProtocolRequest();
  const exactResult = await runProcess({
    executable: helper.executable,
    arguments: [],
    cwd: process.cwd(),
    environment: process.env,
    stdin: exact,
    timeoutMs: 15_000,
  });
  const oversizedResult = await runProcess({
    executable: helper.executable,
    arguments: [],
    cwd: process.cwd(),
    environment: process.env,
    stdin: Buffer.concat([exact, Buffer.from([0])]),
    timeoutMs: 15_000,
  });

  assert.match(exactResult.stderr, /cannot create the harness process suspended/u);
  assert.doesNotMatch(exactResult.stderr, /malformed Windows Job Object broker protocol/u);
  assert.match(oversizedResult.stderr, /malformed Windows Job Object broker protocol/u);
});

test("Windows command resolution preserves case-insensitive Path and npm shim argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-windows-command-"));
  const entry = join(root, "entry.mjs");
  const shim = join(root, "adapter.cmd");
  await writeFile(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  await writeFile(shim, [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "endLocal & \"%_prog%\" \"%dp0%\\entry.mjs\" %*",
    "",
  ].join("\r\n"));
  const arguments_ = ["", "quote\"value", "trailing\\", "ユニコード"];

  const resolved = await resolveWindowsCommand("adapter", arguments_, root, {
    Path: root,
    PATHEXT: ".exe;.cmd",
  });

  assert.equal(resolved.executable, process.execPath);
  assert.deepEqual(resolved.arguments, [entry, ...arguments_]);
});

test("Windows command resolution prefers a CreateProcess-compatible executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-windows-executable-"));
  const executable = join(root, "adapter.exe");
  await writeFile(executable, x64PeImage());

  const resolved = await resolveWindowsCommand("adapter", ["argument"], root, {
    PATH: root,
    PATHEXT: ".exe;.cmd",
  });

  assert.equal(resolved.executable, executable);
  assert.deepEqual(resolved.arguments, ["argument"]);
});

test("Windows Job Object helper verification binds digest and x64 PE architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-windows-job-helper-"));
  const executable = join(root, "job-helper.exe");
  const manifest = join(root, "job-helper.json");
  const bytes = x64PeImage();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(executable, bytes);
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: 1,
    platform: "win32",
    architecture: "x64",
    protocolVersion: 1,
    ...helperProvenance,
    sha256,
  })}\n`);

  assert.deepEqual(await verifyWindowsJobHelper({ executable, manifest }, "win32", "x64"), { available: true, sha256 });
  assert.deepEqual(await verifyWindowsJobHelper({ executable, manifest }, "win32", "arm64"), { available: false });
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: 1,
    platform: "win32",
    architecture: "x64",
    protocolVersion: 1,
    ...helperProvenance,
    provenance: "local-untrusted",
    sha256,
  })}\n`);
  assert.deepEqual(await verifyWindowsJobHelper({ executable, manifest }, "win32", "x64"), { available: false });
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: 1,
    platform: "win32",
    architecture: "x64",
    protocolVersion: 1,
    sha256,
  })}\n`);
  assert.deepEqual(await verifyWindowsJobHelper({ executable, manifest }, "win32", "x64"), { available: false });
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: 1,
    platform: "win32",
    architecture: "x64",
    protocolVersion: 1,
    ...helperProvenance,
    sha256,
  })}\n`);
  await writeFile(executable, Buffer.concat([bytes, Buffer.from("tampered")]));
  assert.deepEqual(await verifyWindowsJobHelper({ executable, manifest }, "win32", "x64"), { available: false });
});

test("Windows Job Object broker control output rejects ambiguous responses", () => {
  assert.deepEqual(parseWindowsJobObservation(
    '{"schemaVersion":1,"protocolVersion":1,"state":"ready","activeProcesses":2}\n',
  ), { state: "ready", activeProcesses: 2 });
  assert.deepEqual(parseWindowsJobObservation(
    '{"schemaVersion":1,"protocolVersion":1,"state":"busy","activeProcesses":0}\n',
  ), { state: "busy", activeProcesses: 0 });
  assert.throws(() => parseWindowsJobObservation(
    '{"schemaVersion":1,"protocolVersion":1,"state":"unknown","activeProcesses":1}\n',
  ), /response.state/u);
  assert.throws(() => parseWindowsJobObservation("not-json\n"), /malformed control output/u);
});
