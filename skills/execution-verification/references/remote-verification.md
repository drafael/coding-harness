# CI/CD and Cloud Verification

Use remote execution when the required boundary cannot be established locally or the user explicitly requests a remote check. Prefer an existing isolated test workflow or sandbox over creating new infrastructure. These rules apply to hosted or self-managed CI systems, remote execution services, and cloud environments. Use the available supported interface; no particular provider, CLI, SDK, workflow format, or credential mechanism is required.

For application API discovery and invocation, also use [endpoint verification](endpoints.md). A CI/cloud approval covers those requests only when their targets and operations are included in its scope.

## Approval before remote activity

Before inspecting or operating a remote verification environment, establish explicit user approval for the intended scope. Read relevant local configuration first where that can identify the target without remote access. Existing explicit authorization may cover the work; do not ask repeatedly when it already covers the exact scope.

Make the approval request concrete:

- **Target:** provider, account/project, region, repository, workflow, and environment as applicable.
- **Actions:** read status/logs, trigger tests, provision resources, apply migrations to a named test database, or perform other specific mutations.
- **Boundaries:** permitted data, resource sizes/counts, cost and duration expectations, and any limits needed for the proposed operation.
- **Lifecycle:** ownership, teardown or retention, and what happens on failure or cancellation.

Only request details relevant to the operation. A read-only CI status check does not require a provisioning budget. Conversely, an available integration, stored credential, or authenticated session does not authorize a test run or mutation.

Test approval is not deployment approval. It does not implicitly permit production access, releases, configuration changes, database resets, pushes, or new infrastructure beyond the agreed test scope. If the proposed workflow includes such actions, disclose them and obtain specific approval or choose another workflow.

## Before execution

- Confirm the exact target and authenticated identity without exposing credentials. Do not rely on an ambiguous default account, endpoint, execution context, workspace, or region.
- Inspect the workflow/configuration to understand downstream jobs, scripts, reusable workflows, deployment steps, and teardown behavior. Stop for clarification when material side effects cannot be established.
- Bind the check to the intended revision or artifact. Remote tests of a committed revision do not verify uncommitted local changes. Do not silently push changes to make them available remotely.
- Use synthetic or approved sanitized fixtures. Logs, artifacts, and source uploads must stay within the authorized data/privacy boundary.
- Set operation-appropriate cancellation, cost, and cleanup controls. A timeout on the local client may not stop the remote job or release its resources.

## Execute and observe

Use explicit target selection and record the run/resource identifiers and source revision. A queued job, successful trigger response, or provisioned resource is not a passed test. Observe terminal status and inspect the relevant assertions, test reports, and failures.

Do not retry non-idempotent operations blindly. Before retrying provisioning or a failed trigger, determine whether the first request created resources or started work. If the job would exceed approved scope, stop or cancel the owned work as appropriate and ask before expanding it.

Cloud tests should exercise the named claim, not become an unsolicited load test, security scan, or environment redesign. For managed-service-specific behavior, identify which configuration differs from the local experiment and what the remote test adds.

## Cleanup and evidence

Clean up exact task-owned resources, including volumes, temporary storage, and other billable dependencies created for the check. Preserve resources only when retention is approved; report their identifiers, owner, expected lifetime, and continuing cost where applicable. Never delete shared resources merely because their names resemble a test prefix.

If cleanup fails, report the failure and remaining resources immediately. Do not hide cleanup debt behind a passing test result.

Return the environment, tested revision/artifact, run ID, relevant results, cleanup status, and residual limits. Keep links and artifacts within the authorized access boundary. CI success establishes only the jobs and assertions that actually ran, not all deployment or production behavior.
