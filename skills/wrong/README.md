# Wrong skill

Resets the active approach when the user rejects the assistant’s answer, plan, implementation, or problem-solving direction.

## Example requests

- "Your approach is wrong. Start over."
- "The implementation you suggested still fails. Re-investigate it."
- "Discard the previous answer and try again from the evidence."
- "That explanation does not match the code."

## Boundaries

- Use `wrong` when the assistant’s work or active solution path is rejected.
- Use `clarify` when the system, configuration, or documentation behaves incorrectly and needs explanation.
- Use `brainstorm` when the user wants several new designs or alternatives.
- Use `reflect` after the task when the correction may contain a durable lesson for future skills.

A rejection does not automatically require multiple proposals, formal planning, implementation, or comprehensive tests. The response should be proportional to the failed claim and the user’s request.

## Origin

- Original upstream skill: `plugins/workflow/skills/wrong/SKILL.md`
- Upstream repository: [umputun/cc-thingz](https://github.com/umputun/cc-thingz)

## Credits

- Original author: **Umputun**
- Local adaptation: `coding-harness`

## License

- Upstream license (MIT): [umputun/cc-thingz/LICENSE](https://github.com/umputun/cc-thingz/blob/master/LICENSE)
