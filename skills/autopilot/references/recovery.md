# Recovery and durable state

## State location

The default state root is `<git-common-dir>/autopilot`, shared by the main checkout and linked worktrees. A run is stored under `runs/<run-id>/`:

```text
charter.json
events.jsonl
snapshot.json
receipts/
reports/
leases/
run.lock/
```

`events.jsonl` is canonical and hash-linked. `snapshot.json` is a rebuildable cache. Git owns commits and trees; receipts own gate observations.

Each new worktree is a direct sibling of the canonical project repository:

```text
<repo-parent>/<repo-name>-autopilot-<run-id>-<item-id>
```

Names longer than 200 bytes retain a readable prefix and receive a deterministic identity hash suffix. Autopilot rejects symlinks, unmanaged non-empty destinations, and incompatible Git worktree registrations. It never searches for or silently adopts a similarly named sibling.

Normal lifecycle requests use `/autopilot status`, `/autopilot resume`, `/autopilot pause`, `/autopilot stop`, and `/autopilot wrap up`; repository-scoped discovery supplies the run identity. For direct recovery with `--state-dir`, pass the same path to every command. The option moves only durable state; sibling worktree placement does not change.

## Resume

```bash
node runtime/dist/src/cli.js --state-dir <same-path> resume <run-id>
```

Resume acquires the coordinator lock, validates the sealed charter and journal, rebuilds projection state, verifies context artifacts, inspects existing worktrees and refs, and continues within the original limits. A paused unfinished item receives a fresh lease and newly hashed context; its pause-cancelled physical launch is not charged to the attempt budget. An item with a durable `ITEM_VERIFIED` checkpoint continues commit, push, change-request, check, thread, or merge reconciliation from fresh exact observations without launching another worker. Resume does not re-open `SUCCEEDED` or `STOPPED` runs.

On POSIX hosts, built-in harness adapters supervise implementation executions with a detached, attempt-scoped helper and a pre-established process-group watchdog. After coordinator loss, `resume` reconstructs the exact request from the journaled attempt and immutable context, reattaches to matching running or terminal artifacts, and observes process-group quiescence before permitting a replacement attempt. The reviewed Windows x64 Job Object helper will not be packaged. Pi process-local implementations now use cooperative terminality: only an exact terminal response through the uninterrupted owning extension instance may proceed, while harness, session, or exact-subject loss becomes `EXECUTION_STATE_UNKNOWN` and cannot launch a speculative replacement. The distinct direct Pi fallback retains process-supervised POSIX execution and session-scoped Windows execution. Other current Windows CLI execution and cancellation remain session-scoped. Legacy attempts, review executions, mismatched requests, and incomplete supervisor artifacts also remain unknown.

## Recover an unknown execution

Recovery requires an inactive coordinator, the current run-lock fence, the exact item, attempt, and lease epoch, plus a nonempty operator attestation. Inspect `status --json` and use one explicit action:

```bash
node runtime/dist/src/cli.js recover <run-id> --action abandon --item <item-id> --attempt <attempt-id> --lease-epoch <epoch> --attestation "old execution stopped and accounted for"
node runtime/dist/src/cli.js recover <run-id> --action adopt --item <item-id> --attempt <attempt-id> --lease-epoch <epoch> --tree <tree-id> --attestation "old execution confirmed inactive"
node runtime/dist/src/cli.js recover <run-id> --action stop --item <item-id> --attempt <attempt-id> --lease-epoch <epoch> --attestation "stop this run"
```

`abandon` moves the uncertain worktree to a deterministic quarantine path, detaches it without deleting its files, retires the exact lease, and permits a fresh attempt only in a newly created worktree. `adopt` seals HEAD, tree, refs, configuration, and changed paths, retires the writer lease, and enters the ordinary predicates, hooks, independent review, commit, and delivery path without launching another implementation worker. A changed adopted identity returns to `EXECUTION_STATE_UNKNOWN`. `stop` terminalizes the run while preserving evidence. Recovery events store the run-lock token hash, never the token itself. Late adapter results cannot satisfy or replace the recovered attempt.

