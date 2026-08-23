import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "./json.js";

export interface PiSubagentsInstallation {
  readonly extensionPath: string;
  readonly version: string;
}

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
