import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AutopilotError } from "./errors.js";
import { expectInteger, expectRecord, expectString, sha256 } from "./json.js";
import { writeJsonAtomic } from "./journal.js";
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error instanceof Error && "code" in error && error.code === "EPERM";
    }
}
function controlRequestPath(path, ownerToken, action) {
    return join(path, `${action}-${sha256(ownerToken)}.json`);
}
export function lockOwnerIsActive(owner) {
    return owner.host !== hostname() || processExists(owner.pid);
}
export async function readLockOwner(path) {
    try {
        const object = expectRecord(JSON.parse(await readFile(join(path, "owner.json"), "utf8")), "lock owner");
        return {
            host: expectString(object.host, "lock owner.host"),
            pid: expectInteger(object.pid, "lock owner.pid", 1),
            startedAt: expectString(object.startedAt, "lock owner.startedAt"),
            token: expectString(object.token, "lock owner.token"),
        };
    }
    catch {
        return undefined;
    }
}
export async function requestRunControl(path, runId, action) {
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
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return { status: "unowned" };
        }
        throw error;
    }
    const current = await readLockOwner(path);
    return current?.token === owner.token ? { status: "requested", owner } : { status: "unowned" };
}
export async function requestRunStop(path, runId) {
    return await requestRunControl(path, runId, "stop");
}
export async function requestRunPause(path, runId) {
    return await requestRunControl(path, runId, "pause");
}
async function createLock(path, owner) {
    await mkdir(path, { mode: 0o700 });
    try {
        await writeFile(join(path, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
    }
}
export async function acquireRunLock(path, resource = "run") {
    const owner = { host: hostname(), pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() };
    try {
        await createLock(path, owner);
    }
    catch (error) {
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
        }
        catch {
            throw new AutopilotError("LOCK_HELD", `${resource} lock changed while checking its stale owner`);
        }
        await rm(stalePath, { recursive: true, force: true });
        await createLock(path, owner);
    }
    let ownedPath = path;
    return {
        owner,
        async relocate(nextPath) {
            const current = await readLockOwner(nextPath);
            if (current?.token !== owner.token) {
                throw new AutopilotError("LOCK_HELD", "relocated run lock does not match its original owner");
            }
            ownedPath = nextPath;
        },
        async controlRequested(runId) {
            const requested = async (action) => {
                try {
                    const object = expectRecord(JSON.parse(await readFile(controlRequestPath(ownedPath, owner.token, action), "utf8")), `${action} request`);
                    return object.schemaVersion === 1
                        && (object.action === undefined || expectString(object.action, `${action} request.action`) === action)
                        && expectString(object.runId, `${action} request.runId`) === runId
                        && expectString(object.ownerToken, `${action} request.ownerToken`) === owner.token;
                }
                catch (error) {
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
        async stopRequested(runId) {
            try {
                const object = expectRecord(JSON.parse(await readFile(controlRequestPath(ownedPath, owner.token, "stop"), "utf8")), "stop request");
                return object.schemaVersion === 1
                    && expectString(object.runId, "stop request.runId") === runId
                    && expectString(object.ownerToken, "stop request.ownerToken") === owner.token;
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                    return false;
                }
                throw error;
            }
        },
        async assertOwned() {
            const current = await readLockOwner(ownedPath);
            if (current?.token !== owner.token) {
                throw new AutopilotError("LOCK_HELD", `${resource} lock ownership changed`, { owner: current });
            }
        },
        async release() {
            const current = await readLockOwner(ownedPath);
            if (current?.token === owner.token) {
                await rm(ownedPath, { recursive: true, force: true });
            }
        },
    };
}
export async function acquireBranchOwnershipLock(stateRoot, branchName) {
    const directory = join(stateRoot, "ownership");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return await acquireRunLock(join(directory, `${sha256(branchName)}.lock`), "managed branch");
}
