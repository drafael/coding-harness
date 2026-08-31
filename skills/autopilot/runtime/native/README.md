# Windows Job Object helper

`windows-job-helper.c` is the source of the optional `win32-x64` process-containment helper. It uses only Win32 APIs and is not an npm dependency or Node native addon.

The runtime enables Windows restart reattachment only when both files exist under `native/bin/win32-x64/` and the executable matches the manifest SHA-256 and x64 PE machine identity:

```text
job-helper.exe
job-helper.json
```

Do not build or fabricate this executable on another operating system. Run the manually dispatched `Autopilot Windows Job Object helper` GitHub Actions workflow in `drafael/coding-harness`; manifests from local builds or other workflow events are marked untrusted and rejected by packaged capability discovery. It selects the hosted x64 MSVC toolchain, builds twice in clean directories with reproducible linker flags, compares SHA-256, checks the PE architecture, runs the real Windows containment and restart suite, and uploads a commit-named bootstrap artifact.

After reviewing the exact workflow run, compiler line, test output, artifact digest, and source commit:

1. Download that workflow artifact without executing it.
2. Independently hash `job-helper.exe` and compare it with `job-helper.json` and the workflow log.
3. Copy only the reviewed executable and manifest into `native/bin/win32-x64/`.
4. Run the ordinary Ubuntu/Windows runtime CI and confirm generated `dist/native/win32-x64/` is identical.
5. Record the workflow URL, source commit, compiler version, and SHA-256 in the delivery evidence.

The helper receives a bounded binary request on stdin. Executable arguments and environment values are never unsafely shell-interpolated or persisted in broker identity artifacts. Bare native commands are resolved to absolute `.exe`/`.com` targets. Recognized npm `.cmd` launchers are resolved to their Node entry point and receive the original argument array directly; arbitrary batch files fail closed. The broker creates an **unnamed** Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, creates the target suspended, assigns it before any user code runs, and then resumes it. The broker is the sole lifetime job-handle owner. Restarted coordinators query or terminate through its versioned named-pipe channel and never open or inherit a Job Object handle.

The two-build comparison proves repeatability only within the exact toolset recorded by that workflow run. The manifest binds the helper and C-source SHA-256 values to the source commit, workflow-file Git blob SHA, workflow name/ref/run identity, and complete `cl.exe /Bv` toolset output. Toolset drift requires a fresh reviewed artifact; the workflow does not claim cross-toolset reproducibility. Windows ARM64 is intentionally unsupported.
