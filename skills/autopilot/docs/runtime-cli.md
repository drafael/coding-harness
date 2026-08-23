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
autopilot [--state-dir <path>] [--json] stop [run-id]
autopilot [--state-dir <path>] [--json] review-feedback [run-id]
autopilot [--state-dir <path>] [--json] [--handoff] wrap-up [run-id]
autopilot [--json] doctor
```

The copied-skill entry point is:

```bash
node "$AUTOPILOT_CLI" COMMAND
```

`status`, `resume`, and `stop` discover unsuperseded runs for the current repository when the run ID is omitted. `review-feedback` discovers successful `change-request-ready` leaf runs and returns an immutable-input snapshot of unresolved provider feedback for skill-driven amendment compilation. `wrap-up` separately discovers successful provider-delivered leaf runs. Mutating commands proceed only for one unambiguous candidate. A unique short run-ID prefix is accepted; an ambiguous prefix returns choices without mutation.

`--json` keeps stdout machine-readable. Diagnostics and live adapter activity remain on stderr.

## State directories

Without `--state-dir`, state lives under `<git-common-dir>/autopilot`. The skill uses this default so future invocations can rediscover runs without remembered paths.

An explicit `--state-dir` relocates durable state only. It does not relocate sibling worktrees. Supply the same override for every direct command that addresses the run. Shared override directories may contain several repositories; omitted-ID discovery still filters by exact canonical repository root.

## Stop behavior

If no coordinator owns the run, `stop` acquires the run lock and records the terminal stop. If a foreground coordinator is active, `stop` writes a token-bound request inside that exact lock. The owner cancels active adapter work and records `RUN_STOPPED`; the requesting process never appends concurrently. A success recorded before the owner observes the request remains successful.

`stop` is terminal. Use `resume` only after an interrupted process left a nonterminal run. A stopped or successful run requires a sealed successor for changed work.

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
