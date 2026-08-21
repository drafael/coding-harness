# Arena skill

Produces at least two independent attempts at the same concrete artifact, then returns one coherent synthesis with its verification result.

## Activation

Manual for direct use. Use the host's explicit skill-invocation mechanism. In Pi:

```text
/skill:arena Produce three implementations of this parser contract and synthesize the strongest result.
```

An explicitly invoked workflow may delegate a bounded arena phase only when its own instructions permit that delegation and it keeps responsibility for the result. Manual-only metadata does not make arena an automatic step for ordinary work.

Example requests:

- "Arena two caller-first designs for this approved queue contract."
- "Produce three independent fixes for this bounded parsing bug, compare them against the existing tests, and return one patch."
- "Arena two test suites for these acceptance criteria."
- "Produce two versions of this migration runbook and synthesize the safer procedure."

A request for response-only candidates does not authorize file changes. Persistent candidate files or a final repository change require an explicit destination or implementation request.

## Behavior

1. Frames one shared artifact, consumer, output contract, evidence boundary, and task-specific rubric.
2. Uses at least two complete candidates. It honors a safe requested count; otherwise it starts with two and adds a third only when broader exploration is justified.
3. Prefers isolated parallel contexts. When unavailable, it creates sequential attempts from the same frame and discloses their weaker independence.
4. Requires a complete artifact and concise rationale from every candidate.
5. Has the owning parent read and score every candidate end to end.
6. Selects one base and adapts only compatible strengths into its mental model.
7. Verifies the synthesis against the original criteria and reports the boundary exercised.

If fewer than two candidates complete, the skill reports an incomplete arena instead of presenting a synthesis. Candidate convergence is useful agreement evidence. Wide divergence indicates that the frame needs revision rather than compromise.

## Judging

The parent always owns selection and synthesis. An independent read-only judge is optional for consequential, close, or conflicting results when another isolated context is safely available. It scores and recommends; it does not edit candidates or make the final decision. Arena never requires a different model, provider, or host.

## Persistence and repository safety

Candidates and synthesis records are response-first and ephemeral by default. Candidates never share a mutable destination. If file creation is authorized, candidates use isolated locations and only the synthesized result is applied to the approved destination unless the user also requested candidate files.

The skill preserves pre-existing work, does not reset, clean, stage, commit, or push without authorization, and reports unexpected generated output. Evidence remains local unless remote access is requested and permitted. Secrets, sensitive personal data, and unrelated proprietary content are not reproduced.

## Boundaries

Arena creates several attempts at the same artifact. It does not:

- split a larger job into unrelated work slices;
- treat the number of candidates as proof of quality;
- paste outputs together mechanically;
- replace code review, runtime testing, or artifact-specific verification;
- create persistent candidate directories by default.

`architect` may use arena for credible whole-shape alternatives. Another workflow may delegate a bounded arena phase only when it is explicitly active, its own instructions permit the delegation, and it retains final ownership.

## Structure

- `SKILL.md`: self-contained framing, isolation, candidate generation, judging, synthesis, verification, and output workflow.
- `README.md`: activation, examples, execution modes, boundaries, persistence, and provenance.
- `LICENSE`: retained upstream MIT notice.

The core is model-, provider-, tool-, runtime-, and harness-neutral. Host-specific invocation appears only as an example.

## Origin and license

This local, vendor-neutral adaptation is inspired by [Cursor pstack `arena`](https://github.com/cursor/plugins/blob/46125561306434d8a1d7745d540d8932ab0cd2a2/pstack/skills/arena/SKILL.md), written by Lauren Tan.

The upstream skill is distributed under the MIT License. See `LICENSE` for the retained notice.
