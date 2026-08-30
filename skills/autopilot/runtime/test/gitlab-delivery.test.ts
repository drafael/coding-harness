import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { GitLabDeliveryAdapter } from "../delivery/gitlab/index.js";

async function fakeGitLabCli(): Promise<{ readonly bin: string; readonly marker: string }> {
  const bin = await mkdtemp(join(tmpdir(), "autopilot-fake-glab-"));
  const marker = join(bin, "merge-called");
  const script = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "mr" && args[1] === "view") {
  console.log(JSON.stringify({iid: 9, web_url: "https://example.invalid/mr/9", state: "opened", diff_refs: {head_sha: process.env.FAKE_HEAD}, target_branch: "main", approved: true}));
} else if (args[0] === "mr" && args[1] === "merge") {
  writeFileSync(process.env.FAKE_MARKER, args.join(" "));
} else if (args[0] === "repo" && args[1] === "view") {
  console.log(JSON.stringify({id: 42, path_with_namespace: "owner/project"}));
} else if (args[0] === "api" && args.includes("PUT")) {
  const id = args[1].split("/").at(-1);
  console.log(JSON.stringify({id, notes: [{resolvable: true, resolved: true}]}));
} else if (args[0] === "api" && args[1].endsWith("/statuses")) {
  console.log(JSON.stringify([
    {id: 1, name: "build", status: "failed", target_url: "https://example.invalid/jobs/1"},
    {id: 3, name: "lint", status: "running", target_url: "https://example.invalid/jobs/3"},
    {id: 2, name: "build", status: "success", target_url: "https://example.invalid/jobs/2"}
  ]));
} else if (args[0] === "api" && args[1].endsWith("/discussions")) {
  console.log(JSON.stringify([{id: "discussion-1", notes: [{
    id: 13, author: {username: "reviewer"}, body: "Handle null", created_at: "2026-08-23T00:00:00Z",
    resolvable: true, resolved: false, system: false, position: {position_type: "text", new_path: "src/a.ts", new_line: 12}
  }]}]));
} else if (args[0] === "--version") {
  console.log("glab fake");
} else {
  console.log("[]");
}
`;
  await writeFile(join(bin, "glab"), script);
  await chmod(join(bin, "glab"), 0o755);
  return { bin, marker };
}

test("GitLab delivery observes and resolves exact review discussions", async () => {
  const fake = await fakeGitLabCli();
  const priorPath = process.env.PATH;
  process.env.PATH = `${fake.bin}${delimiter}${priorPath ?? ""}`;
  try {
    const adapter = new GitLabDeliveryAdapter();
    const reference = { provider: "gitlab" as const, id: "9", url: "https://example.invalid/mr/9" };

    const threads = await adapter.observeReviewThreads(fake.bin, reference);
    const resolved = await adapter.resolveReviewThreads(fake.bin, reference, ["discussion-1"]);

    assert.equal(threads[0]?.comments[0]?.body, "Handle null");
    assert.equal(threads[0]?.path, "src/a.ts");
    assert.deepEqual(resolved, ["discussion-1"]);
  } finally {
    process.env.PATH = priorPath;
  }
});

test("GitLab delivery selects the latest status for duplicate check names", async () => {
  const fake = await fakeGitLabCli();
  const priorPath = process.env.PATH;
  process.env.PATH = `${fake.bin}${delimiter}${priorPath ?? ""}`;
  try {
    const checks = await new GitLabDeliveryAdapter().observeChecks(fake.bin, "expected-head");

    assert.deepEqual(checks, [{
      name: "build",
      status: "passed",
      subjectCommit: "expected-head",
      detailsUrl: "https://example.invalid/jobs/2",
    }, {
      name: "lint",
      status: "pending",
      subjectCommit: "expected-head",
      detailsUrl: "https://example.invalid/jobs/3",
    }]);
  } finally {
    process.env.PATH = priorPath;
  }
});

test("GitLab delivery refuses merge when the observed head changed", async () => {
  const fake = await fakeGitLabCli();
  const priorPath = process.env.PATH;
  process.env.PATH = `${fake.bin}${delimiter}${priorPath ?? ""}`;
  process.env.FAKE_HEAD = "changed";
  process.env.FAKE_MARKER = fake.marker;
  try {
    const adapter = new GitLabDeliveryAdapter();

    await assert.rejects(adapter.merge({
      repositoryRoot: fake.bin,
      ref: { provider: "gitlab", id: "9", url: "https://example.invalid/mr/9" },
      expectedHeadCommit: "expected",
      method: "merge",
    }), /head changed/);
    await assert.rejects(readFile(fake.marker), /ENOENT/);
  } finally {
    process.env.PATH = priorPath;
    delete process.env.FAKE_HEAD;
    delete process.env.FAKE_MARKER;
  }
});
