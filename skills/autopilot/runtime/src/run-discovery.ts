import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunCharter } from "./charter.js";
import { parseSealedCharter } from "./charter.js";
import { AutopilotError } from "./errors.js";
import { readJournal, type JournalRecord } from "./journal.js";
import { canonicalJson } from "./json.js";
import { lockOwnerIsActive, readLockOwner } from "./lock.js";
import { rebuildProjection } from "./projection.js";
import type { RunProjection, RunState } from "./reducer.js";
import { runChecked } from "./process.js";
import { runDirectory } from "./state-path.js";

export interface StoredRunLocation {
  readonly directory: string;
  readonly charter: RunCharter;
}

export interface StoredRun extends StoredRunLocation {
  readonly records: readonly JournalRecord[];
  readonly projection: RunProjection;
}

export interface CorruptRun {
  readonly name: string;
  readonly reason: string;
}

export interface AvailableRuns {
  readonly runs: readonly StoredRun[];
  readonly corrupt: readonly CorruptRun[];
  readonly supersededRunIds: ReadonlySet<string>;
}

export type CoordinatorState = "active" | "inactive" | "unknown";
export type LifecycleOperation = "status" | "resume" | "pause" | "stop";

export interface LifecycleCandidate {
  readonly runId: string;
  readonly shortId: string;
  readonly title: string;
  readonly state: RunState;
  readonly coordinator: CoordinatorState;
  readonly completedItems: number;
  readonly totalItems: number;
  readonly updatedAt: string;
  readonly mode: RunCharter["mode"];
}

export interface LifecycleExclusion extends LifecycleCandidate {
  readonly reason: string;
}

export interface LifecycleDiscovery {
  readonly kind: "selection";
  readonly operation: LifecycleOperation;
  readonly candidates: readonly LifecycleCandidate[];
  readonly excluded: readonly LifecycleExclusion[];
  readonly corrupt: readonly CorruptRun[];
}

async function listRunEntries(stateRoot: string): Promise<{
  readonly names: readonly string[];
  readonly corrupt: readonly CorruptRun[];
}> {
  try {
    const names: string[] = [];
    const corrupt: CorruptRun[] = [];
    (await readdir(join(stateRoot, "runs"), { withFileTypes: true })).forEach((entry) => {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        names.push(entry.name);
      } else {
        corrupt.push({ name: entry.name, reason: "run entry is not a direct directory" });
      }
    });
    names.sort();
    corrupt.sort((left, right) => left.name.localeCompare(right.name));
    return { names, corrupt };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { names: [], corrupt: [] };
    }
    throw error;
  }
}

export async function locateStoredRun(stateRoot: string, runId: string): Promise<StoredRunLocation> {
  const directory = runDirectory(stateRoot, runId);
  const canonical = await realpath(directory);
  const runsRoot = await realpath(join(stateRoot, "runs"));
  if (canonical !== directory || dirname(canonical) !== runsRoot) {
    throw new AutopilotError("CAPABILITY_DENIED", `run ${runId} is not a canonical child of the state root`);
  }
  const charter = parseSealedCharter(JSON.parse(await readFile(join(directory, "charter.json"), "utf8")) as unknown);
  if (charter.runId !== runId) {
    throw new AutopilotError("CHARTER_TAMPERED", `run directory ${runId} contains charter ${charter.runId}`);
  }
  return { directory, charter };
}

export async function loadStoredRun(stateRoot: string, runId: string): Promise<StoredRun> {
  const location = await locateStoredRun(stateRoot, runId);
  const journal = await readJournal(join(location.directory, "events.jsonl"));
  if (journal.truncatedTailBytes > 0) {
    throw new AutopilotError("JOURNAL_TRUNCATED", `run ${runId} has an incomplete journal tail`);
  }
  const projection = rebuildProjection(location.charter, journal.records);
  return { ...location, records: journal.records, projection };
}

function cyclicRunIds(runs: readonly StoredRun[]): ReadonlySet<string> {
  const byId = new Map(runs.map((run) => [run.charter.runId, run]));
  const cyclic = new Set<string>();
  for (const run of runs) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: StoredRun | undefined = run;
    while (current !== undefined) {
      const runId = current.charter.runId;
      const previousPosition = positions.get(runId);
      if (previousPosition !== undefined) {
        path.slice(previousPosition).forEach((id) => cyclic.add(id));
        break;
      }
      positions.set(runId, path.length);
      path.push(runId);
      const predecessorId: string | undefined = current.charter.amends?.runId;
      current = predecessorId === undefined ? undefined : byId.get(predecessorId);
    }
  }
  return cyclic;
}

