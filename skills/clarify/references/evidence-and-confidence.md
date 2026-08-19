# Evidence and confidence

Use this guide when explaining historical intent, handling contradictory sources, or making a consequential assessment from incomplete evidence.

## Separate mechanics from intent

Current mechanics can be established by implementation, tests, configuration, and runtime evidence. Historical intent requires an explicit rationale source or a clearly labeled inference.

A null check proves that the code handles null. It does not prove why the author added the check. A nearby comment, failing test, incident, review discussion, or ticket may establish that rationale.

## Confidence levels

### Direct

A source explicitly answers the question.

Examples include a comment explaining a limit, a review describing a rejected alternative, a ticket naming a customer requirement, or a design record stating the trade-off.

Use confident causal language and cite the source: “The limit is 100 because the upstream API rejects larger batches (`file:line` or decision record).”

### Supported

Several independent pieces of indirect evidence converge, but no source states the complete rationale.

Explain the chain and cite each important part: “The evidence points strongly to an incident-driven fix: the error spike preceded the change, the patch added a matching regression test, and the release notes describe the same failure.”

### Inferred

The interpretation is reasonable but not directly documented.

Use calibrated language: “appears to,” “likely,” “suggests,” “is consistent with,” or “one reading is.” State the chain: “Given A and B, C seems likely because D.”

### Speculative

The hypothesis is plausible, but evidence is thin or several explanations fit equally well.

Say so directly: “One possibility is X, but no contemporary source we found confirms it.” Present competing hypotheses rather than choosing the neatest story.

### Unknown

The available evidence does not answer the question.

Name what was searched, the terms or anchors used, and what was missing. “Unknown” is a useful result; do not fill the gap with a confident narrative.

## Citation discipline

Claims about mechanics should point to reproducible evidence such as code, tests, configuration, logs, or documented behavior. Claims about intent should point to comments, commits, reviews, tickets, design records, incidents, or attributable conversations.

Use the citation form natural to the source and environment. Examples include `path:line`, a commit identifier, review or ticket number, document link, incident identifier, or quoted message with author and date.

If a claim has no citation:

- classify it as inference or speculation;
- explain the inference chain;
- or remove it if it adds no value.

## Contradictions

When sources disagree, show both. Do not silently choose the source that creates the smoothest narrative.

Differences may reflect changing requirements, separate motivations, stale documents, or inaccurate records. If chronology resolves the conflict, show the timeline. Otherwise leave the conflict open.

## Missing evidence and null results

A search with no result proves only that the selected source, query, and accessible retention window produced no result. It does not prove that the decision was never discussed or documented.

For important gaps, record:

- source searched;
- search terms, symbols, identifiers, and date range;
- access or retention limits;
- whether the result was empty or merely inconclusive.

## Avoid rationalization and sycophancy

Do not work backward from code that looks sensible and assign it a clean historical motivation. Patterns may be copied, accidental, obsolete, or constrained by circumstances no longer visible.

When the question contains a proposed answer, test it independently. Report supporting and conflicting evidence. The person’s hypothesis is a lead, not a conclusion.

## Calibration check

Before finalizing:

1. Does each causal or intent claim have evidence?
2. Does the wording match its confidence level?
3. Have mechanics been mistaken for motivation?
4. Are contradictions visible?
5. Are missing sources and access limits described accurately?
6. Would a reasonable alternative explanation also fit the evidence?
