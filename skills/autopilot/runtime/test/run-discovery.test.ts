import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProposedRunCharter } from "../src/charter.js";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, writeImmutableJson } from "../src/journal.js";
import { acquireRunLock } from "../src/lock.js";
import { discoverLifecycleRuns } from "../src/run-discovery.js";
import { createRepository, proposedCharter } from "./helpers.js";

function event(type: "CHARTER_COMPILED" | "RUN_STOPPED"): LifecycleEvent {
  const base = {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime" as const,
    reason: "discovery fixture",
  };
  return type === "RUN_STOPPED"
    ? { ...base, type, errorCode: "OPERATOR_STOP", remediation: "Create a successor charter." }
    : { ...base, type };
}

function deliveredProposal(root: string, baseCommit: string, runId: string): ProposedRunCharter {
  const proposed = proposedCharter(root, baseCommit, "single", runId);
  return {
    ...proposed,
    work: proposed.work.map((item) => ({ ...item, branchName: "autopilot/shared/item-1" })),
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [
      ...proposed.grants,
      { family: "remote.push", actor: "runtime", remotes: ["origin"] },
      { family: "change-request.open", actor: "delivery" },
    ],
  };
}

function amendmentProposal(
  root: string,
  baseCommit: string,
  runId: string,
  predecessorRunId: string,
): ProposedRunCharter {
  const proposed = deliveredProposal(root, baseCommit, runId);
  return {
    ...proposed,
    predecessorRunId,
    amends: { runId: predecessorRunId, itemId: "item-1" },
    grants: [
      ...proposed.grants.filter(({ family }) => family !== "change-request.open"),
      { family: "change-request.update", actor: "delivery" },
    ],
  };
}

async function storeRun(
  stateRoot: string,
  proposed: ProposedRunCharter,
  stopped = false,
): Promise<string> {
  const charter = sealCharter(proposed);
  const directory = join(stateRoot, "runs", charter.runId);
  await mkdir(directory, { recursive: true });
  await writeImmutableJson(join(directory, "charter.json"), charter);
  await appendEvent(join(directory, "events.jsonl"), event("CHARTER_COMPILED"));
  if (stopped) {
    await appendEvent(join(directory, "events.jsonl"), event("RUN_STOPPED"));
  }
  return directory;
}

async function storeSuccessfulRun(stateRoot: string, proposed: ProposedRunCharter): Promise<void> {
  const directory = await storeRun(stateRoot, proposed);
  const itemId = "item-1";
  const attemptId = `${proposed.runId}-attempt`;
  const events: LifecycleEvent[] = [
    { ...event("CHARTER_COMPILED"), type: "RECONCILIATION_STARTED" },
    { ...event("CHARTER_COMPILED"), type: "RECONCILIATION_COMPLETED" },
    { ...event("CHARTER_COMPILED"), type: "ITEM_READY", itemId },
    {
      ...event("CHARTER_COMPILED"),
      type: "ATTEMPT_STARTED",
      itemId,
      attemptId,
      leaseEpoch: 1,
      expectedBaseCommit: proposed.repository.baseCommit,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `${attemptId}-key`,
    },
    {
      ...event("CHARTER_COMPILED"),
      type: "ATTEMPT_FINISHED",
      itemId,
      attemptId,
      observedHeadCommit: proposed.repository.baseCommit,
      outcome: "completed",
    },
    { ...event("CHARTER_COMPILED"), type: "ITEM_VERIFYING", itemId, attemptId },
    {
      ...event("CHARTER_COMPILED"),
      type: "EFFECT_CONFIRMED",
      itemId,
      effect: "remote.push",
      idempotencyKey: `${attemptId}-push`,
      observedState: proposed.repository.baseCommit,
    },
    {
      ...event("CHARTER_COMPILED"),
      type: "EFFECT_CONFIRMED",
      itemId,
      effect: "change-request.open",
      idempotencyKey: `${attemptId}-change-request`,
      observedState: "https://example.invalid/pull/1",
    },
    { ...event("CHARTER_COMPILED"), type: "ITEM_SATISFIED", itemId, attemptId, subject: "tree:accepted" },
    { ...event("CHARTER_COMPILED"), type: "RUN_VERIFYING" },
    { ...event("CHARTER_COMPILED"), type: "RUN_SUCCEEDED", predicateSummary: "satisfied" },
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(join(directory, "events.jsonl"), lifecycleEvent);
  }
}

