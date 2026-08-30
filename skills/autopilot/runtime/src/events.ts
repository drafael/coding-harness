import { randomUUID } from "node:crypto";
import { AutopilotError } from "./errors.js";
import { expectBoolean, expectInteger, expectLiteral, expectRecord, expectString, expectStringArray } from "./json.js";

export type EventSource = "runtime" | "operator" | "reconciler";

export type WaitingDetails =
  | { readonly kind: "operator-pause"; readonly requestId: string }
  | { readonly kind: "execution-unknown"; readonly itemId: string; readonly attemptId: string }
  | {
      readonly kind: "provider-checks";
      readonly provider: "github" | "gitlab";
      readonly itemId: string;
      readonly changeRequestId: string;
      readonly changeRequestUrl: string;
      readonly subjectCommit: string;
      readonly baseBranch: string;
      readonly heartbeatMs: number;
      readonly deadline: string;
    };

interface EventBase {
  readonly eventId: string;
  readonly timestamp: string;
  readonly source: EventSource;
  readonly reason: string;
  readonly itemId?: string;
  readonly attemptId?: string;
  readonly evidence?: readonly string[];
}

export type LifecycleEvent =
  | (EventBase & { readonly type: "CHARTER_COMPILED" })
  | (EventBase & { readonly type: "RECONCILIATION_STARTED" })
  | (EventBase & { readonly type: "RECONCILIATION_COMPLETED" })
  | (EventBase & { readonly type: "RUN_PAUSE_REQUESTED"; readonly requestId: string })
  | (EventBase & { readonly type: "RUN_WAITING"; readonly waiting?: WaitingDetails })
  | (EventBase & { readonly type: "RUN_WOKEN"; readonly observationId: string })
  | (EventBase & { readonly type: "RUN_RESUMED" })
  | (EventBase & { readonly type: "RUN_VERIFYING" })
  | (EventBase & { readonly type: "RUN_SUCCEEDED"; readonly predicateSummary: string })
  | (EventBase & { readonly type: "RUN_STOPPED"; readonly errorCode: string; readonly remediation: string })
  | (EventBase & { readonly type: "WRAP_UP_STARTED"; readonly chainRunIds: readonly string[]; readonly handoff: boolean })
  | (EventBase & {
      readonly type: "WORKTREE_ADOPTED";
      readonly itemId: string;
      readonly predecessorRunId: string;
      readonly predecessorItemId: string;
      readonly worktreePath: string;
      readonly branchName: string;
      readonly acceptedCommit: string;
      readonly changeRequestUrl: string;
    })
  | (EventBase & { readonly type: "ITEM_READY"; readonly itemId: string })
  | (EventBase & {
      readonly type: "ATTEMPT_STARTED";
      readonly itemId: string;
      readonly attemptId: string;
      readonly leaseEpoch: number;
      readonly expectedBaseCommit: string;
      readonly expectedTreeIdentity?: string;
      readonly expectedRefIdentity?: string;
      readonly expectedExternalRefIdentity?: string;
      readonly expectedConfigurationIdentity?: string;
      readonly expectedHookIdentity?: string;
      readonly expectedHookPath?: string;
      readonly contextHash?: string;
      readonly contextJournalSequence?: number;
      readonly executionSupervised?: boolean;
      readonly deadline: string;
      readonly idempotencyKey: string;
    })
  | (EventBase & {
      readonly type: "ATTEMPT_FINISHED";
      readonly itemId: string;
      readonly attemptId: string;
      readonly observedHeadCommit: string;
      readonly observedTreeIdentity?: string;
      readonly outcome: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
    })
  | (EventBase & { readonly type: "ITEM_VERIFYING"; readonly itemId: string; readonly attemptId: string })
  | (EventBase & {
      readonly type: "ATTEMPT_PAUSED";
      readonly itemId: string;
      readonly attemptId: string;
      readonly budgetConsumed?: boolean;
    })
  | (EventBase & {
      readonly type: "ITEM_VERIFIED";
      readonly itemId: string;
      readonly attemptId: string;
      readonly subject: string;
      readonly headCommit: string;
      readonly treeIdentity: string;
      readonly auxiliaryRefIdentity: string;
      readonly externalRefIdentity?: string;
      readonly configurationIdentity: string;
      readonly hookIdentity?: string;
      readonly hookPath?: string;
      readonly commitRequired: boolean;
      readonly receiptIds: readonly string[];
    })
  | (EventBase & { readonly type: "ITEM_SATISFIED"; readonly itemId: string; readonly attemptId: string; readonly subject: string })
  | (EventBase & { readonly type: "ITEM_BLOCKED"; readonly itemId: string; readonly errorCode: string })
  | (EventBase & { readonly type: "ITEM_ABANDONED"; readonly itemId: string })
  | (EventBase & {
      readonly type: "RESTACK_DESCENDANT_STARTED";
      readonly itemId: string;
      readonly oldCommit: string;
      readonly freshParentCommit: string;
    })
  | (EventBase & {
      readonly type: "RESTACK_DESCENDANT_TREE_PREPARED";
      readonly itemId: string;
      readonly candidateCommit: string;
      readonly treeIdentity: string;
      readonly messageIdentity: string;
      readonly oldCommit: string;
      readonly freshParentCommit: string;
      readonly temporaryWorktreePath: string;
    })
  | (EventBase & {
      readonly type: "RESTACK_DESCENDANT_VERIFIED";
      readonly itemId: string;
      readonly subject: string;
      readonly receiptIds: readonly string[];
    })
  | (EventBase & {
      readonly type: "RESTACK_PROVIDER_HEAD_CONFIRMED";
      readonly itemId: string;
      readonly provider: "github" | "gitlab";
      readonly changeRequestId: string;
      readonly changeRequestUrl: string;
      readonly headCommit: string;
      readonly baseBranch: string;
      readonly state: "open";
    })
  | (EventBase & { readonly type: "RESTACK_DESCENDANT_SATISFIED"; readonly itemId: string; readonly subject: string })
  | (EventBase & { readonly type: "RESTACK_DESCENDANT_BLOCKED"; readonly itemId: string; readonly errorCode: string })
  | (EventBase & { readonly type: "EFFECT_INTENDED"; readonly effect: string; readonly idempotencyKey: string; readonly expectedState: string })
  | (EventBase & {
      readonly type: "EFFECT_CONFIRMED";
      readonly effect: string;
      readonly idempotencyKey: string;
      readonly observedState: string;
      readonly repositoryAuxiliaryRefIdentity?: string;
      readonly repositoryExternalRefIdentity?: string;
    })
  | (EventBase & {
      readonly type: "RECEIPT_RECORDED";
      readonly receiptId: string;
      readonly gateId?: string;
      readonly receiptKind?: "gate" | "predicate" | "review" | "remote-checks";
      readonly subject?: string;
      readonly status: "PASSED" | "FAILED" | "WAIVED" | "UNVERIFIED";
    })
  | (EventBase & {
      readonly type: "PRE_COMMIT_HOOK_FINISHED";
      readonly itemId: string;
      readonly attemptId: string;
      readonly status: "PASSED" | "FAILED" | "NOT_CONFIGURED";
      readonly beforeTree: string;
      readonly afterTree: string;
      readonly exitCode: number;
    })
  | (EventBase & { readonly type: "DECISION_RECORDED"; readonly decision: string; readonly basis: string });

