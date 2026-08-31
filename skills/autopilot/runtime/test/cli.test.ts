import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sealCharter } from "../src/charter.js";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal, writeImmutableJson } from "../src/journal.js";
import { isRecord } from "../src/json.js";
import { acquireRunLock, readLockOwner } from "../src/lock.js";
import { runProcess } from "../src/process.js";
import { createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

test("compiled CLI exposes help and version without side effects", async () => {
  const help = await runProcess({ executable: process.execPath, arguments: [cliPath, "--help"], cwd: process.cwd() });
  const version = await runProcess({ executable: process.execPath, arguments: [cliPath, "--version"], cwd: process.cwd() });

  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /autopilot.*start <charter-file>/s);
  assert.match(help.stdout, /status \[run-id\]/);
  assert.equal(version.stdout.trim(), "0.1.0");
});

test("compiled CLI discovers lifecycle runs without requiring a run ID", async () => {
  const repository = await createRepository();
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-cli-state-"));

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "status"],
    cwd: repository.root,
  });

  assert.equal(result.exitCode, 0);
  const output: unknown = JSON.parse(result.stdout);
  assert.ok(isRecord(output));
  assert.equal(output.kind, "selection");
  assert.equal(output.operation, "status");
  assert.deepEqual(output.candidates, []);
});

test("compiled CLI status surfaces corrupt retained state instead of hiding it", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-status-corrupt-")));
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "healthy-status-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(runDirectory, { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const corruptDirectory = join(stateRoot, "runs", "corrupt-status-run");
  await mkdir(corruptDirectory);
  await writeFile(join(corruptDirectory, "charter.json"), "{broken");

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "status"],
    cwd: root,
  });
  const plain = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--state-dir", stateRoot, "status"],
    cwd: root,
  });

  assert.equal(result.exitCode, 0);
  const output: unknown = JSON.parse(result.stdout);
  assert.ok(isRecord(output));
  assert.equal(output.kind, "selection");
  assert.ok(Array.isArray(output.corrupt));
  assert.match(plain.stdout, /Run selection required for status/);
  assert.match(plain.stdout, /corrupt-status-run: corrupt/);
  assert.doesNotMatch(plain.stdout, /Multiple status candidates/);
});

test("compiled CLI status does not overwrite a coordinator-owned report", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-status-report-")));
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "status-cli-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  const reportPath = join(runDirectory, "reports", "status.json");
  await mkdir(join(runDirectory, "reports"), { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  await writeFile(reportPath, "{\"sentinel\":true}\n");

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "status"],
    cwd: root,
  });
  const plain = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--state-dir", stateRoot, "status"],
    cwd: root,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(plain.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).runId, charter.runId);
  assert.match(plain.stdout, /Autopilot status-cli-r: COMPILED/);
  assert.match(plain.stdout, /Next: \/autopilot resume/);
  assert.doesNotMatch(plain.stdout, new RegExp(root));
  assert.doesNotMatch(plain.stdout, new RegExp(stateRoot));
  assert.equal(await readFile(reportPath, "utf8"), "{\"sentinel\":true}\n");
});

test("compiled CLI resumes one discovered interrupted run without a run ID", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-resume-")));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "autopilot-cli-resume-pi-"));
  const bin = join(fixtureRoot, "bin");
  const agentDirectory = join(fixtureRoot, "agent");
  await mkdir(bin, { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeNodeExecutable(bin, "pi", `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  console.log("pi 0.84.2");
} else {
  writeFileSync("result.txt", "done\\n");
  console.log(JSON.stringify({type:"agent_settled"}));
}
`);
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "interrupted-cli-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(runDirectory, { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "resume"],
    cwd: root,
    environment: {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PI_CODING_AGENT_DIR: agentDirectory,
    },
    timeoutMs: 30_000,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, "SUCCEEDED");
});

test("compiled CLI stops one discovered inactive run without a run ID", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-inactive-stop-")));
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "inactive-cli-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(runDirectory, { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "stop"],
    cwd: root,
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).state, "STOPPED");
  assert.equal(journal.records.filter(({ event }) => event.type === "RUN_STOPPED").length, 1);
});

