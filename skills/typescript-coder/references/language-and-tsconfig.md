# TypeScript Language and Compiler Guidance

## Language Rules

### Model uncertainty honestly

- Use `unknown` for external or unproven values and narrow it with control flow, predicates, or runtime schemas.
- Do not use `any` as a convenient escape hatch. When an untyped dependency forces it, contain the unsafe value in one adapter and return a safe type.
- Avoid double assertions such as `value as unknown as Target`; they usually bypass a real contract mismatch.
- Prefer `@ts-expect-error` with a short reason over `@ts-ignore` when intentionally testing or isolating an expected compiler failure. Remove it when no longer necessary.

### Express state and contracts

- Use discriminated unions for mutually exclusive states instead of several booleans or partially valid optional fields.
- Make `switch` handling exhaustive when all variants must be covered. A `never` helper is appropriate when the runtime should reject unknown future input too.
- Prefer unions or `as const` maps for application-domain constants. Preserve enums when an established public API, generated contract, or framework requires them.
- Prefer `readonly` contracts and immutable updates where they clarify ownership. Do not clone large structures reflexively or ban local mutation inside an owned implementation.
- Prefer `satisfies` when checking an expression against a contract while retaining its useful inferred type.
- Use branded/opaque types only when confusing structurally identical values has caused or is likely to cause real defects.

### Functions and classes

- Let obvious local return types infer. Add explicit return types to exported/public functions when they stabilize an API or catch accidental changes.
- Use overloads only when callers receive meaningfully different types. Prefer a union parameter when one implementation contract is enough.
- Use classes for identity, lifecycle, encapsulated mutable state, or framework contracts—not merely to group unrelated functions.
- Avoid optional boolean parameters that obscure call sites; use a named options object when behavior needs explanation or growth.
- Keep callbacks synchronous unless the receiving API awaits them. A promise returned to `forEach`, event emitters, and many framework hooks may be ignored.

### Nullability and collections

- Distinguish missing, explicitly undefined, null, empty, and failed states according to the domain.
- Do not use `!` to erase lifecycle or initialization uncertainty. Narrow, initialize, or redesign ownership.
- Remember indexed access may be missing. Prefer safe access or enable `noUncheckedIndexedAccess` in new projects.
- Use `Map` for non-string keys, insertion-order semantics, or frequent dynamic updates; use plain objects for records/serialization where appropriate.

## New-Project Compiler Baseline

Use explicit intent rather than relying only on compiler-version defaults:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedSideEffectImports": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Add `noImplicitReturns`, `noFallthroughCasesInSwitch`, and unused-code checks when they match framework and generated-code behavior. Do not enable a large strictness set in an unrelated patch to an existing repository.

## Derive Configuration from the Executor

### Direct modern Node.js

Choose the execution branch explicitly:

- **Emitted JavaScript:** normally use `module: "NodeNext"`, an explicit target based on the lowest supported Node release, and `outDir`/`rootDir` as needed. Source import specifiers must produce runtime-valid emitted imports; under Node ESM this commonly means writing the final `.js` extension in relative TypeScript imports. Build with `tsc` and execute the emitted JavaScript.
- **Native Node type stripping:** use only erasable TypeScript syntax supported by the selected Node release. The current Node guidance uses `module: "NodeNext"`, `target: "ESNext"`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `rewriteRelativeImportExtensions`. Import `.ts` extensions as required by direct execution. Node ignores `tsconfig.json` while executing and does not type-check, transform TSX, downlevel syntax, or honor TypeScript-only path rewriting, so run `tsc --noEmit` separately.
- **Loader or runner (`tsx`, `ts-node`, or equivalent):** preserve the installed tool's documented ESM/CommonJS, extension, cache, and production-support model. Do not assume its behavior matches native stripping or emitted output.

In every branch, set an explicit package `type` and test the command used in production.

### Bundler or Bun

For code consumed by Vite or another bundler, use the framework-generated config where available. Otherwise `module: "Preserve"` or `"ESNext"` with `moduleResolution: "Bundler"` is the usual model. Bun recommends bundler-style resolution. Keep a separate type check because bundlers and Bun transpilation do not prove type correctness.

### Browser

Include DOM libraries only in browser-capable packages. Keep server-only globals and dependencies out of browser compilation. Derive target/browser support from the framework and product support policy rather than setting `ESNext` blindly.

### Published library

Design from the consumer contract: emitted JavaScript formats, package exports, declaration files/maps, supported runtime level, side-effect metadata, and packed-artifact tests. Do not copy an application tsconfig. Dual ESM/CommonJS publication is specialized work and requires consumer testing.

### Deno

Preserve `deno.json`/`deno.jsonc`, Deno import conventions, `deno check`, `deno lint`, `deno fmt`, and `deno test`. Do not add Node-only config or a second package manager unless the existing Deno project already uses npm interoperability.

## Important Options

- **`target`**: lowest supported runtime/browser syntax, not “whatever is newest.”
- **`lib`**: only globals available to the package; avoid accidental DOM globals in server code.
- **`types`**: explicitly include runtime/test globals where needed and keep test globals out of production configs.
- **`rootDir`/`outDir`**: set deliberately when emitting.
- **`declaration`/`declarationMap`**: library contract choices, not application defaults.
- **`sourceMap`**: coordinate with runtime and error-reporting policy; do not accidentally publish sensitive source.
- **`skipLibCheck`**: preserves speed but can hide declaration conflicts. Preserve the repository choice and change it only with a reason.
- **`paths`**: affects TypeScript resolution, not necessarily runtime resolution. Configure the actual runtime/bundler or use package imports/exports.
- **`composite` and references**: useful for independently buildable workspace packages; avoid adding project-reference complexity without a measurable need.

## Multiple Configs

Use focused configs when environments genuinely differ, for example:

- base shared strictness,
- browser application,
- server application,
- tests,
- build/tooling scripts,
- emitted library package.

Do not create `tsconfig.eslint.json` automatically. Modern `typescript-eslint` Project Service can often use the same project model as editors.

## Runtime Validation

Type annotations do not validate JSON, environment variables, database rows, messages, or IPC. Validate close to the entry boundary, then pass a trusted typed value inward. Reuse the established schema system. A hand-written guard is sufficient for small stable shapes; a schema library is justified when schemas are numerous, nested, transformed, documented, or shared.

## Sources

- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript `module` reference](https://www.typescriptlang.org/tsconfig/module.html)
- [TypeScript `verbatimModuleSyntax`](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)
- [Node.js TypeScript modules](https://nodejs.org/api/typescript.html)
- [Bun TypeScript](https://bun.sh/docs/runtime/typescript)
- [Deno TypeScript](https://docs.deno.com/runtime/fundamentals/typescript/)
