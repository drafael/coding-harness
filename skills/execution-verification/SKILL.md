---
name: execution-verification
description: Discover suitable execution environments and obtain evidence for infrastructure-dependent behavior during planning, implementation, or review. Use before declaring material migration, transaction, concurrency, service-integration, or runtime assumptions unverified. Prefer isolated local verification; support explicitly user-approved CI/CD and cloud tests. Own resource cleanup and report evidence, blockers, and remaining limits. Complements existing test suites; not a general workstation-setup or deployment skill.
---

# Execution Verification

Before settling for “unverified,” check whether available infrastructure can safely provide meaningful evidence. Prefer the smallest environment that exercises the actual boundary—not necessarily the most production-like environment.

## Activation and ownership

Use during planning as well as implementation and review when a consequential claim needs runtime evidence that code inspection or existing tests do not provide. Examples include applying a database migration, reproducing a transaction race, or checking an integration against a real service.

Do not provision infrastructure for ordinary unit tests or concerns outside the requested task. A verification experiment can inform a plan without authorizing production-code changes. This skill does not authorize delegation.

Language skills and `write-tests`, when available, govern code and test design. Otherwise follow repository test conventions; no companion skill is required. This skill owns environment discovery, execution feasibility, isolation, resource lifecycle, and the limits of the resulting evidence.

## Portability

No operating system, shell, agent host, programming language, container runtime, database engine, CI system, or cloud provider is required. Use capabilities exposed by the current host: command execution, APIs, SDKs, or other supported interfaces. Derive concrete operations from repository configuration and the installed tool's or service's documented behavior; do not assume command names, paths, versions, or authentication mechanisms.

Isolation is a requirement, not a particular technology. Containers are one option, not a prerequisite. If the current host cannot discover or execute a suitable environment, identify that limitation and request the missing capability or provide a clearly unexecuted verification procedure. Never imply an operation ran when the interface was unavailable.

## Load references when relevant

- [Database verification](references/databases.md): migrations, transactions, locks, concurrency, and upgrade behavior.
- [CI/CD and cloud verification](references/remote-verification.md): approval scope, remote execution, cost, data handling, and cleanup.

## Workflow

### 1. Define the claim

State the observable result that would support or refute the claim. Identify the real dependency and important conditions: version, configuration, isolation level, schema, permissions, or transaction boundaries. Keep the experiment tied to a demonstrated risk or explicit requirement.

Separate what a disposable environment can establish from properties requiring a deployed system, representative data, or load.

### 2. Discover before declaring a blocker

Inspect relevant repository instructions, runtime pins, test harnesses, build wrappers, migration configuration, and CI definitions. Then check available local tools and services.

Discover capabilities relevant to the claim: isolated processes, temporary service instances, containers, virtual machines, or existing test environments. Establish target location and ownership before connecting, then check reachability and required artifacts within the authorized scope. An installed client alone is not execution capability, and a local-looking target name does not establish that execution is local or private.

Select the target explicitly for each operation rather than changing global defaults. Inspect only configuration needed for the task; do not dump credentials, complete environments, or unrelated infrastructure inventories. Reuse repository harnesses when they exercise the required boundary.

### 3. Choose the execution scope

Within the authorized task, use available local capabilities and create isolated, task-owned environments without asking redundant setup questions. Prefer disposable resources over changing a developer's existing database or service.

Ask before installing or upgrading tools, starting or changing shared services, or taking network/cost actions outside existing authorization. If local verification is inadequate, propose a specific CI/CD or cloud check and obtain explicit approval under the remote reference. Possession of credentials is not permission.

If the boundary cannot be exercised safely or proportionately, report the concrete capability checked, blocker encountered, and remaining uncertainty. Do not invent a passing substitute or repeatedly retry an unchanged failure.

### 4. Prepare and execute an isolated check

- Use uniquely identified resources and record ownership before creating them. Arrange cleanup for success, failure, timeout, and cancellation.
- Use synthetic or approved sanitized data. Do not copy production data by default.
- Limit privileges, filesystem access, and network exposure to what the experiment requires. Keep task-owned data separate from shared data and avoid exposing test services beyond the required clients.
- Execute actual changed artifacts where practical. If using a prototype or reduced fixture, state what differs and rerun the relevant check against the final implementation before claiming it is verified.
- Bound readiness waits and execution according to the experiment. Check execution status and assertions; a ready environment or completed job is not proof of correctness.
- Preserve diagnostic evidence before teardown. Never broaden cleanup to unrelated resources, perform bulk cleanup of shared environments, or stop an existing service to tidy up an experiment.

### 5. Verify cleanup and report

Confirm that owned disposable resources were removed. If cleanup fails, identify the exact remaining resources and required action; do not claim success or delete resources of uncertain ownership.

Report concisely:

- the claim tested and source revision or working-tree state;
- actual runtime/version and configuration relevant to the result;
- operations or harness and assertions/results, with sanitized evidence location when retained;
- cleanup outcome;
- untested boundaries and concrete blockers.

Keep reusable checks in the project's established test infrastructure when appropriate and within scope. Do not automatically commit exploratory harnesses or put machine-specific experiment details into an ADR. Preserve an honest “unverified” result when evidence remains insufficient—after checking feasible verification paths, not instead of checking them.
