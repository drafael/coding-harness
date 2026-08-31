# Autopilot

Give Autopilot a bounded coding task, define what “done” means, and leave the terminal running overnight. It works through Claude Code, Codex, Pi, or OpenCode while you sleep, then returns verified commits, a prepared PR/MR, a merge, or a durable explanation of why it stopped. Autopilot is a developer preview; harness and provider verification varies by environment.

Autopilot is not a prompt loop. It seals your request into an immutable charter, gives each worker an isolated sibling worktree, verifies the result itself, and journals enough state to resume after interruption.

## Use it

You need Node.js 24+, Git, and at least one supported harness CLI. Remote delivery also needs authenticated `gh` or `glab`. Pi can use the packaged Autopilot extension with an installed and active `pi-subagents` 0.53.0+ owner for process-local execution; otherwise it reports the distinct direct CLI fallback. Autopilot checks the environment before launch; it never installs tools, enables extensions, or signs you in.

From the project repository, invoke the skill through your host:

```text
/autopilot I am going to sleep. Work overnight on migrating this multi-module Java backend
from Spring Boot 3.x to Spring Boot 4.0.0. Update the build plugin and dependency management,
replace removed APIs, and preserve the existing HTTP and persistence behavior. Done means
./mvnw verify passes, integration tests and application-context smoke tests pass, no Spring Boot
3.x artifacts remain in the dependency tree, and the migration guide records compatibility
changes and rollback notes. Open a PR, but do not merge or deploy it.
```

When using Pi's process-local backend, load `runtime/dist/src/pi-extension-entry.js` through Pi's documented extension or package mechanism, then start the sealed charter with `/autopilot-start <charter-file>`. The owning Pi process must remain uninterrupted; losing it makes the exact attempt unknown and never triggers a replacement.

Autopilot will:

1. turn the request into explicit work items, completion predicates, budgets, and grants;
2. show the charter when authority or delivery needs your approval;
3. create isolated branches and sibling worktrees;
4. give each fresh agent a bounded context derived from the charter, journal, Git identity, and receipts;
5. verify each predicate against the exact tree, optionally run a read-only independent-review gate, apply the repository’s pre-commit policy, and commit accepted work;
6. push or update change requests only when the charter grants those effects;
7. stop at the original definition of done or preserve a predicate-to-evidence map for status, retry, and handoff.

A good request states the outcome, observable completion checks, delivery boundary, and anything Autopilot must not do. It does not need an implementation plan.

## Manage the run

Return to the same repository and ask Autopilot directly:

```text
/autopilot status
/autopilot resume
/autopilot pause
/autopilot stop
/autopilot address review comments
/autopilot wrap up
/autopilot wrap up with handoff
```

After explicit `/autopilot` invocation, natural lifecycle wording works too: `/autopilot What happened overnight?`, `/autopilot Continue the interrupted work`, `/autopilot Fix and resolve the PR comments`, or `/autopilot Clean up the merged run and leave a handoff`. Autopilot discovers the current project’s run. If more than one run matches, it lists short choices and changes nothing until you select one.

`status` reports the last durable milestone, unmet predicate identities, remaining budgets, and next legal action from the journal and receipts. `pause` asks the lock-owning coordinator to cancel active implementation work, prove quiescence, retire the exact lease, and enter nonterminal `WAITING`; cancellation solely for pause does not consume the attempt budget. `resume` reconciles a paused or interrupted nonterminal run. A verified item continues from its durable checkpoint and confirmed effects without rerunning implementation. On supported POSIX hosts, an interrupted supervised implementation execution reattaches through exact attempt artifacts and reaches terminal quiescence before any replacement. Autopilot packages no Windows native containment helper; direct Windows CLI execution is session-scoped, and continuity loss fails closed as `EXECUTION_STATE_UNKNOWN`, as do legacy, review, or incomplete supervisor states. `address review comments` snapshots unresolved feedback from the exact open PR/MR, creates a verified amendment successor, updates the same branch, and resolves provider-resolvable threads only after the fix passes. `stop` deliberately ends a run and preserves its work; a stopped run cannot be resumed and requires a sealed successor. `wrap up` is destructive: after live provider checks, it removes the exact remote branches, clean worktrees, local branches, and run-state chain. A handoff writes Markdown and JSON summaries under `.autopilot/handoffs/` before cleanup.

## Read more

- [Documentation index](docs/README.md)
- [Getting started and operations](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Runtime ownership diagram](docs/diagrams/autopilot-runtime-ownership.html)
- [Lifecycle waiting diagram](docs/diagrams/autopilot-lifecycle-waiting.html)
- [Decision record](docs/adr/0001-durable-event-engine.md)
- [Implementation plan and verification boundary](docs/implementation-plan.md)
- [Charter reference](references/charter.md)
- [Adapters and provider support](references/adapters.md)
- [Recovery, amendments, and wrap-up](references/recovery.md)

## Inspiration and credits

Autopilot was shaped by [pstack’s `/poteto-mode`](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md), especially its [autonomous-run](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/autonomous-run.md), [autopilot-full](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/autopilot-full.md), and [show-me-your-work](https://github.com/cursor/plugins/blob/main/pstack/skills/show-me-your-work/SKILL.md) workflows. It also draws on [AWS AI-DLC Workflows](https://github.com/awslabs/aidlc-workflows) for explicit lifecycle artifacts and [Ralphex](https://github.com/umputun/ralphex) for fresh-session autonomous plan execution and foreground supervision.

These projects inspired the workflow. Autopilot’s charter, authority model, append-only runtime, recovery rules, provider adapters, and cleanup protocol are implemented here for this harness collection.
