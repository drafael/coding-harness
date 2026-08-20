# Format guidance

Use these patterns as selection guides, not mandatory templates. Preserve an established project structure when it serves the same reader need.

Tutorials, how-to guides, reference documentation, and explanation are covered in [document modes](document-modes.md). This reference contains only formats that need additional guidance.

## READMEs and landing pages

**Reader:** someone deciding what the project is, whether it fits their need, and where to begin.

A useful README usually establishes:

- what the project does in concrete terms;
- its intended users and important limits;
- the shortest verified path to installation or first use;
- where to find task guides, reference material, support, and contribution guidance.

Lead with the information needed to decide and begin. Keep exhaustive configuration, architecture, and troubleshooting in linked documents when they obscure the entry path. Do not claim maturity, performance, compatibility, or ease of use without evidence.

## Runbooks

**Reader:** an operator diagnosing or changing a live or operationally important system.

Make the trigger and scope explicit. Put access requirements, risk conditions, and stop criteria before commands. Distinguish diagnosis from remediation. Include expected signals after consequential steps and identify escalation, rollback, or recovery paths that actually exist.

Use copyable commands only after checking their syntax and assumptions. Mark placeholders visibly. Never include credential values, access tokens, or sensitive personal identifiers. Keep a non-secret internal identifier only when the procedure needs it and the document's access boundary permits it; otherwise use a descriptive placeholder. Identify destructive commands explicitly, state their scope, and put required warnings or recovery guidance before them.

Avoid broad system tutorials. Link stable reference and architecture material that an operator may need but should not read during the critical path.

## RFCs

**Reader:** reviewers deciding whether and how to adopt consequential behavior.

Establish the problem, goals, non-goals, constraints, proposal, affected boundaries, credible alternatives, risks, rollout considerations, and unresolved decisions. Include only sections that support the decision. Do not present the preferred option as inevitable; explain why it best fits the evidence and constraints.

## Technical specifications

**Reader:** implementers aligning on agreed behavior and interfaces.

State requirements separately from implementation details. Define important terms, interfaces, and data shapes. Cover invariants, ownership, failure behavior, compatibility, security boundaries, and acceptance evidence when material. Mark genuine TBDs explicitly, but do not require proposal alternatives or unresolved decisions after they have been settled. Link the governing RFC or decision record when one exists.

## Architecture decision records

**Reader:** a future maintainer who needs to understand one decision in context.

Record the decision, its status, the context and constraints that shaped it, considered alternatives, and expected consequences. Use the evidence available when the decision was made. Link related changes or documents where stable identifiers exist.

Keep the record focused on the decision. Do not turn it into a complete architecture guide or rewrite history after outcomes are known. Amend or supersede a record according to project convention rather than silently replacing the original rationale.

## Implementation plans

**Reader:** the person implementing or reviewing a bounded change.

Connect each step to an observable result or verification boundary. Name affected files or components only after inspecting the repository. Sequence work according to dependencies and identify behavior that must remain unchanged.

Include validation appropriate to the change and report unverified integration behavior as such. Separate required work from optional follow-ups. Do not add speculative abstractions, unrelated cleanup, or production mechanisms that exist only to support a test.

A plan is a revisable hypothesis. Implementation evidence may invalidate a step; update the plan or explain the deviation instead of following stale instructions mechanically.

## Material outside this skill

Use another workflow for:

- PR descriptions and commit messages;
- release notes and announcements;
- marketing pages;
- product UI strings;
- legal, policy, and other controlled wording;
- small style-only edits.

These formats have different audiences, constraints, or review processes. Shared clarity principles still apply, but this skill does not own their structure.
