import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { sealCharter } from "../src/charter.js";
import { runChecked } from "../src/process.js";
import {
  assertWritablePaths,
  ensureWorktree,
  inspectCommit,
  installRestackCandidate,
  observeRepository,
  prepareRestackCandidate,
  resolveWorktreePath,
} from "../src/repository.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("worktree creation is idempotent for the same run item identity", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const canonicalRepository = await realpath(repository.root);
  const expected = join(dirname(canonicalRepository), `${basename(canonicalRepository)}-autopilot-${charter.runId}-${item.id}`);

  const first = await ensureWorktree(charter, item);
  const second = await ensureWorktree(charter, item);

  assert.equal(first, expected);
  assert.equal(second, expected);
});

test("restack candidate merge-forwards and recreates an interrupted retained worktree", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const retainedWorktree = await ensureWorktree(charter, item);
  await writeFile(join(repository.root, "parent.txt"), "parent\n");
  await runChecked({ executable: "git", arguments: ["add", "parent.txt"], cwd: repository.root });
  await runChecked({ executable: "git", arguments: ["commit", "-m", "advance parent"], cwd: repository.root });
  const freshParent = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD"], cwd: repository.root })).stdout.trim();

  const candidate = await prepareRestackCandidate(
    repository.root,
    charter.runId,
    item.id,
    repository.baseCommit,
    freshParent,
    retainedWorktree,
  );
  const commit = await inspectCommit(repository.root, candidate.commit);
  assert.ok(Buffer.byteLength(basename(candidate.temporaryWorktreePath)) <= 200);
  assert.doesNotMatch(basename(candidate.temporaryWorktreePath), /[. ]$/u);
  const maximumIdCandidate = await prepareRestackCandidate(
    repository.root,
    "r".repeat(128),
    "i".repeat(128),
    repository.baseCommit,
    freshParent,
    retainedWorktree,
  );
  assert.ok(Buffer.byteLength(basename(maximumIdCandidate.temporaryWorktreePath)) <= 200);
  assert.doesNotMatch(basename(maximumIdCandidate.temporaryWorktreePath), /[. ]$/u);
  await runChecked({
    executable: "git",
    arguments: ["worktree", "remove", maximumIdCandidate.temporaryWorktreePath],
    cwd: repository.root,
  });
  await rm(candidate.temporaryWorktreePath, { recursive: true });
  const recoveredCandidate = await prepareRestackCandidate(
    repository.root,
    charter.runId,
    item.id,
    repository.baseCommit,
    freshParent,
    retainedWorktree,
  );
  assert.deepEqual(recoveredCandidate, candidate);
  await assert.rejects(
    installRestackCandidate(
      repository.root,
      item.branchName,
      retainedWorktree,
      recoveredCandidate.temporaryWorktreePath,
      repository.baseCommit,
      candidate.commit,
      candidate.treeIdentity,
      () => {
        throw new Error("local CAS fenced");
      },
    ),
    /local CAS fenced/,
  );
  assert.equal((await observeRepository(retainedWorktree)).headCommit, repository.baseCommit);
  await runChecked({
    executable: "git",
    arguments: ["worktree", "remove", retainedWorktree],
    cwd: repository.root,
  });
  await installRestackCandidate(
    repository.root,
    item.branchName,
    retainedWorktree,
    recoveredCandidate.temporaryWorktreePath,
    repository.baseCommit,
    candidate.commit,
    candidate.treeIdentity,
  );

  assert.deepEqual(commit.parents, [repository.baseCommit, freshParent]);
  assert.equal((await observeRepository(retainedWorktree)).headCommit, candidate.commit);
});

test("repository observation stages a deterministic tree and rejects out-of-scope edits", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const worktree = await ensureWorktree(charter, item);
  await writeFile(join(worktree, "outside.txt"), "changed\n");

  const observation = await observeRepository(worktree);

  assert.equal(observation.clean, false);
  await assert.rejects(assertWritablePaths(worktree, observation.changedPaths, item.writableRoots), /outside writable roots/);
});

