# Charter reference

The harness writes a proposed charter. The CLI validates it, resolves no additional authority, computes `charterHash`, and stores the sealed charter as `charter.json`.

Runtime validation in `runtime/src/charter.ts` is authoritative. `runtime/schemas/charter.schema.json` is the published interchange description.

## Required fields

- `schemaVersion`: `1`
- `runId`: safe path component, unique for the selected state directory
- `sourceText`: original user request
- `createdAt`: ISO timestamp
- `repository`: canonical real root, immutable base ref/commit, and maximum writable roots
- `harnessAdapter`: `pi`, `claude-code`, `codex`, `codex-app-server`, or `opencode`; the two Codex values are distinct direct-CLI and same-app-server-instance execution modes
- `mode`: `single`, `independent-queue`, or `ordered-stack`
- `work`: resolved items with concise change-request titles, full objectives, dependencies, predicates, writable roots, and branches
- `delivery`: `local-commits`, `change-request-ready`, or `merge-verified`
- `deliveryTarget`: required for remote delivery
- `providerCheckWait`: optional `merge-verified` heartbeat and session-timeout bounds; defaults are runtime-owned when omitted
- `grants`: explicit family, actor, and optional constraints
- `gates`: runtime-owned command, literal-search, or exact-tree review checks
- `waivers`: launch-only exact failure signatures with alternative gates
- `limits`: attempt, concurrency, timeout, line, and output bounds
- `assumptions`: material reversible decisions
- `minimumAssurance`: `cooperative` or `enforced`
- `resolutionSources`: source of every resolved mechanic

Newly compiled charters also include `commitPolicy`, with an explicit `preCommitHook` choice (`run` or `skip`) and allowed hook environment names. It remains optional in schema version 1 only so previously sealed charters remain valid. `amends` is optional and identifies a successful predecessor run and item when updating an open change request.

## Amendments

`amends` is an explicit ownership-transfer contract, not ordinary lineage metadata. The first release accepts one single-mode work item whose ID and branch match a satisfied item from the referenced successful run. It requires `change-request-ready` delivery and the same repository, provider, remote, and base branch. `predecessorRunId`, when present, must equal `amends.runId`.

A review-feedback amendment also seals `reviewFeedback.observedHeadCommit` and a non-empty list of exact thread IDs, content hashes, URLs, and `resolve` flags. The observed head must equal the amendment base commit. `resolve: true` is valid only for provider-resolvable review threads and requires a delivery `review-thread.resolve` grant; non-resolvable PR comments may be addressed by the verified code change with `resolve: false`.

Set `repository.baseCommit` to the predecessor's confirmed remote commit. The runtime denies dirty worktrees, unmanaged commits, changed refs, missing evidence, closed or merged change requests, concurrent adopters, and non-fast-forward delivery. See [recovery](recovery.md) for the launch procedure.

## Gate families

| Type | Runtime observation | Current status |
|---|---|---|
| `command` | Exit status and bounded redacted output from an executable/argument array | Implemented |
| `search` | Exact literal count over sealed repository-relative paths | Implemented |
| `review` | Structured reviewer verdict and findings against an exact tree | Implemented with fake-adapter coverage; live harness execution remains unverified |
| Runtime/UI probe | None | Not implemented |
| General remote CI gate | None; provider checks are delivery receipts only | Not implemented |

A `review` gate contains `id`, `type: "review"`, a bounded `focus` string, and `appliesTo`. Any finding fails the first contract, and review gates cannot be waived. `inconclusive`, malformed, timed-out, truncated, or mutating review execution is unverified and blocks completion. Findings are untrusted data passed to a fresh remediation attempt; they cannot add grants, writable roots, predicates, commands, credentials, or provider effects. A clean review receipt proves only what that named review process reported for the exact tree.

## Command gate environments

Before sealing a command gate, resolve how the repository selects its required runtime or build toolchain. Prefer checked-in wrappers and toolchain configuration. If the command still depends on a named selector such as `JAVA_HOME`, include it in the gate's `environmentNames` and authorize the same name with a runtime `credentials.use` grant. Include it in `commitPolicy.environmentNames` only when the pre-commit hook also requires it. Runtime commands use a filtered environment and do not automatically inherit toolchain choices from the parent shell or worker process; forward only the required names rather than the ambient environment.

## Commit policy

For `commitPolicy.preCommitHook: "run"`, Autopilot runs the configured executable pre-commit hook with the baseline runtime environment plus `commitPolicy.environmentNames`. Put predictable hook-only outputs in `commitPolicy.writableRoots` and grant those paths to the runtime without widening worker roots. Autopilot records the executable hook's path and content identity at attempt start, refuses changed content, verifies the candidate before the hook, rejects out-of-scope, ref, or Git configuration changes, and reruns gates if the tree changes. Every forwarded environment name also requires a matching runtime `credentials.use` grant. The runtime then creates the exact verified commit without invoking hooks again. `skip` is explicit; absence remains equivalent to `skip` only for older schema-version-1 charters.

## Work item titles

Set `work[].title` to an imperative, sentence-case summary of 3–12 words and no more than 72 characters. Describe only the user-visible change: do not copy the full objective, acceptance criteria, test plan, file list, or delivery instructions. The runtime uses this field verbatim for a new change request. For compatibility, a charter without `title` gets a bounded first-clause fallback derived from `objective`.

