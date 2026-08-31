# Cooperative harness execution implementation plan

- **Status:** Approved design; PR 1 decision/promotion shutdown, PR 2 execution assurance, PR 3 fenced unknown-execution recovery, and PR 4 Pi process-local integration are complete; Windows native-path removal remains pending
- **Date:** 2026-08-31
- **Audience:** Autopilot implementers and reviewers
- **Related:** [Architecture](architecture.md), [continuity implementation plan](2026-08-30-continuity-evidence-implementation-plan.md), [durable event engine ADR](adr/0001-durable-event-engine.md)

## Objective

Remove the project-owned Windows Job Object executable from the planned package and prefer harness-managed worker execution where a version-pinned integration can preserve exact attempt identity.

The replacement uses **cooperative terminality**. Autopilot accepts a worker's terminal result only while the exact harness connection that admitted the worker remains authoritative. It does not claim OS process-tree quiescence. If continuity becomes ambiguous, Autopilot records `EXECUTION_STATE_UNKNOWN`, preserves the worktree and evidence, launches no replacement, and requires explicit operator recovery.

This change addresses the security, reputation, and antivirus risk of shipping a custom native executable. It deliberately trades automatic Windows recovery after harness loss for a smaller packaged trust boundary.

## Approved decisions

1. Do not check the reviewed Windows x64 helper artifact into the repository.
2. Do not silently replace the helper with an N-API addon, PowerShell P/Invoke, runtime compilation, or experimental FFI.
3. Prefer harness-managed subagents where a public, version-pinned integration exists.
4. Accept cooperative terminality only through the uninterrupted harness instance that admitted the exact attempt.
5. Treat extension reload with lost identity, session replacement, harness exit, missing terminal response, ambiguous cancellation, and backend identity change as `EXECUTION_STATE_UNKNOWN`.
6. Never use `reattach() ?? launch()` for a cooperative execution subject.
7. Preserve the runtime as the only lifecycle writer. Harnesses and workers remain observation and execution mechanisms; they cannot append canonical lifecycle events or expand authority.
8. Keep implementation attempts in dedicated Autopilot worktrees. An unknown worktree is permanently quarantined from future workers.
9. Keep reviews session-scoped unless review continuity is separately proven.
10. Keep the existing POSIX process-group supervision path for CLI adapters. The native removal applies to the project-owned Windows helper.

## Terms

**Cooperative terminality**

An exact terminal response from the uninterrupted harness instance that admitted the execution. It proves the harness's logical result, not OS process-tree quiescence.

**Harness instance**

The process/session/integration identity through which Autopilot admitted and observed one execution. The exact fields are provider-specific and version-pinned.

**Execution subject**

The provider or harness identity for one admitted worker, bound to the Autopilot run, item, attempt, lease epoch, and context hash.

**Unknown execution**

An execution for which Autopilot cannot prove that the original harness instance remains authoritative or cannot obtain a matching terminal response. Unknown is nonterminal and cannot be retried automatically.

**Adopted tree**

An exact tree sealed after operator confirmation that an unknown worker is no longer active. Adoption authorizes verification of that tree; it does not retroactively prove clean worker termination.

## Research findings

The approved design follows a read-only review of the current runtime, Pi 0.84.4 with pi-subagents 0.60.0, and current public Claude Code, Codex, and OpenCode integration surfaces.