test("lifecycle discovery prefers one nonterminal run and reports concise progress", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-")));
  await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "active-run"));
  await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "old-run"), true);

  const discovery = await discoverLifecycleRuns(stateRoot, root, "status");

  assert.deepEqual(discovery.candidates.map(({ runId }) => runId), ["active-run"]);
  assert.equal(discovery.candidates[0]?.title, "Create the result file");
  assert.equal(discovery.candidates[0]?.completedItems, 0);
  assert.equal(discovery.candidates[0]?.totalItems, 1);
  assert.deepEqual(discovery.excluded.map(({ runId }) => runId), ["old-run"]);
});

test("lifecycle discovery lists ambiguous runs deterministically and filters another repository", async () => {
  const firstRepository = await createRepository();
  const secondRepository = await createRepository();
  const firstRoot = await realpath(firstRepository.root);
  const secondRoot = await realpath(secondRepository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-shared-")));
  await storeRun(stateRoot, proposedCharter(firstRoot, firstRepository.baseCommit, "single", "run-shared-a"));
  await storeRun(stateRoot, proposedCharter(firstRoot, firstRepository.baseCommit, "single", "run-shared-b"));
  await storeRun(stateRoot, proposedCharter(secondRoot, secondRepository.baseCommit, "single", "other-project"));

  const discovery = await discoverLifecycleRuns(stateRoot, firstRoot, "resume");

  assert.deepEqual(new Set(discovery.candidates.map(({ runId }) => runId)), new Set(["run-shared-a", "run-shared-b"]));
  assert.ok(discovery.candidates.every(({ shortId }) => shortId.length >= 8));
  assert.ok(discovery.candidates.every(({ coordinator }) => coordinator === "inactive"));
});

test("resume excludes active and terminal runs while stop can target the active coordinator", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-lock-")));
  const activeDirectory = await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "active-owner"));
  await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "terminal-run"), true);
  const lock = await acquireRunLock(join(activeDirectory, "run.lock"));

  try {
    const resumable = await discoverLifecycleRuns(stateRoot, root, "resume");
    const stoppable = await discoverLifecycleRuns(stateRoot, root, "stop");

    assert.equal(resumable.candidates.length, 0);
    assert.match(resumable.excluded.find(({ runId }) => runId === "active-owner")?.reason ?? "", /already active/);
    assert.deepEqual(stoppable.candidates.map(({ runId }) => runId), ["active-owner"]);
    assert.match(stoppable.excluded.find(({ runId }) => runId === "terminal-run")?.reason ?? "", /terminal/);
  } finally {
    await lock.release();
  }
});

test("lifecycle discovery selects only amendment leaves and rejects cycles", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-amendment-")));
  await storeSuccessfulRun(stateRoot, deliveredProposal(root, created.baseCommit, "predecessor-run"));
  await storeRun(stateRoot, amendmentProposal(root, created.baseCommit, "successor-run", "predecessor-run"));

  const leaves = await discoverLifecycleRuns(stateRoot, root, "status");

  assert.deepEqual(leaves.candidates.map(({ runId }) => runId), ["successor-run"]);

  const cyclicStateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-cycle-")));
  await storeRun(cyclicStateRoot, amendmentProposal(root, created.baseCommit, "cycle-one", "cycle-two"));
  await storeRun(cyclicStateRoot, amendmentProposal(root, created.baseCommit, "cycle-two", "cycle-one"));

  const cyclic = await discoverLifecycleRuns(cyclicStateRoot, root, "resume");

  assert.equal(cyclic.candidates.length, 0);
  assert.deepEqual(new Set(cyclic.corrupt.map(({ name }) => name)), new Set(["cycle-one", "cycle-two"]));
});

