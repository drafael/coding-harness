import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { createPredicateEvaluationReceipt, evaluateItemDone } from "../src/done.js";
import { projectPredicateEvidence } from "../src/evidence-map.js";
import { executeGate, storeReceipt } from "../src/evidence.js";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal } from "../src/journal.js";
import { rebuildProjection } from "../src/projection.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("predicate evidence projection fails closed when no current receipt exists", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const runDirectory = await mkdtemp(join(tmpdir(), "autopilot-evidence-map-"));
  await mkdir(join(runDirectory, "receipts"));
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: "2026-08-30T00:00:00.000Z",
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const item = charter.work[0];
  const gate = charter.gates[0];
  assert.ok(item !== undefined && gate !== undefined);
  await writeFile(join(repository.root, "result.txt"), "done\n");
  const gateReceipt = await executeGate(charter, item, gate, repository.root, "tree:old");
  const evaluation = await evaluateItemDone(charter, item, repository.root, "tree:old", [gateReceipt]);
  const oldReceipt = createPredicateEvaluationReceipt(charter, item, "tree:old", evaluation, "2026-08-30T00:00:01.000Z");
  await storeReceipt(runDirectory, oldReceipt);
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: "2026-08-30T00:00:01.000Z",
    source: "runtime",
    reason: "old predicate evidence",
    type: "RECEIPT_RECORDED",
    itemId: item.id,
    receiptId: oldReceipt.receiptId,
    receiptKind: "predicate",
    status: oldReceipt.status,
  });
  await appendEvent(join(runDirectory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: "2026-08-30T00:00:02.000Z",
    source: "runtime",
    reason: "missing current predicate evidence",
    type: "RECEIPT_RECORDED",
    itemId: item.id,
    receiptId: "missing-current-receipt",
    receiptKind: "predicate",
    status: "PASSED",
  });
  const journal = await readJournal(join(runDirectory, "events.jsonl"));
  const projection = rebuildProjection(charter, journal.records);

  const evidence = await projectPredicateEvidence(runDirectory, charter, projection, journal.records);

  assert.equal(evidence.length, charter.work[0]?.acceptance.length);
  assert.equal(evidence[0]?.outcome, "blocked");
  assert.equal(evidence[0]?.evaluationReceiptId, null);
  assert.equal(evidence[0]?.observed, null);
});
