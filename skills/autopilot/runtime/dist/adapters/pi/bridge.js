import { randomUUID } from "node:crypto";
const STARTED_EVENT = "prompt-template:subagent:started";
const UPDATE_EVENT = "prompt-template:subagent:update";
const RESPONSE_EVENT = "prompt-template:subagent:response";
const CANCEL_EVENT = "prompt-template:subagent:cancel";
const REQUEST_EVENT = "prompt-template:subagent:request";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function matches(value, requestId, ownerRunId, nodeId) {
    return isRecord(value) && value.requestId === requestId && value.ownerRunId === ownerRunId && value.nodeId === nodeId;
}
function decodePayload(value) {
    const parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Autopilot Pi bridge payload must be an object");
    }
    const payload = parsed;
    if (typeof payload.runId !== "string" || typeof payload.itemId !== "string" || typeof payload.task !== "string"
        || typeof payload.timeoutMs !== "number" || !Number.isSafeInteger(payload.timeoutMs) || payload.timeoutMs <= 0) {
        throw new Error("Autopilot Pi bridge payload is invalid");
    }
    return {
        runId: payload.runId,
        itemId: payload.itemId,
        task: payload.task,
        timeoutMs: payload.timeoutMs,
    };
}
function activity(update) {
    return [
        update.currentTool,
        update.toolCount === undefined ? undefined : `${update.toolCount} tools`,
        update.tokens === undefined ? undefined : `${update.tokens} tokens`,
    ].filter((field) => field !== undefined).join(" · ");
}
async function delegate(pi, context, payload) {
    const requestId = randomUUID();
    const ownerRunId = payload.runId;
    const nodeId = payload.itemId;
    let lastActivity = "";
    let lastActivityAt = 0;
    return await new Promise((resolvePromise, rejectPromise) => {
        const cleanups = [];
        const cleanup = () => cleanups.splice(0).forEach((dispose) => dispose());
        cleanups.push(pi.events.on(STARTED_EVENT, (value) => {
            if (matches(value, requestId, ownerRunId, nodeId)) {
                console.error(`[autopilot] Pi subagent worker started · ${nodeId}`);
            }
        }));
        cleanups.push(pi.events.on(UPDATE_EVENT, (value) => {
            if (!matches(value, requestId, ownerRunId, nodeId)) {
                return;
            }
            const event = {
                requestId,
                ownerRunId,
                nodeId,
                ...(typeof value.currentTool === "string" ? { currentTool: value.currentTool } : {}),
                ...(typeof value.toolCount === "number" ? { toolCount: value.toolCount } : {}),
                ...(typeof value.tokens === "number" ? { tokens: value.tokens } : {}),
                ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {}),
            };
            const currentActivity = activity(event);
            const now = Date.now();
            if (currentActivity !== "" && (currentActivity !== lastActivity || now - lastActivityAt >= 5_000)) {
                lastActivity = currentActivity;
                lastActivityAt = now;
                const elapsed = event.durationMs === undefined ? "" : ` · ${Math.round(event.durationMs / 1_000)}s`;
                console.error(`[autopilot] Pi subagent worker · ${currentActivity}${elapsed}`);
            }
        }));
        cleanups.push(pi.events.on(RESPONSE_EVENT, (value) => {
            if (!isRecord(value) || value.requestId !== requestId
                || (value.ownerRunId !== undefined && value.ownerRunId !== ownerRunId)
                || (value.nodeId !== undefined && value.nodeId !== nodeId)) {
                return;
            }
            const result = isRecord(value.result) && (value.result.kind === "text" || value.result.kind === "structured")
                ? { kind: value.result.kind, ...(typeof value.result.text === "string" ? { text: value.result.text } : {}) }
                : undefined;
            const event = {
                requestId,
                ...(typeof value.ownerRunId === "string" ? { ownerRunId: value.ownerRunId } : {}),
                ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
                ...(typeof value.status === "string" ? { status: value.status } : {}),
                ...(typeof value.error === "string" ? { error: value.error } : {}),
                ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
                ...(typeof value.model === "string" ? { model: value.model } : {}),
                ...(result === undefined ? {} : { result }),
            };
            cleanup();
            resolvePromise(event);
        }));
        const timer = setTimeout(() => {
            pi.events.emit(CANCEL_EVENT, { requestId, ownerRunId, nodeId });
            cleanup();
            rejectPromise(new Error("pi-subagents delegation exceeded the Autopilot attempt deadline"));
        }, payload.timeoutMs);
        timer.unref();
        cleanups.push(() => clearTimeout(timer));
        pi.events.emit(REQUEST_EVENT, {
            requestId,
            ownerRunId,
            nodeId,
            agent: "worker",
            task: payload.task,
            context: "fresh",
            cwd: context.cwd,
            timeoutMs: payload.timeoutMs,
            artifacts: true,
            result: { kind: "text" },
        });
    });
}
export default function registerAutopilotPiBridge(pi) {
    pi.registerCommand("autopilot-worker", {
        description: "Run one bounded Autopilot work item through pi-subagents",
        handler: async (arguments_, context) => {
            let response;
            try {
                const payload = decodePayload(arguments_);
                response = await delegate(pi, context, payload);
                console.error(`[autopilot] Pi subagent worker ${response.status ?? "failed"} · ${payload.itemId}`);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[autopilot] Pi subagent worker failed · ${message}`);
                response = { status: "bridge_failed", error: message };
            }
            const completed = response.status === "completed" && response.result?.kind === "text";
            pi.sendMessage({
                customType: "autopilot-subagent-result",
                content: completed ? response.result?.text ?? "" : response.error ?? `pi-subagents ended with ${response.status ?? "unknown"}`,
                display: true,
                details: {
                    status: response.status ?? "unknown",
                    ...(response.runId === undefined ? {} : { runId: response.runId }),
                    ...(response.model === undefined ? {} : { model: response.model }),
                },
            });
        },
    });
}
