# AWS CDK v2 with TypeScript

Apply this reference to CDK v2 applications and construct libraries. Current official CDK v2 documentation overrides historical repository examples and v1 guidance.

## Deterministic Synthesis

- Synthesis must be deterministic and free of cloud mutations.
- Do not make arbitrary AWS SDK/network calls during normal synth.
- Use supported CDK context providers for lookups. For unsupported external data, refresh a checked-in input through a separate explicit operation.
- Commit `cdk.json` and `cdk.context.json`. Treat context and feature flags as application state.
- Refresh cached provider context with CDK context commands, review the diff, and commit it. Do not manually edit provider-cache entries.
- Never store secrets in context, templates, outputs, source, asset build arguments, or plain/unprotected pipeline variables. Prefer workload identity or a managed secret store; when protected CI secret variables are the established delivery mechanism, scope and mask them carefully.

## Application Structure

- Use `App` as the composition root, `Stage` for repeatable environment topology, `Stack` as a deployment boundary, and `Construct` for reusable logical units.
- Start simple. Split stacks for lifecycle, ownership, deployment cadence, quotas, blast radius, or state protection—not arbitrary layering.
- Consider separating stateful and stateless resources when their lifecycle/protection differs.
- Configure constructs through typed props. Restrict process environment reads to the entry/composition boundary, validate once, and pass values down.
- Prefer object/interface references such as `IBucket` over physical names and ARN strings.

A construct normally accepts `(scope, id, props)`, gives props sensible defaults, exposes useful resources as readonly interface-typed properties, and keeps stable child IDs where state or public construct compatibility matters.

## L1, L2, and L3

- Prefer L2 constructs and L3 patterns for intent-based APIs and safe integrations.
- Use L1 `Cfn*` constructs or escape hatches only when higher-level APIs lack a required capability.
- Test escape-hatch behavior because it carries more CloudFormation detail and upgrade burden.
- For published construct libraries, follow jsii-compatible API constraints, semantic versioning, readonly props, stable child paths, and peer-dependency guidance.

## Environments, Stacks, and Stages

- Represent production stages/environments explicitly in code.
- Use explicit production account and Region mappings. `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` are convenient for personal development, not a stable production synthesis policy.
- Use a `Stage` to instantiate repeatable stack topology across accounts/Regions/environments.
- Use dependencies only when deployment order/data flow requires them. Independent stacks can deploy in parallel.
- Prefer separate accounts/environments for meaningful isolation where the organization supports it.
- Avoid CloudFormation parameters/conditions for ordinary environment configuration; prefer synthesis-time typed configuration. Parameters remain valid when one synthesized artifact truly needs deployment-time input.

## Tokens

Treat unresolved token values as opaque deployment-time expressions:

- Pass them through supported construct properties.
- Do not parse, compare, slice, take length, perform arithmetic, or branch at synthesis time on unresolved values.
- Use `Token.isUnresolved` before concrete-only validation.
- Use CloudFormation intrinsics for token lists and `Stack.toJsonString` for token-bearing JSON.
- Do not log or persist token encodings as if they were physical values.

## Names, Logical IDs, and State

- Let CDK/CloudFormation generate physical names unless an external contract requires stability.
- Construct IDs and hierarchy contribute to logical IDs; renaming or moving a construct can replace resources.
- Treat paths for databases, buckets, queues, keys, networks, and other stateful resources as persistence contracts.
- Choose removal policies, retention, backup, and log-retention behavior explicitly for important state.
- Enable termination protection for important stateful and bootstrap stacks where appropriate.
- Avoid routine `overrideLogicalId`. Use documented refactoring mechanisms only after understanding restrictions.
- Run an accurate `cdk diff`/change-set review before hierarchy, naming, or stateful changes.

## Secrets and IAM

- Store secrets in Secrets Manager or SSM SecureString and reference them at deployment/runtime. Prefer generated secrets where appropriate.
- Do not fetch secret plaintext during synth and avoid `SecretValue.unsafePlainText`.
- Grant runtime identities access to secrets rather than embedding secret values.
- Prefer resource `grant*` APIs over hand-written broad `PolicyStatement` objects.
- When raw policies are necessary, enumerate actions, resources, and conditions and assert against unintended wildcards.
- Distinguish workload permissions from deployment permissions.
- Restrict who can assume bootstrap roles. Review the CloudFormation execution role, permission boundaries, SCPs, and non-bypassable controls; modern bootstrap defaults can be highly privileged.
- Review synthesized IAM even when using grants.

