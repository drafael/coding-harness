# TypeScript Coder Skill

A global Agent Skill for modern TypeScript repositories. It is designed especially for developers who are not yet familiar with TypeScript, Node.js, Bun, package managers, module systems, linters, formatters, and current testing/build tooling.

## Scope

The skill activates for TypeScript and mixed TypeScript projects and applies to planning, implementation, debugging, refactoring, review, testing, dependencies, builds, CI, security, and documentation.

Supported profiles:

- Node.js and Bun applications
- Existing Deno projects at preservation depth
- Backend: Express, Fastify, NestJS, Hono, and framework-neutral services
- Frontend: React/Next.js, Vue/Nuxt, Angular, Svelte/SvelteKit
- CLI and TUI applications
- Desktop: Electron, Electrobun, Tauri 2
- AWS CDK v2 TypeScript infrastructure
- Libraries, workspaces, and monorepos

## Design principles

1. Inspect and preserve repository choices before applying defaults.
2. Require real type checking; transpilation is not type checking.
3. Validate runtime data at trust boundaries.
4. Prefer one package manager, one lockfile, and one formatting authority.
5. Avoid unsolicited tooling, module-system, or framework migrations.
6. Use progressive disclosure: the core rules stay compact and task-specific details live under `references/`.
7. Explain consequential tooling operations for developers new to the ecosystem.

## Greenfield recommendation

The default starting point is a supported Node.js LTS release, ESM, strict TypeScript, npm for a simple package or pnpm for a workspace, ESLint flat config with `typescript-eslint`, Prettier, and an application-appropriate test runner. Bun-native projects use Bun deliberately rather than treating it as an invisible Node replacement.

These defaults do not override established repository choices.

## Activation examples

The skill should activate for requests such as:

- “Implement this NestJS service and add tests.”
- “Review the TypeScript workspace dependency upgrade.”
- “Fix this React component and its Playwright test.”
- “Add a command to this Bun CLI.”
- “Secure this Electron preload and IPC handler.”
- “Review these AWS CDK stacks before deployment.”

It should not activate automatically for a JavaScript-only project with no maintained TypeScript evidence.

## Limitations

- Deno is supported at preservation depth rather than equal depth with Node.js and Bun.
- React Native, specialized edge runtimes, and dual ESM/CommonJS library publication are not covered deeply in v1.
- Framework and tool defaults change quickly; installed-version documentation still governs migrations and version-specific APIs.
- Organization-specific architecture, compliance, deployment, and release policy takes precedence.

## Installation

The skill is installed globally at:

```text
~/.agents/skills/typescript-coder/
```

Pi and other Agent Skills-compatible harnesses discover the `SKILL.md` file from that location.

For Pi, `~/.pi/agent/extensions/auto-typescript-coder.ts` detects TypeScript and mixed TypeScript repositories and injects this skill into every agent turn automatically. It recognizes `tsconfig*.json`, a declared TypeScript dependency, or maintained `.ts`/`.tsx`/`.mts`/`.cts` source while excluding declaration-only and JavaScript-only evidence. Use `/reload` after changing the extension or start a new Pi session.

## Maintenance

The skill avoids fixed “latest” versions in mandatory rules. Runtime and tool versions change quickly, so consult the official links in each reference when changing configuration or performing a major upgrade. Representative open-source project conventions are evidence, not universal standards.

## Research basis

The guidance prioritizes official documentation from TypeScript, Node.js, Bun, Deno, ESLint, typescript-eslint, Biome, Prettier, framework maintainers, Electron, Tauri, Electrobun, and AWS CDK. Popular projects such as TypeScript, Vite, Zod, and typescript-eslint demonstrate that mature repositories legitimately make different tooling choices; therefore detection and preservation come before defaults.
