import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  const packageManifest: unknown = JSON.parse(await readFile(join(copyRoot, "package.json"), "utf8"));
  assert.ok(isRecord(packageManifest) && isRecord(packageManifest.pi));
  assert.deepEqual(packageManifest.pi.extensions, ["./dist/src/pi-extension-entry.js"]);
  assert.equal(existsSync(join(copyRoot, "dist", "src", "pi-extension-entry.js")), true);
  const checks: unknown = JSON.parse(doctor.stdout);
  assert.ok(Array.isArray(checks));
  const node = checks.find((entry) => isRecord(entry) && entry.name === "node");
  const processSupervision = checks.find((entry) => isRecord(entry) && entry.name === "process-supervision");
  assert.ok(isRecord(node));
  assert.ok(isRecord(processSupervision));
  assert.equal(node.status, "ok");
  assert.equal(processSupervision.status, process.platform === "win32" ? "unsupported" : "ok");
});

test("source, build output, and package contain no project-owned native binaries", async () => {
  const tracked = await runProcess({
    executable: "git",
    arguments: ["ls-files", "--", "."],
    cwd: process.cwd(),
  });
  assert.equal(tracked.exitCode, 0);
  assert.deepEqual(tracked.stdout.split("\n").filter((path) =>
    existsSync(join(process.cwd(), path)) && (path.startsWith("native/") || /\.(?:exe|node)$/iu.test(path))
  ), []);
  assert.equal(existsSync(join(process.cwd(), "dist", "native")), false);

  const npmArguments = ["pack", "--dry-run", "--json"];
  const npmCli = process.env.npm_execpath ?? (process.platform === "win32"
    ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : undefined);
  if (process.platform === "win32") {
    assert.ok(npmCli !== undefined && existsSync(npmCli), "setup-node npm CLI entry point is unavailable");
  }
  const packed = await runProcess({
    executable: npmCli === undefined ? "npm" : process.execPath,
    arguments: npmCli === undefined ? npmArguments : [npmCli, ...npmArguments],
    cwd: process.cwd(),
    timeoutMs: 60_000,
  });
  assert.equal(packed.exitCode, 0);
  const inventory = JSON.parse(packed.stdout) as Array<{ readonly files: readonly { readonly path: string }[] }>;
  const nativeFiles = inventory[0]?.files.filter(({ path }) =>
    path.startsWith("dist/native/") || /\.(?:exe|node)$/iu.test(path)
  ) ?? [];
  assert.deepEqual(nativeFiles, []);
});
