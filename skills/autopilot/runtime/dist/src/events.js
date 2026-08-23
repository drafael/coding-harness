import { randomUUID } from "node:crypto";
import { AutopilotError } from "./errors.js";
import { expectBoolean, expectInteger, expectLiteral, expectRecord, expectString, expectStringArray } from "./json.js";
const EVENT_TYPES = [
    "CHARTER_COMPILED", "RECONCILIATION_STARTED", "RECONCILIATION_COMPLETED", "RUN_WAITING", "RUN_RESUMED", "RUN_VERIFYING",
    "RUN_SUCCEEDED", "RUN_STOPPED", "WRAP_UP_STARTED", "WORKTREE_ADOPTED", "ITEM_READY", "ATTEMPT_STARTED", "ATTEMPT_FINISHED", "ITEM_VERIFYING", "ITEM_SATISFIED",
    "ITEM_BLOCKED", "ITEM_ABANDONED", "EFFECT_INTENDED", "EFFECT_CONFIRMED", "RECEIPT_RECORDED", "PRE_COMMIT_HOOK_FINISHED", "DECISION_RECORDED",
];
export function newEventId() {
    return randomUUID();
}
export function parseLifecycleEvent(value) {
    const object = expectRecord(value, "event");
    const base = {
        eventId: expectString(object.eventId, "event.eventId"),
        timestamp: expectString(object.timestamp, "event.timestamp"),
        source: expectLiteral(object.source, ["runtime", "operator", "reconciler"], "event.source"),
        reason: expectString(object.reason, "event.reason"),
        ...(object.itemId === undefined ? {} : { itemId: expectString(object.itemId, "event.itemId") }),
        ...(object.attemptId === undefined ? {} : { attemptId: expectString(object.attemptId, "event.attemptId") }),
        ...(object.evidence === undefined ? {} : { evidence: expectStringArray(object.evidence, "event.evidence") }),
    };
    const type = expectLiteral(object.type, EVENT_TYPES, "event.type");
    switch (type) {
        case "RUN_SUCCEEDED":
            return { ...base, type, predicateSummary: expectString(object.predicateSummary, "event.predicateSummary") };
        case "RUN_STOPPED":
            return {
                ...base,
                type,
                errorCode: expectString(object.errorCode, "event.errorCode"),
                remediation: expectString(object.remediation, "event.remediation"),
            };
        case "WRAP_UP_STARTED":
            return {
                ...base,
                type,
                chainRunIds: expectStringArray(object.chainRunIds, "event.chainRunIds"),
                handoff: expectBoolean(object.handoff, "event.handoff"),
            };
        case "WORKTREE_ADOPTED":
            return {
                ...base,
                type,
                itemId: expectString(object.itemId, "event.itemId"),
                predecessorRunId: expectString(object.predecessorRunId, "event.predecessorRunId"),
                predecessorItemId: expectString(object.predecessorItemId, "event.predecessorItemId"),
                worktreePath: expectString(object.worktreePath, "event.worktreePath"),
                branchName: expectString(object.branchName, "event.branchName"),
                acceptedCommit: expectString(object.acceptedCommit, "event.acceptedCommit"),
                changeRequestUrl: expectString(object.changeRequestUrl, "event.changeRequestUrl"),
            };
        case "ITEM_READY":
        case "ITEM_ABANDONED":
            return { ...base, type, itemId: expectString(object.itemId, "event.itemId") };
        case "ATTEMPT_STARTED":
            return {
                ...base,
                type,
                itemId: expectString(object.itemId, "event.itemId"),
                attemptId: expectString(object.attemptId, "event.attemptId"),
                leaseEpoch: expectInteger(object.leaseEpoch, "event.leaseEpoch", 1),
                expectedBaseCommit: expectString(object.expectedBaseCommit, "event.expectedBaseCommit"),
                ...(object.expectedRefIdentity === undefined ? {} : {
                    expectedRefIdentity: expectString(object.expectedRefIdentity, "event.expectedRefIdentity"),
                }),
                ...(object.expectedConfigurationIdentity === undefined ? {} : {
                    expectedConfigurationIdentity: expectString(object.expectedConfigurationIdentity, "event.expectedConfigurationIdentity"),
                }),
                ...(object.expectedHookIdentity === undefined ? {} : {
                    expectedHookIdentity: expectString(object.expectedHookIdentity, "event.expectedHookIdentity"),
                }),
                ...(object.expectedHookPath === undefined ? {} : {
                    expectedHookPath: expectString(object.expectedHookPath, "event.expectedHookPath"),
                }),
                deadline: expectString(object.deadline, "event.deadline"),
                idempotencyKey: expectString(object.idempotencyKey, "event.idempotencyKey"),
            };
        case "ATTEMPT_FINISHED":
            return {
                ...base,
                type,
                itemId: expectString(object.itemId, "event.itemId"),
                attemptId: expectString(object.attemptId, "event.attemptId"),
                observedHeadCommit: expectString(object.observedHeadCommit, "event.observedHeadCommit"),
                outcome: expectLiteral(object.outcome, ["completed", "failed", "cancelled", "timed-out", "stale"], "event.outcome"),
            };
        case "ITEM_VERIFYING":
            return { ...base, type, itemId: expectString(object.itemId, "event.itemId"), attemptId: expectString(object.attemptId, "event.attemptId") };
        case "ITEM_SATISFIED":
            return {
                ...base,
                type,
                itemId: expectString(object.itemId, "event.itemId"),
                attemptId: expectString(object.attemptId, "event.attemptId"),
                subject: expectString(object.subject, "event.subject"),
            };
        case "ITEM_BLOCKED":
            return { ...base, type, itemId: expectString(object.itemId, "event.itemId"), errorCode: expectString(object.errorCode, "event.errorCode") };
        case "EFFECT_INTENDED":
            return {
                ...base,
                type,
                effect: expectString(object.effect, "event.effect"),
                idempotencyKey: expectString(object.idempotencyKey, "event.idempotencyKey"),
                expectedState: expectString(object.expectedState, "event.expectedState"),
            };
        case "EFFECT_CONFIRMED":
            return {
                ...base,
                type,
                effect: expectString(object.effect, "event.effect"),
                idempotencyKey: expectString(object.idempotencyKey, "event.idempotencyKey"),
                observedState: expectString(object.observedState, "event.observedState"),
            };
        case "RECEIPT_RECORDED":
            return {
                ...base,
                type,
                receiptId: expectString(object.receiptId, "event.receiptId"),
                status: expectLiteral(object.status, ["PASSED", "FAILED", "WAIVED", "UNVERIFIED"], "event.status"),
            };
        case "PRE_COMMIT_HOOK_FINISHED":
            return {
                ...base,
                type,
                itemId: expectString(object.itemId, "event.itemId"),
                attemptId: expectString(object.attemptId, "event.attemptId"),
                status: expectLiteral(object.status, ["PASSED", "FAILED", "NOT_CONFIGURED"], "event.status"),
                beforeTree: expectString(object.beforeTree, "event.beforeTree"),
                afterTree: expectString(object.afterTree, "event.afterTree"),
                exitCode: expectInteger(object.exitCode, "event.exitCode"),
            };
        case "DECISION_RECORDED":
            return {
                ...base,
                type,
                decision: expectString(object.decision, "event.decision"),
                basis: expectString(object.basis, "event.basis"),
            };
        case "CHARTER_COMPILED":
        case "RECONCILIATION_STARTED":
        case "RECONCILIATION_COMPLETED":
        case "RUN_WAITING":
        case "RUN_RESUMED":
        case "RUN_VERIFYING":
            return { ...base, type };
        default:
            throw new AutopilotError("JOURNAL_CORRUPT", `unsupported event type: ${String(type)}`);
    }
}
