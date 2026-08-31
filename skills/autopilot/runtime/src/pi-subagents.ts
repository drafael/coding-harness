import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "./json.js";

export interface PiSubagentsInstallation {
  readonly extensionPath: string;
  readonly version: string;
}

export interface ProcessLocalEventBus {
  on(event: string, handler: (value: unknown) => void): () => void;
  emit(event: string, value: unknown): void;
}

const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";

const MINIMUM_MINOR_VERSION = 53;

function supportedVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (match === null) {
    return false;
  }
  const major = Number.parseInt(match[1] ?? "0", 10);
  const minor = Number.parseInt(match[2] ?? "0", 10);
  return major > 0 || minor >= MINIMUM_MINOR_VERSION;
}

function installationAt(extensionPath: string): PiSubagentsInstallation | undefined {
  if (!existsSync(extensionPath)) {
    return undefined;
  }
  try {
    const packageValue: unknown = JSON.parse(readFileSync(join(dirname(extensionPath), "package.json"), "utf8"));
    if (!isRecord(packageValue) || packageValue.name !== "pi-subagents" || typeof packageValue.version !== "string" || !supportedVersion(packageValue.version)) {
      return undefined;
    }
    return { extensionPath, version: packageValue.version };
  } catch {
    return undefined;
  }
}

export function findPiSubagentsInstallation(cwd = process.cwd()): PiSubagentsInstallation | undefined {
  const agentDirectory = process.env.PI_CODING_AGENT_DIR === undefined
    ? join(homedir(), ".pi", "agent")
    : resolve(process.env.PI_CODING_AGENT_DIR);
  const candidates = [
    join(agentDirectory, "npm", "node_modules", "pi-subagents", "index.ts"),
    join(cwd, "node_modules", "pi-subagents", "index.ts"),
  ];
  return candidates.map(installationAt).find((installation) => installation !== undefined);
}

export async function probePiSubagentsOwner(events: ProcessLocalEventBus, timeoutMs = 1_000): Promise<boolean> {
  const requestId = randomUUID();
  return await new Promise<boolean>((resolvePromise) => {
    let settled = false;
    const finish = (available: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolvePromise(available);
    };
    const unsubscribe = events.on(`${RPC_REPLY_PREFIX}${requestId}`, (value) => {
      const data = isRecord(value) && isRecord(value.data) ? value.data : undefined;
      finish(isRecord(value) && value.version === 1 && value.requestId === requestId && value.success === true
        && data?.version === 1 && Array.isArray(data.methods) && data.methods.includes("ping"));
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    try {
      events.emit(RPC_REQUEST_EVENT, { version: 1, requestId, method: "ping", params: {} });
    } catch {
      finish(false);
    }
  });
}
