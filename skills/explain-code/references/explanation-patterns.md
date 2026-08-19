# Explanation patterns

Choose the smallest pattern that fits the question. These are structures, not mandatory templates.

## Small function or snippet

Explain:

1. purpose in one sentence;
2. inputs and outputs;
3. execution order;
4. non-obvious expressions or branches;
5. side effects and errors;
6. relevant callers or context.

For line-by-line requests, group declarations and obvious forwarding code. Spend detail on state changes, branching, conversions, and language semantics.

## Algorithm

Start with the problem and invariant. Then explain initialization, each repeated step, termination, and result. Use a small concrete input when it clarifies the state transitions.

State time and space complexity only when derivable from the actual loops, recursion, operations, and data structures. Name assumptions, such as average constant-time hash lookup. Do not repeat a textbook complexity merely because the algorithm resembles a known one.

## Request or command flow

Trace:

- registration and entry point;
- parsed input;
- validation and authorization actually present;
- orchestration and domain calls;
- persistence or external calls;
- response or command result;
- error translation and cleanup.

Keep authentication, validation, and transport security separate. Do not infer one from another.

## Event-driven flow

Identify the producer, event shape, publication mechanism, consumer registration, handler behavior, state changes, acknowledgement semantics, and failure path. Explain ordering, duplication, and retry behavior only when established by code or configuration.

A sequence diagram is useful when several producers and consumers interact. A list is usually enough for one producer and one handler.

## Asynchronous or concurrent work

Explain who owns the task, when it starts, whether the caller waits, how results or failures propagate, what can run concurrently, and how cancellation and resources are handled.

Distinguish sequential syntax from actual scheduling behavior. Do not claim thread safety or race freedom without evidence.

## Database operation

Explain query construction, parameters, transaction boundary, execution, result mapping, and error handling. Mention pagination or locking when present.

Do not claim that indexes, pooling, prepared statements, isolation levels, or query optimization exist unless code, configuration, schema, or an execution plan establishes them.

## State machine or lifecycle

Name the states, transition triggers, guards, side effects, and terminal states. Note invalid transitions and recovery paths when implemented. A state diagram is helpful when prose would require repeatedly restating transitions.

## Component or subsystem

Use:

- overview;
- key concepts;
- trigger-to-result flow;
- component and ownership map;
- external boundaries;
- important files;
- gotchas and unresolved gaps.

Focus on the requested flow instead of inventorying every type.

## Diagrams

Use diagrams for relationships that are harder to hold in prose:

- sequence diagrams for interactions over time;
- flowcharts for decisions and transformations;
- state diagrams for lifecycle transitions;
- compact ASCII maps for simple containment or dependency relationships.

A diagram should add information or reduce cognitive load. Skip it when prose already makes the relationship clear. Reference real component and symbol names, and avoid decorative nodes.
