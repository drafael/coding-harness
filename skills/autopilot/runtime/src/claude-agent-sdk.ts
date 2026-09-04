import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { runProcess } from "./process.js";
import { isRecord } from "./json.js";

export const CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT = "AUTOPILOT_CLAUDE_AGENT_SDK_ROOT";
export const CLAUDE_AGENT_SDK_CLI_ENVIRONMENT = "AUTOPILOT_CLAUDE_AGENT_SDK_CLI";
export const MINIMUM_CLAUDE_AGENT_SDK_VERSION = "0.3.246";

const CLAUDE_AGENT_SDK_SCRIPT_SUFFIXES = [".js", ".mjs", ".tsx", ".ts", ".jsx"] as const;

export interface ClaudeAgentSdkInstallation {
  readonly root: string;
  readonly modulePath: string;
  readonly cliPath: string;
  readonly sdkVersion: string;
  readonly claudeCodeVersion: string;
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (match === null) {
    return undefined;
  }
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts as unknown as readonly [number, number, number] : undefined;
}

export function isClaudeAgentSdkScriptCli(cliPath: string): boolean {
  return CLAUDE_AGENT_SDK_SCRIPT_SUFFIXES.some((suffix) => cliPath.endsWith(suffix));
}

export function isSupportedClaudeAgentSdkVersion(value: string): boolean {
  const actual = parseVersion(value);
  const minimum = parseVersion(MINIMUM_CLAUDE_AGENT_SDK_VERSION);
  if (actual === undefined || minimum === undefined) {
    return false;
  }
  for (const index of [0, 1, 2] as const) {
    if (actual[index] !== minimum[index]) {
      return actual[index] > minimum[index];
    }
  }
  return true;
}

export async function inspectClaudeAgentSdkInstallation(
  rootValue = process.env[CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT],
  cliValue = process.env[CLAUDE_AGENT_SDK_CLI_ENVIRONMENT],
): Promise<ClaudeAgentSdkInstallation> {
  if (rootValue === undefined || rootValue.length === 0 || cliValue === undefined || cliValue.length === 0) {
    throw new AutopilotError(
      "ADAPTER_UNSUPPORTED",
      `${CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT} and ${CLAUDE_AGENT_SDK_CLI_ENVIRONMENT} must name an operator-provided Agent SDK and Claude Code executable`,
    );
  }
  let root: string;
  let cliPath: string;
  try {
    [root, cliPath] = await Promise.all([realpath(rootValue), realpath(cliValue)]);
    const [, , cliStat] = await Promise.all([
      access(join(root, "sdk.mjs"), constants.R_OK),
      access(cliPath, constants.R_OK | constants.X_OK),
      stat(cliPath),
    ]);
    if (!cliStat.isFile()) {
      throw new Error("the supplied Claude Code executable is not a regular file");
    }
  } catch (error) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied Agent SDK root or Claude Code executable is unavailable", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const packagePath = join(root, "package.json");
  const modulePath = join(root, "sdk.mjs");
  let packageValue: unknown;
  try {
    packageValue = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  } catch (error) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied Agent SDK package metadata is unavailable", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(packageValue)
    || packageValue.name !== "@anthropic-ai/claude-agent-sdk"
    || typeof packageValue.version !== "string"
    || typeof packageValue.claudeCodeVersion !== "string") {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied package is not a compatible Claude Agent SDK");
  }
  if (!isSupportedClaudeAgentSdkVersion(packageValue.version)) {
    throw new AutopilotError(
      "ADAPTER_UNSUPPORTED",
      `Claude Agent SDK ${packageValue.version} is older than ${MINIMUM_CLAUDE_AGENT_SDK_VERSION}`,
    );
  }
  try {
    const scriptCli = isClaudeAgentSdkScriptCli(cliPath);
    const versionResult = await runProcess({
      executable: scriptCli ? process.execPath : cliPath,
      arguments: scriptCli ? [cliPath, "--version"] : ["--version"],
      cwd: root,
      timeoutMs: 5_000,
      idleTimeoutMs: 5_000,
      maxOutputBytes: 16_384,
    });
    const observedVersion = /(?:^|[^\d])v?(\d+\.\d+\.\d+)(?:[^\d]|$)/u.exec(`${versionResult.stdout}\n${versionResult.stderr}`)?.[1];
    if (versionResult.exitCode !== 0 || observedVersion !== packageValue.claudeCodeVersion) {
      throw new Error("the supplied Claude Code executable version does not match the Agent SDK package");
    }
  } catch (error) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "the supplied Claude Code executable version could not be verified", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    root,
    modulePath,
    cliPath,
    sdkVersion: packageValue.version,
    claudeCodeVersion: packageValue.claudeCodeVersion,
  };
}
