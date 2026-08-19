# Boundary-focused examples

These examples demonstrate editing constraints, not fixed wording. Never add facts that the source does not contain.

## Puffery without invention

**Before**

> The release marks a pivotal moment in our ongoing journey, underscoring our commitment to a seamless developer experience.

**After**

> The release adds automatic retry configuration and reports failed attempts in the build log.

Use this rewrite only when those features are present in the source context. Otherwise remove the puffery without supplying new features.

## Vague attribution

**Before**

> Industry experts believe the change will significantly improve adoption.

**After when no source is available**

> The team expects the change to improve adoption.

Use that version only if the source identifies the team as holding the expectation. Otherwise remove the sentence or ask for a source.

## Preserving uncertainty

**Before**

> The policy could potentially reduce processing delays.

**After**

> The policy may reduce processing delays.

Do not rewrite `may` as `will`.

## Protecting code and identifiers

**Before**

> Call `client.createSurface()` to create the API surface. The method returns `undefined` when the feature is disabled.

**After**

> Call `client.createSurface()` to create the API surface. The method returns `undefined` when the feature is disabled.

Here, `surface`, the identifier, and the return value are precise. No edit is needed.

## Contextual punctuation

**Before**

> The migration has one hard requirement: PostgreSQL 16 or later. Older versions are not supported.

**After**

> The migration has one hard requirement: PostgreSQL 16 or later. Older versions are not supported.

The colon introduces an explanation and should remain.

## Removing repetitive punctuation

**Before**

> The cache is fast—but only when warm—and it can hide stale reads—which makes debugging harder.

**After**

> The cache is fast when warm, but it can hide stale reads. That makes debugging harder.

The problem is repetition, not the existence of an em dash.

## Passive voice with and without a useful actor

**Before**

> Requests are validated before execution.

**After when the actor matters**

> The gateway validates requests before execution.

Keep the original when the actor is unknown or irrelevant.

## No invented first person

**Before**

> Some users find the unattended agent behavior concerning.

**Wrong**

> I find it unsettling to imagine agents working at 3 a.m.

**Better without a named source**

> Unattended agent execution concerns some users.

Do not create an opinion or experience for the author.

## Preserve exact quotations

**Before**

> The report describes the result as “a pivotal shift in the landscape.” The accompanying data shows a 4% change.

**After**

> The report describes the result as “a pivotal shift in the landscape.” The accompanying data shows a 4% change.

The stock language is inside a direct quotation. Critique it outside the quote if needed; do not rewrite it.

## Technical metaphor versus technical term

**Before, empty metaphor**

> The service provides a robust substrate that acts as a flywheel for innovation.

**After**

> The service stores shared configuration and distributes updates to workers.

Use the replacement only when the source establishes those mechanisms.

**Before, precise term**

> Reducing the public API surface limits the operations available to plugins.

**After**

> Reducing the public API surface limits the operations available to plugins.

`API surface` is precise here.

## Correspondence without chatbot scaffolding

**Before**

> Great question! Of course, here is the revised schedule. I hope this helps. Let me know if you need anything else.

**After**

> Here is the revised schedule.

Keep a greeting or closing when it serves the actual relationship rather than acting as automatic scaffolding.
