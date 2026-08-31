import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CancelResult, CapabilityManifest, ExecutionHandle, ExecutionObservation, ExecutionRequest, HarnessPort } from "../src/adapter-protocol.js";
import { sealCharter } from "../src/charter.js";
import { AutopilotEngine } from "../src/engine.js";
import { recoverUnknownExecution } from "../src/execution-recovery.js";
import { AutopilotError } from "../src/errors.js";
import { newEventId, type LifecycleEvent } from "../src/events.js";
import { appendEvent, readJournal } from "../src/journal.js";
import { acquireWriterLease } from "../src/leases.js";
import { acquireRunLock } from "../src/lock.js";
import { rebuildProjection } from "../src/projection.js";
import { reduce } from "../src/reducer.js";
import { ensureWorktree, observeRepository, quarantineWorktree } from "../src/repository.js";
import { createRepository, proposedCharter } from "./helpers.js";

class NoLaunchAdapter implements HarnessPort {
  launches = 0;

  async describe(): Promise<CapabilityManifest> {
    return {
      protocolVersion: 1,
      adapterName: "no-launch",
      adapterVersion: "1",
      harnessVersion: "1",
      families: ["files.read", "files.write", "process.execute", "network.access", "credentials.use"],
      assurance: "cooperative",
      unattended: true,
      maxConcurrency: 1,
      eventStreaming: false,
      cancellation: true,
      restartReattachment: false,
      restrictions: "cooperative",
      limitations: [],
    };
  }

  async launch(_request: ExecutionRequest): Promise<ExecutionHandle> {
    this.launches += 1;
    throw new Error("adopted verification must not launch an implementation worker");
  }

  async observe(_handle: ExecutionHandle): Promise<ExecutionObservation> {
    throw new Error("no execution exists");
  }

  async cancel(_handle: ExecutionHandle): Promise<CancelResult> {
    return { protocolVersion: 1, accepted: false };
  }
}

class FailingReviewAdapter extends NoLaunchAdapter {
  override async launch(request: ExecutionRequest): Promise<ExecutionHandle> {
    this.launches += 1;
    if (request.role !== "review") {
      throw new Error("adopted verification must not launch an implementation worker");
    }
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "review execution failed deterministically");
  }
}

function event(reason: string) {
  return { eventId: newEventId(), timestamp: new Date().toISOString(), source: "runtime" as const, reason };
}