test("repository observation normalizes only exact expected managed branch state", async () => {
  const repository = await createRepository();
  const managedBranch = "autopilot/run/item";
  const optionalExpectation = [{ branchName: managedBranch, expectedCommit: repository.baseCommit, required: false }];
  const requiredExpectation = [{ branchName: managedBranch, expectedCommit: repository.baseCommit, required: true }];
  const before = await observeRepository(repository.root, optionalExpectation);

  await runChecked({ executable: "git", arguments: ["branch", managedBranch], cwd: repository.root });
  const afterExpectedBranch = await observeRepository(repository.root, requiredExpectation);
  const tree = (await runChecked({ executable: "git", arguments: ["rev-parse", "HEAD^{tree}"], cwd: repository.root })).stdout.trim();
  const unexpectedCommit = (await runChecked({
    executable: "git",
    arguments: ["commit-tree", tree, "-p", repository.baseCommit, "-m", "unexpected"],
    cwd: repository.root,
  })).stdout.trim();
  await runChecked({ executable: "git", arguments: ["branch", "--force", managedBranch, unexpectedCommit], cwd: repository.root });
  const afterMovedBranch = await observeRepository(repository.root, requiredExpectation);
  await runChecked({ executable: "git", arguments: ["branch", "--delete", "--force", managedBranch], cwd: repository.root });
  const afterDeletedBranch = await observeRepository(repository.root, requiredExpectation);

  assert.notEqual(afterExpectedBranch.refIdentity, before.refIdentity);
  assert.equal(afterExpectedBranch.externalRefIdentity, before.externalRefIdentity);
  assert.notEqual(afterMovedBranch.externalRefIdentity, before.externalRefIdentity);
  assert.notEqual(afterDeletedBranch.externalRefIdentity, before.externalRefIdentity);
});

test("long sibling worktree names are bounded and identity-specific", async () => {
  const repository = await createRepository();
  const proposal = proposedCharter(repository.root, repository.baseCommit, "single", "r".repeat(128));
  const firstItemId = "i".repeat(128);
  const first = sealCharter({
    ...proposal,
    work: proposal.work.map((item) => ({ ...item, id: firstItemId })),
    gates: proposal.gates.map((gate) => ({ ...gate, appliesTo: [firstItemId] })),
  });
  const secondItemId = `${"i".repeat(127)}x`;
  const second = sealCharter({
    ...proposal,
    work: proposal.work.map((item) => ({ ...item, id: secondItemId })),
    gates: proposal.gates.map((gate) => ({ ...gate, appliesTo: [secondItemId] })),
  });
  const firstItem = first.work[0];
  const secondItem = second.work[0];
  assert.ok(firstItem !== undefined && secondItem !== undefined);

  const firstPath = await resolveWorktreePath(first, firstItem);
  const repeatedPath = await resolveWorktreePath(first, firstItem);
  const secondPath = await resolveWorktreePath(second, secondItem);

  assert.equal(Buffer.byteLength(basename(firstPath)), 200);
  assert.equal(repeatedPath, firstPath);
  assert.notEqual(secondPath, firstPath);
  assert.equal(dirname(firstPath), dirname(await realpath(repository.root)));
});

test("normalized repository names retain distinct sibling identities", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const parent = await mkdtemp(join(tmpdir(), "autopilot-repository-names-"));
  const spacedRoot = join(parent, "project one");
  const dashedRoot = join(parent, "project-one");
  await mkdir(spacedRoot);
  await mkdir(dashedRoot);

  const spacedPath = await resolveWorktreePath({ ...charter, repository: { ...charter.repository, root: spacedRoot } }, item);
  const dashedPath = await resolveWorktreePath({ ...charter, repository: { ...charter.repository, root: dashedRoot } }, item);

  assert.notEqual(spacedPath, dashedPath);
  assert.match(basename(spacedPath), /^project-one-[a-f0-9]{8}-autopilot-/u);
  assert.match(basename(dashedPath), /^project-one-autopilot-/u);
});

