# Apache Commons Lang 3

If **Apache Commons Lang v3+** is already on the classpath, use it heavily and actively across the codebase. Do **not** add it as a new dependency — only leverage it when already present.

- Replace manual blank/null checks with `StringUtils`:
  - ✅ `StringUtils.isNotBlank(str)` | ❌ `str != null && !str.isBlank()`
  - ✅ `StringUtils.isBlank(str)` | ❌ `str == null || str.isBlank()`
  - ✅ `StringUtils.isNotEmpty(str)` | ❌ `str != null && !str.isEmpty()`
  - ✅ `StringUtils.isEmpty(str)` | ❌ `str == null || str.isEmpty()`
  - ✅ `StringUtils.defaultIfBlank(str, fallback)`, `StringUtils.trimToNull(str)`, `StringUtils.trimToEmpty(str)` for common transformations
- Prefer `ObjectUtils`, `CollectionUtils`, and `ArrayUtils` over hand-rolled null/empty checks when the library is available.
- Use `ObjectUtils.isEmpty(collection)` for null-or-empty collection checks:
  - ✅ `if (ObjectUtils.isEmpty(items)) { ... }`
  - ❌ `if (items == null || items.isEmpty()) { ... }`
- Use `ObjectUtils.firstNonNull(...)` when initializing the same variable from multiple nullable fallback sources — prefer one expression over repeated `if` assignments:
  - ✅ `Color color = ObjectUtils.firstNonNull(UIManager.getColor("A"), UIManager.getColor("B"), fallback);`
  - ❌ `Color color = UIManager.getColor("A"); if (color == null) { color = UIManager.getColor("B"); } if (color == null) { color = fallback; }`
  - ✅ `var endpoint = ObjectUtils.firstNonNull(configuredEndpoint, environmentEndpoint, defaultEndpoint);`
  - ❌ `var endpoint = configuredEndpoint; if (endpoint == null) { endpoint = environmentEndpoint; } if (endpoint == null) { endpoint = defaultEndpoint; }`
  - Keep ternary-only fallback expressions unchanged. Do **not** replace simple expressions like `return value != null ? value : fallback;` with `ObjectUtils.firstNonNull(value, fallback)`.

**Deprecated `StringUtils` comparison/search methods** — Commons Lang 3.18+ deprecated the case-sensitive/insensitive method pairs on `StringUtils` in favor of the `Strings` facade. Use `Strings.CS` (case-sensitive) and `Strings.CI` (case-insensitive) singletons instead — never call the deprecated `StringUtils` variants:

| ❌ Deprecated `StringUtils` | ✅ Use instead |
|---|---|
| `StringUtils.equals(a, b)` | `Strings.CS.equals(a, b)` |
| `StringUtils.equalsIgnoreCase(a, b)` | `Strings.CI.equals(a, b)` |
| `StringUtils.compare(a, b)` | `Strings.CS.compare(a, b)` |
| `StringUtils.compareIgnoreCase(a, b)` | `Strings.CI.compare(a, b)` |
| `StringUtils.contains(a, b)` | `Strings.CS.contains(a, b)` |
| `StringUtils.containsIgnoreCase(a, b)` | `Strings.CI.contains(a, b)` |
| `StringUtils.startsWith(a, b)` | `Strings.CS.startsWith(a, b)` |
| `StringUtils.startsWithIgnoreCase(a, b)` | `Strings.CI.startsWith(a, b)` |
| `StringUtils.endsWith(a, b)` | `Strings.CS.endsWith(a, b)` |
| `StringUtils.endsWithIgnoreCase(a, b)` | `Strings.CI.endsWith(a, b)` |
| `StringUtils.indexOf(a, b)` | `Strings.CS.indexOf(a, b)` |
| `StringUtils.indexOfIgnoreCase(a, b)` | `Strings.CI.indexOf(a, b)` |
| `StringUtils.lastIndexOf(a, b)` | `Strings.CS.lastIndexOf(a, b)` |
| `StringUtils.lastIndexOfIgnoreCase(a, b)` | `Strings.CI.lastIndexOf(a, b)` |
| `StringUtils.equalsAny(s, ...)` | `Strings.CS.equalsAny(s, ...)` |
| `StringUtils.equalsAnyIgnoreCase(s, ...)` | `Strings.CI.equalsAny(s, ...)` |
| `StringUtils.replace(text, search, repl)` | `Strings.CS.replace(text, search, repl)` |
| `StringUtils.replaceIgnoreCase(text, search, repl)` | `Strings.CI.replace(text, search, repl)` |
| `StringUtils.replaceOnce(text, search, repl)` | `Strings.CS.replaceOnce(text, search, repl)` |
| `StringUtils.replaceOnceIgnoreCase(text, search, repl)` | `Strings.CI.replaceOnce(text, search, repl)` |
| `StringUtils.removeStart(s, p)` | `Strings.CS.removeStart(s, p)` |
| `StringUtils.removeStartIgnoreCase(s, p)` | `Strings.CI.removeStart(s, p)` |
| `StringUtils.removeEnd(s, p)` | `Strings.CS.removeEnd(s, p)` |
| `StringUtils.removeEndIgnoreCase(s, p)` | `Strings.CI.removeEnd(s, p)` |
| `StringUtils.appendIfMissing(s, suffix)` | `Strings.CS.appendIfMissing(s, suffix)` |
| `StringUtils.appendIfMissingIgnoreCase(s, suffix)` | `Strings.CI.appendIfMissing(s, suffix)` |
| `StringUtils.prependIfMissing(s, prefix)` | `Strings.CS.prependIfMissing(s, prefix)` |
| `StringUtils.prependIfMissingIgnoreCase(s, prefix)` | `Strings.CI.prependIfMissing(s, prefix)` |

- Apply the same rule to **any** other `StringUtils` method that appears as a case-sensitive/case-insensitive pair: pick `Strings.CS.*` for the case-sensitive variant and `Strings.CI.*` for the `*IgnoreCase` variant. If the IDE or compiler flags a `StringUtils` call as deprecated, migrate it.
- The non-deprecated, single-form `StringUtils` methods (`isBlank`, `isEmpty`, `isNotBlank`, `isNotEmpty`, `defaultIfBlank`, `trimToNull`, `trimToEmpty`, `substringBefore`, `capitalize`, etc.) remain on `StringUtils` — keep using them.
- When migrating an existing file, update **every** deprecated call you touch in that file, not just the one you came for.

**Validation in public APIs** — use `Validate` for argument validation in public methods, **except for non-`String` reference null-checks** (those belong to Lombok's `@NonNull` — see the Lombok section in `SKILL.md`):

```java
Validate.notBlank(strParam, "strParam should not be blank");
Validate.isTrue(amount > 0, "amount must be positive, got: %d", amount);
Validate.notEmpty(items, "items must not be empty");
```

- Always include a descriptive message identifying the parameter and the violated constraint
- Use `Validate` at the **entry points of public APIs** — do not pollute internal/private methods with redundant checks already enforced upstream
- ❌ **Never use `Validate.notNull(param, ...)` on a non-`String` reference parameter when Lombok is on the classpath** — use `@NonNull` on the parameter declaration instead. `Validate.notNull` is reserved for nulls that cannot be expressed at the parameter site (e.g., nested fields, values returned from a call)
- ✅ **If Lombok is *not* on the classpath**, `Validate.notNull(param, "param must not be null")` becomes the required fallback for non-`String` reference parameter null-checks — apply it consistently at public API entry points
