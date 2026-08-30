import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CapabilityGrant, RunCharter, WorkItem } from "../src/charter.js";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, writeImmutableJson } from "../src/journal.js";
import { inspectCommit, resolveWorktreePath } from "../src/repository.js";
import { grantsWithinRestackAuthority, validateRestackSuccessor } from "../src/restack.js";
import { createRepository, proposedCharter } from "./helpers.js";

type EventInput<T> = T extends LifecycleEvent ? Omit<T, "eventId" | "timestamp" | "source" | "reason"> : never;

function event(value: EventInput<LifecycleEvent>): LifecycleEvent {
  return {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "restack validation fixture",
    ...value,
  } as LifecycleEvent;
}

async function writeSuccessfulRun(
  stateRoot: string,
  charter: RunCharter,
  observations: Readonly<Record<string, { readonly commit: string; readonly url: string }>>,
): Promise<void> {
  const directory = join(stateRoot, "runs", charter.runId);
  await mkdir(directory, { recursive: true });
  await writeImmutableJson(join(directory, "charter.json"), charter);
  const events: LifecycleEvent[] = [
    event({ type: "CHARTER_COMPILED" }),
    event({ type: "RECONCILIATION_STARTED" }),
    event({ type: "RECONCILIATION_COMPLETED" }),
  ];
  charter.work.forEach((item, index) => {
    const observation = observations[item.id];
    if (observation === undefined) {
      throw new Error(`missing observation for ${item.id}`);
    }
    const attemptId = `attempt-${index}`;
    events.push(
      event({ type: "ITEM_READY", itemId: item.id }),
      event({
        type: "ATTEMPT_STARTED",
        itemId: item.id,
        attemptId,
        leaseEpoch: 1,
        expectedBaseCommit: charter.repository.baseCommit,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: `attempt-${index}`,
      }),
      event({ type: "ATTEMPT_FINISHED", itemId: item.id, attemptId, observedHeadCommit: observation.commit, outcome: "completed" }),
      event({ type: "ITEM_VERIFYING", itemId: item.id, attemptId }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "git.commit", idempotencyKey: `commit-${index}`, observedState: observation.commit }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "remote.push", idempotencyKey: `push-${index}`, observedState: observation.commit }),
      event({ type: "EFFECT_CONFIRMED", itemId: item.id, effect: "change-request.open", idempotencyKey: `cr-${index}`, observedState: observation.url }),
      event({ type: "ITEM_SATISFIED", itemId: item.id, attemptId, subject: `tree:${observation.commit}` }),
    );
  });
  events.push(event({ type: "RUN_VERIFYING" }), event({ type: "RUN_SUCCEEDED", predicateSummary: "satisfied" }));
  for (const lifecycleEvent of events) {
    await appendEvent(join(directory, "events.jsonl"), lifecycleEvent);
  }
}

function broadGrants(root: string): CapabilityGrant[] {
  return [
    { family: "files.read", actor: "worker", paths: [root] },
    { family: "files.write", actor: "worker", paths: [root] },
    { family: "process.execute", actor: "worker" },
    { family: "files.read", actor: "runtime", paths: [root] },
    { family: "network.access", actor: "runtime" },
    { family: "network.access", actor: "adapter" },
    { family: "network.access", actor: "delivery" },
    { family: "credentials.use", actor: "runtime" },
    { family: "credentials.use", actor: "adapter" },
    { family: "credentials.use", actor: "delivery" },
    { family: "git.commit", actor: "runtime", repositories: [root], branchPrefixes: ["autopilot/"] },
    { family: "remote.push", actor: "runtime", repositories: [root], remotes: ["origin"] },
    { family: "change-request.open", actor: "delivery" },
  ];
}

function restackGrants(root: string): CapabilityGrant[] {
  return [
    { family: "files.read", actor: "runtime", paths: [root] },
    { family: "network.access", actor: "runtime" },
    { family: "network.access", actor: "adapter" },
    { family: "network.access", actor: "delivery" },
    { family: "credentials.use", actor: "runtime" },
    { family: "credentials.use", actor: "adapter" },
    { family: "credentials.use", actor: "delivery" },
    { family: "git.commit", actor: "runtime", repositories: [root], branchPrefixes: ["autopilot/"] },
    { family: "remote.push", actor: "runtime", repositories: [root], remotes: ["origin"], branchPrefixes: ["autopilot/"] },
    { family: "change-request.observe", actor: "delivery", repositories: [root] },
  ];
}

