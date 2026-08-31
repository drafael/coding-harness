import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createPiAdapter } from "../adapters/pi/index.js";
import { PiInProcessAdapter } from "../adapters/pi/in-process.js";
import { createAdapter } from "./adapters.js";
import { recoverCoordinator, resumeCoordinator, startCoordinator, } from "./cli.js";
import { isRecord } from "./json.js";
import { findPiSubagentsInstallation, probePiSubagentsOwner } from "./pi-subagents.js";
async function selectAdapter(pi, cwd, harnessInstanceId, piVersion, activeAdapters) {
    const installation = findPiSubagentsInstallation(cwd);
    const ownerAvailable = installation !== undefined && await probePiSubagentsOwner(pi.events);
    if (!ownerAvailable || installation === undefined) {
        return { factory: createAdapter, mode: "direct-fallback" };
    }
    const adapter = new PiInProcessAdapter({
        events: pi.events,
        harnessInstanceId,
        harnessVersion: piVersion,
        piSubagentsVersion: installation.version,
        reviewAdapter: createPiAdapter(),
        onActivity: (message) => process.stderr.write(`[autopilot] ${message}\n`),
    });
    activeAdapters.add(adapter);
    return {
        mode: "in-process",
        inProcess: adapter,
        factory: (name) => name === "pi" ? adapter : createAdapter(name),
    };
}
function parseRecovery(arguments_) {
    const separator = arguments_.search(/\s/u);
    if (separator < 1) {
        throw new Error("Usage: /autopilot-recover <run-id> <recovery-request-json>");
    }
    const runId = arguments_.slice(0, separator);
    const requestValue = JSON.parse(arguments_.slice(separator).trim());
    if (!isRecord(requestValue) || !["abandon", "adopt", "stop"].includes(String(requestValue.action))
        || typeof requestValue.itemId !== "string" || typeof requestValue.attemptId !== "string"
        || typeof requestValue.leaseEpoch !== "number" || !Number.isSafeInteger(requestValue.leaseEpoch)
        || requestValue.leaseEpoch < 1 || typeof requestValue.attestation !== "string"
        || (requestValue.expectedTreeIdentity !== undefined && typeof requestValue.expectedTreeIdentity !== "string")) {
        throw new Error("Autopilot recovery request JSON is invalid");
    }
    return {
        runId,
        request: {
            action: requestValue.action,
            itemId: requestValue.itemId,
            attemptId: requestValue.attemptId,
            leaseEpoch: requestValue.leaseEpoch,
            attestation: requestValue.attestation,
            ...(requestValue.expectedTreeIdentity === undefined
                ? {}
                : { expectedTreeIdentity: requestValue.expectedTreeIdentity }),
        },
    };
}
async function runWithSelectedAdapter(pi, context, harnessInstanceId, piVersion, activeAdapters, operation) {
    const selected = await selectAdapter(pi, context.cwd, harnessInstanceId, piVersion, activeAdapters);
    context.ui.notify(selected.mode === "in-process"
        ? "Autopilot is using Pi process-local structured delegation."
        : "Autopilot is using the distinct direct Pi CLI fallback.", selected.mode === "in-process" ? "info" : "warning");
    try {
        const result = await operation(selected.factory);
        const summary = isRecord(result) && typeof result.runId === "string" && typeof result.state === "string"
            ? `${result.runId} · ${result.state}`
            : "result available in the canonical Autopilot report";
        process.stderr.write(`[autopilot] coordinator completed · ${summary}\n`);
    }
    finally {
        if (selected.inProcess !== undefined) {
            activeAdapters.delete(selected.inProcess);
            selected.inProcess.invalidate("the owning Autopilot coordinator invocation ended");
        }
    }
}
export function registerAutopilotPiExtension(pi, options = {}) {
    const extensionInstanceId = randomUUID();
    const piVersion = options.piVersion ?? "unknown";
    const activeAdapters = new Set();
    pi.on("session_shutdown", (event) => {
        const reason = `the owning Pi extension context ended during ${event.reason}`;
        activeAdapters.forEach((adapter) => adapter.invalidate(reason));
        activeAdapters.clear();
    });
    pi.registerCommand("autopilot-start", {
        description: "Start a sealed Autopilot charter using the owning Pi extension context",
        handler: async (arguments_, context) => {
            const charterFile = arguments_.trim();
            if (charterFile === "") {
                throw new Error("Usage: /autopilot-start <charter-file>");
            }
            const sessionId = context.sessionManager.getSessionId() ?? "ephemeral";
            const harnessInstanceId = `${sessionId}:${extensionInstanceId}`;
            await runWithSelectedAdapter(pi, context, harnessInstanceId, piVersion, activeAdapters, async (adapterFactory) => await startCoordinator(resolve(context.cwd, charterFile), { adapterFactory }));
        },
    });
    pi.registerCommand("autopilot-resume", {
        description: "Resume an interrupted Autopilot run using the owning Pi extension context",
        handler: async (arguments_, context) => {
            const sessionId = context.sessionManager.getSessionId() ?? "ephemeral";
            const harnessInstanceId = `${sessionId}:${extensionInstanceId}`;
            const runId = arguments_.trim() || undefined;
            await runWithSelectedAdapter(pi, context, harnessInstanceId, piVersion, activeAdapters, async (adapterFactory) => await resumeCoordinator(runId, { adapterFactory }));
        },
    });
    pi.registerCommand("autopilot-recover", {
        description: "Apply fenced unknown-execution recovery in the owning Pi extension context",
        handler: async (arguments_, context) => {
            const recovery = parseRecovery(arguments_);
            const sessionId = context.sessionManager.getSessionId() ?? "ephemeral";
            const harnessInstanceId = `${sessionId}:${extensionInstanceId}`;
            await runWithSelectedAdapter(pi, context, harnessInstanceId, piVersion, activeAdapters, async (adapterFactory) => await recoverCoordinator(recovery.runId, recovery.request, { adapterFactory }));
        },
    });
}
export default registerAutopilotPiExtension;
