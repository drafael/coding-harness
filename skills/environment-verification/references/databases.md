# Database Verification

Use a real isolated database when the claim depends on database semantics. Mapper tests, source inspection, or a different in-memory engine do not establish migration, locking, or transaction behavior on the target engine. Apply the checks supported by the actual database and relevant to the claim; do not assume every engine uses relational schemas, SQL, locks, or multi-statement transactions.

## Select a representative boundary

Derive the engine and important settings from the repository or deployment contract. Check the running engine version rather than relying only on an artifact label. Record relevant extensions, consistency/isolation settings, permissions, namespaces, and constraints. Do not assume a locally running engine reproduces every behavior of a compatible managed service.

Use the smallest suitable isolated instance: an application-launched process, container, virtual machine, or approved remote test service. Check compatibility and availability of the required binaries or images when applicable. Downloads and remote execution must remain within authorized network and resource scope; do not repair or upgrade unrelated host infrastructure as a shortcut. A temporary database or namespace on an existing server is suitable only when access is authorized and isolation is sufficient for the experiment; it does not isolate server-wide changes or resource contention.

Use disposable storage and synthetic fixtures, with access restricted to the required clients. Establish readiness through a successful database operation, not a fixed sleep.

## Migrations and upgrades

Choose checks according to the claim:

- For an upgrade, establish the relevant previous schema, seed representative legacy rows through supported paths, and apply the actual new migrations.
- For clean installation or historical compatibility, replay the relevant migration history with its required prerequisites.
- Verify affected columns, defaults, constraints, procedures, preserved data, and observable application-owned behavior—not only successful SQL execution.
- Exercise failure atomicity and backward-compatible payloads when those are part of the change's contract.

Prefer the project's actual migration runner when testing migration execution. Direct execution of migration statements or operations can establish engine behavior, but does not verify runner metadata, checksums, callbacks, ordering configuration, or transaction policy. State that distinction explicitly. Do not rewrite historical migrations merely to make a harness pass.

For an engine-level experiment, retain the relevant mechanisms, such as uniqueness constraints, references, and transaction boundaries. A fixture that removes the mechanism under investigation cannot provide evidence about it. Clearly distinguish prototype results from checks of the final source migration.

## Transactions and concurrency

Use independent database sessions and explicit synchronization to control the schedule:

1. Establish the relevant committed starting state.
2. Start the first transaction and reach the intended statement or completed-call barrier.
3. Start the competing operation in another session.
4. Observe whether it blocks, completes, or fails using the engine's supported diagnostics, such as lock/wait information, transaction state, conflict responses, or execution traces.
5. Commit or roll back in the intended order, then assert the final rows, associations, and preserved unrelated fields.

A sleep may be a polling interval, but elapsed time alone is not evidence of blocking or correctness. Give waits a diagnostic timeout; a timeout is not a passing schedule.

Cover the orderings relevant to the suspected defect. Depending on the claim, these may include reverse arrival order, first creation versus an existing row, rollback, duplicate/stale events, and insert-conflict paths. Do not turn every change into a general concurrency benchmark.

Where feasible, reproduce the defect without the proposed correction as a negative control, then run the same schedule with the correction. Keep experimental variants outside production code and do not add production hooks solely for the harness.

## Interpret results narrowly

Record which engine/version, isolation level, transaction schedule, and fixtures passed. Functional assertions do not establish throughput; deterministic two-session schedules do not prove the absence of all deadlocks or races. A successful disposable database run also does not prove deployed event ingestion, application wiring, or managed-service behavior.

Retain enough sanitized operations, fixture definitions, and results to explain or reproduce the finding when required by the task. Clean up only the database resources owned by the experiment.