async function unknownRun(runId: string, withReview = false) {
  const repository = await createRepository();
  const proposed = proposedCharter(repository.root, repository.baseCommit, "single", runId);
  const proposedItem = proposed.work[0];
  assert.ok(proposedItem !== undefined);
  const charter = sealCharter(withReview ? {
    ...proposed,
    work: [{
      ...proposedItem,
      acceptance: [...proposedItem.acceptance, { type: "gate-passed", gateId: "independent-review" }],
    }],
    gates: [...proposed.gates, {
      id: "independent-review",
      type: "review",
      focus: "Correctness defects",
      appliesTo: [proposedItem.id],
    }],
  } : proposed);
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-recovery-"));
  const runDirectory = join(stateRoot, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const worktreePath = await ensureWorktree(charter, item);
  await writeFile(join(worktreePath, "result.txt"), "done\n");
  const attemptId = "attempt-unknown";
  const lease = await acquireWriterLease(runDirectory, item.id, item.branchName, worktreePath, attemptId, 30_000);
  const journalPath = join(runDirectory, "events.jsonl");
  const events: LifecycleEvent[] = [
    { ...event("compiled"), type: "CHARTER_COMPILED" },
    { ...event("reconcile"), type: "RECONCILIATION_STARTED" },
    { ...event("running"), type: "RECONCILIATION_COMPLETED" },
    { ...event("ready"), type: "ITEM_READY", itemId: item.id },
    {
      ...event("attempt"), type: "ATTEMPT_STARTED", itemId: item.id, attemptId, leaseEpoch: lease.epoch,
      expectedBaseCommit: repository.baseCommit, deadline: lease.expiresAt, idempotencyKey: "attempt:unknown",
    },
    { ...event("unknown"), type: "ITEM_BLOCKED", itemId: item.id, attemptId, errorCode: "EXECUTION_STATE_UNKNOWN" },
    {
      ...event("waiting"), type: "RUN_WAITING", itemId: item.id,
      waiting: { kind: "execution-unknown", itemId: item.id, attemptId },
    },
  ];
  for (const lifecycleEvent of events) {
    await appendEvent(journalPath, lifecycleEvent);
  }
  const journal = await readJournal(journalPath);
  const projection = rebuildProjection(charter, journal.records);
  const lock = await acquireRunLock(join(runDirectory, "run.lock"));
  return { repository, charter, item, runDirectory, worktreePath, attemptId, lease, projection, lock };
}

test("abandon recovery fences the exact attempt and permanently quarantines its worktree", async () => {
  const fixture = await unknownRun("run-recovery-abandon");
  try {
    const recovered = await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "abandon",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "I stopped and accounted for the old harness execution.",
      },
    );
    const attempt = recovered.items[fixture.item.id]?.attempts.at(-1);
    const journal = await readJournal(join(fixture.runDirectory, "events.jsonl"));
    const recovery = journal.records.at(-1)?.event;

    assert.equal(recovered.items[fixture.item.id]?.state, "READY");
    assert.equal(attempt?.outcome, "stale");
    assert.match(attempt?.quarantinedWorktreePath ?? "", /\.quarantine-/);
    await access(attempt?.quarantinedWorktreePath ?? "missing");
    assert.equal(recovery?.type, "EXECUTION_UNKNOWN_ABANDONED");
    assert.equal(recovery?.type === "EXECUTION_UNKNOWN_ABANDONED" ? recovery.lockTokenHash.length : 0, 64);
    assert.throws(() => reduce(recovered, {
      ...event("late terminal result"), type: "ATTEMPT_FINISHED", itemId: fixture.item.id,
      attemptId: fixture.attemptId, observedHeadCommit: fixture.repository.baseCommit, outcome: "completed",
    }), /cannot follow READY/);
    await assert.rejects(recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      recovered,
      fixture.lock,
      {
        action: "abandon",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "stale duplicate",
      },
    ), /does not match/);
  } finally {
    await fixture.lock.release();
  }
});

test("abandon recovery quarantines unauthorized changes instead of adopting them", async () => {
  const fixture = await unknownRun("run-recovery-unauthorized");
  try {
    await writeFile(join(fixture.worktreePath, "outside-authority.txt"), "preserve as evidence\n");
    const recovered = await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "abandon",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "I stopped the old execution and require suspect files to be preserved.",
      },
    );
    const quarantinePath = recovered.items[fixture.item.id]?.attempts.at(-1)?.quarantinedWorktreePath;

    assert.ok(quarantinePath !== undefined);
    await access(join(quarantinePath, "outside-authority.txt"));
  } finally {
    await fixture.lock.release();
  }
});

test("abandon recovery reconciles a crash after the worktree move", async () => {
  const fixture = await unknownRun("run-recovery-crash");
  try {
    const moved = await quarantineWorktree(
      fixture.repository.root,
      fixture.worktreePath,
      fixture.charter.runId,
      fixture.item.id,
      fixture.attemptId,
    );
    const recovered = await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "abandon",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "I stopped and accounted for the old harness execution.",
      },
    );

    assert.equal(recovered.items[fixture.item.id]?.attempts.at(-1)?.quarantinedWorktreePath, moved.path);
  } finally {
    await fixture.lock.release();
  }
});

test("adopt recovery seals the operator-confirmed exact tree without launching a worker", async () => {
  const fixture = await unknownRun("run-recovery-adopt");
  try {
    const observation = await observeRepository(fixture.worktreePath);
    const recovered = await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "adopt",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "I confirmed the old execution is inactive.",
        expectedTreeIdentity: observation.treeIdentity,
      },
    );
    const attempt = recovered.items[fixture.item.id]?.attempts.at(-1);

    assert.equal(recovered.items[fixture.item.id]?.state, "ACTIVE");
    assert.equal(attempt?.adoptedTree?.treeIdentity, observation.treeIdentity);
    assert.equal(attempt?.adoptedTree?.worktreePath, fixture.worktreePath);
    assert.equal(attempt?.outcome, "completed");
    assert.throws(() => reduce(recovered, {
      ...event("late terminal after adoption"), type: "ATTEMPT_FINISHED", itemId: fixture.item.id,
      attemptId: fixture.attemptId, observedHeadCommit: fixture.repository.baseCommit, outcome: "completed",
    }), /already recovered/);

    const journal = await readJournal(join(fixture.runDirectory, "events.jsonl"));
    const adapter = new NoLaunchAdapter();
    const engine = new AutopilotEngine({
      stateRoot: join(fixture.runDirectory, "..", ".."),
      runDirectory: fixture.runDirectory,
      charter: fixture.charter,
      adapter,
      records: journal.records,
      projection: recovered,
    });
    const report = await engine.run();

    assert.equal(report.state, "SUCCEEDED");
    assert.equal(adapter.launches, 0);
  } finally {
    await fixture.lock.release();
  }
});

