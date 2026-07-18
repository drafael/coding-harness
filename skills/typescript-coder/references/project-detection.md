# Project Detection and Decision Precedence

Use this reference before planning or changing an unfamiliar TypeScript repository.

## Activation

Treat a repository or package as TypeScript when one or more of these provide meaningful evidence:

- `tsconfig.json` or `tsconfig.*.json`.
- Maintained `.ts`, `.tsx`, `.mts`, or `.cts` sources.
- `typescript` in dependencies/devDependencies.
- TypeScript framework or build evidence such as `vite.config.ts`, `next.config.ts`, `nuxt.config.ts`, a TypeScript-enabled Angular workspace, `svelte.config.ts`, maintained Svelte `<script lang="ts">` sources, or a typed package entry. JavaScript-only framework config is not sufficient by itself.
- Generated TypeScript is present together with handwritten TypeScript configuration or consumers.

A stray generated declaration file or vendored `.ts` file alone is not enough. Do not automatically activate for JavaScript-only repositories.

## Inspect in Order

### Repository instructions

Read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, package READMEs, architecture docs, and task-specific instructions. In monorepos, look for nearer instructions at the package boundary.

### Package and runtime

Inspect:

- Root and relevant package `package.json` files.
- `packageManager`, `engines`, `type`, `exports`, `imports`, scripts, and workspaces.
- Lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, or `deno.lock`.
- Runtime pins: `.nvmrc`, `.node-version`, `.tool-versions`, Volta fields, mise config, Dockerfiles, and CI setup.
- `bunfig.toml`, `deno.json`, `deno.jsonc`, or runtime-specific scripts.

If multiple lockfiles exist, determine whether they belong to independent packages or indicate accidental drift. Do not choose one and delete others without evidence and approval.

### Compiler, build, quality, and CI

Inspect:

- All applicable `tsconfig*.json`, including `extends` chains and project references.
- Build configs for Vite, Rollup/Rolldown, esbuild, webpack, tsup/tsdown, framework CLIs, Electron tools, or Tauri.
- `eslint.config.*`, legacy `.eslintrc*`, `biome.json*`, Prettier config, and `.editorconfig`.
- Test configuration and scripts for Vitest, Jest, Node, Bun, Deno, Playwright, Cypress, WebdriverIO, or framework tooling.
- CI workflows to discover authoritative install, check, build, package, synth, and deployment commands.

### Code conventions

Read representative production files, tests, and configuration from the area being changed. Check naming, import style, file layout, error handling, dependency boundaries, and test conventions before writing code.

## Classify Each Package

A monorepo can contain several profiles:

- **Direct Node.js:** executed by Node without an application bundler.
- **Bun-native:** scripts/runtime/tests intentionally execute under Bun.
- **Deno:** controlled by Deno configuration and commands.
- **Browser/frontend:** built by a browser framework or bundler.
- **Backend/server:** handles HTTP, queues, jobs, or other service boundaries.
- **Library:** published or consumed by other packages; packaging and declaration contracts matter.
- **CLI/TUI:** exposes commands or terminal interaction.
- **Desktop:** Electron, Electrobun, or Tauri markers are present.
- **AWS CDK:** depends on `aws-cdk-lib`/`constructs` and usually has `cdk.json`, `bin/`, or stack sources.

Apply all relevant profiles. A package can be both CLI and library, frontend and desktop renderer, or backend and CDK-adjacent.

## Stack Markers

- **Electron:** `electron`, Electron Forge, electron-builder, Electron imports, main/preload entries.
- **Electrobun:** `electrobun`, `electrobun.config.ts`, `electrobun/bun`, or `electrobun/view`.
- **Tauri 2:** `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.*`, capabilities, or `@tauri-apps/*`.
- **CLI:** `bin` entries, shebangs, Commander, yargs, oclif, Clipanion, citty, or command parser code.
- **TUI:** Ink, OpenTUI, terminal-kit, Blessed-family libraries, React terminal renderers, raw TTY/ANSI handling.
- **CDK:** `aws-cdk-lib`, `constructs`, `cdk.json`, CDK app entry points, stacks, or stages.

The package manager does not identify the runtime. `bun.lock` in an Electron project does not make it Electrobun.

## Decision Rules

- Existing repository commands and configuration win over greenfield defaults.
- A framework's installed-version conventions win over generic examples.
- Preserve local module format and import behavior unless migration is the task.
- Use repository dependency commands; do not hand-edit only `package.json` and leave the lockfile stale.
- Do not normalize a monorepo to one tool merely because packages differ intentionally.
- Ask before broad migrations, major upgrades, new production dependencies, package-manager changes, lockfile replacement, or public API changes when requirements do not already authorize them.

## Report for Unfamiliar Projects

Before consequential work, be able to summarize:

- Package boundary and application profile.
- Runtime and supported version policy.
- Package manager and lockfile.
- Module system and compiler/build path.
- Linter, formatter, test runner, and relevant scripts.
- Trust boundaries and deployment/package path.
- Any ambiguity that could change the implementation approach.
