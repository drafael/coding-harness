#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src", "adapters", "delivery", "test", "scripts", "schemas"];
const checkedExtensions = new Set([".ts", ".mjs", ".json"]);
const errors = [];

async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await visit(child);
    } else if (checkedExtensions.has(extname(entry.name))) {
      const text = await readFile(child, "utf8");
      if (!text.endsWith("\n")) {
        errors.push(`${child}: missing final newline`);
      }
      text.split("\n").forEach((line, index) => {
        if (/[ \t]+$/.test(line)) {
          errors.push(`${child}:${index + 1}: trailing whitespace`);
        }
        if (line.includes("\t")) {
          errors.push(`${child}:${index + 1}: tab character`);
        }
      });
    }
  }
}

for (const root of roots) {
  await visit(root);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
