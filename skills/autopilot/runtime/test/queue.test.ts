import assert from "node:assert/strict";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { runnableFrontier } from "../src/frontier.js";
import { initialProjection } from "../src/reducer.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("independent queue frontier respects adapter concurrency without coupling siblings", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit, "independent-queue"));
  const projection = initialProjection(charter);

  assert.equal(runnableFrontier(charter, projection, 1).length, 1);
  assert.equal(runnableFrontier(charter, projection, 2).length, 2);
});
