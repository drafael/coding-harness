# Coding Harness
Reusable agent skills and workflows for everyday development.

## Prerequisites

Before installing an agent, review the [prerequisites](docs/prerequisites.md) for required CLI tools, terminal setup, and provider access.

## Installation

### Recommended terminal coding agents
- [Claude Code](https://code.claude.com/docs/en/quickstart#step-1%3A-install-claude-code) - Anthropic’s terminal-native coding agent.
  - [revdiff plugin](https://github.com/umputun/revdiff?tab=readme-ov-file#claude-code-plugin) - Interactive diff review and annotation workflow.
  - [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc#codex-plugin-for-claude-code) - Adds OpenAI Codex integration to Claude Code.
- [Pi Coding Agent](https://pi.dev) - Extensible terminal coding agent with packages, tools, skills, and TUI support.
  - [revdiff package](https://github.com/umputun/revdiff?tab=readme-ov-file#pi-package) - Interactive code review and diff navigation.
  - [pi-subagents package](https://github.com/nicobailon/pi-subagents) - Delegates work to focused subagents and chains.
  - [pi-web-access package](https://github.com/nicobailon/pi-web-access) - Adds web search, content fetching, and library research tools.
  - [pi-intercom package](https://github.com/nicobailon/pi-intercom) - Lets multiple Pi sessions communicate locally.
  - [pi-review-loop package](https://github.com/nicobailon/pi-review-loop) - Automates repeated code-review passes until issues are resolved.

### Also worth trying
- [Codex CLI](https://developers.openai.com/codex/quickstart?setup=cli) with [revdiff plugin](https://github.com/umputun/revdiff?tab=readme-ov-file#codex-plugin) or [Codex app](https://developers.openai.com/codex/quickstart?setup=app)
- [OpenCode](https://opencode.ai/docs/#install)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli?tab=readme-ov-file#installation)

## [Skills](https://agentskills.io/)

To use `coding-harness/skills` in your projects, copy or symlink the `skills` folder to:

- For [Claude Code](https://code.claude.com/docs/en/skills#extend-claude-with-skills):
  - `project-folder/.claude/skills` or `~/.claude/skills`
- For [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#skills), [OpenCode](https://opencode.ai/docs/skills#place-files), [Codex](https://developers.openai.com/codex/skills#where-to-save-skills), [Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills):
  - `project-folder/.agents/skills` or `~/.agents/skills`

## Usage and workflow

Ask your coding agent in natural language or use the skill command syntax supported by your host. The examples below show portable prompts rather than host-specific commands.

### Run a bounded unattended implementation

Use [`autopilot`](skills/autopilot) when the objective has explicit completion predicates and the user wants restart-resumable execution through a supported coding harness:

```text
Use the autopilot skill. I am going to sleep. Work overnight on migrating this multi-module Java backend
from Spring Boot 3.x to Spring Boot 4.0.0. Done means the Maven verify build,
integration tests, and application-context smoke tests pass; no Spring Boot 3.x
artifacts remain; and the migration guide is updated. Open a PR or MR, but do not merge or deploy.
```

Autopilot requires Node.js 24+ and Git. Optional harness integrations can provide delegated workers and live activity; Autopilot falls back to direct harness execution when they are unavailable. Remote delivery also requires `gh` or `glab` and explicit per-run grants.

Ask “What happened overnight?” to check progress, “Continue the interrupted run” to resume a nonterminal run, or “Stop this run and preserve its work” to end it safely. “Address the review comments” snapshots feedback from the exact open PR/MR, creates a sealed amendment successor, and resolves provider-resolvable threads only after the fix passes. After provider-confirmed merge, “Wrap up the merged run” performs guarded remote-branch, sibling-worktree, local-branch, and amendment-chain cleanup; ask for a handoff when project-local summaries should be preserved.

### Implement a user story

Activate the [`brainstorm`](skills/brainstorm) skill:
```text
let's brainstorm this user story: """User story description"""
```

If brainstorming produced an implementation plan, use the project-appropriate coding skill, such as [`java-coder`](skills/java-coder) or [`typescript-coder`](skills/typescript-coder):
```text
implement the plan YYYY-MM-DD-user-story-implementation-plan.md
  using the applicable project coding skill and provide human-verifiable evidence
```

### Architecture design

The [`architect`](skills/architect) skill is manual-only. Use it after behavior and important constraints are understood to produce a caller-first, implementation-ready structural design.

```text
Use the architect skill to define the types, signatures, and module boundaries for this approved design.
```

It returns a design by default. Implementation requires an explicit request or later approval.

### Candidate arena

The [`arena`](skills/arena) skill is manual-only for direct use. Invoke it when several independent attempts at the same bounded artifact would improve the decision.

```text
Use the arena skill to produce three independent designs for this parser contract and synthesize the strongest result.
```

It returns one coherent synthesis and the applicable verification result rather than a collection of candidate fragments.

### Code review

Activate the [`code-review`](skills/code-review) skill:
```text
code review uncommitted changes
```

### Blast-radius analysis

The [`blast-radius`](skills/blast-radius) skill is manual-only. Invoke it with a bounded local comparison:

```text
Use the blast-radius skill to analyze HEAD~1..HEAD.
```

It traces credible effects beyond the obvious diff and seeks executable proof for decision-critical safety assumptions.

### Session reflection

The [`reflect`](skills/reflect) skill is manual-only. Invoke it after a substantial session:

```text
Use the reflect skill to review this session and propose evidence-backed improvements.
```

It proposes evidence-backed improvements to existing skills and waits for individual approval before editing.

### Learn a codebase

The [`teach`](skills/teach) skill is manual-only. Invoke it with the learning request:

```text
Use the teach skill to explain how request retries work in this service.
```

It explains repository-backed code progressively without modifying the project.

### Write tests

Activate the [`write-tests`](skills/write-tests) and [`test-coverage`](skills/test-coverage) skills:
```text
write tests for new and modified code
```
```text
add test and branch coverage for UserController
```

### Fix a bug

Activate the [`debug-error`](skills/debug-error) and/or [`clarify`](skills/clarify) skills:
```text
debug this error: """stack trace or errors in logs"""
```
```text
clarify why the response status is 500 instead of 201
```

### Refactoring

Activate the [`refactor-code`](skills/refactor-code) and [`java-coder`](skills/java-coder) skills:
```text
refactor code in the user login flow, following guidelines from the java-coder skill
```

### Technical writing

Use the [`technical-writing`](skills/technical-writing) skill for substantial technical documents and design artifacts:

```text
review this deployment runbook for incorrect assumptions, missing prerequisites, and unsafe recovery steps
```

Use [`unslop`](skills/unslop) alone for small style-only edits.

### Documenting

Choose the diagram skill based on the artifact you need:

- Use [`pretty-mermaid`](skills/pretty-mermaid) for Mermaid-as-code, themed SVG rendering, ASCII output, or batch rendering.
- Use [`diagram-design`](skills/diagram-design) for editorial standalone HTML/SVG diagrams, branded styling, or redraws of Mermaid and draw.io sources.

```text
Use the pretty-mermaid skill to create an ASCII terminal-friendly sequence diagram of the endpoint /api/v1/users.
```

```text
Use the diagram-design skill to create an editorial architecture diagram of this service as standalone HTML.
```