## Validation and Aspects

- Use built-in validation and trusted stable `Validations`/`IPolicyValidationPlugin` APIs. Do not add deprecated `Beta1` APIs in new code when stable equivalents exist.
- Treat validation plugins and third-party constructs as executable code with full synthesis-host access.
- Use Aspects for deliberate cross-cutting checks/mutations such as tags and policy checks. An Aspect above a `Stage` does not automatically traverse into the stage; attach at the correct scope.
- Keep cdk-nag/Guard/plugin suppressions narrow and include a reason.
- Synthesis validation is bypassable. Production compliance also needs controls developers/deployment roles cannot disable, such as SCPs, CloudFormation Hooks, Config, or organizational policy.

## Assets and Lambda Bundling

- Use service convenience asset APIs where possible.
- Keep asset roots minimal with `.gitignore`, `.dockerignore`, and CDK exclusions; assets enter the cloud assembly and bootstrap storage.
- Make bundling reproducible and ensure CI has Docker/toolchain parity where required.
- For TypeScript Lambda, `NodejsFunction` is a common official path. Keep the lockfile and entry within the configured dependency root.
- Bundle dependencies according to the actual Lambda runtime contract; do not assume globally available modules.
- Do not pass secrets in Docker build args, hooks, command lines, layers, or caches.
- Prefer default content/output hashing. Incorrect custom hashes can suppress real deployments.

## Testing

Use `aws-cdk-lib/assertions` for fine-grained behavior:

- Resource counts and security-sensitive properties.
- IAM/resource policies, encryption, public-access blocks, network exposure, logs, alarms, retention, and removal policies.
- Wiring with partial matching and `Capture`.
- Expected annotations/warnings/errors.
- Stable logical IDs for important stateful resources and refactors.

Use snapshots sparingly; dependency/context upgrades can legitimately rewrite templates, and snapshots alone do not prove security or correctness. Add deployable integration and post-deployment smoke tests for critical constructs/workloads where the cost is justified.

## Versions and Dependencies

- Use the project-local CDK CLI through a script/package runner for reproducibility.
- Keep CLI compatibility with the cloud-assembly schema produced by `aws-cdk-lib`; an old CLI may not understand newer assemblies.
- Pin alpha construct modules exactly; do not use broad caret/tilde ranges for alpha APIs.
- For published constructs, use compatible peer dependencies for `aws-cdk-lib` and `constructs` and test advertised compatibility.
- Expect upgrades to change synthesized templates even when APIs remain source-compatible; review synth and diff output.

## Deployment Workflow

Recommended production path:

1. Frozen dependency install, compile, lint, and tests.
2. Deterministic `cdk synth` with checked-in context.
3. Policy/security validation.
4. `cdk diff`, using change-set-backed accuracy where replacement details matter.
5. Deploy to an ephemeral/development environment and run integration/smoke tests.
6. Promote the reviewed commit through isolated stages/accounts with approvals for production replacements or permission broadening.
7. Monitor deployment, workload health, and drift; recover through CloudFormation/pipeline rather than silent out-of-band mutation.

Never use `--hotswap`, `cdk watch`, `--no-rollback`, or direct service mutation as a production deployment strategy. Hotswap deliberately creates CloudFormation drift and can use caller credentials outside normal bootstrap-role behavior.

## Sources

- [AWS CDK best practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [AWS CDK security best practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices-security.html)
- [Constructs](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html)
- [Environments](https://docs.aws.amazon.com/cdk/v2/guide/configure-env.html)
- [Context](https://docs.aws.amazon.com/cdk/v2/guide/context.html)
- [Tokens](https://docs.aws.amazon.com/cdk/v2/guide/tokens.html)
- [Testing](https://docs.aws.amazon.com/cdk/v2/guide/testing.html)
- [Policy validation](https://docs.aws.amazon.com/cdk/v2/guide/policy-validation-synthesis.html)
- [Identifiers](https://docs.aws.amazon.com/cdk/v2/guide/identifiers.html)
- [Assets](https://docs.aws.amazon.com/cdk/v2/guide/assets.html)
- [Versioning](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html)
- [Deploy command](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-deploy.html)