test("compiled CLI pauses one discovered inactive run without making it terminal", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-inactive-pause-")));
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "inactive-pause-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(runDirectory, { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });

  const result = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "pause"],
    cwd: root,
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, "WAITING");
  assert.equal(journal.records.filter(({ event }) => event.type === "RUN_PAUSE_REQUESTED").length, 1);
  assert.equal(journal.records.filter(({ event }) => event.type === "RUN_WAITING").length, 1);
  assert.equal(journal.records.some(({ event }) => event.type === "RUN_STOPPED"), false);
});

test("compiled CLI sends a fenced stop request to the active coordinator", async () => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-stop-")));
  const charter = sealCharter(proposedCharter(root, repository.baseCommit, "single", "active-cli-run"));
  const runDirectory = join(stateRoot, "runs", charter.runId);
  await mkdir(runDirectory, { recursive: true });
  await writeImmutableJson(join(runDirectory, "charter.json"), charter);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const lock = await acquireRunLock(join(runDirectory, "run.lock"));

  try {
    const result = await runProcess({
      executable: process.execPath,
      arguments: [cliPath, "--json", "--state-dir", stateRoot, "stop"],
      cwd: root,
    });

    assert.equal(result.exitCode, 0);
    const output: unknown = JSON.parse(result.stdout);
    assert.ok(isRecord(output));
    assert.equal(output.kind, "stop-requested");
    assert.equal(output.runId, charter.runId);
    assert.equal(await lock.stopRequested(charter.runId), true);
  } finally {
    await lock.release();
  }
});

test("active coordinator observes a fenced CLI stop request and records the terminal event", async (context) => {
  const repository = await createRepository();
  const root = await realpath(repository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-cli-active-stop-")));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "autopilot-cli-pi-"));
  const bin = join(fixtureRoot, "bin");
  const agentDirectory = join(fixtureRoot, "agent");
  const marker = join(fixtureRoot, "launched");
  const charterFile = join(fixtureRoot, "charter.json");
  await mkdir(bin, { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeNodeExecutable(bin, "pi", `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  console.log("pi 0.84.2");
} else {
  writeFileSync(process.env.AUTOPILOT_TEST_MARKER, "launched\\n");
  setInterval(() => {}, 1000);
}
`);
  const proposed = proposedCharter(root, repository.baseCommit, "single", "foreground-stop-run");
  await writeFile(charterFile, JSON.stringify(proposed));
  const child = spawn(process.execPath, [cliPath, "--json", "--state-dir", stateRoot, "start", charterFile], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PI_CODING_AGENT_DIR: agentDirectory,
      AUTOPILOT_TEST_MARKER: marker,
    },
    stdio: "ignore",
  });
  context.after(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  });
  const publishedRun = join(stateRoot, "runs", proposed.runId);
  await waitForFile(join(publishedRun, "charter.json"));
  assert.ok(await readLockOwner(join(publishedRun, "run.lock")));
  await waitForFile(marker);

  const stopped = await runProcess({
    executable: process.execPath,
    arguments: [cliPath, "--json", "--state-dir", stateRoot, "stop"],
    cwd: root,
  });
  const exitCode = child.exitCode ?? await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("foreground coordinator did not stop")), 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  const journal = await readJournal(join(stateRoot, "runs", proposed.runId, "events.jsonl"));

  assert.equal(stopped.exitCode, 0);
  assert.equal(JSON.parse(stopped.stdout).kind, "stop-requested");
  assert.equal(exitCode, 0);
  assert.equal(journal.records.filter(({ event }) => event.type === "RUN_STOPPED").length, 1);
  assert.equal(journal.records.some(({ event }) => event.type === "RUN_SUCCEEDED"), false);
});

test("compiled CLI reports a stable error for an unknown command", async () => {
  const result = await runProcess({ executable: process.execPath, arguments: [cliPath, "unknown"], cwd: process.cwd() });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /CHARTER_INVALID: unknown command/);
});
