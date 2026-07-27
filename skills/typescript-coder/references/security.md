# TypeScript Security

Apply controls to actual trust boundaries and exposure. Do not import public multi-tenant assumptions into a local tool without evidence, but never weaken credential secrecy, authorization, update integrity, or user-data protection.

## Trust Boundaries

Common boundaries include:

- HTTP/WebSocket requests and responses.
- Cookies, headers, tokens, and identity-provider claims.
- Environment variables and configuration files.
- CLI arguments, stdin, terminal text, and subprocess output.
- Files, paths, symlinks, archives, uploads, and generated artifacts.
- Database rows containing JSON or data written by older/other systems.
- Queues, events, webhooks, and third-party APIs.
- Browser storage and server/client serialization.
- Electron/Electrobun/Tauri IPC, RPC, commands, WebViews, and native capabilities.
- Package plugins, lifecycle scripts, CDK constructs, and synthesis plugins.

For each relevant boundary, identify the producer and required guarantees. Validate and authorize where needed; add resource bounds only when exposure, cost, an existing contract, or observed behavior justifies them.

## Validation and Authorization

- Parse untrusted values as `unknown`.
- Reuse the project's runtime schema system or focused guards.
- Reject unexpected values rather than silently coercing security-sensitive fields.
- Keep validation and domain types derived from one source where practical.
- Validation proves shape; authentication proves identity; authorization proves permission. All may be required.
- Re-check authorization at the operation/resource boundary, not only in UI or routing metadata.
- Avoid mass assignment. Map accepted input fields explicitly into updates.

## Injection Prevention

### Shell and subprocesses

Use an executable plus argument array. Avoid `shell: true`, `exec` strings, or command concatenation with untrusted input. Constrain executable selection and environment inheritance.

### SQL and data stores

Use parameterized queries or safe query-builder/ORM APIs. Dynamic identifiers require allowlisting; parameters normally protect values, not table/column names.

### HTML and browser content

Use framework escaping and structured rendering. Avoid raw HTML APIs. When rich HTML is required, use an appropriate maintained sanitizer and restrictive policy. A CSP is defense in depth, not permission to inject unsanitized content.

### Paths and archives

Resolve against an intended root, account for symlinks, and verify the final target when confinement matters. Prevent absolute-path, `..`, archive traversal, overwrite, and unsafe extraction behavior. Use atomic writes where integrity matters.

### URLs and SSRF

Parse with `URL`, enforce allowed schemes/hosts/ports, and consider redirects and DNS/address resolution when server-side requests can reach privileged networks. Do not pass unchecked URLs to desktop shell/open APIs.

### Regular expressions

Escape user literals and avoid patterns with catastrophic backtracking on attacker-controlled long input. Prefer parsers or bounded inputs for complex formats.

## Web Security

- Keep authorization server-side and deny by default.
- Use secure, HttpOnly, SameSite cookies as appropriate and protect state-changing requests against CSRF based on the deployment model.
- Configure CORS narrowly; it is a browser read policy, not authentication.
- Prevent XSS through escaping, sanitization, CSP, and safe URL handling.
- Protect against open redirects with parsed allowlists or internal route identifiers.
- Bound request bodies, uploads, pagination, expensive queries, and authentication attempts proportionally.
- Use trusted proxy settings only when the deployment topology actually supplies and sanitizes forwarded headers.
- Avoid leaking stack traces, SQL, filesystem paths, environment data, or internal service details to clients.

## Secrets and Sensitive Data

- Never commit credentials, private keys, signing/updater keys, tokens, session secrets, or plaintext production configuration.
- Prefer workload identity and short-lived credentials over long-lived keys.
- Use runtime secret stores; avoid exposing secret plaintext during build, CDK synth, browser bundling, or logs.
- Redact authorization headers, cookies, access/refresh tokens, passwords, private content, and personally identifiable data.
- Do not log whole request bodies or environment objects by default.
- Treat source maps, crash reports, telemetry, test fixtures, snapshots, and CI artifacts as potential disclosure paths.
- Rotate and revoke a leaked secret; deleting it from the latest commit is insufficient.

## Cryptography and Tokens

Use platform/framework cryptography and established protocols. Do not design custom encryption, password hashing, session tokens, OAuth, or signature formats.

- Use cryptographically secure randomness for secrets and identifiers requiring unpredictability.
- Compare signatures/tokens with appropriate constant-time APIs where the protocol requires it.
- Validate issuer, audience, expiry, not-before, signature algorithm, state, nonce, and PKCE according to the identity protocol and library contract.
- Do not decode a JWT and treat its claims as authenticated without verified signature and policy.

## Dependency and Build Security

- Lock dependencies and use reproducible installs.
- Treat install scripts, loaders, lint/format plugins, bundler plugins, test environments, native addons, CDK apps, and third-party constructs as code execution.
- Review new package provenance, maintenance, permissions, transitive footprint, and runtime compatibility.
- Separate untrusted pull-request CI from release credentials and cloud roles.
- Pin GitHub Actions and other CI plugins according to organization policy.
- Triage vulnerability reports for reachable impact and safe upgrade paths. Do not use broad overrides or disable checks without understanding the consequence.

## Resource and Availability Controls

Apply proportional limits to exposed services and tools:

- Request/message/upload size.
- Pagination and batch size.
- Timeouts and retry counts.
- Concurrency, queues, and worker pools.
- Compression/decompression and archive expansion.
- Regex/input length.
- Recursive parsing and graph depth.
- Subprocess output and runtime.

Do not add elaborate adversarial machinery to a trusted local-only path without a concrete failure model. Do add hard bounds where a remote or renderer-controlled input can consume unbounded memory, CPU, disk, processes, or cloud cost.

## Desktop and TUI Boundaries

- Treat data crossing from a renderer/WebView into privileged native operations as a trust boundary; ordinary renderer-local state does not by itself justify server-grade machinery.
- Keep privileged bridge operations narrow, validate payloads, authorize sensitive actions, and verify sender/origin where the stack supports and requires it.
- Sanitize terminal control sequences from untrusted filenames, logs, and remote content.
- Restore terminal/native resources on every exit path.
- Verify update signatures and OS code signing separately; never bundle private keys.

See [`desktop.md`](desktop.md) and [`cli-and-tui.md`](cli-and-tui.md).

## Security Review Questions

1. What values cross a trust boundary, and where are they validated?
2. Where is authorization enforced for the actual resource and operation?
3. Can untrusted input reach shell, SQL, HTML, URL, path, regex, IAM, IPC, or native APIs?
4. Could secrets enter logs, browser bundles, templates, source maps, artifacts, or errors?
5. Are time, memory, disk, concurrency, and cloud-cost effects bounded where exposure warrants it?
6. Can dependency/build/CI code access release or cloud credentials unnecessarily?
7. Are denial paths and safe failures tested?

## Sources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Node.js security best practices](https://nodejs.org/en/learn/getting-started/security-best-practices)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Tauri security](https://v2.tauri.app/security/)
- [AWS CDK security best practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices-security.html)
