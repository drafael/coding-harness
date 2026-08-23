export type AutopilotErrorCode = "ADAPTER_MALFORMED" | "ADAPTER_TIMEOUT" | "ADAPTER_UNSUPPORTED" | "BRANCH_COLLISION" | "CAPABILITY_DENIED" | "CHARTER_INVALID" | "CHARTER_TAMPERED" | "EFFECT_RECONCILIATION_FAILED" | "GIT_FAILED" | "ILLEGAL_TRANSITION" | "JOURNAL_CORRUPT" | "JOURNAL_TRUNCATED" | "LOCK_HELD" | "RECEIPT_STALE" | "RUN_NOT_FOUND" | "UNSUPPORTED_CAPABILITY";
export declare class AutopilotError extends Error {
    readonly code: AutopilotErrorCode;
    readonly details: Readonly<Record<string, unknown>>;
    constructor(code: AutopilotErrorCode, message: string, details?: Readonly<Record<string, unknown>>);
}
