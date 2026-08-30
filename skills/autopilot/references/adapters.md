# Harness and delivery adapters

Adapters start fresh noninteractive sessions and normalize observations. They cannot append journal events, commit, push, create change requests, merge, or declare lifecycle success.

## Harness adapters

| Adapter | Command surface | Assurance | Restart reattachment | Verification status |
|---|---|---|---|---|
| Pi | Pi JSON mode plus `pi-subagents` structured delegation when version 0.53.0+ is installed; direct Pi fallback otherwise | Cooperative | No | Local edit, exact-tree review, verification, commit, and provider amendment passed with Pi 0.84.4 through pi-subagents 0.60.0; the direct fallback is covered by a controlled adapter test; cancellation and crash reattachment remain unverified |
| Claude Code | `claude --print --output-format stream-json --safe-mode ...` | Cooperative | No | Command and failure reporting exercised with 2.1.210; edit flow blocked by expired local OAuth and remains unverified |
| Codex | `codex exec --json --ephemeral --sandbox workspace-write ...` | Cooperative overall; Codex enforces the workspace sandbox, while item-path restrictions are post-checked | No | Local single-objective edit, verification, and commit passed with 0.149.0 |
| OpenCode | `opencode run --format json --pure --auto ...` | Cooperative | No | Local single-objective edit, verification, and commit passed with 1.18.21 |

The adapter parser bounds output and rejects malformed JSON-mode output. The runtime ignores model completion claims and inspects the worktree directly.

For a `review` gate, the runtime sends a separate role-scoped request with no writable roots or worker write/process grants. Claude Code receives only read/search tools, Codex uses its read-only sandbox, and direct Pi receives only its read tool. OpenCode and any ambient operating-system access remain cooperative. The adapter extracts exactly one structured review marker; missing, contradictory, malformed, truncated, timed-out, or inconclusive output is `UNVERIFIED`. The runtime compares the complete tree, HEAD, refs, and Git configuration before and after review and rejects any mutation. The Pi path passed a version-pinned disposable live run with Pi 0.84.4; the other bundled harness review paths have controlled coverage only.

For Pi, Autopilot checks the standard Pi package directory for `pi-subagents` 0.53.0 or newer. When present, it loads only that extension and Autopilot's bridge, delegates the item to the resolved `worker` role through the public structured delegation API, and keeps the worker in Autopilot's existing worktree. The read-only exact-tree review role runs directly and is not subjected to the worker-only subagent terminal envelope. Autopilot does not install or update the extension. An older or absent installation uses the direct Pi process and reports that fallback through `doctor` and adapter limitations.

Delegated Pi activity is written to stderr while the CLI runs, leaving JSON stdout machine-readable. The stream reports worker start, current tool, tool and token counts, elapsed time, and terminal status without copying child output or tool arguments. This is an Autopilot CLI projection, not the originating Pi session's FleetView: Pi's event bus and FleetView are process-local, while Autopilot owns a separate subprocess. The integration follows pi-subagents' public [structured delegation API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md) and [observability contract](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md), rather than importing internal runners or scraping rendered terminal output.

Every harness needs adapter `network.access` and `credentials.use` grants because its model control plane may use authenticated network access. Those grants do not authorize the worker or delivery provider.

Run `node runtime/dist/src/cli.js doctor` to observe installed versions. Doctor does not install, authenticate, or modify configuration.

## Delivery adapters

- GitHub uses the public `gh` CLI for pull-request discovery, creation, checks, current-head observation, review-thread and comment observation, exact review-thread resolution, and merge. GraphQL supplies resolvable review-thread identity; REST supplies PR comments and review summaries that can be addressed but do not have a provider resolved state.
- GitLab uses the public `glab` CLI for merge-request discovery, creation, commit statuses, current-head observation, discussion observation, exact resolvable-discussion resolution, and merge.

Provider credentials remain in the CLI environment. Journal events store stable IDs, URLs, expected commits, and redacted outcomes, not credentials.

Unit tests use controlled fake CLIs for command construction, changed-head denial, review-feedback observation and resolution, and wrap-up reconciliation. An authorized live wrap-up removed the merged head branch for GitHub chat4j PR #69 and reconciled its legacy lease worktree. Authorized private GitHub project `drafael/autopilot-amendment-validation` PR #1 exercised `gh` 2.98.0 immutable feedback capture, exact-head successor adoption, fast-forward update, exact thread resolution, merge, and amendment-chain wrap-up. Immediate marker rediscovery in an earlier target exposed GitHub search-index delay; the adapter now paginates pull-request bodies through the REST API instead of relying on indexed search. Authorized private GitLab project `drafael/autopilot-amendment-validation` MR !2 exercised the equivalent complete amendment workflow with `glab` 1.115.0. Fresh MR observation exposed a preparation window in which GitLab reported the exact source `sha` before `diff_refs`; the adapter now accepts either exact identity and fails closed if both disagree. These results do not prove other authentication setups, organization approval rules, checks completion, merge queues, GitLab merge trains, or broad provider idempotency.

## Capability degradation

- Queue execution becomes serial when an adapter reports concurrency one.
- Missing required assurance or grants stops before edits.
- Lost processes become interrupted attempts and receive new leases on resume.
- Late results from expired leases are quarantined.
- Provider head changes block merge.
- Review findings block the current attempt and enter the next deterministic attempt context as untrusted data.
- Independent-review support remains unverified for every live harness version until a disposable exact-tree run passes.

No adapter may silently downgrade a completion predicate or create a waiver.
