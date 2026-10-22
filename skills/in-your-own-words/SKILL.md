---
name: in-your-own-words
description: Restate the user's goals and the problem they are trying to solve to check understanding. Manual invocation only; use when the user explicitly invokes in-your-own-words or requests this understanding check. Do not solve the task or rewrite the assistant's last answer.
disable-model-invocation: true
license: See LICENSE
---

# In your own words

Restate what you understand the user wants to achieve and what problem they are trying to solve.

Run only after an explicit request. Use the user's request and relevant conversation, not imagined motivations.

- Explain the desired outcome and why the current situation does not meet it.
- Include stated constraints and non-goals when they materially affect the understanding.
- Distinguish what the user said from an inference; preserve unresolved choices and uncertainty.
- Use plain language, usually a short paragraph. Do not merely repeat their wording.

Do not investigate, use tools, change files, propose a solution, or start the work. Ask one focused question only if an ambiguity would materially change the goal. If the goal is not available in context, ask for it instead of guessing.

Return the restatement itself, with any necessary clarification question. Do not add a plan or a canned request for confirmation.
