---
name: refactor-code
description: Simplify and improve code through narrow, behavior-preserving, test-backed changes without speculative architecture or scope growth. Use when the user asks to "refactor", "clean up code", "improve code quality", "restructure", or "simplify this code".
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Focused Refactoring

Refactor for a specific, demonstrated benefit while preserving external behavior. Load applicable language/framework skills and repository instructions first.

## Principles

- Prefer less code, fewer concepts, and clearer control flow over abstraction, extensibility, or pattern use.
- Keep the change within the requested boundary. Ask before crossing packages, processes, layers, or public APIs.
- A new abstraction needs multiple current consumers or a clear existing contract. Hypothetical reuse does not count.
- Small duplication is preferable when sharing would create coupling or obscure behavior.
- Do not combine refactoring with dependency upgrades, formatting sweeps, security programs, performance rewrites, or unrelated cleanup.
- Do not change valid behavior, add arbitrary limits, or harden against theoretical threats under the label of refactoring.

## Workflow

1. **Establish the target**
   - Identify the concrete readability, duplication, complexity, or maintenance problem.
   - Read the implementation, callers, tests, and repository conventions.
   - State the smallest viable change and what behavior must remain unchanged.

2. **Establish evidence**
   - Run the smallest relevant existing tests before editing.
   - Add characterization tests only when changed behavior is otherwise unprotected or ambiguous; do not build an exhaustive test framework first.
   - For performance work, require a measurement or an obviously material hot-path problem.

3. **Refactor incrementally**
   - Make one coherent, reversible change at a time.
   - Prefer rename, inline, delete, simplify, or local extraction before new types or architecture.
   - Use existing project primitives and dependencies.
   - Run focused validation after each meaningful step.

4. **Control scope**
   - If the work requires several new production modules, a generalized framework, a lifecycle/ownership protocol, or subsystem redesign, stop and ask for approval with a simpler alternative and regression risk.
   - If two attempts fail or remain unverified, revert to the last known-good state and reassess the actual boundary instead of layering more machinery.

5. **Finish cleanly**
   - Run the appropriate broader validation.
   - Review the complete diff for behavior changes and remove dead experiments, unnecessary APIs, speculative limits, unused dependencies, duplicate paths, and one-consumer abstractions.
   - Update documentation only where the refactor changed an actual contract or operating procedure.

## Prohibited Defaults

Do not automatically:

- Apply design patterns, polymorphism, services, repositories, factories, or dependency injection merely to appear cleaner.
- Eliminate every instance of duplication.
- Add resilience, retries, caching, feature flags, monitoring, rollout machinery, or migration compatibility without a current requirement.
- Rewrite working library behavior with application-owned approximations.
- Add production hooks solely for tests.
- Commit, format the whole repository, update snapshots, or change generated files unless requested or required by repository policy.

Success means the resulting code is easier to understand and has equal or lower conceptual complexity—not merely more modular files.
