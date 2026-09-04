import { type CancelResult, type CapabilityManifest, type ExecutionHandle, type ExecutionObservation, type ExecutionRequest, type HarnessPort } from "../../src/adapter-protocol.js";
import { type ClaudeAgentSdkInstallation } from "../../src/claude-agent-sdk.js";
interface ClaudeQuery extends AsyncIterable<unknown> {
    interrupt(): Promise<unknown>;
    close(): void;
}
interface ClaudeAgentSdkModule {
    query(input: {
        readonly prompt: AsyncIterable<unknown>;
        readonly options: Readonly<Record<string, unknown>>;
    }): ClaudeQuery;
}
export interface ClaudeAgentSdkAdapterOptions {
    readonly reviewAdapter: HarnessPort;
    readonly installation?: ClaudeAgentSdkInstallation;
    readonly sdk?: ClaudeAgentSdkModule;
}
export declare class ClaudeAgentSdkAdapter implements HarnessPort {
    #private;
    constructor(options: ClaudeAgentSdkAdapterOptions);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
export declare function createClaudeAgentSdkAdapter(): ClaudeAgentSdkAdapter;
export {};
