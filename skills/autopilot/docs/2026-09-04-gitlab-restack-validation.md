# GitLab sealed-restack live validation

- **Date:** 2026-09-04
- **Runtime commit:** `ed2d974cc09ad74eb3d9651a286fdfdb7fad2106`
- **Provider CLI:** `glab` 1.116.0
- **Target:** authorized private reusable project `drafael/autopilot-amendment-validation`
- **Result:** PASS

## Purpose

This validation exercised the sealed restack successor against a real GitLab project. It checked that the runtime can advance an existing descendant branch and confirm the exact merge-request head without force-pushing or asking the provider to mutate the change request.

No repository was created for this validation. The existing archived validation project was temporarily unarchived under explicit authority and rearchived after cleanup.

## Scenario

The validation created a conflict-free two-item stack:

1. A parent branch and merge request targeted `main`.
2. A child branch and merge request targeted the parent branch.
3. The parent branch received a new amendment commit.
4. Sealed successful source and amendment journals supplied the exact predecessor evidence.
5. A restack successor advanced only the child descendant.

The source and amendment journals were controlled lifecycle fixtures. The restack successor itself ran through `AutopilotEngine` and the production GitLab delivery adapter from the recorded runtime commit.

## Exact identities

| Subject | Identity |
|---|---|
| Unchanged `main` | `7dfbc05d8a21d2c8cdce791f542e1f8eb9fbdf21` |
| Original parent | `9cc37e5ad5e450ca52ca2447c331f36e46b9fc60` |
| Original child | `efbf9d455157c7dfee26075d374a08744c7b6ff1` |
| Amended parent | `63db6dad9ffe340c72f22d9a288228f10254142b` |
| Restacked child | `1fdecb41939002ce5371fdb11ef3bfc23c28d25f` |
| Restacked tree | `bea05f53bd0fa397ff051b3428b3960ab02a9d4a` |

The restacked child had the exact ordered parents:

1. original child `efbf9d455157c7dfee26075d374a08744c7b6ff1`;
2. amended parent `63db6dad9ffe340c72f22d9a288228f10254142b`.

Provider evidence remains visible in the closed validation merge requests:

- [parent MR !3](https://gitlab.com/drafael/autopilot-amendment-validation/-/merge_requests/3)
- [child MR !4](https://gitlab.com/drafael/autopilot-amendment-validation/-/merge_requests/4)

## Verified behavior

The final evidence report confirmed all of the following:

- the successor run reached `SUCCEEDED` and the descendant reached `SATISFIED`;
- the merge-forward candidate had the exact original-child and amended-parent parents;
- the retained child worktree stayed clean;
- the local child ref advanced to the exact candidate;
- the remote child ref advanced to the same candidate by an ordinary fast-forward push;
- GitLab MR !4 still targeted the exact parent branch and reported the exact candidate head;
- the runtime recorded `RESTACK_PROVIDER_HEAD_CONFIRMED` for MR !4;
- fresh gate and predicate receipts were bound to the candidate tree;
- no ordinary `ITEM_*` or `ATTEMPT_*` worker lifecycle was used for the restacked descendant;
- `main` remained unchanged before and after cleanup.

The validation closed MRs !3 and !4, deleted both temporary remote branches, confirmed that no matching refs remained, and restored the project to its archived state.

An initial preflight using the project's SSH URL failed before any mutation because no usable SSH key was available. The successful run used the host's existing authenticated HTTPS Git transport; it did not change global Git or SSH configuration.

## Limits

This evidence covers one conflict-free GitLab descendant and the normal mutation/reconciliation path. It does not replace controlled coverage for multi-descendant stacks, conflicts, crashes around each mutation boundary, identity drift, pause/stop, or Windows execution. It also does not establish live GitHub restack behavior. The full source and amendment workflows were represented by sealed controlled fixtures rather than rerun through worker execution.
