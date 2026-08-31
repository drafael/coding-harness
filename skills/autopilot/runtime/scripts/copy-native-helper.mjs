#!/usr/bin/env node
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const source = join("native", "bin", "win32-x64");
const destinations = [join("dist", "native", "win32-x64")];
const executable = join(source, "job-helper.exe");
const manifest = join(source, "job-helper.json");

try {
  await Promise.all([readFile(executable), readFile(manifest)]);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    process.exit(0);
  }
  throw error;
}

try {
  await access(".test-dist");
  destinations.push(join(".test-dist", "native", "win32-x64"));
} catch {
  // Test output is optional during a production build.
}

await Promise.all(destinations.map(async (destination) => {
  await mkdir(destination, { recursive: true });
  return await Promise.all([
    copyFile(executable, join(destination, "job-helper.exe")),
    copyFile(manifest, join(destination, "job-helper.json")),
  ]);
}));