test("trailing-dot item IDs produce deterministic Windows-safe sibling names", async () => {
  const repository = await createRepository();
  const proposal = proposedCharter(repository.root, repository.baseCommit);
  const itemId = "item.";
  const charter = sealCharter({
    ...proposal,
    work: proposal.work.map((item) => ({ ...item, id: itemId })),
    gates: proposal.gates.map((gate) => ({ ...gate, appliesTo: [itemId] })),
  });
  const item = charter.work[0];
  assert.ok(item !== undefined);

  const first = await resolveWorktreePath(charter, item);
  const second = await resolveWorktreePath(charter, item);

  assert.equal(first, second);
  assert.doesNotMatch(basename(first), /\.$/u);
  assert.match(basename(first), /-[a-f0-9]{16}$/u);
});

test("worktree creation rejects a foreign clone at the managed sibling path", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const destination = await resolveWorktreePath(charter, item);
  await runChecked({ executable: "git", arguments: ["clone", repository.root, destination], cwd: dirname(repository.root) });
  await runChecked({ executable: "git", arguments: ["checkout", "-b", item.branchName, repository.baseCommit], cwd: destination });

  await assert.rejects(ensureWorktree(charter, item), /not registered to the charter repository/);
});

test("worktree reuse rejects a commit without durable runtime ownership", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const worktree = await ensureWorktree(charter, item);
  await writeFile(join(worktree, "manual.txt"), "manual\n");
  await runChecked({ executable: "git", arguments: ["add", "manual.txt"], cwd: worktree });
  await runChecked({ executable: "git", arguments: ["commit", "-m", "manual"], cwd: worktree });

  await assert.rejects(ensureWorktree(charter, item), /unowned HEAD commit/);
});

test("worktree recreation rejects an unregistered branch at an unowned commit", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const worktree = await ensureWorktree(charter, item);
  await writeFile(join(worktree, "manual.txt"), "manual\n");
  await runChecked({ executable: "git", arguments: ["add", "manual.txt"], cwd: worktree });
  await runChecked({
    executable: "git",
    arguments: ["commit", "-m", `forged\n\nAutopilot-Run: ${charter.runId}\nAutopilot-Item: ${item.id}`],
    cwd: worktree,
  });
  await runChecked({
    executable: "git",
    arguments: ["worktree", "remove", "--force", worktree],
    cwd: repository.root,
  });

  await assert.rejects(ensureWorktree(charter, item), /branch .* already exists at an unowned commit/);
});

test("worktree creation rejects a symlink at the managed sibling path", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const destination = await resolveWorktreePath(charter, item);
  const target = await mkdtemp(join(tmpdir(), "autopilot-symlink-target-"));
  await symlink(target, destination);

  await assert.rejects(ensureWorktree(charter, item), /not a managed directory/);
});

test("worktree creation preserves non-empty unmanaged sibling directories", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const destination = await resolveWorktreePath(charter, item);
  await mkdir(destination);
  await writeFile(join(destination, "keep.txt"), "keep\n");

  await assert.rejects(ensureWorktree(charter, item));
  assert.equal(await readFile(join(destination, "keep.txt"), "utf8"), "keep\n");
});

test("writable-path validation rejects a symlink that resolves outside the worktree", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const item = charter.work[0];
  assert.ok(item !== undefined);
  const outside = await mkdtemp(join(tmpdir(), "autopilot-outside-"));
  const worktree = await ensureWorktree(charter, item);
  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(join(outside, "secret.txt"), join(worktree, "result.txt"));

  const observation = await observeRepository(worktree);

  await assert.rejects(assertWritablePaths(worktree, observation.changedPaths, item.writableRoots), /resolves outside worktree/);
});
