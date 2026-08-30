import assert from "node:assert/strict";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { consumedAttempts, initialProjection, reduce } from "../src/reducer.js";
import { createRepository, proposedCharter } from "./helpers.js";

function base(reason: string) {
  return { eventId: newEventId(), timestamp: new Date().toISOString(), source: "runtime" as const, reason };
}

test("reducer permits only the runtime verification path to success", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  let projection = initialProjection(charter);
  const events: LifecycleEvent[] = [
    { ...base("reconcile"), type: "RECONCILIATION_STARTED" },
    { ...base("ready"), type: "RECONCILIATION_COMPLETED" },
    { ...base("verify"), type: "RUN_VERIFYING" },
    { ...base("done"), type: "RUN_SUCCEEDED", predicateSummary: "met" },
  ];

  for (const event of events) {
    projection = reduce(projection, event);
  }

  assert.equal(projection.state, "SUCCEEDED");
  assert.throws(() => reduce(projection, { ...base("resume"), type: "RUN_RESUMED" }), /terminal run state/);
});

test("reducer prevents success from overtaking an accepted pause request", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  let projection = initialProjection(charter);
  projection = reduce(projection, { ...base("reconcile"), type: "RECONCILIATION_STARTED" });
  projection = reduce(projection, { ...base("running"), type: "RECONCILIATION_COMPLETED" });
  projection = reduce(projection, { ...base("verify"), type: "RUN_VERIFYING" });
  projection = reduce(projection, {
    ...base("pause"), source: "operator", type: "RUN_PAUSE_REQUESTED", requestId: "pause-before-success",
  });

  assert.throws(() => reduce(projection, {
    ...base("success"), type: "RUN_SUCCEEDED", predicateSummary: "met",
  }), /cannot overtake an accepted pause request/);
});

test("reducer permits only scoped operator wrap-up evidence after success", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  let projection = initialProjection(charter);
  projection = reduce(projection, { ...base("reconcile"), type: "RECONCILIATION_STARTED" });
  projection = reduce(projection, { ...base("ready"), type: "RECONCILIATION_COMPLETED" });
  projection = reduce(projection, { ...base("verify"), type: "RUN_VERIFYING" });
  projection = reduce(projection, { ...base("done"), type: "RUN_SUCCEEDED", predicateSummary: "met" });
  projection = reduce(projection, {
    ...base("wrap-up"), source: "operator", type: "WRAP_UP_STARTED", chainRunIds: [charter.runId], handoff: false,
  });
  projection = reduce(projection, {
    ...base("cleanup"), source: "operator", type: "EFFECT_CONFIRMED", effect: "git.branch.delete",
    idempotencyKey: "cleanup-key", observedState: "absent",
  });

  assert.equal(projection.state, "SUCCEEDED");
  assert.throws(() => reduce(projection, {
    ...base("unrelated"), source: "operator", type: "EFFECT_CONFIRMED", effect: "remote.push",
    idempotencyKey: "unrelated-key", observedState: "changed",
  }), /terminal run state/);
});

test("reducer rejects a success event that is not runtime-owned", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  let projection = initialProjection(charter);
  projection = reduce(projection, { ...base("reconcile"), type: "RECONCILIATION_STARTED" });
  projection = reduce(projection, { ...base("ready"), type: "RECONCILIATION_COMPLETED" });
  projection = reduce(projection, { ...base("verify"), type: "RUN_VERIFYING" });

  assert.throws(() => reduce(projection, {
    ...base("adapter claim"),
    source: "operator",
    type: "RUN_SUCCEEDED",
    predicateSummary: "adapter claimed done",
  }), /runtime-owned/);
});

