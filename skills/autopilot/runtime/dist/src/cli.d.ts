#!/usr/bin/env node
import type { HarnessPort } from "./adapter-protocol.js";
import { type UnknownRecoveryRequest } from "./execution-recovery.js";
export type CoordinatorAdapterFactory = (name: string) => HarnessPort;
export interface CoordinatorInvocationOptions {
    readonly stateDir?: string;
    readonly repairJournal?: boolean;
    readonly adapterFactory: CoordinatorAdapterFactory;
}
export declare function startCoordinator(charterFile: string, options: CoordinatorInvocationOptions): Promise<unknown>;
export declare function resumeCoordinator(runId: string | undefined, options: CoordinatorInvocationOptions): Promise<unknown>;
export declare function recoverCoordinator(runId: string, request: UnknownRecoveryRequest, options: CoordinatorInvocationOptions): Promise<unknown>;
export declare function main(arguments_?: readonly string[]): Promise<number>;
