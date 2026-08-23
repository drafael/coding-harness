import type { RunCharter } from "./charter.js";
import type { JournalRecord } from "./journal.js";
import { type RunProjection } from "./reducer.js";
export declare function rebuildProjection(charter: RunCharter, records: readonly JournalRecord[]): RunProjection;
export declare function writeSnapshot(path: string, projection: RunProjection, records: readonly JournalRecord[]): Promise<void>;
export declare function loadProjection(path: string, charter: RunCharter, records: readonly JournalRecord[]): Promise<RunProjection>;
