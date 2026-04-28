# Coding Harness
Reusable agent skills and workflows for everyday development.

## Prerequisites
To use an AI coding agent in your terminal, you’ll need:

- Essential CLI tools: [node/npm](https://nodejs.org/), [ripgrep (`rg`)](https://github.com/burntsushi/ripgrep#ripgrep-rg) or [fd](https://github.com/sharkdp/fd#fd), and [jq](https://github.com/jqlang/jq#jq)
- A modern terminal emulator, such as:
  - [WezTerm](https://wezterm.org/) (cross-platform)
  - [Alacritty](https://alacritty.org) (cross-platform)
  - [Ghostty](https://ghostty.org/) (Linux and macOS)
  - [Kitty](https://sw.kovidgoyal.net/kitty/) (Linux and macOS)
  - [Warp](https://warp.dev/) (macOS)
  - PowerShell v6+ (Windows)
- A subscription plan or API keys for the LLM providers you want to use

## Installation

### Recommended AI coding agents
- [Claude Code](https://code.claude.com/docs/en/quickstart#step-1%3A-install-claude-code)
  - with [revdiff plugin](https://github.com/umputun/revdiff?tab=readme-ov-file#claude-code-plugin)
  - with [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc#codex-plugin-for-claude-code)
- [Pi Coding Agent](https://pi.dev)
  - with [revdiff package](https://github.com/umputun/revdiff?tab=readme-ov-file#pi-package)
  - with [pi-subagents package](https://github.com/nicobailon/pi-subagents)
  - with [pi-web-access package](https://github.com/nicobailon/pi-web-access)

### Also worth trying
- [Codex CLI](https://developers.openai.com/codex/quickstart?setup=cli) or [Codex app](https://developers.openai.com/codex/quickstart?setup=app)
  - with [revdiff plugin](https://github.com/umputun/revdiff?tab=readme-ov-file#codex-plugin)
- [OpenCode](https://opencode.ai/docs/#install)
- [Gemini CLI](https://geminicli.com/docs/get-started/installation/)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli?tab=readme-ov-file#installation)

## [Skills](https://agentskills.io/)

To use `coding-harness/skills` in your projects, copy or symlink the `skills` folder to:

- For [Claude Code](https://code.claude.com/docs/en/skills#extend-claude-with-skills):
  - `project-folder/.claude/skills`
  - `~/.claude/skills`
- For [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#skills), [OpenCode](https://opencode.ai/docs/skills#place-files), [Codex](https://developers.openai.com/codex/skills#where-to-save-skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/#skill-discovery-tiers), and [Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills):
  - `project-folder/.agents/skills`
  - `~/.agents/skills`

## Usage and workflow

Activate a skill with a slash command (for example, `/brainstorm`) or by using a trigger phrase from the skill metadata (for example, `let's brainstorm`).

### Implement a user story

```text
/brainstorm """User story description"""
```

After brainstorming:

```text
start implementation of the YYYY-MM-DD-user-story-implementation-plan.md
write tests for new and modified code
code review uncommitted changes
```

### Fix a bug

```text
/debug-error """stack trace or errors in logs"""
/clarify why the response status is 500 instead of 201
add test and branch coverage for UserController
```

### Refactoring

```text
refactor code in the user login flow, following guidelines from the java-coder skill
```
