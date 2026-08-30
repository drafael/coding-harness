# Harness-agnostic Autopilot implementation plan

- **Status:** Developer-preview implementation available; Windows runtime support and POSIX attempt-scoped implementation reattachment are packaged, while provider notification wake is explicitly not promoted under the current no-receiver constraint, and restack plus broader cross-platform fault-injection acceptance remain pending
- **Date:** 2026-08-22
- **Audience:** Autopilot implementers and reviewers
- **Governing design:** [Autopilot architecture](architecture.md)
- **Decision record:** [Use a durable event engine with explicit authority](adr/0001-durable-event-engine.md)

## Objective

Implement the approved Autopilot design as a bundled TypeScript skill and Node.js CLI. The implementation must prove one lifecycle path at a time, beginning with a local single-objective run and ending with optional GitHub and GitLab delivery.

The plan is a dependency-ordered hypothesis. If implementation evidence disproves an interface or platform assumption, update the design and this plan before widening the code.

## Required behavior

The completed first release must:

- Compile a harness-proposed charter into a validated immutable charter.
- Store canonical state under the Git common directory by default, with `--state-dir` override.
- Resume by replaying the journal and reconciling Git and external effects.
- Run a single objective, an independent queue, and an ordered stack.
- Invoke Claude Code, Codex, Pi, and OpenCode through conforming adapters.
- Execute verification in the runtime and bind receipts to exact code identities.
- Support local commits, change-request-ready delivery, and explicitly authorized merge.
- Support GitHub pull requests and GitLab merge requests through separate delivery adapters.
- Apply configurable branch templates and detect collisions before launch.
- Stop durably without weakening predicates or inventing waivers.

## Constraints

- Use TypeScript with strict compiler settings and ECMAScript modules.
- Target Node.js 24 or newer for the initial distribution.
- Use npm and a package-local `package-lock.json`; do not create a repository-root lockfile.
- Keep one lifecycle engine. Do not add a Python implementation.
- Do not add a daemon, database, generic scheduler, deployment support, force-push support, destructive resets or cleans, branch deletion, or removal of dirty worktrees.
- Keep harness and delivery adapters outside reducer and journal ownership.
- Prefer Node built-ins and small direct modules. Evaluate any production dependency before adding it.
- Never auto-install tools, download runtimes, or alter user authentication.

## Developer-preview evidence

The implementation currently has 155 Node test cases and a clean-copy package smoke test. Generated attempt context, predicate-to-evidence reports, exact-tree independent review, intentional pause, and exact-subject provider waiting have controlled coverage. Disposable exact-tree review runs passed with Pi 0.84.4 through pi-subagents 0.60.0, Codex 0.151.0, and OpenCode 1.18.25. Claude Code 2.1.251 reached its adapter but reported no usable noninteractive credential source, so its edit and review flows remain unverified. The same suite passes in Node 24 CI on Ubuntu and Windows; Windows coverage includes locking, atomic writes, Git worktrees and governed hooks, provider fixtures, cancellation, and descendant process-tree termination. An authorized GitHub wrap-up was exercised against merged chat4j PR #69. Authorized private GitHub project `drafael/autopilot-amendment-validation` PR #1 exercised immutable feedback capture, exact-head successor adoption, fast-forward update, exact thread resolution, merge, and amendment-chain wrap-up with `gh` 2.98.0. Authorized private GitLab project `drafael/autopilot-amendment-validation` MR !2 exercised the equivalent complete amendment workflow with `glab` 1.115.0.

## Planned package boundary

Create one independent package at:

```text
skills/autopilot/runtime/
```

The package will own its compiler configuration, dependencies, scripts, tests, and build output. The surrounding `skills/autopilot/` directory will own the skill and human-readable playbooks. The installed release artifact must run without installing dependencies at launch; its compiled output may use Node built-ins or dependencies bundled into the artifact.

The implementation uses focused handwritten runtime validators, Node's built-in argument parser, and zero production dependencies. TypeScript validators are authoritative; published JSON Schemas document interchange. This keeps the committed `dist/` artifact runnable without `node_modules`.

