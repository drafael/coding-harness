import { createClaudeAgentSdkAdapter } from "../adapters/claude-agent-sdk/index.js";
import { createClaudeCodeAdapter } from "../adapters/claude-code/index.js";
import { createCodexAdapter, createCodexAppServerAdapter } from "../adapters/codex/index.js";
import { createOpenCodeAdapter, createOpenCodeServerAdapter } from "../adapters/opencode/index.js";
import { createPiAdapter } from "../adapters/pi/index.js";
import { AutopilotError } from "./errors.js";
export function createAdapter(name) {
    switch (name) {
        case "pi":
            return createPiAdapter();
        case "claude-code":
            return createClaudeCodeAdapter();
        case "claude-agent-sdk":
            return createClaudeAgentSdkAdapter();
        case "codex":
            return createCodexAdapter();
        case "codex-app-server":
            return createCodexAppServerAdapter();
        case "opencode":
            return createOpenCodeAdapter();
        case "opencode-server":
            return createOpenCodeServerAdapter();
        default:
            throw new AutopilotError("ADAPTER_UNSUPPORTED", `unknown harness adapter: ${name}`);
    }
}
