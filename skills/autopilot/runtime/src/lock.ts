import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { expectInteger, expectRecord, expectString, sha256 } from "./json.js";
import { writeJsonAtomic } from "./journal.js";

export interface LockOwner {
  readonly host: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly token: string;
}

export type ControlAction = "pause" | "stop";

export interface RunLock {
  readonly owner: LockOwner;
  relocate(path: string): Promise<void>;
  controlRequested(runId: string): Promise<ControlAction | undefined>;
  stopRequested(runId: string): Promise<boolean>;
  release(): Promise<void>;
}

export type ControlRequestResult =
  | { readonly status: "requested"; readonly owner: LockOwner }
  | { readonly status: "unowned" };

export type StopRequestResult = ControlRequestResult;

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function controlRequestPath(path: string, ownerToken: string, action: ControlAction): string {
  return join(path, `${action}-${sha256(ownerToken)}.json`);
}

export function lockOwnerIsActive(owner: LockOwner): boolean {
  return owner.host !== hostname() || processExists(owner.pid);
}

export async function readLockOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const object = expectRecord(JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as unknown, "lock owner");
    return {
      host: expectString(object.host, "lock owner.host"),
      pid: expectInteger(object.pid, "lock owner.pid", 1),
      startedAt: expectString(object.startedAt, "lock owner.startedAt"),
      token: expectString(object.token, "lock owner.token"),
    };
  } catch {
    return undefined;
  }
}

export async function requestRunControl(path: string, runId: string, action: ControlAction): Promise<ControlRequestResult> {
  const owner = await readLockOwner(path);
  if (owner === undefined || !lockOwnerIsActive(owner)) {
    return { status: "unowned" };
  }
  try {
    await writeJsonAtomic(controlRequestPath(path, owner.token, action), {
      schemaVersion: 1,
      action,
      runId,
      ownerToken: owner.token,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { status: "unowned" };
    }
    throw error;
  }
  const current = await readLockOwner(path);
  return current?.token === owner.token ? { status: "requested", owner } : { status: "unowned" };
}

export async function requestRunStop(path: string, runId: string): Promise<StopRequestResult> {
  return await requestRunControl(path, runId, "stop");
}

export async function requestRunPause(path: string, runId: string): Promise<ControlRequestResult> {
  return await requestRunControl(path, runId, "pause");
}

async function createLock(path: string, owner: LockOwner): Promise<void> {
  await mkdir(path, { mode: 0o700 });
  try {
    await writeFile(join(path, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

export async function acquireRunLock(path: string, resource = "run"): Promise<RunLock> {
  const owner: LockOwner = { host: hostname(), pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() };
  try {
    await createLock(path, owner);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const existing = await readLockOwner(path);
    if (existing === undefined || existing.host !== owner.host || processExists(existing.pid)) {
      throw new AutopilotError("LOCK_HELD", `another coordinator owns this ${resource}`, { owner: existing });
    }
    const stalePath = `${path}.stale.${owner.token}`;
    try {
      await rename(path, stalePath);
    } catch {
      throw new AutopilotError("LOCK_HELD", `${resource} lock changed while checking its stale owner`);
    }
    await rm(stalePath, { recursive: true, force: true });
    await createLock(path, owner);
  }

  let ownedPath = path;
  return {
    owner,
    async relocate(nextPath: string): Promise<void> {
      const current = await readLockOwner(nextPath);
      if (current?.token !== owner.token) {
        throw new AutopilotError("LOCK_HELD", "relocated run lock does not match its original owner");
      }
      ownedPath = nextPath;
    },
    async controlRequested(runId: string): Promise<ControlAction | undefined> {
      const requested = async (action: ControlAction): Promise<boolean> => {
        try {
          const object = expectRecord(
            JSON.parse(await readFile(controlRequestPath(ownedPath, owner.token, action), "utf8")) as unknown,
            `${action} request`,
          );
          return object.schemaVersion === 1
            && (object.action === undefined || expectString(object.action, `${action} request.action`) === action)
            && expectString(object.runId, `${action} request.runId`) === runId
            && expectString(object.ownerToken, `${action} request.ownerToken`) === owner.token;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
          }
          throw error;
        }
      };
      if (await requested("stop")) {
        return "stop";
      }
      return await requested("pause") ? "pause" : undefined;
    },
    async stopRequested(runId: string): Promise<boolean> {
      try {
        const object = expectRecord(
          JSON.parse(await readFile(controlRequestPath(ownedPath, owner.token, "stop"), "utf8")) as unknown,
          "stop request",
        );
        return object.schemaVersion === 1
          && expectString(object.runId, "stop request.runId") === runId
          && expectString(object.ownerToken, "stop request.ownerToken") === owner.token;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return false;
        }
        throw error;
      }
    },
    async release(): Promise<void> {
      const current = await readLockOwner(ownedPath);
      if (current?.token === owner.token) {
        await rm(ownedPath, { recursive: true, force: true });
      }
    },
  };
}

export async function acquireBranchOwnershipLock(stateRoot: string, branchName: string): Promise<RunLock> {
  const directory = join(stateRoot, "ownership");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return await acquireRunLock(join(directory, `${sha256(branchName)}.lock`), "managed branch");
}
