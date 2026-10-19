# Spring Boot Rules

**Dependency Injection**
- Always use constructor injection — never field injection (`@Autowired` on fields)

**Architecture**
- Enforce the layered boundary: `Controller → Service → Repository`
- Never let repositories leak into controllers, or business logic leak into controllers

**API Design**
- Follow RESTful conventions for endpoint naming, HTTP methods, and status codes
- Use DTOs for all request/response payloads — keep them separate from JPA entities
- Default to Java records for DTOs; only use classes when mutability is required
- When Jackson is already used, prefer annotated DTOs for incoming JSON events with stable schemas, following established binding conventions rather than hand-written field-by-field tree traversal.
- Preserve independent handling of malformed entries when the event contract requires it. Keep `JsonNode` or tree parsing for genuinely dynamic content or boundaries deliberately bound separately.

**Error Handling & Validation**
- Centralize exception handling with `@ControllerAdvice`
- Declare constraints with Bean Validation annotations (`@NotNull`, `@Size`, etc.)
- Return `Optional<T>` from methods that may produce no result; avoid returning `null`

**Code Style**
- Prefer streams and functional pipelines over imperative loops, when it reads clearly
- For Lombok usage (`@RequiredArgsConstructor` on Spring components, `@Slf4j`, `@Builder`, `@NonNull`, etc.), see the **Lombok** section in `SKILL.md`
