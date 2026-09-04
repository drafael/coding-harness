# Sealed restack-successor design package

- **Status:** Implemented for sealed controlled-fixture execution; live provider mutation remains unclaimed pending renewed disposable-target authority
- **Scope:** Successful `change-request-ready` ordered stacks after a non-leaf item is fast-forward amended
- **Non-goals:** Rebase, reset, cherry-pick replacement, force-push, implicit authority inheritance, worker remediation, or provider base retargeting

## Problem

An amendment successor is currently a `single` run containing only the amended item. Its charter does not contain affected descendants, their writable roots, gates, acceptance predicates, remote heads, or change-request identities. The reducer consequently cannot own descendant lifecycle or receipt events.

A merge-forward Git helper alone would be unsafe. It could move a descendant without sealed authority, could reuse evidence bound to the old tree, and could not durably reconcile crashes across commit creation, local compare-and-swap, ordinary push, and provider confirmation.

## Required invariant

A restack successor may advance a descendant only when all of the following are sealed before execution:

1. predecessor run, charter, stack, and amended-item identities;
2. the contiguous affected descendants in original topology order;
3. exact old local and remote commits and exact amended predecessor commit;
4. canonical retained worktree, branch, remote, and change-request identities;
5. each descendant's writable roots, acceptance predicates, and applicable command, search, and review gates;
6. the existing grants required for read, verification, runtime commit, ordinary push, and provider observation;
7. limits and commit-hook policy used while re-verifying;
8. a prohibition on every authority or topology widening.

Notifications, provider output, worker output, and predecessor artifacts remain untrusted inputs. The successor reobserves every sealed identity before mutation.

## Minimal sealed charter extension

Add one optional, versioned field to amendment successors:

```ts
interface RestackSuccessor {
  readonly schemaVersion: 1;
  readonly predecessorRunId: string;
  readonly predecessorCharterHash: string;
  readonly amendedItemId: string;
  readonly amendedCommit: string;
  readonly descendants: readonly RestackDescendant[];
}

interface RestackDescendant {
  readonly itemId: string;
  readonly oldCommit: string;
  readonly oldTreeIdentity: string;
  readonly remote: string;
  readonly remoteCommit: string;
  readonly changeRequest: {
    readonly provider: "github" | "gitlab";
    readonly id: string;
    readonly url: string;
    readonly baseBranch: string;
  };
  readonly worktreePath: string;
  readonly gateIds: readonly string[];
}
```

The successor's top-level `work` entries are definition-only copies that seal each descendant's branch, dependency order, writable roots, and acceptance predicates; they never enter ordinary item or attempt lifecycle. Existing top-level `gates`, `grants`, `limits`, and `commitPolicy` remain authoritative. `gateIds` may reference only gates sealed in that successor. The successor does not load gate definitions or grants from the predecessor at execution time.

### Seal-time validation

Sealing must load the predecessor's immutable charter and successful journal projection and prove:

- predecessor charter hash and repository identity match;
- predecessor mode is `ordered-stack` and delivery is `change-request-ready`;
- `amendedItemId` is a non-leaf item and matches `amends.itemId`;
- descendants are exactly the contiguous suffix after that item, without omission, insertion, or reordering;
- every snapshot field equals durable successful predecessor evidence;
- every copied predicate, writable root, and gate definition is byte-for-byte equal to its predecessor definition;
- successor grants are inside both the source and immediate amendment authority and match the explicit restack family/actor/scope allowlist;
- seal-time validation requires every grant that engine preflight will exercise: scoped runtime reads, scoped worker reads for review gates, and command/environment execution when applicable, adapter network and credentials, remote-delivery runtime/delivery network and credentials plus delivery-owned provider observation, runtime commit, and scoped ordinary push;
- worker write, `merge.execute`, `review-thread.resolve`, change-request open/update, and every family not needed by sealed verification or delivery are prohibited;
- applicable waivers are byte-for-byte copies of source waivers; only sealed non-review gates may become `WAIVED`, and only with a matching receipt, reason, failure evidence, and passing alternative-gate evidence;
- no force, rewrite, reset, merge-execution, deployment, credential, path, remote, or branch authority is added.

