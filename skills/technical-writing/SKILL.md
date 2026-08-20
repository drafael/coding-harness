---
name: technical-writing
description: Write, revise, or review substantial technical documentation and design artifacts for a defined reader and task. Use for READMEs, guides, tutorials, how-to documentation, reference material, runbooks, RFCs, ADRs, technical specifications, and implementation plans. Use a design workflow first when future behavior or architecture needs exploration. Use unslop, when available, for small style-only edits. Do not use for code-only work, routine messages, release notes, PR descriptions, commit messages, or verbatim text.
license: See LICENSE
---

# Technical writing

Help a defined reader complete a task or understand a technical subject without changing technical truth.

## Core contract

Apply these priorities in order:

1. Preserve facts, uncertainty, intent, and documented constraints.
2. Serve the intended reader and their goal.
3. Make the document accurate, navigable, and reproducible.
4. Improve sentences without flattening the author's useful voice.
5. Avoid style churn: correct prose does not need different wording merely to match a preference.

Never invent behavior, output, prerequisites, compatibility, measurements, citations, decisions, or rationale.

## Scope and boundaries

Use this skill for substantial technical documentation and design artifacts.

Do not use it for code-only tasks, marketing copy, product UI strings, controlled or verbatim text, release notes, PR descriptions, commit messages, or a small wording cleanup.

Related skills:

- When available, use `brainstorm` for consequential design exploration; otherwise use the host's workflow and mark unresolved decisions.
- When available, use `unslop` for small style edits and the final pass after substantial prose changes.
- When available, use `explain-code` to establish current mechanics for a document; otherwise inspect local evidence here.
- When available, use `clarify` for unresolved behavior mismatches or rationale; otherwise report the uncertainty instead of inventing an answer.

## Load references only when needed

- Read [references/document-modes.md](references/document-modes.md) for tutorials, how-to guides, reference, explanation, or unclear document structure.
- Read [references/sentence-and-procedure-style.md](references/sentence-and-procedure-style.md) for procedures, a substantial line edit, or ambiguity analysis.
- Read [references/format-guidance.md](references/format-guidance.md) for READMEs, runbooks, RFCs, specifications, ADRs, and plans.
- Read [references/review-checklist.md](references/review-checklist.md) for a full document audit.

## Establish the writing job

Identify:

- the intended reader;
- the outcome they need;
- what they already know;
- whether the task is drafting, revising, or reviewing;
- which repository evidence establishes technical truth.

Infer these from the request and project when the answer is clear. Ask one focused question when a missing fact would materially change the document.

## Protect and verify technical material

Do not silently alter code, commands, identifiers, paths, API names, configuration keys, structured data, quotations, citations, measurements, or explicit uncertainty. Never reproduce secrets or sensitive personal data in new prose or review output; use a redacted placeholder and report the exposure. Preserve domain terms when a simpler synonym would be less precise.

Verify material claims against the smallest relevant set of local sources: implementation, configuration, tests, generated output, and existing documentation. Use safe non-mutating checks when they can establish a command, example, link, or observable result. If evidence is unavailable or contradictory, qualify the claim, mark it for confirmation, or report the conflict. Do not guess.

## Choose document structure

For user documentation, select the reader need that dominates the document:

- **Tutorial:** guided learning through a complete, observable experience.
- **How-to:** practical steps toward a specific goal for a competent reader.
- **Reference:** accurate facts organized for lookup and aligned with the described system.
- **Explanation:** bounded understanding of rationale, constraints, concepts, or trade-offs.

Brief supporting material may remain when it helps the primary goal. Split or link material only when mixed purposes impede use.

RFCs, specifications, ADRs, and implementation plans serve decision or coordination needs outside the Diátaxis modes. Use their format guidance instead of forcing a mode.

## Draft or revise

1. Outline around the reader's goal and the selected mode or format.
2. For procedures, put prerequisites and the common path before variants and edge cases.
3. Add expected results where readers need confirmation.
4. Put conditions and warnings before the action they govern.
5. Include failure and recovery guidance when the reader can reasonably encounter the failure.
6. Use the repository's real names for symbols, files, flags, commands, and concepts.
7. Verify material claims and examples.
8. Revise only sections that need structural, factual, or clarity improvements.

Prefer direct sentences, explicit actors, consistent terminology, and one action per procedural step. Treat sentence length, passive voice, punctuation, and grammatical patterns as diagnostic signals rather than prohibitions. Keep clear, accurate constructions.

## Review

Prioritize findings by reader impact:

1. incorrect or unsupported instructions and claims;
2. missing prerequisites, conditions, expected results, or recovery;
3. mismatch between the reader's goal and the document's structure;
4. ambiguity or poor navigation;
5. inconsistent terminology;
6. sentence-level style.

Cite the affected section and evidence. Recommend the smallest correction that resolves the problem. Do not expand a review into an unsolicited rewrite. If the user requested edits, preserve unaffected text and report any claim that remains unverified.

## Finish

Validate local links, commands, examples, identifiers, headings, and formatting without mutating unrelated files. Check a remote target only when the user requested external verification and the access and privacy boundary permits it. After substantial prose changes, apply `unslop` when available; otherwise remove formulaic filler and check rhythm and voice against the core contract. Recheck technical meaning after either pass. Skip the prose pass for structural analysis and narrow factual corrections.

Report changed files and any unresolved contradiction or unverified claim.
