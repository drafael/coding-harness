# ADR 0002: Use cooperative harness execution on Windows

- **Status:** Accepted
- **Date:** 2026-08-31
- **Related:** [Architecture](../architecture.md), [cooperative harness execution plan](../2026-08-31-cooperative-harness-execution-plan.md), [ADR 0001](0001-durable-event-engine.md)

## Context

Autopilot needs a trustworthy boundary around implementation workers. On POSIX hosts, the runtime can own a detached process group and prove terminality before replacing a worker. Windows does not expose equivalent Job Object ownership through the Node.js 24 public API.

A source-controlled C broker was implemented to fill that gap. It creates the harness suspended, assigns it to an unnamed Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, resumes it only after assignment, and exposes authenticated query and termination through a named pipe. A protected Windows workflow built the helper reproducibly and passed the real cancellation, deadline, broker-death, restart, privacy, and packaging suites. Run `33353702353` produced reviewed x64 executable SHA-256 `e9017028a38c8e564aa7b73541dd1996e5b5ddf8075a7c136e06b5d55c7effef`.

The artifact met the technical containment contract, but shipping a custom native executable creates a different operational risk. Unsigned, low-reputation executables that create suspended processes, manage process trees, and host control pipes may be quarantined or flagged by antivirus and endpoint security products. A native Node addon would still be a project-owned PE binary. PowerShell P/Invoke would add runtime compilation and policy variability. Node 26's FFI is experimental and outside the Node 24 baseline.

Current harness subagent and server APIs provide useful logical identities and cancellation, but none reviewed here proves Windows OS process-tree quiescence. Pi structured delegation is process-local. Claude session resume starts or reconstructs execution. Codex app-server can rejoin a live turn while the same server survives, but interrupted turns may retain background terminals. OpenCode session abort is cooperative for arbitrary tools.

The project must choose between shipping the native helper and accepting a weaker, explicit harness terminality boundary.

## Decision

Autopilot will not package the reviewed Windows Job Object executable or replace it with another project-owned native binary.

Windows harness-managed implementations will use **cooperative terminality** when a version-pinned integration is available. Autopilot accepts a terminal result only while the exact harness connection that admitted the exact attempt remains authoritative. The result must match the run, item, attempt, lease epoch, context hash, and harness subject identity, and the runtime must revalidate repository identity and authorized changes before verification, commit, or delivery.

Cooperative terminality does not claim that every OS descendant has exited. Connection loss, extension reload with lost identity, session replacement, harness-process exit, missing terminal response, ambiguous cancellation, or backend identity change produces nonterminal `EXECUTION_STATE_UNKNOWN`. Autopilot preserves the worktree and evidence, launches no replacement, and requires fenced operator recovery.

The implementation will distinguish execution ownership, continuity, admission idempotency, and terminal assurance instead of treating `restartReattachment` as one Boolean. A cooperative subject cannot use `reattach() ?? launch()` unless that integration later proves an explicit idempotent get-or-create contract.

The runtime remains the sole lifecycle writer. Harnesses admit workers and return observations; workers edit only authorized roots. The runtime continues to own verification, hooks, commits, pushes, delivery, merge, and cleanup.

This decision changes the planned Windows boundary only:

- the accepted helper artifact will not be checked in;
- Windows restart reattachment remains unsupported until cooperative integration ships, and whole-harness loss remains unknown afterward;
- the existing POSIX process-group supervision path remains supported for CLI adapters;
- reviews remain session-scoped unless separately proven.

ADR 0001 remains authoritative for the event engine, grants, effects, and single lifecycle writer. This ADR qualifies its statement that the portable foreground CLI owns every worker process; an approved harness integration may own worker admission while the Autopilot runtime still owns lifecycle decisions.

## Operator recovery

An unknown cooperative execution enters nonterminal waiting. The operator may:

1. attest that the old execution has been externally stopped or accounted for, quarantine the old worktree, and authorize a fresh attempt in a new worktree;
2. attest that the old execution is inactive and adopt the exact current tree for verification without launching another implementation worker; or
3. terminally stop the run.

Operator attestation does not become OS process proof. Late provider output cannot restore authority, and an uncertain worktree cannot be assigned to another worker.

## Alternatives considered

### Package the reviewed C broker

This preserves the strongest Windows containment and restart behavior. It was rejected because the project owner prioritizes avoiding a custom executable that can trigger antivirus, application-reputation, or endpoint policy controls.

### Replace the executable with N-API

A dedicated Node broker with an N-API addon could preserve the Job Object contract. It would still ship an architecture-specific native DLL, require trusted builds and manifests, and expose the same process-management behavior to endpoint monitoring. It changes the binary shape without removing the concern.

### Use pure Node.js 24 child processes

Node.js 24 does not expose per-attempt Job Object creation, assignment, accounting, termination, or handle ownership. Libuv's internal global Job allows silent breakaway and does not provide JavaScript quiescence evidence. This option cannot support the existing restart claim.

### Use Node.js FFI

Node 26 includes an experimental, build-gated FFI that could support a future TypeScript broker without a project-owned PE artifact. It is not available in the Node 24 baseline and introduces unsafe pointer and structure handling. It remains a research option, not the production boundary.

### Keep the helper as an optional fallback

A fallback would preserve the binary, toolchain, provenance, testing, and antivirus surface. It would also create two production execution paths and make active assurance harder to identify. The package will instead report cooperative or session-scoped behavior explicitly.

## Consequences

Benefits:

- the package contains no project-owned Windows executable or native addon;
- antivirus, binary reputation, architecture, compiler-provenance, and quarantine exposure are reduced;
- harness integrations can use public structured APIs rather than terminal scraping;
- continuity loss remains fail-closed and cannot spend another attempt automatically.

Costs:

- Windows whole-harness loss does not have automatic process-tree recovery;
- a cooperative terminal response can miss an escaped background process or external side effect;
- unknown attempts require operator intervention and may consume budget;
- provider integrations require separate version-pinned evidence;
- reports and documentation must distinguish cooperative terminality from process proof.

## Follow-up

Implementation follows the ordered boundaries in the cooperative harness execution plan:

1. record this decision and stop native artifact promotion;
2. separate continuity from quiescence in the adapter and journal contracts;
3. add fenced abandon, adopt, and stop recovery;
4. implement and fault-test Pi structured delegation in-process;
5. remove the retained Windows helper source, build, protocol, and test surfaces;
6. investigate other harnesses independently after Pi proves the boundary.
