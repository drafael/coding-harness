import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./journal.js";
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
            status: event.status,
        }] : []);
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
                ...(itemProjection?.subject === undefined ? {} : { subject: itemProjection.subject }),
                ...(itemProjection?.blocker === undefined ? {} : { blocker: itemProjection.blocker }),
            };
        }),
        lastReason: projection.lastReason,
        ...(predicateSummary?.type === "RUN_SUCCEEDED" ? { predicateSummary: predicateSummary.predicateSummary } : {}),
        effects,
        receipts,
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
