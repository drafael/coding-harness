# Language notes

Load this reference only when language semantics are central to the explanation. Explain the constructs used by the target, not every language feature listed here.

## JavaScript and TypeScript

Distinguish compile-time TypeScript types from runtime validation. Explain Promise creation, `async`/`await`, rejection propagation, and fire-and-forget work when relevant. Clarify closure capture, lexical scope, `this` binding, arrow functions, module boundaries, and event-loop scheduling only where they affect behavior.

Do not assume a typed value is validated at runtime.

## Python

Explain generator laziness, comprehensions, decorators, context managers, async functions, and exception flow when used. For classes, clarify method resolution, descriptors, and class-versus-instance state when relevant. Watch for mutable defaults and late-bound closures when they affect the code, but do not turn the explanation into a review.

## Java

Explain generic bounds, type erasure, records, sealed types, pattern matching, annotations, streams, lambdas, and exception flow when used. Distinguish checked and unchecked exceptions. For concurrent code, identify the executor, thread ownership, synchronization, and completion mechanism established by the implementation.

Do not describe an annotation’s behavior without locating its processor, framework contract, or runtime handling.

## Go

Explain implicit interface satisfaction, pointer versus value receivers, goroutine ownership, channel direction, blocking behavior, `select`, `defer`, and explicit error flow when relevant. Clarify whether cancellation comes from a context and where that context is observed.

Do not assume a launched goroutine is safely owned or eventually joined.

## Rust

Explain ownership moves, borrowing, lifetimes, pattern matching, traits, generics, `Option`, `Result`, and error propagation where they shape the flow. For asynchronous code, distinguish futures from execution and identify the runtime or spawn boundary actually used.

Do not frame compiler-enforced safety as proof of domain correctness.

## Other languages

Use the same method: explain only semantics that materially affect control flow, data representation, ownership, errors, or runtime behavior. Verify framework and language-version behavior from repository context or authoritative documentation when it is not evident from the code.
