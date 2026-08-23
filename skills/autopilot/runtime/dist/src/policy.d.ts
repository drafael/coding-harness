import type { CapabilityGrant, EffectActor, GrantFamily } from "./charter.js";
export interface AdapterCapabilities {
    readonly families: readonly GrantFamily[];
    readonly assurance: "cooperative" | "enforced";
    readonly maxConcurrency: number;
    readonly unattended: boolean;
    readonly cancellation: boolean;
    readonly restartReattachment: boolean;
}
export interface EffectRequest {
    readonly family: GrantFamily;
    readonly actor: EffectActor;
    readonly path?: string;
    readonly executable?: string;
    readonly repository?: string;
    readonly remote?: string;
    readonly branch?: string;
    readonly environmentName?: string;
}
export declare function authorizeEffect(request: EffectRequest, playbookRequests: ReadonlySet<GrantFamily>, grants: readonly CapabilityGrant[], adapter: AdapterCapabilities): CapabilityGrant;
