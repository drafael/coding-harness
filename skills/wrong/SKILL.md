---
name: wrong
description: Reset after the user rejects the assistant's current answer, plan, implementation, or problem-solving direction. Use for "your approach is wrong", "start over", "try a different approach", or when the attempted solution has demonstrably failed. Use clarify for incorrect system behavior and brainstorm when the user wants multiple new designs or alternatives.
---

# Wrong: reset and re-evaluate

The user has rejected the current approach or the attempted solution has failed. Stop extending or defending it. Return to the last supported facts and reassess the problem.

## Boundaries

Use `wrong` when the object of rejection is the assistant's work or the active solution path.

- “Your fix is wrong; start over” → `wrong`
- “That explanation does not match the code” → `wrong`, then re-investigate
- “This endpoint returns the wrong status; why?” → `clarify`
- “Explore three alternative architectures” → `brainstorm`

A rejection does not automatically require several new designs, a formal plan, implementation, or comprehensive tests. Match the response to what the user rejected and requested.

## Workflow

### 1. Identify the rejected claim or approach

State concisely:

- what the assistant attempted;
- what the user says is wrong;
- which assumptions or evidence supported the failed direction;
- what remains established.

Do not make the user repeat context already present in the conversation.

### 2. Discard the failed premise

Stop layering fixes on the rejected approach. Remove it from the working hypothesis unless independent evidence still supports a specific part.

If changes were already made, inspect the actual diff before deciding whether to revise or revert them. Do not preserve failed machinery as compatibility scaffolding.

### 3. Re-investigate the responsible boundary

Read the relevant code, configuration, documentation, errors, or prior evidence. Trace the full path when the earlier answer relied on an incomplete local view.

After two unsuccessful or unverified attempts at the same issue, stop iterating. Reassess the premise, data flow, ownership, and acceptance boundary before trying again.

### 4. Choose the proportional next step

- **Clear correction:** acknowledge it briefly and provide or apply the smallest corrected answer requested.
- **Missing decisive context:** ask one focused question.
- **Concrete failure:** use the appropriate debugging workflow and reproduce it where possible.
- **Several meaningful alternatives or a design reset:** use `brainstorm` before implementation.
- **Consequential change:** explain scope and obtain approval before expanding it.

Do not force option lists when one correction is clearly supported.

### 5. Validate the new direction

Check the evidence that failed previously and the boundary affected by the correction. For code changes, run focused tests or validation proportional to the change. Do not claim the issue is resolved from reasoning alone when an executable or observable check exists.

## Response style

- Acknowledge the rejected direction without arguing.
- Explain the corrected understanding, not a defense of the prior answer.
- Name remaining uncertainty.
- Keep the reset focused; do not turn a small correction into a redesign.
- If the evidence still conflicts with the user's premise, show that evidence respectfully instead of pretending agreement.
