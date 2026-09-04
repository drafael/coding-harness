# Claude Agent SDK execution evaluation

- **Status:** Evaluation complete; production adapter implemented and validated separately
- **Decision:** GO for a distinct `claude-agent-sdk` implementation backend at the tested boundary
- **API baseline:** `@anthropic-ai/claude-agent-sdk` 0.3.260, tag `v0.3.260` at commit `a79d677cbd0a627bddf8ad37d8d010c727c71fc7`
- **Evaluation probe baseline:** Agent SDK 0.3.220 with its bundled Claude Code 2.1.220
- **Promotion evidence:** [Agent SDK implementation validation](2026-09-04-claude-agent-sdk-validation.md)
- **Scope:** Implementation execution only; independent review remains on the direct `claude-code` adapter

## Decision summary

The TypeScript Agent SDK now exposes enough identity and lifecycle data for an exact same-harness-instance execution boundary. A streaming-input query can carry a caller-selected user-message UUID, reports a session ID, echoes the user UUID on the turn's first reply and result in current releases, exposes capability-gated interrupt receipts, and emits a structured terminal result.

Autopilot can therefore implement a backend whose subject is the original in-memory `Query`, its Claude Code subprocess, the reported session ID, and the caller-selected user-message UUID. Completion or cancellation is acceptable only while that exact query remains uninterrupted and only from a terminal result bound to both identities.

The evaluation originally issued a conditional GO because the locally available 0.3.220 cancellation result did not echo the user-message UUID. The required identity fields arrived in later releases. An explicitly operator-supplied 0.3.260 SDK and matching Claude Code 2.1.260 executable subsequently passed the controlled fault matrix and live completion and cancellation probes, allowing the distinct backend to ship. The runtime still must not install the SDK or its platform binary.

The backend must remain separate from `claude-code`. It must advertise no restart reattachment and must not use transcript resume to infer the state of an interrupted query. SDK or subprocess loss before an exact terminal result becomes `EXECUTION_STATE_UNKNOWN` and cannot launch a replacement automatically.

## Constraints

The evaluation applied the existing Autopilot execution rules:

- Admission intent must be durable before the SDK receives the prompt.
- Completion and cancellation must bind to the exact session and caller-selected user message.
- Provider output, settings, hooks, and callbacks cannot expand charter authority.
- Query, iterator, subprocess, session, or identity loss becomes `EXECUTION_STATE_UNKNOWN`.
- An unknown execution must never trigger automatic resume or replacement.
- Interrupt acknowledgment is not cancellation terminality.
- The runtime must not install the Agent SDK, download its platform package, authenticate Claude, or modify global Claude, Git, or SSH configuration.
- Cooperative terminality does not prove descendant-process quiescence, rollback, or recovery after whole-harness loss.
- Node.js 24+, strict TypeScript ESM, deterministic `dist/`, and zero runtime production dependencies remain unchanged.

## Evidence

### Package and process boundary

Agent SDK 0.3.260 is an ESM package requiring Node.js 18 or later. It declares peer dependencies and optional per-platform Claude Code packages; its metadata binds the release to Claude Code 2.1.260. Autopilot must treat it as an optional externally supplied integration, not add it as a production dependency or discover private IDE caches as a runtime feature.

The public `query()` function returns a non-serializable `Query` async generator. The SDK normally owns a Claude Code subprocess. `spawnClaudeCodeProcess` allows a host to create and retain the exact direct child while satisfying the SDK's `SpawnedProcess` interface. That hook gives an implementation enough control to:

- use the attempt worktree as the process working directory;
- retain the exact child identity;
- redact and bound stderr before retaining it;
- enforce a bound on stdout protocol records before the SDK parses them; and
- await graceful and forced direct-child cleanup on every normal runtime path.

The SDK package executes inside the coordinator process when imported. It is therefore trusted integration code, not an isolated worker. Version discovery and explicit operator installation are required. Autopilot must not claim that the SDK, its CLI child, or tools are sandboxed merely because the query is structured.

Sources:

- [Agent SDK package 0.3.260](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.260)
- [Agent SDK 0.3.260 type declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.260/sdk.d.ts)
- [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)

### Exact admission identity

Streaming input accepts an `SDKUserMessage` with a caller-selected UUID. The query emits `system/init` with a session ID, Claude Code version, working directory, permission mode, tools, and protocol capabilities.

`system/init` proves the process and session configuration, but it does not prove that the caller's prompt became the active turn. Since 0.3.246, the turn's first assistant or partial reply and error result can echo `user_message_uuid`; 0.3.259 added `user_message_uuids` for merged prompt batches. Admission must wait for:

1. an exact realpath-normalized worktree in `system/init`;
2. the expected permission mode and exact tool surface;
3. a non-empty session ID and the required capabilities; and
4. the first reply or terminal result whose UUID set contains the caller-selected user-message UUID.

The subject is then:

```text
harnessInstanceId = generated process-instance nonce
backendId          = claude-agent-sdk@<SDK version>/claude-code@<init version>
subjectId          = hash(harnessInstanceId, sessionId, userMessageId)
```

