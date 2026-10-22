# TDD bug fix

Fixes a bug with a focused regression check that fails before the fix and passes afterward.

## Usage

```text
/tdd Fix this parser bug: a quoted comma must stay inside its field.
```

In Claude Code, use `/tdd`; in Pi, use `/skill:tdd`. In OpenCode, ask “Use the tdd skill”; `/tdd` is available only when the skill's `opencode/slash` metadata is enabled.

## Credits

Adapted from [Cursor pstack `tdd`](https://github.com/cursor/plugins/blob/eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10/pstack/skills/tdd/SKILL.md) by Lauren Tan. [MIT License](LICENSE).