## Phase 1: Establish contracts and the pure reducer

### Files

Create:

```text
skills/autopilot/SKILL.md
skills/autopilot/runtime/package.json
skills/autopilot/runtime/package-lock.json
skills/autopilot/runtime/tsconfig.json
skills/autopilot/runtime/src/charter.ts
skills/autopilot/runtime/src/events.ts
skills/autopilot/runtime/src/reducer.ts
skills/autopilot/runtime/src/policy.ts
skills/autopilot/runtime/schemas/charter.schema.json
skills/autopilot/runtime/schemas/adapter.schema.json
skills/autopilot/runtime/test/charter.test.ts
skills/autopilot/runtime/test/reducer.test.ts
skills/autopilot/runtime/test/policy.test.ts
skills/autopilot/runtime/test/fixtures/
```

### Work

1. Define versioned charter, event, work-item, attempt, grant, gate, waiver, predicate, and capability types.
2. Parse every external value from `unknown`; do not rely on TypeScript types at runtime boundaries.
3. Validate concise work-item titles, work-graph dependencies, branch-name uniqueness, grant constraints, and immutable charter hashing.
4. Implement the pure run and item reducer with an explicit transition table.
5. Implement the policy intersection:

   ```text
   playbook request AND charter grant AND adapter capability
   ```

6. Add stable error codes for malformed charters, illegal transitions, denied effects, and unsupported capabilities.

### Acceptance evidence

- Golden fixtures cover the three approved caller examples.
- Multiline or oversized titles, invalid graphs, duplicate branches, missing predicates, unknown grants, and malformed waivers fail deterministically.
- Property or generated transition tests show that terminal states cannot return to active states.
- `SUCCEEDED` cannot be emitted directly by an adapter event.
- No file, process, Git, network, or provider effect is present in this phase.

## Phase 2: Add the journal, projection, lock, and CLI shell

### Files

Create:

```text
skills/autopilot/runtime/src/journal.ts
skills/autopilot/runtime/src/projection.ts
skills/autopilot/runtime/src/lock.ts
skills/autopilot/runtime/src/state-path.ts
skills/autopilot/runtime/src/run-discovery.ts
skills/autopilot/runtime/src/cli.ts
skills/autopilot/runtime/test/journal.test.ts
skills/autopilot/runtime/test/lock.test.ts
skills/autopilot/runtime/test/state-path.test.ts
skills/autopilot/runtime/test/run-discovery.test.ts
skills/autopilot/runtime/test/cli.test.ts
```

### Work

1. Resolve the default state path from `git rev-parse --git-common-dir` and support `--state-dir`.
2. Append hash-linked journal records with sequence and previous-record checks.
3. Write snapshots through temporary-file, flush, and atomic-replace semantics.
4. Rebuild projections from the charter and journal; treat snapshots only as caches.
5. Implement a single-coordinator run lock with stale-owner detection appropriate to each supported platform.
6. Add `start`, `status`, `resume`, and `stop` command shells without work execution; every command that addresses a run must accept the same `--state-dir` override.
7. Discover omitted run IDs from exact repository identity, collapse amendment chains to leaves, and refuse ambiguous or corrupt automatic mutation.
8. Fence active stop requests with the current run-lock token so only the owning coordinator writes lifecycle events.
9. Set user-only permissions on run directories and files where the platform supports them.

### Acceptance evidence

- Main checkout and linked worktree resolve the same default run directory.
- `--state-dir` isolates state without changing charter semantics or sibling worktree placement.
- Truncated final journal records are detected and handled without accepting partial events.
- Corrupt snapshots are discarded and rebuilt from valid journal records.
- Two coordinators cannot own one run concurrently.
- Status, resume, and stop need no run ID when one eligible project run is unambiguous.
- Active stop cancels adapter work through the owner; stale-token requests cannot affect a replacement coordinator.
- Process interruption before and after append, flush, and rename leaves a recoverable state.
- Node 24 Windows CI exercises lock fencing, interrupted-state handling, atomic replacement, and process-tree cancellation; sudden-power-loss directory metadata persistence remains platform-dependent.

