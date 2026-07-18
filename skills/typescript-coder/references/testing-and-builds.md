# Testing and Builds

When the task is to create or substantially modify tests, also load the **write-tests** skill, its [TypeScript reference](../../write-tests/references/typescript.md), and every matching runner reference. This reference defines stack and validation policy; the write-tests references provide the focused test-authoring workflow and runner APIs.

## Validation Contract

Discover authoritative commands from `package.json`, workspace configuration, CI, and contributor docs. Do not invent a parallel command set when the repository already has one.

Run the narrowest useful check first:

1. Test directly related to the change.
2. Package type check.
3. Package lint and formatter check.
4. Package test suite.
5. Workspace-affected checks.
6. Build, package, desktop smoke, browser E2E, CDK synth/diff, or deployment-free integration checks as relevant.

Validation commands must not rewrite tracked source, snapshots, lockfiles, or committed generated artifacts, and must not change infrastructure state unless the requested task includes that update. Builds, packages, and synthesis may create disposable ignored output such as `dist/`, coverage files, or `cdk.out/`; keep it out of commits and clean or report it according to repository policy.

## Type Checking

A passing transpile is not a passing type check. Ensure the relevant source and tests are covered by `tsc --noEmit`, `tsc -b`, framework check tools, `deno check`, or another compiler-backed command.

Some frameworks use multiple TypeScript programs. Validate the correct configs for app, server, tests, workers, and tooling. Do not assume one root `tsc --noEmit` covers framework-generated types or project references.

Use type-level tests when exported generic behavior or declaration contracts matter. Keep them focused; most runtime behavior belongs in ordinary tests.

## Test Selection

Preserve the current runner.

- **Vitest:** strong default for Vite/modern TypeScript applications and packages.
- **`node:test`:** low-dependency choice for small Node-only code.
- **Jest:** valid where its ecosystem, transforms, mocks, or existing suite matter.
- **Bun test:** use when Bun runtime semantics are intended; do not infer Node compatibility from it.
- **Deno test:** use in Deno projects with explicit permissions.
- **Playwright:** critical browser workflows and cross-browser behavior.
- **Framework-native tools:** use Angular, Next.js, Svelte, Tauri, Electron, or other established project guidance where applicable.

Avoid replacing a runner only for style preference.

## Test Design

- Test observable behavior, business rules, and boundary contracts.
- Cover success, expected failure, cancellation/timeout, cleanup, and denial paths where relevant.
- Test validators with malformed and adversarial boundary values, not only valid fixtures.
- Keep tests deterministic: own clocks, randomness, ports, temporary directories, network fakes, and process cleanup.
- Prefer realistic integration tests at adapters over deeply mocked implementation tests.
- Do not assert private call sequences unless they are the contract.
- Keep snapshots small and reviewable. Never use snapshots as the sole proof of authorization, IAM, validation, or complex behavior.
- Run runtime-specific tests under every runtime the package claims to support.

## Builds by Artifact

Choose tools from the output, not popularity:

- **Direct Node application:** `tsc` emit can be sufficient when no bundling is needed.
- **Browser application:** use the framework or Vite build pipeline already selected.
- **Library:** validate JavaScript formats, declarations, exports, source maps, side effects, and packed consumers. Add a bundler only when artifact requirements need it.
- **CLI:** validate shebang, executable mode, `bin` path, startup, signals, and packed installation.
- **Desktop:** package and smoke-test on supported operating systems; native signing/installers cannot be proven by unit tests alone.
- **CDK:** compile/test/synth/validate/diff without deploying during normal validation.

Fast transpilers such as esbuild, SWC, Oxc/Rolldown, Bun, and framework compilers normally strip types. Keep compiler checking separate.

## Browser and UI Testing

Use a layered strategy:

- Pure logic and state transitions as unit tests.
- Components with user-observable queries and interactions.
- Integration tests for routing, data loading, forms, and error states.
- Playwright E2E for critical flows, accessibility smoke checks, and browser-specific behavior.

Prefer role/label/text queries over CSS selectors tied to implementation. Accessibility checks supplement—not replace—keyboard and screen-reader-aware design review.

## Coverage

Coverage is diagnostic, not a target to game. Prioritize untested branches with business, security, lifecycle, or data-integrity consequences. Do not add low-value tests solely to raise a percentage.

## Build and CI Safety

- Use frozen/immutable dependency installs.
- Separate checks from write/fix tasks.
- Do not expose secrets to forked/untrusted jobs.
- Cache package-manager and build data using lockfile/config keys; do not cache secrets or mutable release credentials.
- Keep release, publish, deploy, code-sign, and updater-key operations behind explicit protected workflows.
- Report skipped checks and environmental limitations clearly.

## Sources

- [Node.js test runner](https://nodejs.org/api/test.html)
- [Vitest guide](https://vitest.dev/guide/)
- [Playwright documentation](https://playwright.dev/docs/intro)
- [Bun test runner](https://bun.sh/docs/test)
- [Deno testing](https://docs.deno.com/runtime/fundamentals/testing/)
- [Vite production build](https://vite.dev/guide/build)
