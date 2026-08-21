---
name: arena
description: Produce and compare at least two independent attempts at the same concrete artifact, then return one coherent synthesis with its verification result. Manual invocation only for direct use; an explicitly invoked workflow whose instructions permit arena delegation may run a bounded phase while retaining final judgment. Do not use to split a larger task into different work slices.
disable-model-invocation: true
license: See LICENSE
---

# Arena

Generate independent attempts at one artifact, select a coherent base, adapt compatible strengths, and verify the synthesis.

## Invocation and target

Run only after direct explicit invocation or as a bounded phase delegated by another explicitly invoked workflow whose own instructions permit arena delegation and that owns the result. Manual-only metadata does not authorize automatic use for every non-trivial task.

Require one concrete artifact, its intended consumer, applicable constraints, and a shared output contract. An artifact may be a design, code change, test set, technical document, query, migration, or another bounded deliverable. Arena is not a way to divide a larger task into different work slices.

A complete arena needs at least two completed candidates. One attempt may still be useful, but it is not an arena synthesis.

## Preserve access, privacy, and repository state

Keep evidence local by default. Do not send project content to remote sources, new providers, or running environments unless the user requested it and the established privacy boundary permits it. Give each candidate and judge only the minimum relevant context.

Do not reproduce credentials, tokens, private keys, cookies, sensitive personal data, or unrelated proprietary content. Use redacted placeholders and report exposures.

When a repository is involved:

- record its initial state before commands that may generate files;
- keep tracked files unchanged unless persistent artifact creation or implementation was explicitly authorized;
- never reset, clean, overwrite, stage, or delete pre-existing work;
- remove only temporary resources created by the arena;
- compare final state with the initial snapshot and report unexpected output;
- do not commit or push unless separately requested.

Candidate artifacts and synthesis records are response-first and ephemeral by default. If the user authorized a persistent destination, apply only the synthesized result there unless separate candidate files were also requested.

## Frame the shared task

The frame is the contract every candidate receives. Establish:

1. the exact artifact and intended consumer;
2. relevant evidence and repository instructions;
3. mutation, access, privacy, and compatibility boundaries;
4. the required output shape, including a concise rationale;
5. the strongest safe verification that applies;
6. observable, task-specific selection criteria.

Use the natural number of criteria. Three to six often fits a consequential artifact, but use fewer when they fully express the decision. Replace vague criteria such as “correct” or “clean” with observable behavior, constraints, or maintenance properties.

Resolve material frame ambiguity before generating candidates. If later candidates diverge because the frame was incomplete, revise it instead of averaging the results.

## Scale and isolate candidates

Honor a safe user-specified candidate count when it is at least two. Without a requested count, use two for bounded work. Add a third only when broader structural exploration is likely to change the result. More attempts need a concrete benefit that justifies their cost and privacy exposure.

Prefer parallel candidates in independent contexts and isolated locations when the environment supports them. Candidates must not read one another or share a mutable destination before judging.

When safe parallel isolation is unavailable, create sequential attempts from the same frame. Keep each attempt complete, avoid referring to earlier candidates while producing later ones, and disclose that parent-only sequential generation has weaker independence. Use response-only candidate artifacts when separate writable locations are unavailable.

If candidates need to create files, give each an isolated location. Only the owning workflow writes the selected synthesis to the user-approved destination.

## Generate complete candidates

Give every candidate the same frame, evidence boundary, criteria, and output contract. Require:

- one complete artifact rather than a list of suggestions;
- a concise rationale naming load-bearing choices;
- credible alternatives actually considered and material rejections, if any;
- stated unknowns and verification limits.

Differences between candidates are useful. Do not instruct later attempts to produce cosmetic variation, converge on a compromise, or improve a previous candidate. Do not expose candidate identities or origins when they are irrelevant to judgment.

## Handle dropouts

A weak but complete result is a candidate. Missing, partial, corrupt, inaccessible, or contract-breaking output is an execution failure.

Replace a failed candidate when another attempt is safe and proportionate. Otherwise report the dropout. If fewer than two complete candidates remain, stop and return an incomplete-arena result; do not pick and synthesize under the arena label.

## Judge proportionally

The owning parent must read every candidate end to end and score every criterion. Record evidence for material score differences instead of relying on familiarity or surface polish.

An independent read-only judge is optional. Use one only when the artifact is consequential, candidates are close or conflicting, and another isolated context is safely available within the privacy boundary. Give it the frame, rubric, and completed candidates only after candidate generation has ended.

The judge may score and recommend, but it may not edit candidates or decide the final result. The parent resolves disagreement and retains responsibility for selection and synthesis. Never require a different model, provider, or host to create independence.

## Pick and synthesize

Select the base that best satisfies the rubric, protects invariants, fits its consumer, and remains maintainable under likely current changes. Prefer a smaller or clearer surface when candidates otherwise tie and the simpler surface still provides the required capability.

Review each losing candidate for compatible strengths. Adapt a useful idea into the base's terminology, ownership, structure, and invariants. Do not concatenate outputs, paste incompatible sections together, or force every candidate to contribute.

Record meaningful adaptations and rejections:

- If candidates converge, record the agreement and keep the coherent consensus; no graft is required.
- If they diverge widely on fundamentals, treat that as evidence of an ambiguous frame. Revise the frame and rerun rather than averaging incompatible mental models.
- If a losing idea would break the base's invariants or ownership, reject it even when it scored well in isolation.

## Verify the synthesis

Verify the synthesized artifact against the original criteria with the strongest safe, proportionate checks available for that artifact. Prefer existing focused checks and non-mutating validation before creating custom machinery.

State the exact boundary exercised. A source review does not prove runtime behavior; a unit test does not prove an external integration; a mock proves only the behavior around the mocked boundary. Report unverified integration behavior as unverified.

If verification fails, determine whether the frame omitted a requirement, the wrong base was selected, or synthesis introduced the defect. Return to that phase rather than patching the final artifact blindly. Do not add production hooks solely to manufacture proof.

## Return the result

Return one synthesized artifact and a concise synthesis record containing only applicable items:

- parallel or disclosed sequential execution mode;
- completed candidates and dropouts;
- criterion-level scores and decisive evidence;
- selected base and reason;
- adapted ideas and their sources;
- meaningful rejections;
- independent judge input, if used, and how disagreement was resolved;
- verification performed, result, and remaining gaps.

Keep candidates and the synthesis record in the response unless the user requested persistence. Before finishing, confirm that at least two candidates completed, the parent read them fully, the final artifact follows one coherent model, verification did not exceed its evidence, and repository and privacy boundaries were preserved.
