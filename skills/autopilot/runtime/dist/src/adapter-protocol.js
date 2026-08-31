import { GRANT_FAMILIES, } from "./charter.js";
import { AutopilotError } from "./errors.js";
import { expectBoolean, expectInteger, expectLiteral, expectRecord, expectString, expectStringArray } from "./json.js";
const SESSION_COOPERATIVE_ASSURANCE = {
    schemaVersion: 1,
    owner: "runtime",
    continuity: "session",
    terminality: "cooperative",
    admission: "single-shot",
};
function legacyExecutionAssurance(manifest) {
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
export function executionAssuranceFor(manifest, role) {
    return manifest.executionAssurance?.[role] ?? legacyExecutionAssurance(manifest)[role];
}
export function parseExecutionAssurance(value, label) {
    const object = expectRecord(value, label);
    if (object.schemaVersion !== 1) {
        throw new AutopilotError("ADAPTER_UNSUPPORTED", `${label} schema version is not supported`);
    }
    return {
        schemaVersion: 1,
        owner: expectLiteral(object.owner, ["runtime", "harness"], `${label}.owner`),
        continuity: expectLiteral(object.continuity, ["session", "same-harness-instance", "durable-subject"], `${label}.continuity`),
        terminality: expectLiteral(object.terminality, ["cooperative", "process-supervised"], `${label}.terminality`),
        admission: expectLiteral(object.admission, ["single-shot", "idempotent"], `${label}.admission`),
    };
}
function parseExecutionAssuranceProfiles(value) {
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
export function parseAdapterMessage(line, maximumBytes) {
    if (Buffer.byteLength(line) > maximumBytes) {
        throw new AutopilotError("ADAPTER_MALFORMED", "adapter message exceeds the configured line limit");
    }
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (error) {
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
export function parseCancelResult(value) {
    const object = expectRecord(value, "cancel result");
    if (object.protocolVersion !== 1) {
        throw new AutopilotError("ADAPTER_UNSUPPORTED", "cancel result protocol version is not supported");
    }
    return { protocolVersion: 1, accepted: expectBoolean(object.accepted, "cancel result.accepted") };
}
