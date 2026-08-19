# Historical rationale investigation

Use this playbook for design rationale, rejected alternatives, unexplained thresholds, regressions, postmortems, defensive code, and questions about why code still exists.

Read [evidence-and-confidence.md](evidence-and-confidence.md) when the record is indirect, conflicting, or consequential.

## 1. Define the target

Identify:

- the exact question about motivation or intent;
- relevant files, line ranges, symbols, constants, and behavior;
- the alternative the question implies;
- the time period in which the decision likely appeared.

If the target remains ambiguous and a wrong guess would cause a broad search, ask one focused question.

## 2. Establish a code anchor

Start with the current code so historical searches have stable terms. Record relevant paths, symbols, literals, comments, tests, and recent changes. Find the change that introduced or materially altered the behavior when history is available.

Code establishes what shipped. Comments and tests may also contain direct rationale. Code shape by itself does not prove intent.

## 3. Choose investigation depth

Scale effort to impact, ambiguity, and user intent.

### Quick

Use for low-impact questions with a likely local answer. Inspect nearby comments, tests, documentation, and recent history.

### Focused

Use when the answer is not local. Trace the introducing change, review or change request, linked ticket, and nearby design records.

### Broad

Use for consequential or disputed decisions. Search every relevant and available evidence category, record empty results, and compare chronology across sources.

### Forensic

Use for incidents, postmortems, compliance-sensitive decisions, major regressions, or architectural changes. Run independent searches in parallel when the host supports it, then synthesize findings with explicit confidence levels. Use read-only or least-privilege access where available.

Do not default to broad or forensic work when a direct source already answers a low-impact question.

## 4. Search relevant evidence

Choose sources because they can answer the question, not merely because they exist.

1. **Source control:** introducing and modifying changes, review discussions, comments, tests, release notes, and linked identifiers. Best for implementation-time rationale.
2. **Issues and tickets:** product requirements, customer requests, compliance needs, scope changes, and acceptance criteria.
3. **Long-form documents:** design records, proposals, specifications, meeting notes, and postmortems. Best for alternatives and explicit trade-offs.
4. **Team communication:** contemporaneous decisions and incident discussion that never reached durable documentation.
5. **Operational evidence:** metrics, dashboards, logs, and incident timelines that may explain retries, limits, timeouts, or defensive behavior.
6. **Error tracking:** exceptions, stack traces, affected versions, and release correlations behind corrective code.
7. **Product or data evidence:** experiments, usage distributions, feature exposure, scale, and thresholds derived from observed data.

Search with multiple anchors: symbols, exact literals, feature names, change identifiers, error text, authors, and relevant dates. Follow links between sources rather than repeating the same keyword everywhere.

Unavailable sources are gaps. Irrelevant sources may be skipped with a concrete reason. An empty search result is not proof that no record existed.

## 5. Evaluate chronology and reliability

Prefer evidence created near the decision, but do not assume the newest source is authoritative. Requirements may change after implementation.

Check whether:

- a source predates or postdates the shipped change;
- a proposal reflects the final decision;
- a ticket and implementation diverged;
- a later comment rationalizes an older choice;
- a copied pattern originated elsewhere;
- an operational signal actually preceded the change.

Surface disagreement instead of selecting the tidiest explanation.

## 6. Synthesize

For a small investigation, answer directly with adjacent citations. For a larger one, use:

- **Question and code anchor**
- **Direct evidence**
- **Supported or inferred explanation**
- **Competing hypotheses**, when needed
- **Unknowns and contradictions**
- **Sources consulted**, including relevant empty searches and unavailable sources

If the investigation precedes a change, end with concise constraints:

- **Preserve:** behavior or constraints still supported by evidence.
- **Change:** assumptions or requirements that no longer hold.
- **Avoid:** rejected approaches whose failure remains relevant.
- **Risk:** gaps that require testing, monitoring, or human confirmation.

## Stop conditions

Stop when the question has a direct, credible answer proportional to its impact; additional sources are repeating the same evidence; the remaining gap requires unavailable records or a human owner; or further investigation costs more than the decision warrants.

Never manufacture a satisfying history when the record ends.
