import { readFile, rm } from "node:fs/promises";
import { writeJsonAtomic } from "./journal.js";
import { expectInteger, expectRecord, expectString } from "./json.js";
import { initialProjection, reduce } from "./reducer.js";
export function rebuildProjection(charter, records) {
    return records.reduce((projection, record) => reduce(projection, record.event), initialProjection(charter));
}
export async function writeSnapshot(path, projection, records) {
    const snapshot = {
        schemaVersion: 1,
        sequence: records.length,
        lastRecordHash: records.at(-1)?.recordHash ?? null,
        projection: { ...projection, appliedEventIds: [...projection.appliedEventIds] },
    };
    await writeJsonAtomic(path, snapshot);
}
export async function loadProjection(path, charter, records) {
    try {
        const raw = JSON.parse(await readFile(path, "utf8"));
        const snapshot = expectRecord(raw, "snapshot");
        const projection = expectRecord(snapshot.projection, "snapshot.projection");
        const expectedHash = records.at(-1)?.recordHash ?? null;
        if (snapshot.schemaVersion !== 1
            || expectInteger(snapshot.sequence, "snapshot.sequence") !== records.length
            || snapshot.lastRecordHash !== expectedHash
            || expectString(projection.runId, "snapshot.projection.runId") !== charter.runId
            || expectString(projection.charterHash, "snapshot.projection.charterHash") !== charter.charterHash) {
            throw new Error("snapshot identity mismatch");
        }
        const rebuilt = rebuildProjection(charter, records);
        await writeSnapshot(path, rebuilt, records);
        return rebuilt;
    }
    catch {
        await rm(path, { force: true });
        const rebuilt = rebuildProjection(charter, records);
        await writeSnapshot(path, rebuilt, records);
        return rebuilt;
    }
}
