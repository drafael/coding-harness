import { AutopilotError } from "./errors.js";
const TERMINAL_RUN_STATES = new Set(["SUCCEEDED", "STOPPED"]);
const WRAP_UP_EFFECTS = new Set(["remote.branch.delete", "git.worktree.remove", "git.branch.delete", "handoff.write"]);
const TERMINAL_ITEM_STATES = new Set(["SATISFIED", "ABANDONED"]);
export function initialProjection(charter) {
    return {
        runId: charter.runId,
        charterHash: charter.charterHash,
        state: "COMPILED",
        items: Object.fromEntries(charter.work.map(({ id }) => [id, { itemId: id, state: "PENDING", attempts: [] }])),
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
        case "RUN_WAITING":
            if (current !== "RUNNING") {
                throw new AutopilotError("ILLEGAL_TRANSITION", `${event.type} requires RUNNING, received ${current}`);
            }
            return "WAITING";
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
                        ...(event.expectedRefIdentity === undefined ? {} : { expectedRefIdentity: event.expectedRefIdentity }),
                        ...(event.expectedConfigurationIdentity === undefined ? {} : {
                            expectedConfigurationIdentity: event.expectedConfigurationIdentity,
                        }),
                        ...(event.expectedHookIdentity === undefined ? {} : { expectedHookIdentity: event.expectedHookIdentity }),
                        ...(event.expectedHookPath === undefined ? {} : { expectedHookPath: event.expectedHookPath }),
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
                    ? { ...attempt, outcome: event.outcome, observedHeadCommit: event.observedHeadCommit }
                    : attempt),
            };
        }
        case "ITEM_VERIFYING":
            if (item.state !== "ACTIVE" || item.attempts.at(-1)?.attemptId !== event.attemptId) {
                throw new AutopilotError("ILLEGAL_TRANSITION", `ITEM_VERIFYING has no current attempt for ${item.itemId}`);
            }
            return { ...item, state: "VERIFYING" };
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
export function reduce(projection, event) {
    if (projection.appliedEventIds.has(event.eventId)) {
        return projection;
    }
    const nextState = assertRunTransition(projection.state, event);
    let items = projection.items;
    if (event.itemId !== undefined && [
        "ITEM_READY", "ATTEMPT_STARTED", "ATTEMPT_FINISHED", "ITEM_VERIFYING", "ITEM_SATISFIED", "ITEM_BLOCKED", "ITEM_ABANDONED",
    ].includes(event.type)) {
        const item = projection.items[event.itemId];
        if (item === undefined) {
            throw new AutopilotError("ILLEGAL_TRANSITION", `event references unknown item ${event.itemId}`);
        }
        items = { ...projection.items, [event.itemId]: transitionItem(item, event) };
    }
    const appliedEventIds = new Set(projection.appliedEventIds);
    appliedEventIds.add(event.eventId);
    const stop = event.type === "RUN_STOPPED" ? { errorCode: event.errorCode, remediation: event.remediation } : projection.stop;
    return {
        ...projection,
        state: nextState,
        items,
        appliedEventIds,
        lastReason: event.reason,
        ...(stop === undefined ? {} : { stop }),
    };
}
