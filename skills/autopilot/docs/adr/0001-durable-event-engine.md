# ADR 0001: Use a durable event engine with explicit authority

- **Status:** Accepted
- **Date:** 2026-08-22
- **Related:** [Architecture](../architecture.md), [implementation plan](../implementation-plan.md), [charter reference](../../references/charter.md)

## Context

Autopilot must run coding work for hours without requiring the original chat session to stay coherent. A process may stop after an agent edits files, after Git commits, after a push, or while a provider call succeeds but before local confirmation is recorded. The workflow also spans harnesses with different process and event interfaces.

A prompt or Markdown checklist cannot own those transitions safely. Model prose is not completion evidence, and retrying external effects without durable intent can duplicate or overwrite work. A background service would provide lifecycle ownership, but it would add installation, configuration, and host-management requirements that do not fit a portable skill.

The runtime must also distinguish requested work from authority. Permission to edit a file does not imply permission to commit, push, open a change request, merge it, delete its branch, or clean its worktree.

## Decision

Autopilot uses a foreground TypeScript CLI as the sole lifecycle owner. Each run begins with an immutable charter that records:

- the repository and accepted base identity;
- work items and their dependency graph;
- observable completion predicates and verification gates;
- actor-scoped grants for workers, adapters, the runtime, and delivery providers;
- retry, concurrency, timeout, and output budgets;
- delivery and pre-commit policies.

The CLI appends hash-linked lifecycle events to `events.jsonl`. That journal is canonical. Snapshots and reports are rebuildable projections. Before an external effect, the runtime records intent and an idempotency key; after interruption, reconciliation observes Git or provider state before retrying.

Workers receive isolated worktrees and may edit only their granted roots. The runtime owns verification, hooks, commits, pushes, change requests, merges, amendments, and wrap-up. Harness and provider adapters normalize external observations but cannot declare success or append lifecycle events.

The CLI remains foreground and portable. It does not install a daemon, database, harness, browser, provider CLI, or authentication state.

## Decision diagrams

### Runtime ownership

[![Autopilot runtime ownership: one foreground coordinator owns lifecycle decisions while adapters, Git, evidence, and providers remain bounded mechanisms or observations.](../diagrams/autopilot-runtime-ownership.png)](../diagrams/autopilot-runtime-ownership.html)

The coordinator is the only lifecycle writer. Workers edit granted roots; the runtime verifies and governs effects; provider responses remain observations. Select the image to open the standalone HTML figure.

### Durable nonterminal waiting

[![Autopilot lifecycle: waiting for pause, provider checks, or unknown execution state remains distinct from immutable success and terminal stop.](../diagrams/autopilot-lifecycle-waiting.png)](../diagrams/autopilot-lifecycle-waiting.html)

Later pause and provider-wait behavior extends this decision without creating another lifecycle owner. Unknown executor state fails closed instead of launching a speculative replacement. Select the image to open the standalone HTML figure.

## Alternatives considered

### Markdown-only playbooks

Playbooks are useful for task shape and operator guidance, but they cannot provide atomic state changes, idempotent external effects, locks, leases, or restart reconciliation. Autopilot keeps playbooks as inputs to the runtime rather than treating them as the runtime.

### A persistent daemon or service

A daemon could supervise work independently of a terminal, but it would require installation, upgrades, service ownership, configuration, and a larger security boundary. The foreground CLI already provides durable restart through the journal, so a daemon is not required for the current use case.

### Let each coding harness own Git and delivery

Harness-native autonomy is convenient, but lifecycle and permission semantics differ across Claude Code, Codex, Pi, and OpenCode. Giving workers direct commit, push, merge, or cleanup authority would also make verification and reconciliation model-dependent. Autopilot keeps these effects in the harness-neutral runtime.

### Adopt an existing autonomous runner unchanged

[pstack `/poteto-mode`](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md), [AWS AI-DLC Workflows](https://github.com/awslabs/aidlc-workflows), and [Ralphex](https://github.com/umputun/ralphex) informed the design. None provided the exact combination of a portable skill, immutable capability charter, append-only cross-harness runtime, provider-neutral delivery, retained-worktree amendments, and guarded wrap-up required here.

## Consequences

Benefits:

- runs resume from durable evidence instead of chat memory;
- external effects have explicit owners, grants, and reconciliation rules;
- workers can be replaced without transferring lifecycle authority;
- the same run model works across supported harnesses and delivery providers;
- terminal runs remain immutable, with changed work handled by sealed successors;
- status, reports, decisions, and handoffs come from one event history.

Costs:

- the runtime and journal schema must evolve carefully;
- every new effect needs authorization, intent, confirmation, and recovery behavior;
- the foreground process must remain running for unattended progress, although a stopped process can be resumed;
- provider and platform claims require separate integration evidence;
- cleanup needs stricter identity checks than ordinary worktree removal because it deletes state.

## Follow-up rules

New lifecycle behavior should extend this decision rather than bypass it:

1. keep one runtime owner for state transitions;
2. add the narrowest actor-scoped grant and effect contract;
3. record intent before non-idempotent effects;
4. reconcile observed state after interruption;
5. preserve terminal history or delete it only through the verified wrap-up protocol;
6. report untested provider and platform behavior as unverified.
