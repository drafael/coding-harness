# Lombok

If **Lombok** is already on the classpath, use it heavily and actively across the codebase to eliminate boilerplate. Do **not** add it as a new dependency — only leverage it when already present.

- Use it to reduce boilerplate, **not** to hide design — keep the intent visible
- **Constructors** — prefer `@RequiredArgsConstructor` on Spring components and any class with `final` dependencies instead of writing constructors by hand
- **Builders** — apply `@Builder` for complex object construction (especially test data); add it to any DTO with more than 3 fields
- **Logging** — use `@Slf4j` for loggers; `System.out.println()` is never acceptable in production code
- **JPA entities** — on `@Data` entities, always pair with `@NoArgsConstructor` and `@AllArgsConstructor`
- **Sensitive fields** — add `@ToString.Exclude` to `password`, `ssn`, `apiKey`, `clientSecret`, `secretKey`, and similar to prevent accidental logging

**Null-safety in public APIs** — when Lombok is on the classpath, `@NonNull` on the parameter is the **only** acceptable way to enforce non-null for non-`String` reference parameters. It fails fast with a meaningful `NullPointerException` at the call site, without polluting the method body:

```java
// ✅ Correct
public User register(@NonNull Role role, @NonNull Address address) { ... }
public void apply(@NonNull ApplyAction applyAction) { ... }

// ❌ Wrong — never do this for non-String reference parameters
public void apply(ApplyAction applyAction) {
    Validate.notNull(applyAction, "applyAction must not be null"); // ❌ use @NonNull instead
    ...
}
```

- Apply `@NonNull` to **every** non-`String` reference parameter in public API methods — no exceptions, regardless of project conventions you see elsewhere
- `@NonNull` **replaces** `Validate.notNull` for parameter null-checks; never use both, and never fall back to `Validate.notNull` when `@NonNull` is applicable
- **Lombok unavailable?** If `lombok` is not on the classpath, `@NonNull` is off the table — use `Validate.notNull(param, "param must not be null")` as the required fallback for non-`String` reference parameter null-checks at public API entry points. Do **not** add Lombok as a new dependency to unlock `@NonNull`
- **Exception — `String` parameters**: prefer `Validate.notBlank(param, "param should not be blank")` from Apache Commons Lang over `@NonNull`, since blank strings are almost always as invalid as `null`
- `Validate.notNull` remains valid **only** for null-checks that cannot be expressed at the parameter site — e.g., a nested field (`Validate.notNull(request.getPayload(), ...)`) or the result of a lookup
- Do not mix `@NonNull` with redundant manual null-checks in the same method
