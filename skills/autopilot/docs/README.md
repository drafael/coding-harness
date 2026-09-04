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
- [ADR 0002: Use cooperative harness execution on Windows](adr/0002-use-cooperative-harness-execution-on-windows.md): the decision not to package a project-owned native helper and the resulting assurance boundary.
- [Implementation plan](implementation-plan.md): original phased implementation, acceptance evidence, and unverified integrations.
- [Continuity and evidence plan](2026-08-30-continuity-evidence-implementation-plan.md): attempt context, predicate evidence, independent review, and blocked/deferred supervision work.
- [Cooperative harness execution plan](2026-08-31-cooperative-harness-execution-plan.md): approved binary-free Windows execution assurance, unknown-state recovery, Pi integration, and delivery sequence.
- [OpenCode server execution evaluation](2026-08-31-opencode-server-evaluation.md): version-pinned protocol evidence, controlled probes, GO decision, assurance boundary, and implementation acceptance criteria.
- [Claude Agent SDK execution evaluation](2026-09-04-claude-agent-sdk-evaluation.md): current API identity evidence, live 0.3.220 probes, conditional GO decision, and promotion requirements.
- [Restack successor lifecycle design](restack-successor-design.md): explicit authority, verification, Git mutation, and recovery contract for successful-stack restacking.
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

The runtime has 234 Node tests locally covering deterministic attempt context, predicate evidence maps, exact-tree review fixtures, local Git lifecycle behavior, crash reconciliation, intentional pause, exact-subject provider waiting, hooks, queues, stacks, sealed review-feedback amendments, GitHub and GitLab provider contracts, sibling worktrees, POSIX descendant process cancellation, native-free package inventory, Codex app-server and OpenCode server continuity contracts, and wrap-up. Controlled Pi 0.84.4 with pi-subagents 0.60.0 process-local tests cover exact admission, cancellation, extension-context loss, direct fallback, and runtime-core completion in a reused local repository. Codex app-server 0.151.0 live completion and interruption passed on one uninterrupted stdio connection without changing the tested Codex config digest; its connection-loss behavior has controlled fault coverage. OpenCode server live completion and exact aborted-message cancellation passed with 1.18.28 without changing the OpenCode config digest or leaving a server process after normal cleanup; whole-harness loss remains intentionally uncontained and unknown. Agent SDK 0.3.220 with bundled Claude Code 2.1.220 produced an exact natural completion and an interrupt receipt followed by `aborted_tools`; that older cancellation result lacked the required user-message UUID, so production promotion requires a live 0.3.246-or-later probe. Disposable exact-tree reviews also passed with Pi 0.84.4, Codex 0.151.0, and OpenCode 1.18.25; direct Claude Code review remains unverified. GitHub PR creation, marker reconciliation, exact review-thread resolution, exact-head amendment, merge, and wrap-up passed on an authorized private reusable validation project with `gh` 2.98.0. GitLab MR creation and reconciliation, exact discussion resolution, duplicate-status latest selection, exact-head amendment, merge, and wrap-up passed on an authorized private reusable validation project with `glab` 1.115.0.
