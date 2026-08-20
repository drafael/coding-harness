# Blast-radius skill

Analyzes a concrete code change for credible consequences beyond the obvious diff, then seeks proportionate executable proof for the assumptions that make the change safe.

## Activation

Manual only. Use the host's explicit skill-invocation mechanism. In Pi, provide a bounded local target:

```text
/skill:blast-radius Analyze HEAD~1..HEAD.
```

Accepted targets include uncommitted or staged changes, commits, commit ranges, branch comparisons, and locally available patches or PR refs. The skill does not analyze a purely hypothetical future change.

Example requests:

- "Analyze the blast radius of the staged changes."
- "What could commit `abc123` break outside the modified files?"
- "Check the blast radius of `main...feature/cache-cleanup` and prove the critical safety assumptions."
- "Analyze this local PR ref for serialized-contract and lifecycle effects."

## Behavior

- Establishes the comparison boundary and semantic behavior change.
- Traces direct references and credible implicit contracts such as serialized data, persisted values, configuration, dependency behavior, lifecycle ordering, and cross-language consumers.
- Identifies the smallest set of decision-critical safety assumptions.
- Grades each assumption from source evidence through runtime reproduction.
- Marks assumptions that lack focused execution as **unverified by execution**.
- Separates confirmed risks from investigated-and-cleared concerns.
- Keeps tracked project files unchanged by default and preserves pre-existing work.

The skill prefers existing focused checks. It may use an ephemeral harness outside tracked project files when practical and removes only resources it created. Persistent tests, scripts, fixtures, and production hooks require explicit approval and an appropriate implementation workflow.

## Optional composition

When installed and loadable, `blast-radius` can use:

- `explain-code` for current mechanics;
- `clarify` for relevant rationale or expectation mismatches;
- project coding skills for language, framework, build, and test semantics;
- `unslop` for its final prose pass.

These integrations are optional. The core includes local fallbacks and does not fail or claim a companion ran when one is unavailable. Wide changes may use independent read-only reviewers when the host supports them, but one parent retains responsibility for synthesis.

## Access and privacy

Evidence stays local by default. Remote PRs, dependency sources, services, and running environments are accessed only when the user explicitly requests it and the boundary permits it. Secrets, sensitive personal data, and unrelated proprietary content are redacted from output.

## Boundaries

- `code-review` owns general defect and risk review.
- `blast-radius` owns explicitly invoked cross-boundary impact tracing and executable safety proof for a concrete change.
- `explain-code` owns ordinary current-code walkthroughs.
- `clarify` owns standalone rationale and expectation-mismatch investigations.
- `debug-error` owns diagnosis and repair of observed failures.
- `brainstorm` owns hypothetical future changes and design alternatives.

The skill analyzes and verifies. It does not fix findings, refactor code, edit documentation, or commit changes.

## Structure

- `SKILL.md`: self-contained targeting, tracing, evidence, proof, scaling, privacy, and output workflow.
- `README.md`: activation, examples, behavior, boundaries, structure, and provenance.
- `LICENSE`: retained upstream MIT notice.

The skill does not require a named model, provider, tool, command syntax, subagent type, runtime, or agent harness. Host-specific invocation appears only as an example.

## Origin and license

This local, vendor-neutral adaptation is inspired by [Cursor pstack `blast-radius`](https://github.com/cursor/plugins/blob/fd6dd6f7276956a532bb78a748a8d2818b6eb5f4/pstack/skills/blast-radius/SKILL.md), written by Lauren Tan.

The upstream skill is distributed under the MIT License. See `LICENSE` for the retained notice.