## Phase 3: Prove the local single-objective loop

### Files

Create:

```text
skills/autopilot/runtime/src/repository.ts
skills/autopilot/runtime/src/leases.ts
skills/autopilot/runtime/src/evidence.ts
skills/autopilot/runtime/src/done.ts
skills/autopilot/runtime/src/engine.ts
skills/autopilot/runtime/src/report.ts
skills/autopilot/runtime/test/repository.test.ts
skills/autopilot/runtime/test/evidence.test.ts
skills/autopilot/runtime/test/engine.test.ts
skills/autopilot/runtime/test/fault-injection.test.ts
```

### Work

1. Create deterministic branches and direct sibling worktrees from an immutable base commit. Use readable bounded directory names with deterministic hash suffixes when necessary; reject symlinks and unmanaged non-empty destinations.
2. Acquire one versioned writer lease per worktree and branch and require its exact canonical sibling path during resume.
3. Record operation intent before commit or other runtime-owned effects.
4. Inspect pre- and post-attempt HEAD, tree, status, and changed paths.
5. Run verification with executable and argument arrays in a constrained environment.
6. Store content-addressed receipts keyed by code identity, gate hash, and relevant environment identity.
7. Commit accepted work with Autopilot trailers when `git.commit` is granted.
8. Reconcile a commit that succeeded before its confirmation event was written.
9. Implement `DoneEvaluator` and durable `STOPPED` reports.
10. Preserve dirty or blocked worktrees; remove only clean terminal worktrees after retention policy permits it.

Use a deterministic fake worker in this phase. Do not involve a real coding harness yet.

### Acceptance evidence

- A temporary repository completes a synthetic no-old-callers migration through a fake worker.
- A changed tree invalidates earlier verification receipts.
- Out-of-scope edits, unexpected commits, stale leases, and denied commits stop or quarantine work as designed.
- Re-running reconciliation does not duplicate branches, worktrees, or commits.
- Killing the process before and after worktree creation, verification, commit, and confirmation produces one coherent final history.
- Reports distinguish `PASSED`, `FAILED`, `WAIVED`, and `UNVERIFIED`.

## Phase 4: Define the adapter protocol and implement Pi first

### Files

Create:

```text
skills/autopilot/runtime/src/adapter-protocol.ts
skills/autopilot/runtime/src/adapter-process.ts
skills/autopilot/runtime/src/pi-subagents.ts
skills/autopilot/runtime/adapters/pi/
skills/autopilot/runtime/test/adapter-contract.test.ts
skills/autopilot/runtime/test/fixtures/adapter-events/
```

### Work

1. Define versioned JSONL messages for capability description, launch, observation, cancellation, wake events, and terminal outcomes.
2. Reject unknown protocol versions and malformed messages.
3. Bound line size, retained output, deadlines, and subprocess lifetime.
4. Forward cancellation to the complete process group where the platform supports it.
5. Implement the Pi adapter against Pi's public JSON-mode CLI, preferring the installed `pi-subagents` 0.53.0+ structured delegation API and retaining a direct-worker fallback.
6. Project bounded delegated-worker activity to stderr so JSON stdout remains machine-readable.
7. Report whether restrictions are enforced or cooperative.
8. Run each attempt in a fresh session with only item-scoped context.
9. Build an adapter conformance suite that does not depend on Pi-specific event names.

### Acceptance evidence

- Recorded Pi event fixtures pass protocol parsing and lifecycle conformance.
- Duplicate, reordered, truncated, oversized, and malicious event lines cannot advance state.
- A silent adapter triggers the idle deadline and bounded recovery path.
- A late Pi result with an expired lease is quarantined.
- One disposable local fixture completes through the real Pi adapter.
- A compatible `pi-subagents` fixture proves structured delegation, terminal-result validation, direct fallback behavior, and visible activity without allowing child output to claim completion.
- The fixture records the exact Pi and `pi-subagents` versions and exercised boundary; support remains unverified until that real end-to-end fixture passes.

