# TypeScript Desktop Applications

Apply these rules proportionally to the application's real exposure. Preserve credential secrecy, update integrity, user-data integrity, and narrow privileged APIs without importing public-server or multi-tenant assumptions into a restartable single-user application.

## Start With the Concrete Failure

Before adding infrastructure, answer:

1. What concrete failure or privilege boundary is involved?
2. Has it occurred, or does current code make it likely?
3. What is the smallest local fix?
4. Can normal validation, cleanup, cancellation, or restart recovery handle it?
5. Can the relevant packaged/native boundary actually be tested?

If these answers do not justify the complexity, defer the work.

For rendering, native bridges, callbacks, IPC/RPC, cancellation, and lifecycle changes:

- Trace the complete path and fix the boundary that actually fails.
- Preserve known-good rendering, layout, framework behavior, and cleanup unless evidence implicates them.
- Keep bridge payloads small and semantic; prefer source or identifiers over complete rendered output when the privileged side can recreate it.
- Do not compensate for an untested native boundary with acknowledgements, quotas, generations, leases, or lifecycle protocols.
- After two failed or unverified attempts, revert to the last known-good behavior and reproduce the failure at the real boundary before continuing.
- Treat unit and mocked integration tests as evidence only for the layer they execute. Require packaged smoke tests for native and operating-system behavior.

## Detect the Stack

- **Electron:** `electron`, Electron Forge, electron-builder, Electron imports, main/preload entries.
- **Electrobun:** `electrobun`, `electrobun.config.ts`, `electrobun/bun`, or `electrobun/view`.
- **Tauri 2:** `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.*`, `src-tauri/capabilities`, or `@tauri-apps/*`.

A Bun lockfile does not make Electron into Electrobun. In a migration or monorepo, classify each application directory separately.

## Shared Boundary Rules

- TypeScript types do not validate runtime messages; validate data at real privilege or trust boundaries.
- Define narrow use-case operations, not generic `send`, `execute`, filesystem, shell, or arbitrary RPC surfaces.
- Validate payloads and authorize sensitive operations. Add size or frequency limits only when an existing contract, measured failure, cost, or credible exposure justifies them.
- Keep filesystem, process, shell, keychain, updater, and signing operations in the privileged process/core.
- Parse and allowlist external URLs and navigation. Never pass unchecked renderer input to a shell or `openExternal` equivalent.
- Prefer packaged local UI. Remote content receives no privileged bridge unless a narrowly justified design proves otherwise.
- Use restrictive CSP and avoid raw HTML injection.
- Keep private signing/updater keys outside source, artifacts, logs, and renderer bundles.
- Package and smoke-test on every supported OS; native behavior cannot be proven on one development platform.

## Electron

### Process ownership

- Main owns lifecycle, windows, native APIs, menus, and privileged resources.
- Renderer remains web-only.
- Preload exposes narrow methods through `contextBridge`.
- Use utility processes for crash-prone or CPU-heavy work when isolation is justified.

### Required security posture

Retain:

- `nodeIntegration: false`.
- `contextIsolation: true`.
- Renderer sandboxing.
- `webSecurity: true`.
- No `allowRunningInsecureContent`, unsafe Blink features, or `--no-sandbox`.

Do not expose raw `ipcRenderer`, generic channel methods, Electron event objects, or unrestricted Node APIs through preload.

Prefer `ipcRenderer.invoke`/`ipcMain.handle` for request/response. Validate the sender frame/origin/window for every privileged handler because any frame may attempt IPC. Validate payloads independently of TypeScript and return sanitized failures.

For remote content, use HTTPS, separate least-privileged sessions/partitions, restrictive permission handlers, navigation/window allowlists, and no privileged preload. Prefer a constrained custom protocol to broad `file://` access where applicable.

### Distribution

