---
name: unslop
description: Edit or review prose to remove formulaic AI-writing patterns while preserving facts, meaning, and the author's existing voice. Use for small style-only edits, articles, reports, messages, release notes, and other prose, or as the final pass after substantial technical writing. When technical-writing is available, use it first for substantial technical documentation and design artifacts. Do not use for code-only tasks or text that must remain verbatim.
license: See LICENSE
---

# Unslop

Make prose clearer, more specific, and less formulaic without changing who wrote it or what it claims.

When `technical-writing` is installed and loadable, use it first for substantial technical documentation and design artifacts, then return here for the final prose pass. Without it, keep this skill limited to prose-level editing; do not infer missing technical structure or facts.

## Core contract

Follow this order of priority:

1. Preserve facts, meaning, uncertainty, and intent.
2. Preserve the author's existing voice and level of formality.
3. Improve clarity, specificity, and rhythm.
4. Remove demonstrated AI-writing patterns.
5. Prefer natural variation over rigid style rules.

Never invent facts, measurements, names, quotations, citations, sources, interviews, anecdotes, opinions, emotions, or first-person experience. Do not add personality that the author did not supply. When a claim lacks support, remove it, retain its uncertainty, or ask for a source.

Treat pattern lists as diagnostic signals, not banned words. Keep a flagged word or construction when it is precise, necessary, quoted, or natural in context.

## Protect before editing

Do not silently alter:

- direct quotations or cited titles;
- code, commands, identifiers, paths, URLs, and structured data;
- measurements, dates, names, and factual claims;
- citations and attribution;
- legal, regulatory, or user-designated verbatim wording;
- domain terminology whose replacement would reduce precision.

Preserve intentional Markdown and document structure unless the user asks to change them.

## Load references only when needed

Routine rewrites should use this file alone.

- Read [references/pattern-catalog.md](references/pattern-catalog.md) for a full audit, a substantial rewrite, or when a checklist item is ambiguous.
- Read [references/examples.md](references/examples.md) when an example would resolve uncertainty or the user requests examples.
- Read [references/context-guide.md](references/context-guide.md) for technical, academic, legal, marketing, or casual prose when genre conventions affect the edit.

## Workflow

1. Identify the text's purpose, audience, genre, and existing voice.
2. Mark protected material and claims that must not drift.
3. Find actual problems using the checks below. Do not maximize the number of matches.
4. Rewrite only what needs work. Prefer concrete facts and direct syntax.
5. Read the result aloud in effect: check rhythm, clarity, and voice consistency.
6. Self-audit for remaining AI tells, factual additions, voice drift, and mechanical overcorrection.

## Compact checks

### Unsupported importance

Cut puffery, promotional claims, media name-dropping, vague authorities, generic praise, and optimistic conclusions unsupported by facts. Replace them with what happened, who said it, or what is planned.

### Formulaic reasoning

Review superficial `-ing` clauses, forced "not just X, but Y" contrasts, automatic groups of three, false "from X to Y" ranges, synonym cycling, and predictable "despite challenges" sections. State the point directly and use the natural number of items.

### Artificial diction

Prefer `is`, `has`, and plain verbs over inflated alternatives when meaning does not change. Remove filler, stacked hedges, stock transitions, and ornamental jargon. Do not replace precise technical terms merely because they appear on a warning list.

### Mechanical formatting

Review repeated em dashes, rhetorical colons, decorative bolding, inline-header lists, title-case headings, emojis, and inconsistent quotation marks. Correct overuse, not mere presence. Keep punctuation and formatting that serve grammar, typography, navigation, or the requested style.

### Chat artifacts

Remove canned greetings, praise, sycophancy, knowledge-cutoff disclaimers, "I hope this helps," and "let me know" endings when they are not part of the requested voice.

### Weak technical prose

Replace feelings and abstractions with mechanisms, instructions, facts, or measurements. Split sentences that require backtracking. Name the actor when it matters. Replace unsupported intensifiers with evidence. If a sentence could be pasted unchanged into another project's documentation, make it project-specific or cut it.

## Voice and rhythm

Preserve personality already present in the source. Vary sentence length when the prose is monotonous, but do not manufacture quirks or deliberate mess. Use first person only when the author already speaks in first person or explicitly requests it. Keep neutral writing neutral.

Active voice, short sentences, plain words, and minimal punctuation are preferences only when they improve the specific passage. Passive voice, adverbs, parentheses, colons, dashes, and specialized terms may be correct.

## Output

For a direct rewrite request, return the rewritten text only. Add a change summary only when requested or when consequential wording had to change.

When the environment supports file editing, modify the requested file and report its path concisely. Otherwise return the replacement text. Do not reproduce an entire document unless asked.

Before finishing, ask:

- Did I add any claim, source, opinion, or experience?
- Did the author's stance or certainty change?
- Did I damage quoted, technical, legal, or structured material?
- Did I replace one mannerism with another?
- Does the result sound natural for this author and context?