A changed or unavailable predecessor artifact prevents sealing. Runtime must never reconstruct omitted authority.

## Journal and reducer ownership

Restack descendants are not implementation work items and do not consume worker attempts. Add an explicit projection keyed by descendant item ID:

```ts
type RestackState =
  | "PENDING"
  | "PREPARING"
  | "VERIFYING"
  | "VERIFIED"
  | "COMMITTING"
  | "PUSHING"
  | "SATISFIED"
  | "BLOCKED";
```

Use source-named events:

```text
RESTACK_DESCENDANT_STARTED
RESTACK_DESCENDANT_TREE_PREPARED
RESTACK_DESCENDANT_VERIFIED
RESTACK_DESCENDANT_SATISFIED
RESTACK_DESCENDANT_BLOCKED
```

Existing `RECEIPT_RECORDED`, `EFFECT_INTENDED`, and `EFFECT_CONFIRMED` events may reference a descendant only when it exists in the sealed `restack.descendants` set. The reducer must reject:

- unknown descendant IDs;
- out-of-order descendants;
- verification against any tree other than the prepared tree;
- commit/ref/push intent before successful current-tree receipts;
- satisfaction before local ref, remote head, and provider head confirmations;
- events after `BLOCKED` or `SATISFIED`.

The amended item cannot become `ITEM_SATISFIED` until every sealed restack descendant is `SATISFIED`. Any descendant block leaves the successor nonterminal and preserves all worktrees and state.

## Execution protocol

Process descendants in sealed topology order under the existing repository/topology lock.

### 1. Reobserve

Before creating an object, confirm:

- no pause or stop request;
- canonical registered worktree is clean and on `branchName` at `oldCommit`;
- local branch and remote branch both equal `oldCommit`/`remoteCommit` as sealed;
- provider reference has exact provider, ID, URL, head, base, and open state;
- the freshly accepted parent equals `amendedCommit` for the first descendant or the preceding confirmed restack commit thereafter;
- current charter grants authorize every impending verification and mutation.

Any mismatch records `RESTACK_DESCENDANT_BLOCKED` without changing refs or files.

### 2. Prepare without mutating retained state

Run `git merge-tree --write-tree oldCommit freshParentCommit`. A conflict blocks unchanged. Create a runtime-owned candidate commit with:

```text
parent 1 = oldCommit
parent 2 = freshParentCommit
```

The commit message records successor run, descendant item, old commit, and fresh parent. Commit-object creation alone does not move a ref.

Create a temporary detached managed worktree at the candidate commit. Its deterministic Windows-safe sibling name uses a conservative 120-byte bound so Git's repository-internal worktree administration path also remains usable on Windows; canonical worktree names retain their 200-byte bound. It must be inside the runtime's managed sibling boundary, registered to the same repository, and removed on success or preserved with a diagnostic on uncertain cleanup. Never reset or clean the retained descendant worktree.

### 3. Reverify exact candidate tree

Run the successor-sealed descendant command/search gates and independent review in the temporary worktree. Reobserve HEAD, tree, refs, and Git configuration around every gate. Store new receipts bound to the candidate tree. Old predecessor-run receipts cannot satisfy the successor.

Acceptance predicates are evaluated from the successor snapshot. Any failure blocks before a ref or remote mutation.

### 4. Mutate with intent and comparison

After `RESTACK_DESCENDANT_VERIFIED`:

1. journal `EFFECT_INTENDED` for `restack.local-ref` with exact old and candidate commits;
2. reobserve retained worktree, local ref, remote ref, and provider identity;
3. compare-update the local ref from exact `oldCommit` to candidate commit;
4. confirm local ref and retained worktree HEAD;
5. journal and execute `restack.remote-push` only when remote still equals `remoteCommit`;
6. use an ordinary push of candidate commit to the branch; never pass a force option;
7. reobserve remote head and exact provider head/base/state;
8. record confirmations and `RESTACK_DESCENDANT_SATISFIED`.

The candidate is a descendant of `oldCommit`, so the ordinary push is fast-forward. A third observed value always blocks; it is never absorbed.

