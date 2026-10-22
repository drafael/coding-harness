# Sharpen

Deepens a task's methods and evidence without broadening its scope, then rewrites the prompt.

## Usage

```text
/sharpen Review this migration plan for correctness, keeping its scope unchanged.
```

In Claude Code, use `/sharpen`; in Pi, use `/skill:sharpen`. In OpenCode, ask “Use the sharpen skill”; `/sharpen` is available only when the skill's `opencode/slash` metadata is enabled.

## Credits

Adapted from [Cursor pstack `sharpen`](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/sharpen/SKILL.md) by Lauren Tan. [MIT License](LICENSE).
