---
name: bro
description: Restate the assistant's last message in plain, concise human language without jargon. Manual invocation only; use when the user explicitly invokes bro or asks for that restatement. Do not turn it into a new explanation or investigation.
disable-model-invocation: true
license: See LICENSE
---

# Bro

Restate your last substantive message as one person talking to another. Use plain words, short sentences, and less jargon.

Run only after an explicit request. Rewrite the message; do not investigate, use tools, change files, or take the next step in the task.

- Preserve its meaning, facts, uncertainty, warnings, and any decision waiting on the user.
- Explain an unavoidable technical term briefly rather than replacing it with something inaccurate.
- Keep identifiers, commands, links, or paths when the user needs them to act; otherwise leave out distracting detail.
- Do not add claims, forced slang, a patronizing tone, or a summary that loses the point.

Return only the restatement, without a preamble or a change report. If no earlier substantive assistant message is available, say so briefly instead of inventing one.
