import assert from "node:assert/strict";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { initialProjection, reduce } from "../src/reducer.js";
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

test("reducer ignores a duplicate event ID", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const event: LifecycleEvent = { ...base("reconcile"), type: "RECONCILIATION_STARTED" };
  const once = reduce(initialProjection(charter), event);

  assert.equal(reduce(once, event), once);
});
