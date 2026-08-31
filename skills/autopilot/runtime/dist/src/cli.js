#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createAdapter } from "./adapters.js";
import { loadAmendmentContext } from "./amendment.js";
import { sealCharter } from "./charter.js";
import { runDoctor } from "./doctor.js";
import { AutopilotEngine } from "./engine.js";
import { AutopilotError } from "./errors.js";
import { newEventId } from "./events.js";
import { recoverUnknownExecution, } from "./execution-recovery.js";
import { appendEvent, readJournal, repairTruncatedJournal, writeImmutableJson } from "./journal.js";
import { isRecord } from "./json.js";
import { acquireBranchOwnershipLock, acquireRunLock, requestRunPause, requestRunStop } from "./lock.js";
import { loadProjection, rebuildProjection, writeSnapshot } from "./projection.js";
import { reduce } from "./reducer.js";
import { branchExists, resolveCommit, validateBaseCommit, validateBranchName } from "./repository.js";
import { validateRestackSuccessor } from "./restack.js";
import { writeReports } from "./report.js";
import { observeReviewFeedback } from "./review-feedback.js";
import { discoverLifecycleRuns, locateStoredRun, } from "./run-discovery.js";
import { resolveStateRoot, runDirectory } from "./state-path.js";
import { discoverWrapUpRuns, wrapUpRun } from "./wrap-up.js";
const VERSION = "0.1.0";
let interrupted = false;
function usage() {
    return `Autopilot ${VERSION}

Usage:
  autopilot [--state-dir <path>] [--json] start <charter-file>
  autopilot [--state-dir <path>] [--json] status [run-id]
  autopilot [--state-dir <path>] [--json] [--repair-journal] resume [run-id]
  autopilot [--state-dir <path>] [--json] pause [run-id]
  autopilot [--state-dir <path>] [--json] stop [run-id]
  autopilot [--state-dir <path>] [--json] recover <run-id> --action <abandon|adopt|stop> --item <id> --attempt <id> --lease-epoch <n> --attestation <text> [--tree <tree>]
  autopilot [--state-dir <path>] [--json] review-feedback [run-id]
  autopilot [--state-dir <path>] [--json] [--handoff] wrap-up [run-id]
  autopilot [--json] doctor

The guaranteed copied-skill entry point is:
  node <skill-path>/runtime/dist/src/cli.js <command>
`;
}
function output(value, json) {
    if (json) {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    }
    else if (typeof value === "string") {
        process.stdout.write(`${value}\n`);
    }
    else {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    }
}
function formatStatusReport(report) {
    const items = report.continuity.items.map((item) => {
        const unmet = item.unmetPredicateIds.length === 0
            ? "none"
            : item.unmetPredicateIds.map((predicateId) => predicateId.slice(0, 12)).join(", ");
        return `- ${item.itemId}: ${item.state}; attempts left ${item.remainingAttempts}; replans left ${item.remainingReplans}; unmet ${unmet}`;
    });
    return [
        `Autopilot ${report.runId.slice(0, 12)}: ${report.state}`,
        `Last milestone: ${report.continuity.lastMilestone} at ${report.continuity.lastMilestoneAt}`,
        ...items,
        `Next: ${report.continuity.nextLegalAction}`,
        `Assurance: ${report.assurance}`,
    ].join("\n");
}
function isRunReport(value) {
    return isRecord(value) && value.schemaVersion === 1 && typeof value.runId === "string"
        && typeof value.state === "string" && isRecord(value.continuity) && Array.isArray(value.evidenceMap);
}
async function loadRun(runId, stateDirectory, repair) {
    const stateRoot = await resolveStateRoot(process.cwd(), stateDirectory);
    let location;
    try {
        location = await locateStoredRun(stateRoot, runId);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new AutopilotError("RUN_NOT_FOUND", `run not found: ${runId}`);
        }
        throw error;
    }
    const { directory, charter } = location;
    let journal = await readJournal(join(directory, "events.jsonl"));
    if (journal.truncatedTailBytes > 0) {
        if (!repair) {
            throw new AutopilotError("JOURNAL_TRUNCATED", "journal has an incomplete final record; resume with --repair-journal after inspecting it", {
                truncatedTailBytes: journal.truncatedTailBytes,
            });
        }
        await repairTruncatedJournal(join(directory, "events.jsonl"));
        journal = await readJournal(join(directory, "events.jsonl"));
    }
    return { stateRoot, directory, charter, journal };
}
async function runEngine(engine, lock, runId, captureProcessSignals) {
    const interrupt = () => {
        interrupted = true;
        void engine.requestStop();
    };
    let checkingControlRequest = false;
    let controlMonitorStopped = false;
    let controlMonitorFailureReported = false;
    let pendingControlCheck = Promise.resolve();
    const checkControlRequest = () => {
        if (checkingControlRequest || controlMonitorStopped) {
            return;
        }
        checkingControlRequest = true;
        pendingControlCheck = (async () => {
            try {
                const action = await lock.controlRequested(runId);
                if (action === "stop") {
                    controlMonitorStopped = true;
                    await engine.requestStop();
                }
                else if (action === "pause") {
                    await engine.requestPause();
                }
            }
            catch (error) {
                if (!controlMonitorFailureReported) {
                    controlMonitorFailureReported = true;
                    process.stderr.write(`Autopilot could not read the control request: ${error instanceof Error ? error.message : String(error)}\n`);
                }
            }
            finally {
                checkingControlRequest = false;
            }
        })();
    };
    const controlMonitor = setInterval(checkControlRequest, 100);
    controlMonitor.unref();
    checkControlRequest();
    if (captureProcessSignals) {
        process.once("SIGINT", interrupt);
        process.once("SIGTERM", interrupt);
    }
    try {
        return await engine.run();
    }
    finally {
        controlMonitorStopped = true;
        clearInterval(controlMonitor);
        await pendingControlCheck;
        if (captureProcessSignals) {
            process.removeListener("SIGINT", interrupt);
            process.removeListener("SIGTERM", interrupt);
        }
    }
}
async function start(charterFile, options, adapterFactory = createAdapter, captureProcessSignals = true) {
    let proposed;
    try {
        proposed = JSON.parse(await readFile(charterFile, "utf8"));
    }
    catch (error) {
        throw new AutopilotError("CHARTER_INVALID", `could not read proposed charter ${charterFile}`, { cause: String(error) });
    }
    const charter = sealCharter(proposed);
    const canonicalRoot = await realpath(charter.repository.root);
    if (canonicalRoot !== charter.repository.root) {
        throw new AutopilotError("CHARTER_INVALID", `repository.root must be its canonical real path: ${canonicalRoot}`);
    }
    if (charter.amends === undefined && charter.restack === undefined) {
        await validateBaseCommit(charter);
    }
    else if (await resolveCommit(charter.repository.root, charter.repository.baseCommit) !== charter.repository.baseCommit) {
        throw new AutopilotError("CHARTER_INVALID", "successor baseCommit must be a complete commit identity");
    }
    const stateRoot = await resolveStateRoot(charter.repository.root, options.stateDir);
    await validateRestackSuccessor(stateRoot, charter);
    const ownershipLock = charter.amends === undefined
        ? undefined
        : await acquireBranchOwnershipLock(stateRoot, charter.work[0]?.branchName ?? "");
    try {
        for (const item of charter.work) {
            await validateBranchName(charter.repository.root, item.branchName);
            if (charter.amends === undefined && charter.restack === undefined && await branchExists(charter.repository.root, item.branchName)) {
                throw new AutopilotError("BRANCH_COLLISION", `branch already exists before launch: ${item.branchName}`);
            }
        }
        await loadAmendmentContext(stateRoot, charter);
        const runsRoot = join(stateRoot, "runs");
        await mkdir(runsRoot, { recursive: true, mode: 0o700 });
        if (await realpath(runsRoot) !== runsRoot) {
            throw new AutopilotError("CAPABILITY_DENIED", "state runs directory must not be a symlink");
        }
        const directory = runDirectory(stateRoot, charter.runId);
        const temporaryDirectory = join(runsRoot, `.${charter.runId}.init.${randomUUID()}`);
        await mkdir(temporaryDirectory, { mode: 0o700 });
        let lock;
        let published = false;
        try {
            lock = await acquireRunLock(join(temporaryDirectory, "run.lock"));
            await mkdir(join(temporaryDirectory, "receipts"), { mode: 0o700 });
            await mkdir(join(temporaryDirectory, "reports"), { mode: 0o700 });
            await writeImmutableJson(join(temporaryDirectory, "charter.json"), charter);
            await appendEvent(join(temporaryDirectory, "events.jsonl"), {
                eventId: newEventId(),
                timestamp: new Date().toISOString(),
                source: "runtime",
                reason: "Proposed charter validated, resolved, and sealed",
                type: "CHARTER_COMPILED",
            });
            const initialJournal = await readJournal(join(temporaryDirectory, "events.jsonl"));
            await writeSnapshot(join(temporaryDirectory, "snapshot.json"), rebuildProjection(charter, initialJournal.records), initialJournal.records);
            await rename(temporaryDirectory, directory);
            published = true;
            await lock.relocate(join(directory, "run.lock"));
        }
        catch (error) {
            if (published && lock !== undefined) {
                await lock.relocate(join(directory, "run.lock"));
            }
            await lock?.release();
            await rm(published ? directory : temporaryDirectory, { recursive: true, force: true });
            if (error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY")) {
                throw new AutopilotError("CHARTER_INVALID", `run already exists: ${charter.runId}`);
            }
            throw error;
        }
        if (lock === undefined) {
            throw new AutopilotError("LOCK_HELD", "run lock was not established before publication");
        }
        try {
            const journal = await readJournal(join(directory, "events.jsonl"));
            const projection = rebuildProjection(charter, journal.records);
            await writeSnapshot(join(directory, "snapshot.json"), projection, journal.records);
            const engine = new AutopilotEngine({
                stateRoot,
                runDirectory: directory,
                charter,
                adapter: adapterFactory(charter.harnessAdapter),
                records: journal.records,
                projection,
            });
            return await runEngine(engine, lock, charter.runId, captureProcessSignals);
        }
        finally {
            await lock.release();
        }
    }
    finally {
        await ownershipLock?.release();
    }
}
async function loadReportMetadata(directory) {
    try {
        const value = JSON.parse(await readFile(join(directory, "reports", "status.json"), "utf8"));
        if (isRecord(value) && typeof value.assurance === "string" && Array.isArray(value.unverifiedBoundaries)
            && value.unverifiedBoundaries.every((entry) => typeof entry === "string")) {
            return { assurance: value.assurance, unverifiedBoundaries: value.unverifiedBoundaries };
        }
    }
    catch {
        // A missing or corrupt projection never changes canonical lifecycle state.
    }
    return { assurance: "unverified", unverifiedBoundaries: ["No prior adapter capability report is available."] };
}
async function selectLifecycleRun(operation, runId, options) {
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    if (runId !== undefined) {
        try {
            await locateStoredRun(stateRoot, runId);
            return runId;
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
        const discovery = await discoverLifecycleRuns(stateRoot, process.cwd(), operation);
        const matches = [...discovery.candidates, ...discovery.excluded]
            .filter((candidate) => candidate.shortId === runId || candidate.runId.startsWith(runId));
        if (matches.length === 1) {
            return matches[0]?.runId ?? runId;
        }
        if (matches.length > 1) {
            const matchingIds = new Set(matches.map(({ runId: matchingRunId }) => matchingRunId));
            return {
                ...discovery,
                candidates: discovery.candidates.filter(({ runId: candidateId }) => matchingIds.has(candidateId)),
                excluded: discovery.excluded.filter(({ runId: candidateId }) => matchingIds.has(candidateId)),
            };
        }
        return runId;
    }
    const discovery = await discoverLifecycleRuns(stateRoot, process.cwd(), operation);
    if (operation === "status" && discovery.corrupt.length > 0) {
        return discovery;
    }
    return discovery.candidates.length === 1 ? discovery.candidates[0]?.runId ?? discovery : discovery;
}
async function status(runId, options) {
    const selected = await selectLifecycleRun("status", runId, options);
    if (typeof selected !== "string") {
        return selected;
    }
    const run = await loadRun(selected, options.stateDir, false);
    const projection = rebuildProjection(run.charter, run.journal.records);
    const metadata = await loadReportMetadata(run.directory);
    return await writeReports(run.directory, run.charter, projection, run.journal.records, metadata.assurance, metadata.unverifiedBoundaries, false);
}
async function resume(runId, options, adapterFactory = createAdapter, captureProcessSignals = true) {
    const selected = await selectLifecycleRun("resume", runId, options);
    if (typeof selected !== "string") {
        return selected;
    }
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    const location = await locateStoredRun(stateRoot, selected);
    const ownershipLock = location.charter.amends === undefined
        ? undefined
        : await acquireBranchOwnershipLock(stateRoot, location.charter.work[0]?.branchName ?? "");
    try {
        const lock = await acquireRunLock(join(location.directory, "run.lock"));
        try {
            const run = await loadRun(selected, options.stateDir, options.repairJournal);
            const projection = await loadProjection(join(run.directory, "snapshot.json"), run.charter, run.journal.records);
            if (projection.state === "SUCCEEDED" || projection.state === "STOPPED") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `terminal run ${selected} cannot be resumed; create a successor charter`);
            }
            const engine = new AutopilotEngine({
                stateRoot: run.stateRoot,
                runDirectory: run.directory,
                charter: run.charter,
                adapter: adapterFactory(run.charter.harnessAdapter),
                records: run.journal.records,
                projection,
            });
            return await runEngine(engine, lock, run.charter.runId, captureProcessSignals);
        }
        finally {
            await lock.release();
        }
    }
    finally {
        await ownershipLock?.release();
    }
}
async function recover(runId, options, adapterFactory = createAdapter, captureProcessSignals = true) {
    if (runId === undefined || options.recoveryAction === undefined || options.recoveryItem === undefined
        || options.recoveryAttempt === undefined || options.recoveryLeaseEpoch === undefined
        || options.recoveryAttestation === undefined) {
        throw new AutopilotError("CHARTER_INVALID", "recover requires run ID, action, item, attempt, lease epoch, and attestation");
    }
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    const location = await locateStoredRun(stateRoot, runId);
    const ownershipLock = location.charter.amends === undefined
        ? undefined
        : await acquireBranchOwnershipLock(stateRoot, location.charter.work[0]?.branchName ?? "");
    try {
        const lock = await acquireRunLock(join(location.directory, "run.lock"));
        try {
            const run = await loadRun(runId, options.stateDir, false);
            const projection = rebuildProjection(run.charter, run.journal.records);
            const recovered = await recoverUnknownExecution(run.directory, run.charter, projection, lock, {
                action: options.recoveryAction,
                itemId: options.recoveryItem,
                attemptId: options.recoveryAttempt,
                leaseEpoch: options.recoveryLeaseEpoch,
                attestation: options.recoveryAttestation,
                ...(options.recoveryTree === undefined ? {} : { expectedTreeIdentity: options.recoveryTree }),
            });
            if (recovered.state === "STOPPED") {
                const journal = await readJournal(join(run.directory, "events.jsonl"));
                const metadata = await loadReportMetadata(run.directory);
                return await writeReports(run.directory, run.charter, recovered, journal.records, metadata.assurance, metadata.unverifiedBoundaries);
            }
            const journal = await readJournal(join(run.directory, "events.jsonl"));
            const engine = new AutopilotEngine({
                stateRoot: run.stateRoot,
                runDirectory: run.directory,
                charter: run.charter,
                adapter: adapterFactory(run.charter.harnessAdapter),
                records: journal.records,
                projection: recovered,
            });
            return await runEngine(engine, lock, run.charter.runId, captureProcessSignals);
        }
        finally {
            await lock.release();
        }
    }
    finally {
        await ownershipLock?.release();
    }
}
function coordinatorOptions(options) {
    return {
        json: true,
        repairJournal: options.repairJournal ?? false,
        handoff: false,
        ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    };
}
export async function startCoordinator(charterFile, options) {
    return await start(charterFile, coordinatorOptions(options), options.adapterFactory, false);
}
export async function resumeCoordinator(runId, options) {
    return await resume(runId, coordinatorOptions(options), options.adapterFactory, false);
}
export async function recoverCoordinator(runId, request, options) {
    return await recover(runId, {
        ...coordinatorOptions(options),
        recoveryAction: request.action,
        recoveryItem: request.itemId,
        recoveryAttempt: request.attemptId,
        recoveryLeaseEpoch: request.leaseEpoch,
        recoveryAttestation: request.attestation,
        ...(request.expectedTreeIdentity === undefined ? {} : { recoveryTree: request.expectedTreeIdentity }),
    }, options.adapterFactory, false);
}
async function reviewFeedback(runId, options) {
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    return await observeReviewFeedback(stateRoot, process.cwd(), runId);
}
async function wrapUp(runId, options) {
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    if (runId !== undefined) {
        return await wrapUpRun(stateRoot, runId, options.handoff);
    }
    const discovery = await discoverWrapUpRuns(stateRoot, process.cwd());
    if (discovery.candidates.length !== 1) {
        return discovery;
    }
    const candidate = discovery.candidates[0];
    if (candidate === undefined) {
        return discovery;
    }
    return await wrapUpRun(stateRoot, candidate.runId, options.handoff);
}
function formatLifecycleDiscovery(discovery) {
    const candidates = discovery.candidates.map((candidate) => `${candidate.shortId}\t${candidate.title}\t${candidate.state}\t${candidate.completedItems}/${candidate.totalItems}\t${candidate.updatedAt}\t${candidate.coordinator}`);
    const excluded = discovery.excluded.map((candidate) => `- ${candidate.shortId} ${candidate.title}: ${candidate.reason}`);
    const corrupt = discovery.corrupt.map(({ name, reason }) => `- ${name}: corrupt (${reason})`);
    if (candidates.length === 0) {
        return [`No unambiguous ${discovery.operation} candidate found.`, ...excluded, ...corrupt].join("\n");
    }
    return [
        `Run selection required for ${discovery.operation}; no action performed.`,
        "short-id\ttitle\tstate\tprogress\tupdated\tcoordinator",
        ...candidates,
        ...excluded,
        ...corrupt,
    ].join("\n");
}
function formatReviewFeedbackSelection(selection) {
    const rows = selection.candidates.map(({ shortId, title, updatedAt }) => `${shortId}\t${title}\t${updatedAt}`);
    const corrupt = selection.corrupt.map(({ name, reason }) => `- ${name}: corrupt (${reason})`);
    if (rows.length === 0) {
        return ["No unambiguous successful open review-feedback candidate found.", ...corrupt].join("\n");
    }
    return ["Run selection required for review feedback; no provider data read.", "short-id\ttitle\tupdated", ...rows, ...corrupt].join("\n");
}
function formatWrapUpDiscovery(discovery, options) {
    if (discovery.candidates.length === 0) {
        const excluded = discovery.excluded.map(({ runId, reason }) => `- ${runId}: ${reason}`);
        const corrupt = discovery.corrupt.map(({ name, reason }) => `- ${name}: corrupt (${reason})`);
        return ["No wrap-up candidates found.", ...excluded, ...corrupt].join("\n");
    }
    const rows = discovery.candidates.map((candidate) => `${candidate.runId}\t${candidate.completedAt}\t${candidate.mode}\t${candidate.provider}\t${candidate.itemCount} item(s)`);
    const prefix = `autopilot${options.stateDir === undefined ? "" : ` --state-dir ${JSON.stringify(options.stateDir)}`}${options.handoff ? " --handoff" : ""}`;
    const commands = discovery.candidates.map(({ runId }) => `${prefix} wrap-up ${runId}`);
    return ["Multiple wrap-up candidates; no cleanup performed.", "run-id\tcompleted\tmode\tprovider\titems", ...rows, "", ...commands].join("\n");
}
async function pause(runId, options) {
    const selected = await selectLifecycleRun("pause", runId, options);
    if (typeof selected !== "string") {
        return selected;
    }
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    const location = await locateStoredRun(stateRoot, selected);
    let lock;
    try {
        lock = await acquireRunLock(join(location.directory, "run.lock"));
    }
    catch (error) {
        if (!(error instanceof AutopilotError) || error.code !== "LOCK_HELD") {
            throw error;
        }
        const request = await requestRunPause(join(location.directory, "run.lock"), selected);
        if (request.status === "requested") {
            return {
                kind: "pause-requested",
                runId: selected,
                owner: { host: request.owner.host, pid: request.owner.pid, startedAt: request.owner.startedAt },
            };
        }
        lock = await acquireRunLock(join(location.directory, "run.lock"));
    }
    try {
        const run = await loadRun(selected, options.stateDir, false);
        const projection = rebuildProjection(run.charter, run.journal.records);
        if (projection.state === "SUCCEEDED" || projection.state === "STOPPED" || projection.waiting?.kind === "operator-pause") {
            const metadata = await loadReportMetadata(run.directory);
            return await writeReports(run.directory, run.charter, projection, run.journal.records, metadata.assurance, metadata.unverifiedBoundaries, false);
        }
        const engine = new AutopilotEngine({
            stateRoot: run.stateRoot,
            runDirectory: run.directory,
            charter: run.charter,
            adapter: createAdapter(run.charter.harnessAdapter),
            records: run.journal.records,
            projection,
        });
        await engine.requestPause();
        return await runEngine(engine, lock, run.charter.runId, true);
    }
    finally {
        await lock.release();
    }
}
async function stop(runId, options) {
    const selected = await selectLifecycleRun("stop", runId, options);
    if (typeof selected !== "string") {
        return selected;
    }
    const stateRoot = await resolveStateRoot(process.cwd(), options.stateDir);
    const location = await locateStoredRun(stateRoot, selected);
    let lock;
    try {
        lock = await acquireRunLock(join(location.directory, "run.lock"));
    }
    catch (error) {
        if (!(error instanceof AutopilotError) || error.code !== "LOCK_HELD") {
            throw error;
        }
        const request = await requestRunStop(join(location.directory, "run.lock"), selected);
        if (request.status === "requested") {
            return {
                kind: "stop-requested",
                runId: selected,
                owner: { host: request.owner.host, pid: request.owner.pid, startedAt: request.owner.startedAt },
            };
        }
        lock = await acquireRunLock(join(location.directory, "run.lock"));
    }
    try {
        const run = await loadRun(selected, options.stateDir, false);
        let projection = rebuildProjection(run.charter, run.journal.records);
        if (projection.state !== "SUCCEEDED" && projection.state !== "STOPPED") {
            const event = {
                eventId: newEventId(),
                timestamp: new Date().toISOString(),
                source: "operator",
                reason: "Operator requested a durable stop",
                type: "RUN_STOPPED",
                errorCode: "OPERATOR_STOP",
                remediation: "Inspect preserved worktrees and create a successor charter to continue with new authority or budgets.",
            };
            await appendEvent(join(run.directory, "events.jsonl"), event);
            projection = reduce(projection, event);
        }
        const journal = await readJournal(join(run.directory, "events.jsonl"));
        await writeSnapshot(join(run.directory, "snapshot.json"), projection, journal.records);
        const metadata = await loadReportMetadata(run.directory);
        return await writeReports(run.directory, run.charter, projection, journal.records, metadata.assurance, metadata.unverifiedBoundaries);
    }
    finally {
        await lock.release();
    }
}
export async function main(arguments_ = process.argv.slice(2)) {
    interrupted = false;
    const parsed = parseArgs({
        args: [...arguments_],
        allowPositionals: true,
        strict: true,
        options: {
            "state-dir": { type: "string" },
            json: { type: "boolean", default: false },
            "repair-journal": { type: "boolean", default: false },
            handoff: { type: "boolean", default: false },
            action: { type: "string" },
            item: { type: "string" },
            attempt: { type: "string" },
            "lease-epoch": { type: "string" },
            attestation: { type: "string" },
            tree: { type: "string" },
            help: { type: "boolean", short: "h", default: false },
            version: { type: "boolean", short: "v", default: false },
        },
    });
    if (parsed.values.help) {
        output(usage(), false);
        return 0;
    }
    if (parsed.values.version) {
        output(VERSION, false);
        return 0;
    }
    const [command, argument, ...extra] = parsed.positionals;
    if (command === undefined || extra.length > 0) {
        throw new AutopilotError("CHARTER_INVALID", usage());
    }
    const recoveryAction = parsed.values.action;
    if (recoveryAction !== undefined && !["abandon", "adopt", "stop"].includes(recoveryAction)) {
        throw new AutopilotError("CHARTER_INVALID", `unsupported recovery action: ${recoveryAction}`);
    }
    const recoveryLeaseEpochText = parsed.values["lease-epoch"];
    const recoveryLeaseEpoch = recoveryLeaseEpochText === undefined || !/^\d+$/u.test(recoveryLeaseEpochText)
        ? undefined
        : Number.parseInt(recoveryLeaseEpochText, 10);
    if (recoveryLeaseEpochText !== undefined
        && (recoveryLeaseEpoch === undefined || !Number.isSafeInteger(recoveryLeaseEpoch) || recoveryLeaseEpoch < 1)) {
        throw new AutopilotError("CHARTER_INVALID", "--lease-epoch must be a positive integer");
    }
    const options = {
        json: parsed.values.json,
        repairJournal: parsed.values["repair-journal"],
        handoff: parsed.values.handoff,
        ...(parsed.values["state-dir"] === undefined ? {} : { stateDir: parsed.values["state-dir"] }),
        ...(recoveryAction === undefined ? {} : { recoveryAction: recoveryAction }),
        ...(parsed.values.item === undefined ? {} : { recoveryItem: parsed.values.item }),
        ...(parsed.values.attempt === undefined ? {} : { recoveryAttempt: parsed.values.attempt }),
        ...(recoveryLeaseEpoch === undefined ? {} : { recoveryLeaseEpoch }),
        ...(parsed.values.attestation === undefined ? {} : { recoveryAttestation: parsed.values.attestation }),
        ...(parsed.values.tree === undefined ? {} : { recoveryTree: parsed.values.tree }),
    };
    let result;
    switch (command) {
        case "doctor":
            if (argument !== undefined) {
                throw new AutopilotError("CHARTER_INVALID", "doctor does not accept a positional argument");
            }
            result = await runDoctor();
            break;
        case "start":
            result = await start(argument ?? "", options);
            break;
        case "status":
            result = await status(argument, options);
            break;
        case "resume":
            result = await resume(argument, options);
            break;
        case "pause":
            result = await pause(argument, options);
            break;
        case "stop":
            result = await stop(argument, options);
            break;
        case "recover":
            result = await recover(argument, options);
            break;
        case "review-feedback":
            result = await reviewFeedback(argument, options);
            break;
        case "wrap-up":
            result = await wrapUp(argument, options);
            break;
        default:
            throw new AutopilotError("CHARTER_INVALID", `unknown command: ${command}\n\n${usage()}`);
    }
    if (!options.json && isRecord(result) && result.kind === "selection") {
        if (typeof result.operation === "string") {
            output(formatLifecycleDiscovery(result), false);
        }
        else {
            output(formatWrapUpDiscovery(result, options), false);
        }
    }
    else if (!options.json && isRecord(result) && result.kind === "review-feedback-selection") {
        output(formatReviewFeedbackSelection(result), false);
    }
    else if (!options.json && command === "status" && isRunReport(result)) {
        output(formatStatusReport(result), false);
    }
    else {
        output(result, options.json);
    }
    return interrupted ? 130 : 0;
}
const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPath)).href) {
    main().then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        if (error instanceof AutopilotError) {
            process.stderr.write(`${error.code}: ${error.message}\n`);
        }
        else {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
        process.exitCode = 1;
    });
}