const EVENT_TYPES = [
  "CHARTER_COMPILED", "RECONCILIATION_STARTED", "RECONCILIATION_COMPLETED", "RUN_PAUSE_REQUESTED", "RUN_WAITING", "RUN_WOKEN",
  "RUN_RESUMED", "RUN_VERIFYING", "RUN_SUCCEEDED", "RUN_STOPPED", "WRAP_UP_STARTED", "WORKTREE_ADOPTED", "ITEM_READY",
  "ATTEMPT_STARTED", "ATTEMPT_FINISHED", "ITEM_VERIFYING", "ATTEMPT_PAUSED", "ITEM_VERIFIED", "ITEM_SATISFIED",
  "ITEM_BLOCKED", "ITEM_ABANDONED", "RESTACK_DESCENDANT_STARTED", "RESTACK_DESCENDANT_TREE_PREPARED",
  "RESTACK_DESCENDANT_VERIFIED", "RESTACK_PROVIDER_HEAD_CONFIRMED", "RESTACK_DESCENDANT_SATISFIED",
  "RESTACK_DESCENDANT_BLOCKED", "EFFECT_INTENDED",
  "EFFECT_CONFIRMED", "RECEIPT_RECORDED", "PRE_COMMIT_HOOK_FINISHED", "DECISION_RECORDED",
] as const;

