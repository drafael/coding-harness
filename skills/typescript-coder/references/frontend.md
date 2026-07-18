# Frontend TypeScript

Apply these rules to browser applications and framework code. Follow the installed framework generation and repository conventions before generic patterns.

## Component and State Design

- Keep components focused on rendering and interaction; move reusable non-UI logic into plain typed functions or framework-appropriate composables/services/hooks.
- Keep state as local as practical. Introduce global state only for genuinely shared ownership or coordination.
- Derive values instead of synchronizing duplicate state with effects/watchers.
- Model loading, empty, success, stale, and failure states explicitly when they affect behavior.
- Preserve stable identity for list items and stateful components; do not use array indexes as keys when order can change.
- Avoid premature memoization. Measure before adding caches that complicate dependencies and stale-value behavior.

## Server and Client Boundaries

- Treat browser code as public. Never bundle secrets, private environment variables, service credentials, or privileged authorization logic into it.
- Validate server responses and persisted client data when they cross a meaningful trust boundary.
- Authorization belongs on the server even when the UI hides unavailable actions.
- Keep server-only modules out of client dependency graphs. Respect framework server/client markers and serialization constraints.
- Protect state-changing browser requests using the framework/platform's appropriate CSRF, origin, cookie, and same-site strategy.
- Sanitize untrusted HTML. Prefer framework escaping and structured rendering over raw HTML APIs.

## Accessibility

- Start with semantic HTML and native controls.
- Every interactive control needs an accessible name, keyboard behavior, visible focus, and appropriate disabled/loading semantics.
- Associate labels, descriptions, errors, and form controls programmatically.
- Manage focus for dialogs, route changes, validation failures, and dynamically inserted content without surprising the user.
- Use ARIA only when native semantics are insufficient and implement the complete interaction pattern.
- Respect reduced motion, zoom, text reflow, color contrast, and high-contrast modes.
- Linter/compiler accessibility warnings are useful but do not replace keyboard and assistive-technology-aware testing.

## Data Fetching and Errors

- Use the framework's recommended server/client data model before adding another state-fetching library.
- Own request cancellation and stale-response handling when navigation or repeated input can supersede work.
- Do not retry mutations blindly. Make optimistic updates reversible and reconcile authoritative results.
- Render actionable user-safe errors while preserving diagnostic context outside the UI.
- Error boundaries isolate rendering failures; they do not replace handling expected request or validation errors.

## Performance

- Measure production behavior before optimizing.
- Split code at routes/features where the framework supports it; do not fragment every component.
- Keep large dependencies and server-only packages out of browser bundles.
- Optimize images, fonts, and third-party scripts using framework facilities.
- Virtualize genuinely large collections and preserve accessibility.
- Avoid layout thrashing and unbounded observers/listeners; clean up effects and subscriptions.

## Framework Adaptation

### React and Next.js

- Follow the Rules of Hooks and the installed React lint plugin.
- Keep effects for synchronization with external systems, not ordinary derivation.
- In Next.js App Router, default to server components where appropriate and add client boundaries only for state, effects, event handlers, or browser APIs.
- Treat Server Actions and Route Handlers as externally reachable server endpoints: authenticate, authorize, validate, and avoid returning sensitive fields.
- Use Next.js data-security guidance for tainting/data-access layers where the installed version supports it; do not rely on client component visibility as security.

### Vue and Nuxt

- Prefer `<script setup lang="ts">` and framework-supported type patterns where established.
- Keep composables cohesive and independent of component lifecycle unless lifecycle is their purpose.
- Preserve reactivity when destructuring or crossing boundaries; use official utilities rather than broad casts.
- In Nuxt, respect server-only code, runtime config visibility, auto-import conventions, and SSR/hydration constraints.

### Angular

- Keep strict template/type checking enabled in new projects and follow the current Angular style guide.
- Prefer standalone components and the installed generation's recommended signal/RxJS interop rather than forcing one state model everywhere.
- Use dependency injection normally and keep services cohesive; avoid using global injectors as service locators.
- Use Angular testing and accessibility tooling from the installed CLI/toolchain.

### Svelte and SvelteKit

- Preserve Svelte's compile-time accessibility warnings and TypeScript checking with `svelte-check`/framework commands.
- Use the installed Svelte generation's reactivity model; do not mix legacy and current syntax casually.
- In SvelteKit, keep secrets and privileged work in server-only modules, validate actions/endpoints, and respect load-function serialization.
- Follow framework routing and form-action conventions before adding custom client state machinery.

## Testing

- Test components through roles, names, labels, text, and user interactions rather than internal state or CSS structure.
- Cover keyboard interaction, loading/error/empty states, form validation, and stale/cancelled requests.
- Use browser E2E tests for critical navigation, authentication, permissions, and cross-browser behavior.
- Add automated accessibility checks as a safety net, then manually review keyboard/focus behavior for important flows.
- Keep visual snapshots targeted; they do not prove interaction or accessibility.

## Sources

- [React TypeScript](https://react.dev/learn/typescript)
- [React rules and linting](https://react.dev/reference/eslint-plugin-react-hooks)
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security)
- [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js testing](https://nextjs.org/docs/app/guides/testing)
- [Vue TypeScript](https://vuejs.org/guide/typescript/overview.html)
- [Vue accessibility](https://vuejs.org/guide/best-practices/accessibility.html)
- [Angular style guide](https://angular.dev/style-guide)
- [Angular testing](https://angular.dev/guide/testing)
- [Svelte TypeScript](https://svelte.dev/docs/svelte/typescript)
- [Svelte testing](https://svelte.dev/docs/svelte/testing)
- [SvelteKit accessibility](https://svelte.dev/docs/kit/accessibility)
