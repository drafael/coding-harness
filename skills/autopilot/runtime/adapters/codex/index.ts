import { CliHarnessAdapter } from "../../src/adapter-process.js";

export function createCodexAdapter(): CliHarnessAdapter {
  return new CliHarnessAdapter({
    name: "codex",
    executable: "codex",
    versionArguments: ["--version"],
    buildArguments: (request, prompt) => [
      "exec",
      "--json",
      "--ephemeral",
      "--strict-config",
      "--sandbox", request.role === "review" ? "read-only" : "workspace-write",
      "--cd", request.worktreePath,
      prompt,
    ],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [
      "Codex enforces a workspace sandbox, but Autopilot item-path and effect restrictions are checked after execution.",
      "Executions are ephemeral and cannot be reattached.",
      "The exact-tree review role is implemented but has no version-pinned live verification.",
    ],
    expectsJsonLines: true,
  });
}
