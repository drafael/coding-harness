# Java Desktop Applications

Apply these guidelines to local, primarily single-user Java desktop applications, especially Swing applications. They override server-oriented defaults when project context supports a simpler threat and availability model. They do not weaken requirements for credential secrecy, OAuth correctness, user-data integrity, or Swing EDT safety.

## Start With the Concrete Failure

Before adding infrastructure, answer:

1. What concrete failure can occur in this application?
2. Has it happened, or does current code make it likely?
3. Is the impact inconvenience, lost work, secret exposure, or remote compromise?
4. Can an application restart recover safely?
5. What is the smallest local fix?

If these answers do not justify the complexity, defer the work.

### Failure-Boundary and Regression Guardrail

Before changing a desktop rendering, native bridge, callback, cancellation, or lifecycle path:

1. Trace the complete path from the user action to the failing boundary.
2. Identify which boundary is actually unproven; do not patch downstream code when transport or native delivery is failing upstream.
3. Preserve the last known-good renderer, styles, layout, provider behavior, and cleanup semantics unless evidence implicates them.
4. Keep native callback payloads small and semantic. Prefer source or an identifier that Java can process over transporting complete HTML, SVG, images, or other rendered output.
5. Test each layer honestly. Pure Java/JavaScript tests can validate payload construction and parsing, but only a packaged native smoke test can validate WKWebView, WebView2, WebKitGTK, JCEF, OS callbacks, or external application launch.
6. If a native fix cannot be exercised, label it unverified; do not compensate by adding acknowledgements, quotas, leases, generations, or lifecycle protocols.
7. After two failed or unverified attempts, revert to the last known-good behavior and stop. Reproduce the problem at the actual boundary before making another code change.

A visual or native regression is not permission to replace a working library's renderer, CSS, geometry, or syntax handling with application-owned approximations.

Prioritize work that:

- Prevents user-data loss or corruption.
- Keeps blocking or expensive work off the EDT.
- Prevents credentials, tokens, and private content from entering logs.
- Cleans up application-owned processes, streams, native views, and temporary files.
- Ignores stale asynchronous UI results.
- Provides straightforward cancellation and shutdown for active user work.
- Fixes demonstrated hangs, leaks, races, and performance problems.

## Prefer Direct Fixes

Use this order:

1. Fix the affected method or class directly.
2. Reuse an existing project helper when it fits naturally.
3. Duplicate a few obvious lines when sharing would create coupling.
4. Extract a helper after real duplication appears.
5. Create a framework only when multiple current components need the same contract.

Prefer `try/finally`, ordinary `CompletableFuture`, a small executor, Swing lifecycle checks, and idempotent `close()` over custom orchestration.

Do not introduce the following without a concrete current need:

- Generic lifecycle or task-ownership frameworks.
- Settlement graphs, branch views, leases, permits, or proof protocols.
- Generation or epoch systems when cancellation, request identity, or an object identity check is sufficient.
- Capability APIs for ordinary application-owned files and processes.
- Per-endpoint adversarial limits for normal trusted SDK responses.
- Defenses against an attacker who already controls the same user account.
- Architecture-wide bans on ordinary JDK APIs.
- Abstractions with one production consumer.
- Production hooks created solely to test implausible failure states.

## Proportional Security

Always:

- Protect credentials and private user data at rest, in memory where practical, and in diagnostics.
- Preserve OAuth state, PKCE, callback validation, and token-handling requirements.
- Validate remotely supplied commands, paths, markup, and URLs when they cross a real trust boundary.
- Prevent silent data corruption and unsafe overwrite behavior.
- Keep JavaScript-to-Java and browser navigation surfaces narrow.

Do not automatically model user-selected local files, localhost callbacks, provider SDK objects, or same-user processes as hostile enough to justify public-server defenses. Handle malformed data and ordinary failures, but document the threat model before adding server-grade isolation, exhaustive limits, or adversarial protocol machinery.

A restartable single-user application usually does not require multi-tenant availability guarantees or durable coordination protocols. Stronger controls remain appropriate when the application accepts untrusted plugins, serves remote clients, executes remotely supplied commands, or stores data for multiple users.

## Swing and the EDT

- Create and mutate Swing components on the EDT.
- Run blocking I/O, process waits, parsing, and expensive rendering off the EDT.
- Return only the latest still-relevant result to the EDT. Start with cancellation, request identity, or a disposed/component-presence check.
- Treat component removal as different from permanent disposal when a view can be reattached.
- Make permanent cleanup explicit and idempotent.
- Preserve the active look and feel, focus traversal, accessibility, and keyboard behavior rather than replacing standard controls unnecessarily.

