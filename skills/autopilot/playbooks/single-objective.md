# Single-objective playbook

Use `mode: "single"` for one inseparable outcome with one branch and worktree.

## Charter rules

- Define exactly one work item.
- Give the item one or more falsifiable acceptance predicates.
- Resolve one branch name before sealing.
- Grant `worker` file and process effects only for the item scope.
- Grant `runtime` `git.commit` when the requested delivery is `local-commits`.
- Add remote and delivery grants only when the user explicitly requests a change request or merge.

## Execution

The runtime creates the worktree from the sealed base commit, dispatches a fresh harness session, rejects worker-created commits, inspects changed paths, runs gates, applies the sealed pre-commit policy, and commits only an accepted tree. A failed attempt may retry within the sealed limit. Exhausted attempts produce a durable stop.

Approved review feedback for a successful open change request is another single objective with an explicit `amends` reference. The runtime adopts the exact clean predecessor worktree and updates the same branch only by fast-forward; see [recovery](../references/recovery.md).

## Example intent

```text
I am going to sleep. Work overnight on migrating this Java backend from
Spring Boot 3.x to 4.0.0. Done means ./mvnw verify, integration tests, and
application-context smoke tests pass; no Boot 3.x artifacts remain; and the
migration guide is updated. Open a PR, but do not merge or deploy it.
```

Represent the Maven build and smoke tests as command gates, the absence of Spring Boot 3.x artifacts as dependency-tree evidence, and the migration guide as a path predicate.
