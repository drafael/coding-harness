import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isRecord } from "../src/json.js";
import { runProcess } from "../src/process.js";

test("compiled skill CLI starts from a clean copy without node_modules", async () => {
  const copyRoot = await mkdtemp(join(tmpdir(), "autopilot-clean-copy-"));
  await cp(join(process.cwd(), "dist"), join(copyRoot, "dist"), { recursive: true });
  await cp(join(process.cwd(), "package.json"), join(copyRoot, "package.json"));
  await cp(join(process.cwd(), "schemas"), join(copyRoot, "schemas"), { recursive: true });

  const cli = join(copyRoot, "dist", "src", "cli.js");
  const version = await runProcess({ executable: process.execPath, arguments: [cli, "--version"], cwd: copyRoot });
  const doctor = await runProcess({ executable: process.execPath, arguments: [cli, "--json", "doctor"], cwd: copyRoot, timeoutMs: 60_000 });

  assert.equal(version.exitCode, 0);
  assert.equal(version.stdout.trim(), "0.1.0");
  assert.equal(doctor.exitCode, 0);
  const checks: unknown = JSON.parse(doctor.stdout);
  assert.ok(Array.isArray(checks));
  const node = checks.find((entry) => isRecord(entry) && entry.name === "node");
  assert.ok(isRecord(node));
  assert.equal(node.status, "ok");
});