## Phase 5: Add Claude Code, Codex, and OpenCode adapters

### Files

Create:

```text
skills/autopilot/runtime/adapters/claude-code/
skills/autopilot/runtime/adapters/codex/
skills/autopilot/runtime/adapters/opencode/
skills/autopilot/runtime/test/adapter-compatibility.test.ts
```

### Work

1. Probe each CLI version and noninteractive execution surface.
2. Translate native event streams into the shared protocol without treating model markers as evidence.
3. Map cancellation, restart reattachment, useful concurrency, and enforcement level honestly.
4. Preserve provider stderr for diagnostics without allowing stderr text to emit lifecycle outcomes.
5. Add adapter-specific fixtures and one disposable end-to-end run per harness.
6. Keep model names and reasoning levels in adapter configuration rather than core types.

### Acceptance evidence

- The same synthetic charter produces equivalent normalized directives, journal transitions, and receipt classes through all four adapters.
- Missing or old harness versions fail preflight with setup guidance.
- An adapter that cannot preserve background execution reports that limitation.
- Same-model review limitations appear in capability or report metadata rather than being hidden.
- Cross-harness integration claims remain limited to versions actually exercised.

## Phase 6: Add independent queues and ordered stacks

### Files

Create:

```text
skills/autopilot/runtime/src/playbooks.ts
skills/autopilot/runtime/src/frontier.ts
skills/autopilot/runtime/src/branch-template.ts
skills/autopilot/runtime/test/queue.test.ts
skills/autopilot/runtime/test/stack.test.ts
skills/autopilot/runtime/test/branch-template.test.ts
```

### Work

1. Compile single, queue, and stack charters into deterministic work graphs.
2. Add bounded parallel leases for independent queue items.
3. Keep one serialized topology lease for stack parentage and restacks.
4. Implement branch-template precedence:

   ```text
   invocation > project > user > bundled default
   ```

5. Support `{run}`, `{run-short}`, `{item}`, `{item-slug}`, `{ticket}`, and `{date}`.
6. Validate names with Git, detect local and remote collisions, and store resolved names in the charter.
7. Invalidate affected receipts when stack commits are rewritten.
8. Preserve successful siblings when one queue item fails.

### Acceptance evidence

- Queue workers never share a branch or worktree writer lease.
- Serial fallback produces the same accepted results when an adapter lacks parallel execution.
- A blocked queue item does not stop unrelated items unless the charter is all-or-nothing.
- Stack descendants cannot advance past an unsatisfied predecessor.
- Only the topology owner can reparent or restack branches.
- Branch collisions stop before edits; Autopilot never invents an unrecorded suffix.

## Phase 7: Add GitHub and GitLab delivery

### Files

Create:

```text
skills/autopilot/runtime/src/delivery.ts
skills/autopilot/runtime/delivery/github/
skills/autopilot/runtime/delivery/gitlab/
skills/autopilot/runtime/test/delivery-contract.test.ts
skills/autopilot/runtime/test/github-delivery.test.ts
skills/autopilot/runtime/test/gitlab-delivery.test.ts
```

### Work

1. Define provider-neutral change-request, check, approval, merge, and stack-topology observations.
2. Implement GitHub through a selected public API or `gh` subprocess boundary.
3. Implement GitLab through a selected public API or `glab` subprocess boundary.
4. Keep credentials in adapter-owned environments and redact provider output.
5. Discover existing change requests by stable run and item markers before creation.
6. Require expected local and remote commits for push and merge.
7. Bind remote checks and independent reviews to the current head commit.
8. Implement contiguous verified landing for stacks.
9. Map GitLab pipelines, jobs, approvals, and merge-train behavior through capabilities.
10. Exercise launch-time CI waivers without converting them into passes.

### Acceptance evidence

- Reconciliation does not duplicate a pull request or merge request after process interruption.
- A changed remote head invalidates its verdict and blocks merge.
- Missing merge authority stops before the merge call.
- Unknown CI failures remain failures.
- A named waiver applies only to its configured gate and failure signature.
- A stack lands only through its contiguous verified prefix.
- All external mutation tests use disposable repositories. Organization-specific approval and merge policies remain unverified.

