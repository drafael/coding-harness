import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
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
