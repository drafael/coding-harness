import { CliHarnessAdapter } from "../../src/adapter-process.js";
export function createClaudeCodeAdapter() {
    return new CliHarnessAdapter({
        name: "claude-code",
        executable: "claude",
        versionArguments: ["--version"],
        buildArguments: (request, prompt) => [
            "--print",
            "--output-format", "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--permission-mode", "dontAsk",
            "--allowed-tools", request.role === "review" ? "Read,Glob,Grep" : "Read,Edit,Write,Glob,Grep,Bash",
            "--disallowed-tools", "WebFetch,WebSearch",
            "--safe-mode",
            "--",
            prompt,
        ],
        assurance: "cooperative",
        maxConcurrency: 1,
        cancellation: true,
        limitations: [
            "Bash restrictions are cooperative.",
            "Safe mode excludes customizations; admin-managed policy may still apply.",
            "Implementation executions use the attempt-scoped supervisor for restart reattachment; review executions remain session-scoped.",
            "The exact-tree review role is implemented but has no version-pinned live verification.",
        ],
        expectsJsonLines: true,
    });
}
