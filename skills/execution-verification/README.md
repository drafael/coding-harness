# Execution-verification skill

Discovers available execution capabilities and runs scoped checks to verify claims that code inspection or existing tests cannot establish. Instead of stopping at “unverified,” it looks for a safe way to obtain evidence—locally first, or through explicitly approved endpoints, CI/CD, and cloud environments.

## When to use

Use during planning, implementation, or review for questions such as:

- Will this migration preserve existing data on the target database engine?
- Does the proposed transaction change prevent the reproduced concurrency failure?
- Does a running API behave as its OpenAPI/Swagger contract describes?
- Does an integration work in the approved test environment?

Ordinary unit tests do not need a new environment. This is not a workstation-setup, deployment, load-testing, or security-scanning skill.

## Usage

Load `execution-verification` through your agent's supported skill mechanism, then state the claim and any execution constraints. Include the relevant revision/artifact, target environment, and expected result when known. Do not paste credentials into the request.

Example requests:

- “Use execution-verification to check this migration against an isolated instance of the project's database engine. Discover available local tools first; do not change my existing database.”
- “Reproduce the concurrent-update failure and check the proposed fix with controlled transactions in both arrival orders.”
- “Inspect the provided OpenAPI specification and propose requests that would verify this claim. Do not invoke endpoints yet.”
- “On the staging API I approved, verify the named lookup operation using the supplied synthetic record. Only the approved read operations are allowed.”
- “Run the approved CI test workflow for this revision and inspect its test results. Do not deploy or push changes.”
- “Find what is missing for local verification. Give me installation instructions for my OS and explain which checks the tool will enable; do not install it.”

If the request leaves a consequential target or permission unclear, the agent asks before proceeding. Existing approval can cover a defined sequence of operations; it need not be repeated for every step.

## Behavior

The skill:

1. Defines an observable result that would support or refute the claim.
2. Detects the execution host's OS, architecture, shell/interface, and relevant tools through available metadata or read-only checks.
3. Checks actual capability, not just installation: compatible versions, reachable services, correct targets, and permitted access.
4. Chooses the smallest suitable isolated environment and executes the relevant checks against actual artifacts where practical.
5. Removes owned disposable resources and reports results, blockers, and remaining limits.

If a required tool is missing, it recommends a suitable option, provides OS/shell-appropriate installation steps, and explains how the tool will test the claim. It distinguishes verified instructions from unverified suggestions and does not install or upgrade tools without permission.

For API checks, it can inspect OpenAPI/Swagger documents, select relevant operations, construct requests and assertions, and invoke approved endpoints. Reading a specification is not evidence that the implementation works; a successful HTTP status alone is not proof of the business claim.

## Permissions and safety

Local discovery and isolated, task-owned checks stay within the authorized task. Tool installation, shared-service changes, served API discovery/invocation, and CI/CD or cloud activity require approval covering the target, actions, data, and relevant cost/resource limits.

Reading documentation does not authorize its operations; test approval does not authorize deployment or production changes. The skill protects credentials, uses synthetic or approved sanitized data, and cleans up only owned resources. Failed cleanup and retained resources are reported.

## Expected output

Expect the tested claim and revision/artifact, actual environment and settings, executed checks and results, sanitized evidence, cleanup outcome, and remaining limits.

Local results do not prove production behavior, and remote tests establish only the artifacts they actually exercised. A concrete blocker is a valid outcome; unsupported success claims are not.

## Portability and structure

No particular OS, shell, agent host, programming language, container runtime, database, CI platform, or cloud provider is required. Containers are optional. The skill adapts to available command, API, SDK, or host interfaces; it does not itself supply those capabilities.

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | Core workflow, activation, scope, and portability rules |
| [Discovery and installation](references/discovery-and-installation.md) | OS/tool detection and claim-specific installation guidance |
| [Database verification](references/databases.md) | Migration, upgrade, transaction, and concurrency checks |
| [Endpoint verification](references/endpoints.md) | OpenAPI/Swagger discovery and approved API invocation |
| [Remote verification](references/remote-verification.md) | CI/CD and cloud approval, execution, cost, and cleanup |

References are loaded only when relevant. Language skills and `write-tests`, when available, govern test implementation; otherwise repository conventions apply. No companion skill or delegation is required.