export function newEventId(): string {
  return randomUUID();
}

function parseWaitingDetails(value: unknown): WaitingDetails {
  const object = expectRecord(value, "event.waiting");
  const kind = expectLiteral(object.kind, ["operator-pause", "execution-unknown", "provider-checks"], "event.waiting.kind");
  if (kind === "operator-pause") {
    return { kind, requestId: expectString(object.requestId, "event.waiting.requestId") };
  }
  if (kind === "execution-unknown") {
    return {
      kind,
      itemId: expectString(object.itemId, "event.waiting.itemId"),
      attemptId: expectString(object.attemptId, "event.waiting.attemptId"),
    };
  }
  return {
    kind,
    provider: expectLiteral(object.provider, ["github", "gitlab"], "event.waiting.provider"),
    itemId: expectString(object.itemId, "event.waiting.itemId"),
    changeRequestId: expectString(object.changeRequestId, "event.waiting.changeRequestId"),
    changeRequestUrl: expectString(object.changeRequestUrl, "event.waiting.changeRequestUrl"),
    subjectCommit: expectString(object.subjectCommit, "event.waiting.subjectCommit"),
    baseBranch: expectString(object.baseBranch, "event.waiting.baseBranch"),
    heartbeatMs: expectInteger(object.heartbeatMs, "event.waiting.heartbeatMs", 1),
    deadline: expectString(object.deadline, "event.waiting.deadline"),
  };
}

