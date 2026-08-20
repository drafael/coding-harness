# Technical document review checklist

Use this checklist for a full audit. Stop when the remaining changes are preferences rather than reader-facing improvements.

## 1. Check technical correctness

- Does repository evidence support each material claim?
- Are commands, options, identifiers, paths, defaults, outputs, errors, and compatibility statements current?
- Do examples match the documented interface and starting state?
- Are generated facts produced from their source where possible?
- Are citations and quotations accurate and preserved?
- Does the document retain uncertainty instead of presenting assumptions as facts?
- Are contradictions between implementation, configuration, tests, and documentation reported explicitly?

Treat an unsupported claim as unverified. Check it locally, qualify it, remove it, or ask for confirmation. Do not repair a gap by inventing a plausible value.

## 2. Check the reader and structure

- Is the intended reader identifiable?
- Is their goal or question clear near the beginning?
- Does the document assume an appropriate level of knowledge?
- For user documentation, is tutorial, how-to, reference, or explanation the dominant mode?
- For a design artifact, does its format support the decision or coordination task?
- Does supporting material help the primary goal, or does it interrupt it?
- Would splitting or linking content make the document easier to use?

Do not reorganize a working document merely to produce a textbook Diátaxis layout.

## 3. Check navigation and completeness

- Does the title describe the reader's task or subject?
- Do headings reveal the path through the document?
- Is the common case easy to find?
- Are prerequisites and applicability visible before readers act?
- Are important variants placed where the decision occurs?
- Are links descriptive and still valid?
- Is duplicated material likely to drift?
- Is any section present only because a template included it?

Completeness depends on the declared scope. A focused guide can be complete without documenting the entire system.

## 4. Check procedures and reproducibility

- Does each ordered step contain a clear imperative action?
- Are applicability conditions, warnings, and safety constraints placed before that action?
- Does a step contain several actions that need separate confirmation or recovery?
- Are placeholders distinguishable from literal values?
- Do important steps state a stable expected result?
- Are likely failure and recovery paths documented?
- Can the intended reader perform the procedure from the stated starting point?
- Were commands and examples checked with safe, non-mutating validation where possible?

Do not execute destructive, privileged, publishing, deployment, or externally mutating commands merely to validate prose. Default to local evidence. Run a remote read-only check only when the user requested external verification and it stays within the established access and privacy boundary. Otherwise, report the path as unverified.

## 5. Check clarity and terminology

- Does each component or concept use one stable name, except where readers must understand distinct names exposed by the system?
- Are real symbols, flags, files, and configuration keys used?
- Does each pronoun have one obvious referent?
- Are limiting words such as “only” next to what they modify?
- Can dense noun strings be unpacked into clearer relationships?
- Are instructions direct and facts stated plainly?
- Does passive voice hide responsibility that readers need to know?
- Are headings in sentence case and lists grammatically parallel?
- Can filler be removed without changing meaning?

Use sentence length and punctuation as diagnostic signals. Do not rewrite accurate text solely to remove a semicolon, dash, parenthesis, passive construction, or specialized term.

## 6. Apply the final prose pass

After drafting or substantially rewriting prose, use the [core final prose pass](../SKILL.md#finish).

Then verify:

- no fact, condition, or uncertainty changed;
- no identifier, command, quotation, citation, or measurement drifted;
- no artificial personality or unsupported opinion was added;
- unaffected prose was not churned;
- the result still matches the selected document mode or design-artifact format.

## Report findings

Order findings by reader impact:

1. technical errors and unsafe instructions;
2. missing prerequisites, conditions, expected results, and recovery;
3. audience or structural mismatch;
4. ambiguity and navigation;
5. terminology;
6. style.

For each finding, identify the affected section, show the supporting evidence, explain the reader impact, and recommend the smallest correction. Distinguish verified defects from unverified concerns. If no reader-facing problem remains, say so rather than manufacturing style findings.
