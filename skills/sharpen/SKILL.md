---
name: sharpen
description: Deepen a task without broadening its scope, then rewrite its prompt. Manual invocation only; use when the user explicitly invokes sharpen or requests this prompt-sharpening workflow. Do not execute the rewritten task or decide choices the user owns.
disable-model-invocation: true
license: See LICENSE
---

# Sharpen

Make the task deeper, not bigger. Improve the quality of the investigation and its evidence without adding deliverables or neighboring projects.

Run only after an explicit request. Use the supplied task or the clearly identified task in the conversation. If neither is available, ask for the prompt to sharpen.

Before rewriting it, give four concrete answers:

1. **Professional standard:** What would a strong practitioner in this field do here that the task does not yet ask for?
2. **Raw material:** What primary evidence would they start from instead of an already-digested account? Name the relevant source code, records, observations, data, or original sources.
3. **Methods and tools:** Which specific techniques and available tools fit this task? Distinguish suggestions from capabilities or access actually available.
4. **Independent check:** What observable result, reproducible check, external criterion, or qualified review would establish correctness beyond either person's opinion?

Then provide a rewritten prompt that asks for exactly that deeper work. Preserve the original goal, constraints, effort budget, and user-owned choices. Mark necessary unknowns rather than inventing requirements, evidence, access, or acceptance criteria.

Do not turn the exercise into brainstorming alternatives, implementation, or an investigation of the subject. Propose the methods; do not run them. Return the four answers followed by the rewritten prompt, then stop.
