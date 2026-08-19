---
name: clarify
description: Investigate and explain mismatches between expected and actual behavior, unclear system behavior, and questions about design rationale. Use when someone is confused, frustrated, asks why something happens or was designed a certain way, or suspects documentation, configuration, or implementation is wrong.
license: See LICENSE
---

# Clarify

Turn confusion into an evidence-backed explanation. Determine what happens, what was expected, why the gap exists, and whether anything should change.

## Core posture

Do not assume the person is mistaken or that the system is broken. Treat both as hypotheses.

Separate these questions:

- **Mechanics:** What does the system do now, and how?
- **Expectation:** What did the person expect, and what contract supports that expectation?
- **Rationale:** Why was the current design chosen or retained?
- **Assessment:** Is this intended behavior, a configuration or documentation problem, a defect, or still unknown?

Code can establish current mechanics. Code shape alone rarely proves historical intent. Comments, tests, commits, reviews, tickets, documents, incidents, and conversations may provide rationale.

## Load references only when needed

Routine behavior mismatches should use this file alone.

- Read [references/historical-rationale.md](references/historical-rationale.md) for design intent, rejected alternatives, unexplained thresholds, regressions, postmortems, or “why does this code still exist?”
- Read [references/evidence-and-confidence.md](references/evidence-and-confidence.md) when rationale is indirect, sources conflict, the answer is consequential, or confidence must be calibrated explicitly.

## Route the question

Classify the request before investigating:

1. **Current behavior mismatch:** expected X, observed Y.
2. **Mechanics question:** asks what or how the system behaves.
3. **Historical rationale:** asks why a design, constraint, threshold, or workaround exists.
4. **Potential defect:** observed behavior appears to violate a contract or reasonable expectation.
5. **Mixed:** requires separate answers about current mechanics and historical motivation.

Use conversation context when the target is clear. Ask one focused question only when investigating the wrong target would waste meaningful effort or risk changing the wrong thing.

## Investigate current behavior

1. State the expected and observed behavior in concrete terms. Do not invent either side.
2. Identify the relevant target: files, symbols, configuration, inputs, environment, and version.
3. Inspect the smallest useful evidence set:
   - implementation and callers;
   - configuration and defaults;
   - tests and documented contracts;
   - runtime output, logs, or reproduction evidence when available;
   - recent changes when behavior may have shifted.
4. Trace the relevant data or control flow when a local reading is insufficient.
5. Compare implementation, documentation, configuration, and observation. Record contradictions instead of smoothing them over.

Do not guess from framework conventions when repository evidence is available. Do not broaden into historical archaeology unless the question asks for intent or current evidence cannot explain the discrepancy.

## Investigate rationale

For historical-intent questions, load the rationale reference and scale the search to the decision’s impact and ambiguity. Anchor the search in concrete code, then inspect available history and decision records. Treat the user’s proposed explanation as one hypothesis, not the conclusion.

Claims about intent require explicit evidence or calibrated inference. A source search that returns nothing establishes only that the search found nothing, not that no rationale ever existed.

## Assess the result

Use the narrowest supported outcome:

- **Intended behavior:** implementation matches the relevant contract.
- **Mental-model mismatch:** the expectation came from a different version, project, concept, or undocumented assumption.
- **Configuration issue:** supported behavior is disabled or configured differently.
- **Documentation issue:** behavior is coherent, but the documentation is missing, stale, or misleading.
- **Implementation defect:** behavior violates the contract or produces an unintended result.
- **Design concern:** behavior is intentional but the trade-off is no longer acceptable.
- **Unknown:** available evidence does not resolve the question.

Do not label something “user error.” Explain the specific mismatch and its evidence.

## Explain

Match the response to the complexity of the question. A simple misunderstanding may need only a short paragraph. Use sections only when they improve navigation.

A complete explanation normally covers:

- what was expected;
- what actually happens;
- the evidence that establishes each;
- why the gap exists, distinguishing documented rationale from inference;
- the assessment and next action, if any.

Cite file paths and line ranges for mechanics. Cite commits, reviews, tickets, documents, incidents, or comments for historical intent. Name important gaps and contradictory evidence.

Keep the tone direct and respectful. Acknowledge that the expectation was understandable when the contract, naming, or documentation reasonably suggests it. Avoid canned reassurance, blame, and unnecessary tutorials.

## Deciding whether to fix

Clarification comes before modification. If the user requested only an explanation, do not silently edit code or documentation.

When evidence confirms a problem:

1. State the problem and its impact.
2. Describe scope as trivial, localized, moderate, significant, or architectural, with a reason.
3. Present alternatives only when real trade-offs exist.
4. Ask for confirmation when the fix expands scope, changes behavior, or was not requested.
5. Use a planning workflow when the change needs one; otherwise provide or apply the smallest appropriate fix using the host’s available capabilities.

Do not force a formal plan for a trivial correction, and do not implement a consequential change merely because the investigation found one.

## Final check

Before answering, verify:

- Did I distinguish mechanics, expectation, rationale, and assessment?
- Is every claim supported, clearly inferred, or marked unknown?
- Did I treat the user’s hypothesis independently?
- Did I preserve contradictions and evidence gaps?
- Is the response proportional to the question?
