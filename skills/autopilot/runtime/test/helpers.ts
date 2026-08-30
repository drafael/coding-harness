import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptContext } from "../src/adapter-protocol.js";
import type { ProposedRunCharter, RunMode } from "../src/charter.js";
import { runChecked } from "../src/process.js";

export async function writeNodeExecutable(directory: string, name: string, script: string): Promise<string> {
  const executable = join(directory, process.platform === "win32" ? `${name}.js` : name);
  await writeFile(executable, script);
  if (process.platform === "win32") {
    await writeFile(join(directory, `${name}.cmd`), `@node "%~dp0${name}.js" %*\r\n`);
  } else {
    await chmod(executable, 0o755);
  }
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
