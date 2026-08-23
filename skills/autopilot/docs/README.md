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
- [Implementation plan](implementation-plan.md): phased implementation, acceptance evidence, test matrix, rollout sequence, and unverified integrations.
- [Runtime CLI reference](runtime-cli.md): maintainer automation, state overrides, journal repair, and build commands.

## Verification status

The runtime has 111 passing Node tests covering local Git lifecycle behavior, crash reconciliation, hooks, queues, stacks, sealed review-feedback amendments, GitHub and GitLab provider contracts, sibling worktrees, and wrap-up. Live GitHub and GitLab review-thread resolution remains unverified until an explicitly authorized disposable target is available.
