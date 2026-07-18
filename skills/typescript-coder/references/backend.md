# Backend TypeScript

Apply these rules to HTTP services, workers, queues, scheduled jobs, WebSockets, and backend-for-frontend packages.

## Architecture

Use the smallest structure that keeps responsibilities clear:

```text
transport/framework → application use case → domain logic → infrastructure adapter
```

- Transport owns HTTP/RPC parsing, authentication context, status codes, and response serialization.
- Application code coordinates use cases and transactions.
- Domain code owns business invariants where the domain warrants a distinct layer.
- Infrastructure adapters own databases, queues, files, external APIs, and framework-specific details.

Do not create layers with no meaningful boundary. Conversely, do not put business rules directly into route handlers when they need reuse or focused tests.

## Input and Output Boundaries

- Treat body, query, path, headers, cookies, messages, database JSON, and upstream responses as untrusted runtime values.
- Validate and normalize once near the boundary. Infer types from schemas when the chosen library supports it, avoiding duplicate interfaces that can drift.
- Validate output where contract integrity or Fastify-style serialization schemas justify it.
- Authentication establishes identity; authorization decides whether that identity may perform the operation. Apply authorization in every access path.
- Bound body sizes, uploads, pagination, batch sizes, concurrency, retries, and timeouts according to exposure.

## Errors and Observability

- Map known domain/application errors to stable public responses in one boundary layer.
- Return generic 5xx details to clients while preserving safe structured diagnostics internally.
- Preserve causes and attach request/trace identifiers without logging secrets or entire untrusted payloads.
- Use structured logs with stable event names and fields. Avoid interpolated log strings that are difficult to query.
- Distinguish expected client failures from operational failures; do not page on routine validation errors.

## Lifecycle and I/O

- Load and validate configuration once at startup, then pass typed configuration inward. Avoid scattered environment reads.
- Fail startup on invalid required configuration rather than failing on the first request.
- Use connection pooling and close servers, workers, consumers, telemetry, and database clients during graceful shutdown.
- Propagate cancellation/time budgets where downstream APIs support them.
- Retry only transient failures, with bounded backoff/jitter and idempotency analysis.
- Avoid blocking synchronous work on request paths. Move CPU-heavy work to workers/processes when measurement justifies it.

## Framework Adaptation

### Express

- Build focused routers and middleware; keep handlers thin enough to expose application intent.
- Validate before application logic and centralize error translation in error middleware.
- Understand the installed Express generation's async error behavior; do not copy version-incompatible wrappers.
- Configure proxy trust, cookies, CORS, body limits, and security headers according to the real deployment topology.

### Fastify

- Prefer route JSON Schema for validation and serialization where the project uses Fastify's schema model.
- Keep TypeScript schema types and runtime schemas derived from one source or verified together.
- Use plugins and encapsulation for ownership, not a global decoration dumping ground.
- Treat schemas as application code. Fastify warns that validation/serialization uses dynamic code generation; do not compile user-provided schemas.
- Perform database-backed authorization in hooks/handlers after structural validation, not as an initial schema validator.

### NestJS

- Use constructor injection and cohesive modules/providers.
- Use `ValidationPipe` or the project's chosen schema pipe at transport boundaries; configure transformation/whitelisting deliberately rather than assuming defaults.
- Use guards for authorization, interceptors for cross-cutting request behavior, pipes for transformation/validation, and exception filters for boundary translation.
- Keep business logic out of controllers and avoid resolving providers through a service locator when normal injection works.

### Hono

- Account for the actual target runtime—Node, Bun, Deno, Cloudflare Workers, or another edge platform.
- Use Hono validation middleware or the established schema adapter and retrieve validated values through the framework's validated access path.
- Keep middleware environment bindings and context variables typed.
- Avoid Node-only APIs in portable/edge packages unless the deployment target supports them.

## Persistence and Transactions

- Parameterize queries; never build SQL from unchecked interpolation.
- Keep transaction boundaries around one application operation and avoid remote network calls inside long transactions when possible.
- Treat ORM types as persistence representations, not automatic public API schemas.
- Plan migrations for compatibility, rollback/recovery, and data volume. Do not run destructive schema changes implicitly at service startup in production.
- Make idempotency explicit for retried messages, webhooks, payments, and job processing.

## Testing

Prioritize:

- Pure business rules and validators.
- Route/transport integration with realistic framework injection/test helpers.
- Authorization denial paths and tenant/resource ownership.
- Persistence adapters against a representative database where query semantics matter.
- Timeout, retry, idempotency, shutdown, and duplicate-message behavior.
- Contract tests for external APIs or generated clients at the integration boundary.

## Sources

- [Fastify validation and serialization](https://fastify.io/docs/latest/Reference/Validation-and-Serialization/)
- [Fastify TypeScript](https://fastify.io/docs/latest/Reference/TypeScript/)
- [NestJS validation](https://docs.nestjs.com/techniques/validation)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [Hono validation](https://hono.dev/docs/guides/validation)
- [Hono testing](https://hono.dev/docs/guides/testing)
- [Express security best practices](https://expressjs.com/en/advanced/best-practice-security.html)
