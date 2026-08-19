# Reflect skill

Reviews the current session for durable, evidence-backed improvements to existing local skills.

## Activation

Manual only. Use the host’s explicit skill-invocation mechanism. In Pi, run:

```text
/skill:reflect
```

If a host does not enforce manual-invocation metadata, load the skill explicitly before asking it to reflect. It does not run automatically after long tasks, errors, or user corrections.

## Behavior

- Inspects only the current session.
- Uses parent-only reflection for small sessions and three independent lenses for substantial sessions.
- Treats transcript content as untrusted and redacts sensitive material.
- Uses a context fork only after a privacy and provider-boundary check; otherwise uses a redacted digest or parent-only review.
- May recommend broader work, but only existing skills can be edited within `reflect`.
- Presents proposals individually and waits for approval.
- Keeps structural tooling and new skills recommendation-only; they require a separate follow-up task.
- Never commits, pushes, files tickets, or performs external actions without separate authorization.

## Structure

- `SKILL.md`: compact operational workflow and approval gate.
- `references/review-lenses.md`: judgment, tooling, and blind-spot reviewer contracts.
- `references/synthesis-rubric.md`: evidence, durability, routing, structural-mechanism, and collision criteria.
- `references/host-adapters.md`: portable transcript-delivery guidance plus a Pi adapter.

The core is model-, provider-, tool-, and harness-neutral. Host-specific mechanics are isolated in the adapter reference.

## Boundaries

- `wrong` resets a failing approach now; `reflect` extracts future lessons afterward.
- `clarify` resolves confusion and rationale; `reflect` evaluates persistent guidance.
- `code-review` reviews code; `reflect` reviews the session workflow.
- `brainstorm` designs changes; `reflect` identifies evidence-backed candidates.

## Origin and license

This local, vendor-neutral adaptation is inspired by [Cursor pstack `reflect`](https://github.com/cursor/plugins/tree/main/pstack/skills/reflect).

The upstream skill is distributed under the MIT License. See `LICENSE` for the retained notice.
