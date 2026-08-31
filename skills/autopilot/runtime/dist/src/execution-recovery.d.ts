import type { RunCharter } from "./charter.js";
import type { RunLock } from "./lock.js";
import { type RunProjection } from "./reducer.js";
export type UnknownRecoveryAction = "abandon" | "adopt" | "stop";
export interface UnknownRecoveryRequest {
    readonly action: UnknownRecoveryAction;
    readonly itemId: string;
    readonly attemptId: string;
    readonly leaseEpoch: number;
    readonly attestation: string;
    readonly expectedTreeIdentity?: string;
}
export declare function recoverUnknownExecution(runDirectory: string, charter: RunCharter, projection: RunProjection, lock: RunLock, request: UnknownRecoveryRequest): Promise<RunProjection>;
