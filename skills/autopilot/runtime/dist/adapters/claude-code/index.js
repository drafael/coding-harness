import { CliHarnessAdapter } from "../../src/adapter-process.js";
import { isClaudeAgentSdkScriptCli } from "../../src/claude-agent-sdk.js";
export function createClaudeCodeAdapter(executable = "claude") {
    const scriptCli = isClaudeAgentSdkScriptCli(executable);
    const argumentPrefix = scriptCli ? [executable] : [];
    return new CliHarnessAdapter({
        name: "claude-code",
        executable: scriptCli ? process.execPath : executable,
        versionArguments: [...argumentPrefix, "--version"],
        buildArguments: (request, prompt) => [
            ...argumentPrefix,
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
            "Version 2.1.251 passed a disposable exact-tree review without changing HEAD, Git configuration, or global Claude configuration.",
        ],
        expectsJsonLines: true,
    });
}
