import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { AutopilotError } from "./errors.js";
import { runChecked } from "./process.js";

export async function resolveStateRoot(repositoryRoot: string, override?: string): Promise<string> {
  if (override !== undefined) {
    const stateRoot = resolve(override);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    return await realpath(stateRoot);
  }
  const result = await runChecked({
    executable: "git",
    arguments: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: repositoryRoot,
  });
  const commonDirectory = result.stdout.trim();
  if (!isAbsolute(commonDirectory)) {
    throw new AutopilotError("GIT_FAILED", "git returned a non-absolute common directory");
  }
  const stateRoot = resolve(commonDirectory, "autopilot");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  return await realpath(stateRoot);
}

export function runDirectory(stateRoot: string, runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new AutopilotError("CHARTER_INVALID", "runId must be a safe path component of at most 128 characters");
  }
  return resolve(stateRoot, "runs", runId);
}