test("amendment with missing predecessor state is corrupt outside wrap-up recovery", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-missing-predecessor-")));
  await storeRun(stateRoot, amendmentProposal(root, created.baseCommit, "orphan-successor", "missing-run"));

  const discovery = await discoverLifecycleRuns(stateRoot, root, "resume");

  assert.equal(discovery.candidates.length, 0);
  assert.match(discovery.corrupt[0]?.reason ?? "", /predecessor state is missing/);
});

test("amendment cannot supersede a merge-verified predecessor", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-merged-predecessor-")));
  const delivered = deliveredProposal(root, created.baseCommit, "merged-predecessor");
  const merged: ProposedRunCharter = {
    ...delivered,
    delivery: "merge-verified",
    grants: [...delivered.grants, { family: "merge.execute", actor: "delivery" }],
  };
  await storeSuccessfulRun(stateRoot, merged);
  await storeRun(stateRoot, amendmentProposal(root, created.baseCommit, "merged-successor", "merged-predecessor"));

  const discovery = await discoverLifecycleRuns(stateRoot, root, "status");

  assert.deepEqual(discovery.candidates.map(({ runId }) => runId), ["merged-predecessor"]);
  assert.match(discovery.corrupt.find(({ name }) => name === "merged-successor")?.reason ?? "", /delivery identity/);
});

test("foreign amendment cannot supersede another repository's run", async () => {
  const firstRepository = await createRepository();
  const secondRepository = await createRepository();
  const firstRoot = await realpath(firstRepository.root);
  const secondRoot = await realpath(secondRepository.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-foreign-amendment-")));
  await storeSuccessfulRun(stateRoot, deliveredProposal(firstRoot, firstRepository.baseCommit, "shared-run"));
  await storeRun(stateRoot, amendmentProposal(secondRoot, secondRepository.baseCommit, "foreign-successor", "shared-run"));

  const discovery = await discoverLifecycleRuns(stateRoot, firstRoot, "status");

  assert.deepEqual(discovery.candidates.map(({ runId }) => runId), ["shared-run"]);
  assert.match(discovery.corrupt.find(({ name }) => name === "foreign-successor")?.reason ?? "", /another repository/);
});

test("non-directory entries and mismatched charter identities are corrupt", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-entry-")));
  const original = await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "charter-run"));
  await rename(original, join(stateRoot, "runs", "wrong-directory"));
  await writeFile(join(stateRoot, "runs", "plain-file"), "not a run");
  await symlink(join(stateRoot, "runs", "wrong-directory"), join(stateRoot, "runs", "linked-run"));

  const discovery = await discoverLifecycleRuns(stateRoot, root, "stop");

  assert.equal(discovery.candidates.length, 0);
  assert.deepEqual(
    new Set(discovery.corrupt.map(({ name }) => name)),
    new Set(["linked-run", "plain-file", "wrong-directory"]),
  );
});

test("corrupt retained state prevents automatic mutation", async () => {
  const created = await createRepository();
  const root = await realpath(created.root);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-discovery-corrupt-")));
  await storeRun(stateRoot, proposedCharter(root, created.baseCommit, "single", "healthy-run"));
  const corruptDirectory = join(stateRoot, "runs", "corrupt-run");
  await mkdir(corruptDirectory, { recursive: true });
  await writeFile(join(corruptDirectory, "charter.json"), "{broken");

  const discovery = await discoverLifecycleRuns(stateRoot, root, "stop");

  assert.equal(discovery.candidates.length, 0);
  assert.match(discovery.excluded[0]?.reason ?? "", /corrupt retained state/);
  assert.equal(discovery.corrupt[0]?.name, "corrupt-run");
});
