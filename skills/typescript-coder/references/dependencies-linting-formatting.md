# Dependencies, Linting, and Formatting

## Dependency Decisions

Before adding a dependency, check:

- Can the runtime, framework, or an existing dependency already solve the problem clearly?
- Is the package maintained, compatible with the selected runtime/module system, and appropriate for browser/server/desktop use?
- Does it execute lifecycle scripts, native code, build plugins, or code during synthesis?
- What transitive dependencies, bundle size, permissions, and license obligations does it add?
- Is the package needed in production or only development?

Use the repository package manager to change dependencies. Review both manifest and lockfile. Do not hand-edit integrity data or use forced resolutions/overrides without documenting the incompatibility and validating runtime behavior.

Keep dependency upgrades focused. Major upgrades, runtime changes, framework migrations, and formatter-version changes deserve separate reviewed work because they can produce wide semantic or formatting diffs.

## ESLint

### Existing projects

Preserve the installed ESLint generation and configuration unless migration is requested. Legacy `.eslintrc` projects may have plugin/framework constraints; do not convert them in an unrelated patch.

### New configuration

- Use flat config (`eslint.config.js`, `.mjs`, `.cjs`, or `.ts` as supported by the actual setup).
- Use `typescript-eslint` shared flat configs rather than manually wiring parser/plugin internals without need.
- Start with recommended rules. Add type-aware presets when semantic bug detection justifies their additional type-check cost.
- Prefer `parserOptions.projectService: true` for typed linting when supported by the installed `typescript-eslint` version.
- Scope files, ignores, globals, and framework plugins explicitly.
- Ensure config files, tests, generated code, scripts, and package boundaries are either included intentionally or ignored intentionally.
- Keep CI lint non-writing. `--fix` is an editing operation, not validation.

Type-aware rules are especially valuable for floating promises, unsafe values, promise misuse, and unnecessary conditions. Do not enable every strict/stylistic rule mechanically; some presets are intentionally opinionated and may change across versions.

## Formatting Authority

Use one formatter for each file set:

- **Prettier** is the broad-compatibility greenfield default, with extensive language/plugin support and familiar integration.
- **Biome** is a strong fast formatter/linter/assist option when its language and framework coverage meets project needs.
- **dprint, oxfmt, framework formatters, or project-specific tools** remain valid where established.

Do not run Prettier and Biome over the same TypeScript files unless explicit boundaries prevent conflicts. A repository may validly use one tool for TypeScript/JSON and another for Markdown or templates.

When ESLint and a formatter coexist, disable conflicting stylistic rules. Do not make ESLint a second formatter. Pin formatter versions through the lockfile because formatting output can change between releases.

Honor `.editorconfig` for basic whitespace where the formatter does. Avoid duplicating every formatter option in editor, linter, and CI configuration.

## Biome versus Typed ESLint

Biome can consolidate formatting and many lint rules with excellent speed. It should not be described as universally equivalent to TypeScript-compiler-backed `typescript-eslint` rules or the full ESLint plugin ecosystem. Choose based on:

- Required semantic/type-aware rules.
- Framework plugins and custom rules.
- Language/file coverage.
- Performance and configuration simplicity.
- Migration diff size and contributor tooling.

A valid setup may use Biome for formatting/basic lint plus a small typed ESLint pass, but only if responsibilities are explicit and the complexity earns its value.

## Suppressions

- Fix the cause before suppressing a rule.
- Scope unavoidable suppressions to the smallest line or file.
- Include a reason when the exception is not self-evident.
- Do not disable unsafe rules globally to accommodate one untyped dependency; isolate that boundary.
- Generated and vendored files should be ignored through configuration rather than filled with comments.

## Scripts

For a greenfield package, conventional scripts may include:

```jsonc
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "format": "prettier --write .",
    "test": "vitest run",
    "build": "..."
  }
}
```

Adapt commands to the framework, workspace, runtime, and output model. A declaration/build project may use `tsc -b`; Deno and Bun projects use their native commands where selected. Do not add scripts that merely duplicate an authoritative workspace task runner without benefit.

## Supply-Chain Safety

- Treat install scripts, ESLint plugins, format plugins, bundler plugins, test environments, and custom loaders as executable code.
- Prefer locked, reviewed dependencies and reproducible CI installs.
- Do not expose registry tokens to untrusted pull-request scripts.
- Use short-lived publishing credentials and provenance/signing mechanisms when the project's release policy supports them.
- Audit reports require triage. Do not apply blanket major upgrades or dependency overrides solely to make a scanner green.

## Sources

- [ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting)
- [typescript-eslint Project Service](https://typescript-eslint.io/blog/project-service/)
- [Prettier documentation](https://prettier.io/docs/)
- [Biome formatter differences](https://biomejs.dev/formatter/differences-with-prettier/)
- [Biome linter](https://biomejs.dev/linter/)