function confirmedEffect(run: StoredRun, itemId: string, effect: string): string | undefined {
  return run.records.flatMap(({ event }) =>
    event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === effect
      ? [event.observedState]
      : []
  ).at(-1);
}

function missingPredecessorIsWrapUpRecovery(run: StoredRun, predecessorId: string): boolean {
  return run.records.some(({ event }) =>
    event.type === "WRAP_UP_STARTED"
    && event.chainRunIds.includes(run.charter.runId)
    && event.chainRunIds.includes(predecessorId)
  );
}

function amendmentIssue(successor: StoredRun, predecessor: StoredRun): string | undefined {
  const reference = successor.charter.amends;
  const successorItem = successor.charter.work[0];
  const predecessorItem = reference === undefined
    ? undefined
    : predecessor.charter.work.find(({ id }) => id === reference.itemId);
  if (predecessor.projection.state !== "SUCCEEDED") {
    return "amendment predecessor is not successful";
  }
  if (successor.charter.repository.root !== predecessor.charter.repository.root) {
    return "amendment predecessor belongs to another repository";
  }
  if (successorItem === undefined || predecessorItem === undefined || successorItem.branchName !== predecessorItem.branchName) {
    return "amendment changed its item or branch identity";
  }
  if (successor.charter.delivery !== "change-request-ready" || predecessor.charter.delivery !== "change-request-ready"
    || canonicalJson(successor.charter.deliveryTarget) !== canonicalJson(predecessor.charter.deliveryTarget)) {
    return "amendment changed its delivery identity";
  }
  if (reference === undefined) {
    return "amendment reference is missing";
  }
  const remoteCommit = confirmedEffect(predecessor, reference.itemId, "remote.push");
  const changeRequest = confirmedEffect(predecessor, reference.itemId, "change-request.open")
    ?? confirmedEffect(predecessor, reference.itemId, "change-request.update");
  if (remoteCommit === undefined || changeRequest === undefined) {
    return "amendment predecessor lacks confirmed remote delivery evidence";
  }
  if (successor.charter.repository.baseCommit !== remoteCommit) {
    return "amendment base commit does not match the predecessor remote commit";
  }
  return undefined;
}

export async function loadAvailableRuns(stateRoot: string): Promise<AvailableRuns> {
  const entries = await listRunEntries(stateRoot);
  const loaded: StoredRun[] = [];
  const corrupt: CorruptRun[] = [...entries.corrupt];
  for (const name of entries.names) {
    try {
      loaded.push(await loadStoredRun(stateRoot, name));
    } catch (error) {
      corrupt.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const cyclic = cyclicRunIds(loaded);
  cyclic.forEach((runId) => corrupt.push({ name: runId, reason: "amendment chain contains a cycle" }));
  const acyclic = loaded.filter(({ charter }) => !cyclic.has(charter.runId));
  const byId = new Map(acyclic.map((run) => [run.charter.runId, run]));
  const invalidSuccessors = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    acyclic.forEach((run) => {
      if (invalidSuccessors.has(run.charter.runId) || run.charter.amends === undefined) {
        return;
      }
      const predecessorId = run.charter.amends.runId;
      const predecessor = byId.get(predecessorId);
      const issue = predecessor === undefined
        ? missingPredecessorIsWrapUpRecovery(run, predecessorId) ? undefined : "amendment predecessor state is missing"
        : invalidSuccessors.has(predecessorId)
          ? "amendment predecessor state is corrupt"
          : amendmentIssue(run, predecessor);
      if (issue !== undefined) {
        invalidSuccessors.add(run.charter.runId);
        corrupt.push({ name: run.charter.runId, reason: issue });
        changed = true;
      }
    });
  }
  const runs = acyclic.filter(({ charter }) => !invalidSuccessors.has(charter.runId));
  const validIds = new Set(runs.map(({ charter }) => charter.runId));
  const supersededRunIds = new Set(runs.flatMap(({ charter }) =>
    charter.amends !== undefined && validIds.has(charter.amends.runId) ? [charter.amends.runId] : []
  ));
  corrupt.sort((left, right) => left.name.localeCompare(right.name));
  return { runs, corrupt, supersededRunIds };
}

async function canonicalRepositoryRoot(repositoryRoot: string): Promise<string> {
  const topLevel = (await runChecked({
    executable: "git",
    arguments: ["rev-parse", "--show-toplevel"],
    cwd: repositoryRoot,
  })).stdout.trim();
  return await realpath(topLevel);
}

async function coordinatorState(directory: string): Promise<CoordinatorState> {
  const lockPath = join(directory, "run.lock");
  try {
    const status = await lstat(lockPath);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      return "unknown";
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "inactive";
    }
    throw error;
  }
  const owner = await readLockOwner(lockPath);
  if (owner === undefined) {
    return "unknown";
  }
  return lockOwnerIsActive(owner) ? "active" : "inactive";
}

