import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadAmendmentContext } from "./amendment.js";
import { createDeliveryAdapter } from "./delivery-adapters.js";
import { changeRequestTitle, reviewThreadDigest } from "./delivery.js";
import { evaluateItemDone } from "./done.js";
import { AutopilotError } from "./errors.js";
import { executeItemGates, redactEnvironmentSecrets, storeReceipt } from "./evidence.js";
import { newEventId } from "./events.js";
import { blockedByDependency, runnableFrontier } from "./frontier.js";
import { appendEvent, writeImmutableJson, writeJsonAtomic } from "./journal.js";
import { canonicalJson, sha256 } from "./json.js";
import { acquireWriterLease, leaseIsCurrent, readLease } from "./leases.js";
import { authorizeEffect } from "./policy.js";
import { writeSnapshot } from "./projection.js";
import { reduce } from "./reducer.js";
import { assertWritablePaths, branchExists, commitAcceptedWork, ensureWorktree, inspectPreCommitHook, observeRepository, pushAmendmentBranch, pushBranch, remoteBranchCommit, resolveCommit, resolveWorktreePath, runPreCommitHook, } from "./repository.js";
import { writeReports } from "./report.js";
const RUNTIME_CAPABILITIES = {
    families: [
        "files.read", "files.write", "process.execute", "network.access", "credentials.use", "git.commit", "remote.push",
        "change-request.open", "change-request.update", "review-thread.resolve", "merge.execute",
    ],
    assurance: "enforced",
    maxConcurrency: 1,
    unattended: true,
    cancellation: true,
    restartReattachment: true,
};
function eventBase(reason, source = "runtime") {
    return { eventId: newEventId(), timestamp: new Date().toISOString(), source, reason };
}
function playbookRequests(charter) {
    const requested = new Set(["files.read", "files.write", "process.execute", "network.access", "credentials.use", "git.commit"]);
    if (charter.delivery !== "local-commits") {
        requested.add("remote.push");
        requested.add(charter.amends === undefined ? "change-request.open" : "change-request.update");
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
    #stateRoot;
    #runDirectory;
    #charter;
    #adapter;
    #requested;
    #records;
    #projection;
    #appendQueue = Promise.resolve();
    #manifest;
    #amendment;
    #stopRequested = false;
    #activeHandles = new Map();
    constructor(options) {
        this.#stateRoot = options.stateRoot;
        this.#runDirectory = options.runDirectory;
        this.#charter = options.charter;
        this.#adapter = options.adapter;
        this.#records = [...options.records];
        this.#projection = options.projection;
        this.#requested = playbookRequests(options.charter);
    }
    async requestStop() {
        if (this.#stopRequested) {
            return;
        }
        this.#stopRequested = true;
        await Promise.all([...this.#activeHandles.values()].map(async (handle) => {
            try {
                await this.#adapter.cancel(handle);
            }
            catch {
                // The coordinator still stops after the bounded process deadline.
            }
        }));
    }
    async #blockItemForStop(item, attemptId) {
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
    async #stopRunIfRequested() {
        if (!this.#stopRequested) {
            return false;
        }
        await this.#record({
            ...eventBase("Coordinator received an interrupt request", "operator"),
            type: "RUN_STOPPED",
            errorCode: "OPERATOR_STOP",
            remediation: "Inspect preserved worktrees and create a successor charter to continue.",
        });
        return true;
    }
    async #record(event) {
        let failure;
        this.#appendQueue = this.#appendQueue.then(async () => {
            try {
                const record = await appendEvent(`${this.#runDirectory}/events.jsonl`, event);
                this.#projection = reduce(this.#projection, event);
                this.#records.push(record);
                await writeSnapshot(`${this.#runDirectory}/snapshot.json`, this.#projection, this.#records);
            }
            catch (error) {
                failure = error;
            }
        });
        await this.#appendQueue;
        if (failure !== undefined) {
            throw failure;
        }
    }
    #runtimeAuthorize(family, details = {}) {
        authorizeEffect({ family, actor: "runtime", ...details }, this.#requested, this.#charter.grants, RUNTIME_CAPABILITIES);
    }
    #adapterAuthorize(family) {
        if (this.#manifest === undefined) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter capabilities have not been loaded");
        }
        authorizeEffect({ family, actor: "adapter" }, this.#requested, this.#charter.grants, {
            families: this.#manifest.families,
            assurance: this.#manifest.assurance,
            maxConcurrency: this.#manifest.maxConcurrency,
            unattended: this.#manifest.unattended,
            cancellation: this.#manifest.cancellation,
            restartReattachment: this.#manifest.restartReattachment,
        });
    }
    #deliveryAuthorize(family, details = {}) {
        authorizeEffect({ family, actor: "delivery", ...details }, this.#requested, this.#charter.grants, RUNTIME_CAPABILITIES);
    }
    #workerAuthorize(family, details = {}) {
        if (this.#manifest === undefined) {
            throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter capabilities have not been loaded");
        }
        authorizeEffect({ family, actor: "worker", ...details }, this.#requested, this.#charter.grants, {
            families: this.#manifest.families,
            assurance: this.#manifest.assurance,
            maxConcurrency: this.#manifest.maxConcurrency,
            unattended: this.#manifest.unattended,
            cancellation: this.#manifest.cancellation,
            restartReattachment: this.#manifest.restartReattachment,
        });
    }
    async #preflight() {
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
                    const observed = await observeRepository(lease.worktreePath);
                    const confirmedCommit = this.#records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "git.commit"
                        ? [event.observedState]
                        : []).at(-1);
                    const reconciledCommit = this.#amendment?.reconciledCommit?.commit;
                    if (itemProjection.state === "ACTIVE" && observed.headCommit !== attempt.expectedBaseCommit) {
                        throw new AutopilotError("BRANCH_COLLISION", "active worker attempt changed HEAD before reconciliation");
                    }
                    if (itemProjection.state === "VERIFYING" && observed.headCommit !== attempt.expectedBaseCommit
                        && observed.headCommit !== confirmedCommit && observed.headCommit !== reconciledCommit) {
                        throw new AutopilotError("BRANCH_COLLISION", "verifying attempt has an unowned HEAD commit");
                    }
                    if (attempt.expectedRefIdentity !== undefined && observed.auxiliaryRefIdentity !== attempt.expectedRefIdentity) {
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
            for (const root of item.writableRoots) {
                const absoluteRoot = resolve(this.#charter.repository.root, root);
                this.#workerAuthorize("files.read", { path: absoluteRoot });
                this.#workerAuthorize("files.write", { path: absoluteRoot });
            }
            for (const predicate of item.acceptance) {
                if (predicate.type === "path-present" || predicate.type === "path-absent") {
                    this.#runtimeAuthorize("files.read", { path: resolve(this.#charter.repository.root, predicate.path) });
                }
                else if (predicate.type === "search-count") {
                    predicate.paths.forEach((path) => this.#runtimeAuthorize("files.read", { path: resolve(this.#charter.repository.root, path) }));
                }
            }
        }
        this.#workerAuthorize("process.execute");
        this.#adapterAuthorize("network.access");
        this.#adapterAuthorize("credentials.use");
        this.#runtimeAuthorize("git.commit", { repository: this.#charter.repository.root });
        if (this.#charter.commitPolicy?.preCommitHook === "run") {
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
            }
            else {
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
            this.#deliveryAuthorize(this.#amendment === undefined ? "change-request.open" : "change-request.update", { repository: this.#charter.repository.root });
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
                    const reviewResolutionStarted = this.#records.some(({ event }) => event.type === "EFFECT_INTENDED" && event.effect === "review-thread.resolve");
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
    async #validateReviewFeedback(delivery, reference, requiredState) {
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
    async #resolveReviewFeedback(delivery, reference, item, expectedHeadCommit) {
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
        if (this.#stopRequested || threadIds.length === 0) {
            return;
        }
        this.#deliveryAuthorize("review-thread.resolve", { repository: this.#charter.repository.root });
        const idempotencyKey = `review-thread.resolve:${reference.provider}:${reference.id}:${sha256(canonicalJson(threadIds))}`;
        const alreadyConfirmed = this.#records.some(({ event }) => event.type === "EFFECT_CONFIRMED" && event.effect === "review-thread.resolve" && event.idempotencyKey === idempotencyKey);
        if (alreadyConfirmed) {
            await this.#validateReviewFeedback(delivery, reference, "resolved");
            return;
        }
        const intended = this.#records.some(({ event }) => event.type === "EFFECT_INTENDED" && event.effect === "review-thread.resolve" && event.idempotencyKey === idempotencyKey);
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
        if (this.#stopRequested) {
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
    async #reconcileInterruptedItems() {
        for (const item of this.#charter.work) {
            const itemProjection = this.#projection.items[item.id];
            if (itemProjection?.state !== "ACTIVE" && itemProjection?.state !== "VERIFYING") {
                continue;
            }
            const attempt = itemProjection.attempts.at(-1);
            if (attempt === undefined) {
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
            await this.#record({
                ...eventBase("Interrupted attempt requires a fresh lease", "reconciler"),
                type: "ITEM_BLOCKED",
                itemId: item.id,
                attemptId: attempt.attemptId,
                errorCode: "INTERRUPTED_ATTEMPT",
            });
        }
    }
    async #deliverItem(item, worktreePath, expectedCommit) {
        const target = this.#charter.deliveryTarget;
        if (this.#charter.delivery === "local-commits" || target === undefined) {
            return true;
        }
        this.#runtimeAuthorize("remote.push", { repository: this.#charter.repository.root, remote: target.remote, branch: item.branchName });
        this.#runtimeAuthorize("network.access");
        this.#runtimeAuthorize("credentials.use");
        const pushKey = `push:${this.#charter.runId}:${item.id}:${expectedCommit}`;
        await this.#record({
            ...eventBase("Recording push intent before the remote Git effect"),
            type: "EFFECT_INTENDED",
            itemId: item.id,
            effect: "remote.push",
            idempotencyKey: pushKey,
            expectedState: expectedCommit,
        });
        const remoteCommit = this.#amendment === undefined
            ? await pushBranch(worktreePath, target.remote, item.branchName, expectedCommit)
            : await pushAmendmentBranch(worktreePath, target.remote, item.branchName, this.#amendment.deliveryBaseCommit, expectedCommit);
        await this.#record({
            ...eventBase("Expected remote branch commit observed"),
            type: "EFFECT_CONFIRMED",
            itemId: item.id,
            effect: "remote.push",
            idempotencyKey: pushKey,
            observedState: remoteCommit,
        });
        if (this.#amendment !== undefined) {
            this.#amendment = { ...this.#amendment, deliveryBaseCommit: remoteCommit };
        }
        if (this.#stopRequested) {
            return false;
        }
        this.#deliveryAuthorize("network.access");
        this.#deliveryAuthorize("credentials.use");
        const changeRequestEffect = this.#amendment === undefined ? "change-request.open" : "change-request.update";
        this.#deliveryAuthorize(changeRequestEffect, { repository: this.#charter.repository.root });
        const delivery = createDeliveryAdapter(target.provider);
        await delivery.describe();
        if (this.#stopRequested) {
            return false;
        }
        const changeRequestKey = `change-request:${this.#charter.runId}:${item.id}`;
        await this.#record({
            ...eventBase(this.#amendment === undefined ? "Recording change-request intent before provider mutation" : "Recording existing change-request head update"),
            type: "EFFECT_INTENDED",
            itemId: item.id,
            effect: changeRequestEffect,
            idempotencyKey: changeRequestKey,
            expectedState: expectedCommit,
        });
        const predecessorId = item.dependsOn.at(-1);
        const predecessor = predecessorId === undefined ? undefined : this.#charter.work.find(({ id }) => id === predecessorId);
        const baseBranch = this.#charter.mode === "ordered-stack" && this.#charter.delivery === "change-request-ready" && predecessor !== undefined
            ? predecessor.branchName
            : target.baseBranch;
        const existing = this.#amendment === undefined
            ? await delivery.findChangeRequest(this.#charter.repository.root, this.#charter.runId, item.id)
            : this.#amendment.changeRequest;
        if (existing === undefined && this.#stopRequested) {
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
        if (this.#amendment !== undefined && observed.ref.url !== this.#amendment.changeRequest.url) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "provider returned a different change request during amendment delivery");
        }
        if (observed.headCommit !== expectedCommit) {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "change-request head does not match the verified commit", {
                expected: expectedCommit,
                observed: observed.headCommit,
            });
        }
        if (observed.state === "closed") {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "matching change request is closed without a merge");
        }
        await this.#record({
            ...eventBase("Change request at expected head observed"),
            type: "EFFECT_CONFIRMED",
            itemId: item.id,
            effect: changeRequestEffect,
            idempotencyKey: changeRequestKey,
            observedState: reference.url,
        });
        if (this.#stopRequested) {
            return false;
        }
        await this.#resolveReviewFeedback(delivery, reference, item, expectedCommit);
        if (this.#stopRequested) {
            return false;
        }
        if (this.#charter.delivery !== "merge-verified") {
            return true;
        }
        this.#deliveryAuthorize("merge.execute", { repository: this.#charter.repository.root });
        const mergeKey = `merge:${target.provider}:${reference.id}:${expectedCommit}`;
        if (observed.state === "merged") {
            await this.#record({
                ...eventBase("Previously merged expected head reconciled"),
                type: "EFFECT_CONFIRMED",
                itemId: item.id,
                effect: "merge.execute",
                idempotencyKey: mergeKey,
                observedState: expectedCommit,
            });
            return !this.#stopRequested;
        }
        const checks = await delivery.observeChecks(this.#charter.repository.root, expectedCommit);
        const checksStatus = checks.length === 0
            ? "UNVERIFIED"
            : checks.every(({ subjectCommit, status }) => subjectCommit === expectedCommit && status === "passed") ? "PASSED" : "FAILED";
        const checksArtifact = {
            schemaVersion: 1,
            type: "remote-checks",
            provider: target.provider,
            subject: expectedCommit,
            observedAt: new Date().toISOString(),
            status: checksStatus,
            checks,
        };
        const checksReceiptId = sha256(canonicalJson(checksArtifact));
        const checksPath = join(this.#runDirectory, "receipts", `${checksReceiptId}.json`);
        await writeImmutableJson(checksPath, { ...checksArtifact, receiptId: checksReceiptId });
        await this.#record({
            ...eventBase(`Remote checks recorded ${checksStatus}`),
            type: "RECEIPT_RECORDED",
            itemId: item.id,
            receiptId: checksReceiptId,
            status: checksStatus,
            evidence: [checksPath],
        });
        if (checksStatus === "FAILED") {
            throw new AutopilotError("EFFECT_RECONCILIATION_FAILED", "remote checks are not all passed for the expected head");
        }
        if (this.#stopRequested) {
            return false;
        }
        await this.#record({
            ...eventBase("Recording merge intent for the verified current head"),
            type: "EFFECT_INTENDED",
            itemId: item.id,
            effect: "merge.execute",
            idempotencyKey: mergeKey,
            expectedState: expectedCommit,
        });
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
    async #verifyItem(item, worktreePath, attemptId, observation) {
        for (const gate of this.#charter.gates.filter(({ appliesTo }) => appliesTo.length === 0 || appliesTo.includes(item.id))) {
            if (gate.type === "command") {
                this.#runtimeAuthorize("process.execute", { executable: gate.executable });
                for (const environmentName of gate.environmentNames) {
                    this.#runtimeAuthorize("process.execute", { executable: gate.executable, environmentName });
                    this.#runtimeAuthorize("credentials.use", { environmentName });
                }
            }
            else {
                this.#runtimeAuthorize("files.read");
            }
        }
        const subject = `tree:${observation.treeIdentity}`;
        const receipts = await executeItemGates(this.#charter, item, worktreePath, subject);
        const afterGates = await observeRepository(worktreePath);
        if (afterGates.headCommit !== observation.headCommit || afterGates.treeIdentity !== observation.treeIdentity
            || afterGates.refIdentity !== observation.refIdentity
            || afterGates.configurationIdentity !== observation.configurationIdentity) {
            throw new AutopilotError("CAPABILITY_DENIED", "verification gate changed the worktree, Git refs, or Git configuration");
        }
        for (const receipt of receipts) {
            const path = await storeReceipt(this.#runDirectory, receipt);
            await this.#record({
                ...eventBase(`Verification gate ${receipt.gateId} recorded ${receipt.status}`),
                type: "RECEIPT_RECORDED",
                itemId: item.id,
                attemptId,
                receiptId: receipt.receiptId,
                status: receipt.status,
                evidence: [path],
            });
        }
        const evaluation = await evaluateItemDone(this.#charter, item, worktreePath, subject, receipts);
        return { subject, met: evaluation.outcome === "met", reasons: evaluation.reasons };
    }
    async #runItem(item) {
        if (this.#stopRequested) {
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
        const ownedCommits = this.#records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" && event.itemId === item.id && event.effect === "git.commit"
            ? [event.observedState]
            : []);
        const worktreePath = this.#amendment?.worktreePath
            ?? await ensureWorktree(this.#charter, item, baseCommit, ownedCommits);
        const before = await observeRepository(worktreePath);
        const hookSnapshot = this.#charter.commitPolicy?.preCommitHook === "run"
            ? await inspectPreCommitHook(worktreePath)
            : undefined;
        const attemptId = randomUUID();
        const lease = await acquireWriterLease(this.#runDirectory, item.id, item.branchName, worktreePath, attemptId, this.#charter.limits.attemptTimeoutMs);
        const deadline = lease.expiresAt;
        await this.#record({
            ...eventBase("Starting a fresh bounded harness session"),
            type: "ATTEMPT_STARTED",
            itemId: item.id,
            attemptId,
            leaseEpoch: lease.epoch,
            expectedBaseCommit: before.headCommit,
            expectedRefIdentity: before.auxiliaryRefIdentity,
            expectedConfigurationIdentity: before.configurationIdentity,
            ...(hookSnapshot === undefined ? {} : {
                expectedHookIdentity: hookSnapshot.identity,
                ...(hookSnapshot.path === undefined ? {} : { expectedHookPath: hookSnapshot.path }),
            }),
            deadline,
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
        const handle = await this.#adapter.launch({
            protocolVersion: 1,
            runId: this.#charter.runId,
            itemId: item.id,
            attemptId,
            worktreePath,
            objective: item.objective,
            acceptanceSummary: item.acceptance.map((predicate) => JSON.stringify(predicate)).join("; "),
            writableRoots: item.writableRoots,
            grants: this.#charter.grants.filter(({ actor }) => actor === "worker" || actor === "adapter"),
            deadline,
            idleTimeoutMs: this.#charter.limits.idleTimeoutMs,
            maximumLineBytes: this.#charter.limits.maxAdapterLineBytes,
            maximumOutputBytes: this.#charter.limits.maxRetainedOutputBytes,
        });
        this.#activeHandles.set(handle.adapterExecutionId, handle);
        if (this.#stopRequested) {
            try {
                await this.#adapter.cancel(handle);
            }
            catch {
                // Observation still owns bounded process cleanup.
            }
        }
        let observation;
        try {
            observation = await this.#adapter.observe(handle);
        }
        finally {
            this.#activeHandles.delete(handle.adapterExecutionId);
        }
        const attemptsDirectory = join(this.#runDirectory, "reports", "attempts");
        await mkdir(attemptsDirectory, { recursive: true, mode: 0o700 });
        const observationPath = join(attemptsDirectory, `${attemptId}.json`);
        await writeJsonAtomic(observationPath, observation);
        const currentLease = await readLease(this.#runDirectory, item.id);
        const after = await observeRepository(worktreePath);
        const stale = currentLease === undefined || !leaseIsCurrent(currentLease, attemptId) || currentLease.epoch !== lease.epoch;
        await this.#record({
            ...eventBase(stale ? "Late adapter result quarantined" : "Adapter execution observed"),
            type: "ATTEMPT_FINISHED",
            itemId: item.id,
            attemptId,
            observedHeadCommit: after.headCommit,
            outcome: stale ? "stale" : observation.status,
            evidence: [observationPath],
        });
        if (await this.#blockItemForStop(item, attemptId)) {
            return;
        }
        if (stale || observation.status !== "completed") {
            await this.#record({
                ...eventBase(stale ? "Writer lease expired" : `Adapter failed with exit code ${observation.exitCode}`),
                type: "ITEM_BLOCKED",
                itemId: item.id,
                attemptId,
                errorCode: stale ? "STALE_LEASE" : "ADAPTER_FAILED",
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
        if (after.refIdentity !== before.refIdentity) {
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
            const hook = await runPreCommitHook(worktreePath, hookSnapshot ?? { identity: "NOT_CONFIGURED" }, this.#charter.commitPolicy.environmentNames, this.#charter.limits.attemptTimeoutMs, this.#charter.limits.maxRetainedOutputBytes);
            const hookObservation = await observeRepository(worktreePath);
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
            if (hookObservation.headCommit !== finalObservation.headCommit || hookObservation.refIdentity !== finalObservation.refIdentity) {
                throw new AutopilotError("BRANCH_COLLISION", "pre-commit hook changed HEAD or another Git ref");
            }
            if (hookObservation.configurationIdentity !== finalObservation.configurationIdentity) {
                throw new AutopilotError("CAPABILITY_DENIED", "pre-commit hook changed Git configuration");
            }
            await assertWritablePaths(worktreePath, hookObservation.changedPaths, [...item.writableRoots, ...this.#charter.commitPolicy.writableRoots]);
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
        let acceptedCommit = finalObservation.headCommit;
        if (await this.#blockItemForStop(item, attemptId)) {
            return;
        }
        if (!finalObservation.clean) {
            this.#runtimeAuthorize("git.commit", { repository: this.#charter.repository.root, branch: item.branchName });
            const idempotencyKey = `commit:${this.#charter.runId}:${item.id}:${finalObservation.treeIdentity}`;
            await this.#record({
                ...eventBase("Recording commit intent before the Git effect"),
                type: "EFFECT_INTENDED",
                itemId: item.id,
                attemptId,
                effect: "git.commit",
                idempotencyKey,
                expectedState: finalObservation.treeIdentity,
            });
            acceptedCommit = await commitAcceptedWork(worktreePath, this.#charter, item, attemptId, finalObservation.treeIdentity, finalObservation.headCommit);
            await this.#record({
                ...eventBase("Verified commit observed"),
                type: "EFFECT_CONFIRMED",
                itemId: item.id,
                attemptId,
                effect: "git.commit",
                idempotencyKey,
                observedState: acceptedCommit,
            });
        }
        if (await this.#blockItemForStop(item, attemptId)) {
            return;
        }
        const delivered = await this.#deliverItem(item, worktreePath, acceptedCommit);
        if (!delivered) {
            await this.#blockItemForStop(item, attemptId);
            return;
        }
        if (await this.#blockItemForStop(item, attemptId)) {
            return;
        }
        await this.#record({
            ...eventBase("All item predicates and delivery requirements are met"),
            type: "ITEM_SATISFIED",
            itemId: item.id,
            attemptId,
            subject: verification.subject,
        });
    }
    async run() {
        if (this.#projection.state === "SUCCEEDED" || this.#projection.state === "STOPPED") {
            return await this.#writeReport();
        }
        if (await this.#stopRunIfRequested()) {
            return await this.#writeReport();
        }
        try {
            this.#manifest = await this.#adapter.describe();
        }
        catch (error) {
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
        }
        catch (error) {
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
        await this.#record({ ...eventBase("Reconciling durable state and observed effects", "reconciler"), type: "RECONCILIATION_STARTED" });
        await this.#reconcileInterruptedItems();
        await this.#record({ ...eventBase("Reconciliation completed", "reconciler"), type: "RECONCILIATION_COMPLETED" });
        while (this.#projection.state === "RUNNING") {
            if (await this.#stopRunIfRequested()) {
                break;
            }
            const frontier = runnableFrontier(this.#charter, this.#projection, this.#manifest.maxConcurrency);
            if (frontier.length === 0) {
                const satisfied = this.#charter.work.every(({ id }) => this.#projection.items[id]?.state === "SATISFIED");
                if (satisfied) {
                    if (await this.#stopRunIfRequested()) {
                        break;
                    }
                    await this.#record({ ...eventBase("Evaluating the complete charter"), type: "RUN_VERIFYING" });
                    if (await this.#stopRunIfRequested()) {
                        break;
                    }
                    await this.#record({
                        ...eventBase("Every original completion predicate is satisfied"),
                        type: "RUN_SUCCEEDED",
                        predicateSummary: "All work items are SATISFIED with current tree-bound receipts.",
                    });
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
                }
                catch (error) {
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
    async #writeReport() {
        const manifest = this.#manifest;
        return await writeReports(this.#runDirectory, this.#charter, this.#projection, this.#records, manifest?.assurance ?? "unverified", [
            `Harness behavior is verified only for the recorded ${manifest?.adapterName ?? "unloaded adapter"} ${manifest?.harnessVersion ?? "version"}.`,
            ...(manifest?.limitations ?? []),
            "Windows locking and process-group cancellation are unverified.",
            "GitHub and GitLab organization policy behavior requires an explicitly authorized disposable repository run.",
        ]);
    }
}
