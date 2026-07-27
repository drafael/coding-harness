---
name: typescript-coder
description: Mandatory for every task in a TypeScript or mixed TypeScript codebase, including planning, implementation, debugging, refactoring, review, testing, dependency and build changes, CI, security analysis, and TypeScript-related documentation. Detect projects from tsconfig files, .ts/.tsx sources, TypeScript dependencies, or TypeScript framework configuration. Load before inspecting or changing such repositories. Covers Node.js, Bun, existing Deno projects, backend, frontend, CLI/TUI, Electron, Electrobun, Tauri, AWS CDK, and modern tooling.
---

# TypeScript Coding Standards

## Activation Scope

Apply this skill to every task in a TypeScript or mixed TypeScript repository, not only edits to `.ts` or `.tsx` files. It also governs JavaScript, configuration, tests, dependencies, build scripts, CI, and documentation that belong to that TypeScript project.

Do not activate automatically for JavaScript-only projects. When project type is uncertain, inspect the markers in [`references/project-detection.md`](references/project-detection.md).

Load task-relevant references before making decisions or changes.

## Precedence and Inspection

Resolve decisions in this order:

1. User requirements and repository instructions.
2. Established repository architecture, configuration, scripts, lockfile, and CI.
3. Framework and runtime conventions for the versions actually installed.
4. This skill's greenfield defaults.

Before changing code or tooling, inspect the relevant package boundary and its:

- `package.json`, lockfile, `packageManager`, `engines`, workspaces, and runtime pins.
- `tsconfig*.json` and framework/build configuration.
- ESLint, Biome, Prettier, test, and CI configuration.
- Source layout and several representative files.

Never silently change the runtime, package manager, lockfile format, module system, linter, formatter, test runner, bundler, or framework. Do not generate a second lockfile. See [`references/project-detection.md`](references/project-detection.md).

## General

- Favor readable, unsurprising code over cleverness.
- Follow established project naming, file organization, import, and formatting conventions.
- Keep changes focused; do not combine feature work with unrelated migrations or mass formatting.
- Comment intent, constraints, or non-obvious trade-offs—not syntax.
- Prefer platform and existing-project capabilities before adding a dependency.
- Keep generated files generated; change their source or generator instead.
- Avoid speculative abstractions. Extract shared code when real duplication or a stable boundary justifies it.

## Scope and Complexity Discipline

These rules are mandatory for implementation, debugging, security, reliability, and review work:

- Start from the concrete failure and change the narrowest responsible boundary.
- Do not redesign adjacent packages, processes, or layers unless the user approves the expanded scope.
- Prefer a local function or module change over a new service, framework, protocol, ownership model, or lifecycle abstraction.
- A new abstraction needs multiple current production consumers or a clear existing contract; hypothetical reuse does not count.
- Before adding several production modules, crossing process/package boundaries, or changing architecture, pause and present the simpler alternative and regression risk.
- Treat plans as revisable hypotheses, not checklists. Revalidate each step against what investigation and tests demonstrate.
- Do not add production hooks solely to simulate implausible failures in tests.
- Revert failed approaches instead of preserving or layering over them. After two unsuccessful or unverified attempts, stop and trace the complete boundary before trying again.
- Before completion, audit the whole diff and remove speculative limits, dead helpers, unused dependencies, duplicate lifecycle paths, and one-consumer abstractions.

For TypeScript desktop applications, load [`references/desktop.md`](references/desktop.md) before changing security, IPC/RPC, lifecycle, shutdown, native-view, rendering, updater, or resource-ownership behavior.

## Type Safety

- New projects use explicit strict TypeScript settings. Existing non-strict projects require a deliberate migration, not an unrelated flag flip.
- Use `unknown` for values whose shape is not yet proven. Narrow or validate before use.
- Do not introduce `any` merely to silence the compiler. Contain unavoidable unsafe interoperability at a documented boundary.
- Prefer inference for obvious local values and explicit types for public APIs, recursive structures, overloaded behavior, and boundaries where the contract matters.
- Prefer discriminated unions and exhaustive checks for stateful variants.
- Prefer `import type` and `export type` when imports are type-only.
- Avoid unjustified type assertions, non-null assertions, `@ts-ignore`, and broad lint suppressions. Explain and scope unavoidable exceptions.
- TypeScript types disappear at runtime. Validate untrusted network, IPC, environment, file, CLI, storage, and deserialized input.

Detailed language and compiler guidance: [`references/language-and-tsconfig.md`](references/language-and-tsconfig.md).

## Errors, Async Work, and Resources

- Handle an error only where the code can recover, retry, translate, add useful context, or terminate correctly.
- Preserve the original error with `cause` when wrapping it.
- Never swallow rejected promises or use an async callback where the caller cannot observe its failure unless explicitly fire-and-forget with owned reporting.
- Make timeout, retry, and cancellation behavior explicit at I/O boundaries. Do not retry non-idempotent work blindly.
- Release timers, listeners, streams, subprocesses, sockets, watchers, terminal modes, and native handles on success, failure, cancellation, and shutdown.
- Convert internal failures into stable boundary results: HTTP responses, CLI exit codes, UI states, IPC/RPC errors, or deployment failures. Do not leak secrets or internal traces to untrusted callers.

