# Exploration playbook

Use this playbook for multi-file features, subsystem architecture, cross-component behavior, or unclear entry points.

## 1. Define the question and boundary

Identify the behavior or mental model the user needs. Record the likely entry point, relevant subsystem boundary, and stopping point. Do not map the entire repository when one execution path answers the question.

Useful boundaries include:

- request to response;
- event to side effect;
- command to persisted state;
- public API to internal implementation;
- configuration input to runtime behavior;
- producer to consumer across a process boundary.

## 2. Find the entry point

Locate what triggers the behavior: a public method, route, UI action, command, scheduled task, event handler, startup hook, or framework callback. Confirm it from call sites or registration code rather than guessing from a file name.

If several entry points share the same core path, name them and trace the shared path once.

## 3. Trace control and data flow

Follow the implementation far enough to explain every meaningful transition:

1. caller or trigger;
2. input shape and validation actually present;
3. transformations and decisions;
4. state reads and writes;
5. calls across module, service, process, or network boundaries;
6. returned value, emitted event, persisted result, or visible side effect;
7. errors, cancellation, retries, and cleanup actually implemented.

Record the concrete symbol and file for each step. Do not stop at an interface when the implementation determines behavior. Do not descend into mature library internals unless library behavior is central to the question.

## 4. Map key components

Include only components needed to understand the flow. For each, record:

- name and location;
- responsibility;
- state it owns;
- inputs and outputs;
- important dependencies;
- boundary with neighboring components.

Do not assign historical purpose from current structure. Describe observable responsibility.

## 5. Verify contracts and edge cases

Use tests, callers, configuration, and documentation to clarify intended inputs and outputs. Treat tests as evidence only for the behavior they execute. Note contradictions among implementation, tests, and documentation.

Inspect edge cases only when they affect the requested path. Avoid converting explanation into an exhaustive audit.

## 6. Scale exploration

For a complex subsystem, split work into independent slices when parallel exploration is available and useful. Good slices include:

- entry point and request flow;
- data model and persistence;
- configuration and state ownership;
- external boundaries and asynchronous effects.

Give every slice the same target and a distinct boundary. Reconcile overlap against the code. A single direct pass is better when the question is narrow.

## 7. Capture findings

Keep an evidence map while exploring:

- components found;
- flow steps;
- files and symbols inspected;
- subsystem boundaries;
- non-obvious behavior;
- contradictions;
- unresolved questions.

An unresolved connection should remain unresolved. Say what was inspected and what evidence was missing.

## Stop conditions

Stop when you can explain the requested path from trigger to result without hand-waving, the remaining details are outside the requested boundary, or further exploration would only repeat established behavior.
