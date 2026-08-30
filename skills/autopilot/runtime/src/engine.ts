import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  AttemptContext,
  CapabilityManifest,
  ExecutionHandle,
  ExecutionObservation,
  ExecutionRequest,
  HarnessPort,
} from "./adapter-protocol.js";
import { loadAmendmentContext, type AmendmentContext } from "./amendment.js";
import { attemptContextHash, buildAttemptContext } from "./attempt-context.js";
import type { GrantFamily, ReviewGate, RunCharter, WorkItem } from "./charter.js";
import { createDeliveryAdapter } from "./delivery-adapters.js";
import { changeRequestTitle, reviewThreadDigest, type ChangeRequestRef, type DeliveryPort, type ReviewThread } from "./delivery.js";
import { createPredicateEvaluationReceipt, evaluateItemDone, predicateIdentity } from "./done.js";
import { projectPredicateEvidence, projectReviewFindings } from "./evidence-map.js";
import { AutopilotError } from "./errors.js";
import { createReviewReceipt, executeItemGates, redactEnvironmentSecrets, storeReceipt } from "./evidence.js";
import { newEventId, type EventSource, type LifecycleEvent } from "./events.js";
import { blockedByDependency, runnableFrontier } from "./frontier.js";
import { appendEvent, type JournalRecord, writeImmutableJson, writeJsonAtomic } from "./journal.js";
import { canonicalJson, isRecord, sha256 } from "./json.js";
import { acquireWriterLease, leaseIsCurrent, readLease, retireWriterLease } from "./leases.js";
import { authorizeEffect, type AdapterCapabilities } from "./policy.js";
import { writeSnapshot } from "./projection.js";
import { reduce, type RunProjection, type VerifiedCheckpoint } from "./reducer.js";
import {
  assertWritablePaths,
  branchExists,
  commitAcceptedWork,
  ensureWorktree,
  inspectCommit,
  inspectPreCommitHook,
  inspectRepository,
  installRestackCandidate,
  observeRepository,
  prepareRestackCandidate,
  pushAmendmentBranch,
  pushBranch,
  remoteBranchCommit,
  resolveCommit,
  resolveWorktreePath,
  runPreCommitHook,
  type ManagedBranchExpectation,
  type RepositoryObservation,
} from "./repository.js";
import { writeReports, type RunReport } from "./report.js";

interface EngineOptions {
  readonly stateRoot: string;
  readonly runDirectory: string;
  readonly charter: RunCharter;
  readonly adapter: HarnessPort;
  readonly records: readonly JournalRecord[];
  readonly projection: RunProjection;
}

const RUNTIME_CAPABILITIES: AdapterCapabilities = {
  families: [
    "files.read", "files.write", "process.execute", "network.access", "credentials.use", "git.commit", "remote.push",
    "change-request.observe", "change-request.open", "change-request.update", "review-thread.resolve", "merge.execute",
  ],
  assurance: "enforced",
  maxConcurrency: 1,
  unattended: true,
  cancellation: true,
  restartReattachment: true,
};

function eventBase(reason: string, source: EventSource = "runtime"): {
  readonly eventId: string;
  readonly timestamp: string;
  readonly source: EventSource;
  readonly reason: string;
} {
  return { eventId: newEventId(), timestamp: new Date().toISOString(), source, reason };
}

function credentialValues(charter: RunCharter): readonly string[] {
  return charter.grants
    .filter(({ family }) => family === "credentials.use")
    .flatMap(({ environmentNames }) => environmentNames ?? [])
    .map((name) => process.env[name])
    .filter((value): value is string => value !== undefined);
}

function playbookRequests(charter: RunCharter): ReadonlySet<GrantFamily> {
  const requested = new Set<GrantFamily>(["files.read", "files.write", "process.execute", "network.access", "credentials.use", "git.commit"]);
  if (charter.delivery !== "local-commits") {
    requested.add("remote.push");
    if (charter.restack === undefined) {
      requested.add(charter.amends === undefined ? "change-request.open" : "change-request.update");
    } else {
      requested.add("change-request.observe");
    }
  }
  if (charter.reviewFeedback?.threads.some(({ resolve: shouldResolve }) => shouldResolve) === true) {
    requested.add("review-thread.resolve");
  }
  if (charter.delivery === "merge-verified") {
    requested.add("merge.execute");
  }
  return requested;
}

export class AutopilotEngine {
  readonly #stateRoot: string;
  readonly #runDirectory: string;
  readonly #charter: RunCharter;
  readonly #adapter: HarnessPort;
  readonly #requested: ReadonlySet<GrantFamily>;
  #records: JournalRecord[];
  #projection: RunProjection;
  #appendQueue: Promise<void> = Promise.resolve();
  #repositoryQueue: Promise<void> = Promise.resolve();
  #manifest: CapabilityManifest | undefined;
  #amendment: AmendmentContext | undefined;
  #stopRequested = false;
  #pauseRequested = false;
  #pauseRequestId: string | undefined;
  #waitAbort: AbortController | undefined;
  readonly #activeHandles = new Map<string, ExecutionHandle>();
  readonly #implementationHandleIds = new Set<string>();

  constructor(options: EngineOptions) {
    this.#stateRoot = options.stateRoot;
    this.#runDirectory = options.runDirectory;
    this.#charter = options.charter;
    this.#adapter = options.adapter;
    this.#records = [...options.records];
    this.#projection = options.projection;
    this.#pauseRequested = options.projection.pauseRequestId !== undefined
      && options.projection.waiting?.kind !== "operator-pause";
    this.#pauseRequestId = options.projection.pauseRequestId;
    this.#requested = playbookRequests(options.charter);
  }