| Harness surface | Useful identity and control | Continuity boundary | Why it is not process proof |
|---|---|---|---|
| Pi structured delegation | Exact `requestId`, `ownerRunId`, and `nodeId`; exact cancellation tuple; at most one terminal response | Process-local extension context | Events and ownership maps are process-local; terminal status is logical |
| Pi async RPC | Durable run artifacts, exact run status, stop requests, conservative process-terminal projection | Same Pi process/session is the narrow candidate | On Windows, pi-subagents 0.60.0 reports process-tree terminality as unknown; launch reply is not an idempotent admission key |
| Claude Agent SDK | Session identity, streaming result, interrupt/close, conversation resume | Original SDK query while connected | Resume starts or reconstructs execution through a provider subprocess; no active-query attachment contract |
| Codex app-server | Durable thread ID, turn ID, status/events, interrupt, live turn rejoin while the same server survives | Same app-server process | Turn interruption can leave background terminals; stored history is not OS quiescence |
| OpenCode server | Session/message identity, status, live SSE, abort, child sessions | Same server process and live status | No distinct durable prompt-run ID or replayable SSE cursor; abort is cooperative for arbitrary tools |

No reviewed harness currently guarantees that a Windows terminal or cancellation response means every local descendant has stopped and no future filesystem mutation can occur. The new assurance level must state this limitation directly.

Primary external references:

