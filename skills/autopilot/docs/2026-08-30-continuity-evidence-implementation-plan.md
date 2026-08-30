# Autopilot continuity, evidence, review, and supervision implementation plan

- **Status:** Implemented through Phase 6A and packaged; Phase 6B notification wake is explicitly not promoted under the current no-receiver constraint
- **Date:** 2026-08-30
- **Audience:** Autopilot implementers and reviewers
- **Governing design:** [Harness-agnostic Autopilot design](architecture.md)
- **Decision record:** [Use a durable event engine with explicit authority](adr/0001-durable-event-engine.md)
- **Current implementation plan:** [Harness-agnostic Autopilot implementation plan](implementation-plan.md)

## Objective

Improve fresh-attempt continuity, overnight auditability, independent review, intentional pause, and provider waiting without adding another lifecycle owner or progress store.

The delivery sequence began with deterministic attempt context, exact evidence for each acceptance predicate, and documentation aligned with the executable gate contract. Separate changes then added exact-tree review, nonterminal pause, verified-effect reconciliation, and heartbeat-backed provider waiting. Production notification wake remains a later, evidence-gated change.

This plan adapts mechanisms rather than copying upstream files. No Poteto Mode, AWS AI-DLC, or Ralphex text or code should be vendored unless a later change includes a separate license and provenance review.

## Source baseline

The recommendations were checked against these upstream revisions:

