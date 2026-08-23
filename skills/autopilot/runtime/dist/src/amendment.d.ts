import type { ChangeRequestRef } from "./delivery.js";
import type { RunCharter, WorkItem } from "./charter.js";
import { type JournalRecord } from "./journal.js";
export interface AmendmentContext {
    readonly predecessorCharter: RunCharter;
    readonly predecessorItem: WorkItem;
    readonly worktreePath: string;
    readonly acceptedCommit: string;
    readonly deliveryBaseCommit: string;
    readonly changeRequest: ChangeRequestRef;
    readonly reconciledCommit?: {
        readonly idempotencyKey: string;
        readonly commit: string;
        readonly treeIdentity: string;
        readonly attemptId: string;
    };
}
export declare function loadAmendmentContext(stateRoot: string, charter: RunCharter, currentRecords?: readonly JournalRecord[]): Promise<AmendmentContext | undefined>;
