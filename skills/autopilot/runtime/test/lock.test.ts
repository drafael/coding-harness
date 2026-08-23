import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireBranchOwnershipLock, acquireRunLock, requestRunStop } from "../src/lock.js";

test("run lock permits one coordinator and releases by owner token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-lock-"));
  const path = join(directory, "run.lock");
  const first = await acquireRunLock(path);

  await assert.rejects(acquireRunLock(path), /another coordinator owns/);
  await first.release();
  const second = await acquireRunLock(path);
  await second.release();

  assert.ok(true);
});

test("run lock retains ownership when its unpublished run directory is atomically published", async () => {
  const root = await mkdtemp(join(tmpdir(), "autopilot-relocated-lock-"));
  const temporaryDirectory = join(root, "temporary-run");
  const finalDirectory = join(root, "published-run");
  const temporaryLock = join(temporaryDirectory, "run.lock");
  const finalLock = join(finalDirectory, "run.lock");
  await mkdir(temporaryDirectory);
  const lock = await acquireRunLock(temporaryLock);

  await rename(temporaryDirectory, finalDirectory);
  await lock.relocate(finalLock);
  const request = await requestRunStop(finalLock, "published-run");

  assert.equal(request.status, "requested");
  assert.equal(await lock.stopRequested("published-run"), true);
  await lock.release();
});

test("run lock accepts only the current owner's durable stop request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopilot-stop-request-"));
  const path = join(directory, "run.lock");
  const first = await acquireRunLock(path);

  const request = await requestRunStop(path, "run-one");

  assert.equal(request.status, "requested");
  assert.equal(await first.stopRequested("run-one"), true);
  assert.equal(await first.stopRequested("run-two"), false);
  await first.release();

  const second = await acquireRunLock(path);
  assert.equal(await second.stopRequested("run-one"), false);
  await second.release();
});

test("branch ownership lock denies concurrent amendment adoption", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "autopilot-branch-lock-"));
  const first = await acquireBranchOwnershipLock(stateRoot, "autopilot/run/item");

  await assert.rejects(acquireBranchOwnershipLock(stateRoot, "autopilot/run/item"), /managed branch/);
  const otherBranch = await acquireBranchOwnershipLock(stateRoot, "autopilot/run/other");

  await otherBranch.release();
  await first.release();
});