  async requestStop(): Promise<void> {
    if (this.#stopRequested) {
      return;
    }
    this.#stopRequested = true;
    this.#waitAbort?.abort();
    await Promise.all([...this.#activeHandles.values()].map(async (handle) => {
      try {
        await this.#adapter.cancel(handle);
      } catch {
        // The coordinator still stops after the bounded process deadline.
      }
    }));
  }

  async requestPause(): Promise<void> {
    if (this.#stopRequested || this.#projection.state === "SUCCEEDED" || this.#projection.state === "STOPPED") {
      return;
    }
    this.#pauseRequested = true;
    this.#pauseRequestId ??= this.#projection.pauseRequestId ?? randomUUID();
    if (this.#projection.pauseRequestId === undefined) {
      await this.#record({
        ...eventBase("Coordinator accepted a fenced pause request", "operator"),
        type: "RUN_PAUSE_REQUESTED",
        requestId: this.#pauseRequestId,
      });
    }
    this.#waitAbort?.abort();
    await Promise.all([...this.#implementationHandleIds].flatMap((executionId) => {
      const handle = this.#activeHandles.get(executionId);
      if (handle === undefined) {
        return [];
      }
      return [this.#adapter.cancel(handle).catch(() => undefined)];
    }));
  }

  async #blockItemForStop(item: WorkItem, attemptId?: string): Promise<boolean> {
    if (!this.#stopRequested) {
      return false;
    }
    const state = this.#projection.items[item.id]?.state;
    if (state === "READY" || state === "ACTIVE" || state === "VERIFYING") {
      await this.#record({
        ...eventBase("Operator stop prevented further work", "operator"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        ...(attemptId === undefined ? {} : { attemptId }),
        errorCode: "OPERATOR_STOP",
      });
    }
    return true;
  }

  #hasUnobservedExecution(): boolean {
    return Object.values(this.#projection.items).some(({ attempts }) =>
      attempts.length > 0 && attempts.at(-1)?.outcome === undefined
    );
  }

  async #settlePauseIfRequested(): Promise<boolean> {
    if (!this.#pauseRequested || this.#stopRequested) {
      return false;
    }
    if (this.#activeHandles.size > 0) {
      return true;
    }
    if (Object.values(this.#projection.items).some(({ blocker }) => blocker === "EXECUTION_STATE_UNKNOWN")
      || this.#hasUnobservedExecution()) {
      return false;
    }
    for (const item of Object.values(this.#projection.items)) {
      const attempt = item.attempts.at(-1);
      if (attempt === undefined || attempt.outcome === undefined) {
        continue;
      }
      const lease = await readLease(this.#runDirectory, item.itemId);
      if (lease !== undefined && lease.retiredAt === undefined
        && lease.attemptId === attempt.attemptId && lease.epoch === attempt.leaseEpoch) {
        await retireWriterLease(this.#runDirectory, {
          itemId: item.itemId,
          attemptId: attempt.attemptId,
          epoch: attempt.leaseEpoch,
        });
      }
    }
    if (this.#projection.waiting?.kind !== "operator-pause") {
      await this.#record({
        ...eventBase("All coordinator-owned activity is quiescent", "operator"),
        type: "RUN_WAITING",
        waiting: { kind: "operator-pause", requestId: this.#pauseRequestId ?? randomUUID() },
      });
    }
    return true;
  }

  async #waitForUnknownExecution(): Promise<boolean> {
    const item = Object.values(this.#projection.items).find(({ blocker }) => blocker === "EXECUTION_STATE_UNKNOWN");
    const attempt = item?.attempts.at(-1);
    if (item === undefined || attempt === undefined) {
      return false;
    }
    await this.#record({
      ...eventBase("Executor quiescence cannot be proven; replacement launch is prohibited", "reconciler"),
      type: "RUN_WAITING",
      itemId: item.itemId,
      waiting: { kind: "execution-unknown", itemId: item.itemId, attemptId: attempt.attemptId },
    });
    return true;
  }

  async #stopRunIfRequested(): Promise<boolean> {
    if (!this.#stopRequested) {
      return false;
    }
    for (const item of Object.values(this.#projection.items)) {
      if (item.state === "ACTIVE" || item.state === "VERIFYING") {
        await this.#record({
          ...eventBase("Operator stopped before the item reached a completion boundary", "operator"),
          type: "ITEM_BLOCKED",
          itemId: item.itemId,
          errorCode: "OPERATOR_STOP",
        });
      }
    }
    await this.#record({
      ...eventBase("Coordinator received an interrupt request", "operator"),
      type: "RUN_STOPPED",
      errorCode: "OPERATOR_STOP",
      remediation: "Inspect preserved worktrees and create a successor charter to continue.",
    });
    return true;
  }

  async #record(event: LifecycleEvent): Promise<void> {
    let failure: unknown;
    this.#appendQueue = this.#appendQueue.then(async () => {
      try {
        const nextProjection = reduce(this.#projection, event);
        const record = await appendEvent(`${this.#runDirectory}/events.jsonl`, event);
        this.#projection = nextProjection;
        this.#records.push(record);
        await writeSnapshot(`${this.#runDirectory}/snapshot.json`, this.#projection, this.#records);
      } catch (error) {
        failure = error;
      }
    });
    await this.#appendQueue;
    if (failure !== undefined) {
      throw failure;
    }
  }

  async #withRepositoryLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#repositoryQueue;
    let release: () => void = () => undefined;
    this.#repositoryQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  #managedBranchExpectations(): readonly ManagedBranchExpectation[] {
    return this.#charter.work.map((item) => {
      const attempts = this.#records.flatMap(({ event }) =>
        event.type === "ATTEMPT_STARTED" && event.itemId === item.id ? [event] : []
      );
      const adopted = this.#records.findLast(({ event }) =>
        event.type === "WORKTREE_ADOPTED" && event.itemId === item.id
      )?.event;
      const confirmedCommit = this.#records.findLast(({ event }) =>
        event.type === "EFFECT_CONFIRMED" && event.itemId === item.id
          && (event.effect === "git.commit" || event.effect === "restack.local-ref")
      )?.event;
      const predecessorId = item.dependsOn.at(-1);
      const predecessorCommit = predecessorId === undefined
        ? undefined
        : this.#records.findLast(({ event }) =>
          event.type === "EFFECT_CONFIRMED" && event.itemId === predecessorId
            && (event.effect === "git.commit" || event.effect === "restack.local-ref")
        )?.event;
      const expectedCommit = confirmedCommit?.type === "EFFECT_CONFIRMED"
        ? confirmedCommit.observedState
        : adopted?.type === "WORKTREE_ADOPTED"
          ? adopted.acceptedCommit
          : attempts.at(-1)?.expectedBaseCommit
            ?? (predecessorCommit?.type === "EFFECT_CONFIRMED"
              ? predecessorCommit.observedState
              : this.#charter.repository.baseCommit);
      return {
        branchName: item.branchName,
        expectedCommit,
        required: attempts.length > 0 || adopted?.type === "WORKTREE_ADOPTED",
      };
    });
  }

  async #observeRepository(worktreePath: string): Promise<RepositoryObservation> {
    return await this.#withRepositoryLock(async () =>
      await observeRepository(worktreePath, this.#managedBranchExpectations())
    );
  }

  #executionSupervisionEnabled(): boolean {
    return this.#manifest?.restartReattachment === true && this.#adapter.reattach !== undefined;
  }

  #implementationRequest(
    item: WorkItem,
    attemptId: string,
    worktreePath: string,
    context: AttemptContext,
    contextHash: string,
    deadline: string,
  ): ExecutionRequest {
    return {
      protocolVersion: 1,
      role: "implementation",
      runId: this.#charter.runId,
      itemId: item.id,
      attemptId,
      worktreePath,
      objective: item.objective,
      acceptanceSummary: item.acceptance.map((predicate) => JSON.stringify(predicate)).join("; "),
      context,
      contextHash,
      writableRoots: item.writableRoots,
      grants: this.#charter.grants.filter(({ actor }) => actor === "worker" || actor === "adapter"),
      deadline,
      idleTimeoutMs: this.#charter.limits.idleTimeoutMs,
      maximumLineBytes: this.#charter.limits.maxAdapterLineBytes,
      maximumOutputBytes: this.#charter.limits.maxRetainedOutputBytes,
      ...(this.#executionSupervisionEnabled() ? { supervisionDirectory: this.#runDirectory } : {}),
    };
  }

  #runtimeAuthorize(family: GrantFamily, details: Omit<Parameters<typeof authorizeEffect>[0], "family" | "actor"> = {}): void {
    authorizeEffect({ family, actor: "runtime", ...details }, this.#requested, this.#charter.grants, RUNTIME_CAPABILITIES);
  }

  #adapterAuthorize(family: GrantFamily): void {
    if (this.#manifest === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter capabilities have not been loaded");
    }
    authorizeEffect(
      { family, actor: "adapter" },
      this.#requested,
      this.#charter.grants,
      {
        families: this.#manifest.families,
        assurance: this.#manifest.assurance,
        maxConcurrency: this.#manifest.maxConcurrency,
        unattended: this.#manifest.unattended,
        cancellation: this.#manifest.cancellation,
        restartReattachment: this.#manifest.restartReattachment,
      },
    );
  }

  #deliveryAuthorize(family: GrantFamily, details: Omit<Parameters<typeof authorizeEffect>[0], "family" | "actor"> = {}): void {
    authorizeEffect({ family, actor: "delivery", ...details }, this.#requested, this.#charter.grants, RUNTIME_CAPABILITIES);
  }

  #workerAuthorize(family: GrantFamily, details: Omit<Parameters<typeof authorizeEffect>[0], "family" | "actor"> = {}): void {
    if (this.#manifest === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter capabilities have not been loaded");
    }
    authorizeEffect(
      { family, actor: "worker", ...details },
      this.#requested,
      this.#charter.grants,
      {
        families: this.#manifest.families,
        assurance: this.#manifest.assurance,
        maxConcurrency: this.#manifest.maxConcurrency,
        unattended: this.#manifest.unattended,
        cancellation: this.#manifest.cancellation,
        restartReattachment: this.#manifest.restartReattachment,
      },
    );
  }

  async #preflight(): Promise<void> {
    this.#amendment = await loadAmendmentContext(this.#stateRoot, this.#charter, this.#records);
    if (this.#amendment?.reconciledCommit !== undefined) {
      await this.#record({
        ...eventBase("Runtime-owned commit reconciled after an interrupted journal confirmation", "reconciler"),
        type: "EFFECT_CONFIRMED",
        itemId: this.#amendment.predecessorItem.id,
        effect: "git.commit",
        idempotencyKey: this.#amendment.reconciledCommit.idempotencyKey,
        observedState: this.#amendment.reconciledCommit.commit,
      });
    }
    for (const item of this.#charter.work) {
      const itemProjection = this.#projection.items[item.id];
      const attempt = itemProjection?.attempts.at(-1);
      if ((itemProjection?.state === "ACTIVE" || itemProjection?.state === "VERIFYING") && attempt !== undefined) {
        if (attempt.contextHash !== undefined) {
          let storedContext: unknown;
          try {
            storedContext = JSON.parse(await readFile(join(this.#runDirectory, "reports", "attempts", `${attempt.attemptId}.context.json`), "utf8")) as unknown;
          } catch (error) {
            throw new AutopilotError("JOURNAL_CORRUPT", "interrupted attempt context artifact is missing or malformed", {
              cause: error instanceof Error ? error.message : String(error),
            });
          }
          const attemptRecord = this.#records.find(({ event }) =>
            event.type === "ATTEMPT_STARTED" && event.attemptId === attempt.attemptId
          );
          if (!isRecord(storedContext) || sha256(canonicalJson(storedContext)) !== attempt.contextHash
            || storedContext.sourceJournalSequence !== attempt.contextJournalSequence
            || attemptRecord === undefined || attemptRecord.sequence !== (attempt.contextJournalSequence ?? -1) + 1
            || storedContext.sourceJournalRecordHash !== attemptRecord.previousHash) {
            throw new AutopilotError("JOURNAL_CORRUPT", "interrupted attempt context identity changed");
          }
        }
        const lease = await readLease(this.#runDirectory, item.id);
        const hasIdentityBaseline = attempt.expectedRefIdentity !== undefined
          || attempt.expectedConfigurationIdentity !== undefined || attempt.expectedHookIdentity !== undefined;
        if (lease === undefined && hasIdentityBaseline) {
          throw new AutopilotError("JOURNAL_CORRUPT", "interrupted attempt is missing its writer lease identity");
        }
        if (lease !== undefined) {
          const expectedWorktreePath = this.#amendment?.worktreePath
            ?? await resolveWorktreePath(this.#charter, item);
          if (lease.itemId !== item.id || lease.branchName !== item.branchName || lease.worktreePath !== expectedWorktreePath
            || lease.attemptId !== attempt.attemptId || lease.epoch !== attempt.leaseEpoch) {
            throw new AutopilotError("JOURNAL_CORRUPT", "interrupted attempt writer lease changed identity");
          }
          if (itemProjection.state === "ACTIVE" && attempt.outcome === undefined
            && attempt.executionSupervised === true && this.#executionSupervisionEnabled()) {
            continue;
          }
          const observed = await this.#observeRepository(lease.worktreePath);
          const confirmedCommit = this.#records.flatMap(({ event }) =>
            event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "git.commit"
              ? [event.observedState]
              : []
          ).at(-1);
          const reconciledCommit = this.#amendment?.reconciledCommit?.commit;
          if (itemProjection.state === "ACTIVE" && observed.headCommit !== attempt.expectedBaseCommit) {
            throw new AutopilotError("BRANCH_COLLISION", "active worker attempt changed HEAD before reconciliation");
          }
          if (itemProjection.state === "VERIFYING" && observed.headCommit !== attempt.expectedBaseCommit
            && observed.headCommit !== confirmedCommit && observed.headCommit !== reconciledCommit) {
            throw new AutopilotError("BRANCH_COLLISION", "verifying attempt has an unowned HEAD commit");
          }
          const confirmedPush = this.#records.findLast(({ event }) =>
            event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "remote.push"
          )?.event;
          const expectedExternalRefIdentity = confirmedPush?.type === "EFFECT_CONFIRMED"
            ? confirmedPush.repositoryExternalRefIdentity
            : undefined;
          const externalRefIdentity = expectedExternalRefIdentity
            ?? itemProjection.verified?.externalRefIdentity
            ?? attempt.expectedExternalRefIdentity;
          const legacyAuxiliaryRefIdentity = confirmedPush?.type === "EFFECT_CONFIRMED"
            ? confirmedPush.repositoryAuxiliaryRefIdentity
            : undefined;
          const auxiliaryRefIdentity = legacyAuxiliaryRefIdentity
            ?? itemProjection.verified?.auxiliaryRefIdentity
            ?? attempt.expectedRefIdentity;
          if ((externalRefIdentity !== undefined && observed.externalRefIdentity !== externalRefIdentity)
            || (externalRefIdentity === undefined && auxiliaryRefIdentity !== undefined
              && observed.auxiliaryRefIdentity !== auxiliaryRefIdentity)) {
            throw new AutopilotError("BRANCH_COLLISION", "Git refs changed during an interrupted attempt");
          }
          if (attempt.expectedConfigurationIdentity !== undefined
            && observed.configurationIdentity !== attempt.expectedConfigurationIdentity) {
            throw new AutopilotError("CAPABILITY_DENIED", "Git configuration changed during an interrupted attempt");
          }
          if (attempt.expectedHookIdentity !== undefined) {
            const hook = await inspectPreCommitHook(lease.worktreePath);
            if (hook.identity !== attempt.expectedHookIdentity || hook.path !== attempt.expectedHookPath) {
              throw new AutopilotError("CAPABILITY_DENIED", "pre-commit hook changed during an interrupted attempt");
            }
          }
        }
      }
    }
    for (const item of this.#charter.work) {
      if (this.#charter.restack === undefined) {
        for (const root of item.writableRoots) {
          const absoluteRoot = resolve(this.#charter.repository.root, root);
          this.#workerAuthorize("files.read", { path: absoluteRoot });
          this.#workerAuthorize("files.write", { path: absoluteRoot });
        }
      }
      for (const predicate of item.acceptance) {
        if (predicate.type === "path-present" || predicate.type === "path-absent") {
          this.#runtimeAuthorize("files.read", { path: resolve(this.#charter.repository.root, predicate.path) });
        } else if (predicate.type === "search-count") {
          predicate.paths.forEach((path) => this.#runtimeAuthorize("files.read", { path: resolve(this.#charter.repository.root, path) }));
        }
      }
    }
    if (this.#charter.restack === undefined) {
      this.#workerAuthorize("process.execute");
    }
    this.#adapterAuthorize("network.access");
    this.#adapterAuthorize("credentials.use");
    this.#runtimeAuthorize("git.commit", { repository: this.#charter.repository.root });
    if (this.#charter.restack === undefined && this.#charter.commitPolicy?.preCommitHook === "run") {
      for (const root of this.#charter.commitPolicy.writableRoots) {
        const path = resolve(this.#charter.repository.root, root);
        this.#runtimeAuthorize("files.read", { path });
        this.#runtimeAuthorize("files.write", { path });
      }
      for (const environmentName of this.#charter.commitPolicy.environmentNames) {
        this.#runtimeAuthorize("credentials.use", { environmentName });
      }
    }
    for (const gate of this.#charter.gates) {
      if (gate.type === "command") {
        this.#runtimeAuthorize("process.execute", { executable: gate.executable });
        for (const environmentName of gate.environmentNames) {
          this.#runtimeAuthorize("process.execute", { executable: gate.executable, environmentName });
          this.#runtimeAuthorize("credentials.use", { environmentName });
        }
      } else if (gate.type === "search") {
        gate.paths.forEach((path) => this.#runtimeAuthorize("files.read", { path: resolve(this.#charter.repository.root, path) }));
      }
    }
    if (this.#charter.delivery !== "local-commits") {
      const target = this.#charter.deliveryTarget;
      if (target === undefined) {
        throw new AutopilotError("CHARTER_INVALID", "remote delivery target is missing");
      }
      this.#runtimeAuthorize("remote.push", { repository: this.#charter.repository.root, remote: target.remote });
      this.#runtimeAuthorize("network.access");
      this.#runtimeAuthorize("credentials.use");
      this.#deliveryAuthorize("network.access");
      this.#deliveryAuthorize("credentials.use");
      if (this.#charter.restack === undefined) {
        this.#deliveryAuthorize(
          this.#amendment === undefined ? "change-request.open" : "change-request.update",
          { repository: this.#charter.repository.root },
        );
      } else {
        this.#deliveryAuthorize("change-request.observe", { repository: this.#charter.repository.root });
      }
      if (this.#charter.reviewFeedback?.threads.some(({ resolve: shouldResolve }) => shouldResolve) === true) {
        this.#deliveryAuthorize("review-thread.resolve", { repository: this.#charter.repository.root });
      }
      if (this.#charter.delivery === "merge-verified") {
        this.#deliveryAuthorize("merge.execute", { repository: this.#charter.repository.root });
      }
      for (const item of this.#charter.work) {
        const remoteCommit = await remoteBranchCommit(this.#charter.repository.root, target.remote, item.branchName);
        if (this.#amendment !== undefined) {
          const localCommit = await resolveCommit(this.#charter.repository.root, item.branchName);
          if (remoteCommit === undefined || (remoteCommit !== this.#amendment.deliveryBaseCommit && remoteCommit !== localCommit)) {
            throw new AutopilotError("BRANCH_COLLISION", "remote amendment branch no longer matches the verified amendment lineage");
          }
          this.#amendment = { ...this.#amendment, deliveryBaseCommit: remoteCommit };
          const delivery = createDeliveryAdapter(target.provider);
          await delivery.describe();
          const observed = await delivery.observeChangeRequest(this.#charter.repository.root, this.#amendment.changeRequest);
          if (observed.ref.url !== this.#amendment.changeRequest.url || observed.state !== "open"
            || observed.headCommit !== remoteCommit || observed.baseBranch !== target.baseBranch) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "predecessor change request is no longer open at the accepted commit");
          }
          const reviewResolutionStarted = this.#records.some(({ event }) =>
            event.type === "EFFECT_INTENDED" && event.effect === "review-thread.resolve"
          );
          await this.#validateReviewFeedback(delivery, observed.ref, reviewResolutionStarted ? "either" : "unresolved");
          if (!this.#records.some(({ event }) => event.type === "WORKTREE_ADOPTED")) {
            await this.#record({
              ...eventBase("Successful predecessor worktree adopted for a sealed amendment"),
              type: "WORKTREE_ADOPTED",
              itemId: item.id,
              predecessorRunId: this.#amendment.predecessorCharter.runId,
              predecessorItemId: this.#amendment.predecessorItem.id,
              worktreePath: this.#amendment.worktreePath,
              branchName: item.branchName,
              acceptedCommit: this.#amendment.acceptedCommit,
              changeRequestUrl: this.#amendment.changeRequest.url,
            });
          }
          continue;
        }
        if (remoteCommit === undefined) {
          continue;
        }
        const localMatches = await branchExists(this.#charter.repository.root, item.branchName)
          && await resolveCommit(this.#charter.repository.root, item.branchName) === remoteCommit;
        if (!localMatches) {
          throw new AutopilotError("BRANCH_COLLISION", `remote branch already exists at a different identity: ${target.remote}/${item.branchName}`);
        }
      }
    }
  }

  async #validateReviewFeedback(
    delivery: DeliveryPort,
    reference: ChangeRequestRef,
    requiredState: "unresolved" | "resolved" | "either",
  ): Promise<readonly ReviewThread[]> {
    const feedback = this.#charter.reviewFeedback;
    if (feedback === undefined) {
      return [];
    }
    const observed = await delivery.observeReviewThreads(this.#charter.repository.root, reference);
    return feedback.threads.map((selected) => {
      const thread = observed.find(({ id }) => id === selected.threadId);
      if (thread === undefined || (selected.resolve && !thread.resolvable) || reviewThreadDigest(thread) !== selected.contentHash
        || !thread.comments.some(({ url }) => url === selected.url)) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `review thread ${selected.threadId} changed or is no longer resolvable`);
      }
      if (selected.resolve && requiredState === "unresolved" && thread.resolved) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `review thread ${selected.threadId} was already resolved before the amendment started`);
      }
      if (selected.resolve && requiredState === "resolved" && !thread.resolved) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `review thread ${selected.threadId} was not confirmed resolved`);
      }
      return thread;
    });
  }

  async #resolveReviewFeedback(
    delivery: DeliveryPort,
    reference: ChangeRequestRef,
    item: WorkItem,
    expectedHeadCommit: string,
  ): Promise<void> {
    const feedback = this.#charter.reviewFeedback;
    if (feedback === undefined) {
      return;
    }
    const threadIds = feedback.threads.filter(({ resolve: shouldResolve }) => shouldResolve).map(({ threadId }) => threadId);
    const current = await delivery.observeChangeRequest(this.#charter.repository.root, reference);
    if (current.ref.url !== reference.url || current.state !== "open" || current.headCommit !== expectedHeadCommit
      || current.baseBranch !== this.#charter.deliveryTarget?.baseBranch) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "change request changed before review-thread resolution");
    }
    const selectedThreads = await this.#validateReviewFeedback(delivery, reference, "either");
    if (this.#stopRequested || this.#pauseRequested || threadIds.length === 0) {
      return;
    }
    this.#deliveryAuthorize("review-thread.resolve", { repository: this.#charter.repository.root });
    const idempotencyKey = `review-thread.resolve:${reference.provider}:${reference.id}:${sha256(canonicalJson(threadIds))}`;
    const alreadyConfirmed = this.#records.some(({ event }) =>
      event.type === "EFFECT_CONFIRMED" && event.effect === "review-thread.resolve" && event.idempotencyKey === idempotencyKey
    );
    if (alreadyConfirmed) {
      await this.#validateReviewFeedback(delivery, reference, "resolved");
      return;
    }
    const intended = this.#records.some(({ event }) =>
      event.type === "EFFECT_INTENDED" && event.effect === "review-thread.resolve" && event.idempotencyKey === idempotencyKey
    );
    if (!intended) {
      await this.#record({
        ...eventBase("Recording exact review-thread resolution intent after verified delivery"),
        type: "EFFECT_INTENDED",
        itemId: item.id,
        effect: "review-thread.resolve",
        idempotencyKey,
        expectedState: canonicalJson({ headCommit: expectedHeadCommit, threadIds }),
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    const resolvableIds = new Set(threadIds);
    const unresolved = selectedThreads.filter(({ id, resolved }) => resolvableIds.has(id) && !resolved).map(({ id }) => id);
    if (unresolved.length > 0) {
      await delivery.resolveReviewThreads(this.#charter.repository.root, reference, unresolved);
    }
    await this.#validateReviewFeedback(delivery, reference, "resolved");
    await this.#record({
      ...eventBase("Provider confirmed exact review threads resolved at the verified successor head"),
      type: "EFFECT_CONFIRMED",
      itemId: item.id,
      effect: "review-thread.resolve",
      idempotencyKey,
      observedState: canonicalJson({ headCommit: expectedHeadCommit, threadIds }),
    });
  }

  async #reattachInterruptedExecution(
    item: WorkItem,
    attempt: RunProjection["items"][string]["attempts"][number],
  ): Promise<ExecutionObservation["status"] | "stale" | false> {
    if (attempt.outcome !== undefined || attempt.executionSupervised !== true || !this.#executionSupervisionEnabled()) {
      return false;
    }
    const lease = await readLease(this.#runDirectory, item.id);
    if (lease === undefined || lease.attemptId !== attempt.attemptId || lease.epoch !== attempt.leaseEpoch) {
      throw new AutopilotError("JOURNAL_CORRUPT", "supervised interrupted attempt is missing its exact writer lease");
    }
    const contextPath = join(this.#runDirectory, "reports", "attempts", `${attempt.attemptId}.context.json`);
    const storedContext = JSON.parse(await readFile(contextPath, "utf8")) as unknown;
    if (!isRecord(storedContext) || attempt.contextHash === undefined
      || sha256(canonicalJson(storedContext)) !== attempt.contextHash) {
      throw new AutopilotError("JOURNAL_CORRUPT", "supervised interrupted attempt context changed");
    }
    const request = this.#implementationRequest(
      item,
      attempt.attemptId,
      lease.worktreePath,
      storedContext as unknown as AttemptContext,
      attempt.contextHash,
      attempt.deadline,
    );
    const reattach = this.#adapter.reattach;
    if (reattach === undefined) {
      return false;
    }
    const existingHandle = await reattach.call(this.#adapter, request);
    const handle = existingHandle ?? await this.#adapter.launch(request);
    this.#activeHandles.set(handle.adapterExecutionId, handle);
    this.#implementationHandleIds.add(handle.adapterExecutionId);
    let observation: ExecutionObservation;
    try {
      observation = await this.#adapter.observe(handle);
    } finally {
      this.#activeHandles.delete(handle.adapterExecutionId);
      this.#implementationHandleIds.delete(handle.adapterExecutionId);
    }
    const attemptsDirectory = join(this.#runDirectory, "reports", "attempts");
    const observationPath = join(attemptsDirectory, `${attempt.attemptId}.json`);
    await writeJsonAtomic(observationPath, observation);
    const currentLease = await readLease(this.#runDirectory, item.id);
    const after = await this.#observeRepository(lease.worktreePath);
    const leaseIdentityCurrent = currentLease !== undefined
      && currentLease.attemptId === attempt.attemptId && currentLease.epoch === attempt.leaseEpoch;
    const stale = !leaseIdentityCurrent || !leaseIsCurrent(currentLease, attempt.attemptId);
    if (after.headCommit !== attempt.expectedBaseCommit) {
      throw new AutopilotError("BRANCH_COLLISION", "reattached worker changed HEAD before reconciliation");
    }
    if (attempt.expectedExternalRefIdentity !== undefined
      && after.externalRefIdentity !== attempt.expectedExternalRefIdentity) {
      throw new AutopilotError("BRANCH_COLLISION", "reattached worker changed a Git ref");
    }
    if (attempt.expectedConfigurationIdentity !== undefined
      && after.configurationIdentity !== attempt.expectedConfigurationIdentity) {
      throw new AutopilotError("CAPABILITY_DENIED", "reattached worker changed Git configuration");
    }
    await assertWritablePaths(lease.worktreePath, after.changedPaths, item.writableRoots);
    await this.#record({
      ...eventBase(stale ? "Late supervised adapter result quarantined" : "Supervised adapter execution reattached and observed", "reconciler"),
      type: "ATTEMPT_FINISHED",
      itemId: item.id,
      attemptId: attempt.attemptId,
      observedHeadCommit: after.headCommit,
      observedTreeIdentity: after.treeIdentity,
      outcome: stale ? "stale" : observation.status,
      evidence: [observationPath],
    });
    if (leaseIdentityCurrent) {
      await retireWriterLease(this.#runDirectory, {
        itemId: item.id,
        attemptId: attempt.attemptId,
        epoch: attempt.leaseEpoch,
      });
    }
    return stale ? "stale" : observation.status;
  }

  async #reconcileInterruptedItems(): Promise<void> {
    for (const item of this.#charter.work) {
      const itemProjection = this.#projection.items[item.id];
      if (itemProjection?.state !== "ACTIVE" && itemProjection?.state !== "VERIFYING") {
        continue;
      }
      const attempt = itemProjection.attempts.at(-1);
      if (attempt === undefined) {
        continue;
      }
      if (itemProjection.verified !== undefined) {
        continue;
      }
      const reconciledCommit = this.#amendment?.reconciledCommit;
      if (itemProjection.state === "VERIFYING" && this.#amendment !== undefined
        && reconciledCommit?.attemptId === attempt.attemptId) {
        const delivered = await this.#deliverItem(item, this.#amendment.worktreePath, reconciledCommit.commit);
        if (!delivered) {
          await this.#blockItemForStop(item, attempt.attemptId);
          continue;
        }
        if (await this.#blockItemForStop(item, attempt.attemptId)) {
          continue;
        }
        await this.#record({
          ...eventBase("Interrupted verified commit and delivery reconciled", "reconciler"),
          type: "ITEM_SATISFIED",
          itemId: item.id,
          attemptId: attempt.attemptId,
          subject: `tree:${reconciledCommit.treeIdentity}`,
        });
        continue;
      }
      if (itemProjection.state === "ACTIVE") {
        const reattachedStatus = await this.#reattachInterruptedExecution(item, attempt);
        if (reattachedStatus !== false) {
          if (reattachedStatus === "cancelled" && this.#projection.pauseRequestId !== undefined) {
            await this.#record({
              ...eventBase("Pause-cancelled supervised execution was observed after coordinator restart", "reconciler"),
              type: "ATTEMPT_PAUSED",
              itemId: item.id,
              attemptId: attempt.attemptId,
            });
          } else {
            await this.#record({
              ...eventBase("Supervised execution reached a durable terminal observation after coordinator restart", "reconciler"),
              type: "ITEM_BLOCKED",
              itemId: item.id,
              attemptId: attempt.attemptId,
              errorCode: "INTERRUPTED_ATTEMPT",
            });
          }
          continue;
        }
      }
      if (itemProjection.state === "ACTIVE" && attempt.outcome === "cancelled"
        && this.#projection.pauseRequestId !== undefined) {
        await this.#record({
          ...eventBase("Pause-cancelled execution was already observed before coordinator loss", "reconciler"),
          type: "ATTEMPT_PAUSED",
          itemId: item.id,
          attemptId: attempt.attemptId,
        });
        continue;
      }
      const executionUnknown = itemProjection.state === "ACTIVE" && attempt.outcome === undefined;
      await this.#record({
        ...eventBase(
          executionUnknown
            ? "Coordinator loss left executor quiescence unknown"
            : "Durably finished execution was interrupted before its next checkpoint",
          "reconciler",
        ),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId: attempt.attemptId,
        errorCode: executionUnknown ? "EXECUTION_STATE_UNKNOWN" : "INTERRUPTED_ATTEMPT",
      });
    }
  }

  #effectIntent(idempotencyKey: string): Extract<LifecycleEvent, { readonly type: "EFFECT_INTENDED" }> | undefined {
    return this.#records.findLast(({ event }) =>
      event.type === "EFFECT_INTENDED" && event.idempotencyKey === idempotencyKey
    )?.event as Extract<LifecycleEvent, { readonly type: "EFFECT_INTENDED" }> | undefined;
  }

  #effectConfirmation(idempotencyKey: string): Extract<LifecycleEvent, { readonly type: "EFFECT_CONFIRMED" }> | undefined {
    return this.#records.findLast(({ event }) =>
      event.type === "EFFECT_CONFIRMED" && event.idempotencyKey === idempotencyKey
    )?.event as Extract<LifecycleEvent, { readonly type: "EFFECT_CONFIRMED" }> | undefined;
  }

  async #validateVerifiedCheckpointEvidence(item: WorkItem, checkpoint: VerifiedCheckpoint): Promise<void> {
    const checkpointReceiptIds = [...checkpoint.receiptIds];
    if (new Set(checkpointReceiptIds).size !== checkpointReceiptIds.length) {
      throw new AutopilotError("RECEIPT_STALE", "verified checkpoint contains duplicate receipt identities");
    }
    const receiptEvents = checkpointReceiptIds.map((receiptId) => this.#records.findLast(({ event }) =>
      event.type === "RECEIPT_RECORDED" && event.itemId === item.id && event.attemptId === checkpoint.attemptId
        && event.receiptId === receiptId
    )?.event).filter((event): event is Extract<LifecycleEvent, { readonly type: "RECEIPT_RECORDED" }> =>
      event?.type === "RECEIPT_RECORDED"
    );
    const restackGateIds = this.#charter.restack?.descendants.find(({ itemId }) => itemId === item.id)?.gateIds;
    const requiredGateIds = new Set(restackGateIds ?? item.acceptance.flatMap((predicate) =>
      predicate.type === "gate-passed" ? [predicate.gateId] : []
    ));
    const requiredGates = this.#charter.gates.filter(({ id }) => requiredGateIds.has(id));
    const predicateEvents = receiptEvents.filter(({ receiptKind }) => receiptKind === "predicate");
    if (receiptEvents.length !== checkpointReceiptIds.length || predicateEvents.length !== 1
      || requiredGates.some((gate) => !receiptEvents.some((event) =>
        (event.receiptKind === "gate" || event.receiptKind === "review") && event.gateId === gate.id
      ))) {
      throw new AutopilotError("RECEIPT_STALE", "verified checkpoint receipt set is incomplete");
    }
    for (const receiptEvent of receiptEvents) {
      let value: unknown;
      try {
        value = JSON.parse(await readFile(join(this.#runDirectory, "receipts", `${receiptEvent.receiptId}.json`), "utf8")) as unknown;
      } catch (error) {
        throw new AutopilotError("RECEIPT_STALE", "verified checkpoint receipt is missing or malformed", {
          receiptId: receiptEvent.receiptId,
          cause: String(error),
        });
      }
      if (!isRecord(value) || value.receiptId !== receiptEvent.receiptId) {
        throw new AutopilotError("RECEIPT_STALE", "verified checkpoint receipt identity is malformed");
      }
      const { receiptId: _receiptId, ...payload } = value;
      if (sha256(canonicalJson(payload)) !== receiptEvent.receiptId
        || value.runId !== this.#charter.runId || value.itemId !== item.id
        || receiptEvent.subject !== checkpoint.subject
        || value.subject !== checkpoint.subject || value.status !== receiptEvent.status) {
        throw new AutopilotError("RECEIPT_STALE", "verified checkpoint receipt no longer matches its exact subject");
      }
      if (receiptEvent.receiptKind === "predicate") {
        const results = value.results;
        if (receiptEvent.status !== "PASSED" || value.type !== "predicate-evaluation" || !Array.isArray(results)
          || results.length !== item.acceptance.length
          || item.acceptance.some((predicate, predicateIndex) => {
            const result: unknown = results[predicateIndex];
            return !isRecord(result) || result.predicateIndex !== predicateIndex || result.outcome !== "met"
              || result.subject !== checkpoint.subject
              || result.predicateId !== predicateIdentity(item.id, predicateIndex, predicate)
              || canonicalJson(result.predicate) !== canonicalJson(predicate);
          })) {
          throw new AutopilotError("RECEIPT_STALE", "verified checkpoint predicate evidence is not a complete passing evaluation");
        }
        continue;
      }
      const gate = requiredGates.find(({ id }) => id === receiptEvent.gateId);
      const waiver = receiptEvent.status === "WAIVED"
        ? this.#charter.waivers.find(({ gateId }) => gateId === receiptEvent.gateId)
        : undefined;
      const waiverValid = waiver !== undefined && gate?.type !== "review"
        && value.waiverReason === waiver.reason && `${value.stdout}\n${value.stderr}`.includes(waiver.failurePattern)
        && (receiptEvent.evidence?.length ?? 0) > 0
        && waiver.alternativeGateIds.every((alternativeGateId) => receiptEvents.some((event) =>
          event.gateId === alternativeGateId && event.status === "PASSED"
        ));
      const statusAccepted = receiptEvent.status === "PASSED" || waiverValid;
      if (gate === undefined || !statusAccepted || value.gateId !== gate.id
        || value.gateDefinitionHash !== sha256(canonicalJson(gate))) {
        throw new AutopilotError("RECEIPT_STALE", "verified checkpoint gate evidence does not match the sealed passing gate");
      }
    }
  }

  async #completeVerifiedItem(item: WorkItem, worktreePath: string, checkpoint: VerifiedCheckpoint): Promise<void> {
    await this.#validateVerifiedCheckpointEvidence(item, checkpoint);
    let observation = await this.#observeRepository(worktreePath);
    const confirmedPush = this.#records.findLast(({ event }) =>
      event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "remote.push"
    )?.event;
    const expectedExternalRefIdentity = confirmedPush?.type === "EFFECT_CONFIRMED"
      ? confirmedPush.repositoryExternalRefIdentity ?? checkpoint.externalRefIdentity
      : checkpoint.externalRefIdentity;
    const expectedAuxiliaryRefIdentity = confirmedPush?.type === "EFFECT_CONFIRMED"
      ? confirmedPush.repositoryAuxiliaryRefIdentity ?? checkpoint.auxiliaryRefIdentity
      : checkpoint.auxiliaryRefIdentity;
    if ((expectedExternalRefIdentity !== undefined && observation.externalRefIdentity !== expectedExternalRefIdentity)
      || (expectedExternalRefIdentity === undefined && observation.auxiliaryRefIdentity !== expectedAuxiliaryRefIdentity)
      || observation.configurationIdentity !== checkpoint.configurationIdentity) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "repository identity changed after item verification");
    }
    if (checkpoint.hookIdentity !== undefined) {
      const hook = await inspectPreCommitHook(worktreePath);
      if (hook.identity !== checkpoint.hookIdentity || hook.path !== checkpoint.hookPath) {
        throw new AutopilotError("CAPABILITY_DENIED", "pre-commit hook changed after item verification");
      }
    }
    let acceptedCommit = checkpoint.headCommit;
    if (checkpoint.commitRequired) {
      this.#runtimeAuthorize("git.commit", { repository: this.#charter.repository.root, branch: item.branchName });
      const key = `commit:${this.#charter.runId}:${item.id}:${checkpoint.treeIdentity}`;
      const confirmed = this.#effectConfirmation(key);
      if (confirmed !== undefined) {
        acceptedCommit = confirmed.observedState;
      } else {
        if (this.#effectIntent(key) === undefined) {
          if (this.#pauseRequested || this.#stopRequested) {
            return;
          }
          await this.#record({
            ...eventBase("Recording commit intent before the Git effect"),
            type: "EFFECT_INTENDED",
            itemId: item.id,
            attemptId: checkpoint.attemptId,
            effect: "git.commit",
            idempotencyKey: key,
            expectedState: checkpoint.treeIdentity,
          });
        }
        observation = await this.#observeRepository(worktreePath);
        acceptedCommit = await this.#withRepositoryLock(async () => {
          let observedCommit: string;
          if (observation.headCommit === checkpoint.headCommit) {
            if (observation.treeIdentity !== checkpoint.treeIdentity) {
              throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "verified tree changed before commit reconciliation");
            }
            observedCommit = await commitAcceptedWork(
              worktreePath,
              this.#charter,
              item,
              checkpoint.attemptId,
              checkpoint.treeIdentity,
              checkpoint.headCommit,
            );
          } else {
            const commit = await inspectCommit(worktreePath, observation.headCommit);
            const expectedTrailers = [
              `Autopilot-Run: ${this.#charter.runId}`,
              `Autopilot-Item: ${item.id}`,
              `Autopilot-Attempt: ${checkpoint.attemptId}`,
            ];
            if (commit.parents.length !== 1 || commit.parents[0] !== checkpoint.headCommit
              || commit.treeIdentity !== checkpoint.treeIdentity
              || expectedTrailers.some((trailer) => !commit.message.includes(trailer))) {
              throw new AutopilotError("BRANCH_COLLISION", "unconfirmed commit intent does not match the verified item");
            }
            observedCommit = observation.headCommit;
          }
          await this.#record({
            ...eventBase("Verified commit observed"),
            type: "EFFECT_CONFIRMED",
            itemId: item.id,
            attemptId: checkpoint.attemptId,
            effect: "git.commit",
            idempotencyKey: key,
            observedState: observedCommit,
          });
          return observedCommit;
        });
      }
      observation = await this.#observeRepository(worktreePath);
      if (observation.headCommit !== acceptedCommit) {
        throw new AutopilotError("BRANCH_COLLISION", "managed branch no longer points to the confirmed commit");
      }
      const commit = await inspectCommit(worktreePath, acceptedCommit);
      if (commit.treeIdentity !== checkpoint.treeIdentity) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "confirmed commit no longer matches the verified tree");
      }
    } else if (observation.headCommit !== checkpoint.headCommit || observation.treeIdentity !== checkpoint.treeIdentity) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "clean verified subject changed before delivery");
    }
    if (this.#pauseRequested || this.#stopRequested) {
      return;
    }
    const delivered = await this.#deliverItem(item, worktreePath, acceptedCommit);
    if (!delivered || this.#pauseRequested || this.#stopRequested) {
      return;
    }
    await this.#record({
      ...eventBase("All item predicates and delivery requirements are met"),
      type: "ITEM_SATISFIED",
      itemId: item.id,
      attemptId: checkpoint.attemptId,
      subject: checkpoint.subject,
    });
  }

  async #observeProviderChecks(
    delivery: DeliveryPort,
    reference: ChangeRequestRef,
    expectedCommit: string,
    baseBranch: string,
  ): Promise<{
    readonly status: "passed" | "failed" | "pending" | "merged";
    readonly checks: Awaited<ReturnType<DeliveryPort["observeChecks"]>>;
    readonly observationId: string;
  }> {
    const changeRequest = await delivery.observeChangeRequest(this.#charter.repository.root, reference);
    if (changeRequest.ref.id !== reference.id || changeRequest.ref.url !== reference.url
      || changeRequest.headCommit !== expectedCommit || changeRequest.baseBranch !== baseBranch
      || changeRequest.state === "closed") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider check subject changed while waiting");
    }
    if (changeRequest.state === "merged") {
      return {
        status: "merged",
        checks: [],
        observationId: sha256(canonicalJson({ changeRequest, checks: [] })),
      };
    }
    const checks = await delivery.observeChecks(this.#charter.repository.root, expectedCommit);
    if (checks.some(({ subjectCommit }) => subjectCommit !== expectedCommit)) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider returned checks for a different commit");
    }
    const status = checks.some(({ status: checkStatus }) => checkStatus === "failed")
      ? "failed" as const
      : checks.length > 0 && checks.every(({ status: checkStatus }) => checkStatus === "passed")
        ? "passed" as const
        : "pending" as const;
    return {
      status,
      checks,
      observationId: sha256(canonicalJson({ changeRequest, checks })),
    };
  }

  async #recordRemoteChecks(
    item: WorkItem,
    provider: "github" | "gitlab",
    expectedCommit: string,
    status: "PASSED" | "FAILED" | "UNVERIFIED",
    checks: Awaited<ReturnType<DeliveryPort["observeChecks"]>>,
  ): Promise<void> {
    const artifact = {
      schemaVersion: 1,
      type: "remote-checks",
      provider,
      subject: expectedCommit,
      observedAt: new Date().toISOString(),
      status,
      checks,
    };
    const receiptId = sha256(canonicalJson(artifact));
    const path = join(this.#runDirectory, "receipts", `${receiptId}.json`);
    await writeImmutableJson(path, { ...artifact, receiptId });
    await this.#record({
      ...eventBase(`Remote checks recorded ${status}`),
      type: "RECEIPT_RECORDED",
      itemId: item.id,
      receiptId,
      receiptKind: "remote-checks",
      status,
      evidence: [path],
    });
  }

  async #waitForProviderChecks(
    item: WorkItem,
    delivery: DeliveryPort,
    reference: ChangeRequestRef,
    provider: "github" | "gitlab",
    expectedCommit: string,
    baseBranch: string,
  ): Promise<"passed" | "failed" | "pending" | "cancelled" | "merged"> {
    let observation = await this.#observeProviderChecks(delivery, reference, expectedCommit, baseBranch);
    if (observation.status !== "pending") {
      if (observation.status !== "merged") {
        await this.#recordRemoteChecks(
          item,
          provider,
          expectedCommit,
          observation.status === "passed" ? "PASSED" : "FAILED",
          observation.checks,
        );
      }
      return observation.status;
    }
    const policy = this.#charter.providerCheckWait ?? { heartbeatMs: 30_000, timeoutMs: 300_000 };
    const deadline = new Date(Date.now() + policy.timeoutMs).toISOString();
    await this.#record({
      ...eventBase("Waiting for exact-subject provider checks"),
      type: "RUN_WAITING",
      itemId: item.id,
      waiting: {
        kind: "provider-checks",
        provider,
        itemId: item.id,
        changeRequestId: reference.id,
        changeRequestUrl: reference.url,
        subjectCommit: expectedCommit,
        baseBranch,
        heartbeatMs: policy.heartbeatMs,
        deadline,
      },
    });
    const controller = new AbortController();
    this.#waitAbort = controller;
    try {
      while (Date.now() < Date.parse(deadline)) {
        const remaining = Math.max(1, Date.parse(deadline) - Date.now());
        await new Promise<void>((resolveDelay) => {
          const finish = (): void => {
            controller.signal.removeEventListener("abort", abort);
            resolveDelay();
          };
          const timer = setTimeout(finish, Math.min(policy.heartbeatMs, remaining));
          const abort = (): void => {
            clearTimeout(timer);
            finish();
          };
          controller.signal.addEventListener("abort", abort, { once: true });
        });
        if (controller.signal.aborted || this.#pauseRequested || this.#stopRequested) {
          return "cancelled";
        }
        observation = await this.#observeProviderChecks(delivery, reference, expectedCommit, baseBranch);
        if (observation.status !== "pending") {
          await this.#record({
            ...eventBase("Exact provider observation ended the check wait", "reconciler"),
            type: "RUN_WOKEN",
            itemId: item.id,
            observationId: observation.observationId,
          });
          if (observation.status !== "merged") {
            await this.#recordRemoteChecks(
              item,
              provider,
              expectedCommit,
              observation.status === "passed" ? "PASSED" : "FAILED",
              observation.checks,
            );
          }
          return observation.status;
        }
      }
      await this.#recordRemoteChecks(item, provider, expectedCommit, "UNVERIFIED", observation.checks);
      return "pending";
    } finally {
      if (this.#waitAbort === controller) {
        this.#waitAbort = undefined;
      }
    }
  }

  async #deliverItem(item: WorkItem, worktreePath: string, expectedCommit: string): Promise<boolean> {
    const target = this.#charter.deliveryTarget;
    if (this.#charter.delivery === "local-commits" || target === undefined) {
      return true;
    }
    this.#runtimeAuthorize("remote.push", { repository: this.#charter.repository.root, remote: target.remote, branch: item.branchName });
    this.#runtimeAuthorize("network.access");
    this.#runtimeAuthorize("credentials.use");
    const pushKey = `push:${this.#charter.runId}:${item.id}:${expectedCommit}`;
    let remoteCommit = this.#effectConfirmation(pushKey)?.observedState;
    if (remoteCommit !== undefined) {
      const observedRemote = await remoteBranchCommit(worktreePath, target.remote, item.branchName);
      if (observedRemote !== expectedCommit || remoteCommit !== expectedCommit) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "confirmed remote push no longer matches the verified commit");
      }
    } else {
      if (this.#effectIntent(pushKey) === undefined) {
        if (this.#pauseRequested || this.#stopRequested) {
          return false;
        }
        await this.#record({
          ...eventBase("Recording push intent before the remote Git effect"),
          type: "EFFECT_INTENDED",
          itemId: item.id,
          effect: "remote.push",
          idempotencyKey: pushKey,
          expectedState: expectedCommit,
        });
      }
      remoteCommit = this.#amendment === undefined
        ? await pushBranch(worktreePath, target.remote, item.branchName, expectedCommit)
        : await pushAmendmentBranch(
          worktreePath,
          target.remote,
          item.branchName,
          this.#amendment.deliveryBaseCommit,
          expectedCommit,
        );
      const afterPush = await this.#observeRepository(worktreePath);
      await this.#record({
        ...eventBase("Expected remote branch commit observed"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: "remote.push",
        idempotencyKey: pushKey,
        observedState: remoteCommit,
        repositoryAuxiliaryRefIdentity: afterPush.auxiliaryRefIdentity,
        repositoryExternalRefIdentity: afterPush.externalRefIdentity,
      });
    }
    if (this.#amendment !== undefined) {
      this.#amendment = { ...this.#amendment, deliveryBaseCommit: remoteCommit };
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return false;
    }

    this.#deliveryAuthorize("network.access");
    this.#deliveryAuthorize("credentials.use");
    const changeRequestEffect = this.#amendment === undefined ? "change-request.open" : "change-request.update";
    this.#deliveryAuthorize(changeRequestEffect, { repository: this.#charter.repository.root });
    const delivery = createDeliveryAdapter(target.provider);
    const deliveryCapabilities = await delivery.describe();
    if (this.#stopRequested || this.#pauseRequested) {
      return false;
    }
    const predecessorId = item.dependsOn.at(-1);
    const predecessor = predecessorId === undefined ? undefined : this.#charter.work.find(({ id }) => id === predecessorId);
    const baseBranch = this.#charter.mode === "ordered-stack" && this.#charter.delivery === "change-request-ready" && predecessor !== undefined
      ? predecessor.branchName
      : target.baseBranch;
    const changeRequestKey = `change-request:${this.#charter.runId}:${item.id}`;
    const priorChangeRequestIntent = this.#effectIntent(changeRequestKey);
    const priorChangeRequestConfirmation = this.#effectConfirmation(changeRequestKey);
    const priorWaiting = this.#records.findLast(({ event }) =>
      event.type === "RUN_WAITING" && event.itemId === item.id && event.waiting?.kind === "provider-checks"
    )?.event;
    const waitingDetails = priorWaiting?.type === "RUN_WAITING" && priorWaiting.waiting?.kind === "provider-checks"
      ? priorWaiting.waiting
      : undefined;
    if (waitingDetails !== undefined && waitingDetails.provider !== target.provider) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider-check wait identity changed across restart");
    }
    const confirmedUrl = priorChangeRequestConfirmation?.observedState;
    if (waitingDetails !== undefined && confirmedUrl !== undefined && waitingDetails.changeRequestUrl !== confirmedUrl) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider-check wait no longer matches the confirmed change request");
    }
    const durableReference: ChangeRequestRef | undefined = waitingDetails === undefined
      ? confirmedUrl === undefined ? undefined : {
          provider: target.provider,
          id: confirmedUrl.replace(/\/+$/u, "").split("/").at(-1) ?? "",
          url: confirmedUrl,
        }
      : {
          provider: waitingDetails.provider,
          id: waitingDetails.changeRequestId,
          url: waitingDetails.changeRequestUrl,
        };
    if (durableReference !== undefined && durableReference.id.length === 0) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "confirmed change-request identity is malformed");
    }
    const existing = this.#amendment?.changeRequest ?? durableReference
      ?? await delivery.findChangeRequest(this.#charter.repository.root, this.#charter.runId, item.id);
    if (existing === undefined && (priorChangeRequestIntent !== undefined || priorChangeRequestConfirmation !== undefined)) {
      throw new AutopilotError(
        "EFFECT_RECONCILIATION_FAILED",
        "change-request mutation is ambiguous after process loss; creation was not repeated",
      );
    }
    if (priorChangeRequestIntent === undefined) {
      await this.#record({
        ...eventBase(this.#amendment === undefined ? "Recording change-request intent before provider mutation" : "Recording existing change-request head update"),
        type: "EFFECT_INTENDED",
        itemId: item.id,
        effect: changeRequestEffect,
        idempotencyKey: changeRequestKey,
        expectedState: canonicalJson({ provider: target.provider, expectedCommit, baseBranch }),
      });
    }
    if (existing === undefined && (this.#stopRequested || this.#pauseRequested)) {
      return false;
    }
    const reference = existing ?? await delivery.createChangeRequest({
      repositoryRoot: this.#charter.repository.root,
      runId: this.#charter.runId,
      itemId: item.id,
      title: changeRequestTitle(item),
      body: `Autopilot verified tree and commit ${expectedCommit}.`,
      headBranch: item.branchName,
      baseBranch,
      expectedHeadCommit: expectedCommit,
    });
    const observed = await delivery.observeChangeRequest(this.#charter.repository.root, reference);
    if (observed.ref.provider !== reference.provider || observed.ref.id !== reference.id || observed.ref.url !== reference.url) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider returned a different change request during delivery reconciliation");
    }
    if (this.#amendment !== undefined && observed.ref.url !== this.#amendment.changeRequest.url) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider returned a different change request during amendment delivery");
    }
    if (observed.headCommit !== expectedCommit || observed.baseBranch !== baseBranch) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "change-request head or base does not match verified delivery", {
        expectedHead: expectedCommit,
        observedHead: observed.headCommit,
        expectedBase: baseBranch,
        observedBase: observed.baseBranch,
      });
    }
    if (observed.state === "closed") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "matching change request is closed without a merge");
    }
    if (priorChangeRequestConfirmation === undefined) {
      await this.#record({
        ...eventBase("Change request at expected head observed"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: changeRequestEffect,
        idempotencyKey: changeRequestKey,
        observedState: reference.url,
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return false;
    }
    await this.#resolveReviewFeedback(delivery, reference, item, expectedCommit);
    if (this.#stopRequested || this.#pauseRequested) {
      return false;
    }
    if (this.#charter.delivery !== "merge-verified") {
      return true;
    }
    this.#deliveryAuthorize("merge.execute", { repository: this.#charter.repository.root });
    if (!deliveryCapabilities.checks) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", `${target.provider} adapter cannot observe remote checks`);
    }
    const mergeKey = `merge:${target.provider}:${reference.id}:${expectedCommit}`;
    const mergeConfirmation = this.#effectConfirmation(mergeKey);
    if (mergeConfirmation !== undefined && observed.state !== "merged") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "confirmed merge is no longer reported as merged");
    }
    if (observed.state === "merged") {
      if (mergeConfirmation === undefined) {
        await this.#record({
        ...eventBase("Previously merged expected head reconciled"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: "merge.execute",
        idempotencyKey: mergeKey,
          observedState: expectedCommit,
        });
      }
      return !this.#stopRequested && !this.#pauseRequested;
    }
    const checksStatus = await this.#waitForProviderChecks(
      item,
      delivery,
      reference,
      target.provider,
      expectedCommit,
      baseBranch,
    );
    if (checksStatus === "failed") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "remote checks failed for the expected head");
    }
    if (checksStatus === "merged") {
      await this.#record({
        ...eventBase("Expected head was merged while provider checks were waiting", "reconciler"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: "merge.execute",
        idempotencyKey: mergeKey,
        observedState: expectedCommit,
      });
      return true;
    }
    if (checksStatus === "passed") {
      const beforeMerge = await delivery.observeChangeRequest(this.#charter.repository.root, reference);
      if (beforeMerge.ref.provider !== reference.provider || beforeMerge.ref.id !== reference.id
        || beforeMerge.ref.url !== reference.url || beforeMerge.headCommit !== expectedCommit
        || beforeMerge.baseBranch !== baseBranch || beforeMerge.state === "closed") {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "change request changed after checks passed");
      }
      if (beforeMerge.state === "merged") {
        await this.#record({
          ...eventBase("Expected head was merged after checks passed", "reconciler"),
          type: "EFFECT_CONFIRMED",
          itemId: item.id,
          effect: "merge.execute",
          idempotencyKey: mergeKey,
          observedState: expectedCommit,
        });
        return true;
      }
    }
    if (checksStatus !== "passed" || this.#stopRequested || this.#pauseRequested) {
      return false;
    }
    if (this.#effectIntent(mergeKey) === undefined) {
      await this.#record({
        ...eventBase("Recording merge intent for the verified current head"),
        type: "EFFECT_INTENDED",
        itemId: item.id,
        effect: "merge.execute",
        idempotencyKey: mergeKey,
        expectedState: expectedCommit,
      });
    }
    const outcome = await delivery.merge({
      repositoryRoot: this.#charter.repository.root,
      ref: reference,
      expectedHeadCommit: expectedCommit,
      method: "merge",
    });
    if (!outcome.merged || outcome.observedHeadCommit !== expectedCommit) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider did not confirm merge of the expected head");
    }
    await this.#record({
      ...eventBase("Provider confirmed merge of the expected head"),
      type: "EFFECT_CONFIRMED",
      itemId: item.id,
      effect: "merge.execute",
      idempotencyKey: mergeKey,
      observedState: outcome.mergeCommit ?? outcome.observedHeadCommit,
    });
    return true;
  }

  async #executeReviewGate(
    item: WorkItem,
    gate: ReviewGate,
    worktreePath: string,
    attemptId: string,
    observation: RepositoryObservation,
  ) {
    if (this.#manifest === undefined) {
      throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter capabilities have not been loaded");
    }
    const attempt = this.#projection.items[item.id]?.attempts.at(-1);
    const restack = this.#projection.restacks[item.id];
    if (attempt === undefined && restack?.state !== "VERIFYING") {
      throw new AutopilotError("JOURNAL_CORRUPT", "review gate has no active verification identity");
    }
    const predicateEvidence = await projectPredicateEvidence(
      this.#runDirectory,
      this.#charter,
      this.#projection,
      this.#records,
    );
    const reviewFindings = await projectReviewFindings(this.#runDirectory, this.#records);
    const context = buildAttemptContext({
      charter: this.#charter,
      item,
      attemptId,
      leaseEpoch: attempt?.leaseEpoch ?? 0,
      observation,
      records: this.#records,
      projection: this.#projection,
      predicateEvidence,
      reviewFindings,
      sensitiveValues: credentialValues(this.#charter),
    });
    const contextJson = canonicalJson(context);
    if (Buffer.byteLength(contextJson) > this.#charter.limits.maxRetainedOutputBytes) {
      throw new AutopilotError("CONTEXT_TOO_LARGE", "review context exceeds the charter output bound");
    }
    const contextHash = attemptContextHash(context);
    const attemptsDirectory = join(this.#runDirectory, "reports", "attempts");
    await mkdir(attemptsDirectory, { recursive: true, mode: 0o700 });
    const reviewKey = sha256(gate.id).slice(0, 16);
    const contextPath = join(attemptsDirectory, `${attemptId}.review-${reviewKey}-${contextHash.slice(0, 16)}.context.json`);
    await writeImmutableJson(contextPath, context);
    const deadline = new Date(Date.now() + this.#charter.limits.attemptTimeoutMs).toISOString();
    const handle = await this.#adapter.launch({
      protocolVersion: 1,
      role: "review",
      runId: this.#charter.runId,
      itemId: item.id,
      attemptId: `${attemptId}-review-${reviewKey}`,
      worktreePath,
      objective: item.objective,
      acceptanceSummary: item.acceptance.map((predicate) => JSON.stringify(predicate)).join("; "),
      context,
      contextHash,
      reviewFocus: gate.focus,
      writableRoots: [],
      grants: this.#charter.grants.filter(({ actor, family }) =>
        actor === "adapter" || (actor === "worker" && family === "files.read")
      ),
      deadline,
      idleTimeoutMs: this.#charter.limits.idleTimeoutMs,
      maximumLineBytes: this.#charter.limits.maxAdapterLineBytes,
      maximumOutputBytes: this.#charter.limits.maxRetainedOutputBytes,
    });
    this.#activeHandles.set(handle.adapterExecutionId, handle);
    let adapterObservation: ExecutionObservation;
    try {
      adapterObservation = await this.#adapter.observe(handle);
    } finally {
      this.#activeHandles.delete(handle.adapterExecutionId);
    }
    const reviewObservationPath = join(attemptsDirectory, `${attemptId}.review-${reviewKey}-${contextHash.slice(0, 16)}.json`);
    await writeJsonAtomic(reviewObservationPath, adapterObservation);
    const after = await this.#observeRepository(worktreePath);
    if (after.headCommit !== observation.headCommit || after.treeIdentity !== observation.treeIdentity
      || after.externalRefIdentity !== observation.externalRefIdentity
      || after.configurationIdentity !== observation.configurationIdentity) {
      throw new AutopilotError("CAPABILITY_DENIED", "reviewer changed the worktree, Git refs, or Git configuration");
    }
    const result = adapterObservation.status === "completed" ? adapterObservation.reviewResult : undefined;
    const reviewer = `${this.#manifest.adapterName}@${this.#manifest.adapterVersion}/${this.#manifest.harnessVersion}`;
    const receipt = createReviewReceipt(
      this.#charter,
      item,
      gate,
      `tree:${observation.treeIdentity}`,
      reviewer,
      handle.startedAt,
      adapterObservation.completedAt,
      result?.verdict ?? "inconclusive",
      result?.findings ?? [],
      adapterObservation.truncated,
    );
    const receiptPath = await storeReceipt(this.#runDirectory, receipt);
    await this.#record({
      ...eventBase(`Independent review ${gate.id} recorded ${receipt.status}`),
      type: "RECEIPT_RECORDED",
      itemId: item.id,
      attemptId,
      receiptId: receipt.receiptId,
      gateId: gate.id,
      receiptKind: "review",
      subject: receipt.subject,
      status: receipt.status,
      evidence: [contextPath, reviewObservationPath, receiptPath],
    });
    return receipt;
  }

  async #verifyItem(
    item: WorkItem,
    worktreePath: string,
    attemptId: string,
    observation: RepositoryObservation,
  ): Promise<{ readonly subject: string; readonly met: boolean; readonly reasons: readonly string[] }> {
    for (const gate of this.#charter.gates.filter(({ appliesTo }) => appliesTo.length === 0 || appliesTo.includes(item.id))) {
      if (gate.type === "command") {
        this.#runtimeAuthorize("process.execute", { executable: gate.executable });
        for (const environmentName of gate.environmentNames) {
          this.#runtimeAuthorize("process.execute", { executable: gate.executable, environmentName });
          this.#runtimeAuthorize("credentials.use", { environmentName });
        }
      } else if (gate.type === "search") {
        this.#runtimeAuthorize("files.read");
      }
    }
    const subject = `tree:${observation.treeIdentity}`;
    const receipts = [...await executeItemGates(this.#charter, item, worktreePath, subject)];
    const afterDirectGates = await this.#observeRepository(worktreePath);
    if (afterDirectGates.headCommit !== observation.headCommit || afterDirectGates.treeIdentity !== observation.treeIdentity
      || afterDirectGates.externalRefIdentity !== observation.externalRefIdentity
      || afterDirectGates.configurationIdentity !== observation.configurationIdentity) {
      throw new AutopilotError("CAPABILITY_DENIED", "verification gate changed the worktree, Git refs, or Git configuration");
    }
    for (const gate of this.#charter.gates.filter((candidate): candidate is ReviewGate =>
      candidate.type === "review" && (candidate.appliesTo.length === 0 || candidate.appliesTo.includes(item.id))
    )) {
      receipts.push(await this.#executeReviewGate(item, gate, worktreePath, attemptId, observation));
    }
    const afterGates = await this.#observeRepository(worktreePath);
    if (afterGates.headCommit !== observation.headCommit || afterGates.treeIdentity !== observation.treeIdentity
      || afterGates.externalRefIdentity !== observation.externalRefIdentity
      || afterGates.configurationIdentity !== observation.configurationIdentity) {
      throw new AutopilotError("CAPABILITY_DENIED", "review gate changed the worktree, Git refs, or Git configuration");
    }
    for (const receipt of receipts) {
      if (this.#charter.gates.find(({ id }) => id === receipt.gateId)?.type === "review") {
        continue;
      }
      const path = await storeReceipt(this.#runDirectory, receipt);
      await this.#record({
        ...eventBase(`Verification gate ${receipt.gateId} recorded ${receipt.status}`),
        type: "RECEIPT_RECORDED",
        itemId: item.id,
        attemptId,
        receiptId: receipt.receiptId,
        gateId: receipt.gateId,
        receiptKind: "gate",
        subject: receipt.subject,
        status: receipt.status,
        evidence: [path],
      });
    }
    const evaluation = await evaluateItemDone(this.#charter, item, worktreePath, subject, receipts);
    const predicateReceipt = createPredicateEvaluationReceipt(this.#charter, item, subject, evaluation);
    const predicateReceiptPath = await storeReceipt(this.#runDirectory, predicateReceipt);
    await this.#record({
      ...eventBase(`Acceptance predicates recorded ${predicateReceipt.status}`),
      type: "RECEIPT_RECORDED",
      itemId: item.id,
      attemptId,
      receiptId: predicateReceipt.receiptId,
      receiptKind: "predicate",
      subject: predicateReceipt.subject,
      status: predicateReceipt.status,
      evidence: [predicateReceiptPath],
    });
    return { subject, met: evaluation.outcome === "met", reasons: evaluation.reasons };
  }

  #restackCheckpoint(item: WorkItem): VerifiedCheckpoint {
    const restack = this.#projection.restacks[item.id];
    if (restack?.candidateCommit === undefined || restack.treeIdentity === undefined
      || restack.subject === undefined || restack.temporaryWorktreePath === undefined) {
      throw new AutopilotError("JOURNAL_CORRUPT", `restack checkpoint is incomplete for ${item.id}`);
    }
    return {
      attemptId: `restack-${sha256(`${this.#charter.runId}\0${item.id}\0${restack.candidateCommit}`).slice(0, 24)}`,
      subject: restack.subject,
      headCommit: restack.candidateCommit,
      treeIdentity: restack.treeIdentity,
      auxiliaryRefIdentity: "restack-owned",
      configurationIdentity: "restack-owned",
      commitRequired: false,
      receiptIds: restack.receiptIds,
    };
  }

  async #completeVerifiedRestackItem(item: WorkItem): Promise<void> {
    const checkpoint = this.#restackCheckpoint(item);
    await this.#validateVerifiedCheckpointEvidence(item, checkpoint);
    const descendant = this.#charter.restack?.descendants.find(({ itemId }) => itemId === item.id);
    if (descendant === undefined) {
      throw new AutopilotError("CHARTER_INVALID", `restack snapshot is missing ${item.id}`);
    }
    const retainedWorktreePath = descendant.worktreePath;
    const temporaryWorktreePath = this.#projection.restacks[item.id]?.temporaryWorktreePath;
    if (temporaryWorktreePath === undefined) {
      throw new AutopilotError("JOURNAL_CORRUPT", `restack candidate path is missing for ${item.id}`);
    }
    const localKeyPrefix = `restack:${this.#charter.runId}:${item.id}:${descendant.oldCommit}`;
    const localKey = `${localKeyPrefix}:local-ref`;
    const [localCommit, remoteCommit] = await Promise.all([
      resolveCommit(this.#charter.repository.root, item.branchName),
      remoteBranchCommit(this.#charter.repository.root, descendant.remote, item.branchName),
    ]);
    if ((localCommit !== descendant.oldCommit && localCommit !== checkpoint.headCommit)
      || (remoteCommit !== descendant.remoteCommit && remoteCommit !== checkpoint.headCommit)
      || (localCommit === descendant.oldCommit && remoteCommit !== descendant.remoteCommit)) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack refs changed for ${item.id}`);
    }
    this.#adapterAuthorize("network.access");
    const delivery = createDeliveryAdapter(descendant.changeRequest.provider);
    const ref: ChangeRequestRef = {
      provider: descendant.changeRequest.provider,
      id: descendant.changeRequest.id,
      url: descendant.changeRequest.url,
    };
    const beforeProvider = await delivery.observeChangeRequest(this.#charter.repository.root, ref);
    const beforeProviderHeadAccepted = beforeProvider.headCommit === remoteCommit
      || (remoteCommit === checkpoint.headCommit && beforeProvider.headCommit === descendant.remoteCommit);
    if (beforeProvider.ref.provider !== ref.provider || beforeProvider.ref.id !== ref.id || beforeProvider.ref.url !== ref.url
      || !beforeProviderHeadAccepted
      || beforeProvider.baseBranch !== descendant.changeRequest.baseBranch || beforeProvider.state !== "open") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack provider identity changed for ${item.id}`);
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    this.#runtimeAuthorize("git.commit", { branch: item.branchName });
    if (this.#effectIntent(localKey) === undefined) {
      const retainedBeforeIntent = await inspectRepository(retainedWorktreePath);
      const retainedCommitBeforeIntent = await inspectCommit(retainedWorktreePath, retainedBeforeIntent.headCommit);
      if (!retainedBeforeIntent.clean || retainedBeforeIntent.headCommit !== descendant.oldCommit
        || retainedCommitBeforeIntent.treeIdentity !== descendant.oldTreeIdentity) {
        throw new AutopilotError("BRANCH_COLLISION", `restack retained worktree changed before local intent for ${item.id}`);
      }
      await this.#record({
        ...eventBase("Verified restack local ref movement intended"),
        type: "EFFECT_INTENDED",
        itemId: item.id,
        effect: "restack.local-ref",
        idempotencyKey: localKey,
        expectedState: canonicalJson({ oldCommit: descendant.oldCommit, candidateCommit: checkpoint.headCommit }),
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    if (localCommit === descendant.oldCommit) {
      await this.#withRepositoryLock(async () => {
        if (this.#stopRequested || this.#pauseRequested) {
          return;
        }
        await installRestackCandidate(
          this.#charter.repository.root,
          item.branchName,
          retainedWorktreePath,
          temporaryWorktreePath,
          descendant.oldCommit,
          checkpoint.headCommit,
          checkpoint.treeIdentity,
          () => {
            if (this.#stopRequested || this.#pauseRequested) {
              throw new AutopilotError("CAPABILITY_DENIED", "restack local CAS fenced by operator control");
            }
          },
        );
      });
    } else {
      try {
        await access(retainedWorktreePath);
        const retained = await inspectRepository(retainedWorktreePath);
        const retainedCommit = await inspectCommit(retainedWorktreePath, retained.headCommit);
        if (!retained.clean || retained.headCommit !== checkpoint.headCommit
          || retainedCommit.treeIdentity !== checkpoint.treeIdentity) {
          throw new AutopilotError("BRANCH_COLLISION", `restack retained worktree changed for ${item.id}`);
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
        await this.#withRepositoryLock(async () => {
          if (this.#stopRequested || this.#pauseRequested) {
            return;
          }
          await installRestackCandidate(
            this.#charter.repository.root,
            item.branchName,
            retainedWorktreePath,
            temporaryWorktreePath,
            descendant.oldCommit,
            checkpoint.headCommit,
            checkpoint.treeIdentity,
            () => {
              if (this.#stopRequested || this.#pauseRequested) {
                throw new AutopilotError("CAPABILITY_DENIED", "restack worktree recreation fenced by operator control");
              }
            },
          );
        });
      }
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    if (this.#effectConfirmation(localKey) === undefined) {
      await this.#record({
        ...eventBase("Restack local ref and retained worktree confirmed", "reconciler"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: "restack.local-ref",
        idempotencyKey: localKey,
        observedState: checkpoint.headCommit,
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    const remoteBeforePush = await remoteBranchCommit(this.#charter.repository.root, descendant.remote, item.branchName);
    const providerBeforePush = await delivery.observeChangeRequest(this.#charter.repository.root, ref);
    const providerBeforePushHeadAccepted = providerBeforePush.headCommit === remoteBeforePush
      || (remoteBeforePush === checkpoint.headCommit && providerBeforePush.headCommit === descendant.remoteCommit);
    if ((remoteBeforePush !== descendant.remoteCommit && remoteBeforePush !== checkpoint.headCommit)
      || providerBeforePush.ref.provider !== ref.provider || providerBeforePush.ref.id !== ref.id
      || providerBeforePush.ref.url !== ref.url || !providerBeforePushHeadAccepted
      || providerBeforePush.baseBranch !== descendant.changeRequest.baseBranch || providerBeforePush.state !== "open") {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack remote or provider changed before push for ${item.id}`);
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    this.#runtimeAuthorize("remote.push", { branch: item.branchName, remote: descendant.remote });
    const pushKey = `${localKeyPrefix}:remote-push`;
    if (this.#effectIntent(pushKey) === undefined) {
      await this.#record({
        ...eventBase("Verified restack ordinary push intended"),
        type: "EFFECT_INTENDED",
        itemId: item.id,
        effect: "restack.remote-push",
        idempotencyKey: pushKey,
        expectedState: canonicalJson({ oldCommit: descendant.remoteCommit, candidateCommit: checkpoint.headCommit }),
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    await pushAmendmentBranch(
      retainedWorktreePath,
      descendant.remote,
      item.branchName,
      descendant.remoteCommit,
      checkpoint.headCommit,
      () => {
        if (this.#stopRequested || this.#pauseRequested) {
          throw new AutopilotError("CAPABILITY_DENIED", "restack push fenced by operator control");
        }
      },
    );
    if (this.#effectConfirmation(pushKey) === undefined) {
      await this.#record({
        ...eventBase("Restack remote fast-forward confirmed", "reconciler"),
        type: "EFFECT_CONFIRMED",
        itemId: item.id,
        effect: "restack.remote-push",
        idempotencyKey: pushKey,
        observedState: checkpoint.headCommit,
      });
    }
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    const provider = await delivery.observeChangeRequest(this.#charter.repository.root, ref);
    if (provider.ref.provider !== ref.provider || provider.ref.id !== ref.id || provider.ref.url !== ref.url
      || provider.baseBranch !== descendant.changeRequest.baseBranch || provider.state !== "open"
      || (provider.headCommit !== checkpoint.headCommit && provider.headCommit !== descendant.remoteCommit)) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack provider identity changed for ${item.id}`);
    }
    if (provider.headCommit === descendant.remoteCommit) {
      return;
    }
    await this.#record({
      ...eventBase("Restack provider head confirmed at the candidate"),
      type: "RESTACK_PROVIDER_HEAD_CONFIRMED",
      itemId: item.id,
      provider: provider.ref.provider,
      changeRequestId: provider.ref.id,
      changeRequestUrl: provider.ref.url,
      headCommit: provider.headCommit,
      baseBranch: provider.baseBranch,
      state: "open",
    });
    await this.#record({
      ...eventBase("Restack descendant provider head confirmed"),
      type: "RESTACK_DESCENDANT_SATISFIED",
      itemId: item.id,
      subject: checkpoint.subject,
    });
  }

  async #runRestackItem(item: WorkItem): Promise<void> {
    const restack = this.#charter.restack;
    const descendant = restack?.descendants.find(({ itemId }) => itemId === item.id);
    if (restack === undefined || descendant === undefined) {
      throw new AutopilotError("CHARTER_INVALID", `restack snapshot is missing ${item.id}`);
    }
    let projected = this.#projection.restacks[item.id];
    if (projected === undefined) {
      throw new AutopilotError("JOURNAL_CORRUPT", `restack projection is missing ${item.id}`);
    }
    const index = restack.descendants.findIndex(({ itemId }) => itemId === item.id);
    const freshParentCommit = index === 0
      ? restack.amendedCommit
      : this.#projection.restacks[restack.descendants[index - 1]?.itemId ?? ""]?.candidateCommit;
    if (freshParentCommit === undefined) {
      throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack predecessor is not confirmed for ${item.id}`);
    }
    if (projected.state === "PENDING") {
      const [localCommit, remoteCommit] = await Promise.all([
        resolveCommit(this.#charter.repository.root, item.branchName),
        remoteBranchCommit(this.#charter.repository.root, descendant.remote, item.branchName),
      ]);
      if (localCommit !== descendant.oldCommit || remoteCommit !== descendant.remoteCommit) {
        throw new AutopilotError("BRANCH_COLLISION", `restack source changed for ${item.id}`);
      }
      this.#adapterAuthorize("network.access");
      const delivery = createDeliveryAdapter(descendant.changeRequest.provider);
      const ref: ChangeRequestRef = {
        provider: descendant.changeRequest.provider,
        id: descendant.changeRequest.id,
        url: descendant.changeRequest.url,
      };
      const provider = await delivery.observeChangeRequest(this.#charter.repository.root, ref);
      if (provider.ref.provider !== ref.provider || provider.ref.id !== ref.id || provider.ref.url !== ref.url
        || provider.headCommit !== descendant.remoteCommit
        || provider.baseBranch !== descendant.changeRequest.baseBranch || provider.state !== "open") {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack provider identity changed for ${item.id}`);
      }
      if (this.#stopRequested || this.#pauseRequested) {
        return;
      }
      const retained = await inspectRepository(descendant.worktreePath);
      const retainedCommit = await inspectCommit(descendant.worktreePath, retained.headCommit);
      if (!retained.clean || retained.headCommit !== descendant.oldCommit
        || retainedCommit.treeIdentity !== descendant.oldTreeIdentity) {
        throw new AutopilotError("BRANCH_COLLISION", `restack retained worktree changed for ${item.id}`);
      }
      await this.#record({
        ...eventBase("Sealed restack descendant started"),
        type: "RESTACK_DESCENDANT_STARTED",
        itemId: item.id,
        oldCommit: descendant.oldCommit,
        freshParentCommit,
      });
      projected = this.#projection.restacks[item.id];
      if (projected === undefined) {
        throw new AutopilotError("JOURNAL_CORRUPT", `restack projection disappeared for ${item.id}`);
      }
    }
    if (projected.state === "PREPARING") {
      if (this.#stopRequested || this.#pauseRequested) {
        return;
      }
      const candidate = await this.#withRepositoryLock(async () => {
        if (this.#stopRequested || this.#pauseRequested) {
          return undefined;
        }
        return await prepareRestackCandidate(
          this.#charter.repository.root,
          this.#charter.runId,
          item.id,
          descendant.oldCommit,
          freshParentCommit,
          descendant.worktreePath,
        );
      });
      if (candidate === undefined) {
        return;
      }
      await this.#record({
        ...eventBase("Runtime-owned restack tree prepared"),
        type: "RESTACK_DESCENDANT_TREE_PREPARED",
        itemId: item.id,
        candidateCommit: candidate.commit,
        treeIdentity: candidate.treeIdentity,
        messageIdentity: candidate.messageIdentity,
        oldCommit: descendant.oldCommit,
        freshParentCommit,
        temporaryWorktreePath: candidate.temporaryWorktreePath,
      });
      projected = this.#projection.restacks[item.id];
      if (projected === undefined) {
        throw new AutopilotError("JOURNAL_CORRUPT", `restack projection disappeared for ${item.id}`);
      }
    }
    if (projected.state === "VERIFYING") {
      if (projected.temporaryWorktreePath === undefined || projected.candidateCommit === undefined
        || projected.treeIdentity === undefined) {
        throw new AutopilotError("JOURNAL_CORRUPT", `restack prepared tree is incomplete for ${item.id}`);
      }
      try {
        await access(projected.temporaryWorktreePath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
        const recovered = await this.#withRepositoryLock(async () => await prepareRestackCandidate(
          this.#charter.repository.root,
          this.#charter.runId,
          item.id,
          descendant.oldCommit,
          freshParentCommit,
          descendant.worktreePath,
        ));
        if (recovered.commit !== projected.candidateCommit || recovered.treeIdentity !== projected.treeIdentity
          || recovered.messageIdentity !== projected.messageIdentity
          || recovered.temporaryWorktreePath !== projected.temporaryWorktreePath) {
          throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack candidate recovery changed identity for ${item.id}`);
        }
      }
      const observation = await this.#observeRepository(projected.temporaryWorktreePath);
      if (!observation.clean || observation.headCommit !== projected.candidateCommit
        || observation.treeIdentity !== projected.treeIdentity) {
        throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", `restack candidate changed for ${item.id}`);
      }
      const verificationId = `restack-${sha256(`${this.#charter.runId}\0${item.id}\0${projected.candidateCommit}`).slice(0, 24)}`;
      const verification = await this.#verifyItem(item, projected.temporaryWorktreePath, verificationId, observation);
      if (!verification.met) {
        throw new AutopilotError("PREDICATE_NOT_MET", verification.reasons.join("; ") || "Restack predicates are not met");
      }
      const receiptIds = [...new Set(this.#records.flatMap(({ event }) =>
        event.type === "RECEIPT_RECORDED" && event.itemId === item.id && event.attemptId === verificationId
          ? [event.receiptId]
          : []
      ))];
      await this.#record({
        ...eventBase("Restack candidate exact tree and evidence verified"),
        type: "RESTACK_DESCENDANT_VERIFIED",
        itemId: item.id,
        subject: verification.subject,
        receiptIds,
      });
    }
    await this.#completeVerifiedRestackItem(item);
  }

  async #runRestackLifecycle(): Promise<void> {
    const restack = this.#charter.restack;
    if (restack === undefined) {
      return;
    }
    for (const descendant of restack.descendants) {
      const projected = this.#projection.restacks[descendant.itemId];
      if (projected?.state === "SATISFIED") {
        continue;
      }
      if (projected?.state === "BLOCKED") {
        return;
      }
      const item = this.#charter.work.find(({ id }) => id === descendant.itemId);
      if (item === undefined) {
        throw new AutopilotError("CHARTER_INVALID", `restack work item is missing ${descendant.itemId}`);
      }
      try {
        if (["VERIFIED", "COMMITTING", "PUSHING"].includes(projected?.state ?? "")) {
          await this.#completeVerifiedRestackItem(item);
        } else {
          await this.#runRestackItem(item);
        }
      } catch (error) {
        if (!this.#pauseRequested && !this.#stopRequested) {
          await this.#record({
            ...eventBase(error instanceof Error ? error.message : String(error)),
            type: "RESTACK_DESCENDANT_BLOCKED",
            itemId: item.id,
            errorCode: error instanceof AutopilotError ? error.code : "UNKNOWN_FAILURE",
          });
        }
        return;
      }
      if (this.#pauseRequested || this.#stopRequested) {
        return;
      }
    }
    if (Object.values(this.#projection.restacks).every(({ state }) => state === "SATISFIED")) {
      await this.#record({ ...eventBase("Evaluating the complete restack successor"), type: "RUN_VERIFYING" });
      await this.#record({
        ...eventBase("Every sealed restack descendant is satisfied"),
        type: "RUN_SUCCEEDED",
        predicateSummary: "All restack descendants are SATISFIED with fresh candidate-tree receipts.",
      });
    }
  }

  async #runItem(item: WorkItem): Promise<void> {
    if (this.#stopRequested || this.#pauseRequested) {
      return;
    }
    const prior = this.#projection.items[item.id];
    if (prior?.state === "BLOCKED" && prior.blocker === "PREDICATE_NOT_MET") {
      await this.#record({
        ...eventBase("Retrying implementation after failed predicates without changing authority or acceptance"),
        type: "DECISION_RECORDED",
        itemId: item.id,
        decision: "Replan pending implementation",
        basis: `Predicate failure after ${prior.attempts.length} attempt(s); sealed replan budget permits another attempt.`,
      });
    }
    if (this.#projection.items[item.id]?.state !== "READY") {
      await this.#record({ ...eventBase("Dependencies are satisfied"), type: "ITEM_READY", itemId: item.id });
    }
    if (await this.#blockItemForStop(item)) {
      return;
    }
    const predecessorId = item.dependsOn.at(-1);
    const predecessor = predecessorId === undefined ? undefined : this.#charter.work.find(({ id }) => id === predecessorId);
    const baseCommit = predecessor === undefined
      ? this.#charter.repository.baseCommit
      : await resolveCommit(this.#charter.repository.root, predecessor.branchName);
    const ownedCommits = this.#records.flatMap(({ event }) =>
      event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "git.commit"
        ? [event.observedState]
        : []
    );
    let worktreePath = this.#amendment?.worktreePath;
    if (worktreePath === undefined) {
      worktreePath = await this.#withRepositoryLock(async () =>
        await ensureWorktree(this.#charter, item, baseCommit, ownedCommits)
      );
    }
    const before = await this.#observeRepository(worktreePath);
    const hookSnapshot = this.#charter.commitPolicy?.preCommitHook === "run"
      ? await inspectPreCommitHook(worktreePath)
      : undefined;
    const attemptId = randomUUID();
    const lease = await acquireWriterLease(
      this.#runDirectory,
      item.id,
      item.branchName,
      worktreePath,
      attemptId,
      this.#charter.limits.attemptTimeoutMs,
    );
    const deadline = lease.expiresAt;
    const predicateEvidence = await projectPredicateEvidence(
      this.#runDirectory,
      this.#charter,
      this.#projection,
      this.#records,
    );
    const reviewFindings = await projectReviewFindings(this.#runDirectory, this.#records);
    const context = buildAttemptContext({
      charter: this.#charter,
      item,
      attemptId,
      leaseEpoch: lease.epoch,
      observation: before,
      records: this.#records,
      projection: this.#projection,
      predicateEvidence,
      reviewFindings,
      sensitiveValues: credentialValues(this.#charter),
    });
    const contextJson = canonicalJson(context);
    if (Buffer.byteLength(contextJson) > this.#charter.limits.maxRetainedOutputBytes) {
      throw new AutopilotError("CONTEXT_TOO_LARGE", "attempt context exceeds the charter output bound");
    }
    const contextHash = attemptContextHash(context);
    const attemptsDirectory = join(this.#runDirectory, "reports", "attempts");
    await mkdir(attemptsDirectory, { recursive: true, mode: 0o700 });
    const contextPath = join(attemptsDirectory, `${attemptId}.context.json`);
    await writeImmutableJson(contextPath, context);
    await this.#record({
      ...eventBase("Starting a fresh bounded harness session"),
      type: "ATTEMPT_STARTED",
      itemId: item.id,
      attemptId,
      leaseEpoch: lease.epoch,
      expectedBaseCommit: before.headCommit,
      expectedTreeIdentity: before.treeIdentity,
      expectedRefIdentity: before.auxiliaryRefIdentity,
      expectedExternalRefIdentity: before.externalRefIdentity,
      expectedConfigurationIdentity: before.configurationIdentity,
      ...(hookSnapshot === undefined ? {} : {
        expectedHookIdentity: hookSnapshot.identity,
        ...(hookSnapshot.path === undefined ? {} : { expectedHookPath: hookSnapshot.path }),
      }),
      contextHash,
      contextJournalSequence: context.sourceJournalSequence,
      executionSupervised: this.#executionSupervisionEnabled(),
      deadline,
      evidence: [contextPath],
      idempotencyKey: `attempt:${this.#charter.runId}:${item.id}:${lease.epoch}`,
    });

    this.#workerAuthorize("files.read");
    this.#workerAuthorize("files.write");
    this.#workerAuthorize("process.execute");
    this.#adapterAuthorize("network.access");
    this.#adapterAuthorize("credentials.use");

    if (await this.#blockItemForStop(item, attemptId)) {
      return;
    }
    const handle = await this.#adapter.launch(this.#implementationRequest(
      item,
      attemptId,
      worktreePath,
      context,
      contextHash,
      deadline,
    ));
    this.#activeHandles.set(handle.adapterExecutionId, handle);
    this.#implementationHandleIds.add(handle.adapterExecutionId);
    if (this.#stopRequested || this.#pauseRequested) {
      try {
        await this.#adapter.cancel(handle);
      } catch {
        // Observation still owns bounded process cleanup.
      }
    }
    let observation: ExecutionObservation;
    try {
      observation = await this.#adapter.observe(handle);
    } finally {
      this.#activeHandles.delete(handle.adapterExecutionId);
      this.#implementationHandleIds.delete(handle.adapterExecutionId);
    }
    const observationPath = join(attemptsDirectory, `${attemptId}.json`);
    await writeJsonAtomic(observationPath, observation);
    const currentLease = await readLease(this.#runDirectory, item.id);
    const after = await this.#observeRepository(worktreePath);
    const leaseIdentityCurrent = currentLease !== undefined
      && currentLease.attemptId === attemptId && currentLease.epoch === lease.epoch;
    const stale = !leaseIdentityCurrent || !leaseIsCurrent(currentLease, attemptId);
    await this.#record({
      ...eventBase(stale ? "Late adapter result quarantined" : "Adapter execution observed"),
      type: "ATTEMPT_FINISHED",
      itemId: item.id,
      attemptId,
      observedHeadCommit: after.headCommit,
      observedTreeIdentity: after.treeIdentity,
      outcome: stale ? "stale" : observation.status,
      evidence: [observationPath],
    });
    if (leaseIdentityCurrent) {
      await retireWriterLease(this.#runDirectory, { itemId: item.id, attemptId, epoch: lease.epoch });
    }
    if (await this.#blockItemForStop(item, attemptId)) {
      return;
    }
    if (stale) {
      await this.#record({
        ...eventBase("Writer lease expired"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "STALE_LEASE",
      });
      return;
    }
    if (after.headCommit !== before.headCommit) {
      await this.#record({
        ...eventBase("Harness worker created an unexpected commit"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "UNEXPECTED_COMMIT",
      });
      return;
    }
    if (after.externalRefIdentity !== before.externalRefIdentity) {
      await this.#record({
        ...eventBase("Harness worker changed a Git ref"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "BRANCH_COLLISION",
      });
      return;
    }
    if (after.configurationIdentity !== before.configurationIdentity) {
      await this.#record({
        ...eventBase("Harness worker changed Git configuration"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "CAPABILITY_DENIED",
      });
      return;
    }
    await assertWritablePaths(worktreePath, after.changedPaths, item.writableRoots);
    if (this.#pauseRequested) {
      await this.#record({
        ...eventBase("Operator pause preserved the observed worker tree", "operator"),
        type: "ATTEMPT_PAUSED",
        itemId: item.id,
        attemptId,
        ...(observation.status === "cancelled" ? {} : { budgetConsumed: true }),
      });
      await retireWriterLease(this.#runDirectory, { itemId: item.id, attemptId, epoch: lease.epoch });
      return;
    }
    if (observation.status !== "completed") {
      await this.#record({
        ...eventBase(`Adapter failed with exit code ${observation.exitCode}`),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "ADAPTER_FAILED",
      });
      return;
    }
    if (await this.#blockItemForStop(item, attemptId)) {
      return;
    }
    await this.#record({ ...eventBase("Runtime is verifying the observed tree"), type: "ITEM_VERIFYING", itemId: item.id, attemptId });

    let finalObservation = after;
    let verification = await this.#verifyItem(item, worktreePath, attemptId, finalObservation);
    if (await this.#blockItemForStop(item, attemptId)) {
      return;
    }
    if (!verification.met) {
      await this.#record({
        ...eventBase(verification.reasons.join("; ") || "Acceptance predicates are not met"),
        type: "ITEM_BLOCKED",
        itemId: item.id,
        attemptId,
        errorCode: "PREDICATE_NOT_MET",
      });
      return;
    }
    if (!finalObservation.clean && this.#charter.commitPolicy?.preCommitHook === "run") {
      if (await this.#blockItemForStop(item, attemptId)) {
        return;
      }
      const hook = await runPreCommitHook(
        worktreePath,
        hookSnapshot ?? { identity: "NOT_CONFIGURED" },
        this.#charter.commitPolicy.environmentNames,
        this.#charter.limits.attemptTimeoutMs,
        this.#charter.limits.maxRetainedOutputBytes,
      );
      const hookObservation = await this.#observeRepository(worktreePath);
      const hooksDirectory = join(this.#runDirectory, "reports", "hooks");
      await mkdir(hooksDirectory, { recursive: true, mode: 0o700 });
      const hookPath = join(hooksDirectory, `${attemptId}.json`);
      await writeJsonAtomic(hookPath, {
        schemaVersion: 1,
        status: hook.status,
        configuredPath: hook.path,
        beforeTree: finalObservation.treeIdentity,
        afterTree: hookObservation.treeIdentity,
        exitCode: hook.result?.exitCode ?? 0,
        stdout: redactEnvironmentSecrets(hook.result?.stdout ?? "", this.#charter.commitPolicy.environmentNames),
        stderr: redactEnvironmentSecrets(hook.result?.stderr ?? "", this.#charter.commitPolicy.environmentNames),
        truncated: hook.result?.truncated ?? false,
      });
      await this.#record({
        ...eventBase(`Pre-commit hook finished ${hook.status}`),
        type: "PRE_COMMIT_HOOK_FINISHED",
        itemId: item.id,
        attemptId,
        status: hook.status,
        beforeTree: finalObservation.treeIdentity,
        afterTree: hookObservation.treeIdentity,
        exitCode: hook.result?.exitCode ?? 0,
        evidence: [hookPath],
      });
      if (await this.#blockItemForStop(item, attemptId)) {
        return;
      }
      if (hookObservation.headCommit !== finalObservation.headCommit
        || hookObservation.externalRefIdentity !== finalObservation.externalRefIdentity) {
        throw new AutopilotError("BRANCH_COLLISION", "pre-commit hook changed HEAD or another Git ref");
      }
      if (hookObservation.configurationIdentity !== finalObservation.configurationIdentity) {
        throw new AutopilotError("CAPABILITY_DENIED", "pre-commit hook changed Git configuration");
      }
      await assertWritablePaths(
        worktreePath,
        hookObservation.changedPaths,
        [...item.writableRoots, ...this.#charter.commitPolicy.writableRoots],
      );
      if (hook.status === "FAILED") {
        await this.#record({
          ...eventBase("Pre-commit hook failed before the runtime-owned commit"),
          type: "ITEM_BLOCKED",
          itemId: item.id,
          attemptId,
          errorCode: "PRE_COMMIT_HOOK_FAILED",
        });
        return;
      }
      if (hookObservation.treeIdentity !== finalObservation.treeIdentity) {
        verification = await this.#verifyItem(item, worktreePath, attemptId, hookObservation);
        if (!verification.met) {
          await this.#record({
            ...eventBase(verification.reasons.join("; ") || "Post-hook acceptance predicates are not met"),
            type: "ITEM_BLOCKED",
            itemId: item.id,
            attemptId,
            errorCode: "POST_HOOK_PREDICATE_NOT_MET",
          });
          return;
        }
      }
      finalObservation = hookObservation;
    }
    const finalHook = await inspectPreCommitHook(worktreePath);
    const receiptIds: string[] = [];
    for (const { event: receiptEvent } of this.#records) {
      if (receiptEvent.type !== "RECEIPT_RECORDED" || receiptEvent.itemId !== item.id
        || receiptEvent.attemptId !== attemptId) {
        continue;
      }
      const receiptValue: unknown = JSON.parse(await readFile(
        join(this.#runDirectory, "receipts", `${receiptEvent.receiptId}.json`),
        "utf8",
      ));
      const requiredGateReceipt = receiptEvent.gateId !== undefined && item.acceptance.some((predicate) =>
        predicate.type === "gate-passed" && predicate.gateId === receiptEvent.gateId
      );
      if (isRecord(receiptValue) && receiptValue.subject === verification.subject
        && (receiptEvent.receiptKind === "predicate" || requiredGateReceipt)) {
        receiptIds.push(receiptEvent.receiptId);
      }
    }
    await this.#record({
      ...eventBase("Exact tree and acceptance evidence verified"),
      type: "ITEM_VERIFIED",
      itemId: item.id,
      attemptId,
      subject: verification.subject,
      headCommit: finalObservation.headCommit,
      treeIdentity: finalObservation.treeIdentity,
      auxiliaryRefIdentity: finalObservation.auxiliaryRefIdentity,
      externalRefIdentity: finalObservation.externalRefIdentity,
      configurationIdentity: finalObservation.configurationIdentity,
      hookIdentity: finalHook.identity,
      ...(finalHook.path === undefined ? {} : { hookPath: finalHook.path }),
      commitRequired: !finalObservation.clean,
      receiptIds,
    });
    const checkpoint = this.#projection.items[item.id]?.verified;
    if (checkpoint === undefined) {
      throw new AutopilotError("JOURNAL_CORRUPT", "verified checkpoint was not projected");
    }
    await this.#completeVerifiedItem(item, worktreePath, checkpoint);
  }

  async run(): Promise<RunReport> {
    if (this.#projection.state === "SUCCEEDED" || this.#projection.state === "STOPPED") {
      return await this.#writeReport();
    }
    if (await this.#stopRunIfRequested()) {
      return await this.#writeReport();
    }
    if (!this.#hasUnobservedExecution() && await this.#settlePauseIfRequested()) {
      return await this.#writeReport();
    }
    try {
      this.#manifest = await this.#adapter.describe();
    } catch (error) {
      await this.#record({
        ...eventBase(error instanceof Error ? error.message : String(error)),
        type: "RUN_STOPPED",
        errorCode: error instanceof AutopilotError ? error.code : "ADAPTER_PREFLIGHT_FAILED",
        remediation: "Install or configure the selected harness adapter, then start a successor run.",
      });
      return await this.#writeReport();
    }
    if (await this.#stopRunIfRequested()) {
      return await this.#writeReport();
    }
    if (!this.#hasUnobservedExecution() && await this.#settlePauseIfRequested()) {
      return await this.#writeReport();
    }
    if (this.#charter.minimumAssurance === "enforced" && this.#manifest.assurance !== "enforced") {
      await this.#record({
        ...eventBase(`${this.#manifest.adapterName} provides cooperative assurance, but the charter requires enforced assurance`),
        type: "RUN_STOPPED",
        errorCode: "ADAPTER_UNSUPPORTED",
        remediation: "Select an adapter with enforced restrictions or create a successor charter that explicitly accepts cooperative assurance.",
      });
      return await this.#writeReport();
    }
    try {
      await this.#preflight();
    } catch (error) {
      await this.#record({
        ...eventBase(error instanceof Error ? error.message : String(error)),
        type: "RUN_STOPPED",
        errorCode: error instanceof AutopilotError ? error.code : "PREFLIGHT_FAILED",
        remediation: "Update the proposed charter or install/configure the selected adapter, then start a successor run.",
      });
      return await this.#writeReport();
    }
    if (await this.#stopRunIfRequested()) {
      return await this.#writeReport();
    }
    if (await this.#settlePauseIfRequested()) {
      return await this.#writeReport();
    }
    await this.#record({ ...eventBase("Reconciling durable state and observed effects", "reconciler"), type: "RECONCILIATION_STARTED" });
    await this.#reconcileInterruptedItems();
    await this.#record({ ...eventBase("Reconciliation completed", "reconciler"), type: "RECONCILIATION_COMPLETED" });
    if (await this.#waitForUnknownExecution()) {
      return await this.#writeReport();
    }
    if (this.#charter.restack !== undefined) {
      await this.#runRestackLifecycle();
      if (this.#stopRequested) {
        await this.#stopRunIfRequested();
      } else if (this.#pauseRequested) {
        await this.#settlePauseIfRequested();
      }
      return await this.#writeReport();
    }

    while (this.#projection.state === "RUNNING") {
      if (await this.#stopRunIfRequested()) {
        break;
      }
      if (await this.#settlePauseIfRequested()) {
        break;
      }
      const verifiedItems = this.#charter.work.filter(({ id }) => {
        const projected = this.#projection.items[id];
        return projected?.state === "VERIFYING" && projected.verified !== undefined;
      });
      if (verifiedItems.length > 0) {
        await Promise.all(verifiedItems.map(async (item) => {
          const checkpoint = this.#projection.items[item.id]?.verified;
          if (checkpoint === undefined) {
            return;
          }
          const lease = await readLease(this.#runDirectory, item.id);
          const worktreePath = lease?.worktreePath ?? await resolveWorktreePath(this.#charter, item);
          try {
            await this.#completeVerifiedItem(item, worktreePath, checkpoint);
          } catch (error) {
            if (!this.#pauseRequested && !this.#stopRequested) {
              await this.#record({
                ...eventBase(error instanceof Error ? error.message : String(error)),
                type: "ITEM_BLOCKED",
                itemId: item.id,
                attemptId: checkpoint.attemptId,
                errorCode: error instanceof AutopilotError ? error.code : "UNKNOWN_FAILURE",
              });
            }
          }
        }));
        if (this.#pauseRequested) {
          await this.#settlePauseIfRequested();
        }
        if (this.#stopRequested) {
          await this.#stopRunIfRequested();
        }
        continue;
      }
      const frontier = runnableFrontier(this.#charter, this.#projection, this.#manifest.maxConcurrency);
      if (frontier.length === 0) {
        const satisfied = this.#charter.work.every(({ id }) => this.#projection.items[id]?.state === "SATISFIED");
        if (satisfied) {
          if (await this.#stopRunIfRequested() || await this.#settlePauseIfRequested()) {
            break;
          }
          await this.#record({ ...eventBase("Evaluating the complete charter"), type: "RUN_VERIFYING" });
          if (await this.#stopRunIfRequested() || await this.#settlePauseIfRequested()) {
            break;
          }
          try {
            await this.#record({
              ...eventBase("Every original completion predicate is satisfied"),
              type: "RUN_SUCCEEDED",
              predicateSummary: "All work items are SATISFIED with current tree-bound receipts.",
            });
          } catch (error) {
            if (!this.#pauseRequested && !this.#stopRequested) {
              throw error;
            }
            if (this.#stopRequested) {
              await this.#stopRunIfRequested();
            } else {
              await this.#settlePauseIfRequested();
            }
          }
          break;
        }
        for (const item of blockedByDependency(this.#charter, this.#projection)) {
          await this.#record({ ...eventBase("A required predecessor did not satisfy its predicates"), type: "ITEM_ABANDONED", itemId: item.id });
        }
        await this.#record({
          ...eventBase("No runnable item remains within the sealed budgets"),
          type: "RUN_STOPPED",
          errorCode: "BUDGET_EXHAUSTED",
          remediation: "Inspect reports/final.json and preserved worktrees, then create a successor charter if authority or budgets must change.",
        });
        break;
      }
      await Promise.all(frontier.map(async (item) => {
        try {
          await this.#runItem(item);
        } catch (error) {
          const state = this.#projection.items[item.id]?.state;
          if (state === "ACTIVE" || state === "VERIFYING" || state === "READY") {
            await this.#record({
              ...eventBase(error instanceof Error ? error.message : String(error)),
              type: "ITEM_BLOCKED",
              itemId: item.id,
              errorCode: error instanceof AutopilotError ? error.code : "UNKNOWN_FAILURE",
            });
          }
        }
      }));
    }
    return await this.#writeReport();
  }

  async #writeReport(): Promise<RunReport> {
    const manifest = this.#manifest;
    return await writeReports(
      this.#runDirectory,
      this.#charter,
      this.#projection,
      this.#records,
      manifest?.assurance ?? "unverified",
      [
        `Harness behavior is verified only for the recorded ${manifest?.adapterName ?? "unloaded adapter"} ${manifest?.harnessVersion ?? "version"}.`,
        ...(manifest?.limitations ?? []),
        "Sudden-power-loss durability for Windows directory metadata is unverified.",
        "GitHub and GitLab organization policy behavior requires an explicitly authorized disposable repository run.",
      ],
    );
  }
}
