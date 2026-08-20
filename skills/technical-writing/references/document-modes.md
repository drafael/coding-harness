# Document modes

Use this reference when selecting or applying a mode to user documentation, or when its structure is unclear.

Diátaxis maps documentation across two questions:

1. Does the reader need to act or understand?
2. Are they learning the practice or applying it to current work?

The answers suggest four modes. Use the mode as a compass, not a requirement to create four top-level sections or four separate files.

## Tutorial

**Reader need:** acquire skill by completing a guided experience.

Open with the concrete result the learner will produce and any essential prerequisites. Lead the reader through a reliable path in a deliberate order. Each meaningful stage should produce something observable: output, a changed state, a running component, or another result that confirms progress.

Use an encouraging instructional voice. Explain only enough theory to keep the learner oriented; link deeper discussion when a teaching detour would interrupt the experience.

A tutorial is complete when a prepared learner can follow it from beginning to end and obtain the stated result.

Common failures:

- presenting disconnected examples without a finished outcome;
- assuming knowledge that the tutorial exists to teach;
- hiding expected results;
- adding exhaustive options or conceptual essays mid-procedure;
- blaming the learner when a step is fragile.

Keep short factual notes that help the learner continue. Link substantial reference tables or explanations. Split material when the learning path stops being visible.

## How-to guide

**Reader need:** accomplish a specific goal while applying existing knowledge.

Name the guide after the goal. Start with prerequisites or constraints that determine whether the guide applies, then give the shortest dependable route through the common case. Include forks only when readers must choose among real alternatives.

Assume competence with the surrounding system. Explain decisions that affect the task, but avoid teaching the entire domain or documenting every option.

A how-to guide is complete when the intended reader can recognize whether it applies, perform the task, confirm success, and recover from likely failures.

Common failures:

- organizing around a component rather than a user goal;
- burying prerequisites after the first destructive or expensive action;
- expanding into a tutorial for beginners;
- duplicating reference material;
- omitting confirmation or rollback where it matters.

Keep concise command or option details needed for the task. Link complete reference material and broad conceptual background.

## Reference

**Reader need:** retrieve accurate information while working.

Organize the document to mirror the described system or another stable lookup model. State signatures, options, defaults, constraints, outputs, errors, compatibility, and examples only when evidence establishes them. Use consistent terms and predictable headings.

Keep the voice factual and concise. Reference may include short examples that clarify a fact, but it should not depend on a guided narrative or argue for a design.

Reference is complete when its declared surface is covered accurately and readers can find an answer without reading the document from beginning to end.

Common failures:

- undocumented defaults or error behavior;
- examples that contradict the current interface;
- organizing around the author's discovery process;
- mixing recommendation and opinion into factual descriptions;
- duplicating generated information by hand without a maintenance path.

Link task guidance and design rationale unless a brief note is necessary to interpret a fact safely.

## Explanation

**Reader need:** understand a bounded topic, decision, mechanism, constraint, or trade-off.

Open with the question or concept the document resolves. Establish relevant context, then connect causes, constraints, alternatives, and consequences. Distinguish documented rationale from inference and current behavior from historical intent.

Use a reasoned voice. Explanation may take a position when evidence supports it, but it must represent uncertainty and meaningful alternatives honestly.

Explanation is complete when the reader can account for the important relationships and trade-offs without needing the product open in front of them.

Common failures:

- describing mechanics without answering why they matter;
- inventing historical intent from code shape;
- listing pros and cons without reaching a supported conclusion;
- turning the document into an implementation procedure;
- expanding beyond one coherent subject.

Keep short examples that make the concept concrete. Link operational steps and exhaustive interface details.

## Mixed documents

Choose the mode that serves the document's primary reader outcome. Supporting material is acceptable when it is brief and prevents a disruptive context switch.

Split or link material when one of these symptoms appears:

- readers must skip large sections to continue their task;
- a section uses a different audience or assumed knowledge;
- updates follow a different source of truth or release cadence;
- the table of contents no longer reveals the primary path;
- factual lookup, procedural work, and rationale compete for the same structure.

Do not split merely to satisfy the framework. A well-placed prerequisite, example, or rationale note can serve the primary mode without becoming a second document.

## Sources

- [Diátaxis foundations](https://diataxis.fr/foundations/)
- [The Diátaxis compass](https://diataxis.fr/compass/)
