# Runtime CLI reference

The Autopilot skill is the normal user interface. Use the bundled CLI directly only for maintainer work, automation, explicit state-directory overrides, or recovery that the skill cannot complete.

Run it from the target repository so project-scoped discovery uses the correct Git common directory:

```bash
export AUTOPILOT_CLI="/path/to/autopilot/runtime/dist/src/cli.js"
node "$AUTOPILOT_CLI" --help
```

## Commands

```text
autopilot [--state-dir <path>] [--json] start <charter-file>
autopilot [--state-dir <path>] [--json] status [run-id]
autopilot [--state-dir <path>] [--json] [--repair-journal] resume [run-id]
autopilot [--state-dir <path>] [--json] pause [run-id]
autopilot [--state-dir <path>] [--json] stop [run-id]
autopilot [--state-dir <path>] [--json] recover <run-id> --action <abandon|adopt|stop> --item <id> --attempt <id> --lease-epoch <n> --attestation <text> [--tree <tree>]
autopilot [--state-dir <path>] [--json] review-feedback [run-id]
autopilot [--state-dir <path>] [--json] [--handoff] wrap-up [run-id]
autopilot [--json] doctor
```

The copied-skill entry point is:

```bash
node "$AUTOPILOT_CLI" COMMAND
```

When the packaged runtime is loaded as a Pi extension, it also registers:

```text
/autopilot-start <charter-file>
/autopilot-resume [run-id]
/autopilot-recover <run-id> <recovery-request-json>
```

These commands invoke the same coordinator in the owning Pi process. They select process-local structured delegation only when a compatible installed `pi-subagents` owner answers the process-local probe; otherwise they report the distinct direct Pi CLI fallback before admission.

`status` returns the journal identity, last durable milestone, per-predicate evidence map, remaining budgets, and next legal action without rewriting coordinator-owned reports. Plain output is concise and omits state/worktree paths and full run IDs; `--json` returns the complete machine-readable report. `status`, `resume`, `pause`, and `stop` discover unsuperseded runs for the current repository when the run ID is omitted. `review-feedback` discovers successful `change-request-ready` leaf runs and returns an immutable-input snapshot of unresolved provider feedback for skill-driven amendment compilation. `wrap-up` separately discovers successful provider-delivered leaf runs. Mutating commands proceed only for one unambiguous candidate. A unique short run-ID prefix is accepted; an ambiguous prefix returns choices without mutation.

`--json` keeps stdout machine-readable. Diagnostics and live adapter activity remain on stderr.

## State directories

Without `--state-dir`, state lives under `<git-common-dir>/autopilot`. The skill uses this default so future invocations can rediscover runs without remembered paths.

An explicit `--state-dir` relocates durable state only. It does not relocate sibling worktrees. Supply the same override for every direct command that addresses the run. Shared override directories may contain several repositories; omitted-ID discovery still filters by exact canonical repository root.

## Pause and stop behavior

If no coordinator owns the run, `pause` acquires the run lock and reconciles the request. If a foreground coordinator is active, it writes a token-bound request inside that exact lock. The owner cancels active implementation work, waits for adapter observation to prove quiescence, retires only the matching writer lease, records `ATTEMPT_PAUSED`, and enters `WAITING` with `kind: operator-pause`. The requesting process never appends concurrently. An attempt cancelled solely by pause remains in the physical launch history but is excluded from the consumed-attempt budget. `resume` leaves the waiting state and creates a fresh attempt only when implementation was not already verified.

If no coordinator owns the run, `stop` acquires the run lock and records the terminal stop. If a foreground coordinator is active, `stop` uses the same fenced request path. The owner cancels active adapter work and records `RUN_STOPPED`. A success recorded before either request wins remains successful.

`recover` requires an inactive coordinator and the exact current unknown item, attempt, and lease epoch. Every action records the owning run-lock token hash and explicit operator attestation. `abandon` permanently moves the uncertain worktree aside before a fresh attempt; `adopt` requires the exact freshly observed `--tree` and runs verification without an implementation launch; `stop` preserves the evidence and terminalizes the run.

`stop` is terminal. A stopped or successful run requires a sealed successor for changed work. On supported POSIX hosts, built-in adapters reattach supervised implementation executions after coordinator loss and wait for terminal process-tree evidence before retrying. Autopilot packages no Windows native containment helper: direct Windows CLI executions are session-scoped, and continuity loss records `EXECUTION_STATE_UNKNOWN` without a replacement launch. Legacy attempts, review executions, and incomplete or mismatched supervisor artifacts fail closed the same way.

## Journal repair

Use `--repair-journal` only after inspecting an incomplete final journal record:

```bash
node "$AUTOPILOT_CLI" --repair-journal resume RUN_ID
```

Repair occurs under the run lock. It removes only an incomplete final record; it does not rewrite complete history or make terminal runs resumable.

## Build and verify

The committed `runtime/dist/` directory is the launch artifact and has no production dependency on `node_modules`.

```bash
cd "/path/to/autopilot/runtime"
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```
