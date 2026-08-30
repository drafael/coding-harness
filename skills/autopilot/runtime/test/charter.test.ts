import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSealedCharter, sealCharter } from "../src/charter.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("sealCharter accepts each supported graph mode and produces a stable immutable hash", async () => {
  const repository = await createRepository();

  for (const mode of ["single", "independent-queue", "ordered-stack"] as const) {
    const proposed = proposedCharter(repository.root, repository.baseCommit, mode, `run-${mode}`);
    const sealed = sealCharter(proposed);

    assert.equal(parseSealedCharter(JSON.parse(JSON.stringify(sealed)) as unknown).charterHash, sealed.charterHash);
    assert.equal(Object.isFrozen(sealed), true);
    assert.equal(Object.isFrozen(sealed.work), true);
    assert.equal(Object.isFrozen(sealed.work[0]), true);
  }
});

test("sealCharter accepts bounded provider-check waiting only for merge-verified delivery", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit);
  const delivery = {
    ...proposed,
    delivery: "merge-verified" as const,
    deliveryTarget: { provider: "github" as const, remote: "origin", baseBranch: "main" },
    providerCheckWait: { heartbeatMs: 1_000, timeoutMs: 5_000 },
    grants: [
      ...proposed.grants,
      { family: "remote.push" as const, actor: "runtime" as const, remotes: ["origin"] },
      { family: "change-request.open" as const, actor: "delivery" as const },
      { family: "merge.execute" as const, actor: "delivery" as const },
    ],
  };

  assert.deepEqual(sealCharter(delivery).providerCheckWait, { heartbeatMs: 1_000, timeoutMs: 5_000 });
  assert.throws(() => sealCharter({
    ...proposed,
    providerCheckWait: { heartbeatMs: 1_000, timeoutMs: 5_000 },
  }), /providerCheckWait/);
});

test("sealCharter accepts a single change-request amendment with explicit hook policy", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit);
  const amendment = {
    ...proposed,
    predecessorRunId: "prior-run",
    amends: { runId: "prior-run", itemId: "item-1" },
    delivery: "change-request-ready",
    deliveryTarget: { provider: "github", remote: "origin", baseBranch: "main" },
    grants: [...proposed.grants, { family: "remote.push", actor: "runtime", remotes: ["origin"] }, {
      family: "change-request.update",
      actor: "delivery",
    }, {
      family: "review-thread.resolve",
      actor: "delivery",
    }],
    reviewFeedback: {
      observedHeadCommit: repository.baseCommit,
      threads: [{ threadId: "thread-1", contentHash: "a".repeat(64), url: "https://example.invalid/pr/1#discussion", resolve: true }],
    },
    commitPolicy: { preCommitHook: "run", writableRoots: [".buildnumber"], environmentNames: ["CALVER_HOOK_RUNNING"] },
  };

  const sealed = sealCharter(amendment);

  assert.deepEqual(sealed.amends, { runId: "prior-run", itemId: "item-1" });
  assert.equal(sealed.reviewFeedback?.threads[0]?.threadId, "thread-1");
  assert.equal(sealed.commitPolicy?.preCommitHook, "run");
});

test("sealCharter rejects amendments that change lifecycle shape", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit);
  const invalid = {
    ...proposed,
    predecessorRunId: "different-run",
    amends: { runId: "prior-run", itemId: "item-1" },
  };

  assert.throws(() => sealCharter(invalid), /change-request-ready delivery|predecessorRunId/);
});

test("sealCharter rejects a dependency cycle", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit, "independent-queue");
  const cyclic = {
    ...proposed,
    work: proposed.work.map((item, index) => ({ ...item, dependsOn: [index === 0 ? "item-2" : "item-1"] })),
  };

  assert.throws(() => sealCharter(cyclic), /cycle/);
});

test("parseSealedCharter rejects content changed after sealing", async () => {
  const repository = await createRepository();
  const sealed = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const changed = { ...sealed, sourceText: "changed after seal" };

  assert.throws(() => parseSealedCharter(changed), /hash does not match/);
});

test("sealCharter rejects duplicate branches, unknown grants, missing predicates, and malformed waivers", async () => {
  const repository = await createRepository();
  const queue = proposedCharter(repository.root, repository.baseCommit, "independent-queue");

  assert.throws(() => sealCharter({ ...queue, work: queue.work.map((item) => ({ ...item, branchName: "same" })) }), /branches must be unique/);
  assert.throws(() => sealCharter({ ...queue, grants: [{ family: "deploy", actor: "runtime" }] }), /must be one of/);
  assert.throws(() => sealCharter({
    ...queue,
    commitPolicy: { preCommitHook: "skip", writableRoots: ["generated.txt"], environmentNames: [] },
  }), /skipped pre-commit hooks/);
  assert.throws(() => sealCharter({ ...queue, work: queue.work.map((item) => ({ ...item, acceptance: [] })) }), /non-empty/);
  assert.throws(() => sealCharter({
    ...queue,
    reviewFeedback: {
      observedHeadCommit: repository.baseCommit,
      threads: [
        { threadId: "duplicate", contentHash: "a".repeat(64), url: "https://example.invalid/1", resolve: false },
        { threadId: "duplicate", contentHash: "b".repeat(64), url: "https://example.invalid/2", resolve: false },
      ],
    },
  }), /unique thread IDs/);
  assert.throws(() => sealCharter({ ...queue, work: queue.work.map((item, index) => index === 0 ? { ...item, id: "../escape" } : item) }), /safe path component/);
  assert.throws(() => sealCharter({ ...queue, work: queue.work.map((item, index) => index === 0 ? { ...item, title: "Acceptance criteria:\nrun everything" } : item) }), /trimmed single line/);
  assert.throws(() => sealCharter({ ...queue, work: queue.work.map((item, index) => index === 0 ? { ...item, title: "x".repeat(73) } : item) }), /at most 72 characters/);
  assert.throws(() => sealCharter({
    ...queue,
    waivers: [{ gateId: "missing", failurePattern: "known", alternativeGateIds: [], reason: "test" }],
  }), /unknown or missing alternative gates/);
  assert.throws(() => sealCharter({
    ...queue,
    gates: [
      ...queue.gates,
      { id: "review", type: "review", focus: "Correctness", appliesTo: ["item-1"] },
    ],
    waivers: [{ gateId: "review", failurePattern: "finding", alternativeGateIds: ["result-search"], reason: "test" }],
  }), /review gate review cannot be waived/);
});