## Grant actors

| Actor | Owns |
|---|---|
| `worker` | File reads/writes and exploratory commands inside one worktree |
| `adapter` | Harness process network and authentication control plane |
| `runtime` | Direct verification, commits, non-force push, and repository observation |
| `delivery` | GitHub or GitLab change-request, check, and merge operations |

A grant for one actor does not authorize another. Commit does not imply push; push does not imply change-request creation; change-request creation does not imply merge. Credential-like environment variables are removed from harness processes unless an adapter `credentials.use` grant names them in `environmentNames`; credential files and keychains remain subject to each harness's sandbox.

## Minimal local example

Replace the repository values and branch before launch:

```json
{
  "schemaVersion": 1,
  "runId": "spring-boot-4-migration-20260823",
  "sourceText": "I am going to sleep. Work overnight on migrating the Java backend from Spring Boot 3.x to 4.0.0, verify it, update the migration guide, and commit without pushing.",
  "createdAt": "2026-08-22T00:00:00.000Z",
  "repository": {
    "root": "/absolute/canonical/repository",
    "baseRef": "main",
    "baseCommit": "0123456789abcdef0123456789abcdef01234567",
    "writableRoots": ["pom.xml", "src", "docs"]
  },
  "harnessAdapter": "pi",
  "mode": "single",
  "work": [
    {
      "id": "spring-boot-4",
      "title": "Migrate backend to Spring Boot 4",
      "objective": "Migrate the Java backend from Spring Boot 3.x to 4.0.0 while preserving HTTP and persistence behavior.",
      "writableRoots": ["pom.xml", "src", "docs"],
      "dependsOn": [],
      "acceptance": [
        { "type": "gate-passed", "gateId": "maven-verify" },
        { "type": "search-count", "query": "<spring-boot.version>3.", "paths": ["pom.xml"], "expectedCount": 0 },
        { "type": "path-present", "path": "docs/spring-boot-4-migration.md" }
      ],
      "branchName": "autopilot/sb4/spring-boot-4"
    }
  ],
  "delivery": "local-commits",
  "grants": [
    { "family": "files.read", "actor": "worker", "paths": ["/absolute/canonical/repository"] },
    { "family": "files.write", "actor": "worker", "paths": ["/absolute/canonical/repository/pom.xml", "/absolute/canonical/repository/src", "/absolute/canonical/repository/docs"] },
    { "family": "process.execute", "actor": "worker" },
    { "family": "network.access", "actor": "adapter" },
    { "family": "credentials.use", "actor": "adapter" },
    { "family": "files.read", "actor": "runtime", "paths": ["/absolute/canonical/repository/pom.xml", "/absolute/canonical/repository/src", "/absolute/canonical/repository/docs"] },
    { "family": "process.execute", "actor": "runtime", "commands": ["./mvnw"] },
    { "family": "git.commit", "actor": "runtime", "repositories": ["/absolute/canonical/repository"], "branchPrefixes": ["autopilot/"] }
  ],
  "gates": [
    {
      "id": "maven-verify",
      "type": "command",
      "executable": "./mvnw",
      "arguments": ["verify"],
      "workingDirectory": ".",
      "environmentNames": [],
      "appliesTo": ["spring-boot-4"]
    }
  ],
  "waivers": [],
  "limits": {
    "maxAttemptsPerItem": 3,
    "maxReplans": 1,
    "maxParallel": 1,
    "attemptTimeoutMs": 1800000,
    "idleTimeoutMs": 300000,
    "maxAdapterLineBytes": 1048576,
    "maxRetainedOutputBytes": 4194304
  },
  "assumptions": [],
  "minimumAssurance": "cooperative",
  "commitPolicy": {
    "preCommitHook": "skip",
    "writableRoots": [],
    "environmentNames": []
  },
  "resolutionSources": {
    "repository.baseCommit": "repository",
    "work.spring-boot-4.title": "invocation",
    "work.spring-boot-4.branchName": "default"
  }
}
```

`maxRetainedOutputBytes` bounds retained adapter output and each generated implementation or review attempt context. Context overflow fails closed; the runtime does not truncate authority or acceptance criteria.

## Remote additions

Remote delivery requires:

- `deliveryTarget` with `provider`, `remote`, and `baseBranch`
- for `merge-verified`, optional `providerCheckWait` with positive `heartbeatMs` and `timeoutMs`, where the heartbeat does not exceed the timeout
- runtime `network.access`, `credentials.use`, and constrained `remote.push`
- delivery `network.access`, `credentials.use`, and `change-request.open`
- delivery `merge.execute` only for `merge-verified`
- adapter credential `environmentNames` when the selected harness must authenticate from environment variables rather than its credential store

The runtime stops before edits if required grants or adapter capabilities are missing.

## Branch resolution

Resolve templates with this precedence:

```text
invocation > .autopilot/config.json > user config > autopilot/{run-short}/{item-slug}
```

Supported placeholders are `{run}`, `{run-short}`, `{item}`, `{item-slug}`, `{ticket}`, and `{date}`. Validate all names with `git check-ref-format --branch`. Never invent a collision suffix.
