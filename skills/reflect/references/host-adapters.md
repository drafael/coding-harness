# Host adapters

The core workflow is capability-based. Use the safest available method to give reviewers the current session without searching unrelated transcripts.

## Generic capability order

1. **Current-context fork or branch:** preferred only after confirming that inherited context contains no material requiring redaction and that the reviewer stays within the established provider and privacy boundary.
2. **Scoped parent digest:** the parent redacts sensitive material, summarizes only evidence relevant to reflection, and includes specific anchors or safe short quotes.
3. **Current-transcript API or path:** use when the host exposes one directly.
4. **Raw session storage:** last resort. Restrict processing to the active branch and redact sensitive material.

If none is available, the parent can reflect from its current context without subagents.

Reviewers should be read-only or least-privilege where the host supports capability restriction. Reviewer prompts must include the lens, evidence boundary, no-project-write rule, no-external-action rule, and expected finding format. Verify that reviewer execution does not introduce an unapproved provider boundary; use a redacted digest or parent-only review when that cannot be established. Do not hardcode model or provider identifiers.

## Pi adapter

Invoke the manual skill with `/skill:reflect`. Pi honors `disable-model-invocation: true`, so the skill is not advertised for automatic model activation.

### Preferred: forked context

Pi subagents can inherit the active persisted conversation through forked context. This preserves Pi’s active branch and compaction semantics and avoids transcript-file discovery, but fork filtering can omit earlier parent orchestration calls and results. When prior subagent work is material, attach a scoped, redacted digest of its relevant results to every lane.

Before delegation, load the local `pi-subagents` guidance and list available executable agents. Confirm the selected reviewer stays within the approved provider boundary and that inherited context is safe to share; otherwise use a redacted digest or parent-only review. Use one parent-owned workflow with three distinct review-only lanes. Set `mission: false`, `artifacts: false`, and disable child output files where supported so reflection does not create optional project artifacts. Each lane receives one lens from `review-lenses.md`; the parent synthesizes their outputs. Do not allow reviewers to modify project or skill files or launch nested subagents.

Forking requires a persisted parent session and current leaf. If those preconditions are absent, use a fresh reviewer with a scoped digest or reflect in the parent.

Use asynchronous orchestration when appropriate. Reflection must still stop for user approval before any skill edit.

### Digest fallback

Create a digest from the current conversational context. Preserve:

- user corrections and explicit preferences;
- important decisions and alternatives;
- failed and successful workflow transitions;
- relevant tool or validation evidence;
- skills actually loaded or clearly missed;
- unresolved gaps.

Remove secrets, raw credentials, unrelated source content, and verbose tool output. Mark summarized or reconstructed evidence as secondary. A digest is evidence input, not a conclusion; reviewers must still apply their lens independently, and synthesis must not persist a lesson supported only by summary text.

### Session-file fallback

Commands launched through Pi’s callable shell may receive `PI_SESSION_FILE` for the current persistent session. Prefer this exact path over any directory search.

Pi session files are JSONL trees, not necessarily one linear conversation. They may contain alternate branches, compaction entries, branch summaries, custom entries, and tool results. Do not analyze every line as though it belonged to the active branch.

When programmatic access is available, use Pi’s session manager to open the file and build the active context entries. This honors parent links and compaction, but a compaction summary remains secondary evidence rather than an original turn. If active-branch reconstruction cannot be established reliably, abandon raw parsing and use a scoped digest.

Never glob `~/.pi/agent/sessions/` or inspect another working directory’s sessions. Do not persist copied transcript data under the skill directory.

### Pi reviewer orchestration

For a substantial reflection:

- judgment lane: durable corrections, decisions, and preferences;
- tooling lane: commands, validation boundaries, and structural mechanisms;
- blind-spot lane: skipped checks, second-order effects, and overfitting risks.

Launch all lanes from one parent orchestration call when parallel review is useful. Keep lane tasks distinct. The parent reconciles results using `synthesis-rubric.md` and re-reads target skills before presenting proposals.

A separate synthesis child is optional and should be used only when reviewer output is too large or conflicting for reliable parent synthesis. It receives reviewer findings, not unrestricted transcript access unless necessary.

## Hosts without subagents

Apply the three lenses serially in the parent. Keep notes separated by lens before synthesis to reduce anchoring. The same evidence, approval, and validation rules apply.

## Hosts that ignore manual-invocation metadata

Some hosts may ignore `disable-model-invocation`. The skill description and body therefore repeat the explicit-request-only rule. Do not infer permission to reflect from task length, errors, or corrections.
