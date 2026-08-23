import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runChecked } from "../src/process.js";
import { resolveStateRoot } from "../src/state-path.js";
import { createRepository } from "./helpers.js";

test("main checkout and linked worktree share the default state root", async () => {
  const repository = await createRepository();
  const worktree = await mkdtemp(join(tmpdir(), "autopilot-linked-"));
  await runChecked({ executable: "git", arguments: ["worktree", "add", "--detach", worktree, repository.baseCommit], cwd: repository.root });

  assert.equal(await resolveStateRoot(repository.root), await resolveStateRoot(worktree));
});

test("state directory override is isolated from Git metadata", async () => {
  const repository = await createRepository();
  const override = await mkdtemp(join(tmpdir(), "autopilot-state-"));

  assert.equal(await resolveStateRoot(repository.root, override), await realpath(override));
});
