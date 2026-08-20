# Teach skill

Teaches repository-backed code and engineering work through a progressive, evidence-grounded conversation. It explains what something is and how it works. When rationale matters, it uses available evidence to explain why it was built that way. It does not change the repository.

## Activation

Manual only. Use the host's explicit skill-invocation mechanism. In Pi, run:

```text
/skill:teach
```

If a host does not enforce manual-invocation metadata, load the skill explicitly before asking it to teach. Ordinary code explanations remain with `explain-code`.

Example requests after invocation:

- "Teach me how request retries work in this service."
- "Help me understand this diff and why the state transition is necessary."
- "Teach me the event-processing subsystem one layer at a time."
- "Show me how this component fits into the application architecture."

## Behavior

- Infers the target, purpose, and useful starting depth from the conversation.
- Establishes mechanics from repository evidence and investigates rationale only when relevant.
- Separates observed behavior, documented rationale, inference, and unknowns.
- Starts with the smallest complete explanation and adds depth as the person responds.
- Uses code excerpts and diagrams only when they materially improve understanding.
- Remains read-only and routes requests for changes to another workflow.

When installed and loadable, `teach` can use `explain-code` for mechanics, `clarify` for rationale, and `unslop` for its final prose pass. These integrations are optional. The core includes local fallbacks and does not fail when companion skills are absent.

## Boundaries

- `explain-code` owns ordinary walkthroughs and current-code mental models.
- `clarify` owns standalone expectation mismatches and historical-rationale investigations.
- `code-review` owns defects, risks, and architectural criticism.
- `brainstorm` owns future designs and alternatives.
- `technical-writing` owns substantial standalone documents.
- `teach` owns explicitly invoked progressive learning about existing repository work.

## Structure

- `SKILL.md`: self-contained teaching, evidence, pacing, and visual workflow.
- `README.md`: activation, examples, boundaries, structure, and provenance.
- `LICENSE`: retained upstream MIT notice.

The skill does not require a named model, provider, tool, command syntax, subagent type, runtime, or agent harness. Host-specific invocation is documented only as an example.

## Origin and license

This local, vendor-neutral adaptation is inspired by [Cursor pstack `teach`](https://github.com/cursor/plugins/blob/fd6dd6f7276956a532bb78a748a8d2818b6eb5f4/pstack/skills/teach/SKILL.md), written by Lauren Tan.

The upstream skill is distributed under the MIT License. See `LICENSE` for the retained notice.
