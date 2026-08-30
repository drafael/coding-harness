import { fileURLToPath } from "node:url";
import { CliHarnessAdapter } from "../../src/adapter-process.js";
import { isRecord } from "../../src/json.js";
import { findPiSubagentsInstallation } from "../../src/pi-subagents.js";
function directArguments(request, prompt) {
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
function subagentArguments(request, prompt, installation) {
    const payload = {
        runId: request.runId,
        itemId: request.itemId,
        task: prompt,
        timeoutMs: Math.min(2_147_483_647, Math.max(1, Date.parse(request.deadline) - Date.now())),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const bridgePath = fileURLToPath(new URL("./bridge.js", import.meta.url));
    return [
        "--mode", "json",
        "--print",
        "--no-session",
        "--no-extensions",
        "--extension", installation.extensionPath,
        "--extension", bridgePath,
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-tools",
        "--approve",
        `/autopilot-worker ${encoded}`,
    ];
}
function validateSubagentResult(stdout) {
    for (const line of stdout.split("\n")) {
        if (line === "") {
            continue;
        }
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!isRecord(value) || value.type !== "message_end" || !isRecord(value.message)
            || value.message.customType !== "autopilot-subagent-result" || !isRecord(value.message.details)) {
            continue;
        }
        const status = value.message.details.status;
        return status === "completed" ? undefined : `pi-subagents worker ended with ${typeof status === "string" ? status : "unknown status"}`;
    }
    return "pi-subagents worker did not emit a terminal result";
}
export function createPiAdapter() {
    const installation = findPiSubagentsInstallation();
    const usingSubagents = installation !== undefined;
    return new CliHarnessAdapter({
        name: "pi",
        executable: "pi",
        versionArguments: ["--version"],
        buildArguments: (request, prompt) => installation === undefined || request.role === "review"
            ? directArguments(request, prompt)
            : subagentArguments(request, prompt, installation),
        assurance: "cooperative",
        maxConcurrency: 1,
        cancellation: true,
        limitations: [
            "Tool restrictions do not constrain commands executed through bash.",
            "Executions cannot be reattached after coordinator restart.",
            "The direct exact-tree review role is implemented but has no version-pinned live verification.",
            usingSubagents
                ? `Pi workers use the pi-subagents ${installation.version} structured delegation API.`
                : "pi-subagents 0.53.0 or newer was not found; Pi workers run directly without subagent activity integration.",
        ],
        expectsJsonLines: true,
        ...(usingSubagents ? { validateResult: validateSubagentResult } : {}),
        displayStderrActivity: true,
    });
}