## Crash reconciliation

Every mutating step accepts only exact before/after states:

| Pending effect | Before state | Confirmed state | Any other state |
|---|---|---|---|
| candidate object | object absent | owned object with exact parents/tree/message | block |
| local ref | `oldCommit` | candidate commit | block |
| remote push | `remoteCommit` | candidate commit | block |
| provider head | old exact head | candidate exact head | block |

On restart, reobserve before retrying. Object creation is retryable by content identity. Local ref uses compare-and-swap. Ordinary push is retryable only while the remote remains exactly before or after. Provider observation never authorizes a Git mutation by itself.

## Error contract

Use stable errors rather than destructive fallback:

- `RESTACK_CONFLICT`: merge tree conflicts;
- `RESTACK_REWRITE_REQUIRED`: candidate cannot preserve old descendant ancestry;
- `BRANCH_COLLISION`: local/worktree/ref identity moved;
- `EFFECT_RECONCILIATION_FAILED`: remote/provider or journal effect is neither exact before nor after;
- `CAPABILITY_DENIED`: sealed grants, paths, commands, credentials, or provider authority are insufficient;
- `EXECUTION_STATE_UNKNOWN`: quiescence or crash state cannot be proven.

## Required implementation slices

This cannot be a local helper-only patch. The smallest coherent implementation touches these existing boundaries:

1. `charter.ts` and `schemas/charter.schema.json`: parse, seal, and validate explicit restack snapshots.
2. `events.ts`, `reducer.ts`, `projection.ts`, and reports: own descendant state and receipts.
3. `amendment.ts`: validate immutable predecessor evidence and expose the sealed plan without inheriting authority.
4. `repository.ts`: conflict-free merge-tree candidate creation, temporary detached worktree, CAS local update, and exact ordinary push.
5. `engine.ts`: ordered execution, exact verification/review, intent/confirmation, pause/stop, and restart reconciliation.
6. Focused charter, reducer, repository, amendment, engine, fault-injection, GitHub/GitLab, and Windows tests.
7. Ordered-stack, charter, recovery, and architecture documentation plus deterministic `dist` regeneration.

These are changes to one existing lifecycle owner, not a second service or authority system. They should be reviewed as one dedicated restack-successor deliverable because partial publication would create an unsafe executable contract.

## Acceptance evidence

Controlled fixtures must prove:

- two- and three-level successful stack snapshots seal deterministically;
- omission, reorder, authority widening, changed predecessor artifacts, and non-successful stacks fail sealing;
- candidate commit has exact old-descendant and fresh-parent parents;
- old descendant is an ancestor of candidate commit;
- conflicts and dirty/foreign worktrees leave refs and files unchanged;
- command, search, review, and predicate receipts are regenerated for the candidate tree;
- old receipts are rejected;
- pause/stop before each mutation leaves the next effect unapplied;
- crashes before and after object, local ref, push, and confirmation reconcile once;
- moved local, remote, or provider identity blocks;
- no executed Git argument contains force, rebase, reset, or cherry-pick;
- Ubuntu and Windows Node 24 CI pass at the exact PR head and merge commit.

Live provider mutation was validated on 2026-09-04 against an authorized private reusable GitLab project. The normal one-descendant path confirmed the exact merge-forward commit locally, remotely, and on the existing merge request; regenerated exact-tree receipts passed, `main` did not move, and temporary refs were removed. See [GitLab sealed-restack live validation](2026-09-04-gitlab-restack-validation.md). GitHub restack mutation remains unverified.

## Recorded implementation decisions

1. Merge-forward commits are accepted. The branch movement remains fast-forward even though Git history gains a second parent.
2. Temporary candidate worktrees are removed only when cleanup is provably safe; uncertain cleanup preserves them with diagnostics.
3. A blocked descendant preserves already-confirmed earlier fast-forwards and blocks the remaining suffix.
4. Live provider mutation requires renewed authority on an already-authorized target. The GitLab normal path now has live evidence; GitHub and live failure-path behavior remain unverified.

These decisions authorize the dedicated implementation deliverable without weakening its evidence gates.
