import type { ExecutionRequest } from "../../src/adapter-protocol.js";
import { CliHarnessAdapter } from "../../src/adapter-process.js";

function directArguments(request: ExecutionRequest, prompt: string): readonly string[] {
  return [
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--tools", request.role === "review" ? "read" : "read,bash,edit,write",
    "--approve",
    prompt,
  ];
}

export function createPiAdapter(): CliHarnessAdapter {
  return new CliHarnessAdapter({
    name: "pi",
    executable: "pi",
    versionArguments: ["--version"],
    buildArguments: directArguments,
    assurance: "cooperative",
    maxConcurrency: 1,
    cancellation: true,
    limitations: [
      "Pi runs through the direct CLI fallback because no owning process-local Autopilot extension backend was selected.",
      "Tool restrictions do not constrain commands executed through bash.",
      "POSIX implementation executions retain process-supervised terminality; Windows direct execution remains session-scoped.",
    ],
    expectsJsonLines: true,
    displayStderrActivity: true,
  });
}
