import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal, repairTruncatedJournal, writeJsonAtomic } from "../src/journal.js";

test("journal appends a hash-linked chain and rejects an incomplete tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-journal-"));
  const path = join(directory, "events.jsonl");
  const event = {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime" as const,
    reason: "compiled",
    type: "CHARTER_COMPILED" as const,
  };
  await appendEvent(path, event);
  await appendFile(path, "{\"incomplete\":");

  const read = await readJournal(path);

  assert.equal(read.records.length, 1);
  assert.ok(read.truncatedTailBytes > 0);
  await assert.rejects(appendEvent(path, { ...event, eventId: newEventId() }), /incomplete final record/);
  assert.ok(await repairTruncatedJournal(path) > 0);
  assert.equal((await readJournal(path)).records.length, 1);
});

test("journal detects a changed hash-linked record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-journal-"));
  const path = join(directory, "events.jsonl");
  await appendEvent(path, {
    eventId: newEventId(),
    timestamp: new Date().toISOString(),
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace("compiled", "changed"));

  await assert.rejects(readJournal(path), /hash mismatch/);
});

test("writeJsonAtomic replaces complete JSON documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-atomic-"));
  const path = join(directory, "snapshot.json");

  await writeJsonAtomic(path, { value: 1 });
  await writeJsonAtomic(path, { value: 2 });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { value: 2 });
});
