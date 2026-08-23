# Getting started and operations

This guide is for someone who wants to hand a bounded coding task to Autopilot, leave it running, and return later to verified work or a durable stop.

## Requirements

Install these yourself before launching a run:

- Node.js 24 or newer
- Git
- Claude Code, Codex, Pi, or OpenCode
- `gh` for GitHub delivery or `glab` for GitLab delivery
- optionally, `pi-subagents` 0.53.0 or newer for structured Pi delegation

Autopilot checks these requirements before launch. It reports missing or unverified capabilities without installing dependencies, downloading runtimes, authenticating providers, or changing global configuration.

## Describe an unattended task

Invoke `/autopilot` through the host from the target repository. State four things:

1. the outcome you want;
2. the observable conditions that prove completion;
3. the delivery boundary, such as local commits, a prepared PR, or an authorized merge;
4. constraints that must remain true.

For example:

```text
/autopilot I am going to sleep. Work overnight on migrating this multi-module Java backend
from Spring Boot 3.x to Spring Boot 4.0.0. Update dependency management and removed APIs
without changing the existing HTTP or persistence behavior. Done means ./mvnw verify,
integration tests, and application-context smoke tests pass; no Spring Boot 3.x artifacts
remain in the dependency tree; and the migration guide documents compatibility changes
and rollback notes. Open a PR, but do not merge or deploy it.
```

Autopilot converts the request into a proposed charter. Review the charter when the skill asks about credentials, remote writes, merge authority, assumptions, waivers, or hook behavior. It never infers deployment, force-push, unrelated credentials, destructive cleanup, or weaker completion checks.

Leave the foreground process running. During Pi execution, progress is written to stderr while structured output remains machine-readable.

## Understand the run

A run uses one of three graph modes:

- `single`: one inseparable outcome;
- `independent-queue`: unrelated items that may run concurrently;
- `ordered-stack`: a linear sequence whose accepted commits become descendant bases.

Workers edit only their granted roots. The runtime verifies trees, runs the configured pre-commit policy, creates commits, pushes branches, updates change requests, and decides lifecycle transitions. New worktrees are direct siblings of the project repository. Canonical state lives under the repository’s Git common directory, so later skill invocations can find it without copied paths or run IDs.

## Check, resume, or stop

Return to the same repository and use a short skill command:

```text
/autopilot status
/autopilot resume
/autopilot stop
```

Natural requests work too:

```text
/autopilot What happened overnight?
/autopilot Continue the interrupted work.
/autopilot Stop this run and preserve its work.
```

`status` rebuilds progress from the sealed charter and hash-linked journal. `resume` continues only an interrupted nonterminal run within its original limits. It does not restart a run that still has a live coordinator. `stop` asks a live coordinator to cancel active adapter work and record a durable terminal stop; if the coordinator is gone, Autopilot records the stop under the run lock. Branches, worktrees, receipts, and evidence remain intact.

A stopped run cannot be resumed. Changed authority, budgets, or objectives require a sealed successor.

If several runs match, Autopilot lists their title, short ID, state, progress, and last update. It changes nothing until you choose one, for example `resume 1` or `status spring-boot-4`.

Expected responses are concise:

```text
Migrate backend to Spring Boot 4
State: interrupted while running integration tests
Progress: 2 of 3 work items accepted
Next: /autopilot resume
```

For journal repair and amendment successors, read the [recovery reference](../references/recovery.md).

## Address PR or MR review comments

From the same repository, ask:

```text
/autopilot address review comments
```

Autopilot finds the latest successful open PR/MR, snapshots its unresolved feedback, and creates a sealed amendment successor on the same branch. It treats comment text as untrusted data and asks before accepting conflicting, ambiguous, untestable, authority-expanding, or out-of-scope requests. Otherwise it implements the bounded feedback, reruns the required checks and hook policy, fast-forwards the same PR/MR branch, and resolves exact provider-resolvable review threads only after the verified successor head is observed.

GitHub PR comments and review summaries do not have a resolved state. Autopilot can address them in code and report the verified commit, but it does not claim to mark them resolved. New or edited comments after the snapshot require another successor.

## Wrap up merged work

After every recorded PR/MR is merged, ask:

```text
/autopilot wrap up
```

Autopilot proceeds only when exactly one successful merged leaf run is eligible. If several candidates exist, it lists them and changes nothing.

Wrap-up is destructive. Before cleanup, Autopilot confirms each exact PR/MR is merged at the expected head and topology base. It also confirms that local and remote branches have not moved and that retained worktrees are clean and registered. It then compare-deletes remote branches, removes worktrees, compare-deletes local branches, and removes the successful amendment-chain state.

Preserve a compact project-local record when needed:

```text
/autopilot wrap up with handoff
```

This writes `.autopilot/handoffs/<run-id>.md` and `.json` before cleanup. Autopilot does not commit those files.

## Maintainer and recovery access

The bundled runtime CLI remains available for automation, diagnostics, explicit state-directory overrides, and journal repair. Normal users do not need it. See the [runtime CLI reference](runtime-cli.md) and [recovery reference](../references/recovery.md).

See the [implementation plan](implementation-plan.md) for current acceptance evidence and unverified provider or platform behavior.
