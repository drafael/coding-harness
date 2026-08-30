import { CliHarnessAdapter } from "../../src/adapter-process.js";
export function createOpenCodeAdapter() {
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
            "Executions cannot be reattached after restart.",
            "The exact-tree review role is cooperative and has no version-pinned live verification.",
        ],
        expectsJsonLines: true,
    });
}
