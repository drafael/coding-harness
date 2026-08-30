import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectPredicateEvidence } from "./evidence-map.js";
import { writeJsonAtomic } from "./journal.js";
import { consumedAttempts } from "./reducer.js";
import { resolveWorktreePath } from "./repository.js";
export async function writeReports(runDirectory, charter, projection, records, assurance, unverifiedBoundaries, persist = true) {
    const terminal = projection.state === "SUCCEEDED" || projection.state === "STOPPED";
    const predicateSummary = records.findLast(({ event }) => event.type === "RUN_SUCCEEDED")?.event;
    const effects = records.flatMap(({ event }) => event.type === "EFFECT_CONFIRMED" ? [{
            effect: event.effect,
            ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
            observedState: event.observedState,
            idempotencyKey: event.idempotencyKey,
        }] : []);
    const receipts = records.flatMap(({ event }) => event.type === "RECEIPT_RECORDED" ? [{
            ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
            receiptId: event.receiptId,
            ...(event.gateId === undefined ? {} : { gateId: event.gateId }),
            ...(event.receiptKind === undefined ? {} : { receiptKind: event.receiptKind }),
            status: event.status,
        }] : []);
    const evidenceMap = await projectPredicateEvidence(runDirectory, charter, projection, records);
    const lastRecord = records.at(-1);
    const nextLegalAction = projection.state === "SUCCEEDED"
        ? charter.delivery === "change-request-ready" ? "/autopilot address review comments or /autopilot wrap up" : "/autopilot wrap up"
        : projection.state === "STOPPED"
            ? "Create a sealed successor run."
            : projection.waiting?.kind === "operator-pause"
                ? "/autopilot resume"
                : projection.waiting?.kind === "execution-unknown"
                    ? "Do not launch a replacement; prove or externally cancel the orphaned execution first."
                    : projection.waiting?.kind === "provider-checks"
                        ? "Wait for the bounded provider-check session, or /autopilot resume after the coordinator exits."
                        : projection.state === "RUNNING" || projection.state === "RECONCILING" || projection.state === "VERIFYING"
                            ? "Continue under the owning coordinator, or resume only after lifecycle discovery reports it inactive."
                            : "/autopilot resume";
    const continuityItems = charter.work.map((item) => {
        const itemProjection = projection.items[item.id];
        const attempts = itemProjection?.attempts ?? [];
        const lastAttempt = attempts.at(-1);
        const lastFailure = records.findLast(({ event }) => event.type === "ITEM_BLOCKED" && event.itemId === item.id)?.event;
        let repeatedNoChangeAttempts = 0;
        for (const attempt of [...attempts].reverse()) {
            if (attempt.expectedTreeIdentity === undefined || attempt.observedTreeIdentity !== attempt.expectedTreeIdentity) {
                break;
            }
            repeatedNoChangeAttempts += 1;
        }
        return {
            itemId: item.id,
            state: itemProjection?.state ?? "PENDING",
            ...(lastAttempt?.outcome === undefined ? {} : { lastAttemptOutcome: lastAttempt.outcome }),
            ...(lastFailure?.type !== "ITEM_BLOCKED" ? {} : {
                lastFailure: { errorCode: lastFailure.errorCode, reason: lastFailure.reason },
            }),
            remainingAttempts: Math.max(0, charter.limits.maxAttemptsPerItem - consumedAttempts(itemProjection)),
            remainingReplans: Math.max(0, charter.limits.maxReplans - (itemProjection?.replansUsed ?? 0)),
            unmetPredicateIds: evidenceMap
                .filter(({ itemId, outcome }) => itemId === item.id && outcome !== "met")
                .map(({ predicateId }) => predicateId),
            repeatedNoChangeAttempts,
        };
    });
    const worktrees = await Promise.all(charter.work.map(async (item) => ({
        itemId: item.id,
        path: records.flatMap(({ event }) => event.type === "WORKTREE_ADOPTED" && event.itemId === item.id ? [event.worktreePath] : []).at(-1) ?? await resolveWorktreePath(charter, item),
    })));
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runId: charter.runId,
        charterHash: charter.charterHash,
        state: projection.state,
        items: charter.work.map((item) => {
            const itemProjection = projection.items[item.id];
            return {
                itemId: item.id,
                state: itemProjection?.state ?? "PENDING",
                branchName: item.branchName,
                attempts: itemProjection?.attempts.length ?? 0,
                chargedAttempts: consumedAttempts(itemProjection),
                ...(itemProjection?.subject === undefined ? {} : { subject: itemProjection.subject }),
                ...(itemProjection?.blocker === undefined ? {} : { blocker: itemProjection.blocker }),
            };
        }),
        lastReason: projection.lastReason,
        ...(predicateSummary?.type === "RUN_SUCCEEDED" ? { predicateSummary: predicateSummary.predicateSummary } : {}),
        effects,
        receipts,
        evidenceMap,
        ...(projection.waiting === undefined ? {} : { waiting: projection.waiting }),
        continuity: {
            journalSequence: lastRecord?.sequence ?? 0,
            journalRecordHash: lastRecord?.recordHash ?? null,
            lastMilestone: lastRecord?.event.type ?? "CHARTER_COMPILED",
            lastMilestoneAt: lastRecord?.event.timestamp ?? charter.createdAt,
            nextLegalAction,
            items: continuityItems,
        },
        waivers: charter.waivers.map(({ gateId, reason }) => ({ gateId, reason })),
        worktrees,
        decisions: records.filter(({ event }) => event.type === "DECISION_RECORDED").length,
        assurance,
        ...(terminal ? {} : { continuationCommand: "/autopilot resume" }),
        ...(projection.state === "STOPPED"
            ? { successorInstruction: projection.stop?.remediation ?? "Create a successor charter with changed authority or budgets." }
            : projection.state === "SUCCEEDED" && charter.delivery === "change-request-ready"
                ? { successorInstruction: `To amend an open change request from this run, create a sealed single-item successor with amends.runId=${JSON.stringify(charter.runId)} and the reviewed item ID.` }
                : {}),
        ...(charter.amends === undefined ? {} : { amendment: charter.amends }),
        commitPolicy: charter.commitPolicy ?? { preCommitHook: "skip", writableRoots: [], environmentNames: [] },
        unverifiedBoundaries,
    };
    if (!persist) {
        return report;
    }
    const reportsDirectory = join(runDirectory, "reports");
    await mkdir(reportsDirectory, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(join(reportsDirectory, "status.json"), report);
    if (terminal) {
        await writeJsonAtomic(join(reportsDirectory, "final.json"), report);
    }
    const decisions = records
        .filter(({ event }) => event.type === "DECISION_RECORDED")
        .map(({ sequence, event }) => event.type === "DECISION_RECORDED"
        ? `${sequence}\t${event.timestamp}\t${event.decision.replaceAll("\t", " ")}\t${event.basis.replaceAll("\t", " ")}`
        : "")
        .join("\n");
    await writeFile(join(reportsDirectory, "decisions.tsv"), `sequence\ttimestamp\tdecision\tbasis\n${decisions}${decisions.length === 0 ? "" : "\n"}`, {
        encoding: "utf8",
        mode: 0o600,
    });
    return report;
}
