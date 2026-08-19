# Synthesis rubric

Use this rubric to reconcile reviewer findings and decide what deserves a persistent proposal.

## Acceptance criteria

A proposed existing-skill edit must pass every applicable criterion.

### Evidence

The session contains a concrete correction, failure, decision, repeated pattern, or missed trigger. Prefer a retained turn or safely reconstructed active-branch entry. Digests, branch summaries, and compaction summaries are secondary evidence and cannot alone justify a persistent edit. A plausible opinion without a session anchor is insufficient.

### Durability

The lesson should remain useful after paths, identifiers, versions, model names, and code shapes change. Preserve the invariant, not the snapshot.

### Specificity

The rule is precise enough that a future agent can recognize its trigger and action. Reject advice such as “be careful,” “test thoroughly,” or “write better code.”

### Decision-changing effect

A future agent would do something observably different. Additional prose that merely restates values or explains motivation without changing behavior does not qualify.

### Applicability boundary

The proposal states when it applies and when it does not. Reject absolute guidance derived from a narrow incident.

### Existing-home-first

Route to the skill that owns the demonstrated workflow. A new-skill candidate is justified only when no existing skill is a credible home and the pattern is stable enough to deserve its own activation boundary.

### Current-content check

Read the target skill before accepting the proposal. If clear, prominent guidance already covers it, reject as already covered. If the rule exists but failed because it is buried or ambiguous, propose a placement or wording improvement rather than duplication.

### Trigger relevance

A body edit normally requires that the target skill was used in the session. A skill that should have activated but did not may receive a description-tuning proposal. Do not route generic findings to skills unrelated to the session.

### Structural-mechanism check

If a script, validator, test, metadata rule, type system, or runtime control can enforce the lesson cheaply and more reliably, classify it as a structural candidate instead of a skill edit.

### Collision check

Compare the target description and behavior with neighboring skills. The proposal must sharpen ownership rather than create overlapping triggers or contradictory workflows.

### Proportionality

The expected benefit must justify permanent prompt weight. Prefer a narrow sentence change over a new section, and a lazy reference over expanding every activation.

## Confidence guidance

- **Direct correction:** the user explicitly corrected behavior or stated a bounded preference. Can support a narrow proposal.
- **Repeated evidence:** the same failure or successful decision appeared more than once. Strong evidence when the boundary is stable.
- **Supported inference:** several session facts converge, but no explicit correction exists. Phrase the proposal cautiously and preserve alternatives.
- **Tentative candidate:** one successful technique or ambiguous event. Normally reject or report as unknown rather than persist.

Do not turn absence of complaint into approval or one successful run into a universal workflow.

## Finding reconciliation

Merge findings that describe the same failure mode. Preserve the strongest evidence and narrowest supported boundary.

When reviewers disagree:

1. compare their evidence;
2. inspect the relevant transcript moment and target skill;
3. prefer the interpretation that adds fewer assumptions;
4. retain competing interpretations as unknown when evidence does not resolve them.

Reviewer convergence raises confidence but does not override weak evidence. A well-supported singleton may be stronger than three copies of the same speculation.

## Classifications

### Proposed existing-skill edit

Passes the rubric and targets an existing skill body or description. Pending individual user approval.

### Structural candidate

Better enforced mechanically. Describe the suggested mechanism, but do not implement it in the first version.

### New-skill candidate

No credible existing home. Describe the activation boundary and repeated need, but do not create it in the first version.

### Rejected

Use one concise reason:

- weak evidence;
- one-off or overfit;
- already covered;
- duplicate finding;
- vague or non-decision-changing;
- drifting implementation detail;
- wrong target;
- structural mechanism preferred;
- activation collision;
- outside current-session scope.

### Unknown

The session raises a useful question but cannot support a durable conclusion. Name the missing evidence rather than inventing it.

## Presentation format

Present proposed edits as a numbered list:

```text
1. <short proposal title>
   Evidence: <session anchor, redacted where needed; label secondary evidence>
   Target: <skill path and section>
   Change: <intended behavior change>
   Why durable: <reason>
   Confidence: <level>
   Boundary: <applies / does not apply>
   Checks: <collision and mechanism assessment>
```

Then summarize structural candidates, new-skill candidates, rejected findings, and unknowns. Ask the user to approve proposal numbers and stop before editing.