## Phase 8: Complete the skill, playbooks, doctor, and packaging

### Files

Create or complete:

```text
skills/autopilot/SKILL.md
skills/autopilot/playbooks/single-objective.md
skills/autopilot/playbooks/independent-queue.md
skills/autopilot/playbooks/ordered-stack.md
skills/autopilot/references/charter.md
skills/autopilot/references/adapters.md
skills/autopilot/references/recovery.md
skills/autopilot/runtime/src/doctor.ts
skills/autopilot/README.md
```

Update only if needed for discoverability:

```text
README.md
docs/prerequisites.md
```

### Work

1. Document explicit `/autopilot` invocation with a natural-language objective and charter compilation for each harness.
2. Keep playbooks consistent with executable router behavior through conformance fixtures.
3. Implement `autopilot doctor` without installation or authentication side effects.
4. Document Node.js 24+, Git, harness, GitHub, and GitLab prerequisites.
5. Document foreground execution, supported background mechanisms, resume, stop, state retention, and `--state-dir`.
6. Generate JSON Schemas and TypeScript declarations from one source where practical.
7. Produce compiled JavaScript during package build; do not install dependencies at launch.
8. Verify the installed skill runs from a clean copy without `node_modules` or undeclared external imports.
9. Defer standalone executable packaging until a separate proof selects Node SEA, Bun compilation, or another mechanism.

### Acceptance evidence

- Every documented command matches the implemented CLI.
- Local links and examples validate.
- Doctor reports missing capabilities without mutating the host.
- A cold-start reviewer can locate the charter, journal, receipts, decision projection, final report, and resume command.
- Installation and adapter documentation distinguish verified support from planned or untested support.
- The packaged `dist` CLI starts and runs `doctor` from a clean skill copy without `node_modules`.

## Phase 9: Add successful change-request amendments and hook finalization

### Work

1. Add an explicit single-item `amends` charter contract while keeping predecessor runs terminal and immutable.
2. Adopt only a clean, exact retained worktree under a shared branch-ownership lock.
3. Reconcile predecessor journal evidence with local, remote, and exact open change-request identity.
4. Update the existing head through an ordinary fast-forward push with no force or cleanup fallback.
5. Add an explicit pre-commit policy, run the configured hook once, reject path or ref violations, and reverify changed trees.
6. Preserve schema-version-1 charters without a commit policy as explicit compatibility behavior equivalent to skipping the hook.

### Acceptance evidence

- Controlled repository and provider fixtures prove exact worktree adoption and same-change-request updates.
- Dirty worktrees, unmanaged commits, changed heads, closed requests, and concurrent adopters fail closed.
- The predecessor journal remains byte-for-byte unchanged.
- Hook-created allowed files are included in the verified commit; changed hook content, out-of-scope files, ref changes, Git configuration changes, mutating gates, and unauthorized environment names are denied.
- Interrupted commit confirmation and post-push provider failures reconcile without weakening branch identity.
- Authorized private disposable-provider runs passed complete GitHub PR #1 and GitLab MR !2 amendment mutation, exact selected-thread resolution, and exact-head merge.

## Phase 10: Add merged-run wrap-up

### Work

1. Add optional-run-ID discovery that selects one unambiguous successful leaf or lists candidates without mutation.
2. Live-confirm every recorded GitHub PR or GitLab MR as merged at the accepted Autopilot head and base branch.
3. Preflight every item before compare-deleting remote branches, removing clean registered sibling worktrees, and compare-deleting local branches.
4. Reconcile interrupted cleanup effects and delete the complete successful amendment-chain state only after all Git effects finish.
5. Skip handoff creation by default; with `--handoff`, write non-overwriting Markdown and JSON summaries under `.autopilot/handoffs/` before deleting state.

### Acceptance evidence

