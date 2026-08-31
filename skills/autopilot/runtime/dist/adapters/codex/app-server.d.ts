import { type CancelResult, type CapabilityManifest, type ExecutionHandle, type ExecutionObservation, type ExecutionRequest, type HarnessPort } from "../../src/adapter-protocol.js";
interface CodexAppServerAdapterOptions {
    readonly executable: string;
    readonly reviewAdapter: HarnessPort;
}
export declare class CodexAppServerAdapter implements HarnessPort {
    #private;
    constructor(options: CodexAppServerAdapterOptions);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
export {};
