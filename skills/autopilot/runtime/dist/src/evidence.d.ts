import type { RunCharter, VerificationGate, WorkItem } from "./charter.js";
export type ReceiptStatus = "PASSED" | "FAILED" | "WAIVED" | "UNVERIFIED";
export interface VerificationReceipt {
    readonly schemaVersion: 1;
    readonly receiptId: string;
    readonly runId: string;
    readonly itemId: string;
    readonly gateId: string;
    readonly subject: string;
    readonly gateDefinitionHash: string;
    readonly environmentIdentity: string;
    readonly status: ReceiptStatus;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly exitCode: number | null;
    readonly observedCount?: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly executor: string;
    readonly truncated: boolean;
    readonly waiverReason?: string;
}
export declare function redactEnvironmentSecrets(text: string, environmentNames: readonly string[]): string;
export declare function countLiteral(worktreePath: string, paths: readonly string[], query: string): Promise<number>;
export declare function executeGate(charter: RunCharter, item: WorkItem, gate: VerificationGate, worktreePath: string, subject: string): Promise<VerificationReceipt>;
export declare function executeItemGates(charter: RunCharter, item: WorkItem, worktreePath: string, subject: string): Promise<readonly VerificationReceipt[]>;
export declare function storeReceipt(runDirectory: string, receipt: VerificationReceipt): Promise<string>;
export declare function receiptIsFresh(receipt: VerificationReceipt, subject: string, gate: VerificationGate): boolean;