- Cursor pstack at [`68836ddaf5697224520f1847d90cdb90ca8babaa`](https://github.com/cursor/plugins/tree/68836ddaf5697224520f1847d90cdb90ca8babaa): `autonomous-run`, `autopilot-full`, `session-pickup`, `pause-safely`, `babysit`, and `show-me-your-work`.
- AWS AI-DLC v2 at [`82d2e304206ca352ba3dc140dcbe8b9fb0b13b3d`](https://github.com/awslabs/aidlc-workflows/tree/82d2e304206ca352ba3dc140dcbe8b9fb0b13b3d): active memory steering, per-intent state, audit history, and stage-specific context loading.
- Ralphex at [`b3ad3193d0f8a7a756cfa2cc7e475ca202dd0d85`](https://github.com/umputun/ralphex/tree/b3ad3193d0f8a7a756cfa2cc7e475ca202dd0d85): fresh task sessions, progress logs, review passes, pause and resume, and bounded review iteration.

Recheck these revisions before quoting or adapting a detail during implementation. A later upstream change does not silently change this plan.

## Decisions and non-goals

### Keep one source of truth

Autopilot keeps its existing ownership model:

- `charter.json` owns the immutable objective, mechanics, limits, and authority;
- `events.jsonl` owns lifecycle history;
- Git owns code identity;
- content-addressed receipts own verification observations;
- snapshots, reports, handoffs, and worker context are rebuildable projections.

Do not add `.kiro/steering`, Markdown checkboxes, worker transcripts, prompts, or progress notes as lifecycle state. Existing repository guidance such as `AGENTS.md`, `.kiro/steering`, or host rules remains untrusted repository data. The charter compiler may source a constraint from that data, but repository text cannot add a grant, predicate, waiver, or lifecycle transition.

### Preserve current authority

Workers edit only authorized roots. The runtime continues to own verification, hooks, commits, pushes, delivery, review-thread resolution, merge, cleanup, and lifecycle decisions. Reviewer output and provider text are untrusted observations, not coordinator instructions.

### Keep later work separate

The first context-and-evidence delivery deliberately excluded:

- provider event wake or polling;
- intentional nonterminal pause;
- independent review and remediation;
- UI or browser evidence gates;
- automatic restacks;
- a daemon, TUI, workflow DSL, or global run registry.

Those changes use the separate promotion criteria below. Naming a later phase does not satisfy its prerequisites.

## Baseline audit

The implementation began from this boundary:

1. `ExecutionRequest` carried the item objective, acceptance summary, writable roots, grants, deadline, and output limits, but no structured prior-attempt context.
2. Command and search gates were the only executable `VerificationGate` variants.
3. Reports listed receipt IDs but did not provide one evidence result for every acceptance predicate.
4. The baseline package suite contained 111 passing Node tests.

Phases 0–6A replaced that boundary with versioned attempt context, structured predicate receipts and reports, continuity status, an exact-tree review gate, journal-safe pause, verified-item continuation, effect reconciliation, and exact-subject provider heartbeat waiting. The exact-tree review gate passed with Pi 0.84.4, Codex 0.151.0, and OpenCode 1.18.25. Claude Code 2.1.251 now reaches its identity-linked API key but requires an `ANTHROPIC_WORKSPACE_ID` absent from the validation environment, and production notification wake remains unverified.

## Phase 0: Align documentation with executable support

**Result:** Implemented.

### Files

Review and update only where the current implementation requires it:

```text
skills/autopilot/docs/architecture.md
skills/autopilot/docs/implementation-plan.md
skills/autopilot/references/charter.md
skills/autopilot/references/adapters.md
skills/autopilot/runtime/schemas/charter.schema.json
skills/autopilot/runtime/schemas/adapter.schema.json
```

### Work

1. Replace claims that runtime/UI probes, remote CI, and independent review are currently supported gate families if no validator, evaluator, receipt, and test fixture exist for them.
2. Distinguish implemented gate families from planned gate families in one maintained matrix.
3. Keep provider check observation separate from a charter verification gate unless the runtime can consume it as exact-head completion evidence.
4. State that a review receipt proves that a named review process ran against an exact subject and returned a result; it does not prove the absence of defects.
5. Do not implement a placeholder gate solely to preserve existing prose.

### Acceptance evidence

- Every documented gate variant maps to a runtime type, parser branch, evaluator, receipt identity, and focused test.
- Planned variants are marked as planned or unverified.
- JSON Schemas and TypeScript validators describe the same implemented contract.
- Markdown links and fences validate.

## Phase 1: Define deterministic attempt context

**Result:** Implemented.

### Contract

Add a versioned, immutable attempt-context value to the existing execution request. Keep the value data-only and adapter-neutral. Start adjacent to `ExecutionRequest` in `runtime/src/adapter-protocol.ts`; extract a separate module only when both launch and reporting need the same builder.

The minimum context contains:

```text
schema version
charter hash
source journal sequence and record hash
run, item, and attempt IDs
expected base commit and current tree identity
item title and objective
applicable predicates and gate definitions
accepted dependency commits
latest applicable gate and predicate results
bounded prior-attempt failure facts
remaining attempt and replan counts plus the sealed attempt and idle timeouts
relevant sealed assumptions
writable roots and actor-scoped grants
explicit forbidden Git and delivery effects
required worker result format
```

Do not include raw transcripts, provider comments, full command output, credential values, unrelated work items, or worker-authored completion claims. The first version should include receipt IDs and normalized reasons rather than diagnostic excerpts. Add excerpts only after a demonstrated debugging need and a separate redaction test.

### Files

Expected production changes:

```text
skills/autopilot/runtime/src/adapter-protocol.ts
skills/autopilot/runtime/src/adapter-process.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/json.ts
skills/autopilot/runtime/schemas/adapter.schema.json
```

Expected tests:

```text
skills/autopilot/runtime/test/adapter-contract.test.ts
skills/autopilot/runtime/test/adapter-compatibility.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

Add `test/attempt-context.test.ts` only if context assembly becomes a distinct production module.

### Work

1. Define `AttemptContext` with `schemaVersion: 1` and explicit normalized fields. Do not use `Record<string, unknown>` for the public contract.
2. Build context immediately before `HarnessPort.launch()` from the sealed charter, replayed projection, current Git observation, and stored receipts.
3. Exclude wall-clock generation time from the canonical context hash. Include only sealed or observed values that affect the worker brief.
4. Canonically serialize and hash the context.
5. Write an immutable, user-only context artifact under the existing attempt-report area before recording `ATTEMPT_STARTED`. A crash may leave an unreferenced artifact; it must not create a lifecycle transition.
6. Add the context hash and source journal sequence or hash to `ATTEMPT_STARTED`. Parse these fields compatibly for journals created before this change.
7. Render one worker prompt from the normalized context. Adapter-specific argument builders may change transport syntax, but they must not add authority or omit required semantics.
8. Continue to pass the rendered task through the Pi bridge. Do not teach the bridge a second context format unless Pi needs structured fields for a demonstrated capability.
9. On a replacement attempt, build a new context from reconciled state. Never reuse a stale lease, deadline, expected head, or prior context artifact.
10. Treat repository guidance and review findings as labeled data. They may appear only through sealed assumptions or normalized evidence fields and cannot alter grants or predicates.

### Failure behavior

- A context that exceeds its configured bound stops launch with a stable error instead of truncating authority or acceptance criteria.
- A missing context artifact referenced by an active attempt fails reconciliation closed unless the exact context can be deterministically rebuilt and its hash matches.
- A mismatched context hash is journal or state corruption.
- Unsupported older journals remain readable. A resumed older run receives a newly generated context only when it starts a fresh attempt.

### Acceptance evidence

- The same charter, journal prefix, Git identity, and receipts produce byte-identical canonical context.
- Deleting `snapshot.json` and replaying the journal produces the same context.
- Initial attempt, retry, interrupted resume, amendment, queue sibling, and ordered-stack descendant fixtures receive the correct base and dependency identities.
- A failed gate from attempt one appears as a normalized fact in attempt two; stale or late attempt output does not.
- Changing the charter, journal prefix, accepted commit, gate result, or lease identity changes the context hash.
- Changing only a rebuildable snapshot does not change the context hash.
- Credential-like environment values and provider bodies do not appear in the context artifact or rendered prompt.
- Pi, Claude Code, Codex, and OpenCode fixtures receive equivalent semantic context.

## Phase 2: Produce predicate-to-evidence reports

**Result:** Implemented.

### Contract

Every acceptance predicate must have one current result:

```text
predicate identity and definition
item ID
outcome: met | not-met | blocked
exact subject tree or commit
receipt or observation IDs
normalized reason
observed and expected values where applicable
```

The map is a projection from receipts and journaled evidence. It is not a second completion evaluator.

### Files

Expected production changes:

```text
skills/autopilot/runtime/src/evidence.ts
skills/autopilot/runtime/src/done.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/src/wrap-up.ts
```

Expected tests:

```text
skills/autopilot/runtime/test/evidence.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/reducer.test.ts
skills/autopilot/runtime/test/wrap-up.test.ts
skills/autopilot/runtime/test/run-discovery.test.ts
```

### Work

1. Give each predicate a deterministic identity derived from its item, position, and canonical definition. Do not require users to invent IDs for existing charters.
2. Extend predicate evaluation to return structured results as well as the aggregate outcome. Derive human-readable reasons from the structured result rather than maintaining two evaluators.
3. Store content-addressed observations for path and search predicates. Reuse the existing receipt directory and `RECEIPT_RECORDED` event when its semantics remain unambiguous; add a new event only if the reducer or recovery path cannot distinguish the evidence safely.
4. Bind every observation to the exact tree or commit that was inspected. A changed tree invalidates it.
5. Extend `RunReport` with an evidence-map schema. Keep `generatedAt` outside semantic equivalence checks.
6. Generate status, final reports, optional handoffs, and Phase 1 attempt context from the same evidence-map projection.
7. Keep report generation read-only. It may read receipts and inspect a retained worktree, but it must not append events, rewrite canonical state, rerun mutating hooks, or execute a missing gate.
8. Preserve existing report fields for compatibility during the developer preview unless a focused migration proves that removal is safe.

### Failure behavior

- Missing or corrupt evidence is `blocked` or `UNVERIFIED`, never `met`.
- A stale receipt remains visible only as historical evidence and cannot appear as the current predicate result.
- If a retained worktree is unavailable, report generation uses journaled receipts and marks predicates that require a fresh filesystem observation as unverified.
- Worker summaries and review prose cannot satisfy predicates.

### Acceptance evidence

- Every predicate in the three graph modes appears exactly once in the evidence map.
- Gate, path-present, path-absent, and search-count predicates record observed and expected values at the exact subject.
- Changed code identity invalidates prior results.
- Rebuilding after snapshot deletion produces semantically equivalent status and final reports.
- A handoff cannot claim evidence that is absent from the final report.
- Existing successful and stopped fixture reports remain readable.

## Phase 3: Integrate continuity into status and retry behavior

**Result:** Implemented.

### Files

Expected changes:

```text
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/cli.ts
skills/autopilot/SKILL.md
skills/autopilot/README.md
skills/autopilot/references/recovery.md
```

### Work

1. Add concise status fields for the last durable milestone, current or last attempt, unmet predicates, latest normalized failure, remaining budgets, and next legal action.
2. Bind the status summary to the same charter hash, journal sequence, and evidence map used by the next attempt context.
3. Keep live stderr activity ephemeral. Do not infer durable progress from tool names, token counts, model messages, or elapsed time.
4. Detect repeated no-change attempts for reporting, but do not add a new early-stop quota in this phase. Existing attempt and replan limits remain authoritative until real runs demonstrate that a separate plateau policy is needed.
5. Make retry prompts describe observed failures without prescribing the next implementation. This preserves fresh-session independence and avoids anchoring workers on failed approaches.

### Acceptance evidence

- `/autopilot status` identifies the exact durable resume point without exposing state paths, full run IDs, raw prompts, or secrets.
- A retry receives failed predicate facts and current evidence, not the previous worker's narrative.
- A successful terminal run remains immutable when status is requested.
- Existing omitted-ID and short-ID discovery behavior remains unchanged.

## Phase 4: Add exact-subject independent review

**Result:** Implemented with fake-adapter and temporary-repository coverage. No real harness review boundary is claimed until a version-pinned disposable run passes.

### Contract checkpoint

Before editing, confirm these semantics in the implementing change:

- A review receipt means that a named reviewer process examined an exact tree or commit and returned a normalized verdict.
- `PASSED` means the review process completed with a `clean` verdict and no findings. It does not prove that the code has no defects.
- `FAILED` means the process returned one or more in-scope findings.
- `UNVERIFIED` covers malformed, inconclusive, timed-out, mutated-tree, or unsupported review execution.
- Findings are untrusted data. They cannot expand scope, authority, acceptance criteria, credentials, or lifecycle permissions.
- A changed subject invalidates the review receipt.

If these semantics are not acceptable, stop and revise the design instead of hiding model judgment behind the existing receipt status names.

### Files

Expected production changes:

```text
skills/autopilot/runtime/src/charter.ts
skills/autopilot/runtime/src/adapter-protocol.ts
skills/autopilot/runtime/src/adapter-process.ts
skills/autopilot/runtime/src/evidence.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/schemas/charter.schema.json
skills/autopilot/runtime/schemas/adapter.schema.json
```

Expected tests:

```text
skills/autopilot/runtime/test/charter.test.ts
skills/autopilot/runtime/test/adapter-contract.test.ts
skills/autopilot/runtime/test/adapter-compatibility.test.ts
skills/autopilot/runtime/test/evidence.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

### Work

1. Add a bounded `review` gate variant with an item scope and review focus. The first version fails on any finding; do not add severity policy until a demonstrated consumer needs it. Do not embed provider credentials, arbitrary shell, merge authority, or model configuration in the gate.
2. Add an execution role such as `implementation` or `review` to the normalized adapter request. A review request has no writable roots and no worker Git or delivery grants.
3. Define a small structured review observation: verdict, findings, reviewer identity, subject identity, start and completion times, and truncation state.
4. Require findings to carry stable local fields such as repository-relative path when applicable, line when applicable, and a bounded explanation. A reviewer may report severity for display, but the first gate version does not trust severity to suppress a finding. Treat every string as untrusted data.
5. Observe Git HEAD, tree, refs, configuration, and worktree status before and after review. Any reviewer mutation makes the result `UNVERIFIED` and blocks completion.
6. Store a content-addressed review receipt tied to the exact subject, gate definition, adapter identity, and relevant environment identity.
7. If review reports findings, feed normalized findings into the next implementation attempt through `AttemptContext`. The worker triages them; the runtime does not blindly execute reviewer instructions.
8. Re-run every ordinary predicate and the review gate after remediation. A new tree invalidates the previous review.
9. Report same-model or same-provider review as a limitation. Do not require a different provider or silently imply stronger independence.
10. Start with one reviewer. Add parallel reviewers only when one real change demonstrates a decision benefit that justifies the additional cost.

### Acceptance evidence

- Clean, findings, inconclusive, malformed, timed-out, oversized, and cancelled review fixtures produce the expected receipt status.
- A reviewer-created file, commit, ref, or Git configuration change fails closed.
- Findings cannot add writable roots, grants, predicates, commands, environment names, or provider effects.
- A remediation tree change invalidates the prior review and requires a fresh review.
- Reviewer prose alone cannot emit `ITEM_SATISFIED` or `RUN_SUCCEEDED`.
- One disposable run proves the exact harness version and boundary before documentation claims support.

## Phase 5: Add intentional nonterminal pause

**Result:** Implemented. Existing `stop` remains terminal.

The runtime now prevalidates transitions before append, records one durable `ITEM_VERIFIED` checkpoint, reconciles confirmed lifecycle effects from fresh observations, and uses a token-fenced pause request. Active implementation is cancelled and observed before exact lease retirement; cancellation solely for pause remains auditable but is not charged to the attempt budget. Resume creates a fresh attempt only for unfinished implementation and continues verified items without rerunning workers.

On POSIX hosts, built-in adapters now run implementation attempts beneath a detached, attempt-scoped supervisor that owns bounded process execution and cancellation without journal authority. A restarted coordinator reconstructs the exact request, reattaches to matching supervisor artifacts, and observes terminal quiescence before retrying. Legacy attempts, reviews, and incomplete or mismatched bootstrap artifacts remain `EXECUTION_STATE_UNKNOWN`.

[![Autopilot lifecycle showing nonterminal waiting for operator pause, provider checks, or unknown execution state without reopening terminal success or stop.](diagrams/autopilot-lifecycle-waiting.png)](diagrams/autopilot-lifecycle-waiting.html)

*Implemented pause, provider-check, and executor-loss paths. Select the image to open the standalone HTML figure.*

### Files

Expected production changes:

```text
skills/autopilot/runtime/src/cli.ts
skills/autopilot/runtime/src/lock.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/reducer.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/run-discovery.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/SKILL.md
skills/autopilot/README.md
skills/autopilot/docs/getting-started.md
skills/autopilot/docs/runtime-cli.md
skills/autopilot/references/recovery.md
```

Expected tests:

```text
skills/autopilot/runtime/test/cli.test.ts
skills/autopilot/runtime/test/lock.test.ts
skills/autopilot/runtime/test/reducer.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/run-discovery.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

### Work

1. Add `/autopilot pause` and internal `autopilot pause [run-id]` routing.
2. Generalize the fenced control request only as far as needed to distinguish `pause` from `stop`. Keep the current lock token, run identity, and sole-coordinator journal ownership.
3. When an adapter is active, the owning coordinator cancels it, records its terminal observation, verifies repository identity, releases its lease, and moves the item to a resumable state.
4. Reuse `WAITING` when it expresses the required state without ambiguity. Add a lifecycle event only when replay, status, or recovery cannot distinguish operator pause from ordinary waiting.
5. Preserve all branches, worktrees, receipts, reports, and budgets. Pause must not create a commit, push, PR/MR effect, cleanup effect, waiver, or successor.
6. Resume through ordinary reconciliation and a fresh attempt context. Do not reattach to a cancelled process.
7. If success is durably recorded before the pause request wins the lock, success remains terminal.
8. If the coordinator disappears after receiving the request, the next `pause` or `resume` command reconciles the token-bound control state without two journal writers.

### Acceptance evidence

- Pause before launch, during adapter work, between verification and a Git effect, and after terminal success has deterministic behavior.
- Active pause cancels the process group where supported and does not mark the run `STOPPED`.
- `/autopilot resume` continues a paused run; it still refuses a stopped or successful run.
- A stale-token pause request cannot affect a replacement coordinator.
- Pause never widens authority or consumes an extra attempt solely because cancellation was operator-requested.
- Windows process-tree cancellation is exercised in Node 24 CI, including an inherited descendant-handle fault case and a foreground coordinator stop.

## Phase 6: Add optional provider wake with heartbeat fallback

**Result:** Heartbeat-backed Phase 6A is implemented. Production notification wake is not promoted under the current no-receiver constraint. Do not create a daemon.

### Phase 6B non-promotion decision

As of 2026-08-30, the owner accepted bounded Phase 6A heartbeat polling as the production behavior until an already-operated, authenticated provider event receiver and authorized disposable target are supplied. Installed GitHub and GitLab CLI watch surfaces poll; they are not notification evidence. Autopilot will not create a receiver, tunnel, webhook credential, signing boundary, or background service.

This decision removes Phase 6B from the current release sequence without claiming it implemented. Reconsideration requires one provider-native event class, a version-pinned receiver invocation contract, and the promotion evidence below. Any future hint remains untrusted and must trigger fresh exact PR/MR, head, base, state, and check observation. Phase 6A heartbeat fallback remains mandatory.

Pending checks enter structured `WAITING` for a bounded session. Heartbeats reobserve the exact recorded PR/MR, head, base, state, and checks without journal spam. Session expiry records `UNVERIFIED` and remains nonterminal; resume samples the exact subject again. Provider notifications remain disabled until one version-pinned surface is proven on an authorized disposable target.

### Deferred Phase 6B contract checkpoint

Select one initial provider and one event class, such as change-request checks for an exact head. Define:

- the watched provider object and exact subject commit;
- a provider-specific opaque cursor or observation identity;
- timeout and heartbeat bounds;
- duplicate and reordering behavior;
- cancellation and process-loss behavior;
- fallback observation when notifications are absent.

If the provider CLI has no stable event interface, implement bounded polling inside the delivery adapter and report it as polling. Do not call polling event-driven.

### Phase 6A files and likely Phase 6B touch points

```text
skills/autopilot/runtime/src/delivery.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/delivery/github/index.ts
skills/autopilot/runtime/delivery/gitlab/index.ts
skills/autopilot/runtime/test/delivery-contract.test.ts
skills/autopilot/runtime/test/github-delivery.test.ts
skills/autopilot/runtime/test/gitlab-delivery.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

### Implemented Phase 6A work

1. Add an optional delivery capability for waiting on an exact provider subject.
2. Keep the runtime as the only component that decides whether a provider observation advances the run.
3. Persist intent before waiting when restart reconciliation needs it. Do not append an event for every heartbeat.
4. Reobserve change-request head, base, checks, and state after every heartbeat, resume, or future wake. A future notification is only a hint.
5. Use bounded heartbeat observation so pending checks cannot hold one foreground session forever.
6. Cancel waiting through the existing coordinator control path.
7. On restart, observe provider state before reopening a watcher or retrying an effect.

### Phase 6A acceptance evidence

- Pending exact-head checks enter structured `WAITING` and do not consume an implementation attempt.
- Session expiry records one `UNVERIFIED` observation and remains resumable.
- Resume and restart reobserve the same durable PR/MR identity rather than rediscovering another request.
- A changed head invalidates prior checks and review receipts.
- Pause and stop cancel the wait through the existing coordinator path.
- Heartbeats do not create journal spam.

### Deferred Phase 6B work

1. Select and version-pin one provider notification surface on an authorized disposable target.
2. Treat notifications as hints and route them through the same exact-subject observation used by heartbeats.
3. Preserve bounded heartbeat fallback, cancellation, and restart reconciliation when hints are missing or malformed.

### Phase 6B promotion evidence

- Duplicate, missing, delayed, and reordered notifications cannot advance the wrong head.
- Heartbeat fallback detects provider completion after a missed notification.
- Process loss before and after a notification reconciles without duplicating a mutation.
- Only the provider, event surface, and version exercised on the disposable target are documented as verified.

## Phase 7: Finish documentation and packaging

**Result:** Implemented for Phases 0–6A. Phase 6B is not promoted under the recorded no-receiver decision and is not a current release blocker. The current validation baseline is 162 Node tests locally and a 93-file package dry run; the previous 137-test baseline passed on Ubuntu and Windows.

### Files

Update as required by implemented phases:

```text
README.md
skills/autopilot/README.md
skills/autopilot/SKILL.md
skills/autopilot/docs/README.md
skills/autopilot/docs/architecture.md
skills/autopilot/docs/getting-started.md
skills/autopilot/docs/runtime-cli.md
skills/autopilot/docs/implementation-plan.md
skills/autopilot/docs/diagrams/
skills/autopilot/references/adapters.md
skills/autopilot/references/charter.md
skills/autopilot/references/recovery.md
skills/autopilot/runtime/dist/
```

### Work

1. Document only implemented lifecycle commands and gate families.
2. Keep Autopilot manual-only and use `/autopilot` examples.
3. Explain that attempt context and evidence maps are generated projections, not repository state.
4. Add local playbooks only if the implemented skill routing becomes difficult to follow. Do not copy upstream playbooks merely to mirror their names.
5. Update tracked `dist/` from the reviewed TypeScript source and inspect the generated diff.
6. Run the package dry run and clean-copy smoke test without `node_modules`.
7. Record exact test counts, harness versions, provider versions, and unverified boundaries from current evidence.
8. Keep editorial diagrams as standalone, accessible HTML derived from maintained prose, with lossless 2× PNG exports for Markdown. A diagram must not introduce a lifecycle state, ownership claim, or verified boundary absent from the linked source document.

### Acceptance evidence

- User documentation contains no command that the CLI does not implement.
- Maintainer documentation maps context, evidence, review, pause, and wake to their runtime owners.
- The repository retains reviewed source, schemas, tests, and matching compiled files; the npm artifact contains package metadata, the compiled runtime, and schemas without dependencies or temporary test output.
- `doctor` remains non-mutating and does not install, authenticate, download, or alter global configuration.
- Editorial HTML figures pass the Diagram Design structural check and retain complete static labels without relying on animation or color alone.
- Markdown embeds use 2560×1440 PNG exports generated from the matching HTML SVG and link back to that source.

## Validation sequence

Run the smallest focused test after each change. Before completing an implementation phase, run:

```bash
cd skills/autopilot/runtime
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm pack --dry-run
```

Also run from the repository root:

```bash
git diff --check
```

Validate modified Markdown links and balanced fences with the repository's established documentation check. Do not run write-mode formatting, dependency updates, provider authentication, remote mutation, browser installation, or snapshot updates merely to validate the change.

`npm test` and `npm run build` recreate tracked `dist/`. Review source and generated changes together. Remove `.test-dist/` and other temporary output before finishing.

### Windows validation evidence

GitHub Actions run [33319142329](https://github.com/drafael/coding-harness/actions/runs/33319142329) passed the same Node 24 typecheck, lint, format check, and 136-test suite on both `ubuntu-latest` and `windows-latest` at runtime commit `41500fb`. The Windows runs exposed and then verified fixes for unsupported directory fsync, direct governed-hook execution, portable fake CLI fixtures, and descendant process-tree cancellation. Windows writes still do not claim POSIX-equivalent sudden-power-loss directory metadata durability because Node.js cannot fsync a Windows directory handle. Restart reattachment remains a separate unimplemented supervisor boundary.

## Cross-cutting test matrix

| Boundary | Required cases |
|---|---|
| Attempt context | deterministic serialization, replay, prior failure, dependency identity, bound, redaction, old journal |
| Evidence map | every predicate kind, stale subject, missing receipt, blocked result, report replay |
| Adapter parity | equivalent semantic prompt, malformed output, timeout, cancellation, cooperative restriction |
| Review | exact subject, clean, findings, inconclusive, mutation, changed tree, untrusted finding |
| Pause | active owner, stale token, process loss, success race, stopped-run refusal, resume |
| Provider wake | duplicate, reordered, missed event, heartbeat, changed head, cancellation, restart |
| Security | path escape, symlink escape, command injection, secret leakage, authority expansion |
| Packaging | clean copy, no `node_modules`, executable `dist`, no temporary artifacts |
| Windows | lock fencing, file sync and atomic replace, worktrees, Git hooks, fake provider CLIs, timeout/cancellation, descendant process tree |

## Delivery sequence

The implementation followed separate reviewable boundaries in this order:

1. documentation truth correction;
2. attempt-context contract and deterministic launch context;
3. predicate-to-evidence map and status integration;
4. exact-subject independent review;
5. intentional pause and verified-effect reconciliation;
6. exact-subject heartbeat waiting;
7. one-provider notification wake proof, only after its prerequisite evidence exists;
8. broader provider or platform verification.

Do not start a later change while the earlier contract still has unresolved correctness findings. A phase may be removed when investigation shows that current code already satisfies it or that its benefit does not justify the boundary change.

## Stop and reassess conditions

Stop the implementation phase and revise this plan when:

- context requires a second canonical store;
- compatibility requires silently weakening authority, predicates, or evidence;
- reviewer output would become direct lifecycle authority;
- pause cannot preserve one journal writer and deterministic item state;
- provider wake requires a daemon or a global registry;
- two attempts at the same implementation boundary fail or remain unverified;
- a proposed helper, service, or schema has only a hypothetical consumer;
- tests require production hooks that exist only to manufacture failures.

Revert failed approaches rather than preserving compatibility scaffolding around them.

## Completion criteria

The planned work is complete when:

- every fresh attempt receives deterministic, bounded context derived from canonical state;
- status, final reports, handoffs, and retries use the same predicate-to-evidence projection;
- documentation matches executable gate and lifecycle support;
- independent review, if promoted, is exact-subject, read-only, bounded, and advisory rather than lifecycle authority;
- pause, if promoted, is intentionally nonterminal while stop remains terminal;
- provider wake, if promoted, reobserves exact provider state and retains a bounded heartbeat fallback;
- existing single, queue, stack, amendment, review-feedback, stop, and wrap-up behavior remains intact;
- package checks pass and generated `dist/` matches source;
- live harness, provider, and platform claims name the exact exercised versions and leave other boundaries unverified;
- the final diff contains no copied upstream workflow, mutable steering state, duplicate lifecycle path, unused dependency, speculative abstraction, or dead experiment.