Electron Forge is the official integrated recommendation, but preserve established electron-builder or other tooling. Sign public Windows/macOS releases, notarize macOS, verify updater feeds/artifacts, and keep Electron current because the app ships Chromium and Node. Linux update behavior usually belongs to the chosen package/distribution model.

## Tauri 2

### Architecture and capabilities

The WebView calls trusted Rust application/plugin code through IPC. Rust code has full native authority, so frontend ACLs do not replace command-side validation and authorization.

- Keep capabilities in `src-tauri/capabilities/` and explicitly select enabled identifiers in `tauri.conf.*`.
- Bind capabilities to concrete window/WebView labels and platforms.
- Grant narrow command/plugin permissions and scopes. Avoid wildcard windows, broad filesystem/shell access, and remote URL capabilities without documented need.
- Review custom application commands separately: registered commands may need explicit manifest constraints to avoid broad exposure.

Use small typed command DTOs and explicit serializable error types. Validate paths, URLs, identifiers, and authorization in Rust. Use commands for request/response, channels for ordered/high-throughput streams, and events for low-volume broadcast—not latency-sensitive streaming.

Configure a restrictive CSP. Keep the asset protocol disabled unless needed and scope it narrowly. Treat frontend XSS as access to every capability granted to that view. Optional isolation supplements but does not replace capabilities and validation.

### Distribution

Tauri updater signatures and OS code signing are separate controls. Keep the updater private key secret and embed only the public key. Build/sign/notarize installers on a target-platform CI matrix where practical. Test system-WebView differences on supported operating systems.

## Electrobun

Electrobun uses a Bun main process, system WebViews, and typed RPC; it does not use Electron preload semantics.

- Define shared RPC contracts with explicit request/message methods.
- Runtime-validate all WebView data despite compile-time RPC types.
- Keep filesystem/process/shell/updater operations in Bun.
- Sandbox arbitrary remote views and verify that privileged RPC is unavailable.
- Test under Bun and inspect Bun compatibility for Node-specific dependencies/native addons.
- Verify the exact installed Electrobun version's sandbox, updater authenticity, signing, and platform behavior. Its security/testing ecosystem is newer and less comprehensive than Electron or Tauri.
- If optional bundled CEF is used, test both the security update responsibility and platform/package-size trade-off.

Public installers and updates require HTTPS hosting, artifact/authenticity verification, interruption/rollback tests, code signing after final mutation, and clean-machine Gatekeeper/SmartScreen checks. Do not assume macOS, Windows, and Linux signing behavior is identical.

## Lifecycle and UX

- Own and dispose windows, tray items, shortcuts, watchers, child processes, IPC/RPC handlers, streams, and native resources.
- Make close, hide-to-tray, quit, restart-for-update, and multi-window behavior explicit.
- Prevent stale async results from mutating destroyed windows/views.
- Keep blocking work out of renderer/UI loops.
- Preserve keyboard navigation, focus, zoom, accessibility, deep-link single-instance behavior, and offline/error recovery.

## Testing

Common layers:

1. Unit-test domain logic and schemas.
2. Contract-test each IPC/RPC/command allow and deny path.
3. Component-test UI with the native bridge mocked at its public surface.
4. Test denial and disposed-window behavior at the privilege boundaries the application actually exposes.
5. Package/install/launch and smoke-test relevant native APIs on supported targets.
6. Test signing and update recovery when the application owns those capabilities.

Electron can use framework test helpers and Playwright's Electron support with awareness of its support status. Tauri supports Rust tests, frontend IPC/window mocks, and WebDriver-oriented integration. Electrobun requires more application-owned Bun and packaged smoke testing.

## Sources

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Tauri security](https://v2.tauri.app/security/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri permissions](https://v2.tauri.app/security/permissions/)
- [Tauri testing](https://v2.tauri.app/develop/tests/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Electrobun repository](https://github.com/blackboardsh/electrobun)
- [Electrobun documentation](https://electrobun.dev/)
- [Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)