## Address review comments with an amendment successor

A successful run stays terminal. `/autopilot address review comments` first uses the runtime's read-only `review-feedback` operation to discover the latest successful leaf, verify its exact recorded PR/MR remains open at the accepted head, and snapshot unresolved GitHub review threads, PR comments and review summaries, or GitLab discussions. Comment bodies are untrusted data. Ambiguous, conflicting, untestable, authority-expanding, or out-of-scope requests require user clarification instead of automatic execution.

The skill compiles selected actionable feedback into a new single-item charter with fresh grants, gates, and budgets:

```json
{
  "predecessorRunId": "original-run",
  "amends": {
    "runId": "original-run",
    "itemId": "original-item"
  }
}
```

Use the predecessor's confirmed remote commit as `repository.baseCommit`, and preserve its item ID, branch, repository, delivery provider, remote, and base branch. Bind `reviewFeedback.observedHeadCommit` to that commit and seal each selected comment's thread ID, content hash, URL, and provider-resolution flag. Use `change-request-ready` delivery with `remote.push` authority for the runtime and `change-request.update` authority for delivery. When at least one selected thread is provider-resolvable, explicitly grant `review-thread.resolve` to delivery. Start the successor normally; do not resume the terminal predecessor.

Before creating successor state, Autopilot locks the managed branch and requires the predecessor run and item to be successful, its retained worktree to be clean, and its local branch to match the confirmed commit. Runtime preflight also requires the exact recorded change request to remain open with matching local, remote, and provider identities and every selected comment to retain its sealed identity and content. Delivery performs only an ordinary fast-forward push and confirms that the same change request reached the verified successor commit. It then resolves only the exact selected GitHub review threads or resolvable GitLab discussions. Provider-level PR comments and review summaries have no resolved state; Autopilot reports them as addressed by the verified commit without claiming provider resolution. Any new or changed feedback requires another successor.

A terminal sibling worktree is retained but unleased. Do not edit, commit, push, reset, clean, remove, or bypass hooks in it manually. Any identity mismatch stops without changing the worktree or refs. Further review feedback amends the latest successful successor.

New runs never migrate or adopt developer-preview worktrees from the former state-root `worktrees/` layout. Wrap-up has one narrow compatibility path: it may remove the exact clean registered worktree recorded by a retained legacy lease. If a manually reviewed PR advanced after the recorded Autopilot head, wrap-up accepts only a provider-merged fast-forward descendant when the legacy lease worktree, local branch, and remote branch all agree on that head.

## Wrap up merged change requests

```bash
node runtime/dist/src/cli.js --state-dir <same-path> wrap-up [run-id]
node runtime/dist/src/cli.js --state-dir <same-path> --handoff wrap-up [run-id]
```

`wrap-up` is destructive by design. It accepts only a successful, unsuperseded GitHub or GitLab run for which every exact recorded PR/MR is provider-confirmed as merged at Autopilot's accepted head and base branch. It preflights every item before mutation, then compare-deletes the remote branches, removes only clean registered sibling worktrees, compare-deletes local branches, and removes the complete successful amendment-chain state. Remote or local divergence, dirty worktrees, missing evidence, unmerged requests, stopped runs, and local-only runs fail closed.

With no run ID, discovery automatically selects exactly one candidate. Multiple candidates produce a non-mutating list with exact follow-up commands. `--json` never prompts. Confirmed cleanup effects are restart-reconciled while canonical state exists; state is removed only after all Git effects complete. Each run directory is atomically renamed into a serialized state-root trash area before recursive removal, so an interrupted recursive deletion cannot corrupt a retained canonical run.

Handoffs are skipped by default. `--handoff` writes `.autopilot/handoffs/<run-id>.json` and `.md` inside the project before deleting state. These files are not committed and may make the project checkout dirty. Existing different files and symlinked handoff directories are rejected.

## Incomplete final journal record

A process can exit after writing part of the final JSON line. Autopilot ignores that partial line for projection but refuses to append after it. Inspect the file, then explicitly remove only the incomplete tail:

