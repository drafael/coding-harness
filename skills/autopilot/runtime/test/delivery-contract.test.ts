import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeliveryAdapter } from "../src/delivery-adapters.js";
import { changeRequestTitle, reviewThreadDigest, type ReviewThread } from "../src/delivery.js";

test("provider-neutral delivery factory keeps provider behavior outside the core", () => {
  const github = createDeliveryAdapter("github");
  const gitlab = createDeliveryAdapter("gitlab");

  assert.equal(typeof github.createChangeRequest, "function");
  assert.equal(typeof gitlab.createChangeRequest, "function");
  assert.equal(typeof github.observeReviewThreads, "function");
  assert.equal(typeof gitlab.resolveReviewThreads, "function");
  assert.throws(() => createDeliveryAdapter("unknown"), /unknown delivery provider/);
});

test("review feedback identity ignores provider state changed by the verified fix", () => {
  const thread: ReviewThread = {
    id: "thread-1",
    resolved: false,
    outdated: false,
    resolvable: true,
    path: "src/a.ts",
    line: 12,
    comments: [{ id: "comment-1", author: "reviewer", body: "Handle null", url: "https://example.invalid/comment", createdAt: "2026-08-23T00:00:00Z" }],
  };

  const { line: _line, ...withoutLine } = thread;
  assert.equal(reviewThreadDigest(thread), reviewThreadDigest({ ...withoutLine, resolved: true, outdated: true }));
});

test("change request title uses the charter summary instead of the full objective", () => {
  const title = changeRequestTitle({
    title: "Add Speechify as a text-to-speech provider",
    objective: "Implement Speechify as a first-class Text to Speech provider using every existing contract; verify the API and update all documentation.",
  });

  assert.equal(title, "Add Speechify as a text-to-speech provider");
});

test("change request title provides a bounded fallback for older charters", () => {
  const title = changeRequestTitle({
    objective: "Implement Speechify as a first-class Text to Speech provider using every existing credential, catalog, playback, and error-handling contract; verify everything.",
  });

  assert.equal(title, "Implement Speechify as a first-class Text to Speech provider using…");
  assert.ok(title.length <= 72);
});
