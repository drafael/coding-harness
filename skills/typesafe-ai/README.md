# TypeSafe AI skill

Designs and implements TypeSafe System One workflows using the current official documentation. This local copy also includes a small command-line helper for direct API experiments.

## Requirements

- Node.js 20 or newer for the helper
- A TypeSafe API key exported as `TYPESAFE_API_KEY`
- Network access to `https://api.typesafe.ai`

Do not commit the API key or include it in request files.

## Direct evaluation

Create a request containing `state` and one or more questions:

```json
{
  "state": "My card was charged twice.",
  "questions": {
    "refund_requested": {
      "type": "noul",
      "instructions": "Does this message request a refund?"
    }
  }
}
```

Run it from the skill directory:

```bash
node scripts/evaluate.mjs request.json
```

The helper also accepts stdin:

```bash
node scripts/evaluate.mjs < request.json
```

It uses `jev-latest` when the request does not specify a model. Responses are written as formatted JSON to stdout; diagnostics are written to stderr. Requests time out after 10 seconds, matching the official JavaScript SDK default. HTTP error bodies are omitted because they may echo submitted state.

The helper performs one request without retries. Production integrations should use the current TypeSafe SDK or implement the retry behavior documented by TypeSafe.

Sending a request transmits its state and questions to TypeSafe. Review the content and obtain the required authorization before using repository, private, or user data.

## Tests

Run the zero-dependency subprocess test suite with Node.js 20 or newer:

```bash
node --test scripts/evaluate.test.mjs
```

The tests replace `fetch` in child processes and do not contact the live TypeSafe API.

## Installation

This directory follows the [Agent Skills specification](https://agentskills.io/specification). Copy or symlink it into the skill directory used by the target coding agent:

- Claude Code: `.claude/skills/typesafe-ai` or `~/.claude/skills/typesafe-ai`
- Pi, Codex, OpenCode, or Copilot: `.agents/skills/typesafe-ai` or `~/.agents/skills/typesafe-ai`

## Upstream and updates

- Official skill: <https://github.com/typesafe-ai/skills/tree/main/skills/typesafe-ai>
- Documentation index: <https://docs.typesafe.ai/llms.txt>
- API reference: <https://docs.typesafe.ai/api>

To update, compare `SKILL.md` with the official version and retain the local “Run a direct evaluation” section. Review API changes before modifying the helper.

## License

The official skill is distributed under the MIT License. See [`LICENSE`](LICENSE).
