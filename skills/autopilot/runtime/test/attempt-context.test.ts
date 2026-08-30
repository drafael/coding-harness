import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attemptContextHash, buildAttemptContext, renderAttemptContext } from "../src/attempt-context.js";
import { sealCharter } from "../src/charter.js";
import { newEventId } from "../src/events.js";
import { appendEvent, readJournal } from "../src/journal.js";
import { rebuildProjection } from "../src/projection.js";
import { createRepository, proposedCharter } from "./helpers.js";

test("attempt context is deterministic and changes with observed identity", async () => {
  const repository = await createRepository();
  const charter = sealCharter(proposedCharter(repository.root, repository.baseCommit));
  const directory = await mkdtemp(join(tmpdir(), "autopilot-context-"));
  await mkdir(join(directory, "reports", "attempts"), { recursive: true });
  await appendEvent(join(directory, "events.jsonl"), {
    eventId: newEventId(),
    timestamp: "2026-08-30T00:00:00.000Z",
    source: "runtime",
    reason: "compiled",
    type: "CHARTER_COMPILED",
  });
  const journal = await readJournal(join(directory, "events.jsonl"));
  const input = {
    charter,
    item: charter.work[0]!,
    attemptId: "attempt-1",
    leaseEpoch: 1,
    observation: {
      headCommit: repository.baseCommit,
      treeIdentity: "tree-one",
      changedPaths: [],
      clean: true,
      refIdentity: "refs",
      auxiliaryRefIdentity: "auxiliary-refs",
      externalRefIdentity: "external-refs",
      configurationIdentity: "configuration",
    },
    records: journal.records,
    projection: rebuildProjection(charter, journal.records),
    predicateEvidence: [],
    reviewFindings: [],
  } as const;

  const first = buildAttemptContext(input);
  const second = buildAttemptContext(input);
  const changed = buildAttemptContext({ ...input, observation: { ...input.observation, treeIdentity: "tree-two" } });
  const redacted = buildAttemptContext({ ...input, sensitiveValues: [charter.work[0]!.objective] });

  assert.deepEqual(first, second);
  assert.equal(attemptContextHash(first), attemptContextHash(second));
  assert.notEqual(attemptContextHash(first), attemptContextHash(changed));
  assert.equal(redacted.objective, "[REDACTED]");
  assert.equal(first.sourceJournalSequence, 1);
  assert.equal(first.sourceJournalRecordHash, journal.records[0]?.recordHash);
  assert.doesNotMatch(renderAttemptContext(first), /worker-authored completion/i);
  assert.match(renderAttemptContext(first), /not completion evidence/i);
});
