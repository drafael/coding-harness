import type { RunCharter } from "./charter.js";
import { AutopilotError } from "./errors.js";
import type { LifecycleEvent, WaitingDetails } from "./events.js";

export type RunState = "COMPILED" | "RECONCILING" | "RUNNING" | "WAITING" | "VERIFYING" | "SUCCEEDED" | "STOPPED";
export type ItemState = "PENDING" | "READY" | "ACTIVE" | "VERIFYING" | "SATISFIED" | "BLOCKED" | "ABANDONED";

export interface AttemptProjection {
  readonly attemptId: string;
  readonly leaseEpoch: number;
  readonly expectedBaseCommit: string;
  readonly expectedTreeIdentity?: string;
  readonly expectedRefIdentity?: string;
  readonly expectedConfigurationIdentity?: string;
  readonly expectedHookIdentity?: string;
  readonly expectedHookPath?: string;
  readonly contextHash?: string;
  readonly contextJournalSequence?: number;
  readonly deadline: string;
  readonly idempotencyKey: string;
  readonly outcome?: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
  readonly observedHeadCommit?: string;
  readonly observedTreeIdentity?: string;
  readonly budgetConsumed?: boolean;
}

export interface VerifiedCheckpoint {
  readonly attemptId: string;
  readonly subject: string;
  readonly headCommit: string;
  readonly treeIdentity: string;
  readonly auxiliaryRefIdentity: string;
  readonly configurationIdentity: string;
  readonly hookIdentity?: string;
  readonly hookPath?: string;
  readonly commitRequired: boolean;
  readonly receiptIds: readonly string[];
}

export interface ItemProjection {
  readonly itemId: string;
  readonly state: ItemState;
  readonly attempts: readonly AttemptProjection[];
  readonly replansUsed: number;
  readonly verified?: VerifiedCheckpoint;
  readonly subject?: string;
  readonly blocker?: string;
}

export interface RunProjection {
  readonly runId: string;
  readonly charterHash: string;
  readonly state: RunState;
  readonly items: Readonly<Record<string, ItemProjection>>;
  readonly appliedEventIds: ReadonlySet<string>;
  readonly lastReason: string;
  readonly pauseRequestId?: string;
  readonly waiting?: WaitingDetails | { readonly kind: "legacy" };
  readonly stop?: { readonly errorCode: string; readonly remediation: string };
}

const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set(["SUCCEEDED", "STOPPED"]);
const WRAP_UP_EFFECTS = new Set(["remote.branch.delete", "git.worktree.remove", "git.branch.delete", "handoff.write"]);
const TERMINAL_ITEM_STATES: ReadonlySet<ItemState> = new Set(["SATISFIED", "ABANDONED"]);

export function initialProjection(charter: RunCharter): RunProjection {
  return {
    runId: charter.runId,
    charterHash: charter.charterHash,
    state: "COMPILED",
    items: Object.fromEntries(charter.work.map(({ id }) => [
      id,
      { itemId: id, state: "PENDING", attempts: [], replansUsed: 0 },
    ])),
    appliedEventIds: new Set(),
    lastReason: "Charter sealed",
  };
}

function assertRunTransition(current: RunState, event: LifecycleEvent): RunState {
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

function transitionItem(item: ItemProjection, event: LifecycleEvent): ItemProjection {
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
            ...(event.expectedConfigurationIdentity === undefined ? {} : {
              expectedConfigurationIdentity: event.expectedConfigurationIdentity,
            }),
            ...(event.expectedHookIdentity === undefined ? {} : { expectedHookIdentity: event.expectedHookIdentity }),
            ...(event.expectedHookPath === undefined ? {} : { expectedHookPath: event.expectedHookPath }),
            ...(event.contextHash === undefined ? {} : { contextHash: event.contextHash }),
            ...(event.contextJournalSequence === undefined ? {} : { contextJournalSequence: event.contextJournalSequence }),
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
        attempts: item.attempts.map((attempt) =>
          attempt.attemptId === event.attemptId
            ? {
                ...attempt,
                outcome: event.outcome,
                observedHeadCommit: event.observedHeadCommit,
                ...(event.observedTreeIdentity === undefined ? {} : { observedTreeIdentity: event.observedTreeIdentity }),
              }
            : attempt,
        ),
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

export function reduce(projection: RunProjection, event: LifecycleEvent): RunProjection {
  if (projection.appliedEventIds.has(event.eventId)) {
    return projection;
  }
  if (event.type === "RUN_SUCCEEDED" && projection.pauseRequestId !== undefined) {
    throw new AutopilotError("ILLEGAL_TRANSITION", "RUN_SUCCEEDED cannot overtake an accepted pause request");
  }
  const nextState = assertRunTransition(projection.state, event);
  let items = projection.items;
  if (event.itemId !== undefined && [
    "DECISION_RECORDED", "ITEM_READY", "ATTEMPT_STARTED", "ATTEMPT_FINISHED", "ITEM_VERIFYING", "ATTEMPT_PAUSED",
    "ITEM_VERIFIED", "ITEM_SATISFIED", "ITEM_BLOCKED", "ITEM_ABANDONED",
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
  const pauseRequestId = event.type === "RUN_PAUSE_REQUESTED"
    ? event.requestId
    : event.type === "RECONCILIATION_COMPLETED" || event.type === "RUN_WOKEN" ? undefined : projection.pauseRequestId;
  const waiting = event.type === "RUN_WAITING"
    ? event.waiting ?? { kind: "legacy" as const }
    : event.type === "RECONCILIATION_STARTED" || event.type === "RUN_WOKEN" ? undefined : projection.waiting;
  const { pauseRequestId: _pauseRequestId, waiting: _waiting, ...projectionWithoutWaiting } = projection;
  return {
    ...projectionWithoutWaiting,
    state: nextState,
    items,
    appliedEventIds,
    lastReason: event.reason,
    ...(pauseRequestId === undefined ? {} : { pauseRequestId }),
    ...(waiting === undefined ? {} : { waiting }),
    ...(stop === undefined ? {} : { stop }),
  };
}

export function consumedAttempts(item: ItemProjection | undefined): number {
  return item?.attempts.filter(({ budgetConsumed }) => budgetConsumed !== false).length ?? 0;
}
