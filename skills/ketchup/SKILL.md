---
name: ketchup
description: Catch the user up on changes in the current chat and every decision or action still waiting on them. Manual invocation only; use when the user explicitly invokes ketchup or requests this catch-up workflow. Read-only; distinguish verified state from reports and unknowns.
disable-model-invocation: true
license: See LICENSE
---

# Ketchup

Catch the user up on what changed since their last message before this invocation. Assume they remember that message and nothing after it. Then explain every outstanding call they own well enough to decide from this reply alone.

Run only after an explicit request. Notifications, tool output, and agent reports are not user messages. If the baseline or earlier context is missing, state that limit rather than claiming a complete account.

## Gather evidence without changing state

Keep this turn read-only. Use the current conversation, work already performed, available agent reports, and existing artifacts. Do not change files, start apps or jobs, launch agents, post messages, or take an action on the user's behalf.

Check the current state of PRs, checks, or agents this chat touched when authorized read-only access is available. Otherwise label the information as last reported or unknown. Do not search unrelated projects or old conversations, obtain new access, or imply a status check ran when it did not. Recheck numbers against their evidence and explicitly identify any correction to a previously reported number. Do not expose secrets or sensitive personal data.

Include outstanding user-owned calls even when they were raised before the catch-up baseline. A call is a decision or action only the user can take: a product choice, approval, missing access, or an irreversible step awaiting permission. Work the assistant can still do is not a user action item. Do not invent optional work to fill the list.

For every item, collect:

- its recognizable name and existing link or identifier, when needed to act;
- what it changes for the user;
- the evidence and recommendation;
- its risk, prerequisites, and any irreversible consequence;
- any decision-critical unknown.

## Write the catch-up

Use plain words and short sentences, like one person catching up another. Say what changed for the user, not how the agent worked. Prefer “the tests pass” to “CI is green.” Keep paths, commands, hashes, and counts only when needed to understand or act. Use names the user recognizes.

1. Open with one short sentence naming what waits on the user, or saying nothing does. If nothing changed and nothing waits, say so and stop.
2. Show existing screenshots or videos inline when supported and useful. Add a small diagram only when a relationship or before-and-after is clearer as a picture.
3. Summarize each requested outcome briefly: what changed and whether it is finished, running, failed, or not checked. Include relevant bugs found and fixed. Do not call something finished while it awaits the user, or repeat details covered by the action items.
4. Name any remaining work the assistant can do in one short line.
5. List every outstanding user-owned call with a recommendation and the evidence needed to decide.

Keep the progress story short and spend words on the decisions. Never replace a list of items with a count, hide details behind links, or drop items to meet a word limit.

## Make the decisions self-contained

For one item, give the call, your pick, user impact, evidence, and risk together.

When several items share a call, state the call and recommendation once, then list each item separately, highest risk first. Give each item's name or link, impact, evidence, and risk, even when risk is low. Note a different recommendation where it applies. Mention the cost of waiting only when it is more than delay, such as a missed deadline or lost data.

For a choice between options, include every option actually weighed, what each gains and costs, and its known current state. Do not manufacture alternatives. Put prerequisites and irreversible consequences before the recommendation's action. Say “unknown” when missing evidence matters; do not turn a partial report into a confident approval.

## Visuals without extra work

Use existing captured screenshots and videos; never fabricate a screen or claim a capture exists. For a visible change without a capture, say “No screenshot yet” and describe what changed. Link only artifacts that exist.

A small supported Mermaid or text diagram may explain connections, dependencies, or options using known facts. Keep labels plain and the diagram readable at a glance. Do not draw a status list, decorate action items, repeat the same facts across text and pictures, or require a renderer, image generator, or another skill. If the host cannot display a useful visual, explain the relationship briefly in words.
