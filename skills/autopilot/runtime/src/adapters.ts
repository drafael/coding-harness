import { createClaudeCodeAdapter } from "../adapters/claude-code/index.js";
import { createCodexAdapter, createCodexAppServerAdapter } from "../adapters/codex/index.js";
import { createOpenCodeAdapter, createOpenCodeServerAdapter } from "../adapters/opencode/index.js";
import { createPiAdapter } from "../adapters/pi/index.js";
import type { HarnessPort } from "./adapter-protocol.js";
import { AutopilotError } from "./errors.js";

export type AdapterName = "pi" | "claude-code" | "codex" | "codex-app-server" | "opencode" | "opencode-server";

export function createAdapter(name: string): HarnessPort {
  switch (name) {
    case "pi":
      return createPiAdapter();
    case "claude-code":
      return createClaudeCodeAdapter();
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
