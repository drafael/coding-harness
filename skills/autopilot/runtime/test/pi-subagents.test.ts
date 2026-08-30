import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { createPiAdapter } from "../adapters/pi/index.js";
import type { ExecutionRequest } from "../src/adapter-protocol.js";
import { findPiSubagentsInstallation } from "../src/pi-subagents.js";
import { attemptContextFixture } from "./helpers.js";

async function fakeInstallation(root: string, version: string): Promise<string> {
  const packageRoot = join(root, "npm", "node_modules", "pi-subagents");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "pi-subagents", version }));
  const extensionPath = join(packageRoot, "index.ts");
  await writeFile(extensionPath, "export default function () {}\n");
  return extensionPath;
}

function request(role: "implementation" | "review" = "implementation"): ExecutionRequest {
  return {
    protocolVersion: 1,
    role,
    runId: "run-12345678",
    itemId: "item-1",
    attemptId: "attempt-1",
    worktreePath: process.cwd(),
    objective: "Create result.txt",
    acceptanceSummary: "result.txt exists",
    context: attemptContextFixture("attempt-1"),
    contextHash: "context-hash",
    writableRoots: ["result.txt"],
    grants: [],
    deadline: new Date(Date.now() + 30_000).toISOString(),
    idleTimeoutMs: 10_000,
    maximumLineBytes: 65_536,
    maximumOutputBytes: 262_144,
    ...(role === "review" ? { reviewFocus: "Review the exact tree." } : {}),
  };
}

test("pi-subagents discovery requires the supported structured delegation version", async () => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "autopilot-pi-agent-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  try {
    await fakeInstallation(agentDirectory, "0.52.0");
    assert.equal(findPiSubagentsInstallation(), undefined);

    const extensionPath = await fakeInstallation(agentDirectory, "0.53.0");
    assert.deepEqual(findPiSubagentsInstallation(), { extensionPath, version: "0.53.0" });
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

test("Pi adapter uses the direct worker fallback when pi-subagents is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-pi-direct-"));
  const agentDirectory = join(root, "agent");
  const bin = join(root, "bin");
  const marker = join(root, "arguments.json");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "pi"), `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(process.env.AUTOPILOT_PI_ARGUMENTS, JSON.stringify(args));
console.log(JSON.stringify({type:"agent_settled"}));
`);
  await chmod(join(bin, "pi"), 0o755);
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const previousPath = process.env.PATH;
  const previousMarker = process.env.AUTOPILOT_PI_ARGUMENTS;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.AUTOPILOT_PI_ARGUMENTS = marker;
  try {
    const adapter = createPiAdapter();

    const handle = await adapter.launch(request());
    const observation = await adapter.observe(handle);
    const arguments_: unknown = JSON.parse(await readFile(marker, "utf8"));

    assert.equal(observation.status, "completed");
    assert.ok(Array.isArray(arguments_));
    assert.ok(arguments_.includes("read,bash,edit,write"));
    assert.ok(!arguments_.includes("--extension"));
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
    process.env.PATH = previousPath;
    if (previousMarker === undefined) {
      delete process.env.AUTOPILOT_PI_ARGUMENTS;
    } else {
      process.env.AUTOPILOT_PI_ARGUMENTS = previousMarker;
    }
  }
});

test("Pi adapter delegates through an available pi-subagents installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-pi-subagents-"));
  const agentDirectory = join(root, "agent");
  const bin = join(root, "bin");
  const marker = join(root, "arguments.json");
  await fakeInstallation(agentDirectory, "0.53.0");
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("pi 0.84.2");
} else {
  writeFileSync(process.env.AUTOPILOT_PI_ARGUMENTS, JSON.stringify(args));
  const message = {role:"custom", customType:"autopilot-subagent-result", content:"done", display:true, details:{status:process.env.AUTOPILOT_PI_STATUS ?? "completed"}};
  console.log(JSON.stringify({type:"message_end", message}));
}
`;
  await writeFile(join(bin, "pi"), script);
  await chmod(join(bin, "pi"), 0o755);
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const previousPath = process.env.PATH;
  const previousMarker = process.env.AUTOPILOT_PI_ARGUMENTS;
  const previousStatus = process.env.AUTOPILOT_PI_STATUS;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.AUTOPILOT_PI_ARGUMENTS = marker;
  try {
    const adapter = createPiAdapter();

    const handle = await adapter.launch(request());
    const observation = await adapter.observe(handle);
    const arguments_: unknown = JSON.parse(await readFile(marker, "utf8"));

    assert.equal(observation.status, "completed");
    assert.ok(Array.isArray(arguments_));
    assert.ok(arguments_.includes("--extension"));
    assert.ok(arguments_.some((argument) => typeof argument === "string" && argument.startsWith("/autopilot-worker ")));

    const reviewScript = `#!/usr/bin/env node
console.log(JSON.stringify({type:"message", message:{role:"assistant", content:[{type:"text", text:'AUTOPILOT_REVIEW_RESULT:{"verdict":"clean","findings":[]}'}]}}));
`;
    await writeFile(join(bin, "pi"), reviewScript);
    await chmod(join(bin, "pi"), 0o755);
    const reviewHandle = await adapter.launch(request("review"));
    const reviewObservation = await adapter.observe(reviewHandle);
    assert.equal(reviewObservation.status, "completed");
    assert.deepEqual(reviewObservation.reviewResult, { verdict: "clean", findings: [] });

    await writeFile(join(bin, "pi"), script);
    await chmod(join(bin, "pi"), 0o755);
    process.env.AUTOPILOT_PI_STATUS = "failed";
    const failedHandle = await adapter.launch(request());
    const failedObservation = await adapter.observe(failedHandle);
    assert.equal(failedObservation.status, "failed");
    assert.match(failedObservation.stderr, /pi-subagents worker ended with failed/);
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
    process.env.PATH = previousPath;
    if (previousMarker === undefined) {
      delete process.env.AUTOPILOT_PI_ARGUMENTS;
    } else {
      process.env.AUTOPILOT_PI_ARGUMENTS = previousMarker;
    }
    if (previousStatus === undefined) {
      delete process.env.AUTOPILOT_PI_STATUS;
    } else {
      process.env.AUTOPILOT_PI_STATUS = previousStatus;
    }
  }
});
