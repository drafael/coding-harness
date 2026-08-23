import { createClaudeCodeAdapter } from "../adapters/claude-code/index.js";
import { createCodexAdapter } from "../adapters/codex/index.js";
import { createOpenCodeAdapter } from "../adapters/opencode/index.js";
import { createPiAdapter } from "../adapters/pi/index.js";
import { AutopilotError } from "./errors.js";
export function createAdapter(name) {
    switch (name) {
        case "pi":
            return createPiAdapter();
        case "claude-code":
            return createClaudeCodeAdapter();
        case "codex":
            return createCodexAdapter();
        case "opencode":
            return createOpenCodeAdapter();
        default:
            throw new AutopilotError("ADAPTER_UNSUPPORTED", `unknown harness adapter: ${name}`);
    }
}
