import {
  GRANT_FAMILIES,
  type AssuranceLevel,
  type CapabilityGrant,
  type GrantFamily,
  type Predicate,
  type VerificationGate,
} from "./charter.js";
import { AutopilotError } from "./errors.js";
import { expectBoolean, expectInteger, expectLiteral, expectRecord, expectString, expectStringArray } from "./json.js";

export interface ExecutionAssurance {
  readonly schemaVersion: 1;
  readonly owner: "runtime" | "harness";
  readonly continuity: "session" | "same-harness-instance" | "durable-subject";
  readonly terminality: "cooperative" | "process-supervised";
  readonly admission: "single-shot" | "idempotent";
}

export interface ExecutionAssuranceProfiles {
  readonly schemaVersion: 1;
  readonly implementation: ExecutionAssurance;
  readonly review: ExecutionAssurance;
}

export interface CapabilityManifest {
  readonly protocolVersion: 1;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly harnessVersion: string;
  readonly families: readonly GrantFamily[];
  readonly assurance: AssuranceLevel;
  readonly unattended: boolean;
  readonly maxConcurrency: number;
  readonly eventStreaming: boolean;
  readonly cancellation: boolean;
  readonly restartReattachment: boolean;
  readonly executionAssurance?: ExecutionAssuranceProfiles;
  readonly restrictions: "enforced" | "cooperative";
  readonly limitations: readonly string[];
}

export interface AttemptContextEvidence {
  readonly predicateId: string;
  readonly outcome: "met" | "not-met" | "blocked";
  readonly subject: string;
  readonly reason: string;
  readonly receiptIds: readonly string[];
  readonly observed: string | number | boolean | null;
  readonly expected: string | number | boolean;
}

export interface AttemptContextFailure {
  readonly attemptId?: string;
  readonly errorCode: string;
  readonly reason: string;
}

export interface AttemptContext {
  readonly schemaVersion: 1;
  readonly charterHash: string;
  readonly sourceJournalSequence: number;
  readonly sourceJournalRecordHash: string | null;
  readonly runId: string;
  readonly itemId: string;
  readonly attemptId: string;
  readonly leaseEpoch: number;
  readonly expectedBaseCommit: string;
  readonly currentTreeIdentity: string;
  readonly title?: string;
  readonly objective: string;
  readonly predicates: readonly Predicate[];
  readonly gates: readonly VerificationGate[];
  readonly dependencyCommits: readonly { readonly itemId: string; readonly commit: string }[];
  readonly evidence: readonly AttemptContextEvidence[];
  readonly priorFailures: readonly AttemptContextFailure[];
  readonly reviewFindings: readonly {
    readonly gateId: string;
    readonly path?: string;
    readonly line?: number;
    readonly message: string;
  }[];
  readonly remainingAttempts: number;
  readonly remainingReplans: number;
  readonly attemptTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly assumptions: readonly { readonly statement: string; readonly source: string }[];
  readonly writableRoots: readonly string[];
  readonly grants: readonly CapabilityGrant[];
  readonly forbiddenEffects: readonly string[];
  readonly requiredResult: readonly string[];
}

export interface ReviewFinding {
  readonly path?: string;
  readonly line?: number;
  readonly severity?: string;
  readonly message: string;
}

export interface ReviewResult {
  readonly verdict: "clean" | "findings" | "inconclusive";
  readonly findings: readonly ReviewFinding[];
}

export interface ExecutionRequest {
  readonly protocolVersion: 1;
  readonly role: "implementation" | "review";
  readonly executionAssurance?: ExecutionAssurance;
  readonly runId: string;
  readonly itemId: string;
  readonly attemptId: string;
  readonly worktreePath: string;
  readonly objective: string;
  readonly acceptanceSummary: string;
  readonly context: AttemptContext;
  readonly contextHash: string;
  readonly reviewFocus?: string;
  readonly writableRoots: readonly string[];
  readonly grants: readonly CapabilityGrant[];
  readonly deadline: string;
  readonly idleTimeoutMs: number;
  readonly maximumLineBytes: number;
  readonly maximumOutputBytes: number;
  readonly supervisionDirectory?: string;
}

export interface ExecutionSubject {
  readonly schemaVersion: 1;
  readonly backendId: string;
  readonly subjectId: string;
  readonly harnessInstanceId?: string;
}

export interface ExecutionHandle {
  readonly protocolVersion: 1;
  readonly adapterExecutionId: string;
  readonly startedAt: string;
  readonly subject?: ExecutionSubject;
  readonly supervisor?: {
    readonly schemaVersion: 1;
    readonly directory: string;
    readonly requestHash: string;
  };
}

export interface ExecutionObservation {
  readonly protocolVersion: 1;
  readonly adapterExecutionId: string;
  readonly status: "completed" | "failed" | "cancelled" | "timed-out";
  readonly exitCode: number;
  readonly completedAt: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly reviewResult?: ReviewResult;
}

export interface CancelResult {
  readonly protocolVersion: 1;
  readonly accepted: boolean;
}

export interface HarnessPort {
  describe(): Promise<CapabilityManifest>;
  launch(request: ExecutionRequest): Promise<ExecutionHandle>;
  reattach?(request: ExecutionRequest): Promise<ExecutionHandle | undefined>;
  observe(handle: ExecutionHandle): Promise<ExecutionObservation>;
  cancel(handle: ExecutionHandle): Promise<CancelResult>;
}

const SESSION_COOPERATIVE_ASSURANCE: ExecutionAssurance = {
  schemaVersion: 1,
  owner: "runtime",
  continuity: "session",
  terminality: "cooperative",
  admission: "single-shot",
};

