---
name: java-coder
description: Java/Spring Boot coding standards and preferences. Load this skill whenever writing, reviewing, or refactoring Java or Spring Boot code to ensure consistent style and architecture.
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Java Coding Standards

These are non-negotiable standards. Apply them to every piece of Java or Spring Boot code you write or modify.

## General

- **Favor readability over cleverness** — write for the next person who reads this code
- **Comment only complex or non-obvious logic** — never restate what the code already expresses
- **Choose names that reveal intent** for variables, methods, and classes
  - Exception: catch-block variables should be a single character by default (e.g., `catch (Exception e)`, `catch (Throwable t)`), 
    - or `catch (Exception ignored)` for empty catch blocks, 
    - or `catch (Exception ex)`, or `catch (Throwable cause)` to avoid name conflicts
- **Follow established language and project conventions**

---

### Imports

- Always prefer simple class names over fully qualified names — add an import instead:
  - ✅ `ClassName` | ❌ `com.package.ClassName` *(unless the name conflicts with another import)*
- Always use **static imports** for utility methods, including but not limited to:
  - `Collections.emptyList()`, `Collections.emptyMap()`, `Collections.emptySet()`
  - `Collectors.toList()`, `Collectors.toSet()`, `Collectors.toMap()`, `Collectors.joining()`
  - `Predicate.not(...)` — write `not(User::isDeleted)`, not `Predicate.not(User::isDeleted)`

---

### Collections & Optionals

- Prefer empty-collection factory methods over `List/Map/Set.of()` for empty collections:
  - ✅ `emptyList()`, `emptyMap()`, `emptySet()`
- Prefer `List.of(array)` over `Arrays.asList(array)`
- Never use `Optional` as a method parameter or class field — it is **exclusively a return type**

---

### Apache Commons Lang 3

If **Apache Commons Lang v3+** is already on the classpath, use it heavily and actively across the codebase. Do **not** add it as a new dependency — only leverage it when already present.

For the full guidance — including the `Strings.CS` / `Strings.CI` migration table for deprecated `StringUtils` methods and the `Validate` rules for public-API arguments — see [`references/apache-commons-lang3.md`](references/apache-commons-lang3.md).

---

### Lombok

If **Lombok** is already on the classpath, use it heavily and actively across the codebase to eliminate boilerplate. Do **not** add it as a new dependency — only leverage it when already present.

For the full guidance — including the `@RequiredArgsConstructor` / `@Builder` / `@Slf4j` / `@ToString.Exclude` rules and the `@NonNull` vs. `Validate.notNull` policy for public-API arguments — see [`references/lombok.md`](references/lombok.md).

---

### Code Style

- **Always wrap statement bodies in braces**, even for single-line blocks
- Prefer `String.formatted(...)` over `+` string concatenation
- Prefer **stream-based functional iteration** over `for`/`while` loops
- Prefer the **ternary operator** or a **`switch` expression** over `if` statements where it improves clarity
- Prefer **method references** over equivalent lambdas when the lambda only forwards its argument to a single method or constructor:
  - ✅ `.map(String::toLowerCase)` | ❌ `.map(s -> s.toLowerCase())`
  - ✅ `.forEach(System.out::println)` | ❌ `.forEach(x -> System.out.println(x))`
  - ✅ `.map(User::new)` | ❌ `.map(dto -> new User(dto))`
  - ✅ `.filter(Objects::nonNull)` | ❌ `.filter(x -> x != null)`
  - Keep the lambda form when it adds logic (extra arguments, transformation, multiple statements) — readability wins over terseness
- Prefer **functional interface composition** (`Function.andThen` / `compose`, `Consumer.andThen`, `Predicate.and` / `or` / `negate` / `Predicate.not`) over lambdas that only forward inputs through existing `Function`, `Consumer`, or `Predicate` values — see [`references/functional-composition.md`](references/functional-composition.md) for examples and when to keep the lambda.

---

### `var` Usage

`var` is allowed **only when the inferred type is immediately and unambiguously clear**:

| ✅ Allowed | ❌ Disallowed |
|---|---|
| Constructor calls: `var foo = new Foo();` | Complex or chained expressions |
| Builder calls: `var bar = Bar.builder().build();` | Method return values where the type is not obvious |

- `var` is **freely allowed in tests** at the author's discretion

---

### Sensitive Data & `record` Classes

- **Always override `toString`** in `record` classes to prevent sensitive fields from leaking into logs
  - Fields to mask include (but are not limited to): `password`, `ssn`, `apiKey`, `clientSecret`, `secretKey`

---

### Method Formatting

- Keep method declarations and invocations on a **single line** when they fit reasonably
- When a method has multiple arguments and the line becomes too long or hard to read, **format each argument on its own line** with the closing parenthesis on a separate line — except for lambda blocks, where `})` should remain on the same line:

```java
// ✅ Multi-line when needed
someMethod(
    firstArgument,
    secondArgument,
    thirdArgument
);

someMethodWithLambda(e -> {
    // ...
}); // ✅ should remain on the same line

// ✅ Single line when it fits
someMethod(firstArgument, secondArgument);
```

## Tech Stack

| Concern       | Choice                                                              |
|---------------|---------------------------------------------------------------------|
| Language      | Java 21+ — use modern features (records, sealed classes, patterns) |
| Framework     | Spring Boot — match the project version; follow Spring idioms      |
| Build         | Maven (preferred) or Gradle                                        |
| Persistence   | JPA/Hibernate · PostgreSQL · H2 (tests)                            |
| Testing       | JUnit 5 · Mockito                                                  |

## Spring Boot Rules

For Spring Boot–specific rules — dependency injection, layered architecture, API design, error handling, validation, and code style — see [`references/spring-boot-rules.md`](references/spring-boot-rules.md).

## Formatting

Resolve formatting rules in this order — stop at the first match:

1. **`.editorconfig`** — if present at the project root, it takes precedence for indent style, indent size, line endings, and charset
2. **IDE code style settings** — check for exported scheme files:
   - IntelliJ IDEA (preferred): `.idea/codeStyles/`, `*.xml` schemes, or `Project.xml`
   - Eclipse: `.settings/org.eclipse.jdt.core.prefs` or a `.xml` formatter profile
3. **Infer from the codebase** — when neither of the above exists, read several existing source files and match their conventions exactly (indentation, brace style, import ordering, line length, etc.)

Never impose personal formatting preferences. The goal is consistency with what is already there.

## Testing

Use the **java-coder** and **test-coverage** skills if available

**Assertions**
- Always use AssertJ — never raw JUnit assertions

**Naming**
- Test methods: `{methodName}_{precondition}_{expectedOutcome}`
- `@DisplayName`: human-readable sentence describing the scenario; never echo the method name
- The instance of the class under test: always `subject`

**Structure**
- Prefer `@InjectMocks` over constructing the tested class manually in `@BeforeEach`
- Prefer `var` for locals initialized by a constructor or builder call
- Extract expected values into named constants only when they appear in multiple test cases; inline single-use values

**Scope**
- Only test business logic and services — never write tests for JPA/Hibernate entities, DTOs, `@Configuration` beans, or Spring Data repositories

## Security

- Never hardcode credentials, secrets, or tokens — always externalise them via environment variables or a secrets manager
- Validate and sanitize all user input at system boundaries; trust nothing from the outside
- Apply OWASP best practices by default — injection, broken access control, and insecure design are never acceptable
- Keep security concerns consistent across the stack; a secure API means nothing if the service layer bypasses it
