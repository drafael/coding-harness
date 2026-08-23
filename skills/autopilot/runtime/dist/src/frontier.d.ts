import type { RunCharter, WorkItem } from "./charter.js";
import type { RunProjection } from "./reducer.js";
export declare function runnableFrontier(charter: RunCharter, projection: RunProjection, adapterConcurrency: number): readonly WorkItem[];
export declare function blockedByDependency(charter: RunCharter, projection: RunProjection): readonly WorkItem[];
