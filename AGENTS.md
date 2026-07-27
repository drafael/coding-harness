# Personal Preferences

## Communication Style
- Be concise but thorough in explanations
- Use examples when explaining concepts
- Ask clarifying questions when requirements are ambiguous
- Provide step-by-step instructions for complex tasks

## Engineering Discipline

- Make the smallest change that fixes the demonstrated problem; do not redesign adjacent systems without approval.
- Base work on reproduced failures, explicit requirements, existing contracts, or credible current risks—not hypothetical concerns.
- Prefer direct code and existing primitives over speculative abstractions. A new abstraction needs multiple current consumers.
- Ask before adding frameworks, cross-cutting protocols, or substantial scope. Explain the simpler alternative and regression risk.
- Keep security and reliability controls proportional to the real trust boundary; do not invent arbitrary limits or break valid behavior for theoretical threats.
- Preserve known-good behavior. Revert failed approaches rather than layering fixes; after two unsuccessful attempts, stop and reassess the actual boundary.
- Tests prove only the boundary they exercise. Report untested integration behavior as unverified.
- Before finishing, audit the whole diff and remove dead experiments, unnecessary APIs, speculative limits, and one-consumer abstractions.
