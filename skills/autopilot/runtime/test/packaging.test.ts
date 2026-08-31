import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isRecord } from "../src/json.js";
import { runProcess } from "../src/process.js";
import { verifyWindowsJobHelper } from "../src/windows-job.js";

const checkedWindowsHelper = join(process.cwd(), "native", "bin", "win32-x64", "job-helper.exe");

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

test("package contains exactly one verified win32-x64 Job Object helper", {
  skip: !existsSync(checkedWindowsHelper),
}, async () => {
  const sourceManifest = join(process.cwd(), "native", "bin", "win32-x64", "job-helper.json");
  const packagedExecutable = join(process.cwd(), "dist", "native", "win32-x64", "job-helper.exe");
  const packagedManifest = join(process.cwd(), "dist", "native", "win32-x64", "job-helper.json");
  const [source, packaged] = await Promise.all([readFile(checkedWindowsHelper), readFile(packagedExecutable)]);
  assert.equal(createHash("sha256").update(source).digest("hex"), createHash("sha256").update(packaged).digest("hex"));
  assert.deepEqual(await verifyWindowsJobHelper({ executable: packagedExecutable, manifest: packagedManifest }, "win32", "x64"), {
    available: true,
    sha256: createHash("sha256").update(source).digest("hex"),
  });
  assert.ok((await readFile(sourceManifest, "utf8")).includes(createHash("sha256").update(source).digest("hex")));

  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli);
  const packed = await runProcess({
    executable: process.execPath,
    arguments: [npmCli, "pack", "--dry-run", "--json"],
    cwd: process.cwd(),
    timeoutMs: 60_000,
  });
  assert.equal(packed.exitCode, 0);
  const inventory = JSON.parse(packed.stdout) as Array<{ readonly files: readonly { readonly path: string }[] }>;
  const helperFiles = inventory[0]?.files.filter(({ path }) => path.startsWith("dist/native/win32-x64/")) ?? [];
  assert.deepEqual(helperFiles.map(({ path }) => path).sort(), [
    "dist/native/win32-x64/job-helper.exe",
    "dist/native/win32-x64/job-helper.json",
  ]);
});