export function parseLifecycleEvent(value: unknown): LifecycleEvent {
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
    case "RUN_PAUSE_REQUESTED":
      return { ...base, type, requestId: expectString(object.requestId, "event.requestId") };
    case "RUN_WAITING":
      return { ...base, type, ...(object.waiting === undefined ? {} : { waiting: parseWaitingDetails(object.waiting) }) };
    case "RUN_WOKEN":
      return { ...base, type, observationId: expectString(object.observationId, "event.observationId") };
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
    case "RESTACK_DESCENDANT_STARTED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        oldCommit: expectString(object.oldCommit, "event.oldCommit"),
        freshParentCommit: expectString(object.freshParentCommit, "event.freshParentCommit"),
      };
    case "RESTACK_DESCENDANT_TREE_PREPARED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        candidateCommit: expectString(object.candidateCommit, "event.candidateCommit"),
        treeIdentity: expectString(object.treeIdentity, "event.treeIdentity"),
        messageIdentity: expectString(object.messageIdentity, "event.messageIdentity"),
        oldCommit: expectString(object.oldCommit, "event.oldCommit"),
        freshParentCommit: expectString(object.freshParentCommit, "event.freshParentCommit"),
        temporaryWorktreePath: expectString(object.temporaryWorktreePath, "event.temporaryWorktreePath"),
      };
    case "RESTACK_DESCENDANT_VERIFIED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        subject: expectString(object.subject, "event.subject"),
        receiptIds: expectStringArray(object.receiptIds, "event.receiptIds"),
      };
    case "RESTACK_PROVIDER_HEAD_CONFIRMED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        provider: expectLiteral(object.provider, ["github", "gitlab"], "event.provider"),
        changeRequestId: expectString(object.changeRequestId, "event.changeRequestId"),
        changeRequestUrl: expectString(object.changeRequestUrl, "event.changeRequestUrl"),
        headCommit: expectString(object.headCommit, "event.headCommit"),
        baseBranch: expectString(object.baseBranch, "event.baseBranch"),
        state: expectLiteral(object.state, ["open"], "event.state"),
      };
    case "RESTACK_DESCENDANT_SATISFIED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        subject: expectString(object.subject, "event.subject"),
      };
    case "RESTACK_DESCENDANT_BLOCKED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        errorCode: expectString(object.errorCode, "event.errorCode"),
      };
    case "ATTEMPT_STARTED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        attemptId: expectString(object.attemptId, "event.attemptId"),
        leaseEpoch: expectInteger(object.leaseEpoch, "event.leaseEpoch", 1),
        expectedBaseCommit: expectString(object.expectedBaseCommit, "event.expectedBaseCommit"),
        ...(object.expectedTreeIdentity === undefined ? {} : {
          expectedTreeIdentity: expectString(object.expectedTreeIdentity, "event.expectedTreeIdentity"),
        }),
        ...(object.expectedRefIdentity === undefined ? {} : {
          expectedRefIdentity: expectString(object.expectedRefIdentity, "event.expectedRefIdentity"),
        }),
        ...(object.expectedExternalRefIdentity === undefined ? {} : {
          expectedExternalRefIdentity: expectString(object.expectedExternalRefIdentity, "event.expectedExternalRefIdentity"),
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
        ...(object.contextHash === undefined ? {} : {
          contextHash: expectString(object.contextHash, "event.contextHash"),
        }),
        ...(object.contextJournalSequence === undefined ? {} : {
          contextJournalSequence: expectInteger(object.contextJournalSequence, "event.contextJournalSequence"),
        }),
        ...(object.executionSupervised === undefined ? {} : {
          executionSupervised: expectBoolean(object.executionSupervised, "event.executionSupervised"),
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
        ...(object.observedTreeIdentity === undefined ? {} : {
          observedTreeIdentity: expectString(object.observedTreeIdentity, "event.observedTreeIdentity"),
        }),
        outcome: expectLiteral(object.outcome, ["completed", "failed", "cancelled", "timed-out", "stale"], "event.outcome"),
      };
    case "ITEM_VERIFYING":
    case "ATTEMPT_PAUSED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        attemptId: expectString(object.attemptId, "event.attemptId"),
        ...(object.budgetConsumed === undefined ? {} : {
          budgetConsumed: expectBoolean(object.budgetConsumed, "event.budgetConsumed"),
        }),
      };
    case "ITEM_VERIFIED":
      return {
        ...base,
        type,
        itemId: expectString(object.itemId, "event.itemId"),
        attemptId: expectString(object.attemptId, "event.attemptId"),
        subject: expectString(object.subject, "event.subject"),
        headCommit: expectString(object.headCommit, "event.headCommit"),
        treeIdentity: expectString(object.treeIdentity, "event.treeIdentity"),
        auxiliaryRefIdentity: expectString(object.auxiliaryRefIdentity, "event.auxiliaryRefIdentity"),
        ...(object.externalRefIdentity === undefined ? {} : {
          externalRefIdentity: expectString(object.externalRefIdentity, "event.externalRefIdentity"),
        }),
        configurationIdentity: expectString(object.configurationIdentity, "event.configurationIdentity"),
        ...(object.hookIdentity === undefined ? {} : { hookIdentity: expectString(object.hookIdentity, "event.hookIdentity") }),
        ...(object.hookPath === undefined ? {} : { hookPath: expectString(object.hookPath, "event.hookPath") }),
        commitRequired: expectBoolean(object.commitRequired, "event.commitRequired"),
        receiptIds: expectStringArray(object.receiptIds, "event.receiptIds"),
      };
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
        ...(object.repositoryAuxiliaryRefIdentity === undefined ? {} : {
          repositoryAuxiliaryRefIdentity: expectString(
            object.repositoryAuxiliaryRefIdentity,
            "event.repositoryAuxiliaryRefIdentity",
          ),
        }),
        ...(object.repositoryExternalRefIdentity === undefined ? {} : {
          repositoryExternalRefIdentity: expectString(
            object.repositoryExternalRefIdentity,
            "event.repositoryExternalRefIdentity",
          ),
        }),
      };
    case "RECEIPT_RECORDED":
      return {
        ...base,
        type,
        receiptId: expectString(object.receiptId, "event.receiptId"),
        ...(object.gateId === undefined ? {} : { gateId: expectString(object.gateId, "event.gateId") }),
        ...(object.receiptKind === undefined ? {} : {
          receiptKind: expectLiteral(object.receiptKind, ["gate", "predicate", "review", "remote-checks"], "event.receiptKind"),
        }),
        ...(object.subject === undefined ? {} : { subject: expectString(object.subject, "event.subject") }),
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
    case "RUN_RESUMED":
    case "RUN_VERIFYING":
      return { ...base, type };
    default:
      throw new AutopilotError("JOURNAL_CORRUPT", `unsupported event type: ${String(type)}`);
  }
}