async function validationFixture(provider: "github" | "gitlab" = "github") {
  const repository = await createRepository();
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-restack-validation-"));
  const base = proposedCharter(repository.root, repository.baseCommit, "ordered-stack", "source-run");
  const work: WorkItem[] = ["parent", "child", "grandchild"].map((id, index) => ({
    id,
    title: id,
    objective: `verify ${id}`,
    writableRoots: [`${id}.txt`],
    dependsOn: index === 0 ? [] : [["parent", "child"][index - 1] as string],
    acceptance: [{ type: "path-present", path: `${id}.txt` }],
    branchName: `autopilot/source/${id}`,
  }));
  const gates = [
    { id: "required", type: "search" as const, query: "done", paths: ["child.txt"], expectedCount: 1, appliesTo: ["child"] },
    { id: "alternative", type: "search" as const, query: "ok", paths: ["child.txt"], expectedCount: 1, appliesTo: ["child"] },
  ];
  const waivers = [{ gateId: "required", failurePattern: "missing", alternativeGateIds: ["alternative"], reason: "sealed fixture waiver" }];
  const source = sealCharter({
    ...base,
    work,
    delivery: "change-request-ready",
    deliveryTarget: { provider, remote: "origin", baseBranch: "main" },
    grants: broadGrants(repository.root),
    gates,
    waivers,
  });
  const url = (id: string) => provider === "github"
    ? `https://github.example.test/owner/repository/pull/${id}`
    : `https://gitlab.example.test/group/repository/-/merge_requests/${id}`;
  await writeSuccessfulRun(stateRoot, source, {
    parent: { commit: repository.baseCommit, url: url("1") },
    child: { commit: repository.baseCommit, url: url("2") },
    grandchild: { commit: repository.baseCommit, url: url("3") },
  });
  const amendmentBase = proposedCharter(repository.root, repository.baseCommit, "single", "amendment-run");
  const amendment = sealCharter({
    ...amendmentBase,
    repository: source.repository,
    work: [{ ...work[0] as WorkItem, dependsOn: [] }],
    delivery: source.delivery,
    deliveryTarget: source.deliveryTarget,
    predecessorRunId: source.runId,
    amends: { runId: source.runId, itemId: "parent" },
    grants: broadGrants(repository.root),
    gates: [],
    waivers: [],
    commitPolicy: source.commitPolicy,
  });
  await writeSuccessfulRun(stateRoot, amendment, {
    parent: { commit: repository.baseCommit, url: url("1") },
  });
  const tree = (await inspectCommit(repository.root, repository.baseCommit)).treeIdentity;
  const descendants = await Promise.all(work.slice(1).map(async (item, index) => ({
    itemId: item.id,
    oldCommit: repository.baseCommit,
    oldTreeIdentity: tree,
    remote: "origin",
    remoteCommit: repository.baseCommit,
    changeRequest: { provider, id: String(index + 2), url: url(String(index + 2)), baseBranch: work[index]?.branchName ?? "main" },
    worktreePath: await resolveWorktreePath(source, item),
    gateIds: gates.filter(({ appliesTo }) => appliesTo.includes(item.id)).map(({ id }) => id),
  })));
  const successorBase = proposedCharter(repository.root, repository.baseCommit, "ordered-stack", "restack-run");
  const successor = sealCharter({
    ...successorBase,
    repository: source.repository,
    work: work.slice(1).map((item, index) => ({ ...item, dependsOn: index === 0 ? [] : [work[index + 0]?.id as string] })),
    delivery: source.delivery,
    deliveryTarget: source.deliveryTarget,
    predecessorRunId: amendment.runId,
    grants: restackGrants(repository.root),
    gates,
    waivers,
    commitPolicy: source.commitPolicy,
    restack: {
      schemaVersion: 1,
      predecessorRunId: amendment.runId,
      predecessorCharterHash: amendment.charterHash,
      amendedItemId: "parent",
      amendedCommit: repository.baseCommit,
      descendants,
    },
  });
  return { stateRoot, successor };
}

test("restack grants are constrained by both source and immediate amendment authority", () => {
  const source: CapabilityGrant[] = [
    { family: "files.read", actor: "runtime", paths: ["/repository"] },
    { family: "network.access", actor: "delivery" },
  ];
  const amendment: CapabilityGrant[] = [
    { family: "files.read", actor: "runtime", paths: ["/repository/service"] },
    { family: "network.access", actor: "delivery" },
  ];
  assert.equal(grantsWithinRestackAuthority([
    { family: "files.read", actor: "runtime", paths: ["/repository/service/src"] },
    { family: "change-request.observe", actor: "delivery" },
  ], source, amendment), true);
  assert.equal(grantsWithinRestackAuthority([
    { family: "files.read", actor: "runtime", paths: ["/repository/other"] },
  ], source, amendment), false);
});

test("validateRestackSuccessor accepts exact GitHub and GitLab sealed evidence", async () => {
  for (const provider of ["github", "gitlab"] as const) {
    const fixture = await validationFixture(provider);
    await validateRestackSuccessor(fixture.stateRoot, fixture.successor);
  }
});

test("validateRestackSuccessor rejects suffix omission, reorder, artifact, grant, change-request identity, and waiver drift", async () => {
  const { stateRoot, successor } = await validationFixture();
  const descendants = successor.restack?.descendants ?? [];
  const cases: RunCharter[] = [
    { ...successor, restack: { ...successor.restack!, descendants: descendants.slice(1) } },
    { ...successor, restack: { ...successor.restack!, descendants: [...descendants].reverse() } },
    { ...successor, restack: { ...successor.restack!, descendants: [{ ...descendants[0]!, oldTreeIdentity: "f".repeat(40) }, ...descendants.slice(1)] } },
    { ...successor, grants: [...successor.grants, { family: "merge.execute", actor: "runtime" }] },
    { ...successor, restack: { ...successor.restack!, descendants: [{ ...descendants[0]!, changeRequest: { ...descendants[0]!.changeRequest, id: "999" } }, ...descendants.slice(1)] } },
    { ...successor, waivers: [] },
  ];
  for (const candidate of cases) {
    await assert.rejects(validateRestackSuccessor(stateRoot, candidate));
  }
});
