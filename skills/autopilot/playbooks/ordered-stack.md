# Ordered-stack playbook

Use `mode: "ordered-stack"` for a linear sequence in which each accepted item is the base of the next.

## Charter rules

- List items in stack order.
- Give the root no dependencies. Every later item must depend on exactly its immediate predecessor.
- Resolve every branch before sealing. Branch collisions stop launch.
- Use one topology owner. Workers never reparent, rebase, merge, or mutate refs.
- For `change-request-ready`, target each descendant change request at its predecessor branch.
- For `merge-verified`, land only the contiguous verified prefix from the root.

## Execution

The runtime exposes only the root frontier initially. After the root is verified and committed, its commit becomes the base of the next worktree. Rewritten code identities invalidate affected receipts.

A successful `change-request-ready` stack may be followed by an explicitly sealed restack successor after a non-leaf amendment. The successor snapshots the exact descendant authority and identities, creates conflict-free two-parent merge-forward candidates, reruns every sealed gate and exact-tree review, and advances local and remote branches only by compare-safe ordinary fast-forward updates. It never inherits authority implicitly, requests provider mutation authority, rebases, resets, cherry-picks, or force-pushes. Provider access is observation-only. Conflicts or identity drift block with retained evidence; already satisfied descendants remain confirmed, and the runtime does not advertise an invalid partial-suffix continuation.

## Example intent

```text
I am going to sleep. Work overnight on the Spring Boot 4 migration as an ordered
stack: upgrade the parent build and BOM, migrate shared security and configuration,
then update service modules. Verify and push each branch, but do not merge or deploy.
```

A failed predecessor blocks and abandons pending descendants without deleting their durable run state.
