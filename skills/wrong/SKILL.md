---
name: wrong
description: Reset after the user rejects the assistant's current answer, plan, implementation, or problem-solving direction. Use for "your approach is wrong", "start over", "try a different approach", or when the attempted solution has demonstrably failed. Do not use for ordinary reports that a system behaves incorrectly or differs from expectations; use clarify instead.
allowed-tools: Read, Grep, Glob, EnterPlanMode, AskUserQuestion
---

# Wrong — Reset and Re-evaluate

The user has rejected the current approach or the attempted solution has failed. Stop extending or defending it. Re-examine the problem from the beginning.

## Boundary with `clarify`

Use `wrong` when the object of rejection is the assistant's work or the active solution path. Use `clarify` when the object under investigation is system behavior, configuration, documentation, or historical design intent.

- “Your fix is wrong; start over” → `wrong`
- “This endpoint returns the wrong status; why?” → `clarify`
- “That explanation does not match the code” → `wrong`, then re-investigate
- “The documentation does not match the code” → `clarify`

## Workflow

### Step 1: Re-analyze the Core Problem

State the problem in clear, simple terms. What exactly are we trying to solve?

### Step 2: Identify Missing Context

Determine what additional information is needed about:
- The existing codebase and its patterns
- Performance requirements or constraints
- Integration points with other systems
- Expected usage patterns or scale
- Any domain-specific requirements not yet mentioned

### Step 3: Propose Fresh Approaches

Suggest 2-3 alternative solutions that:
- Follow project best practices and idioms
- Match the existing code's style and architecture patterns
- Are maintainable and testable
- Solve the exact problem without over-engineering
- Don't use shortcuts or hacks

### Step 4: Explain Trade-offs

For each proposed approach, briefly explain:
- Why this approach fits the problem
- What the main benefits and drawbacks are
- How it integrates with the existing codebase

### Step 5: Recommend the Best Path Forward

Which approach is most appropriate and why?

## Requirements

- Solution must be production-ready, not a proof of concept
- Code should be idiomatic and follow established patterns
- Include comprehensive tests with edge cases
- Provide complete, runnable code with no placeholders
- Ensure the solution is maintainable

**Ask clarifying questions before proceeding.**