- [Claude Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Codex SDK](https://developers.openai.com/codex/sdk)
- [Codex app-server](https://developers.openai.com/codex/app-server)
- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)

## Architecture

### Ownership

```text
Operator
  |
  v
Autopilot coordinator — sole events.jsonl writer
  |
  | exact attempt identity and bounded task
  v
Harness integration — owns worker admission and logical terminal response
  |
  v
Worker — edits only the dedicated Autopilot worktree
```

Autopilot continues to own:

- charter, grants, retry policy, and lifecycle transitions;
- worktree and writer lease identity;
- verification, review, hooks, commits, pushes, delivery, merge, and cleanup;
- terminal acceptance and unknown-state recovery.

The harness owns:

- worker admission;
- provider-specific execution identity;
- progress and logical terminal delivery;
- cooperative cancellation while the connection remains authoritative.

The worker owns no lifecycle or external Git/provider effect.

### Execution-assurance model

The current `restartReattachment` Boolean conflates three facts:

1. who owns execution;
2. whether the execution can be observed after coordinator interruption;
3. whether terminal observation proves process-tree quiescence.

Replace that assumption with a versioned execution-assurance description selected per execution mode. The representation must distinguish at least:

- runtime-managed versus harness-managed ownership;
- process-supervised versus cooperative terminality;
- session-only, same-harness-instance, or durable-subject continuity;
- ordinary admission versus explicitly idempotent get-or-create admission.

Do not finalize a broad provider abstraction before the Pi integration proves the minimum fields. Preserve old adapter manifest and journal readability.

### Admission

Before asking the harness to start work, Autopilot durably records:

- run, item, attempt, and lease epoch;
- attempt context hash and expected repository identities;
- harness, integration mode, and version;
- selected execution assurance;
- admission intent and a unique request identity.

After admission, Autopilot records the harness subject identity immediately when the API exposes it. If continuity is lost between admission and durable subject capture, the execution becomes unknown. Autopilot must not repeat admission unless that exact integration has a separately proven idempotent get-or-create contract.

### Terminal acceptance

A cooperative terminal result is accepted only when all of these remain true:

1. The original harness connection remained uninterrupted from admission through terminal response.
2. Harness instance, request, subject, run, item, attempt, lease epoch, and context hash match.
3. The result is structurally valid and respects output bounds.
4. Pause, stop, cancellation, lease replacement, or lock-token replacement did not overtake completion.
5. Repository HEAD, managed refs, Git configuration, index, tree, and changed paths remain authorized.
6. Required gates and independent review bind the exact accepted tree before commit and delivery.

The runtime must document that this is a cooperative result, not process-terminal proof.

### Cancellation and pause

A cancellation request or harness acknowledgment is not terminal. Autopilot waits for the matching terminal response on the same authoritative connection.

- Matching terminal cancellation can satisfy an operator-requested pause without charging the attempt.
- Natural completion that wins the timestamp race remains chargeable under the existing rules.
- Connection loss or identity change during cancellation becomes unknown.
- Unknown cancellation cannot permit a replacement attempt.

### Repository and effect safety

Every implementation attempt uses a dedicated Autopilot worktree. The worker may edit authorized roots but may not commit, push, deliver, merge, or clean up.

After cooperative terminal response, the runtime:

1. reobserves repository identity and authorized changes;
2. runs predicates, hooks, and independent review against an exact tree;
3. reobserves before commit;
4. commits the exact accepted tree;
5. rechecks effect preconditions before every external mutation.

A late write after commit cannot change the committed tree, but it can dirty and quarantine the retained worktree. A late ref, configuration, index, or pre-commit tree change blocks the effect.

This sequence reduces the impact of late cooperative activity but does not claim to prevent a background process or external side effect.

## Unknown-state recovery

An interrupted cooperative attempt enters nonterminal `WAITING` with reason `EXECUTION_STATE_UNKNOWN`. Its report contains bounded operational evidence:

- run, item, attempt, lease, and context identities;
- harness/backend/version and known subject identity;
- last accepted status and timestamp;
- continuity-loss reason;
- current repository HEAD, tree, refs, configuration identity, and changed paths;
- whether the worktree changed after the last trusted observation.

Late provider output may be retained for diagnosis but cannot restore authority.

### Abandon and retry

The operator confirms they have externally stopped or accounted for the old execution. Autopilot records the attestation without claiming OS proof, seals the old worktree observation, permanently quarantines that worktree from workers, charges the interrupted attempt unless it was solely a confirmed pause, and creates a fresh attempt in a new worktree.

### Adopt the current tree for verification

The operator confirms the old execution is no longer active and authorizes evaluation of the exact current tree. Autopilot seals that tree, launches no implementation worker, and runs every required predicate, hook, and independent review. Any worktree change during adoption or verification returns the attempt to unknown.

### Stop the run

The operator terminally stops the run. State and worktree remain available until explicit cleanup.

No recovery action may silently reconnect, repeat admission, reuse the unknown worktree for a worker, or infer quiescence from PID absence, a provider transcript, or a late terminal message.

## Delivery plan

### PR 1: Record the decision and stop native promotion

**Objective:** Make the security decision durable before runtime changes.

Scope:

- Add an ADR for cooperative harness execution that qualifies the foreground-CLI statement in ADR 0001 without changing journal ownership.
- Record that the reviewed x64 helper artifact will not be packaged.
- Disable or remove the helper artifact workflow so it cannot be promoted accidentally.
- Update implementation status and the security rationale.

Validation:

- Documentation links resolve.
- No runtime behavior or generated runtime file changes.
- The repository contains no packaged helper binary.

### PR 2: Separate continuity from quiescence

**Objective:** Represent cooperative execution without granting restart or quiescence implicitly.

Likely components:

```text
skills/autopilot/runtime/src/adapter-protocol.ts
skills/autopilot/runtime/src/adapter-process.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/reducer.ts
skills/autopilot/runtime/src/projection.ts
skills/autopilot/runtime/src/policy.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/schemas/adapter.schema.json
skills/autopilot/runtime/schemas/charter.schema.json
skills/autopilot/runtime/test/adapter-contract.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/reducer.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

Required behavior:

- Select execution assurance per request/mode.
- Preserve old manifests and journals.
- Persist cooperative admission identity and assurance.
- Remove `reattach() ?? launch()` for non-idempotent subjects.
- Map cooperative continuity loss to nonterminal unknown.
- Preserve existing process-supervised behavior where still supported.
- Keep review execution session-scoped.

Validation:

- Controlled adapter tests cover every assurance combination used in production.
- Crash before admission produces no subject.
- Crash after admission but before subject capture produces unknown and no duplicate launch.
- Restart with a cooperative active attempt never launches a replacement.
- Existing POSIX supervisor tests remain green.

### PR 3: Add operator recovery

**Objective:** Make unknown cooperative attempts safe and usable without inferring process state.

Likely components:

```text
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/reducer.ts
skills/autopilot/runtime/src/projection.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/src/cli.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/reducer.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
skills/autopilot/runtime/test/cli.test.ts
```

Required behavior:

- Add fenced abandon, adopt, and stop controls.
- Bind controls to the current run-lock token and exact attempt/lease identity.
- Permanently exclude unknown worktrees from later workers.
- Seal adopted tree identity before verification.
- Preserve pause-specific uncharged behavior.

Validation:

- Stale controls and stale lock tokens are rejected.
- Late results cannot overtake recovery.
- Changed tree, refs, configuration, or index invalidates adoption.
- A successfully adopted tree passes the ordinary verification, commit, and delivery boundaries.

### PR 4: Add the Pi in-process backend

**Objective:** Remove the outer `pi --print` process for Pi implementation workers while preserving exact cooperative correlation.

Before implementation, read the complete applicable Pi documentation and follow its extension API references. The first version should use the public process-local structured delegation API rather than depend on async recovery.

Likely components:

```text
skills/autopilot/runtime/adapters/pi/
skills/autopilot/runtime/src/adapters.ts
skills/autopilot/runtime/src/pi-subagents.ts
skills/autopilot/runtime/src/doctor.ts
skills/autopilot/runtime/test/pi-subagents.test.ts
skills/autopilot/runtime/test/adapter-contract.test.ts
skills/autopilot/references/adapters.md
```

Exact packaging and extension entry-point paths must follow Pi's documented package/extension conventions; do not invent a second launcher.

Required behavior:

- Invoke the runtime core from the owning Pi extension context.
- Emit a structured delegation request only after durable admission intent.
- Bind `requestId`, `ownerRunId`, and `nodeId` to the attempt identity.
- Accept at most one exact terminal response from the uninterrupted context.
- Treat reload, session replacement, Pi exit, stale context, and missing response as unknown.
- Report direct Pi fallback as a different, session-scoped execution mode.

Validation in a disposable repository:

1. normal edit and terminal response;
2. cancellation during a tool call;
3. pause racing completion;
4. Autopilot extension reload;
5. Pi session replacement;
6. whole Pi process termination;
7. loss after request emit but before child identity capture;
8. late result after unknown classification;
9. stale-context handling;
10. operator abandon, adopt, and stop.

### PR 5: Remove Windows native containment

**Objective:** Complete the binary-removal boundary after cooperative behavior is available.

Remove:

- Windows Job helper C source and native documentation;
- helper manifest discovery and Windows Job protocol code;
- helper build/copy scripts;
- protected workflow remnants;
- native helper, packaging, and Job-specific tests;
- generated native copies and declarations.

Retain:

- POSIX process-group supervision for CLI adapters;
- Windows direct live-session cancellation as a session-scoped behavior;
- fail-closed unknown handling after Windows continuity loss;
- ordinary runtime diagnostics that do not depend on native artifacts.

Validation:

- Package inventory contains no project-owned `.exe` or `.node` helper.
- Windows adapters do not advertise process-supervised restart recovery.
- Windows continuity loss deterministically becomes unknown.
- Ubuntu and Windows typecheck, lint, formatting, full tests, package smoke, and generated-artifact checks pass.

### Later provider work

Investigate each provider as a separate boundary after Pi is proven.

- Codex: version-pin a harness-owned app-server and exact thread/turn reconciliation.
- OpenCode: require exact prompt-attempt correlation and REST reconciliation around live-only events.
- Claude Code: remain session-scoped until an active execution attachment surface exists.

Do not add a provider-neutral durable-subject framework based only on hypothetical future consumers.

## Validation matrix

| Scenario | Expected result |
|---|---|
| Exact uninterrupted cooperative completion | Candidate proceeds to repository verification |
| Harness terminal response is malformed or oversized | Attempt fails; no commit or effect |
| Harness connection drops before terminal | `EXECUTION_STATE_UNKNOWN`; no replacement |
| Admission response is lost | `EXECUTION_STATE_UNKNOWN`; admission is not repeated |
| Cancellation acknowledged but terminal is missing | `EXECUTION_STATE_UNKNOWN` |
| Pause terminal cancellation wins | Nonterminal pause; attempt uncharged |
| Natural completion wins the pause race | Ordinary charge and completion handling |
| Lease or lock token changes before terminal | Late result quarantined |
| Worktree changes after terminal but before commit | Verification blocked |
| Worktree changes after accepted commit | Commit remains exact; worktree quarantined/cleanup blocked |
| Operator abandons with current fence | Old worktree quarantined; fresh worktree may be created |
| Operator adopts unchanged exact tree | Verification-only path; no worker launch |
| Operator control uses stale fence | Rejected |
| Whole harness process exits | Unknown; operator recovery required |
| Windows package smoke | No project-owned native executable or addon |

## Documentation updates

Implementation PRs must align these documents with shipped behavior:

```text
README.md
docs/prerequisites.md
skills/autopilot/README.md
skills/autopilot/SKILL.md
skills/autopilot/docs/README.md
skills/autopilot/docs/architecture.md
skills/autopilot/docs/getting-started.md
skills/autopilot/docs/implementation-plan.md
skills/autopilot/docs/runtime-cli.md
skills/autopilot/references/adapters.md
skills/autopilot/references/recovery.md
```

Use these terms consistently:

- `cooperative terminality` for exact uninterrupted harness completion;
- `process-supervised terminality` only where process-tree proof exists;
- `conversation resume` for a new execution continuing provider history;
- `active execution reattachment` only when a live exact subject is rejoined;
- `EXECUTION_STATE_UNKNOWN` for ambiguous continuity.

Do not describe provider terminal, session status, transcript persistence, PID absence, or cancellation acknowledgment as quiescence.

## Security and reliability consequences

Benefits:

- no project-owned Windows executable or native addon in the package;
- reduced antivirus, binary reputation, architecture, compiler-provenance, and quarantine exposure;
- harness integrations can use public structured APIs instead of terminal scraping;
- continuity loss remains fail-closed.

Costs:

- Windows whole-harness loss no longer has automatic process-tree recovery;
- cooperative terminality can miss an escaped background process or external side effect;
- unknown executions require operator intervention and may consume attempts;
- provider-specific integration and fault evidence are required;
- a harness terminal response is a weaker boundary than Job Object accounting.

The package and user-facing reports must expose these costs rather than presenting binary removal as equivalent assurance.

## Implementation stop conditions

Pause and revisit the design if implementation shows any of the following:

1. Pi cannot invoke the runtime core without introducing a second lifecycle writer.
2. Structured delegation can emit work before Autopilot durably records admission intent.
3. The extension cannot distinguish its original context from a replacement context.
4. A cooperative terminal response cannot be bound to the exact attempt and lease.
5. Unknown-state recovery requires reusing an uncertain worktree for another writer.
6. Backward journal readability would require rewriting canonical events.
7. Removing the helper would silently downgrade an existing packaged consumer rather than an explicitly reported capability.

## Remaining evidence gaps

- Controlled Pi process-local tests cover exact admission, cancellation, terminal-before-shutdown precedence, reload/session invalidation, lost admission, late/mismatched result rejection, direct fallback, and runtime-core completion in one reused local repository fixture. Whole-process live fault evidence remains environment-specific and does not prove OS quiescence or provider parity.
- No provider currently proves Windows process-tree quiescence through its public subagent contract.
- Codex app-server live rejoin, OpenCode disconnect reconciliation, and Claude interruption behavior were researched but not exercised for this design.
- Cooperative terminality does not prevent external effects performed by worker tools before terminal response.
- The Pi entry point follows the documented package manifest at `runtime/dist/src/pi-extension-entry.js` and registers `/autopilot-start`, `/autopilot-resume`, and `/autopilot-recover`; callers must load it through Pi's normal package or extension mechanism.