test("reducer projects a nonterminal operator pause without charging its cancelled attempt", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  let projection = initialProjection(charter);
  const attemptId = "attempt-paused";
  const requestId = "pause-request";
  const events: LifecycleEvent[] = [
    { ...base("reconcile"), type: "RECONCILIATION_STARTED" },
    { ...base("ready"), type: "RECONCILIATION_COMPLETED" },
    { ...base("item ready"), type: "ITEM_READY", itemId: "item-1" },
    {
      ...base("attempt"), type: "ATTEMPT_STARTED", itemId: "item-1", attemptId, leaseEpoch: 1,
      expectedBaseCommit: repository.baseCommit, contextHash: "context", contextJournalSequence: 3,
      deadline: new Date(Date.now() + 1_000).toISOString(), idempotencyKey: "attempt:key",
    },
    { ...base("pause"), source: "operator", type: "RUN_PAUSE_REQUESTED", requestId },
    {
      ...base("observed cancellation"), type: "ATTEMPT_FINISHED", itemId: "item-1", attemptId,
      observedHeadCommit: repository.baseCommit, observedTreeIdentity: repository.baseCommit, outcome: "cancelled",
    },
    { ...base("cancelled"), type: "ATTEMPT_PAUSED", itemId: "item-1", attemptId },
    { ...base("quiescent"), source: "operator", type: "RUN_WAITING", waiting: { kind: "operator-pause", requestId } },
  ];
  for (const lifecycleEvent of events) {
    projection = reduce(projection, lifecycleEvent);
  }

  assert.equal(projection.state, "WAITING");
  assert.equal(projection.waiting?.kind, "operator-pause");
  assert.equal(projection.items["item-1"]?.attempts.length, 1);
  assert.equal(consumedAttempts(projection.items["item-1"]), 0);

  projection = reduce(projection, { ...base("resume"), source: "operator", type: "RUN_RESUMED" });
  projection = reduce(projection, { ...base("reconcile"), type: "RECONCILIATION_STARTED" });
  projection = reduce(projection, { ...base("running"), type: "RECONCILIATION_COMPLETED" });
  assert.equal(projection.state, "RUNNING");
  assert.equal(projection.waiting, undefined);
  assert.equal(projection.pauseRequestId, undefined);
});

test("reducer charges a naturally completed attempt when pause races with completion", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const attemptId = "attempt-completed-during-pause";
  let projection = initialProjection(charter);
  for (const lifecycleEvent of [
    { ...base("reconcile"), type: "RECONCILIATION_STARTED" } as LifecycleEvent,
    { ...base("running"), type: "RECONCILIATION_COMPLETED" } as LifecycleEvent,
    { ...base("ready"), type: "ITEM_READY", itemId: "item-1" } as LifecycleEvent,
    {
      ...base("attempt"), type: "ATTEMPT_STARTED", itemId: "item-1", attemptId, leaseEpoch: 1,
      expectedBaseCommit: repository.baseCommit, contextHash: "context", contextJournalSequence: 3,
      deadline: new Date(Date.now() + 1_000).toISOString(), idempotencyKey: "attempt:completed",
    } as LifecycleEvent,
    {
      ...base("completed"), type: "ATTEMPT_FINISHED", itemId: "item-1", attemptId,
      observedHeadCommit: repository.baseCommit, outcome: "completed",
    } as LifecycleEvent,
  ]) {
    projection = reduce(projection, lifecycleEvent);
  }

  assert.throws(() => reduce(projection, {
    ...base("pause race"), type: "ATTEMPT_PAUSED", itemId: "item-1", attemptId,
  }), /pause-cancelled/);
  projection = reduce(projection, {
    ...base("pause race"), type: "ATTEMPT_PAUSED", itemId: "item-1", attemptId, budgetConsumed: true,
  });
  assert.equal(consumedAttempts(projection.items["item-1"]), 1);
});

test("reducer ignores a duplicate event ID", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const event: LifecycleEvent = { ...base("reconcile"), type: "RECONCILIATION_STARTED" };
  const once = reduce(initialProjection(charter), event);

  assert.equal(reduce(once, event), once);
});
