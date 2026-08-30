import { type CancelResult, type CapabilityManifest, type ExecutionHandle, type ExecutionObservation, type ExecutionRequest, type HarnessPort, type ReviewResult } from "./adapter-protocol.js";
export interface CliHarnessConfiguration {
    readonly name: string;
    readonly executable: string;
    readonly versionArguments: readonly string[];
    readonly buildArguments: (request: ExecutionRequest, prompt: string) => readonly string[];
    readonly assurance: "cooperative" | "enforced";
    readonly maxConcurrency: number;
    readonly cancellation: boolean;
    readonly limitations: readonly string[];
    readonly expectsJsonLines: boolean;
    readonly validateResult?: (stdout: string) => string | undefined;
    readonly displayStderrActivity?: boolean;
}
export declare function parseReviewResult(stdout: string): ReviewResult | undefined;
export declare class CliHarnessAdapter implements HarnessPort {
    #private;
    constructor(configuration: CliHarnessConfiguration);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
