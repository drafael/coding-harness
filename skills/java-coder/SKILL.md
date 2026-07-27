---
name: java-coder
description: Mandatory for every task in a Java codebase, including planning, implementation, debugging, refactoring, review, testing, Maven or Gradle build and dependency changes, performance or security analysis, and Java-related documentation. Detect Java projects from pom.xml, Gradle files, gradlew, or .java sources. Load before inspecting or changing the repository even when the user does not explicitly mention Java. Covers Java 21+, Spring Boot, Swing/EDT, code style, testing, security, and desktop UI.
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# Java Coding Standards

## Activation Scope

This skill is mandatory for every task in a Java codebase, not only direct Java source edits. Apply it while planning, investigating, debugging, reviewing, testing, changing Maven or Gradle configuration and dependencies, analyzing security or performance, and updating Java-related documentation. Load task-relevant files under `references/` before making decisions or changes.

These are non-negotiable standards. Apply them to every piece of Java or Spring Boot code you write or modify.

## General

- **Favor readability over cleverness** — write for the next person who reads this code
- **Comment only complex or non-obvious logic** — never restate what the code already expresses
- **Choose names that reveal intent** for variables, methods, and classes
  - Exception: catch-block variables should be a single character by default (e.g., `catch (Exception e)`, `catch (Throwable t)`),
    - or `catch (Exception ignored)` for empty catch blocks,
    - or `catch (Exception ex)`, or `catch (Throwable cause)` to avoid name conflicts
- **Follow established language and project conventions**

## Scope and Complexity Discipline

These rules are mandatory for implementation, debugging, security, reliability, and review work:

- Start from the concrete failure and change the narrowest responsible boundary.
- Do not redesign neighboring subsystems unless the user explicitly approves that expanded scope.
- Prefer a local method or class change over a new service, framework, protocol, ownership model, or lifecycle abstraction.
- A new abstraction needs multiple current production consumers or a clear existing contract. A hypothetical future consumer does not count.
- Before adding more than a few production types or crossing subsystem boundaries, pause and present the simpler alternative and regression risk to the user.
- A plan is not evidence that every proposed mechanism is necessary. Revalidate each step against what investigation and tests actually demonstrate.
- Do not add production APIs or hooks solely to simulate implausible failures in tests.
- Do not preserve failed approaches as compatibility scaffolding. Revert to the last known-good behavior, isolate the failing boundary, and try the smallest different fix.
- After two unsuccessful or unverified attempts at the same issue, stop iterating. Reassess the premise, trace the full data/control path, and require boundary-appropriate evidence.
- Before completion, audit the whole diff and remove speculative limits, dead helpers, duplicate lifecycle paths, unused dependencies, and one-consumer abstractions.

For local Java desktop applications, load [`references/desktop-apps.md`](references/desktop-apps.md) before making security, lifecycle, shutdown, native-view, rendering, or resource-ownership changes.

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

- **Do not override `toString` by default** in `record` classes — use the generated implementation unless the record contains sensitive, secret, or PII data
- **Override `toString` only when a record has fields that must not leak into logs or error messages**
  - Fields to mask include (but are not limited to): `password`, `ssn`, `apiKey`, `token`, `clientSecret`, `secretKey`, `privateKey`, `accessKey`, `refreshToken`
  - When overriding, include non-sensitive fields normally and replace sensitive values with a fixed mask like `"****"`; never partially reveal secrets unless explicitly required by the domain

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

## Desktop Applications

For local, primarily single-user Java desktop applications, use the proportional design, Swing/EDT, WebView, GraalJS, FlatLaf, and HiDPI guidance in [`references/desktop-apps.md`](references/desktop-apps.md). Project context and demonstrated risk override public-server defaults; this never weakens credential secrecy, OAuth correctness, user-data integrity, or EDT safety.

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
- For Spring/server applications, focus tests on business logic and services — do not test JPA/Hibernate entities, DTOs, `@Configuration` beans, or Spring Data repository implementation details
- For desktop applications, also test application-owned EDT, lifecycle, persistence, theme, rendering, and fallback behavior as described in [`references/desktop-apps.md`](references/desktop-apps.md); do not duplicate native-library test suites

## Security

- Never hardcode credentials, secrets, or tokens — use an appropriate external credential source or secure application-owned store
- Validate and sanitize data at real trust boundaries, especially remotely supplied commands, paths, markup, and URLs
- Apply OWASP best practices to public web services and other exposed network boundaries — injection, broken access control, and insecure design are never acceptable
- Keep security concerns consistent across the stack; a secure API means nothing if the service layer bypasses it
- For local single-user desktop applications, apply the proportional threat-model guidance in [`references/desktop-apps.md`](references/desktop-apps.md) instead of importing server-grade assumptions by default
