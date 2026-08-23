import { type LifecycleEvent } from "./events.js";
export interface JournalRecord {
    readonly schemaVersion: 1;
    readonly sequence: number;
    readonly previousHash: string | null;
    readonly event: LifecycleEvent;
    readonly recordHash: string;
}
export interface JournalReadResult {
    readonly records: readonly JournalRecord[];
    readonly truncatedTailBytes: number;
}
export declare function readJournal(path: string): Promise<JournalReadResult>;
export declare function repairTruncatedJournal(path: string): Promise<number>;
export declare function appendEvent(path: string, event: LifecycleEvent): Promise<JournalRecord>;
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>;
export declare function writeImmutableJson(path: string, value: unknown): Promise<void>;
