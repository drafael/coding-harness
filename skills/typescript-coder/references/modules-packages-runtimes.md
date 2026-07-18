# Modules, Packages, and Runtimes

## Preserve the Execution Model

Before changing imports or build configuration, answer:

1. Who executes the code: Node.js, Bun, Deno, browser bundler, test runner, Electron, or another consumer?
2. Is source executed directly, transformed, or emitted by `tsc`?
3. Is the package an application or a published library?
4. Does `package.json` declare `type`, `exports`, `imports`, or a `bin` entry?
5. Which runtime and module modes do CI and production actually use?

Do not “fix” valid CommonJS solely because ESM is preferred for greenfield work.

## ESM and CommonJS

- Declare package intent explicitly with `"type": "module"` or `"type": "commonjs"` when practical.
- Use `.mts`/`.mjs` and `.cts`/`.cjs` for deliberate per-file overrides, not as random workarounds.
- Under Node ESM, use runtime-valid relative specifiers and extensions according to the emitted/executed artifact.
- Use `import type`/`export type` for type-only edges with `verbatimModuleSyntax`.
- Do not use TypeScript `paths` as if they rewrote imports at runtime.
- Avoid mixing `require` and `import` casually. Use supported interop at a small adapter boundary when necessary.
- Test package `exports` from outside the source tree; source-relative tests can miss broken published paths.

Dual ESM/CommonJS packages can suffer conditional-export and duplicate-instance problems. Treat dual publication as a packaging project with packed consumer tests, not a compiler-toggle change.

## Node.js

- Choose an Active or Maintenance LTS release for production and check the live release schedule.
- Express support in the repository's existing mechanisms: `engines`, version files, Volta/mise/asdf, containers, and CI.
- Prefer `node:` specifiers for built-in modules when consistent with the repository.
- Node native TypeScript stripping does not perform type checking, ignores much compiler behavior, and is not a general TSX/downlevel/package build pipeline.
- Use web-standard APIs where they improve portability, but do not rewrite established Node APIs without value.
- Avoid synchronous filesystem, crypto, compression, or process operations on latency-sensitive server paths.

## Bun

- Bun is a runtime, package manager, bundler, and test runner, but a project may use only one of those roles.
- Detect intended execution from scripts and CI; a Bun lockfile alone does not prove production runs on Bun.
- Test Bun-native code under the pinned/selected Bun version.
- Check Bun's live Node compatibility documentation for native addons and partially compatible modules such as process, workers, VM, inspector, and test APIs.
- Prefer Bun/Web APIs where the project intentionally targets Bun; do not claim Node portability without Node tests.
- Bun transpilation/bundling is not a replacement for `tsc` type checking or declaration validation.

## Deno Preservation

For existing Deno projects:

- Use `deno.json`/`deno.jsonc`, Deno tasks, permissions, lint, format, check, and test commands.
- Preserve URL, JSR, npm, and Node-compatibility import conventions already selected by the project.
- Keep permissions explicit and least-privileged in scripts and deployment.
- Preserve and commit `deno.lock` when the project uses it. Use `deno ci` for a reproducible CI dependency setup, or preserve the project's explicit frozen-lockfile configuration.
- Do not add npm lockfiles, Node loaders, or `tsc` output unless required by the existing interoperability model.

Do not propose Deno for a Node/Bun project unless runtime selection is explicitly in scope.

## Package Managers and Workspaces

Use exactly one manager per package graph:

| Marker | Manager | Reproducible CI install |
|---|---|---|
| `package-lock.json` / `npm-shrinkwrap.json` | npm | `npm ci` |
| `pnpm-lock.yaml` | pnpm | `pnpm install --frozen-lockfile` |
| `yarn.lock` | Yarn | use the repository's Yarn generation; modern Yarn commonly uses `yarn install --immutable` |
| `bun.lock` / `bun.lockb` | Bun | `bun install --frozen-lockfile` |
| `deno.lock` with a Deno project | Deno | `deno ci` |

Use the repository's actual scripts and CI flags if they differ. Do not infer Yarn Classic versus modern Yarn from the lockfile name alone.

- Commit the lockfile for applications and normal workspaces.
- Use the package-manager command to add/remove/update dependencies so manifest and lockfile remain synchronized.
- Preserve workspace protocol and catalog conventions.
- Pin or declare the package-manager generation using `packageManager` or the established tool.
- Corepack may need separate installation on newer Node distributions; do not assume it is bundled forever.
- npm is the lowest-assumption greenfield default for a small package. pnpm is a strong workspace default. Yarn remains valid where established.

## Published Packages

Before release, validate:

- `exports`, `types`, and declaration paths.
- ESM/CJS/default/type conditions used by supported consumers.
- Included files from the packed tarball, not only the source tree.
- Tree-shaking and `sideEffects` claims.
- Lowest supported runtime and TypeScript/declaration compatibility policy.
- Peer dependency ranges and duplicate-runtime risks.
- CLI shebang, executable mode, and `bin` paths where applicable.

Use a temporary consumer or package-validation tool when the public contract matters. Do not publish source-only TypeScript unless consumers and runtime explicitly support that contract.

## Sources

- [Node.js packages](https://nodejs.org/api/packages.html)
- [Node.js ECMAScript modules](https://nodejs.org/api/esm.html)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)
- [Bun bundler](https://bun.sh/docs/bundler)
- [Deno Node and npm compatibility](https://docs.deno.com/runtime/fundamentals/node/)
- [Deno `ci`](https://docs.deno.com/runtime/reference/cli/ci/)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [Corepack](https://github.com/nodejs/corepack)
