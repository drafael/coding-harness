import { isAbsolute, relative, resolve } from "node:path";
import { AutopilotError } from "./errors.js";
function pathWithin(candidate, root) {
    const child = resolve(candidate);
    const parent = resolve(root);
    const path = relative(parent, child);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
function matchesConstraints(request, grant) {
    if (request.path !== undefined && grant.paths !== undefined && !grant.paths.some((root) => pathWithin(request.path, root))) {
        return false;
    }
    if (request.executable !== undefined && grant.commands !== undefined && !grant.commands.includes(request.executable)) {
        return false;
    }
    if (request.repository !== undefined && grant.repositories !== undefined && !grant.repositories.includes(request.repository)) {
        return false;
    }
    if (request.remote !== undefined && grant.remotes !== undefined && !grant.remotes.includes(request.remote)) {
        return false;
    }
    if (request.branch !== undefined && grant.branchPrefixes !== undefined && !grant.branchPrefixes.some((prefix) => request.branch?.startsWith(prefix))) {
        return false;
    }
    if (request.environmentName !== undefined && grant.environmentNames !== undefined && !grant.environmentNames.includes(request.environmentName)) {
        return false;
    }
    return true;
}
export function authorizeEffect(request, playbookRequests, grants, adapter) {
    if (!playbookRequests.has(request.family)) {
        throw new AutopilotError("CAPABILITY_DENIED", `playbook did not request ${request.family}`);
    }
    if (!adapter.families.includes(request.family)) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", `active adapter does not support ${request.family}`);
    }
    const grant = grants.find((candidate) => candidate.family === request.family && candidate.actor === request.actor && matchesConstraints(request, candidate));
    if (grant === undefined) {
        throw new AutopilotError("CAPABILITY_DENIED", `${request.actor} lacks a matching ${request.family} grant`);
    }
    return grant;
}
