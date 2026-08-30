import { access, chmod, copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptContext } from "../src/adapter-protocol.js";
import type { ProposedRunCharter, RunMode } from "../src/charter.js";
import { runChecked } from "../src/process.js";

export async function writeNodeExecutable(directory: string, name: string, script: string): Promise<string> {
  if (process.platform !== "win32") {
    const executable = join(directory, name);
    await writeFile(executable, script);
    await chmod(executable, 0o755);
    return executable;
  }

  const scriptPath = join(directory, `${name}.mjs`);
  const executable = join(directory, `${name}.exe`);
  const launcher = join(directory, "autopilot-node-launcher.exe");
  await writeFile(scriptPath, script);
  try {
    await access(launcher);
  } catch {
    const source = join(directory, "autopilot-node-launcher.cs");
    await writeFile(source, `
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

public static class AutopilotNodeLauncher {
  private static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\\t', '\\n', '\\v', '"' }) < 0) return value;
    var result = new StringBuilder("\\\"");
    var backslashes = 0;
    foreach (var character in value) {
      if (character == '\\\\') { backslashes += 1; continue; }
      if (character == '"') result.Append('\\\\', backslashes * 2 + 1);
      else result.Append('\\\\', backslashes);
      result.Append(character);
      backslashes = 0;
    }
    result.Append('\\\\', backslashes * 2).Append('"');
    return result.ToString();
  }

  public static int Main(string[] arguments) {
    var executable = Environment.GetEnvironmentVariable("AUTOPILOT_TEST_NODE_EXECUTABLE") ?? "node";
    var script = Path.ChangeExtension(Process.GetCurrentProcess().MainModule.FileName, ".mjs");
    var command = new StringBuilder(Quote(script));
    foreach (var argument in arguments) command.Append(' ').Append(Quote(argument));
    var process = Process.Start(new ProcessStartInfo(executable, command.ToString()) { UseShellExecute = false });
    process.WaitForExit();
    return process.ExitCode;
  }
}
`);
    const windowsDirectory = process.env.WINDIR ?? "C:\\Windows";
    const compiler = join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    await runChecked({ executable: compiler, arguments: ["/nologo", "/target:exe", `/out:${launcher}`, source], cwd: directory });
  }
  await copyFile(launcher, executable);
  process.env.AUTOPILOT_TEST_NODE_EXECUTABLE = process.execPath;
  return executable;
}

export function attemptContextFixture(attemptId = "attempt"): AttemptContext {
  return {
    schemaVersion: 1,
    charterHash: "charter-hash",
    sourceJournalSequence: 1,
    sourceJournalRecordHash: "record-hash",
    runId: "run",
    itemId: "item",
    attemptId,
    leaseEpoch: 1,
    expectedBaseCommit: "base-commit",
    currentTreeIdentity: "tree-identity",
    objective: "test",
    predicates: [{ type: "path-present", path: "result.txt" }],
    gates: [],
    dependencyCommits: [],
    evidence: [],
    priorFailures: [],
    reviewFindings: [],
    remainingAttempts: 1,
    remainingReplans: 0,
    attemptTimeoutMs: 10_000,
    idleTimeoutMs: 5_000,
    assumptions: [],
    writableRoots: ["."],
    grants: [],
    forbiddenEffects: ["commit"],
    requiredResult: ["summarize changed files"],
  };
}

export async function createRepository(): Promise<{ readonly root: string; readonly baseCommit: string }> {
  const root = await mkdtemp(join(tmpdir(), "autopilot-test-repo-"));
  await runChecked({ executable: "git", arguments: ["init", "-b", "main"], cwd: root });
  await runChecked({ executable: "git", arguments: ["config", "user.name", "Autopilot Test"], cwd: root });
  await runChecked({ executable: "git", arguments: ["config", "user.email", "autopilot@example.invalid"], cwd: root });
  await writeFile(join(root, "README.md"), "initial\n");
  await runChecked({ executable: "git", arguments: ["add", "README.md"], cwd: root });
  await runChecked({ executable: "git", arguments: ["commit", "-m", "initial"], cwd: root });
  const baseCommit = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: root })).stdout.trim();
  return { root, baseCommit };
}

export function proposedCharter(
  root: string,
  baseCommit: string,
  mode: RunMode = "single",
  runId = "run-12345678",
): ProposedRunCharter {
  const items = mode === "single"
    ? [{
        id: "item-1",
        title: "Create the result file",
        objective: "Create result.txt containing done",
        writableRoots: ["result.txt"],
        dependsOn: [],
        acceptance: [{ type: "gate-passed" as const, gateId: "result-search" }],
        branchName: `autopilot/${runId.slice(0, 8)}/item-1`,
      }]
    : ["one", "two"].map((name, index) => ({
        id: `item-${index + 1}`,
        title: `Create the ${name} result file`,
        objective: `Create ${name}.txt containing done`,
        writableRoots: [`${name}.txt`],
        dependsOn: mode === "ordered-stack" && index > 0 ? [`item-${index}`] : [],
        acceptance: [{ type: "search-count" as const, query: "done", paths: [`${name}.txt`], expectedCount: 1 }],
        branchName: `autopilot/${runId.slice(0, 8)}/${name}`,
      }));
  return {
    schemaVersion: 1,
    runId,
    sourceText: "Create the requested result files and verify them.",
    createdAt: "2026-08-22T00:00:00.000Z",
    repository: { root, baseRef: "main", baseCommit, writableRoots: ["."] },
    harnessAdapter: "pi",
    mode,
    work: items,
    delivery: "local-commits",
    grants: [
      { family: "files.read", actor: "worker", paths: [root] },
      { family: "files.write", actor: "worker", paths: [root] },
      { family: "process.execute", actor: "worker" },
      { family: "network.access", actor: "adapter" },
      { family: "credentials.use", actor: "adapter" },
      { family: "files.read", actor: "runtime", paths: [root] },
      { family: "git.commit", actor: "runtime", repositories: [root], branchPrefixes: ["autopilot/"] },
    ],
    gates: [{ id: "result-search", type: "search", query: "done", paths: ["result.txt"], expectedCount: 1, appliesTo: ["item-1"] }],
    waivers: [],
    limits: {
      maxAttemptsPerItem: 2,
      maxReplans: 0,
      maxParallel: 2,
      attemptTimeoutMs: 30_000,
      idleTimeoutMs: 5_000,
      maxAdapterLineBytes: 65_536,
      maxRetainedOutputBytes: 262_144,
    },
    assumptions: [],
    minimumAssurance: "cooperative",
    commitPolicy: { preCommitHook: "skip", writableRoots: [], environmentNames: [] },
    resolutionSources: { "work.*.branchName": "default", "repository.baseCommit": "repository" },
  };
}
