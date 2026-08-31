import { CliHarnessAdapter } from "../../src/adapter-process.js";
import { CodexAppServerAdapter } from "./app-server.js";
export function createCodexAdapter() {
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
            "Implementation executions use the attempt-scoped supervisor for restart reattachment; review executions remain session-scoped.",
            "The exact-tree review role passed disposable validation with Codex 0.151.0; other versions remain environment-specific.",
        ],
        expectsJsonLines: true,
    });
}
export function createCodexAppServerAdapter() {
    return new CodexAppServerAdapter({
        executable: "codex",
        reviewAdapter: createCodexAdapter(),
    });
}
