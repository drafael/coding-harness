import type { RunCharter } from "./charter.js";
import type { LifecycleEvent } from "./events.js";
export type RunState = "COMPILED" | "RECONCILING" | "RUNNING" | "WAITING" | "VERIFYING" | "SUCCEEDED" | "STOPPED";
export type ItemState = "PENDING" | "READY" | "ACTIVE" | "VERIFYING" | "SATISFIED" | "BLOCKED" | "ABANDONED";
export interface AttemptProjection {
    readonly attemptId: string;
    readonly leaseEpoch: number;
    readonly expectedBaseCommit: string;
    readonly expectedRefIdentity?: string;
    readonly expectedConfigurationIdentity?: string;
    readonly expectedHookIdentity?: string;
    readonly expectedHookPath?: string;
    readonly deadline: string;
    readonly idempotencyKey: string;
    readonly outcome?: "completed" | "failed" | "cancelled" | "timed-out" | "stale";
    readonly observedHeadCommit?: string;
}
export interface ItemProjection {
    readonly itemId: string;
    readonly state: ItemState;
    readonly attempts: readonly AttemptProjection[];
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
    readonly stop?: {
        readonly errorCode: string;
        readonly remediation: string;
    };
}
export declare function initialProjection(charter: RunCharter): RunProjection;
export declare function reduce(projection: RunProjection, event: LifecycleEvent): RunProjection;