function runTitle(charter: RunCharter): string {
  const first = charter.work[0];
  if (first?.title === undefined) {
    return charter.runId;
  }
  return charter.work.length === 1 ? first.title : `${first.title} (+${charter.work.length - 1} more)`;
}

function shortIds(runIds: readonly string[]): ReadonlyMap<string, string> {
  return new Map(runIds.map((runId) => {
    let length = Math.min(8, runId.length);
    while (length < runId.length && runIds.some((candidate) => candidate !== runId && candidate.startsWith(runId.slice(0, length)))) {
      length += 1;
    }
    return [runId, runId.slice(0, length)];
  }));
}

function exclusionReason(
  operation: LifecycleOperation,
  candidate: LifecycleCandidate,
  statusHasNonterminal: boolean,
): string | undefined {
  if (operation === "status") {
    return statusHasNonterminal && (candidate.state === "SUCCEEDED" || candidate.state === "STOPPED")
      ? "a nonterminal run takes precedence for status"
      : undefined;
  }
  if (candidate.state === "SUCCEEDED" || candidate.state === "STOPPED") {
    return `terminal run state is ${candidate.state}`;
  }
  if (operation === "resume" && candidate.coordinator !== "inactive") {
    return candidate.coordinator === "active" ? "coordinator is already active" : "coordinator ownership is unknown";
  }
  return undefined;
}

export async function discoverLifecycleRuns(
  stateRoot: string,
  repositoryRoot: string,
  operation: LifecycleOperation,
): Promise<LifecycleDiscovery> {
  const canonicalRepository = await canonicalRepositoryRoot(repositoryRoot);
  const available = await loadAvailableRuns(stateRoot);
  const leaves = available.runs.filter(({ charter }) =>
    charter.repository.root === canonicalRepository && !available.supersededRunIds.has(charter.runId)
  );
  const ids = shortIds(leaves.map(({ charter }) => charter.runId));
  const summaries = await Promise.all(leaves.map(async (run): Promise<LifecycleCandidate> => ({
    runId: run.charter.runId,
    shortId: ids.get(run.charter.runId) ?? run.charter.runId,
    title: runTitle(run.charter),
    state: run.projection.state,
    coordinator: await coordinatorState(run.directory),
    completedItems: Object.values(run.projection.items).filter(({ state }) => state === "SATISFIED").length,
    totalItems: run.charter.work.length,
    updatedAt: run.records.at(-1)?.event.timestamp ?? run.charter.createdAt,
    mode: run.charter.mode,
  })));
  summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId));
  const candidates: LifecycleCandidate[] = [];
  const excluded: LifecycleExclusion[] = [];
  const statusHasNonterminal = operation === "status"
    && summaries.some(({ state }) => state !== "SUCCEEDED" && state !== "STOPPED");
  summaries.forEach((candidate) => {
    const reason = exclusionReason(operation, candidate, statusHasNonterminal);
    if (reason === undefined) {
      candidates.push(candidate);
    } else {
      excluded.push({ ...candidate, reason });
    }
  });
  if (operation !== "status" && available.corrupt.length > 0 && candidates.length > 0) {
    candidates.splice(0).forEach((candidate) => excluded.push({
      ...candidate,
      reason: "corrupt retained state prevents automatic mutation",
    }));
  }
  return { kind: "selection", operation, candidates, excluded, corrupt: available.corrupt };
}
