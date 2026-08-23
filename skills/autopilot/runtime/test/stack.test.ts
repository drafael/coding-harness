import assert from "node:assert/strict";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { runnableFrontier } from "../src/frontier.js";
import { initialProjection } from "../src/reducer.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("ordered stack frontier exposes only the root until its predecessor is satisfied", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "ordered-stack"));
  const projection = initialProjection(charter);

  assert.deepEqual(runnableFrontier(charter, projection, 10).map(({ id }) => id), ["item-1"]);
});
