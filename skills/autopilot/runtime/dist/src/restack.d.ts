import type { CapabilityGrant, RunCharter } from "./charter.js";
export declare function grantsWithinRestackAuthority(grants: readonly CapabilityGrant[], sourceGrants: readonly CapabilityGrant[], amendmentGrants: readonly CapabilityGrant[]): boolean;
export declare function validateRestackSuccessor(stateRoot: string, charter: RunCharter): Promise<void>;
