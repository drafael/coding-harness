# Claude Agent SDK implementation validation

- **Date:** 2026-09-04
- **Runtime subject:** `claude-agent-sdk` implementation adapter
- **Agent SDK:** 0.3.260
- **Bundled Claude Code:** 2.1.260, Darwin ARM64
- **Scope:** Controlled contract tests plus live completion and cooperative cancellation

## Supplied packages

The operator explicitly authorized temporary retrieval of the exact SDK and matching platform package. Neither package was installed into the project or global package trees.

| Package | Registry SHA-1 | Registry integrity |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk@0.3.260` | `7f183685e0a9583378949a8966704ec8a5082101` | `sha512-PmABtP4Rwd6l95itQrqzguv6rS9uACqikPB9g8BPeWRKZOpy3xpEOjJLYauof3BFk2wNZnfhr0Ttx8ttcZzq0w==` |
| `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.260` | `2a7aa29dd36b62cce48010158cd5e62c83f7f237` | `sha512-0af2gRe6+sk13yYNX2gdDhcO15Kj1qd8B7ZQlv8mDt2lA1xFhTJqIvRwgrCHeCWZryWTmoRgtMoAfJOhQ9yn1g==` |

The runtime does not know these temporary paths. Production discovery requires both `AUTOPILOT_CLAUDE_AGENT_SDK_ROOT` and `AUTOPILOT_CLAUDE_AGENT_SDK_CLI`. Doctor reports missing, unsupported, and accepted versions without running npm, installing packages, searching private application caches, or authenticating Claude.

## Implemented boundary

`claude-agent-sdk` is a distinct charter value. Implementation requests use one in-memory SDK query, one captured direct child, one session ID, and one caller-selected user-message UUID. Review requests remain on the direct `claude-code` adapter and reuse the explicitly supplied Claude Code executable.

Admission verifies:

- Agent SDK 0.3.246 or newer and a bounded `--version` check matching the package-declared Claude Code version;
- one exact child executable and one `system/init` identity;
- a realpath-equivalent attempt worktree;
- `dontAsk`, the exact implementation tool list, and required protocol capabilities;
- no MCP servers or plugins and disabled skills;
- `settingSources: []`, no session persistence, no continuation or resume, and an isolated temporary Claude configuration directory; and
- the first assistant or terminal frame bound only to the caller-selected user-message UUID.

A `PreToolUse` hook fences every exposed tool name. This is a cooperative tool-surface control, not operating-system containment. The runtime still verifies the repository and owns Git and provider effects.

Completion accepts only one exact `success`, `is_error: false`, `terminal_reason: completed` result from the admitted session and user message. Cancellation additionally requires the original query's interrupt receipt, an empty `still_queued` set, and an exact `aborted_tools` or `aborted_streaming` result. Natural completion may win. Query, iterator, child, protocol, identity, deadline, or idle loss before accepted terminality becomes `EXECUTION_STATE_UNKNOWN`; there is no resume or replacement path.

## Controlled evidence

Nineteen focused tests cover:

- explicit discovery, minimum-version enforcement, and absent-package diagnostics;
- implementation/review assurance separation;
- exact init, session, tool, capability, worktree, and first-reply user-message identity, with later UUID-omitting tool-use replies inherited only inside the admitted one-query session;
- settings, MCP, plugin, skill, and exact child-environment isolation;
- `PreToolUse` allow and deny behavior;
- natural completion, buffered terminal delivery across child exit, and structured provider failure;
- both accepted cancellation terminal reasons, exact completion/failure races, and a nonresponsive interrupt call;
- missing and non-empty interrupt receipts;
- missing, foreign, and merged first, subsequent, and terminal reply identities;
- malformed authority, iterator failure, child loss, duplicate spawn, absent child, and oversized protocol records;
- idle and deadline loss;
- UTF-8-safe retained-output bounds and secret redaction across output, chunks, and lifecycle errors;
- wrong-harness and consumed-handle rejection; and
- awaited direct-child cleanup and adapter-state release.

The broader runtime suite remains the authority for journal, exact-tree, Git, verification, delivery, and recovery behavior.

## Live completion

The production adapter loaded the explicitly supplied SDK 0.3.260 and executable 2.1.260, admitted one exact subject, used the expected same-harness-instance assurance, and returned a successful bounded summary without invoking tools or changing the disposable fixture. The exact result carried `terminal_reason: completed` and the caller-selected user-message identity. The runtime awaited direct-child cleanup.

## Live cancellation

A second production-adapter run admitted one implementation turn instructed to execute `sleep 30`. The exact `PreToolUse` hook ran for Bash. The adapter interrupted the original query, received `still_queued: []`, then consumed an exact error result with `terminal_reason: aborted_tools` and the same session and user-message identity. It returned `cancelled` with exit code 130. Neither the Claude Code child nor `sleep 30` remained after cleanup.

## Configuration isolation observation

An initial raw SDK probe, before the production adapter was exercised, did not set `CLAUDE_CONFIG_DIR`. Claude Code 2.1.260 advanced the global `.claude.json` migration marker from 13 to 14 and rewrote `settings.json`, despite `settingSources: []`. The CLI-created `.claude.json` backup matched the pre-probe digest and was restored. No matching byte-for-byte `settings.json` backup was available, so its pre-probe bytes could not be restored.

The production adapter therefore creates a fresh temporary `CLAUDE_CONFIG_DIR` for every implementation attempt and deletes it after awaited cleanup. Both production-adapter live runs left the then-current global `.claude.json` and `settings.json` digests unchanged. This evidence does not claim that a raw SDK consumer is configuration-neutral.

## Result and limits

The 0.3.260 promotion criteria exercised here passed, so `claude-agent-sdk` is available as an explicit implementation adapter. It remains cooperative and same-instance only. It does not claim restart attachment, transcript recovery, descendant quiescence, filesystem or network sandboxing, rollback of external effects, cleanup after whole-harness loss, or compatibility beyond tested package pairs and platforms.