Only one user message is submitted. A merged reply containing another user UUID, a changed session ID, a second init identity, or a result without the exact UUID is not authoritative. Loss between prompt submission and subject capture is unknown; the prompt must not be submitted again.

Sources:

- [Agent SDK 0.3.246 and 0.3.259 changelog entries](https://github.com/anthropics/claude-agent-sdk-typescript/blob/a79d677cbd0a627bddf8ad37d8d010c727c71fc7/CHANGELOG.md)
- [`SDKSystemMessage`, `SDKUserMessage`, assistant, and result declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.260/sdk.d.ts)

### Terminal acceptance

The SDK documents one result message per turn. A natural completion is accepted only when the uninterrupted query emits one result that:

- reports the admitted session ID;
- reports only the caller-selected user-message UUID for the turn;
- has subtype `success`;
- has `is_error: false`;
- has `terminal_reason: "completed"`;
- contains bounded final result text; and
- has no conflicting terminal observation.

Exact provider failures with the same identities become ordinary failed observations. A result without the user-message UUID, a malformed or oversized protocol record, iterator end before terminality, query replacement, process loss, or conflicting result is unknown.

The streaming input must remain open until the exact result is consumed. Closing it after yielding the first message can close the shared SDK-to-CLI control channel while the turn or its tools still need it. After terminal acceptance, the adapter closes the input and query and awaits direct-child cleanup.

Provider progress is activity only. Assistant text, tool progress, task notifications, and keep-alive frames cannot declare completion.

Sources:

- [Agent SDK `Query` and result-message reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)

### Cancellation

`Query.interrupt()` is available only in streaming-input mode. On a CLI advertising `interrupt_receipt_v1`, it returns a receipt whose `still_queued` field identifies messages that survive the interrupt. The method does not itself prove that the running turn reached a terminal state.

Autopilot cancellation must therefore require all of the following:

1. cancellation is sent through the original admitted `Query`;
2. `interrupt_receipt_v1` was advertised and a receipt was received;
3. `still_queued` is empty for the single-message Autopilot query;
4. the same uninterrupted iterator emits the exact session and user-message identities; and
5. the result has `terminal_reason: "aborted_tools"` or `"aborted_streaming"`.

An assistant frame with `aborted: true` is useful corroboration for a truncated model stream, but it is not required when interruption occurs during a tool. An interrupt receipt without the exact terminal result is unknown. If an exact `completed` result wins the race, natural completion wins and cancellation is not accepted.

`Query.close()` forcefully ends the query and returns no terminal proof. It is a cleanup operation only. Its return type is synchronous, so the adapter must separately await the captured child. Whole-harness loss remains uncontained.

Sources:

- [Agent SDK `interrupt()` and `SDKControlInterruptResponse`](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK 0.3.205, 0.3.214, and 0.3.219 changelog entries](https://github.com/anthropics/claude-agent-sdk-typescript/blob/a79d677cbd0a627bddf8ad37d8d010c727c71fc7/CHANGELOG.md)

### Resume and transport gaps

The SDK can resume a persisted conversation by session ID. Resume creates or reconstructs execution through another query and subprocess; it does not attach to the original active local query. `continue: true` similarly finds conversation history rather than proving the state of a specific in-flight user message.

Current `Query.reinitialize()` can resend initialization on an already-running transport and redeliver pending prompts to callbacks. That is useful to hosts that already own a reconnectable daemon transport, but it does not make a lost local `Query` serializable or provide Autopilot with a public get-or-attach contract for the original subprocess and turn.

The first backend must therefore set `restartReattachment: false`. It must not call `resume`, `continue`, or `reinitialize` after coordinator, query, or child loss to infer completion. Transcript files and late results are diagnostic evidence only.

Sources:

- [Agent SDK session resume guidance](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Agent SDK `reinitialize()` reference](https://platform.claude.com/docs/en/agent-sdk/typescript)

### Unattended authority

`allowedTools` auto-approves tools but does not restrict the tool surface. `canUseTool` runs only when earlier permission stages do not decide the request. A controlled 0.3.220 probe confirmed this distinction: an exact `sleep 30` Bash request proceeded without invoking the supplied callback.

The implementation must use all applicable SDK controls together:

- an exact `tools` list derived from the worker role;
- `disallowedTools` for tools that must not appear;
- a non-interactive permission mode;
- `settingSources: []` so user, project, and local settings cannot add hooks, tools, plugins, or permission rules;
- `strictMcpConfig: true` with no ambient MCP servers;
- no skills, plugins, additional directories, resume, or continuation;
- `persistSession: false`;
- background tasks disabled; and
- a `PreToolUse` hook when a restriction must apply before every tool call rather than only permission fallthrough.

These controls narrow the provider surface, but Bash and provider-owned tools remain cooperative. They do not establish operating-system path, network, descendant, or external-effect confinement. The runtime still verifies the repository and owns every Git and delivery effect.

Independent review remains on the direct `claude-code` adapter with no writable worker grants. The new implementation assurance must not be inherited by review.

Sources:

- [Agent SDK permission evaluation](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Agent SDK options reference](https://platform.claude.com/docs/en/agent-sdk/typescript)

## Controlled probes

### Natural completion

The locally available Agent SDK 0.3.220 was loaded from an existing application-managed cache without installation or modification. It used its bundled Claude Code 2.1.220 and the existing API credential in a temporary directory. The streaming query disabled tools, settings sources, MCP configuration, background tasks, telemetry, auto-update, and session persistence.

The query produced:

- `system/init` with Claude Code 2.1.220;
- a realpath-equivalent temporary working directory;
- `permissionMode: "dontAsk"` and zero tools;
- capabilities `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, and `msg_lifecycle_v1`;
- one success result bound to the caller-selected user-message UUID;
- `terminal_reason: "completed"`; and
- exact result text `CLAUDE_SDK_OK`.

The digests of `~/.claude.json` and `~/.claude/settings.json` were unchanged. No probe Claude process remained after cleanup.

A second run with the API credential removed reached an exact not-logged-in result and then a subprocess exit error. It did not authenticate or alter configuration. This demonstrates that an exact result can precede a later iterator/process error; the adapter must settle terminality once and retain later transport errors only as cleanup evidence.

### Cooperative interruption

A second streaming query exposed only Bash and requested `sleep 30`. After the tool-use frame, the probe called `interrupt()` on the original query. It observed:

- the same init identity and capabilities;
- an interrupt receipt with `still_queued: []`;
- an error result with `terminal_reason: "aborted_tools"`;
- subprocess exit code 1 after that result;
- unchanged Claude configuration digests; and
- no remaining Claude or `sleep 30` process after cleanup.

The 0.3.220 error result did not contain `user_message_uuid`. The probe therefore demonstrates cooperative cancellation behavior and cleanup, but it does not satisfy Autopilot's exact cancellation identity requirement. Version 0.3.246 or later and a repeated live cancellation probe are promotion prerequisites.

## Required backend contract

A successful implementation will advertise:

```json
{
  "schemaVersion": 1,
  "owner": "harness",
  "continuity": "same-harness-instance",
  "terminality": "cooperative",
  "admission": "single-shot"
}
```

It must also advertise `restartReattachment: false`.

The existing `claude-code` charter value remains unchanged. The new value must be `claude-agent-sdk`, selected explicitly before charter sealing. Direct review remains on `claude-code`.

## Promotion acceptance criteria

Production promotion requires an operator-provided Agent SDK 0.3.246 or later and controlled tests for:

- optional SDK discovery, version reporting, missing-package diagnostics, and no automatic installation;
- exact SDK and `system/init` Claude Code versions;
- one captured child, one query, one session, and one caller-selected user-message UUID;
- realpath-normalized worktree, exact tools, permission mode, settings-source isolation, and MCP isolation;
- first-reply admission identity and terminal-before-admission ordering;
- natural completion, structured provider failure, permission denial, malformed output, and missing terminal identity;
- exact completion and error result UUID sets, including rejection of merged or foreign messages;
- interrupt receipt followed by exact `aborted_tools` or `aborted_streaming` terminality;
- natural completion winning the cancellation race;
- missing receipt, surviving queued messages, close-only cancellation, and result loss becoming unknown;
- wrong harness instance, query, session, user-message, working-directory, backend, and version identities;
- iterator end, iterator throw, child exit, stdin/stdout/stderr failure, idle timeout, and deadline;
- protocol-record and retained-output bounds before persistence;
- secret redaction before stderr, progress, or result retention;
- exact tool-surface enforcement and rejection of interactive authority expansion;
- awaited direct-child cleanup with forced escalation while the harness survives;
- no project-owned native binary and no runtime production dependency;
- deterministic generated `dist/`; and
- version-pinned live completion and cancellation with unchanged tracked files and Claude configuration digests.

## Explicit non-goals

The implementation must not claim:

- restart attachment to a lost local query;
- equivalence between conversation resume and active execution attachment;
- durability from transcript or session persistence;
- compatibility with private IDE SDK caches;
- automatic SDK, CLI, binary, credential, or daemon installation;
- provider settings or hooks as authority;
- filesystem, network, subprocess, or external-effect sandboxing;
- quiescence of descendants or background operating-system processes;
- cleanup after whole-harness loss; or
- parity beyond the tested SDK and bundled Claude Code pair.

## Outcome

Agent SDK 0.3.260 resolves the earlier API-shape blocker: current result and first-reply messages bind the provider terminal to a caller-selected user-message UUID, while interrupt receipts and structured terminal reasons distinguish acknowledgment from cancellation. The [promotion validation](2026-09-04-claude-agent-sdk-validation.md) supplied the required controlled and exact-version live evidence. `claude-agent-sdk` is now an explicit charter value while `claude-code` remains the distinct direct CLI and independent-review path.
