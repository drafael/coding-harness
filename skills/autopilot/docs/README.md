# Autopilot documentation

The [main README](../README.md) is the short path for starting an unattended run. Use this directory for the mechanics and design behind that workflow.

## Use and operate Autopilot

- [Getting started and operations](getting-started.md): overnight prompts, lifecycle commands, review-comment amendments, progress checks, recovery, and wrap-up.
- [Charter reference](../references/charter.md): work graphs, predicates, gates, grants, limits, delivery, amendments, and commit policy.
- [Adapter reference](../references/adapters.md): Claude Code, Codex, Pi, OpenCode, GitHub, and GitLab boundaries.
- [Recovery reference](../references/recovery.md): state layout, resume, journal repair, amendments, hooks, locks, reports, and destructive cleanup.
- [Single objective](../playbooks/single-objective.md), [independent queue](../playbooks/independent-queue.md), and [ordered stack](../playbooks/ordered-stack.md): the supported work graph modes.

## Understand and maintain Autopilot

- [Architecture](architecture.md): goals, contracts, event model, scheduling, adapters, Git ownership, verification, recovery, and remaining boundaries.
- [ADR 0001: Use a durable event engine with explicit authority](adr/0001-durable-event-engine.md): the central architectural decision and its consequences.
- [Implementation plan](implementation-plan.md): original phased implementation, acceptance evidence, and unverified integrations.
- [Continuity and evidence plan](2026-08-30-continuity-evidence-implementation-plan.md): attempt context, predicate evidence, independent review, and blocked/deferred supervision work.
- [Runtime CLI reference](runtime-cli.md): maintainer automation, state overrides, journal repair, and build commands.

## Visual overviews

### Runtime ownership

[![Autopilot runtime ownership overview.](diagrams/autopilot-runtime-ownership.png)](diagrams/autopilot-runtime-ownership.html)

How the skill, sole coordinator, adapters, Git, journal, evidence, and providers divide responsibility. Select the image to open the standalone HTML figure.

### Lifecycle waiting

[![Autopilot lifecycle waiting overview.](diagrams/autopilot-lifecycle-waiting.png)](diagrams/autopilot-lifecycle-waiting.html)

How pause, provider checks, and unknown executor state remain nonterminal without weakening terminal outcomes. Select the image to open the standalone HTML figure.

Both figures use the vendored Diagram Design default profile. The PNG exports are 2560×1440; the linked HTML remains the editable source.

## Verification status

The runtime has 133 passing Node tests covering deterministic attempt context, predicate evidence maps, exact-tree review fixtures, local Git lifecycle behavior, crash reconciliation, intentional pause, exact-subject provider waiting, hooks, queues, stacks, sealed review-feedback amendments, GitHub and GitLab provider contracts, sibling worktrees, and wrap-up. GitHub PR creation, marker reconciliation, exact review-thread resolution, and exact-head merge passed on an authorized private disposable target with `gh` 2.98.0. GitLab MR creation and reconciliation, exact discussion resolution, duplicate-status latest selection, and exact-head merge passed on an authorized private disposable target with `glab` 1.115.0. Live harness review and the complete review-feedback amendment workflow remain unverified.
