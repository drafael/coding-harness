# Explain code skill

Explains current code behavior, structure, control flow, data flow, and component ownership at the depth requested.

## Example requests

- "Explain how this module works end to end."
- "Walk through this function line by line."
- "What happens after this event is published?"
- "Map the request flow and show where state changes."
- "Which component owns this data?"

## Boundaries

- `explain-code` describes current mechanics.
- `clarify` handles expectation mismatches and historical rationale.
- `code-review` finds defects and architectural concerns.
- `refactor-code` changes existing structure.
- `brainstorm` explores future designs and ownership options.

## Structure

- `SKILL.md` contains the compact routing, evidence, exploration, and explanation workflow.
- `references/exploration-playbook.md` covers multi-file and subsystem tracing.
- `references/explanation-patterns.md` provides adaptive structures for common flows.
- `references/language-notes.md` covers language semantics when they affect behavior.

`SKILL.md` is self-sufficient for routine explanations. References are intended for on-demand loading when the host supports it. The instructions do not depend on a named model, provider, tool, command syntax, runtime, or agent harness.

## Design principles

- Trace actual code instead of guessing from names.
- Scale depth to the question.
- Separate mechanics, documented contracts, and historical intent.
- State unresolved gaps.
- Do not turn explanation into unsolicited review or refactoring.
- Use diagrams only when they clarify a relationship.

## Origins and license

This vendor-neutral compilation adapts ideas from:

- [Quintin Henry’s Claude Command Suite `explain-code`](https://github.com/qdhenry/Claude-Command-Suite/blob/main/.claude/commands/dev/explain-code.md).
- [Cursor pstack `how`](https://github.com/cursor/plugins/tree/main/pstack/skills/how).

The first upstream repository identifies itself as MIT in its README badge but does not provide a separate license text or copyright notice. Cursor pstack `how` is MIT-licensed. See `LICENSE` for details and the retained pstack notice.
