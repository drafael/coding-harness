# Technical-writing skill

Writes and reviews substantial technical documentation for a defined reader and task. It combines document structure, local fact verification, procedural clarity, and a final prose-quality pass without imposing mechanical style rules.

## Activation

Use for substantial work on:

- READMEs and documentation landing pages;
- tutorials, how-to guides, reference documentation, and runbooks;
- RFCs, ADRs, technical specifications, and implementation plans;
- structural or technical reviews of those documents.

When `brainstorm` is available, use it first while future behavior, architecture, or other consequential design decisions need exploration. Otherwise, use the host's design workflow and mark unresolved decisions explicitly.

Example requests:

- "Write a README for this service from the current code and configuration."
- "Review this runbook for unsafe assumptions and missing recovery steps."
- "Turn these design notes into an RFC for the authentication change."
- "Restructure this API guide around the tasks users perform."

For style-only editing of messages, release notes, PR descriptions, commit messages, and other prose, use `unslop` when it is available. This skill does not own code-only work, marketing copy, UI strings, or controlled verbatim text.

## Behavior

The skill:

1. identifies the reader, their goal, and their assumed knowledge;
2. chooses a primary Diátaxis mode for user documentation or the appropriate format for a design artifact;
3. protects commands, identifiers, quotations, measurements, and other technical material;
4. verifies material claims against local repository evidence;
5. drafts or reviews around the reader's goal and highest-impact problems;
6. applies `unslop` after substantial prose changes when that skill is available, with a self-contained fallback pass;
7. reports contradictions and unverified claims instead of guessing.

Diátaxis guides tutorials, how-to guides, reference documentation, and explanation without imposing a rigid file taxonomy. RFCs, specifications, ADRs, and plans keep their own decision-oriented formats. Sentence rules are also diagnostic: passive voice, longer sentences, and varied punctuation remain valid when they are the clearest accurate choice.

## Structure

- `SKILL.md`: compact, self-sufficient workflow and skill boundaries.
- `references/document-modes.md`: primary-mode selection and mixed-document guidance.
- `references/sentence-and-procedure-style.md`: reader-focused, procedural, and ambiguity guidance.
- `references/format-guidance.md`: expectations for supported document families.
- `references/review-checklist.md`: staged technical-document audit.

Supporting references are loaded only when needed. The core does not depend on a named model, provider, tool, command syntax, runtime, or agent harness.

## Sources and license

This local adaptation is inspired by [Cursor pstack `technical-writing`](https://github.com/cursor/plugins/blob/b047069f4f3a73e87dd1f11f7913386d25876b91/pstack/skills/technical-writing/SKILL.md), written by Lauren Tan and distributed under the MIT License.

Its source-grounded guidance also draws from:

- [Diátaxis](https://diataxis.fr/)
- [Google developer documentation style](https://developers.google.com/style)
- [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
- John R. Kohl, *The Global English Style Guide*, [SAS sample chapter](https://support.sas.com/publishing/pubcat/chaps/60751.pdf)

The local text summarizes transferable principles rather than reproducing external specifications or controlled dictionaries. See `LICENSE` for the retained upstream MIT notice.
