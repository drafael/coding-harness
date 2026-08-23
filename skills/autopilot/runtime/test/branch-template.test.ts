import assert from "node:assert/strict";
import { test } from "node:test";
import { expandBranchTemplate, selectBranchTemplate } from "../src/branch-template.js";

test("branch template precedence is invocation then project then user then default", () => {
  assert.equal(selectBranchTemplate({ invocation: "i", project: "p", user: "u" }).template, "i");
  assert.equal(selectBranchTemplate({ project: "p", user: "u" }).template, "p");
  assert.equal(selectBranchTemplate({ user: "u" }).template, "u");
  assert.equal(selectBranchTemplate({}).source, "default");
});

test("branch template expands approved placeholders deterministically", () => {
  const branch = expandBranchTemplate("feature/{ticket}-{run-short}-{item}-{item-slug}-{date}", {
    runId: "1234567890",
    itemId: "item-1",
    itemObjective: "Migrate Parser Callers!",
    ticket: "ABC-42",
    date: "20260822",
  });

  assert.equal(branch, "feature/ABC-42-12345678-item-1-migrate-parser-callers-20260822");
  assert.throws(() => expandBranchTemplate("feature/{unknown}", {
    runId: "run",
    itemId: "item",
    itemObjective: "objective",
    date: "20260822",
  }), /unknown branch template/);
});
