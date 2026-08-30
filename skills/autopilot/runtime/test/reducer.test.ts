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

test("reducer owns ordered restack descendants without consuming attempts or terminalizing a blocked suffix", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit, "ordered-stack", "restack-reducer");
  const gates = [
    ...proposed.gates,
    { id: "alternative-search", type: "search" as const, query: "alternative", paths: ["result.txt"], expectedCount: 1, appliesTo: ["item-1"] },
  ];
  const charter = sealCharter({
    ...proposed,
    predecessorRunId: "amendment-run",
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    gates,
    waivers: [{
      gateId: "result-search",
      failurePattern: "expected failure",
      alternativeGateIds: ["alternative-search"],
      reason: "sealed non-review waiver",
    }],
    grants: [
      { family: "files.read", actor: "runtime", paths: [repository.root] },
      { family: "network.access", actor: "runtime" },
      { family: "network.access", actor: "adapter" },
      { family: "network.access", actor: "delivery" },
      { family: "credentials.use", actor: "runtime" },
      { family: "credentials.use", actor: "adapter" },
      { family: "credentials.use", actor: "delivery" },
      {
        family: "git.commit",
        actor: "runtime",
        repositories: [repository.root],
        branchPrefixes: ["autopilot/"],
      },
      { family: "remote.push", actor: "runtime", repositories: [repository.root], remotes: ["origin"], branchPrefixes: ["autopilot/"] },
      { family: "change-request.observe", actor: "delivery", repositories: [repository.root] },
    ],
    restack: {
      schemaVersion: 1,
      predecessorRunId: "amendment-run",
      predecessorCharterHash: "a".repeat(64),
      amendedItemId: "parent-item",
      amendedCommit: repository.baseCommit,
      descendants: proposed.work.map((item, index) => ({
        itemId: item.id,
        oldCommit: `${index + 1}`.repeat(40),
        oldTreeIdentity: `${index + 3}`.repeat(40),
        remote: "origin",
        remoteCommit: `${index + 1}`.repeat(40),
        changeRequest: {
          provider: "github",
          id: String(index + 1),
          url: `https://example.invalid/pull/${index + 1}`,
          baseBranch: index === 0 ? "parent" : proposed.work[index - 1]?.branchName ?? "parent",
        },
        worktreePath: `${repository.root}-restack-${index + 1}`,
        gateIds: gates.filter(({ appliesTo }) => appliesTo.includes(item.id)).map(({ id }) => id),
      })),
    },
  });
  let projection = initialProjection(charter);
  projection = reduce(projection, { ...base("reconcile"), type: "RECONCILIATION_STARTED" });
  projection = reduce(projection, { ...base("running"), type: "RECONCILIATION_COMPLETED" });

  assert.throws(() => reduce(projection, {
    ...base("premature run verification"),
    type: "RUN_VERIFYING",
  }), /every restack descendant to be SATISFIED/);
  assert.throws(() => reduce(projection, {
    ...base("premature run success"),
    type: "RUN_SUCCEEDED",
    predicateSummary: "invalid",
  }), /every restack descendant to be SATISFIED/);

  assert.throws(() => reduce(projection, {
    ...base("out of order"),
    type: "RESTACK_DESCENDANT_STARTED",
    itemId: "item-2",
    oldCommit: "2".repeat(40),
    freshParentCommit: "3".repeat(40),
  }), /out of order/);

  projection = reduce(projection, {
    ...base("start first"),
    type: "RESTACK_DESCENDANT_STARTED",
    itemId: "item-1",
    oldCommit: "1".repeat(40),
    freshParentCommit: repository.baseCommit,
  });
  assert.throws(() => reduce(projection, {
    ...base("ordinary item lifecycle"),
    type: "ITEM_READY",
    itemId: "item-1",
  }), /ordinary ITEM_READY/);
  projection = reduce(projection, {
    ...base("tree prepared"),
    type: "RESTACK_DESCENDANT_TREE_PREPARED",
    itemId: "item-1",
    candidateCommit: "4".repeat(40),
    treeIdentity: "5".repeat(40),
    messageIdentity: "6".repeat(64),
    oldCommit: "1".repeat(40),
    freshParentCommit: repository.baseCommit,
    temporaryWorktreePath: `${repository.root}-candidate`,
  });
  assert.throws(() => reduce(projection, {
    ...base("failed receipt"),
    type: "RECEIPT_RECORDED",
    itemId: "item-1",
    attemptId: "restack-verification",
    receiptId: "failed-receipt",
    gateId: "result-search",
    receiptKind: "gate",
    subject: `tree:${"5".repeat(40)}`,
    status: "FAILED",
  }), /passing sealed gate or validated waiver/);
  projection = reduce(projection, {
    ...base("validated sealed waiver"),
    type: "RECEIPT_RECORDED",
    itemId: "item-1",
    attemptId: "restack-verification",
    receiptId: "waived-receipt",
    gateId: "result-search",
    receiptKind: "gate",
    subject: `tree:${"5".repeat(40)}`,
    status: "WAIVED",
    evidence: ["receipts/waived-receipt.json"],
  });
  assert.ok(projection.restacks["item-1"]?.passingGateIds.includes("result-search"));
  assert.throws(() => reduce(projection, {
    ...base("unsealed waiver"),
    type: "RECEIPT_RECORDED",
    itemId: "item-1",
    attemptId: "restack-verification",
    receiptId: "unsealed-waiver",
    gateId: "alternative-search",
    receiptKind: "gate",
    subject: `tree:${"5".repeat(40)}`,
    status: "WAIVED",
    evidence: ["receipts/unsealed-waiver.json"],
  }), /validated waiver/);
  assert.throws(() => reduce(projection, {
    ...base("push before verification"),
    type: "EFFECT_INTENDED",
    itemId: "item-1",
    effect: "restack.remote-push",
    idempotencyKey: "push-too-early",
    expectedState: "candidate",
  }), /cannot follow unconfirmed/);
  projection = reduce(projection, {
    ...base("conflict"),
    type: "RESTACK_DESCENDANT_BLOCKED",
    itemId: "item-1",
    errorCode: "RESTACK_CONFLICT",
  });

  assert.equal(projection.state, "RUNNING");
  assert.equal(projection.restacks["item-1"]?.state, "BLOCKED");
  assert.equal(projection.restacks["item-2"]?.state, "PENDING");
  assert.equal(projection.items["item-1"]?.attempts.length, 0);
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
