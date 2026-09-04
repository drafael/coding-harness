import { type CancelResult, type CapabilityManifest, type ExecutionHandle, type ExecutionObservation, type ExecutionRequest, type HarnessPort } from "../../src/adapter-protocol.js";
interface OpenCodeServerAdapterOptions {
    readonly executable: string;
    readonly reviewAdapter: HarnessPort;
}
export declare class OpenCodeServerAdapter implements HarnessPort {
    #private;
    constructor(options: OpenCodeServerAdapterOptions);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
}
export {};
