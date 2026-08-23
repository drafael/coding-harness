import type { HarnessPort } from "./adapter-protocol.js";
export type AdapterName = "pi" | "claude-code" | "codex" | "opencode";
export declare function createAdapter(name: string): HarnessPort;