## Choose Rendering Technology Proportionally

Keep application chrome in Swing: windows, menus, dialogs, settings, toolbars, lists, forms, navigation, and commands. Standard Swing controls integrate with EDT rules, accessibility, focus, keyboard navigation, and the active look and feel.

Use the simplest renderer that satisfies the content:

1. Use normal Swing components for ordinary application UI.
2. Use `JEditorPane` for simple HTML and as a no-native fallback.
3. Add an embedded WebView only when browser layout or JavaScript solves a concrete problem, such as rich Markdown, syntax highlighting, KaTeX, Mermaid, streaming DOM updates, or browser-quality selection and copy.

Do not move settings or navigation into HTML merely to make the interface look modern.

### WebView Options

There is no universally best Swing WebView:

- **SwingWebView (`ca.weblite:webview`)** reuses WKWebView on macOS, WebView2 on Windows, and WebKitGTK on Linux. Its factory selects heavyweight mode on macOS/Windows and lightweight off-screen mode on Linux ([platform behavior](https://github.com/webliteca/swingwebview/blob/e92183c9c0ba8701674211aa459bf91b1ce3d724/README.md#L20-L38)). Distribution size is lower, but prerequisites and rendering differ by platform.
- **JCEF** provides a consistent Chromium engine and stronger browser tooling, but brings native packaging, startup/extraction, and roughly 100 MB platform bundles ([JCEF Maven distribution behavior](https://github.com/jcefmaven/jcefmaven/blob/67099e3f84c3f8424f293609224b068dbc17c03b/README.md#L39-L64)). Choose it only when consistent Chromium behavior materially benefits the application.
- **`JEditorPane`** is a useful reduced-content fallback for basic documents and headless tests, not a replacement for modern browser layout.

Resolve availability once during startup, choose the best available engine, and keep a fallback. Native initialization failure should reduce rendering quality, not prevent application startup. If replacing global native state at runtime is unreliable, persist the engine selection and apply it after restart.

Keep engine-specific code behind a small application-facing interface: load a rendered document, apply an incremental script when needed, return the Swing component, and dispose resources. Share the document renderer, CSS, assets, callback payloads, and navigation policy across engines.

### SwingWebView Practices

Use `WebViewComponent.create()` unless a verified platform problem requires a specific mode. Do not duplicate the library's platform selection with an application-specific mode matrix.

Heavyweight browser components participate in AWT heavyweight/lightweight Z-order rules. SwingWebView recommends heavyweight popups where popups overlap a heavyweight browser ([popup guidance](https://github.com/webliteca/swingwebview/blob/e92183c9c0ba8701674211aa459bf91b1ce3d724/README.md#L79-L127)). Smoke-test focus, menus, tooltips, dialogs, and popups on each supported OS.

Register narrow JavaScript callbacks before page load when practical. SwingWebView documents EDT continuations and displayed-lifecycle restrictions ([threading and lifecycle](https://github.com/webliteca/swingwebview/blob/e92183c9c0ba8701674211aa459bf91b1ce3d724/README.md#L291-L304)); verify the behavior of the version in use.

Dispose the component when its owning view is permanently closed. `WebViewComponent.dispose()` releases native resources and is also invoked when its peer is destroyed ([component lifecycle](https://github.com/webliteca/swingwebview/blob/e92183c9c0ba8701674211aa459bf91b1ce3d724/src/ca/weblite/webview/swing/WebViewComponent.java#L245-L262)). Do not build a separate resource framework around it.

### Practical JCEF Lessons

IntelliJ is useful implementation evidence, but its platform infrastructure is not a template for a small desktop application.

Retain these lessons:

1. **Use one process-wide CEF runtime.** IntelliJ lazily initializes one application and reports unsupported, headless, and runtime-version cases ([initialization and support checks](https://github.com/JetBrains/intellij-community/blob/95976e01533f29f87d572eeff1fb8d6a1c550fa2/platform/ui.jcef/jcef/JBCefApp.java#L375-L455)). A small application needs only one runtime owner and a simple availability result.
2. **Own browser resources explicitly.** IntelliJ links browser and client disposal ([browser/client ownership](https://github.com/JetBrains/intellij-community/blob/95976e01533f29f87d572eeff1fb8d6a1c550fa2/platform/ui.jcef/jcef/JBCefBrowserBase.java#L191-L207)). Close browsers, clients, routers, and handlers when permanently disposed.
3. **Keep bridges narrow and removable.** IntelliJ registers and removes query handlers with router state ([query cleanup](https://github.com/JetBrains/intellij-community/blob/95976e01533f29f87d572eeff1fb8d6a1c550fa2/platform/ui.jcef/jcef/JBCefJSQuery.java#L112-L180)). Prefer named actions to generic RPC.
4. **Control navigation at the browser boundary.** IntelliJ delegates or blocks user navigation through request handlers ([navigation handling](https://github.com/JetBrains/intellij-community/blob/95976e01533f29f87d572eeff1fb8d6a1c550fa2/platform/ui.jcef/jcef/JBCefBrowserBase.java#L499-L563)). Keep application assets internal and open ordinary external links in the desktop browser.
5. **Register custom schemes before initialization.** IntelliJ enforces this ordering ([scheme registration](https://github.com/JetBrains/intellij-community/blob/95976e01533f29f87d572eeff1fb8d6a1c550fa2/platform/ui.jcef/jcef/JBCefApp.java#L606-L646)). Configure required local schemes once during startup.

Do not reproduce IntelliJ's `Disposable` hierarchy, registries, health monitors, query pools, remote-development support, or browser-service abstractions unless independently required.

### Shared WebView Patterns

- Select System WebView, JCEF, or `JEditorPane` through one startup availability/fallback decision.
- Keep one document renderer and one set of browser assets across engines.
- Render expensive Markdown, diagrams, and highlighting off the EDT; apply only the newest result on the EDT.
- Start with complete-document reloads. Add incremental JavaScript only after measured flicker or cost justifies synchronization complexity.
- Limit callbacks to explicit actions such as open, copy, retry, or a named message command.
- Use application-owned virtual/local URLs for documents and bundled assets. Block arbitrary in-WebView navigation.
- Make engine changes restart-required when native runtime replacement is unreliable.
- Test rendering, callback parsing, and navigation policy as ordinary units; reserve native smoke tests for packaged operating systems.

## WebView, GraalJS, and Existing JavaScript Libraries

A balanced rich-content stack has three roles:

1. **Java/Swing owns state, commands, persistence, and application controls.**
2. **GraalJS performs DOM-free JavaScript transformations off the EDT.**
3. **The WebView handles browser layout, DOM interaction, SVG/canvas, selection, and client-side enhancement.**

GraalJS is an embeddable ECMAScript runtime available through Maven's `org.graalvm.polyglot` artifacts ([embedding options](https://github.com/oracle/graaljs/blob/c01ed6332407e7ed76d0bb7b090e28c95562ea39/README.md#L20-L55)). It lets Java use established JavaScript libraries without launching Node.js or maintaining a Java port.

Benefits include:

- Reuse mature KaTeX, highlight.js, Markdown, formatting, and parsing behavior.
- Produce deterministic initial HTML before loading the browser.
- Test pure rendering without starting a native WebView.
- Bundle and pin scripts, styles, and fonts for offline use and consistent versions.
- Share assets between GraalJS preprocessing and WebView enhancement.
- Keep the browser bridge focused on user interaction rather than general computation.
- Degrade to escaped source, plain code, or reduced HTML when an optional renderer fails.

Run DOM-free functions such as syntax highlighting, `renderToString` math, parsing, and formatting in GraalJS. Run DOM measurement, interactive diagrams, canvas/SVG layout, and browser events in the WebView.

Do not add a fake DOM to force a browser library into GraalJS. Java-embedded GraalJS has restricted capabilities and does not provide Node.js built-ins by default ([Java versus Node embedding](https://github.com/oracle/graaljs/blob/c01ed6332407e7ed76d0bb7b090e28c95562ea39/docs/user/NodeJSVSJavaScriptContext.md#L8-L36), [module compatibility](https://github.com/oracle/graaljs/blob/c01ed6332407e7ed76d0bb7b090e28c95562ea39/docs/user/NodeJSVSJavaScriptContext.md#L63-L68)). Use the WebView or another library when code requires `window`, `document`, Node built-ins, or native NPM modules.

Embedding rules:

- Load only pinned, bundled scripts and retain their licenses.
- Wrap each operation with a small Java API such as `renderMath(source)` or `highlight(source, language)`. Do not expose a general script console.
- Keep host, file, and network access disabled unless a specific trusted integration requires it. Pass plain data instead of arbitrary Java objects.
- Execute rendering off the EDT.
- Reuse an initialized context when startup cost matters, but serialize access or use separate contexts for parallel work. A GraalJS context cannot be accessed concurrently ([threading model](https://github.com/oracle/graaljs/blob/c01ed6332407e7ed76d0bb7b090e28c95562ea39/docs/user/Multithreading.md#L10-L21)).
- Close contexts when their application-level renderer is permanently shut down. Do not create one context per code block or formula.
- Cache pure results only when profiling shows value.
- Escape normal text and use renderer safe modes. Generated HTML is not automatically trusted.
- Keep a Java fallback so optional rendering failure does not block the document.

Account for dependency size, startup, warmup, memory, and packaging. This stack is justified when it removes substantial custom rendering code or clearly improves content, not for a minor visual effect.

Test Java wrappers through GraalJS, shared document generation without a browser, browser-only DOM behavior in WebView tests, and the combined stack in one packaged-platform smoke test.

## FlatLaf and Modern Swing

FlatLaf is a practical foundation for modern Swing. Install the look and feel before creating components ([startup guidance](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/README.md#L121-L143)). The IntelliJ Themes Pack provides ordinary FlatLaf theme classes inspired by the JetBrains plugin ecosystem ([themes pack](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-intellij-themes/README.md#L1-L35)); it does not require the IntelliJ Platform.

- Prefer standard Swing components, layout managers, spacing, and focused FlatLaf client properties over custom-painted controls.
- Read colors, fonts, borders, and metrics from `UIManager`.
- Prefer `FlatSVGIcon` or another scalable icon source. FlatLaf SVG icons refresh dark-theme state when the look and feel changes ([SVG behavior](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-extras/src/main/java/com/formdev/flatlaf/extras/FlatSVGIcon.java#L702-L724)).
- Register application defaults before installing the look and feel instead of forking theme classes ([custom defaults](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-core/src/main/java/com/formdev/flatlaf/FlatLaf.java#L932-L954)).
- Apply theme changes on the EDT and refresh windows with `FlatLaf.updateUI()` or `updateUILater()` ([UI refresh](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-core/src/main/java/com/formdev/flatlaf/FlatLaf.java#L1269-L1295)).
- Persist a stable theme identifier and fall back to a known bundled theme.
- Generate WebView CSS from a small palette derived from `UIManager`, pass explicit light/dark state, and refresh the document after theme changes. Do not mirror every UI default into CSS.

## Fonts, HiDPI, and Retina

Treat Swing sizes and coordinates as logical user-space values. Modern JDKs and FlatLaf map them to device scale. Do not multiply font sizes by monitor scaling or convert them to physical pixels.

- Use `UIManager` fonts and derive only the required family, style, or logical size. FlatLaf scales the default UI font ([font scaling](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-core/src/main/java/com/formdev/flatlaf/FlatLaf.java#L735-L752)).
- Preserve composite Unicode fallback. FlatLaf builds a composite UI font through `StyleContext` ([composite fonts](https://github.com/JFormDesigner/FlatLaf/blob/4405b1f263a3dace1d624cc61e7adb0dfd5af134/flatlaf-core/src/main/java/com/formdev/flatlaf/FlatLaf.java#L754-L762)). Test non-Latin text, emoji, combining marks, and code glyphs.
- Measure custom text with the component's `FontMetrics` or `TextLayout`, not character counts.
- Preserve Swing's `Graphics2D` rendering hints instead of forcing one antialiasing mode.
- Invalidate custom text/image caches after font, look-and-feel, or graphics-configuration changes.
- Let layout managers, preferred sizes, font metrics, and scaled gaps determine control sizes.
- Use SVG or resolution-independent painting so icons and text scale together. Retina does not require separate font resources.
- Derive WebView CSS fonts from the active Swing theme when useful, but do not apply native monitor scale twice; browsers already map CSS pixels.

Test representative UI at 100%, 125%, 150%, and 200% where supported, including Retina and mixed-DPI monitor moves. Look for clipping, bad baselines, fixed-height controls, blurry custom text, and fallback-font gaps. Prefer behavioral and geometry assertions with targeted visual smoke tests over pixel-perfect screenshots.

## Testing Scope

Test likely application-owned behavior:

- Success and ordinary failure.
- Cancellation and permanent close when supported.
- EDT confinement and stale-result suppression.
- Persistence and recovery.
- Secret-safe diagnostics.
- Theme persistence, fallback, and EDT updates.
- WebView availability and fallback selection.
- Internal navigation, external-link delegation, unsupported-scheme blocking, and callbacks after disposal.
- Small native startup/disposal smoke tests on packaged platforms.

Add exact-boundary adversarial, executor-rejection, filesystem-substitution, exhaustive state-transition, or pixel-perfect theme tests only when production requirements intentionally support the corresponding risk.

## Complexity Checkpoint

Before a significant desktop design, record:

- New types and abstractions.
- Number of current production consumers.
- Simpler alternative considered.
- Concrete failure prevented.
- Why restart or a local fix is insufficient.

If the explanation is weak, simplify.
