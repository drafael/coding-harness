import { AutopilotError } from "./errors.js";
const TERMINAL_RUN_STATES = new Set(["SUCCEEDED", "STOPPED"]);
const WRAP_UP_EFFECTS = new Set(["remote.branch.delete", "git.worktree.remove", "git.branch.delete", "handoff.write"]);
const TERMINAL_ITEM_STATES = new Set(["SATISFIED", "ABANDONED"]);
export function initialProjection(charter) {
    return {
        runId: charter.runId,
        charterHash: charter.charterHash,
        state: "COMPILED",
        items: Object.fromEntries(charter.work.map(({ id }) => [
            id,
            { itemId: id, state: "PENDING", attempts: [], replansUsed: 0 },
        ])),
        restacks: Object.fromEntries((charter.restack?.descendants ?? []).map(({ itemId, gateIds, changeRequest }) => [
            itemId,
            {
                itemId,
                state: "PENDING",
                receiptIds: [],
                requiredGateIds: gateIds,
                requiredReviewGateIds: gateIds.filter((gateId) => charter.gates.find(({ id }) => id === gateId)?.type === "review"),
                sealedWaiverGateIds: charter.waivers.filter(({ gateId }) => gateIds.includes(gateId)).map(({ gateId }) => gateId),
                passingGateIds: [],
                predicateReceiptPassed: false,
                expectedProvider: changeRequest.provider,
                expectedChangeRequestId: changeRequest.id,
                expectedChangeRequestUrl: changeRequest.url,
                expectedBaseBranch: changeRequest.baseBranch,
            },
        ])),
        appliedEventIds: new Set(),
        lastReason: "Charter sealed",
    };
}
function assertRunTransition(current, event) {
    if (TERMINAL_RUN_STATES.has(current)) {
        const wrapUpEvent = current === "SUCCEEDED" && event.source === "operator"
            && (event.type === "WRAP_UP_STARTED"
                || ((event.type === "EFFECT_INTENDED" || event.type === "EFFECT_CONFIRMED") && WRAP_UP_EFFECTS.has(event.effect)));
        if (wrapUpEvent) {
            return current;
        }
        throw new AutopilotError("ILLEGAL_TRANSITION", `terminal run state ${current} cannot accept ${event.type}`);
    }
    switch (event.type) {
        case "CHARTER_COMPILED":
            if (current !== "COMPILED") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires COMPILED, received ${current}`);
            }
            return current;
        case "RECONCILIATION_STARTED":
        case "RUN_RESUMED":
            return "RECONCILING";
        case "RECONCILIATION_COMPLETED":
            if (current !== "RECONCILING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires RECONCILING, received ${current}`);
            }
            return "RUNNING";
        case "RUN_PAUSE_REQUESTED":
            return current;
        case "RUN_WAITING":
            if (event.waiting?.kind === "operator-pause") {
                return "WAITING";
            }
            if (current !== "RUNNING" && current !== "WAITING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires RUNNING or WAITING, received ${current}`);
            }
            return "WAITING";
        case "RUN_WOKEN":
            if (current !== "WAITING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires WAITING, received ${current}`);
            }
            return "RUNNING";
        case "RUN_VERIFYING":
            if (current !== "RUNNING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires RUNNING, received ${current}`);
            }
            return "VERIFYING";
        case "RUN_SUCCEEDED":
            if (current !== "VERIFYING" || event.source !== "runtime") {
                throw new AutopilotError("ILLEGAL_TRANSITION", "RUN_SUCCEEDED requires runtime-owned VERIFYING state");
            }
            return "SUCCEEDED";
        case "RUN_STOPPED":
            return "STOPPED";
        default:
            return current;
    }
}
function transitionItem(item, event) {
    if (TERMINAL_ITEM_STATES.has(item.state)) {
        throw new AutopilotError("ILLEGAL_TRANSITION", `terminal item state ${item.state} cannot accept ${event.type}`);
    }
    switch (event.type) {
        case "DECISION_RECORDED":
            return event.decision === "Replan pending implementation"
                ? { ...item, replansUsed: item.replansUsed + 1 }
                : item;
        case "ITEM_READY":
            if (item.state !== "PENDING" && item.state !== "BLOCKED") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_READY cannot follow ${item.state}`);
            }
            return { ...item, state: "READY" };
        case "ATTEMPT_STARTED":
            if (item.state !== "READY") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ATTEMPT_STARTED cannot follow ${item.state}`);
            }
            return {
                ...item,
                state: "ACTIVE",
                attempts: [
                    ...item.attempts,
                    {
                        attemptId: event.attemptId,
                        leaseEpoch: event.leaseEpoch,
                        expectedBaseCommit: event.expectedBaseCommit,
                        ...(event.expectedTreeIdentity === undefined ? {} : { expectedTreeIdentity: event.expectedTreeIdentity }),
                        ...(event.expectedRefIdentity === undefined ? {} : { expectedRefIdentity: event.expectedRefIdentity }),
                        ...(event.expectedExternalRefIdentity === undefined ? {} : {
                            expectedExternalRefIdentity: event.expectedExternalRefIdentity,
                        }),
                        ...(event.expectedConfigurationIdentity === undefined ? {} : {
                            expectedConfigurationIdentity: event.expectedConfigurationIdentity,
                        }),
                        ...(event.expectedHookIdentity === undefined ? {} : { expectedHookIdentity: event.expectedHookIdentity }),
                        ...(event.expectedHookPath === undefined ? {} : { expectedHookPath: event.expectedHookPath }),
                        ...(event.contextHash === undefined ? {} : { contextHash: event.contextHash }),
                        ...(event.contextJournalSequence === undefined ? {} : { contextJournalSequence: event.contextJournalSequence }),
                        ...(event.executionSupervised === undefined ? {} : { executionSupervised: event.executionSupervised }),
                        deadline: event.deadline,
                        idempotencyKey: event.idempotencyKey,
                    },
                ],
            };
        case "ATTEMPT_FINISHED": {
            if (item.state !== "ACTIVE") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ATTEMPT_FINISHED cannot follow ${item.state}`);
            }
            const currentAttempt = item.attempts.at(-1);
            if (currentAttempt?.attemptId !== event.attemptId) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `attempt ${event.attemptId} is stale for item ${item.itemId}`);
            }
            return {
                ...item,
                attempts: item.attempts.map((attempt) => attempt.attemptId === event.attemptId
                    ? {
                        ...attempt,
                        outcome: event.outcome,
                        observedHeadCommit: event.observedHeadCommit,
                        ...(event.observedTreeIdentity === undefined ? {} : { observedTreeIdentity: event.observedTreeIdentity }),
                    }
                    : attempt),
            };
        }
        case "ITEM_VERIFYING":
            if (item.state !== "ACTIVE" || item.attempts.at(-1)?.attemptId !== event.attemptId) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_VERIFYING has no current attempt for ${item.itemId}`);
            }
            return { ...item, state: "VERIFYING" };
        case "ATTEMPT_PAUSED": {
            const pausedAttempt = item.attempts.at(-1);
            if (item.state !== "ACTIVE" || pausedAttempt?.attemptId !== event.attemptId
                || pausedAttempt.outcome === undefined
                || (event.budgetConsumed !== true && pausedAttempt.outcome !== "cancelled")) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ATTEMPT_PAUSED has no pause-cancelled active attempt for ${item.itemId}`);
            }
            return {
                ...item,
                state: "READY",
                attempts: item.attempts.map((attempt) => attempt.attemptId === event.attemptId
                    ? { ...attempt, budgetConsumed: event.budgetConsumed === true }
                    : attempt),
            };
        }
        case "ITEM_VERIFIED":
            if (item.state !== "VERIFYING" || item.attempts.at(-1)?.attemptId !== event.attemptId) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_VERIFIED has no verifying attempt for ${item.itemId}`);
            }
            return {
                ...item,
                verified: {
                    attemptId: event.attemptId,
                    subject: event.subject,
                    headCommit: event.headCommit,
                    treeIdentity: event.treeIdentity,
                    auxiliaryRefIdentity: event.auxiliaryRefIdentity,
                    ...(event.externalRefIdentity === undefined ? {} : { externalRefIdentity: event.externalRefIdentity }),
                    configurationIdentity: event.configurationIdentity,
                    ...(event.hookIdentity === undefined ? {} : { hookIdentity: event.hookIdentity }),
                    ...(event.hookPath === undefined ? {} : { hookPath: event.hookPath }),
                    commitRequired: event.commitRequired,
                    receiptIds: event.receiptIds,
                },
            };
        case "ITEM_SATISFIED":
            if (item.state !== "VERIFYING" || item.attempts.at(-1)?.attemptId !== event.attemptId) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_SATISFIED has no verifying attempt for ${item.itemId}`);
            }
            return { ...item, state: "SATISFIED", subject: event.subject };
        case "ITEM_BLOCKED":
            if (!["READY", "ACTIVE", "VERIFYING"].includes(item.state)) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_BLOCKED cannot follow ${item.state}`);
            }
            return { ...item, state: "BLOCKED", blocker: event.errorCode };
        case "ITEM_ABANDONED":
            return { ...item, state: "ABANDONED" };
        default:
            return item;
    }
}
function transitionRestack(projection, restack, event) {
    if (restack.state === "SATISFIED" || restack.state === "BLOCKED") {
        throw new AutopilotError("ILLEGAL_TRANSITION", `terminal restack state ${restack.state} cannot accept ${event.type}`);
    }
    switch (event.type) {
        case "RESTACK_DESCENDANT_STARTED": {
            if (restack.state !== "PENDING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `RESTACK_DESCENDANT_STARTED cannot follow ${restack.state}`);
            }
            const order = Object.keys(projection.restacks);
            const index = order.indexOf(restack.itemId);
            const previousId = index > 0 ? order[index - 1] : undefined;
            if (index < 0 || (previousId !== undefined && projection.restacks[previousId]?.state !== "SATISFIED")) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `restack descendant ${restack.itemId} started out of order`);
            }
            return {
                ...restack,
                state: "PREPARING",
                oldCommit: event.oldCommit,
                freshParentCommit: event.freshParentCommit,
            };
        }
        case "RESTACK_DESCENDANT_TREE_PREPARED":
            if (restack.state !== "PREPARING" || event.oldCommit !== restack.oldCommit
                || event.freshParentCommit !== restack.freshParentCommit) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `RESTACK_DESCENDANT_TREE_PREPARED cannot follow ${restack.state}`);
            }
            return {
                ...restack,
                state: "VERIFYING",
                candidateCommit: event.candidateCommit,
                treeIdentity: event.treeIdentity,
                messageIdentity: event.messageIdentity,
                temporaryWorktreePath: event.temporaryWorktreePath,
            };
        case "RECEIPT_RECORDED": {
            if (restack.state !== "VERIFYING" || restack.treeIdentity === undefined
                || event.subject !== `tree:${restack.treeIdentity}`) {
                throw new AutopilotError("ILLEGAL_TRANSITION", "restack receipt is not a current-tree receipt");
            }
            if (event.receiptKind === "predicate") {
                if (event.status !== "PASSED") {
                    throw new AutopilotError("ILLEGAL_TRANSITION", "restack predicate receipt did not pass");
                }
                return {
                    ...restack,
                    predicateReceiptPassed: true,
                    receiptIds: restack.receiptIds.includes(event.receiptId) ? restack.receiptIds : [...restack.receiptIds, event.receiptId],
                };
            }
            if ((event.receiptKind !== "gate" && event.receiptKind !== "review") || event.gateId === undefined
                || !restack.requiredGateIds.includes(event.gateId)
                || (event.receiptKind === "review") !== restack.requiredReviewGateIds.includes(event.gateId)
                || (event.status !== "PASSED"
                    && !(event.status === "WAIVED" && event.receiptKind === "gate"
                        && restack.sealedWaiverGateIds.includes(event.gateId) && (event.evidence?.length ?? 0) > 0))) {
                throw new AutopilotError("ILLEGAL_TRANSITION", "restack receipt does not match a passing sealed gate or validated waiver");
            }
            return {
                ...restack,
                passingGateIds: restack.passingGateIds.includes(event.gateId)
                    ? restack.passingGateIds
                    : [...restack.passingGateIds, event.gateId],
                receiptIds: restack.receiptIds.includes(event.receiptId) ? restack.receiptIds : [...restack.receiptIds, event.receiptId],
            };
        }
        case "RESTACK_DESCENDANT_VERIFIED":
            if (restack.state !== "VERIFYING" || restack.treeIdentity === undefined
                || event.subject !== `tree:${restack.treeIdentity}`
                || restack.predicateReceiptPassed !== true
                || restack.requiredGateIds.some((gateId) => !restack.passingGateIds.includes(gateId))
                || event.receiptIds.length !== restack.receiptIds.length
                || event.receiptIds.some((receiptId) => !restack.receiptIds.includes(receiptId))) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `RESTACK_DESCENDANT_VERIFIED has no matching prepared tree for ${restack.itemId}`);
            }
            return { ...restack, state: "VERIFIED", subject: event.subject, receiptIds: event.receiptIds };
        case "EFFECT_INTENDED":
            if (event.effect === "restack.local-ref") {
                if (restack.state !== "VERIFIED") {
                    throw new AutopilotError("ILLEGAL_TRANSITION", `restack.local-ref intent cannot follow ${restack.state}`);
                }
                return { ...restack, state: "COMMITTING" };
            }
            if (event.effect === "restack.remote-push") {
                if (restack.state !== "COMMITTING" || restack.localRefConfirmed !== true) {
                    throw new AutopilotError("ILLEGAL_TRANSITION", `restack.remote-push intent cannot follow unconfirmed ${restack.state}`);
                }
                return { ...restack, state: "PUSHING" };
            }
            return restack;
        case "EFFECT_CONFIRMED":
            if (event.effect === "restack.local-ref") {
                if (restack.state !== "COMMITTING" || event.observedState !== restack.candidateCommit) {
                    throw new AutopilotError("ILLEGAL_TRANSITION", "restack.local-ref confirmation does not match the candidate");
                }
                return { ...restack, localRefConfirmed: true };
            }
            if (event.effect === "restack.remote-push") {
                if (restack.state !== "PUSHING" || event.observedState !== restack.candidateCommit) {
                    throw new AutopilotError("ILLEGAL_TRANSITION", "restack.remote-push confirmation does not match the candidate");
                }
                return { ...restack, remotePushConfirmed: true };
            }
            return restack;
        case "RESTACK_PROVIDER_HEAD_CONFIRMED":
            if (restack.state !== "PUSHING" || restack.remotePushConfirmed !== true
                || event.provider !== restack.expectedProvider || event.changeRequestId !== restack.expectedChangeRequestId
                || event.changeRequestUrl !== restack.expectedChangeRequestUrl || event.headCommit !== restack.candidateCommit
                || event.baseBranch !== restack.expectedBaseBranch || event.state !== "open") {
                throw new AutopilotError("ILLEGAL_TRANSITION", "restack provider-head confirmation does not match the sealed candidate");
            }
            return { ...restack, providerHeadConfirmed: true };
        case "RESTACK_DESCENDANT_SATISFIED":
            if (restack.state !== "PUSHING" || restack.remotePushConfirmed !== true
                || restack.providerHeadConfirmed !== true || restack.subject !== event.subject) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `RESTACK_DESCENDANT_SATISFIED cannot follow ${restack.state}`);
            }
            return { ...restack, state: "SATISFIED" };
        case "RESTACK_DESCENDANT_BLOCKED":
            return { ...restack, state: "BLOCKED", blocker: event.errorCode };
        default:
            return restack;
    }
}
export function reduce(projection, event) {
    if (projection.appliedEventIds.has(event.eventId)) {
        return projection;
    }
    if (event.type === "RUN_SUCCEEDED" && projection.pauseRequestId !== undefined) {
        throw new AutopilotError("ILLEGAL_TRANSITION", "RUN_SUCCEEDED cannot overtake an accepted pause request");
    }
    if ((event.type === "RUN_VERIFYING" || event.type === "RUN_SUCCEEDED")
        && Object.keys(projection.restacks).length > 0
        && Object.values(projection.restacks).some(({ state }) => state !== "SATISFIED")) {
        throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires every restack descendant to be SATISFIED`);
    }
    const nextState = assertRunTransition(projection.state, event);
    let items = projection.items;
    const ordinaryItemLifecycle = [
        "DECISION_RECORDED", "ITEM_READY", "ATTEMPT_STARTED", "ATTEMPT_FINISHED", "ITEM_VERIFYING", "ATTEMPT_PAUSED",
        "ITEM_VERIFIED", "ITEM_SATISFIED", "ITEM_BLOCKED", "ITEM_ABANDONED",
    ];
    if (event.itemId !== undefined && projection.restacks[event.itemId] !== undefined
        && ordinaryItemLifecycle.includes(event.type)) {
        throw new AutopilotError("ILLEGAL_TRANSITION", `ordinary ${event.type} cannot target restack definition ${event.itemId}`);
    }
    if (event.itemId !== undefined && ordinaryItemLifecycle.includes(event.type)) {
        const item = projection.items[event.itemId];
        if (item === undefined) {
            throw new AutopilotError("ILLEGAL_TRANSITION", `event references unknown item ${event.itemId}`);
        }
        items = { ...projection.items, [event.itemId]: transitionItem(item, event) };
    }
    let restacks = projection.restacks;
    const restackLifecycle = event.type.startsWith("RESTACK_DESCENDANT_") || event.type === "RESTACK_PROVIDER_HEAD_CONFIRMED";
    const restackEffect = (event.type === "EFFECT_INTENDED" || event.type === "EFFECT_CONFIRMED")
        && event.effect.startsWith("restack.");
    const restackReceipt = event.type === "RECEIPT_RECORDED" && event.itemId !== undefined
        && projection.restacks[event.itemId] !== undefined;
    if ((restackLifecycle || restackEffect || restackReceipt) && event.itemId !== undefined) {
        const restack = projection.restacks[event.itemId];
        if (restack === undefined) {
            throw new AutopilotError("ILLEGAL_TRANSITION", `event references unknown restack descendant ${event.itemId}`);
        }
        restacks = { ...projection.restacks, [event.itemId]: transitionRestack(projection, restack, event) };
    }
    const appliedEventIds = new Set(projection.appliedEventIds);
    appliedEventIds.add(event.eventId);
    const stop = event.type === "RUN_STOPPED" ? { errorCode: event.errorCode, remediation: event.remediation } : projection.stop;
    const pauseRequestId = event.type === "RUN_PAUSE_REQUESTED"
        ? event.requestId
        : event.type === "RECONCILIATION_COMPLETED" || event.type === "RUN_WOKEN" ? undefined : projection.pauseRequestId;
    const waiting = event.type === "RUN_WAITING"
        ? event.waiting ?? { kind: "legacy" }
        : event.type === "RECONCILIATION_STARTED" || event.type === "RUN_WOKEN" ? undefined : projection.waiting;
    const { pauseRequestId: _pauseRequestId, waiting: _waiting, ...projectionWithoutWaiting } = projection;
    return {
        ...projectionWithoutWaiting,
        state: nextState,
        items,
        restacks,
        appliedEventIds,
        lastReason: event.reason,
        ...(pauseRequestId === undefined ? {} : { pauseRequestId }),
        ...(waiting === undefined ? {} : { waiting }),
        ...(stop === undefined ? {} : { stop }),
    };
}
export function consumedAttempts(item) {
    return item?.attempts.filter(({ budgetConsumed }) => budgetConsumed !== false).length ?? 0;
}
