import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal } from "../src/journal.js";
import { loadProjection } from "../src/projection.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("corrupt snapshot is discarded and rebuilt from the canonical journal", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const directory = await mkdtemp(join(tmpdir(), "autopilot-fault-"));
  const journalPath = join(directory, "events.jsonl");
  const snapshotPath = join(directory, "snapshot.json");
  await appendEvent(journalPath, {
    eventId: newEventId(), timestamp: new Date().toISOString(), source: "runtime", reason: "compiled", type: "CHARTER_COMPILED",
  });
  await appendEvent(journalPath, {
    eventId: newEventId(), timestamp: new Date().toISOString(), source: "reconciler", reason: "reconciling", type: "RECONCILIATION_STARTED",
  });
  await writeFile(snapshotPath, "{broken");
  const journal = await readJournal(journalPath);

  const projection = await loadProjection(snapshotPath, charter, journal.records);

  assert.equal(projection.state, "RECONCILING");
  assert.ok(JSON.parse(await readFile(snapshotPath, "utf8")) as unknown);
});
