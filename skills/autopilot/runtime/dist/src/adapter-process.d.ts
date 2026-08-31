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
    readonly validateResult?: (stdout: string, request: ExecutionRequest) => string | undefined;
    readonly displayStderrActivity?: boolean;
}
export declare function adapterCredentialNames(request: ExecutionRequest): readonly string[];
export declare function adapterEnvironment(request: ExecutionRequest): NodeJS.ProcessEnv;
export declare function parseReviewResult(stdout: string): ReviewResult | undefined;
export declare function redactionValues(credentialEnvironmentNames: readonly string[]): readonly string[];
export declare function redactSecrets(text: string, credentialEnvironmentNames?: readonly string[]): string;
export declare class CliHarnessAdapter implements HarnessPort {
    #private;
    constructor(configuration: CliHarnessConfiguration);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    reattach(request: ExecutionRequest): Promise<ExecutionHandle | undefined>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
