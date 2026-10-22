---
name: tdd
description: Fix a bug by proving a focused regression check fails before the fix and passes after it. Manual invocation only; use when the user explicitly invokes tdd or requests this test-first bug-fix workflow. Do not force broad test infrastructure or claim unobserved red/green evidence.
disable-model-invocation: true
license: See LICENSE
---

# TDD bug fix

Make the broken behavior executable before changing production code. The goal is a focused regression test that fails for the bug before the fix and passes afterward.

## Scope and companion skills

Run only after an explicit request for this workflow. This skill covers test-first bug fixes, not a general feature-development methodology or an automatic requirement for every coding task.

Follow repository instructions, language-specific conventions, and existing test conventions. Companion skills are optional: use an applicable language skill, `debug-error` for unresolved root-cause investigation, or `write-tests` for runner guidance only when installed and loadable. Otherwise inspect the relevant implementation, test setup, and representative tests directly. Use the project's available test runner and execution tools; do not require a particular runtime, shell, or tool API. Do not repeat investigation already established in the conversation.

## Red, green, then validate

1. **Understand the bug.** Establish intended behavior, observed behavior, the affected path, and the smallest observable reproduction. Resolve a material ambiguity before encoding it as an assertion.
2. **Choose the narrowest useful check.** Prefer an existing unit, component, integration, or regression-test boundary that exercises the failing behavior. Match the check to the actual boundary; a unit test alone does not prove a service integration or concurrency claim.
3. **Write the regression test first.** Add the smallest deterministic test that would have caught the bug. Assert intended behavior through a stable boundary, not implementation details or mocked copies of the production logic.
4. **Run it before fixing.** Confirm it fails for the intended reason. A compilation error, missing dependency, unavailable service, or unrelated failure is not red evidence for the bug. If it passes, reassess the reproduction or test before editing production code.
5. **Make the smallest fix.** Change the responsible production boundary while preserving nearby behavior, validation order, side effects, and error contracts. Do not redesign adjacent code or introduce production hooks solely for the test.
6. **Run it again.** Confirm the same regression test passes. Then run the smallest relevant nearby checks, expanding validation when the affected boundary warrants it.
7. **Refactor only if needed.** Keep cleanup local and behavior-preserving, with the regression test staying green. Do not turn the cycle into unrelated cleanup or coverage expansion.

## When a failing test is impractical

Do not build a broad harness just to satisfy the workflow. Brittle mocks, unrelated fixture churn, production-only state, uncontrolled services, and timing-dependent tests can cost more than they prove.

Use the closest safe, authorized executable check instead: a focused reproduction command, targeted script, browser check, snapshot comparison, or controlled integration check. Prefer demonstrating the same failure-before and success-after boundary. Do not update snapshots, weaken assertions, or alter expected behavior merely to make the implementation pass.

If the user explicitly requires an automated regression test and satisfying it needs substantial new infrastructure or scope, explain the blocker and ask before substituting a different deliverable. Otherwise report the practical alternative and its limits. If execution is unavailable, say what remains unverified; do not invent failing-before or passing-after results.

Do not revert unrelated user changes to manufacture a before-state. If the fix already exists, report the missing baseline or use an isolated comparison only when safe and appropriate.

## Finish with evidence

Report concisely:

- the test or check and the bug-specific failure observed before the fix;
- the passing-after result and nearby validation actually run;
- any skipped check, blocker, or integration behavior still unverified.

Name the command or test when it helps reproduce the result. Tests prove only the boundary they exercise.