test("adopted verification preserves an independent review failure code", async () => {
  const fixture = await unknownRun("run-recovery-review-failure", true);
  try {
    const observation = await observeRepository(fixture.worktreePath);
    await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "adopt",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "I confirmed the old execution is inactive.",
        expectedTreeIdentity: observation.treeIdentity,
      },
    );
    const journal = await readJournal(join(fixture.runDirectory, "events.jsonl"));
    const adapter = new FailingReviewAdapter();
    const engine = new AutopilotEngine({
      stateRoot: join(fixture.runDirectory, "..", ".."),
      runDirectory: fixture.runDirectory,
      charter: fixture.charter,
      adapter,
      records: journal.records,
      projection: rebuildProjection(fixture.charter, journal.records),
    });
    const report = await engine.run();

    assert.equal(report.items[0]?.blocker, "ADAPTER_UNSUPPORTED");
    assert.equal(report.waiting?.kind, undefined);
    assert.equal(adapter.launches, 1);
  } finally {
    await fixture.lock.release();
  }
});

test("stop recovery terminalizes the exact unknown attempt and preserves its fence evidence", async () => {
  const fixture = await unknownRun("run-recovery-stop");
  try {
    const recovered = await recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "stop",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "Stop this run and preserve the uncertain worktree.",
      },
    );
    const journal = await readJournal(join(fixture.runDirectory, "events.jsonl"));
    const stopped = journal.records.at(-1)?.event;

    assert.equal(recovered.state, "STOPPED");
    assert.equal(stopped?.type, "RUN_STOPPED");
    assert.equal(stopped?.type === "RUN_STOPPED" ? stopped.lockTokenHash?.length : 0, 64);
    assert.equal(stopped?.type === "RUN_STOPPED" ? stopped.leaseEpoch : undefined, fixture.lease.epoch);
  } finally {
    await fixture.lock.release();
  }
});

test("recovery rejects a replaced run-lock token before mutation", async () => {
  const fixture = await unknownRun("run-recovery-lock-replaced");
  const lockPath = join(fixture.runDirectory, "run.lock");
  await rm(lockPath, { recursive: true, force: true });
  const replacement = await acquireRunLock(lockPath);
  try {
    await assert.rejects(recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "abandon",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "stale lock must not recover",
      },
    ), /lock ownership changed/);
    await access(fixture.worktreePath);
    const journal = await readJournal(join(fixture.runDirectory, "events.jsonl"));
    assert.equal(journal.records.some(({ event: lifecycleEvent }) =>
      lifecycleEvent.type === "EXECUTION_UNKNOWN_ABANDONED"
    ), false);
  } finally {
    await replacement.release();
    await fixture.lock.release();
  }
});

test("recovery rejects a stale lease fence and an unconfirmed adopted tree", async () => {
  const fixture = await unknownRun("run-recovery-stale");
  try {
    await assert.rejects(recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "adopt",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch + 1,
        attestation: "stale fence",
        expectedTreeIdentity: "wrong",
      },
    ), /does not match/);
    await assert.rejects(recoverUnknownExecution(
      fixture.runDirectory,
      fixture.charter,
      fixture.projection,
      fixture.lock,
      {
        action: "adopt",
        itemId: fixture.item.id,
        attemptId: fixture.attemptId,
        leaseEpoch: fixture.lease.epoch,
        attestation: "tree mismatch",
        expectedTreeIdentity: "wrong",
      },
    ), /does not match --tree/);
  } finally {
    await fixture.lock.release();
  }
});
