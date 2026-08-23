import type { RunCharter } from "./charter.js";
import { type JournalRecord } from "./journal.js";
import type { RunProjection, RunState } from "./reducer.js";
export interface StoredRunLocation {
    readonly directory: string;
    readonly charter: RunCharter;
}
export interface StoredRun extends StoredRunLocation {
    readonly records: readonly JournalRecord[];
    readonly projection: RunProjection;
}
export interface CorruptRun {
    readonly name: string;
    readonly reason: string;
}
export interface AvailableRuns {
    readonly runs: readonly StoredRun[];
    readonly corrupt: readonly CorruptRun[];
    readonly supersededRunIds: ReadonlySet<string>;
}
export type CoordinatorState = "active" | "inactive" | "unknown";
export type LifecycleOperation = "status" | "resume" | "stop";
export interface LifecycleCandidate {
    readonly runId: string;
    readonly shortId: string;
    readonly title: string;
    readonly state: RunState;
    readonly coordinator: CoordinatorState;
    readonly completedItems: number;
    readonly totalItems: number;
    readonly updatedAt: string;
    readonly mode: RunCharter["mode"];
}
export interface LifecycleExclusion extends LifecycleCandidate {
    readonly reason: string;
}
export interface LifecycleDiscovery {
    readonly kind: "selection";
    readonly operation: LifecycleOperation;
    readonly candidates: readonly LifecycleCandidate[];
    readonly excluded: readonly LifecycleExclusion[];
    readonly corrupt: readonly CorruptRun[];
}
export declare function locateStoredRun(stateRoot: string, runId: string): Promise<StoredRunLocation>;
export declare function loadStoredRun(stateRoot: string, runId: string): Promise<StoredRun>;
export declare function loadAvailableRuns(stateRoot: string): Promise<AvailableRuns>;
export declare function discoverLifecycleRuns(stateRoot: string, repositoryRoot: string, operation: LifecycleOperation): Promise<LifecycleDiscovery>;
