# Prerequisites

To use an AI coding agent in your terminal, you’ll need:

- [Essential CLI tools](essential-cli-tools.md)
- [A modern terminal emulator](terminal-emulator.md)
- A subscription plan or API keys for the LLM providers you want to use

## Autopilot

The [`autopilot`](../skills/autopilot) skill requires these tools:

- Node.js 24 or newer
- Git
- At least one supported harness CLI: Claude Code, Codex, Pi, or OpenCode
- Optional: an installed and active `pi-subagents` 0.53.0 or newer for the process-local Pi backend; the packaged Autopilot Pi extension probes it before launch, and direct Pi remains a distinct fallback
- `gh` for GitHub delivery or `glab` for GitLab delivery

Autopilot checks these tools automatically before starting a run and reports anything missing. It never installs tools, downloads runtimes, or changes authentication.
