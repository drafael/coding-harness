import { type CancelResult, type CapabilityManifest, type ExecutionHandle, type ExecutionObservation, type ExecutionRequest, type HarnessPort } from "../../src/adapter-protocol.js";
export declare const PI_SUBAGENT_REQUEST_EVENT = "prompt-template:subagent:request";
export declare const PI_SUBAGENT_STARTED_EVENT = "prompt-template:subagent:started";
export declare const PI_SUBAGENT_UPDATE_EVENT = "prompt-template:subagent:update";
export declare const PI_SUBAGENT_RESPONSE_EVENT = "prompt-template:subagent:response";
export declare const PI_SUBAGENT_CANCEL_EVENT = "prompt-template:subagent:cancel";
export interface PiEventBus {
    on(event: string, handler: (value: unknown) => void): () => void;
    emit(event: string, value: unknown): void;
}
export interface PiInProcessAdapterOptions {
    readonly events: PiEventBus;
    readonly harnessInstanceId: string;
    readonly harnessVersion: string;
    readonly piSubagentsVersion: string;
    readonly reviewAdapter: HarnessPort;
    readonly onActivity?: (message: string) => void;
}
export declare class PiInProcessAdapter implements HarnessPort {
    #private;
    constructor(options: PiInProcessAdapterOptions);
    describe(): Promise<CapabilityManifest>;
    launch(request: ExecutionRequest): Promise<ExecutionHandle>;
    observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
    cancel(handle: ExecutionHandle): Promise<CancelResult>;
    invalidate(reason: string): void;
}
