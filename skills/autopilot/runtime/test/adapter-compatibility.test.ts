import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdapter } from "../src/adapters.js";

test("all documented harness adapter names resolve through one port factory", () => {
  for (const name of ["pi", "claude-code", "claude-agent-sdk", "codex", "codex-app-server", "opencode", "opencode-server"]) {
    const adapter = createAdapter(name);

    assert.equal(typeof adapter.describe, "function");
    assert.equal(typeof adapter.launch, "function");
    assert.equal(typeof adapter.observe, "function");
  }
  assert.throws(() => createAdapter("unknown"), /unknown harness adapter/);
});
