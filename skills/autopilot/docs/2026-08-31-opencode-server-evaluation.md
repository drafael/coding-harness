# OpenCode server execution evaluation

- **Status:** Implemented with controlled fault coverage and live production-adapter validation
- **Decision:** GO for a controlled implementation of a distinct `opencode-server` backend
- **Evidence baseline:** OpenCode 1.18.25, upstream tag `v1.18.25` at commit `cb7d8b2f5e44876ef98b661dc10590c915af3a9f`
- **Scope:** Implementation execution only; independent review remains on the direct `opencode` CLI adapter

## Decision summary

OpenCode 1.18.25 provides enough identity and lifecycle information for a same-harness-instance cooperative backend when Autopilot owns one headless server process, creates one dedicated session, and submits one caller-selected message ID. The backend can bind its subject to the process-instance nonce, session ID, and message ID. It can accept terminality only after a live event hint and a fresh REST observation of the exact message relationship.

The implementation must remain separate from the current `opencode` charter value. It must not claim restart reattachment, replayable event delivery, operating-system process-tree quiescence, path sandboxing, or durable recovery after loss of the owning Autopilot process.

This is not approval to reuse a global OpenCode server. Autopilot must start one loopback server for each attempt and await direct-child cleanup on every path while the owning harness survives. Whole-harness loss remains unknown and can leave the process running because no OS containment is claimed.

## Constraints

The evaluation applied the existing Autopilot execution rules:

- Admission intent must be durable before OpenCode receives the prompt.
- Completion and cancellation must refer to the exact attempt subject.
- Process, server, event-stream, session, or identity loss must become `EXECUTION_STATE_UNKNOWN`.
- An unknown execution must never trigger an automatic replacement.
- Provider events are hints. A fresh provider observation must confirm terminal state.
- The backend must not install OpenCode, authenticate a provider, start a global daemon, or change global OpenCode, Git, or SSH configuration.
- Cooperative completion does not prove descendant-process quiescence or rollback external effects.

## Evidence

### Server ownership and transport

`opencode serve` starts a headless HTTP server. OpenCode warns when `OPENCODE_SERVER_PASSWORD` is absent, then publishes the selected loopback URL on stdout. The server accepts `--pure`, `--hostname`, and `--port`; OpenCode 1.18.25 treats port `0` as “try 4096, then use any free port.”

Autopilot can therefore start one direct child process with:

- `--pure`;
- hostname `127.0.0.1`;
- port `0`;
- a generated per-process Basic Auth password; and
- the attempt worktree as the process working directory.

The password is an operational secret. It must be redacted before output is bounded or retained.

Sources:

- [OpenCode server documentation](https://opencode.ai/docs/server/)
- [`serve.ts` at the evaluated commit](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/cli/cmd/serve.ts#L7-L22)
- [`server.ts` port selection](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/server.ts#L97-L125)

### Worktree identity

Instance routes select their directory from the request query, `x-opencode-directory`, or the server process working directory. Sessions persist the selected directory. The backend can send the exact realpath-normalized attempt worktree on every request and reject a `/path` or session response that reports another directory or worktree.

This verifies provider routing; it is not an operating-system sandbox. OpenCode tools, shell commands, plugins, provider behavior, or ambient processes can still reach resources outside the worktree. `--pure` disables external plugins but does not establish filesystem confinement.

Sources:

- [`workspace-routing.ts`](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts#L82-L88)
- [OpenCode server API documentation](https://opencode.ai/docs/server/#path--vcs)

### Exact admission identity

The session API returns a unique session ID. The asynchronous prompt API accepts a caller-supplied `messageID`. OpenCode stores that ID on the user message and returns HTTP 204 after accepting the asynchronous prompt.

Autopilot can derive the exact subject from:

```text
harnessInstanceId = generated process-instance nonce
backendId          = opencode-server@<observed version>
subjectId          = hash(harnessInstanceId, sessionId, messageId)
```

The engine already writes `ATTEMPT_STARTED` before adapter delegation. The adapter must establish the event stream, create the dedicated session, choose the message ID, and submit the prompt once. A lost or ambiguous submission response is `EXECUTION_STATE_UNKNOWN`; it must not be retried.

Sources:

- [OpenCode session and message APIs](https://opencode.ai/docs/server/#sessions)
- [`promptAsync` handler](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L311-L325)
- [`PromptInput` caller-selected message ID](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/session/prompt.ts#L1498-L1521)

### Terminal reconciliation

The event endpoint is a server-sent events stream. The first event is `server.connected`. Session execution publishes `session.status` values including `busy` and `idle`. OpenCode registers the event listener before sending `server.connected`, which closes the startup race for that live connection.

The stream does not publish an SSE replay cursor: the encoder omits the internal event ID. The implementation must not reconnect and infer continuity after a gap. Any event-stream end or parse failure before accepted terminality is `EXECUTION_STATE_UNKNOWN`.

A natural completion is accepted only when all of these observations agree:

1. The same live stream observed the dedicated session become `busy` and later `idle`.
2. A fresh `GET /session/:id/message` contains the caller-selected user message ID.
3. Exactly one assistant message has `parentID` equal to that user message ID.
4. The assistant message has `time.completed`, a terminal `finish`, and no error.
5. The server child and owning adapter instance remain the admitted process instance.

`session.error`, conflicting assistant identities, duplicate terminal relationships, instance disposal, stream loss, or process loss fails closed. Streaming output may be collected from exact message-part events, but the final bounded output must come from the freshly observed exact assistant message.

Sources:

- [OpenCode event API](https://opencode.ai/docs/server/#events)
- [`event.ts` listener and `server.connected` ordering](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts#L24-L76)
- [`session-status-event.ts`](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/schema/src/session-status-event.ts#L8-L49)

### Cancellation

`POST /session/:id/abort` calls the session runner’s cancellation path. OpenCode 1.18.25 cancels related background jobs, interrupts the active runner, records an assistant completion error, and returns the session to `idle`. Its shell tool attempts direct-child termination and escalates after three seconds.

Autopilot must not treat the abort response as cancellation terminality. It must wait for the exact session to become idle, then freshly observe the exact assistant whose `parentID` equals the admitted message ID. Cancellation is accepted only when that assistant is complete with `MessageAbortedError`. If the exact assistant completed naturally first, natural completion wins the race and the cancellation request is not accepted.

This remains cooperative terminality. OpenCode’s cancellation path does not prove that every descendant or external effect is quiescent.

Sources:

- [`abort` handler](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L232-L235)
- [`run-state.ts` cancellation](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/session/run-state.ts#L77-L94)
- [`prompt.ts` interrupted assistant finalization](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/session/prompt.ts#L1203-L1219)
- [`shell.ts` cooperative termination](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/tool/shell.ts#L533-L555)

### Unattended requests and permissions

A dedicated implementation session can carry explicit permission rules. The initial implementation should preserve the direct adapter’s cooperative `--auto` behavior by allowing implementation tools while denying interactive question paths. If OpenCode emits a permission or question request despite that policy, Autopilot must reject the exact request and fail the attempt rather than expanding authority.

Independent review remains on the direct CLI path. The server backend’s implementation assurance must not be applied to review.

Sources:

- [OpenCode permissions API](https://opencode.ai/docs/server/#sessions)
- [`question` rejection route](https://github.com/anomalyco/opencode/blob/cb7d8b2f5e44876ef98b661dc10590c915af3a9f/packages/opencode/src/server/routes/instance/httpapi/groups/question.ts#L41-L59)

## Controlled probes

### Isolated protocol probe

A temporary home and temporary XDG data, config, cache, and state roots were used with no provider authentication. The probe:

1. started OpenCode 1.18.25 on loopback with generated Basic Auth;
2. verified `/global/health` returned version `1.18.25`;
3. verified `/path` returned the realpath-normalized temporary directory;
4. created and read a dedicated session with explicit deny-all permissions;
5. deleted the session;
6. disposed the directory instance; and
7. attempted to stop the server process.

The process was later found orphaned under PID 42930 after the probe's parent harness had ended and was removed manually. That invalidates the probe's process-cleanup claim, though not its HTTP/SSE protocol observations. It also confirms the stated boundary: whole-harness loss does not provide process containment or descendant quiescence. All OpenCode files created by this probe remained under the temporary root.

### Version-pinned live probe

A second probe reused the already authenticated OpenCode installation without changing authentication or configuration. It used a disposable local Git repository and deleted both probe sessions afterward.

Natural completion produced:

- one exact user message with the caller-selected ID;
- one assistant whose `parentID` matched that ID;
- `finish: "stop"`;
- `time.completed`;
- text `validation`; and
- observed status progression from `busy` to `idle`.

Cancellation produced:

- one exact user message with the caller-selected ID;
- one assistant whose `parentID` matched that ID;
- `MessageAbortedError`;
- `time.completed`; and
- observed status progression from `busy` to `idle` after an abort response of `true`.

The tracked repository tree remained clean. The digest of files under `~/.config/opencode` was unchanged. These probes establish the normal same-process path; they do not establish restart recovery or descendant quiescence.

### Production adapter validation

The implemented adapter was then exercised with auto-update disabled against installed OpenCode 1.18.28 in a disposable local Git repository. A completion attempt created only the requested untracked `result.txt` containing `validation`, returned an exact completed observation, and left tracked files unchanged. A second attempt ran a long shell command; cancellation returned accepted only after fresh reconciliation produced the exact assistant `MessageAbortedError` and exit code 130.

The adapter reported `opencode-server@1.18.28`, `same-harness-instance` continuity, cooperative terminality, single-shot admission, and no restart reattachment. The digest under `~/.config/opencode` was unchanged. Awaited cleanup completed, and a post-run process scan found no OpenCode server. This validates normal live cleanup while the owning harness survives; it does not supersede the whole-harness-loss limitation demonstrated by the orphaned earlier probe.

## Required backend contract

The controlled implementation advertises:

```json
{
  "schemaVersion": 1,
  "owner": "harness",
  "continuity": "same-harness-instance",
  "terminality": "cooperative",
  "admission": "single-shot"
}
```

It must also advertise `restartReattachment: false` through the compatibility capability.

The direct `opencode` backend remains unchanged. It retains POSIX process-supervised implementation execution and direct independent review. The new charter value must be `opencode-server`; selection must be explicit before the charter is sealed.

## Implementation acceptance criteria

Production promotion used controlled tests for:

- exact loopback server startup, Basic Auth, health version, and worktree routing;
- durable admission intent followed by one session and one caller-selected message ID;
- admission response loss without retry;
- exact busy-to-idle terminal reconciliation against fresh message history;
- natural completion, provider failure, content filtering, malformed output, and missing assistant state;
- abort acknowledgment followed by exact `MessageAbortedError`;
- natural completion winning the cancellation race;
- wrong backend, harness instance, session, message, assistant parent, and directory identities;
- early, duplicate, conflicting, child-session, stale, and unrelated events;
- event-stream end, malformed or oversized SSE records, server exit, stdin/stdout/stderr failure, idle timeout, and deadline;
- streaming secret redaction before output bounding;
- rejection of permission and question requests;
- awaited direct-child shutdown with graceful termination and forced escalation;
- no project-owned native binaries in source, build output, or package inventory;
- deterministic generated `dist/`; and
- version-pinned live completion and cancellation with an unchanged tracked tree and OpenCode configuration digest.

## Explicit non-goals

The implementation must not claim:

- reconnection or replay after an SSE gap;
- reattachment after coordinator or adapter restart;
- compatibility with a shared or externally managed OpenCode server;
- OpenCode ACP parity;
- filesystem or network sandbox enforcement;
- quiescence of descendant or background operating-system processes;
- rollback of external effects;
- absence of persistent OpenCode session/database activity; or
- provider/version parity beyond the tested OpenCode release.

## Outcome

The prior help-only evidence was insufficient for production design because it did not prove exact prompt admission or terminal reconciliation. The pinned 1.18.25 source and controlled probes resolve those two blockers for one uninterrupted, Autopilot-owned server process. The result is a bounded GO for implementation, with promotion contingent on the acceptance matrix above.
