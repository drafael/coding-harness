# Unslop skill

Edits prose to remove formulaic AI-writing patterns while preserving facts, meaning, uncertainty, and the author's existing voice.

## Activation

Use for documentation, articles, reports, messages, release notes, and other prose-writing or editing tasks. It does not apply indiscriminately to code, exact quotations, structured data, or text that must remain verbatim.

Example requests:

- "Unslop this release note without changing its tone."
- "Make this documentation less formulaic."
- "Remove AI-sounding phrasing but preserve every factual claim."

## Structure

- `SKILL.md` contains the compact operational workflow and safeguards.
- `references/pattern-catalog.md` contains the full contextual pattern catalog.
- `references/examples.md` contains boundary-focused examples.
- `references/context-guide.md` covers genre-specific constraints.

`SKILL.md` is self-sufficient for routine work. Supporting references are intended for on-demand loading when the host supports it; a host without progressive disclosure can still use the core skill by itself.

The instructions do not depend on a named model, provider, tool, command syntax, runtime, or agent harness.

## Design principles

- Never invent facts, sources, statistics, quotations, opinions, or experiences.
- Preserve the author's voice instead of manufacturing personality.
- Treat vocabulary and punctuation as contextual signals, not banned forms.
- Protect code, quotations, citations, identifiers, data, and controlled wording.
- Return rewritten text only by default.

## Origins and license

This vendor-neutral compilation adapts ideas from:

- [blader/humanizer](https://github.com/blader/humanizer), based on Wikipedia's “Signs of AI writing” guidance.
- [Cursor pstack `unslop`](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop).

Both upstream works are distributed under the MIT License. See `LICENSE` for the retained notices.
