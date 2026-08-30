import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { CapabilityGrant, RunCharter } from "./charter.js";
import { parseSealedCharter, restackGrantsAreValid } from "./charter.js";
import { AutopilotError } from "./errors.js";
import { readJournal, type JournalRecord } from "./journal.js";
import { canonicalJson } from "./json.js";
import { rebuildProjection } from "./projection.js";
import { inspectCommit, resolveWorktreePath } from "./repository.js";
import { runDirectory } from "./state-path.js";

const GRANT_LIST_FIELDS = ["commands", "repositories", "remotes", "environmentNames"] as const;

function pathWithin(candidate: string, root: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function grantCoveredBy(candidate: CapabilityGrant, authority: CapabilityGrant): boolean {
  const familyCovered = candidate.family === authority.family
    || (candidate.family === "change-request.observe" && authority.family === "network.access");
  if (!familyCovered || candidate.actor !== authority.actor) {
    return false;
  }
  const pathsCovered = authority.paths === undefined
    || (candidate.paths !== undefined && candidate.paths.every((path) => authority.paths?.some((root) => pathWithin(path, root))));
  const branchesCovered = authority.branchPrefixes === undefined
    || (candidate.branchPrefixes !== undefined
      && candidate.branchPrefixes.every((prefix) => authority.branchPrefixes?.some((root) => prefix.startsWith(root))));
  return pathsCovered && branchesCovered && GRANT_LIST_FIELDS.every((field) =>
    authority[field] === undefined
      || (candidate[field] !== undefined && candidate[field].every((value) => authority[field]?.includes(value)))
  );
}

export function grantsWithinRestackAuthority(
  grants: readonly CapabilityGrant[],
  sourceGrants: readonly CapabilityGrant[],
  amendmentGrants: readonly CapabilityGrant[],
): boolean {
  return grants.every((grant) =>
    sourceGrants.some((authority) => grantCoveredBy(grant, authority))
    && amendmentGrants.some((authority) => grantCoveredBy(grant, authority))
  );
}

function confirmedState(records: readonly JournalRecord[], itemId: string, effect: string): string | undefined {
  return records.flatMap(({ event }) =>
    event.type === "EFFECT_CONFIRMED" && event.itemId === itemId && event.effect === effect
      ? [event.observedState]
      : []
  ).at(-1);
}

async function loadSuccessfulRun(stateRoot: string, runId: string): Promise<{
  readonly charter: RunCharter;
  readonly records: readonly JournalRecord[];
}> {
  const directory = runDirectory(stateRoot, runId);
  try {
    const charter = parseSealedCharter(JSON.parse(await readFile(join(directory, "charter.json"), "utf8")) as unknown);
    const journal = await readJournal(join(directory, "events.jsonl"));
    if (rebuildProjection(charter, journal.records).state !== "SUCCEEDED") {
      throw new AutopilotError("CHARTER_INVALID", `restack predecessor ${runId} is not successful`);
    }
    return { charter, records: journal.records };
  } catch (error) {
    if (error instanceof AutopilotError) {
      throw error;
    }
    throw new AutopilotError("CHARTER_INVALID", `restack predecessor ${runId} is unavailable`, { cause: String(error) });
  }
}

export async function validateRestackSuccessor(stateRoot: string, charter: RunCharter): Promise<void> {
  const restack = charter.restack;
  if (restack === undefined) {
    return;
  }
  const amendment = await loadSuccessfulRun(stateRoot, restack.predecessorRunId);
  if (amendment.charter.charterHash !== restack.predecessorCharterHash
    || amendment.charter.amends?.itemId !== restack.amendedItemId
    || confirmedState(amendment.records, restack.amendedItemId, "remote.push") !== restack.amendedCommit) {
    throw new AutopilotError("CHARTER_INVALID", "restack amendment identity or confirmed commit changed");
  }
  const sourceRunId = amendment.charter.amends.runId;
  const source = await loadSuccessfulRun(stateRoot, sourceRunId);
  if (source.charter.mode !== "ordered-stack" || source.charter.delivery !== "change-request-ready"
    || source.charter.repository.root !== charter.repository.root
    || source.charter.repository.baseRef !== charter.repository.baseRef
    || canonicalJson(source.charter.repository.writableRoots) !== canonicalJson(charter.repository.writableRoots)
    || canonicalJson(source.charter.deliveryTarget) !== canonicalJson(charter.deliveryTarget)
    || canonicalJson(source.charter.limits) !== canonicalJson(charter.limits)
    || canonicalJson(source.charter.commitPolicy) !== canonicalJson(charter.commitPolicy)) {
    throw new AutopilotError("CHARTER_INVALID", "restack source stack repository or delivery identity changed");
  }
  const amendedIndex = source.charter.work.findIndex(({ id }) => id === restack.amendedItemId);
  const sourceDescendants = source.charter.work.slice(amendedIndex + 1);
  if (amendedIndex < 0 || canonicalJson(sourceDescendants.map(({ id }) => id))
    !== canonicalJson(restack.descendants.map(({ itemId }) => itemId))) {
    throw new AutopilotError("CHARTER_INVALID", "restack descendants are not the exact source stack suffix");
  }
  if (!restackGrantsAreValid(charter)
    || !grantsWithinRestackAuthority(charter.grants, source.charter.grants, amendment.charter.grants)
    || !charter.grants.some(({ family, actor }) => family === "change-request.observe" && actor === "delivery")
    || charter.grants.some(({ family }) => family === "change-request.open" || family === "change-request.update")) {
    throw new AutopilotError("CAPABILITY_DENIED", "restack successor must use the source/amendment authority intersection and observation-only provider access");
  }
  const sealedGateIds = new Set(restack.descendants.flatMap(({ gateIds }) => gateIds));
  const sourceWaivers = source.charter.waivers.filter(({ gateId }) => sealedGateIds.has(gateId));
  if (canonicalJson(charter.waivers) !== canonicalJson(sourceWaivers)) {
    throw new AutopilotError("CHARTER_INVALID", "restack waivers changed from their source definitions");
  }
  for (const [index, snapshot] of restack.descendants.entries()) {
    const sourceItem = sourceDescendants[index];
    const successorItem = charter.work[index];
    if (sourceItem === undefined || successorItem === undefined) {
      throw new AutopilotError("CHARTER_INVALID", "restack descendant work is incomplete");
    }
    const normalizedSource = { ...sourceItem, dependsOn: index === 0 ? [] : [sourceDescendants[index - 1]?.id] };
    if (canonicalJson(successorItem) !== canonicalJson(normalizedSource)) {
      throw new AutopilotError("CHARTER_INVALID", `restack work item ${snapshot.itemId} changed from its source`);
    }
    const oldCommit = confirmedState(source.records, sourceItem.id, "remote.push");
    const changeRequestUrl = confirmedState(source.records, sourceItem.id, "change-request.open");
    const oldTree = oldCommit === undefined ? undefined : (await inspectCommit(charter.repository.root, oldCommit)).treeIdentity;
    const expectedWorktree = await resolveWorktreePath(source.charter, sourceItem);
    const sourceGateIds = source.charter.gates
      .filter(({ appliesTo }) => appliesTo.length === 0 || appliesTo.includes(sourceItem.id))
      .map(({ id }) => id);
    const successorGateIds = charter.gates
      .filter(({ appliesTo }) => appliesTo.length === 0 || appliesTo.includes(successorItem.id))
      .map(({ id }) => id);
    const sourceBaseBranch = sourceItem.dependsOn.at(-1) === undefined
      ? source.charter.deliveryTarget?.baseBranch
      : source.charter.work.find(({ id }) => id === sourceItem.dependsOn.at(-1))?.branchName;
    const changeRequestId = changeRequestUrl?.replace(/\/+$/u, "").split("/").at(-1);
    if (oldCommit !== snapshot.oldCommit || snapshot.remoteCommit !== oldCommit || oldTree !== snapshot.oldTreeIdentity
      || snapshot.remote !== source.charter.deliveryTarget?.remote
      || changeRequestUrl !== snapshot.changeRequest.url || changeRequestId !== snapshot.changeRequest.id
      || snapshot.changeRequest.provider !== source.charter.deliveryTarget?.provider
      || snapshot.changeRequest.baseBranch !== sourceBaseBranch
      || expectedWorktree !== snapshot.worktreePath || canonicalJson(sourceGateIds) !== canonicalJson(snapshot.gateIds)
      || canonicalJson(successorGateIds) !== canonicalJson(snapshot.gateIds)) {
      throw new AutopilotError("CHARTER_INVALID", `restack snapshot for ${snapshot.itemId} changed from durable source evidence`);
    }
    const successorGates = charter.gates.filter(({ id }) => snapshot.gateIds.includes(id));
    const sourceGates = source.charter.gates.filter(({ id }) => snapshot.gateIds.includes(id));
    if (canonicalJson(successorGates) !== canonicalJson(sourceGates)) {
      throw new AutopilotError("CHARTER_INVALID", `restack gates for ${snapshot.itemId} changed from their source`);
    }
  }
}
