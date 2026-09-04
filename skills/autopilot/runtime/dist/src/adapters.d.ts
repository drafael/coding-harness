import type { HarnessPort } from "./adapter-protocol.js";
export type AdapterName = "pi" | "claude-code" | "claude-agent-sdk" | "codex" | "codex-app-server" | "opencode" | "opencode-server";
export declare function createAdapter(name: string): HarnessPort;