## Modules, Runtimes, and Packages

- Derive TypeScript module settings from the actual executor: Node.js, Bun/bundler, browser bundler, Deno, or a package consumer.
- Prefer ESM for greenfield applications, but treat established CommonJS as supported compatibility—not a defect.
- Use a supported Node.js LTS release for production; consult the live release schedule rather than hard-coding a major version.
- Treat Bun as its own runtime. Test Bun applications under Bun and check Node compatibility for used APIs and dependencies.
- Preserve existing Deno projects and use Deno-native commands/configuration; do not introduce Deno into other projects by default.
- Transpilation and runtime type stripping are not type checking. Maintain a real non-writing type-check command.
- Use exactly one detected package manager and its normal dependency commands. Commit and respect its lockfile.

See [`references/modules-packages-runtimes.md`](references/modules-packages-runtimes.md) and [`references/dependencies-linting-formatting.md`](references/dependencies-linting-formatting.md).

## Greenfield Baseline

Unless requirements indicate otherwise:

- Supported Node.js LTS, ESM, and strict TypeScript.
- npm for a simple single-package project; pnpm for a workspace/monorepo; Bun tooling for a deliberately Bun-native project.
- ESLint flat configuration with `typescript-eslint`, including type-aware rules when their value justifies the cost.
- Prettier as the broad-compatibility formatting default. Biome is a valid consolidated alternative, not a universal replacement for compiler-backed typed linting.
- Vitest for a typical TypeScript application, `node:test` for a small Node-only project, framework-native tooling where established, and Playwright for critical browser E2E paths.
- Conventional `typecheck`, `lint`, `format:check`, `test`, and `build` scripts where useful. Check commands should not rewrite tracked source; builds may create disposable ignored output.

These are selection defaults, not reasons to migrate an existing repository.

## Application Profiles

Classify each package independently in a monorepo and load applicable guidance:

- Backend, including Express, Fastify, NestJS, and Hono: [`references/backend.md`](references/backend.md)
- Frontend, including React/Next.js, Vue/Nuxt, Angular, and Svelte/SvelteKit: [`references/frontend.md`](references/frontend.md)
- CLI and TUI, including Commander, yargs, Ink, OpenTUI, terminal-kit, and custom ANSI UIs: [`references/cli-and-tui.md`](references/cli-and-tui.md)
- Electron, Electrobun, and Tauri desktop applications: [`references/desktop.md`](references/desktop.md)
- AWS CDK v2 TypeScript applications and constructs: [`references/aws-cdk.md`](references/aws-cdk.md)

A package may use multiple profiles, such as a Next.js frontend with CDK infrastructure or a CLI that launches a TUI.

## Formatting

Resolve formatting in this order:

1. Repository formatter configuration and scripts.
2. `.editorconfig`.
3. Established local style in representative files.
4. Framework defaults for generated/new files.

Use one formatting authority per file set. Do not make ESLint, Prettier, and Biome compete over the same stylistic rules. Never run write-mode formatting merely to validate.

## Testing and Validation

When writing or substantially modifying tests, use the **write-tests** skill, its TypeScript reference, and every matching runner reference when available; this skill continues to govern the project/runtime-specific rules.

Use existing scripts. Validate the smallest relevant scope first, then expand as warranted:

1. Focused test.
2. Type check.
3. Lint.
4. Formatter check.
5. Broader tests.
6. Build/package/synthesis checks.

Validation must not modify tracked source or committed generated artifacts by default. Builds, packaging, and synthesis may create disposable ignored outputs such as `dist/` or `cdk.out/`; clean or report them according to repository policy. Do not auto-fix lint, rewrite formatting, update snapshots, regenerate lockfiles, upgrade dependencies, deploy CDK, publish packages, or release artifacts merely to check work.

Test behavior and trust boundaries rather than implementation trivia. See [`references/testing-and-builds.md`](references/testing-and-builds.md).

## Security

- Never hard-code or log credentials, tokens, cookies, private keys, signing material, or secret configuration.
- Validate, authorize, and bound data at real trust boundaries. Validation does not replace authorization.
- Never interpolate untrusted values into shell commands, SQL, HTML, paths, URLs, regular expressions, or IAM policies without the appropriate safe API and policy checks.
- Treat package lifecycle scripts, build plugins, CDK applications, and third-party constructs as executable code.
- Keep browser, renderer, WebView, IPC/RPC, and native capability surfaces narrow and deny by default.
- Apply proportional controls based on demonstrated exposure while preserving credential secrecy, user-data integrity, and safe update/signing behavior.
- Before adding security machinery, identify the producer, trust boundary, attacker capability, likely impact, and why ordinary validation or recovery is insufficient.
- Do not invent arbitrary quotas or silently reject, truncate, or degrade valid behavior to defend against a theoretical threat.

Detailed guidance: [`references/security.md`](references/security.md).

## Guidance for Developers New to the Ecosystem

Briefly explain consequential choices and commands: the selected runtime and package manager, why a lockfile changed, why a type check is separate from a build, module-resolution implications, new dependency purpose, and any security boundary. Prefer repository scripts over requiring users to memorize tool-specific commands.

Do not hide uncertainty behind jargon. When several tools are reasonable, recommend one, explain the trade-off concisely, and preserve the user's decision.
