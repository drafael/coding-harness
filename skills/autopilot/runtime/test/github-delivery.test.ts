import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { GitHubDeliveryAdapter } from "../delivery/github/index.js";

async function fakeGitHubCli(): Promise<{ readonly bin: string; readonly marker: string }> {
  const bin = await mkdtemp(join(tmpdir(), "autopilot-fake-gh-"));
  const marker = join(bin, "merge-called");
  const script = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({number: 7, url: "https://example.invalid/pr/7", state: "OPEN", headRefOid: process.env.FAKE_HEAD, baseRefName: "main", reviewDecision: "APPROVED"}));
} else if (args[0] === "pr" && args[1] === "merge") {
  writeFileSync(process.env.FAKE_MARKER, args.join(" "));
} else if (args[0] === "repo" && args[1] === "view") {
  console.log(JSON.stringify({nameWithOwner: "owner/project"}));
} else if (args[0] === "api" && args[1] === "graphql" && args.join(" ").includes("resolveReviewThread")) {
  const threadId = args.find((arg) => arg.startsWith("threadId="))?.slice("threadId=".length);
  console.log(JSON.stringify({data: {resolveReviewThread: {thread: {id: threadId, isResolved: true}}}}));
} else if (args[0] === "api" && args[1] === "graphql") {
  console.log(JSON.stringify({data: {repository: {pullRequest: {reviewThreads: {nodes: [{
    id: "thread-1", isResolved: false, isOutdated: false, path: "src/a.ts", line: 12,
    comments: {nodes: [{id: "comment-1", author: null, body: "Handle null", url: "https://example.invalid/pr/7#discussion", createdAt: "2026-08-23T00:00:00Z"}], pageInfo: {hasNextPage: false}}
  }], pageInfo: {hasNextPage: false, endCursor: null}}}}}}));
} else if (args[0] === "api" && args[1].endsWith("/reviews")) {
  console.log(JSON.stringify([{id:99,state:"PENDING",body:"draft",user:{login:"reviewer"},html_url:"https://example.invalid/draft",submitted_at:null,created_at:"2026-08-23T00:00:00Z"}]));
} else if (args[0] === "--version") {
  console.log("gh version fake");
} else {
  console.log("[]");
}
`;
  await writeFile(join(bin, "gh"), script);
  await chmod(join(bin, "gh"), 0o755);
  return { bin, marker };
}

test("GitHub delivery observes and resolves exact review threads", async () => {
  const fake = await fakeGitHubCli();
  const priorPath = process.env.PATH;
  process.env.PATH = `${fake.bin}${delimiter}${priorPath ?? ""}`;
  try {
    const adapter = new GitHubDeliveryAdapter();
    const reference = { provider: "github" as const, id: "7", url: "https://example.invalid/pr/7" };

    const threads = await adapter.observeReviewThreads(fake.bin, reference);
    const resolved = await adapter.resolveReviewThreads(fake.bin, reference, ["thread-1"]);

    assert.equal(threads[0]?.comments[0]?.body, "Handle null");
    assert.equal(threads[0]?.comments[0]?.author, "deleted-user");
    assert.equal(threads[0]?.resolvable, true);
    assert.deepEqual(resolved, ["thread-1"]);
  } finally {
    process.env.PATH = priorPath;
  }
});

test("GitHub delivery refuses merge when the observed head changed", async () => {
  const fake = await fakeGitHubCli();
  const priorPath = process.env.PATH;
  process.env.PATH = `${fake.bin}${delimiter}${priorPath ?? ""}`;
  process.env.FAKE_HEAD = "changed";
  process.env.FAKE_MARKER = fake.marker;
  try {
    const adapter = new GitHubDeliveryAdapter();

    await assert.rejects(adapter.merge({
      repositoryRoot: fake.bin,
      ref: { provider: "github", id: "7", url: "https://example.invalid/pr/7" },
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