function legacyExecutionAssurance(manifest: Pick<CapabilityManifest, "restartReattachment">): ExecutionAssuranceProfiles {
  return {
    schemaVersion: 1,
    implementation: manifest.restartReattachment
      ? {
          schemaVersion: 1,
          owner: "runtime",
          continuity: "durable-subject",
          terminality: "process-supervised",
          admission: "idempotent",
        }
      : SESSION_COOPERATIVE_ASSURANCE,
    review: SESSION_COOPERATIVE_ASSURANCE,
  };
}

export function executionAssuranceFor(manifest: CapabilityManifest, role: ExecutionRequest["role"]): ExecutionAssurance {
  return manifest.executionAssurance?.[role] ?? legacyExecutionAssurance(manifest)[role];
}

export function parseExecutionAssurance(value: unknown, label: string): ExecutionAssurance {
  const object = expectRecord(value, label);
  if (object.schemaVersion !== 1) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", `${label} schema version is not supported`);
  }
  return {
    schemaVersion: 1,
    owner: expectLiteral(object.owner, ["runtime", "harness"], `${label}.owner`),
    continuity: expectLiteral(
      object.continuity,
      ["session", "same-harness-instance", "durable-subject"],
      `${label}.continuity`,
    ),
    terminality: expectLiteral(object.terminality, ["cooperative", "process-supervised"], `${label}.terminality`),
    admission: expectLiteral(object.admission, ["single-shot", "idempotent"], `${label}.admission`),
  };
}

function parseExecutionAssuranceProfiles(value: unknown): ExecutionAssuranceProfiles {
  const object = expectRecord(value, "manifest.executionAssurance");
  if (object.schemaVersion !== 1) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "execution assurance schema version is not supported");
  }
  return {
    schemaVersion: 1,
    implementation: parseExecutionAssurance(object.implementation, "manifest.executionAssurance.implementation"),
    review: parseExecutionAssurance(object.review, "manifest.executionAssurance.review"),
  };
}

export type AdapterMessage =
  | { readonly protocolVersion: 1; readonly type: "capabilities"; readonly manifest: CapabilityManifest }
  | { readonly protocolVersion: 1; readonly type: "started"; readonly executionId: string }
  | { readonly protocolVersion: 1; readonly type: "progress"; readonly executionId: string; readonly cursor: string }
  | { readonly protocolVersion: 1; readonly type: "terminal"; readonly executionId: string; readonly status: ExecutionObservation["status"]; readonly exitCode: number };

export function parseAdapterMessage(line: string, maximumBytes: number): AdapterMessage {
  if (Buffer.byteLength(line) > maximumBytes) {
    throw new AutopilotError("ADAPTER_MALFORMED", "adapter message exceeds the configured line limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw new AutopilotError("ADAPTER_MALFORMED", "adapter message is not valid JSON", { cause: String(error) });
  }
  const object = expectRecord(parsed, "adapter message");
  if (object.protocolVersion !== 1) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "adapter protocol version is not supported");
  }
  const type = expectLiteral(object.type, ["capabilities", "started", "progress", "terminal"], "adapter message.type");
  if (type === "capabilities") {
    const manifest = expectRecord(object.manifest, "adapter message.manifest");
    if (manifest.protocolVersion !== 1 || !Array.isArray(manifest.families)) {
      throw new AutopilotError("ADAPTER_MALFORMED", "capability manifest is malformed");
    }
    return {
      protocolVersion: 1,
      type,
      manifest: {
        protocolVersion: 1,
        adapterName: expectString(manifest.adapterName, "manifest.adapterName"),
        adapterVersion: expectString(manifest.adapterVersion, "manifest.adapterVersion"),
        harnessVersion: expectString(manifest.harnessVersion, "manifest.harnessVersion"),
        families: manifest.families.map((family, index) => expectLiteral(family, GRANT_FAMILIES, `manifest.families[${index}]`)),
        assurance: expectLiteral(manifest.assurance, ["cooperative", "enforced"], "manifest.assurance"),
        unattended: expectBoolean(manifest.unattended, "manifest.unattended"),
        maxConcurrency: expectInteger(manifest.maxConcurrency, "manifest.maxConcurrency", 1),
        eventStreaming: expectBoolean(manifest.eventStreaming, "manifest.eventStreaming"),
        cancellation: expectBoolean(manifest.cancellation, "manifest.cancellation"),
        restartReattachment: expectBoolean(manifest.restartReattachment, "manifest.restartReattachment"),
        ...(manifest.executionAssurance === undefined
          ? {}
          : { executionAssurance: parseExecutionAssuranceProfiles(manifest.executionAssurance) }),
        restrictions: expectLiteral(manifest.restrictions, ["cooperative", "enforced"], "manifest.restrictions"),
        limitations: expectStringArray(manifest.limitations, "manifest.limitations"),
      },
    };
  }
  const executionId = expectString(object.executionId, "adapter message.executionId");
  if (type === "started") {
    return { protocolVersion: 1, type, executionId };
  }
  if (type === "progress") {
    return { protocolVersion: 1, type, executionId, cursor: expectString(object.cursor, "adapter message.cursor") };
  }
  return {
    protocolVersion: 1,
    type,
    executionId,
    status: expectLiteral(object.status, ["completed", "failed", "cancelled", "timed-out"], "adapter message.status"),
    exitCode: expectInteger(object.exitCode, "adapter message.exitCode"),
  };
}

export function parseCancelResult(value: unknown): CancelResult {
  const object = expectRecord(value, "cancel result");
  if (object.protocolVersion !== 1) {
    throw new AutopilotError("ADAPTER_UNSUPPORTED", "cancel result protocol version is not supported");
  }
  return { protocolVersion: 1, accepted: expectBoolean(object.accepted, "cancel result.accepted") };
}
