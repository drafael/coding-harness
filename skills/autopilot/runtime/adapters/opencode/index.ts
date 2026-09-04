import { CliHarnessAdapter } from "../../src/adapter-process.js";
import { OpenCodeServerAdapter } from "./server.js";

export function createOpenCodeAdapter(): CliHarnessAdapter {
  return new CliHarnessAdapter({
    name: "opencode",
    executable: "opencode",
    versionArguments: ["--version"],
    buildArguments: (request, prompt) => [
      "run",
      "--format", "json",
      "--pure",
      "--auto",
      "--dir", request.worktreePath,
      prompt,
    ],
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [
      "Auto-approved tool restrictions are cooperative.",
      "Implementation executions use the attempt-scoped supervisor for restart reattachment; review executions remain session-scoped.",
      "The exact-tree review role is cooperative and has no version-pinned live verification.",
    ],
    expectsJsonLines: true,
  });
}

export function createOpenCodeServerAdapter(): OpenCodeServerAdapter {
  return new OpenCodeServerAdapter({
    executable: "opencode",
    reviewAdapter: createOpenCodeAdapter(),
  });
}
