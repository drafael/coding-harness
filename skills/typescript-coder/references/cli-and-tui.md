# CLI and TUI Applications

## Classify the Interface

- **CLI:** commands produce finite output and exit.
- **Interactive prompt:** a CLI asks a bounded sequence of questions.
- **TUI:** a persistent full-screen or continuously rendered terminal interface owns input, focus, layout, and redraw.

Keep core operations callable without terminal rendering. A TUI should orchestrate application/domain APIs, not become the only place business behavior exists.

## CLI Contracts

### Arguments and help

- Use the established parser. Commander and yargs are common, but oclif, Clipanion, citty, Node parsing, Bun APIs, and project-specific parsers are valid.
- Treat command names, options, defaults, environment fallbacks, and exit codes as public API.
- Validate arguments and configuration after parsing; parser-level TypeScript inference does not validate files, environment, or remote data.
- Provide useful `--help` and `--version`. Show defaults and required values accurately without exposing secrets.
- Reserve breaking option renames/removals for deliberate versioned changes. Support deprecation messages when compatibility matters.

### Streams and composition

- Write requested/data output to `stdout`.
- Write diagnostics, warnings, prompts, and progress to `stderr` unless the established tool documents otherwise.
- Keep machine-readable output free of banners, spinners, color codes, and log noise.
- Detect `isTTY` before prompting or rendering interactive progress. Fail with guidance or use a non-interactive path when input/output is redirected.
- Support `NO_COLOR`; also honor established `FORCE_COLOR`, `TERM`, and CI behavior without assuming every terminal has the same capabilities.
- Do not close process-wide standard streams owned by the caller.

### Exit and errors

- Set stable non-zero exit codes for failures and zero for success. Avoid calling `process.exit()` deep in application logic; return/throw to the command boundary so cleanup and tests can run.
- Format expected user errors concisely. Put stack traces behind a debug/verbose mode and redact sensitive values.
- Handle `SIGINT` and `SIGTERM` for graceful cancellation. Preserve conventional interruption behavior and avoid hanging on active handles.
- Use `process.exitCode` when normal unwinding can complete safely; force exit only after a bounded shutdown policy requires it.

## Configuration

Use explicit precedence and document it, commonly:

```text
command option → environment → project/user config → default
```

Validate the merged result once and distinguish “unset” from false/zero/empty. Do not write user configuration or credentials without explicit intent, safe permissions, and atomic/recoverable updates.

## Subprocesses

- Prefer `spawn`/`execFile` with an executable and argument array.
- Avoid `shell: true` and command-string interpolation for untrusted or cross-platform input.
- Forward only required environment variables; do not leak the entire parent environment to less-trusted tools without consideration.
- Own stdin/stdout/stderr behavior, timeout, cancellation, maximum buffered output, and exit-code interpretation.
- Kill process trees carefully and account for Windows/POSIX differences.
- Never trust terminal output from a subprocess as plain text when it can contain control sequences.

## Files and Paths

- Resolve paths against a documented base; do not silently depend on the caller's working directory when a config/project root is intended.
- Use platform path APIs and test Windows drive/UNC behavior if Windows is supported.
- Avoid unsafe overwrite. Use temporary files plus atomic replacement where data integrity matters.
- Preserve permissions where appropriate and restrict secret files.
- Treat globs, symlinks, archives, and user-controlled output paths as trust boundaries when they can escape an intended root.

## TUI Architecture

Separate:

```text
input events → application state/update → render model → terminal renderer
```

- Keep effects outside pure state transitions where the framework allows it.
- Assign ownership to every timer, listener, task, stream, and renderer resource.
- Do not block the input/render loop with filesystem, network, subprocess waits, parsing, or CPU-heavy work.
- Ignore or cancel stale async results when navigation or a newer request supersedes them.
- Coalesce high-frequency progress updates and resize events to prevent redraw storms.

## Terminal Lifecycle

On normal exit, error, interrupt, cancellation, or suspension, restore what the application changed:

- Raw/cooked input mode.
- Alternate screen buffer.
- Cursor visibility and style.
- Mouse/paste modes.
- Colors and text attributes.
- Signal and resize handlers.
- Framework renderer resources.

Use `try/finally` or the framework lifecycle. Make cleanup idempotent. Test crash/error paths; a beautiful happy path does not excuse leaving the user's terminal broken.

## Layout, Input, and Accessibility

- Handle resize and very narrow terminals without crashes or inaccessible controls.
- Use Unicode display width/grapheme-aware utilities; JavaScript string length is not terminal cell width.
- Do not encode meaning through color alone. Respect color capability and `NO_COLOR`.
- Provide discoverable keyboard commands, visible focus, escape/back behavior, and confirmation for destructive actions.
- Avoid stealing common terminal shortcuts without a strong reason.
- Sanitize or escape untrusted control characters in filenames, logs, remote text, and errors.
- Provide a plain CLI or non-interactive mode for essential operations, automation, redirected output, and users who cannot use the TUI.

## Framework Notes

### Commander and yargs

Use typed option/argument APIs and their normal help/error hooks. Keep command actions thin and independently test application functions. Avoid global parser state when tests or multiple command trees need isolation.

### Ink

Treat Ink as a React renderer: follow hook rules, own effects and subscriptions, and test visible output/interactions with Ink's testing utilities. Keep terminal-specific code out of reusable domain logic.

### OpenTUI

OpenTUI uses a native Zig core with TypeScript bindings and currently centers Bun in its getting-started and development workflow. Verify the installed renderer/framework package and runtime requirements. Test under Bun and use framework-owned cleanup rather than assuming Node terminal semantics.

### terminal-kit and Blessed-family libraries

Use their document/screen lifecycle and input APIs rather than mixing unmanaged raw ANSI writes. Verify cleanup, resize, focus, mouse, Unicode, and platform behavior against the installed version.

## Testing

- Unit-test argument/config validation, precedence, exit mapping, and pure state transitions.
- Capture stdout and stderr separately.
- Test TTY and non-TTY behavior, color disabled, narrow width, Unicode, signals, cancellation, and cleanup.
- Use fake renderers for most TUI behavior and targeted pseudo-terminal tests for raw input/render integration.
- Test packed/installed CLI entry points, not only source invocation.
- Avoid snapshot-only suites; assert important commands, labels, states, and transitions explicitly.

## Sources

- [Node.js child processes](https://nodejs.org/api/child_process.html)
- [Node.js TTY](https://nodejs.org/api/tty.html)
- [Node.js readline](https://nodejs.org/api/readline.html)
- [Commander](https://github.com/tj/commander.js)
- [yargs TypeScript guidance](https://github.com/yargs/yargs/blob/main/docs/typescript.md)
- [Ink](https://github.com/vadimdemedes/ink)
- [OpenTUI](https://opentui.com/docs/getting-started/)
- [terminal-kit](https://github.com/cronvel/terminal-kit)
- [Terminal color environment conventions](https://github.com/termstandard/colors)
