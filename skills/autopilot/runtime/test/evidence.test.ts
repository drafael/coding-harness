import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { createPredicateEvaluationReceipt, evaluateItemDone } from "../src/done.js";
import { executeGate, receiptIsFresh } from "../src/evidence.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("verification receipt is bound to subject, gate definition, and environment", async () => {
  const repository = await createRepository();
  await writeFile(join(repository.root, "result.txt"), "done\n");
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  const gate = charter.gates[0];
  assert.ok(item !== undefined && gate !== undefined && gate.type === "search");

  const receipt = await executeGate(charter, item, gate, repository.root, "tree:first");

  assert.equal(receipt.status, "PASSED");
  assert.equal(receiptIsFresh(receipt, "tree:first", gate), true);
  assert.equal(receiptIsFresh(receipt, "tree:changed", gate), false);
  assert.equal(receiptIsFresh(receipt, "tree:first", { ...gate, expectedCount: 2 }), false);
});

test("predicate evaluation records one structured result for every predicate", async () => {
  const repository = await createRepository();
  await writeFile(join(repository.root, "result.txt"), "done\n");
  const proposed = proposedCharter(repository.root, repository.baseCommit);
  const charter = sealCharter({
    ...proposed,
    work: proposed.work.map((item) => ({
      ...item,
      acceptance: [
        { type: "gate-passed" as const, gateId: "result-search" },
        { type: "path-present" as const, path: "result.txt" },
        { type: "path-absent" as const, path: "missing.txt" },
        { type: "search-count" as const, query: "done", paths: ["result.txt"], expectedCount: 1 },
      ],
    })),
  });
  const item = charter.work[0];
  const gate = charter.gates[0];
  assert.ok(item !== undefined && gate !== undefined);
  const gateReceipt = await executeGate(charter, item, gate, repository.root, "tree:first");

  const evaluation = await evaluateItemDone(charter, item, repository.root, "tree:first", [gateReceipt]);
  const receipt = createPredicateEvaluationReceipt(charter, item, "tree:first", evaluation, "2026-08-30T00:00:00.000Z");

  assert.equal(evaluation.outcome, "met");
  assert.equal(evaluation.results.length, item.acceptance.length);
  assert.deepEqual(evaluation.results.map(({ observed }) => observed), ["PASSED", true, false, 1]);
  assert.equal(new Set(evaluation.results.map(({ predicateId }) => predicateId)).size, item.acceptance.length);
  assert.equal(receipt.status, "PASSED");
  assert.equal(receipt.results.length, item.acceptance.length);
});
