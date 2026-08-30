import type { HarnessPort } from "./adapter-protocol.js";
import type { RunCharter } from "./charter.js";
import { type JournalRecord } from "./journal.js";
import { type RunProjection } from "./reducer.js";
import { type RunReport } from "./report.js";
interface EngineOptions {
    readonly stateRoot: string;
    readonly runDirectory: string;
    readonly charter: RunCharter;
    readonly adapter: HarnessPort;
    readonly records: readonly JournalRecord[];
    readonly projection: RunProjection;
}
export declare class AutopilotEngine {
    #private;
    constructor(options: EngineOptions);
    requestStop(): Promise<void>;
    requestPause(): Promise<void>;
    run(): Promise<RunReport>;
}
export {};
