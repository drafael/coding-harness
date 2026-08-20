---
name: blast-radius
description: Analyze a concrete code change for credible breakage beyond the obvious diff and seek executable proof for the assumptions that make it safe. Manual invocation only; use for an explicitly requested blast-radius analysis of a local diff, commit range, branch comparison, or local patch.
disable-model-invocation: true
license: See LICENSE
---

# Blast radius

Find what a concrete change could break outside its obvious diff, then seek proportionate proof for the assumptions that make the change safe.

## Invocation and target

Run only after explicit invocation. Require a bounded, locally available change:

- an uncommitted or staged diff;
- a commit or commit range;
- a branch comparison;
- a locally available patch or PR ref.

Do not analyze a purely hypothetical change. Route future design questions to an available design workflow instead.

Establish the base, target, changed files, and relevant build or runtime context before drawing conclusions. Distinguish behavior introduced by the target change from pre-existing behavior. Ask one focused question when the comparison boundary is materially ambiguous.

Record the initial repository status before running checks or creating temporary resources. This skill analyzes and verifies; it does not fix findings, refactor code, or commit changes.

## Preserve the repository

Keep tracked project files unchanged by default:

- Prefer existing focused tests and repository commands.
- When a custom harness is necessary, create it outside tracked files when practical.
- Remove only temporary resources created by this analysis.
- Never reset, clean, overwrite, stage, or delete pre-existing work.
- Report normal generated output according to repository policy when it cannot be removed safely.
- Obtain explicit approval before handing persistent tests, scripts, fixtures, or production hooks to an implementation workflow.

Do not run destructive, privileged, remote, or externally mutating checks without explicit authorization. A proof is not worth damaging user work or external state.

## Compose with optional skills

When installed and loadable:

- use `explain-code` to establish current mechanics and flow;
- use `clarify` for relevant rationale or expectation mismatches;
- use applicable project coding skills for language, framework, build, and test semantics;
- use `unslop` for the final prose pass.

These skills are optional. When one is unavailable, perform the smallest equivalent local investigation or prose check here. Do not pretend a skill ran, and do not repeat investigation whose evidence and scope are already available. Never require a named model, provider, tool, command, subagent, or agent harness.

## Understand the semantic change

Read both sides of the diff. Trace affected symbols, callers, implementations, overrides, registrations, imports, tests, configuration, and documented contracts. Explain what now behaves differently, including effects that changed lines do not state directly.

A symbol search is a starting point, not proof of complete impact. Follow implicit contracts only when the change makes them credible. Relevant surfaces may include:

- serialized data, wire formats, API fields, and event names;
- persisted values, database schemas, and migration assumptions;
- feature flags, environment variables, and configuration keys;
- asynchronous ordering, lifecycle, teardown, caching, and concurrency;
- reflection, dependency injection, plugin registration, and generated code;
- pinned dependency behavior, lockfiles, and local patches;
- cross-language or separately deployed consumers.

Do not inventory every possible surface. Do not invent a caller, consumer, API, or risk to make the analysis look comprehensive. A relevant search with no matches establishes only the scope searched, not universal absence.

## Identify assumptions and risks

State the smallest set of decision-critical facts on which safety depends, usually one or two. Do not force unrelated concerns into a single assumption.

For each credible risk, establish:

- the failure path and affected boundary;
- the conditions that make it reachable;
- realistic likelihood and plausible impact;
- concrete evidence and location;
- the cheapest check that would distinguish safe from unsafe behavior.

Keep confirmed risks separate from concerns investigated and cleared. Omit speculative risks without a reachable path or credible conditions. A result with no confirmed risk is valid.

## Grade the evidence

For every decision-critical assumption, report the strongest level reached:

1. **Source evidence:** a concrete file, symbol, pinned version, or dependency source establishes the relevant contract.
2. **Path analysis:** the bad case is traced step by step and shown to reach or not reach affected behavior.
3. **Focused execution:** an existing test, command, or ephemeral harness exercises the real code and fails clearly when the assumption is false.
4. **Runtime reproduction:** behavior is observed at the actual application or integration boundary.

An assumption that stops before focused execution is **unverified by execution**. Do not present it as settled because its source explanation sounds convincing. Preserve contradictions and do not round confidence upward.

## Run proportionate proof

Execute a decision-critical assumption when a focused check is safe, practical, and representative:

1. Prefer the smallest existing test or repository command that reaches the boundary.
2. Exercise the same implementation, configuration, and pinned dependency version the application uses.
3. Record the command, relevant output, and exact boundary exercised.
4. Use mocks only when the claim concerns the mocked boundary.
5. Do not present source assertions, unit tests, or mocks as proof of native, packaged, external-service, or end-to-end behavior.
6. Do not add production hooks solely to manufacture proof.

If execution is unsafe, unavailable, disproportionately expensive, or unable to represent the real boundary, state why verification stopped and mark the assumption unverified. Do not substitute an unrelated passing test.

After checks, compare repository status with the initial snapshot. Remove only analysis-owned temporary resources. Report any remaining generated files or unexpected changes; never erase them blindly.

## Scale wide changes proportionally

Use one investigator for a narrow change. For a genuinely wide change, independent read-only slices are optional when the environment supports them. Runtime and lifecycle effects, persisted or serialized contracts, and downstream integrations are possible slices, not a mandatory quota.

The parent remains responsible for scope, privacy, evidence standards, conflict resolution, and final synthesis. Give reviewers only the minimum relevant context. They may not edit files, expand into unrelated systems, or treat another reviewer's speculation as evidence.

## Protect access and privacy

Use local evidence by default. Access remote PRs, dependency sources, services, or running environments only when the user explicitly requested it and the access and privacy boundary permits it.

Do not reproduce credentials, tokens, private keys, cookies, sensitive personal data, or unrelated proprietary content. Use a redacted placeholder and report an exposure without restating the value.

## Return the result

Adapt the response to the evidence and omit empty sections:

- **Change:** the concrete behavioral difference and comparison boundary.
- **Safety assumptions:** each decision-critical assumption, evidence level, proof performed, and verification status.
- **Confirmed risks:** failure path, location, conditions, likelihood, impact, and cheapest check.
- **Cleared concerns:** what was investigated and the evidence that ruled it out.
- **Before merge:** the smallest remaining test or reproduction that would materially reduce uncertainty.
- **Scope and gaps:** inaccessible boundaries, contradictory evidence, and anything left unverified.

Separate residual validation needs from confirmed defects. Cite real paths and symbols, include relevant proof output, and return the analysis rather than a report about the process.

When `unslop` is available, apply it without changing commands, output, technical terms, uncertainty, or evidence strength. Otherwise perform the same final clarity check locally.

Before responding, verify that the target remained bounded, every reported risk has a credible path, every safety assumption names its evidence level, and pre-existing repository work remains untouched.
