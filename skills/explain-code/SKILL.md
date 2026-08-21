---
name: explain-code
description: Explain current code behavior, structure, runtime flow, data flow, and component ownership. Use for ordinary walkthroughs, line-by-line explanations, subsystem mental models, and questions about what code does or how it works. Use teach, when explicitly invoked and available, for progressive learning; technical-writing, when available, for substantial standalone documentation; clarify for expectation mismatches or historical intent; code-review for finding problems; refactor-code for structural changes; brainstorm for unresolved future design; and architect, when explicitly invoked and available, for implementation-ready structural design.
license: See LICENSE
---

# Explain code

Build an accurate mental model of the code at the depth the question requires. Explain current mechanics from evidence in the repository, not from names, conventions, or plausible assumptions.

## Boundaries

This skill owns neutral explanation:

- what code does;
- how control and data flow through it;
- which types and components participate;
- where responsibilities currently live;
- which behavior is non-obvious.

Route other intents explicitly:

- Use `clarify` when observed behavior differs from expectations, the user asks whether behavior is wrong, or the question concerns historical design rationale.
- Use `code-review` when the user asks for defects, risks, architectural criticism, security findings, or improvement recommendations.
- Use `refactor-code` when the user wants code changed while preserving behavior.
- Use `brainstorm` when the user wants to explore unresolved future behavior, alternative ownership, or substantive design options.
- Use `architect`, when explicitly invoked and available, when an understood problem needs caller-first types, signatures, data structures, and module boundaries. Use this skill to supply its current-code mechanics and evidence.
- Use `teach`, when explicitly invoked and available, for a progressive learning conversation. Use this skill to supply its current-code mechanics and evidence.
- Use `technical-writing`, when available, when the deliverable is a substantial standalone document such as an architecture guide. Use this skill to establish the document's current-code mechanics and evidence.

Do not turn an explanation into an unsolicited review or redesign. Mention a likely defect only when it is necessary to explain the observed flow, and label it as unverified unless the evidence establishes it.

## Evidence rules

Read the actual implementation and relevant context. Never infer HTTPS, validation, sanitization, authorization, indexes, pooling, caching, complexity, error recovery, or other properties merely because they would be conventional.

Distinguish:

- **Observed mechanics:** established by code, tests, configuration, or runtime evidence.
- **Documented contract:** established by public interfaces, specifications, or documentation.
- **Historical intent:** requires explicit rationale evidence and belongs to `clarify`.
- **Unknown:** a connection or behavior that available evidence does not establish.

Cite relevant paths, symbols, and line ranges. State gaps rather than filling them with a plausible story.

## Load references only when needed

Routine function and module explanations should use this file alone.

- Read [references/exploration-playbook.md](references/exploration-playbook.md) for multi-file features, subsystem architecture, cross-component flows, or unclear entry points.
- Read [references/explanation-patterns.md](references/explanation-patterns.md) when choosing a structure for algorithms, requests, events, asynchronous work, database operations, or diagrams.
- Read [references/language-notes.md](references/language-notes.md) only when language semantics are central to the explanation.

## Assess scope and audience

Determine what the user wants to understand and how much context they need.

- **Narrow:** a line, expression, function, or small class. Explain directly.
- **Module:** several related functions or one component. Trace its entry points, state, dependencies, and outputs.
- **Subsystem:** multiple files, packages, services, or processes. Load the exploration playbook and build a component and flow map.

Infer the audience from the request and conversation. Default to a technically competent reader who is unfamiliar with this part of the codebase. Explain language basics only when they are relevant or requested.

If the target is ambiguous, use available context when one interpretation is clearly most likely. Ask one focused question when choosing the wrong target would produce a materially different explanation.

## Explore

Use the smallest evidence set that can answer the question:

1. Locate the target and its role in the project.
2. Find the entry point or caller that triggers it.
3. Follow calls and data transformations through the requested boundary.
4. Read central types, interfaces, configuration, and dependencies.
5. Identify inputs, outputs, state changes, side effects, and error paths.
6. Check tests or call sites when they clarify contracts or edge cases.
7. Record anything unresolved, surprising, or easy to misunderstand.

For complex subsystems, divide exploration into independent slices only when that reduces uncertainty. Parallel exploration is optional when the host supports it; never require named models, tools, or subagent types.

## Explain

Adapt the response rather than completing a fixed checklist. A subsystem explanation commonly includes:

- **Overview:** what the component does and where it fits.
- **Key concepts:** only the types or abstractions needed to follow the flow.
- **How it works:** the trigger, sequence, decisions, transformations, boundaries, and result.
- **Where things live:** a short map of important files and symbols.
- **Gotchas and gaps:** non-obvious behavior and anything the evidence did not resolve.

For a narrow request, skip unnecessary sections. If the user asks for line-by-line analysis, group obvious lines and spend detail on non-obvious behavior. For an algorithm, explain its invariant and steps before discussing complexity. State complexity only when it can be derived from the implementation and relevant data structures.

Use concrete language: “`OrderService.submit()` writes the record, then publishes `OrderCreated`” is better than “the service delegates processing.” Include short code excerpts only when they clarify a specific point.

Use a diagram only when it makes a multi-stage or cross-component relationship easier to understand. Choose a portable text or Mermaid representation supported by the environment. Skip decorative diagrams and do not duplicate clear prose.

## Final check

Before answering, verify:

- Did I answer the requested scope and audience level?
- Did I trace actual code rather than infer from names?
- Are mechanics separate from contract and historical intent?
- Did I cite the important files and symbols?
- Did I disclose unresolved gaps?
- Did I avoid unsolicited review, refactoring, and speculative claims?
