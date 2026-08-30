import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import type { ProposedRunCharter } from "../src/charter.js";
import { sealCharter } from "../src/charter.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, writeImmutableJson } from "../src/journal.js";
import { observeReviewFeedback } from "../src/review-feedback.js";
import { createRepository, proposedCharter, writeNodeExecutable } from "./helpers.js";

function event(type: "CHARTER_COMPILED"): LifecycleEvent {
  return { eventId: newEventId(), timestamp: new Date().toISOString(), source: "runtime", reason: "test", type };
}

async function storeSuccessfulRun(stateRoot: string, proposed: ProposedRunCharter): Promise<void> {
  const charter = sealCharter(proposed);
  const directory = join(stateRoot, "runs", charter.runId);
  await mkdir(directory, { recursive: true });
  await writeImmutableJson(join(directory, "charter.json"), charter);
  const itemId = charter.work[0]?.id ?? "item-1";
  const attemptId = "attempt-1";
  const events: LifecycleEvent[] = [
    event("CHARTER_COMPILED"),
    { ...event("CHARTER_COMPILED"), type: "RECONCILIATION_STARTED" },
    { ...event("CHARTER_COMPILED"), type: "RECONCILIATION_COMPLETED" },
    { ...event("CHARTER_COMPILED"), type: "ITEM_READY", itemId },
    {
      ...event("CHARTER_COMPILED"), type: "ATTEMPT_STARTED", itemId, attemptId, leaseEpoch: 1,
      expectedBaseCommit: charter.repository.baseCommit, deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "attempt-key",
    },
    { ...event("CHARTER_COMPILED"), type: "ATTEMPT_FINISHED", itemId, attemptId, observedHeadCommit: charter.repository.baseCommit, outcome: "completed" },
    { ...event("CHARTER_COMPILED"), type: "ITEM_VERIFYING", itemId, attemptId },
    { ...event("CHARTER_COMPILED"), type: "EFFECT_CONFIRMED", itemId, effect: "remote.push", idempotencyKey: "push", observedState: charter.repository.baseCommit },
    { ...event("CHARTER_COMPILED"), type: "EFFECT_CONFIRMED", itemId, effect: "change-request.open", idempotencyKey: "pr", observedState: "https://example.invalid/pull/7" },
    { ...event("CHARTER_COMPILED"), type: "ITEM_SATISFIED", itemId, attemptId, subject: "tree:accepted" },
    { ...event("CHARTER_COMPILED"), type: "RUN_VERIFYING" },
    { ...event("CHARTER_COMPILED"), type: "RUN_SUCCEEDED", predicateSummary: "satisfied" },
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(join(directory, "events.jsonl"), lifecycleEvent);
  }
}

test("review feedback discovers the successful leaf and returns content-bound unresolved comments", async () => {
  const repository = await createRepository();
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "autopilot-review-feedback-")));
  const root = await realpath(repository.root);
  const proposed = proposedCharter(root, repository.baseCommit, "single", "review-run");
  await storeSuccessfulRun(stateRoot, {
    ...proposed,
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [...proposed.grants, { family: "remote.push", actor: "runtime", remotes: ["origin"] }, { family: "change-request.open", actor: "delivery" }],
  });
  const bin = await mkdtemp(join(tmpdir(), "autopilot-review-feedback-gh-"));
  await writeNodeExecutable(bin, "gh", `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("gh fake");
else if (args[0] === "pr" && args[1] === "view") console.log(JSON.stringify({number:7,url:"https://example.invalid/pull/7",state:"OPEN",headRefOid:process.env.FAKE_HEAD,baseRefName:"main",reviewDecision:""}));
else if (args[0] === "repo") console.log(JSON.stringify({nameWithOwner:"owner/project"}));
else if (args[0] === "api" && args[1] === "graphql") console.log(JSON.stringify({data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}}));
else if (args[0] === "api" && args[1].includes("/issues/")) console.log(JSON.stringify([{id:11,user:{login:"reviewer"},body:"Handle null",html_url:"https://example.invalid/pull/7#issuecomment-11",created_at:"2026-08-23T00:00:00Z"}]));
else console.log("[]");
`);
  const previousPath = process.env.PATH;
  const previousHead = process.env.FAKE_HEAD;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.FAKE_HEAD = repository.baseCommit;
  const nested = join(root, "src", "nested");
  await mkdir(nested, { recursive: true });
  try {
    const result = await observeReviewFeedback(stateRoot, nested);

    assert.equal(result.kind, "review-feedback", JSON.stringify(result));
    if (result.kind !== "review-feedback") {
      throw new Error("expected review feedback result");
    }
    assert.equal(result.threads[0]?.comments[0]?.body, "Handle null");
    assert.match(result.threads[0]?.contentHash ?? "", /^[a-f0-9]{64}$/u);
    const selected = result.threads[0];
    if (selected === undefined) {
      throw new Error("expected one feedback thread");
    }
    const successorBase = proposedCharter(root, repository.baseCommit, "single", "review-successor");
    const successorItem = successorBase.work[0];
    const predecessorItem = proposed.work[0];
    if (successorItem === undefined || predecessorItem === undefined) {
      throw new Error("expected single-item fixtures");
    }
    await storeSuccessfulRun(stateRoot, {
      ...successorBase,
      work: [{ ...successorItem, branchName: predecessorItem.branchName }],
      delivery: "change-request-ready",
      deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
      predecessorRunId: "review-run",
      amends: { runId: "review-run", itemId: "item-1" },
      reviewFeedback: {
        observedHeadCommit: repository.baseCommit,
        threads: [{ threadId: selected.id, contentHash: selected.contentHash, url: selected.comments[0]?.url ?? "", resolve: false }],
      },
      grants: [
        ...successorBase.grants,
        { family: "remote.push", actor: "runtime", remotes: ["origin"] },
        { family: "change-request.update", actor: "delivery" },
      ],
    });

    const afterAddressing = await observeReviewFeedback(stateRoot, nested);
    assert.equal(afterAddressing.kind, "review-feedback");
    if (afterAddressing.kind === "review-feedback") {
      assert.deepEqual(afterAddressing.threads, []);
    }
  } finally {
    process.env.PATH = previousPath;
    if (previousHead === undefined) {
      delete process.env.FAKE_HEAD;
    } else {
      process.env.FAKE_HEAD = previousHead;
    }
  }
});
