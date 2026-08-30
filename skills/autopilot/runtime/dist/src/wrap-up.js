import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createDeliveryAdapter } from "./delivery-adapters.js";
import { projectPredicateEvidence } from "./evidence-map.js";
import { AutopilotError } from "./errors.js";
import { newEventId } from "./events.js";
import { appendEvent, readJournal } from "./journal.js";
import { canonicalJson, isRecord, sha256 } from "./json.js";
import { readLease } from "./leases.js";
import { acquireBranchOwnershipLock, acquireRunLock } from "./lock.js";
import { rebuildProjection } from "./projection.js";
import { assertRegisteredWorktree, branchExists, currentBranch, inspectRepository, remoteBranchCommit, resolveCommit, resolveWorktreePath, } from "./repository.js";
import { runChecked, runProcess } from "./process.js";
import { loadAvailableRuns, loadStoredRun } from "./run-discovery.js";
import { runDirectory } from "./state-path.js";
async function pathExists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
function confirmedState(records, itemId, effect) {
    return records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === effect ? [event.observedState] : []).at(-1);
}
function changeRequestState(records, itemId) {
    return records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === itemId
        && (event.effect === "change-request.open" || event.effect === "change-request.update")
        ? [event.observedState]
        : []).at(-1);
}
function changeRequestRef(provider, url) {
    const id = url.replace(/\/+$/u, "").split("/").at(-1);
    if (id === undefined || id.length === 0) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "recorded change request has no provider identifier");
    }
    return { provider, id, url };
}
function runSucceeded(run) {
    return rebuildProjection(run.charter, run.records).state === "SUCCEEDED";
}
async function cleanWrapUpTrash(stateRoot) {
    const lock = await acquireRunLock(join(stateRoot, "wrap-up-trash.lock"), "wrap-up trash");
    try {
        const trashRoot = join(stateRoot, "wrap-up-trash");
        if (!await pathExists(trashRoot)) {
            return;
        }
        const status = await lstat(trashRoot);
        if (!status.isDirectory() || status.isSymbolicLink() || await realpath(trashRoot) !== trashRoot) {
            throw new AutopilotError("CAPABILITY_DENIED", "wrap-up trash root is not a canonical directory");
        }
        for (const entry of await readdir(trashRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink()
                || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.[0-9a-f-]{36}$/u.test(entry.name)) {
                throw new AutopilotError("CAPABILITY_DENIED", `unexpected wrap-up trash entry: ${entry.name}`);
            }
            await rm(join(trashRoot, entry.name), { recursive: true, force: true });
        }
    }
    finally {
        await lock.release();
    }
}
export async function discoverWrapUpRuns(stateRoot, repositoryRoot) {
    await cleanWrapUpTrash(stateRoot);
    const topLevel = (await runChecked({
        executable: "git",
        arguments: ["rev-parse", "--show-toplevel"],
        cwd: repositoryRoot,
    })).stdout.trim();
    const canonicalRepository = await realpath(topLevel);
    const { runs, corrupt, supersededRunIds } = await loadAvailableRuns(stateRoot);
    const repositoryRuns = runs.filter(({ charter }) => charter.repository.root === canonicalRepository);
    const candidates = [];
    const excluded = [];
    for (const run of repositoryRuns) {
        const projection = rebuildProjection(run.charter, run.records);
        const target = run.charter.deliveryTarget;
        let reason;
        if (supersededRunIds.has(run.charter.runId)) {
            reason = "superseded by a retained amendment successor";
        }
        else if (projection.state !== "SUCCEEDED") {
            reason = `run state is ${projection.state}`;
        }
        else if (run.charter.delivery === "local-commits" || target === undefined) {
            reason = "run has no provider change request";
        }
        if (reason !== undefined || target === undefined) {
            excluded.push({ runId: run.charter.runId, reason: reason ?? "run has no delivery target" });
            continue;
        }
        const completedAt = run.records.findLast(({ event }) => event.type === "RUN_SUCCEEDED")?.event.timestamp
            ?? run.charter.createdAt;
        candidates.push({
            runId: run.charter.runId,
            completedAt,
            mode: run.charter.mode,
            itemCount: run.charter.work.length,
            branches: run.charter.work.map(({ branchName }) => branchName),
            provider: target.provider,
            changeRequests: run.charter.work.flatMap(({ id }) => {
                const url = changeRequestState(run.records, id);
                return url === undefined ? [] : [url];
            }),
        });
    }
    candidates.sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.runId.localeCompare(right.runId));
    if (corrupt.length > 0 && candidates.length > 0) {
        excluded.push(...candidates.map(({ runId }) => ({
            runId,
            reason: "corrupt retained state prevents automatic destructive selection",
        })));
        candidates.length = 0;
    }
    return { kind: "selection", candidates, excluded, corrupt };
}
async function loadAmendmentChain(stateRoot, target) {
    const chain = [target];
    const seen = new Set([target.charter.runId]);
    let current = target;
    while (current.charter.amends !== undefined) {
        const predecessorId = current.charter.amends.runId;
        if (seen.has(predecessorId)) {
            throw new AutopilotError("JOURNAL_CORRUPT", "amendment chain contains a cycle");
        }
        const predecessor = await loadStoredRun(stateRoot, predecessorId);
        if (!runSucceeded(predecessor)) {
            throw new AutopilotError("ILLEGAL_TRANSITION", `amendment predecessor ${predecessorId} is not successful`);
        }
        const currentItem = current.charter.work[0];
        const predecessorItem = predecessor.charter.work.find(({ id }) => id === current.charter.amends?.itemId);
        if (predecessor.charter.repository.root !== target.charter.repository.root
            || currentItem === undefined || predecessorItem === undefined
            || currentItem.branchName !== predecessorItem.branchName
            || canonicalJson(current.charter.deliveryTarget) !== canonicalJson(predecessor.charter.deliveryTarget)) {
            throw new AutopilotError("CHARTER_TAMPERED", "amendment chain changed repository, branch, or delivery identity");
        }
        chain.push(predecessor);
        seen.add(predecessorId);
        current = predecessor;
    }
    return chain;
}
async function latestLeafCheck(stateRoot, runId) {
    const { corrupt, supersededRunIds } = await loadAvailableRuns(stateRoot);
    if (corrupt.length > 0) {
        throw new AutopilotError("JOURNAL_CORRUPT", "corrupt retained run state prevents destructive wrap-up", { corrupt });
    }
    if (supersededRunIds.has(runId)) {
        throw new AutopilotError("ILLEGAL_TRANSITION", `run ${runId} has a retained amendment successor`);
    }
}
async function resolveItemCleanup(stateRoot, run, item) {
    const target = run.charter.deliveryTarget;
    if (target === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "wrap-up requires a provider delivery target");
    }
    const acceptedCommit = confirmedState(run.records, item.id, "remote.push");
    const changeRequestUrl = changeRequestState(run.records, item.id);
    if (acceptedCommit === undefined || changeRequestUrl === undefined) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `item ${item.id} has incomplete delivery evidence`);
    }
    const adoptedPath = run.records.flatMap(({ event }) => event.type === "WORKTREE_ADOPTED" && event.itemId === item.id ? [event.worktreePath] : []).at(-1);
    const lease = adoptedPath === undefined ? await readLease(run.directory, item.id) : undefined;
    const legacyRoot = join(stateRoot, "worktrees");
    const leasePath = lease?.itemId === item.id && lease.branchName === item.branchName ? lease.worktreePath : undefined;
    const leaseRelation = leasePath === undefined ? undefined : relative(legacyRoot, leasePath);
    const legacyLeaseWorktree = leasePath !== undefined && leaseRelation !== undefined && leaseRelation !== ""
        && !leaseRelation.startsWith("..") && !isAbsolute(leaseRelation);
    return {
        item,
        acceptedCommit,
        changeRequest: changeRequestRef(target.provider, changeRequestUrl),
        worktreePath: adoptedPath ?? (legacyLeaseWorktree ? leasePath : undefined) ?? await resolveWorktreePath(run.charter, item),
        legacyLeaseWorktree,
    };
}
async function validateRetainedWorktree(run, cleanup) {
    if (!await pathExists(cleanup.worktreePath)) {
        return;
    }
    if (await realpath(cleanup.worktreePath) !== cleanup.worktreePath) {
        throw new AutopilotError("CAPABILITY_DENIED", `worktree for ${cleanup.item.id} is not canonical`);
    }
    await assertRegisteredWorktree(run.charter.repository.root, cleanup.worktreePath);
    const [repository, branch] = await Promise.all([
        inspectRepository(cleanup.worktreePath),
        currentBranch(cleanup.worktreePath),
    ]);
    if (!repository.clean || repository.headCommit !== cleanup.acceptedCommit || branch !== cleanup.item.branchName) {
        throw new AutopilotError("BRANCH_COLLISION", `worktree for ${cleanup.item.id} is dirty or changed after merge`);
    }
}
async function isAncestor(repositoryRoot, ancestor, descendant) {
    const result = await runProcess({
        executable: "git",
        arguments: ["merge-base", "--is-ancestor", ancestor, descendant],
        cwd: repositoryRoot,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new AutopilotError("GIT_FAILED", "could not compare legacy wrap-up commit ancestry", { stderr: result.stderr });
    }
    return result.exitCode === 0;
}
async function preflightItem(run, cleanup) {
    const target = run.charter.deliveryTarget;
    if (target === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "wrap-up requires a provider delivery target");
    }
    const provider = createDeliveryAdapter(target.provider);
    const changeRequest = await provider.observeChangeRequest(run.charter.repository.root, cleanup.changeRequest);
    const predecessorId = cleanup.item.dependsOn.at(-1);
    const predecessor = predecessorId === undefined
        ? undefined
        : run.charter.work.find(({ id }) => id === predecessorId);
    const expectedBaseBranch = run.charter.mode === "ordered-stack"
        && run.charter.delivery === "change-request-ready" && predecessor !== undefined
        ? predecessor.branchName
        : target.baseBranch;
    const sameChangeRequest = changeRequest.ref.provider === cleanup.changeRequest.provider
        && changeRequest.ref.id === cleanup.changeRequest.id
        && changeRequest.ref.url.replace(/\/+$/u, "") === cleanup.changeRequest.url.replace(/\/+$/u, "");
    const legacyFastForward = cleanup.legacyLeaseWorktree && changeRequest.headCommit !== cleanup.acceptedCommit
        && await isAncestor(run.charter.repository.root, cleanup.acceptedCommit, changeRequest.headCommit);
    const effectiveCleanup = legacyFastForward
        ? { ...cleanup, acceptedCommit: changeRequest.headCommit }
        : cleanup;
    if (!sameChangeRequest || changeRequest.state !== "merged" || changeRequest.headCommit !== effectiveCleanup.acceptedCommit
        || changeRequest.baseBranch !== expectedBaseBranch) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `change request for ${cleanup.item.id} is not merged at the accepted head`, {
            state: changeRequest.state,
            expectedHead: effectiveCleanup.acceptedCommit,
            observedHead: changeRequest.headCommit,
            expectedBase: expectedBaseBranch,
            observedBase: changeRequest.baseBranch,
        });
    }
    const remoteCommit = await remoteBranchCommit(run.charter.repository.root, target.remote, cleanup.item.branchName);
    if (remoteCommit !== undefined && remoteCommit !== effectiveCleanup.acceptedCommit) {
        throw new AutopilotError("BRANCH_COLLISION", `remote branch for ${cleanup.item.id} moved after merge`);
    }
    if (await branchExists(run.charter.repository.root, cleanup.item.branchName)) {
        const localCommit = await resolveCommit(run.charter.repository.root, cleanup.item.branchName);
        if (localCommit !== effectiveCleanup.acceptedCommit) {
            throw new AutopilotError("BRANCH_COLLISION", `local branch for ${cleanup.item.id} moved after merge`);
        }
    }
    await validateRetainedWorktree(run, effectiveCleanup);
    return effectiveCleanup;
}
function effectKey(runId, itemId, effect) {
    return sha256(`${runId}\0${itemId ?? "run"}\0${effect}`);
}
async function recordEffect(run, itemId, effect, expectedState, action) {
    const journalPath = join(run.directory, "events.jsonl");
    let records = (await readJournal(journalPath)).records;
    const key = effectKey(run.charter.runId, itemId, effect);
    const intended = records.some(({ event }) => event.type === "EFFECT_INTENDED" && event.effect === effect && event.itemId === itemId && event.idempotencyKey === key);
    if (!intended) {
        await appendEvent(journalPath, {
            eventId: newEventId(),
            timestamp: new Date().toISOString(),
            source: "operator",
            reason: `Wrap-up intends ${effect}`,
            type: "EFFECT_INTENDED",
            ...(itemId === undefined ? {} : { itemId }),
            effect,
            idempotencyKey: key,
            expectedState,
        });
    }
    const observedState = await action();
    records = (await readJournal(journalPath)).records;
    if (!records.some(({ event }) => event.type === "EFFECT_CONFIRMED" && event.effect === effect && event.itemId === itemId && event.idempotencyKey === key)) {
        await appendEvent(journalPath, {
            eventId: newEventId(),
            timestamp: new Date().toISOString(),
            source: "operator",
            reason: `Wrap-up confirmed ${effect}`,
            type: "EFFECT_CONFIRMED",
            ...(itemId === undefined ? {} : { itemId }),
            effect,
            idempotencyKey: key,
            observedState,
        });
    }
    return observedState;
}
async function deleteRemoteBranch(run, cleanup) {
    const target = run.charter.deliveryTarget;
    if (target === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "wrap-up requires a provider delivery target");
    }
    const current = await remoteBranchCommit(run.charter.repository.root, target.remote, cleanup.item.branchName);
    if (current === undefined) {
        return "absent";
    }
    if (current !== cleanup.acceptedCommit) {
        throw new AutopilotError("BRANCH_COLLISION", `remote branch ${cleanup.item.branchName} changed before deletion`);
    }
    await runChecked({
        executable: "git",
        arguments: [
            "push",
            `--force-with-lease=refs/heads/${cleanup.item.branchName}:${cleanup.acceptedCommit}`,
            target.remote,
            `:refs/heads/${cleanup.item.branchName}`,
        ],
        cwd: run.charter.repository.root,
    });
    if (await remoteBranchCommit(run.charter.repository.root, target.remote, cleanup.item.branchName) !== undefined) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `remote branch ${cleanup.item.branchName} still exists after deletion`);
    }
    return "absent";
}
async function removeWorktree(run, cleanup) {
    if (!await pathExists(cleanup.worktreePath)) {
        return "absent";
    }
    await validateRetainedWorktree(run, cleanup);
    await runChecked({
        executable: "git",
        arguments: ["worktree", "remove", cleanup.worktreePath],
        cwd: run.charter.repository.root,
    });
    return "absent";
}
async function deleteLocalBranch(run, cleanup) {
    if (!await branchExists(run.charter.repository.root, cleanup.item.branchName)) {
        return "absent";
    }
    const current = await resolveCommit(run.charter.repository.root, cleanup.item.branchName);
    if (current !== cleanup.acceptedCommit) {
        throw new AutopilotError("BRANCH_COLLISION", `local branch ${cleanup.item.branchName} changed before deletion`);
    }
    await runChecked({
        executable: "git",
        arguments: ["update-ref", "-d", `refs/heads/${cleanup.item.branchName}`, cleanup.acceptedCommit],
        cwd: run.charter.repository.root,
    });
    return "absent";
}
async function handoffObject(run, chainRunIds, cleanups) {
    const decisions = run.records.flatMap(({ event }) => event.type === "DECISION_RECORDED"
        ? [{ decision: event.decision, basis: event.basis, timestamp: event.timestamp }]
        : []);
    const receipts = run.records.flatMap(({ event }) => event.type === "RECEIPT_RECORDED"
        ? [{ itemId: event.itemId, receiptId: event.receiptId, gateId: event.gateId, receiptKind: event.receiptKind, status: event.status }]
        : []);
    const projection = rebuildProjection(run.charter, run.records);
    const evidenceMap = await projectPredicateEvidence(run.directory, run.charter, projection, run.records);
    let assurance = "unverified";
    let unverifiedBoundaries = ["No prior adapter capability report is available."];
    try {
        const report = JSON.parse(await readFile(join(run.directory, "reports", "status.json"), "utf8"));
        if (isRecord(report) && typeof report.assurance === "string" && Array.isArray(report.unverifiedBoundaries)
            && report.unverifiedBoundaries.every((entry) => typeof entry === "string")) {
            assurance = report.assurance;
            unverifiedBoundaries = report.unverifiedBoundaries;
        }
    }
    catch {
        // The journal remains authoritative when the report projection is unavailable.
    }
    const completedAt = run.records.findLast(({ event }) => event.type === "RUN_SUCCEEDED")?.event.timestamp
        ?? run.charter.createdAt;
    return {
        schemaVersion: 1,
        generatedAt: completedAt,
        runId: run.charter.runId,
        repository: run.charter.repository.root,
        mode: run.charter.mode,
        objective: run.charter.sourceText,
        lineage: chainRunIds,
        items: cleanups.map(({ item, acceptedCommit, changeRequest }) => ({
            id: item.id,
            title: item.title,
            objective: item.objective,
            branchName: item.branchName,
            acceptedCommit,
            changeRequest: changeRequest.url,
            state: projection.items[item.id]?.state ?? "PENDING",
            attempts: projection.items[item.id]?.attempts.length ?? 0,
            acceptance: item.acceptance,
        })),
        gates: run.charter.gates,
        waivers: run.charter.waivers,
        commitPolicy: run.charter.commitPolicy,
        receipts,
        evidenceMap,
        decisions,
        assurance,
        unverifiedBoundaries,
        cleanup: {
            remoteBranches: cleanups.map(({ item }) => item.branchName),
            worktrees: cleanups.map(({ worktreePath }) => worktreePath),
            localBranches: cleanups.map(({ item }) => item.branchName),
            deletedRunIds: chainRunIds,
        },
    };
}
function handoffMarkdown(handoff, cleanups) {
    const runId = String(handoff.runId);
    const lineage = Array.isArray(handoff.lineage) ? handoff.lineage.map(String).join(" → ") : runId;
    const items = cleanups.map(({ item, acceptedCommit, changeRequest }) => `- **${item.title ?? item.id}** — \`${acceptedCommit}\` — ${changeRequest.url}`).join("\n");
    return `# Autopilot handoff: ${runId}\n\n- Repository: \`${String(handoff.repository)}\`\n- Mode: \`${String(handoff.mode)}\`\n- Lineage: ${lineage}\n- Cleanup: remote branches, sibling worktrees, local branches, and canonical run state removed\n\n## Objective\n\n${String(handoff.objective)}\n\n## Items\n\n${items}\n`;
}
async function assertSafeHandoffRoot(repositoryRoot) {
    const projectDirectory = join(repositoryRoot, ".autopilot");
    const handoffDirectory = join(projectDirectory, "handoffs");
    for (const path of [projectDirectory, handoffDirectory]) {
        try {
            const status = await lstat(path);
            if (!status.isDirectory() || status.isSymbolicLink()) {
                throw new AutopilotError("CAPABILITY_DENIED", `handoff directory is not a normal directory: ${path}`);
            }
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
    }
    return handoffDirectory;
}
async function writeIfAbsentOrEqual(path, content) {
    try {
        const existing = await readFile(path, "utf8");
        if (existing !== content) {
            throw new AutopilotError("CAPABILITY_DENIED", `handoff path already exists with different content: ${path}`);
        }
        return;
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
        }
    }
    const directory = dirname(path);
    if (await realpath(directory) !== directory) {
        throw new AutopilotError("CAPABILITY_DENIED", "handoff directory changed identity before publication");
    }
    const directoryBefore = await lstat(directory);
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) {
        throw new AutopilotError("CAPABILITY_DENIED", "handoff directory is not a stable directory");
    }
    const temporary = `${path}.tmp.${randomUUID()}`;
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
        await link(temporary, path);
        const directoryAfter = await lstat(directory);
        if (!directoryAfter.isDirectory() || directoryAfter.isSymbolicLink()
            || directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino
            || await realpath(directory) !== directory) {
            throw new AutopilotError("CAPABILITY_DENIED", "handoff directory changed identity during publication");
        }
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            const existing = await readFile(path, "utf8");
            if (existing === content) {
                return;
            }
            throw new AutopilotError("CAPABILITY_DENIED", `handoff path was concurrently created: ${path}`);
        }
        throw error;
    }
    finally {
        try {
            const directoryCurrent = await lstat(directory);
            if (directoryCurrent.isDirectory() && !directoryCurrent.isSymbolicLink()
                && directoryCurrent.dev === directoryBefore.dev && directoryCurrent.ino === directoryBefore.ino) {
                await rm(temporary, { force: true });
            }
        }
        catch {
            // A changed parent is left untouched rather than risking path-based deletion outside the captured directory.
        }
    }
}
async function prepareHandoff(run, chainRunIds, cleanups) {
    const directory = await assertSafeHandoffRoot(run.charter.repository.root);
    const handoff = await handoffObject(run, chainRunIds, cleanups);
    return {
        paths: [join(directory, `${run.charter.runId}.json`), join(directory, `${run.charter.runId}.md`)],
        contents: [`${JSON.stringify(handoff, null, 2)}\n`, handoffMarkdown(handoff, cleanups)],
    };
}
async function validatePreparedHandoff(handoff) {
    for (const [index, path] of handoff.paths.entries()) {
        if (await pathExists(path) && await readFile(path, "utf8") !== handoff.contents[index]) {
            throw new AutopilotError("CAPABILITY_DENIED", `handoff path already exists with different content: ${path}`);
        }
    }
}
async function writeHandoff(run, handoff) {
    const directory = await assertSafeHandoffRoot(run.charter.repository.root);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) {
        throw new AutopilotError("CAPABILITY_DENIED", "handoff directory traverses a symlink");
    }
    for (const [index, path] of handoff.paths.entries()) {
        const content = handoff.contents[index];
        if (content === undefined) {
            throw new AutopilotError("JOURNAL_CORRUPT", "prepared handoff content is incomplete");
        }
        await writeIfAbsentOrEqual(path, content);
    }
    return handoff.paths;
}
async function acquireLocks(stateRoot, chainRunIds, branches) {
    const locks = [];
    try {
        for (const runId of [...chainRunIds].sort()) {
            const directory = runDirectory(stateRoot, runId);
            if (await pathExists(directory)) {
                if (await realpath(directory) !== directory) {
                    throw new AutopilotError("CAPABILITY_DENIED", `wrap-up run directory is not canonical: ${runId}`);
                }
                locks.push(await acquireRunLock(join(directory, "run.lock"), `wrap-up run ${runId}`));
            }
        }
        for (const branch of [...new Set(branches)].sort()) {
            locks.push(await acquireBranchOwnershipLock(stateRoot, branch));
        }
        return locks;
    }
    catch (error) {
        await Promise.all(locks.reverse().map(async (lock) => await lock.release()));
        throw error;
    }
}
function wrapUpStarted(run) {
    const event = run.records.findLast(({ event }) => event.type === "WRAP_UP_STARTED")?.event;
    return event?.type === "WRAP_UP_STARTED" ? event : undefined;
}
async function recordWrapUpStarted(run, chainRunIds, handoff) {
    if (wrapUpStarted(run) !== undefined) {
        return;
    }
    await appendEvent(join(run.directory, "events.jsonl"), {
        eventId: newEventId(),
        timestamp: new Date().toISOString(),
        source: "operator",
        reason: "Provider-merged run passed complete wrap-up preflight",
        type: "WRAP_UP_STARTED",
        chainRunIds,
        handoff,
    });
}
async function removeCanonicalRunDirectory(stateRoot, runId) {
    const lock = await acquireRunLock(join(stateRoot, "wrap-up-trash.lock"), "wrap-up trash");
    try {
        const directory = runDirectory(stateRoot, runId);
        if (!await pathExists(directory)) {
            return;
        }
        const runsRoot = await realpath(join(stateRoot, "runs"));
        if (await realpath(directory) !== directory || dirname(directory) !== runsRoot) {
            throw new AutopilotError("CAPABILITY_DENIED", `wrap-up run directory changed identity: ${runId}`);
        }
        const trashRoot = join(stateRoot, "wrap-up-trash");
        await mkdir(trashRoot, { recursive: true, mode: 0o700 });
        const trashBefore = await lstat(trashRoot);
        if (!trashBefore.isDirectory() || trashBefore.isSymbolicLink() || await realpath(trashRoot) !== trashRoot) {
            throw new AutopilotError("CAPABILITY_DENIED", "wrap-up trash root changed identity");
        }
        const trashPath = join(trashRoot, `${runId}.${randomUUID()}`);
        const trashAtRename = await lstat(trashRoot);
        if (!trashAtRename.isDirectory() || trashAtRename.isSymbolicLink()
            || trashAtRename.dev !== trashBefore.dev || trashAtRename.ino !== trashBefore.ino) {
            throw new AutopilotError("CAPABILITY_DENIED", "wrap-up trash root changed before state removal");
        }
        await rename(directory, trashPath);
        const trashAfter = await lstat(trashRoot);
        if (!trashAfter.isDirectory() || trashAfter.isSymbolicLink()
            || trashAfter.dev !== trashBefore.dev || trashAfter.ino !== trashBefore.ino) {
            throw new AutopilotError("CAPABILITY_DENIED", "wrap-up trash root changed during state removal");
        }
        await rm(trashPath, { recursive: true, force: true });
    }
    finally {
        await lock.release();
    }
}
export async function wrapUpRun(stateRoot, runId, handoff) {
    await cleanWrapUpTrash(stateRoot);
    await latestLeafCheck(stateRoot, runId);
    let target = await loadStoredRun(stateRoot, runId);
    if (!runSucceeded(target)) {
        throw new AutopilotError("ILLEGAL_TRANSITION", `wrap-up requires a successful run: ${runId}`);
    }
    if (target.charter.delivery === "local-commits" || target.charter.deliveryTarget === undefined) {
        throw new AutopilotError("UNSUPPORTED_CAPABILITY", "wrap-up requires a GitHub or GitLab change request");
    }
    const priorStart = wrapUpStarted(target);
    const initialChain = priorStart === undefined ? await loadAmendmentChain(stateRoot, target) : undefined;
    const chainRunIds = priorStart?.chainRunIds ?? initialChain?.map(({ charter }) => charter.runId) ?? [runId];
    if (chainRunIds[0] !== runId || new Set(chainRunIds).size !== chainRunIds.length) {
        throw new AutopilotError("JOURNAL_CORRUPT", "wrap-up chain identity is invalid");
    }
    if (priorStart !== undefined && priorStart.handoff !== handoff) {
        throw new AutopilotError("CAPABILITY_DENIED", "wrap-up must resume with the original handoff policy");
    }
    const locks = await acquireLocks(stateRoot, chainRunIds, target.charter.work.map(({ branchName }) => branchName));
    try {
        await latestLeafCheck(stateRoot, runId);
        target = await loadStoredRun(stateRoot, runId);
        const started = wrapUpStarted(target);
        if (started !== undefined && (canonicalJson(started.chainRunIds) !== canonicalJson(chainRunIds) || started.handoff !== handoff)) {
            throw new AutopilotError("JOURNAL_CORRUPT", "wrap-up identity changed after locking");
        }
        if (started === undefined) {
            const lockedChain = await loadAmendmentChain(stateRoot, target);
            if (canonicalJson(lockedChain.map(({ charter }) => charter.runId)) !== canonicalJson(chainRunIds)) {
                throw new AutopilotError("BRANCH_COLLISION", "amendment chain changed during wrap-up locking");
            }
        }
        const proposedCleanups = await Promise.all(target.charter.work.map(async (item) => await resolveItemCleanup(stateRoot, target, item)));
        const cleanups = [];
        for (const cleanup of proposedCleanups) {
            cleanups.push(await preflightItem(target, cleanup));
        }
        const preparedHandoff = handoff ? await prepareHandoff(target, chainRunIds, cleanups) : undefined;
        if (preparedHandoff !== undefined) {
            await validatePreparedHandoff(preparedHandoff);
        }
        await recordWrapUpStarted(target, chainRunIds, handoff);
        const deletedRemoteBranches = [];
        const removedWorktrees = [];
        const deletedLocalBranches = [];
        for (const cleanup of cleanups) {
            await recordEffect(target, cleanup.item.id, "remote.branch.delete", cleanup.acceptedCommit, async () => await deleteRemoteBranch(target, cleanup));
            deletedRemoteBranches.push(cleanup.item.branchName);
        }
        for (const cleanup of cleanups) {
            await recordEffect(target, cleanup.item.id, "git.worktree.remove", cleanup.worktreePath, async () => await removeWorktree(target, cleanup));
            removedWorktrees.push(cleanup.worktreePath);
        }
        for (const cleanup of cleanups) {
            await recordEffect(target, cleanup.item.id, "git.branch.delete", cleanup.acceptedCommit, async () => await deleteLocalBranch(target, cleanup));
            deletedLocalBranches.push(cleanup.item.branchName);
        }
        const handoffPaths = preparedHandoff === undefined
            ? []
            : await writeHandoff(target, preparedHandoff);
        if (preparedHandoff !== undefined) {
            await recordEffect(target, undefined, "handoff.write", runId, async () => handoffPaths.join(","));
        }
        const predecessorRunIds = chainRunIds.slice(1).reverse();
        for (const predecessorRunId of predecessorRunIds) {
            await removeCanonicalRunDirectory(stateRoot, predecessorRunId);
        }
        await removeCanonicalRunDirectory(stateRoot, runId);
        return {
            kind: "completed",
            runId,
            deletedRunIds: chainRunIds,
            deletedRemoteBranches,
            removedWorktrees,
            deletedLocalBranches,
            handoffPaths,
        };
    }
    finally {
        await Promise.all([...locks].reverse().map(async (lock) => await lock.release()));
    }
}
