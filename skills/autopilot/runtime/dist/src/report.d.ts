import type { ExecutionAssurance } from "./adapter-protocol.js";
import type { RunCharter } from "./charter.js";
import { type PredicateEvidenceEntry } from "./evidence-map.js";
import type { JournalRecord } from "./journal.js";
import { type RunProjection } from "./reducer.js";
export interface RunReport {
    readonly schemaVersion: 1;
    readonly generatedAt: string;
    readonly runId: string;
    readonly charterHash: string;
    readonly state: string;
    readonly items: readonly {
        readonly itemId: string;
        readonly state: string;
        readonly branchName: string;
        readonly subject?: string;
        readonly blocker?: string;
        readonly attempts: number;
        readonly chargedAttempts: number;
        readonly recovery?: {
            readonly quarantinedWorktreePath: string;
            readonly adoptedTreeIdentity?: string;
        };
        readonly execution?: {
            readonly assurance?: ExecutionAssurance;
            readonly adapterName?: string;
            readonly adapterVersion?: string;
            readonly harnessVersion?: string;
            readonly adapterExecutionId?: string;
            readonly backendId?: string;
            readonly subjectId?: string;
            readonly harnessInstanceId?: string;
        };
    }[];
    readonly restacks: readonly {
        readonly itemId: string;
        readonly state: string;
        readonly subject?: string;
        readonly blocker?: string;
        readonly candidateCommit?: string;
        readonly treeIdentity?: string;
    }[];
    readonly lastReason: string;
    readonly predicateSummary?: string;
    readonly effects: readonly {
        readonly effect: string;
        readonly itemId?: string;
        readonly observedState: string;
        readonly idempotencyKey: string;
    }[];
    readonly receipts: readonly {
        readonly itemId?: string;
        readonly receiptId: string;
        readonly gateId?: string;
        readonly receiptKind?: string;
        readonly subject?: string;
        readonly status: string;
    }[];
    readonly evidenceMap: readonly PredicateEvidenceEntry[];
    readonly waiting?: RunProjection["waiting"];
    readonly continuity: {
        readonly journalSequence: number;
        readonly journalRecordHash: string | null;
        readonly lastMilestone: string;
        readonly lastMilestoneAt: string;
        readonly nextLegalAction: string;
        readonly items: readonly {
            readonly itemId: string;
            readonly state: string;
            readonly lastAttemptOutcome?: string;
            readonly lastFailure?: {
                readonly errorCode: string;
                readonly reason: string;
            };
            readonly remainingAttempts: number;
            readonly remainingReplans: number;
            readonly unmetPredicateIds: readonly string[];
            readonly repeatedNoChangeAttempts: number;
        }[];
    };
    readonly waivers: readonly {
        readonly gateId: string;
        readonly reason: string;
    }[];
    readonly worktrees: readonly {
        readonly itemId: string;
        readonly path: string;
    }[];
    readonly decisions: number;
    readonly assurance: string;
    readonly continuationCommand?: string;
    readonly successorInstruction?: string;
    readonly amendment?: {
        readonly runId: string;
        readonly itemId: string;
    };
    readonly commitPolicy: {
        readonly preCommitHook: "run" | "skip";
        readonly writableRoots: readonly string[];
        readonly environmentNames: readonly string[];
    };
    readonly unverifiedBoundaries: readonly string[];
}
export declare function writeReports(runDirectory: string, charter: RunCharter, projection: RunProjection, records: readonly JournalRecord[], assurance: string, unverifiedBoundaries: readonly string[], persist?: boolean): Promise<RunReport>;