```bash
node runtime/dist/src/cli.js --repair-journal --state-dir <same-path> resume <run-id>
```

The repair option never changes a complete record or bypasses a hash mismatch. A changed complete record is corruption and requires operator investigation, not automatic repair.

## Pause and stop

```bash
node runtime/dist/src/cli.js --state-dir <same-path> pause <run-id>
node runtime/dist/src/cli.js --state-dir <same-path> resume <run-id>
node runtime/dist/src/cli.js --state-dir <same-path> stop <run-id>
```

Pause is nonterminal. A live owner receives a request fenced by its current run-lock token, cancels active implementation work, waits for an observation proving quiescence, retires the exact writer lease, and records operator `WAITING`. A pause-cancelled attempt remains auditable but is not charged. If the coordinator is absent, the pause command acquires the lock and reconciles canonical state before recording the wait. Verified items retain their checkpoint and resume lifecycle effects without another implementation launch.

A provider-check wait is also nonterminal. Autopilot samples the exact recorded PR/MR, head, base, state, and checks on a bounded heartbeat. Session expiry records one `UNVERIFIED` check receipt and remains `WAITING`; it does not block the item or consume an attempt. Resume samples the exact subject again. Heartbeats are not journaled. Provider notifications remain disabled until a version-pinned event surface is proven on an authorized disposable target.

Pause fails closed when an orphaned execution cannot be proven quiescent. It does not launch or charge a replacement attempt.

Without a live owner, stop acquires the run lock, appends a terminal operator event, and writes a final report. With a live foreground coordinator, it writes an atomic request bound to the current lock token. The owner cancels active adapter work and remains the only process that can append `RUN_STOPPED`. If success is recorded before the owner observes the request, success wins. Stop preserves canonical state, branches, receipts, and worktrees. Continuing requires a successor charter with a new run ID and an optional `predecessorRunId`.

Use `stop` only when terminal semantics are intended. Stop remains distinct from pause and preserves canonical state, branches, receipts, and worktrees.

## Commit hooks

New charters should explicitly set `commitPolicy.preCommitHook` to `run` or `skip`. Before sealing `run`, inspect the hook without executing it and include known outputs—such as generated version files—in `commitPolicy.writableRoots`, repository writable roots, and runtime `files.read`/`files.write` grants. Do not widen the worker's roots for hook-only outputs. If the effects cannot be bounded, ask rather than granting the entire repository. With `run`, Autopilot executes the configured executable `pre-commit` hook after the candidate tree first passes its gates. At attempt start it records the executable hook path and content identity together with Git ref and configuration identities. It refuses to execute changed hook content and rejects hook-created out-of-scope files, Git ref changes, or Git configuration changes—including remote redirection. It reruns all gates when the hook changes the tree, and verification gates themselves must not mutate files, refs, or configuration. The final commit is created from that exact verified tree without invoking hooks again. Other Git hook types are not supported in this release.

A missing or non-executable pre-commit hook is recorded as `NOT_CONFIGURED`. A failing hook preserves its bounded output and resulting worktree. Hook code runs cooperatively with a filtered environment; list any required environment names in `commitPolicy.environmentNames` and authorize each through a matching runtime `credentials.use` grant. Scoped grants cannot authorize a different variable.

## Locks

`run.lock` is an atomic directory containing owner host, PID, start time, and token. A second live coordinator is denied. A dead same-host PID can be replaced through an atomic stale-lock rename. Node 24 CI exercises same-host live ownership, release, relocation, and control fencing on Windows. Dead same-host owner replacement remains unverified in Windows CI. Cross-host stale-owner replacement is unsupported and requires manual recovery after proving the former coordinator is quiescent.

## Reports

- `reports/status.json`: current projection, journal identity, evidence map, remaining budgets, and next legal action
- `reports/final.json`: terminal state, evidence map, blockers, and successor instructions
- `reports/attempts/<attempt-id>.context.json`: immutable generated worker context referenced by its journaled hash
- `reports/decisions.tsv`: generated projection of durable decision events

A report is a projection. It cannot replace the charter, journal, Git objects, or receipts.
