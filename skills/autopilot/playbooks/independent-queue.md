# Independent-queue playbook

Use `mode: "independent-queue"` when items have no code or delivery dependency on one another.

## Charter rules

- Give every item a unique ID, branch, writable scope, and acceptance predicates.
- Leave `dependsOn` empty unless the work is not truly independent.
- Set `maxParallel` to the user-approved bound. The runtime lowers concurrency when an adapter supports less.
- Do not let two items share a branch or worktree writer lease.
- Decide whether partial success is acceptable in the original objective. The first release preserves successful siblings and stops blocked items independently.

## Execution

The runtime computes the ready frontier, creates exclusive worktrees, and may dispatch several fresh sessions. Journal appends remain serialized. A failed item does not erase or invalidate a satisfied sibling. Remote delivery remains item-specific and requires actor-specific grants.

## Example intent

```text
I am going to sleep. Work overnight on upgrading five independent Java services
from Spring Boot 3.x to 4.0.0. Use one branch per service, run each service's
Maven verify and startup smoke tests, open one PR per passing service, and do not deploy.
```

If the items touch the same ownership boundary or one changes the assumptions of another, use an ordered stack or a single objective instead.
