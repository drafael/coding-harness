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

test("sealCharter accepts explicit server-backed harness adapter names", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit);

  for (const harnessAdapter of ["claude-agent-sdk", "codex-app-server", "opencode-server"] as const) {
    assert.equal(sealCharter({ ...proposed, harnessAdapter }).harnessAdapter, harnessAdapter);
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

test("sealCharter accepts an explicit standalone restack successor", async () => {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit, "ordered-stack", "restack-run");
  const descendant = proposed.work[1];
  assert.ok(descendant !== undefined);
  const restack = {
    ...proposed,
    predecessorRunId: "amendment-run",
    work: [{ ...descendant, dependsOn: [] }],
    delivery: "change-request-ready" as const,
    deliveryTarget: { provider: "github" as const, remote: "origin", baseBranch: "main" },
    gates: [],
    grants: [
      { family: "files.read" as const, actor: "runtime" as const, paths: [repository.root] },
      { family: "network.access" as const, actor: "runtime" as const },
      { family: "network.access" as const, actor: "adapter" as const },
      { family: "network.access" as const, actor: "delivery" as const },
      { family: "credentials.use" as const, actor: "runtime" as const },
      { family: "credentials.use" as const, actor: "adapter" as const },
      { family: "credentials.use" as const, actor: "delivery" as const },
      {
        family: "git.commit" as const,
        actor: "runtime" as const,
        repositories: [repository.root],
        branchPrefixes: ["autopilot/"],
      },
      { family: "remote.push" as const, actor: "runtime" as const, repositories: [repository.root], remotes: ["origin"], branchPrefixes: ["autopilot/"] },
      { family: "change-request.observe" as const, actor: "delivery" as const, repositories: [repository.root] },
    ],
    restack: {
      schemaVersion: 1 as const,
      predecessorRunId: "amendment-run",
      predecessorCharterHash: "a".repeat(64),
      amendedItemId: "item-1",
      amendedCommit: repository.baseCommit,
      descendants: [{
        itemId: descendant.id,
        oldCommit: repository.baseCommit,
        oldTreeIdentity: "b".repeat(40),
        remote: "origin",
        remoteCommit: repository.baseCommit,
        changeRequest: { provider: "github" as const, id: "2", url: "https://example.invalid/pull/2", baseBranch: "item-1" },
        worktreePath: `${repository.root}-managed-item-2`,
        gateIds: [],
      }],
    },
  };

  const sealed = sealCharter(restack);

  assert.equal(sealed.restack?.descendants[0]?.itemId, "item-2");
  assert.throws(() => sealCharter({ ...restack, restack: { ...restack.restack, amendedCommit: "changed" } }), /restack successor/);
  for (const forbidden of [
    { family: "change-request.open" as const, actor: "delivery" as const },
    { family: "merge.execute" as const, actor: "runtime" as const },
    { family: "review-thread.resolve" as const, actor: "delivery" as const },
    { family: "files.write" as const, actor: "worker" as const, paths: [repository.root] },
  ]) {
    assert.throws(() => sealCharter({
      ...restack,
      grants: [...restack.grants, forbidden],
    }), /restack successor/);
  }
  assert.throws(() => sealCharter({
    ...restack,
    grants: restack.grants.filter(({ family }) => family !== "git.commit"),
  }), /restack successor/);
  assert.throws(() => sealCharter({
    ...restack,
    grants: restack.grants.filter(({ family }) => family !== "remote.push"),
  }), /restack successor/);
  for (const [family, actor] of [
    ["files.read", "runtime"],
    ["network.access", "adapter"],
    ["credentials.use", "adapter"],
    ["network.access", "runtime"],
    ["credentials.use", "runtime"],
    ["network.access", "delivery"],
    ["credentials.use", "delivery"],
    ["change-request.observe", "delivery"],
  ] as const) {
    assert.throws(() => sealCharter({
      ...restack,
      grants: restack.grants.filter((grant) => grant.family !== family || grant.actor !== actor),
    }), /restack successor/);
  }
  const commandGate = {
    id: "command-check",
    type: "command" as const,
    executable: "node",
    arguments: ["--version"],
    workingDirectory: ".",
    environmentNames: ["RESTACK_TEST_TOKEN"],
    appliesTo: [descendant.id],
  };
  const commandRestack = {
    ...restack,
    gates: [commandGate],
    grants: [
      ...restack.grants,
      {
        family: "process.execute" as const,
        actor: "runtime" as const,
        commands: ["node"],
        environmentNames: ["RESTACK_TEST_TOKEN"],
      },
      {
        family: "credentials.use" as const,
        actor: "runtime" as const,
        environmentNames: ["RESTACK_TEST_TOKEN"],
      },
    ],
    restack: {
      ...restack.restack,
      descendants: restack.restack.descendants.map((snapshot) => ({ ...snapshot, gateIds: [commandGate.id] })),
    },
  };
  sealCharter(commandRestack);
  assert.throws(() => sealCharter({
    ...commandRestack,
    grants: commandRestack.grants.filter(({ family }) => family !== "process.execute"),
  }), /restack successor/);
  assert.throws(() => sealCharter({
    ...commandRestack,
    grants: commandRestack.grants.filter((grant) =>
      grant.family !== "credentials.use" || grant.actor !== "runtime" || !("environmentNames" in grant)
    ),
  }), /restack successor/);
  const reviewGate = { id: "review-check", type: "review" as const, focus: "Correctness", appliesTo: [descendant.id] };
  const reviewRestack = {
    ...restack,
    gates: [reviewGate],
    grants: [
      ...restack.grants,
      { family: "files.read" as const, actor: "worker" as const, paths: [repository.root] },
    ],
    restack: {
      ...restack.restack,
      descendants: restack.restack.descendants.map((snapshot) => ({ ...snapshot, gateIds: [reviewGate.id] })),
    },
  };
  sealCharter(reviewRestack);
  assert.throws(() => sealCharter({
    ...reviewRestack,
    grants: reviewRestack.grants.filter((grant) => grant.family !== "files.read" || grant.actor !== "worker"),
  }), /restack successor/);
  assert.throws(() => sealCharter({
    ...restack,
    restack: {
      ...restack.restack,
      descendants: restack.restack.descendants.map((snapshot) => ({
        ...snapshot,
        changeRequest: { ...snapshot.changeRequest, id: "different" },
      })),
    },
  }), /restack successor/);
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
