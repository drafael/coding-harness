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

Activate a skill with the host’s command syntax (Pi uses `/skill:<name>`; other hosts may use `/<name>`) or a trigger phrase from its metadata.

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

### Code review

Activate the [`code-review`](skills/code-review) skill:
```text
code review uncommitted changes
```

### Session reflection

The [`reflect`](skills/reflect) skill is manual-only. In Pi, invoke it after a substantial session with:

```text
/skill:reflect
```

It proposes evidence-backed improvements to existing skills and waits for individual approval before editing.

### Learn a codebase

The [`teach`](skills/teach) skill is manual-only. In Pi, invoke it with the learning request:

```text
/skill:teach Teach me how request retries work in this service.
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

Use the [`pretty-mermaid`](skills/pretty-mermaid) skill to generate diagrams:
```text
create a sequence diagram in SVG format with white background of the endpoint /api/v1/users
```
```text
create an ASCII terminal-friendly sequence diagram of the endpoint /api/v1/users
```
