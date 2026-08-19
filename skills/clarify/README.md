# Clarify skill

Investigates mismatches between expected and actual behavior, explains current mechanics, and distinguishes intended behavior from configuration, documentation, implementation, and design problems.

It can also investigate historical design rationale when the question asks why a decision, threshold, workaround, or constraint exists.

## Example requests

- "I don’t understand why this endpoint returns 404 only in production."
- "Shouldn’t this configuration flag enable retries?"
- "I expected X but got Y. What is happening?"
- "Why was this limit set to 100?"
- "Is this behavior intentional or a regression?"

## Structure

- `SKILL.md` contains the compact routing, diagnosis, explanation, and assessment workflow.
- `references/historical-rationale.md` contains the scalable design-archaeology playbook.
- `references/evidence-and-confidence.md` contains confidence levels, citation discipline, contradiction handling, and gap reporting.

`SKILL.md` is self-sufficient for routine expectation mismatches. Supporting references are intended for on-demand loading when the host supports it. The instructions do not depend on a named model, provider, tool, command syntax, runtime, or agent harness.

## Design principles

- Treat misunderstanding and defects as competing hypotheses.
- Separate current mechanics from historical intent.
- Support claims with evidence and calibrate inferences.
- Preserve contradictions and admit unknowns.
- Scale investigation effort to impact and ambiguity.
- Clarify before changing anything.

## Origins and license

This vendor-neutral compilation adapts ideas from:

- [Umputun’s `clarify`](https://github.com/umputun/cc-thingz/tree/master/plugins/workflow/skills/clarify).
- [Cursor pstack `why`](https://github.com/cursor/plugins/tree/main/pstack/skills/why).

Both upstream works are distributed under the MIT License. See `LICENSE` for the retained notices.