- Controlled GitHub and GitLab provider fixtures prove merged-head checks and guarded cleanup.
- Open requests, dirty worktrees, changed heads, superseded runs, local-only runs, and ambiguous discovery fail without deletion.
- Amendment wrap-up removes the validated predecessor chain only from the latest successful successor.
- A legacy lease-path fixture proves cleanup of a provider-merged fast-forward descendant, and chat4j PR #69 provided an authorized real GitHub cleanup result.
- Authorized private GitHub PR #1 and GitLab MR !2 amendment-chain wrap-up removed the exact remote branch, retained worktree, local branch, and predecessor state.

## Planned package checks

After Phase 1 creates the package scripts, each implementation phase should run the smallest applicable subset before the full package checks:

```bash
cd skills/autopilot/runtime
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

These commands are implemented as non-mutating checks. `npm test` and `npm run build` recreate the tracked `dist/` launch artifact; reviewers should inspect any resulting diff.

Validation must not auto-fix lint, rewrite formatting, update snapshots, install browsers, authenticate providers, create remote repositories, open change requests, push, or merge unless the specific integration test has an approved disposable target and explicit authority.

## Cross-cutting test matrix

Exercise these boundaries throughout implementation:

| Boundary | Required cases |
|---|---|
| Charter | malformed input, ambiguous authority, graph cycle, duplicate branch, invalid waiver |
| Reducer | illegal transition, stale attempt, terminal-state immutability, duplicate event |
| Journal | partial append, corrupt hash, corrupt snapshot, lock contention, process death |
| Git | dirty base, linked worktree, duplicate resume, changed HEAD, remote divergence, amendment fast-forward |
| Verification | failed command, stale receipt, environment change, waived gate, unverified probe, pre-commit tree rewrite |
| Amendment | exact predecessor, dirty retained worktree, ownership contention, changed PR head, immutable predecessor journal |
| Wrap-up | unique discovery, ambiguous selection, merged-head proof, dirty worktree, guarded branch deletion, amendment-chain cleanup, optional handoff |
| Adapter | malformed JSONL, timeout, cancellation, lost process, duplicate wake, late result |
| Queue | partial failure, serial degradation, lease expiry, successful sibling preservation |
| Stack | parent failure, restack rewrite, receipt invalidation, contiguous landing ceiling |
| GitHub | duplicate PR discovery, changed head, failed check, merge confirmation |
| GitLab | duplicate MR discovery, pipeline failure, approval rule, merge-train capability |
| Security | path escape, symlink escape, command injection, secret redaction, denied effect |

## Rollout sequence

1. **Developer preview:** fake adapter and temporary Git repositories only.
2. **Local alpha:** Pi adapter, single-objective mode, local commits, no remote delivery.
3. **Harness beta:** all four harness adapters, queue and local stack preparation.
4. **Delivery beta:** change-request-ready behavior in disposable GitHub and GitLab repositories.
5. **Merge preview:** explicit `merge.execute` grants with current-head receipts and provider confirmation.
6. **Stable release:** only after crash recovery and adapter conformance pass on supported operating systems and declared harness versions.

## Residual risks and unverified boundaries

The implementation cannot claim full portability until it has exercised:

- Process-group cancellation and file locking on macOS, Linux, and Windows.
- Real JSON event behavior for supported Claude Code, Codex, Pi, and OpenCode versions.
- GitHub and GitLab authentication, approval, queue, and stack behavior in disposable repositories.
- Recovery from process death around each supported external effect.
- Cooperative versus enforced restriction behavior for each harness and sandbox.
- Future standalone executable packaging.

A unit test proves only its local boundary. A mocked provider does not prove provider integration, and a disposable repository does not prove an organization's policy configuration.

## Completion criteria for implementation

The implementation is complete when:

- All required phases above are implemented or explicitly removed through an approved design revision.
- The package checks pass without modifying tracked source.
- Fault-injection and adapter conformance suites pass.
- The three caller examples compile into sealed charters and reach either verified success or a correct durable stop.
- GitHub and GitLab delivery are verified against disposable repositories.
- Documentation identifies every unverified platform, harness version, and provider boundary.
- The final diff contains no unused adapters, speculative extension points, duplicate lifecycle path, or dependency without a current consumer.
