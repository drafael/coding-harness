# Windows Job Object helper source

- **Status:** Retained temporarily for removal; not approved for packaging
- **Decision:** [Use cooperative harness execution on Windows](../../docs/adr/0002-use-cooperative-harness-execution-on-windows.md)
- **Implementation plan:** [Cooperative harness execution](../../docs/2026-08-31-cooperative-harness-execution-plan.md)

`windows-job-helper.c` is the source of the optional `win32-x64` process-containment helper that was developed and validated before the project chose a binary-free Windows package boundary.

The helper creates the harness suspended, assigns it to an unnamed Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and resumes it only after assignment. A persistent broker owns the sole lifetime Job handle and exposes authenticated query and termination through a request-derived named pipe. These mechanics remain historical implementation evidence; they are not the approved future package architecture.

Protected workflow run [`33353702353`](https://github.com/drafael/coding-harness/actions/runs/33353702353) built the x64 helper reproducibly, passed 179 tests exactly once, and produced reviewed executable SHA-256:

```text
e9017028a38c8e564aa7b73541dd1996e5b5ddf8075a7c136e06b5d55c7effef
```

The artifact will not be copied into `native/bin/win32-x64/` or checked into the repository. The protected artifact-producing workflow has been removed so it cannot be promoted accidentally. Local builds remain `local-untrusted` and cannot enable packaged capability discovery.

Until the retained source and runtime paths are removed in the planned cleanup PR:

- no packaged helper means Windows restart reattachment remains disabled;
- Windows uses the existing session-scoped direct execution and cancellation fallback;
- helper absence or changed execution state must fail closed;
- no documentation or report may imply that the reviewed artifact ships.

Do not build, install, or substitute a local helper. The retained source, build script, protocol implementation, and tests remain only to keep the transition reviewable until cooperative execution and native cleanup land in their ordered PRs.
