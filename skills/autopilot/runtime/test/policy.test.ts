import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeEffect, type AdapterCapabilities } from "../src/policy.js";

const capabilities: AdapterCapabilities = {
  families: ["files.write", "network.access", "credentials.use"],
  assurance: "cooperative",
  maxConcurrency: 1,
  unattended: true,
  cancellation: true,
  restartReattachment: false,
};

test("authorizeEffect requires playbook request, matching actor grant, and adapter support", () => {
  const grants = [{ family: "network.access" as const, actor: "adapter" as const }];

  assert.equal(
    authorizeEffect({ family: "network.access", actor: "adapter" }, new Set(["network.access"]), grants, capabilities),
    grants[0],
  );
  assert.throws(
    () => authorizeEffect({ family: "network.access", actor: "worker" }, new Set(["network.access"]), grants, capabilities),
    /lacks a matching/,
  );
  assert.throws(
    () => authorizeEffect({ family: "network.access", actor: "adapter" }, new Set(), grants, capabilities),
    /did not request/,
  );
  assert.throws(
    () => authorizeEffect({ family: "git.commit", actor: "runtime" }, new Set(["git.commit"]), [], capabilities),
    /does not support/,
  );
});

test("authorizeEffect enforces credential environment constraints", () => {
  const grants = [{
    family: "credentials.use" as const,
    actor: "runtime" as const,
    environmentNames: ["ALLOWED_TOKEN"],
  }];

  assert.equal(authorizeEffect(
    { family: "credentials.use", actor: "runtime", environmentName: "ALLOWED_TOKEN" },
    new Set(["credentials.use"]),
    grants,
    capabilities,
  ), grants[0]);
  assert.throws(() => authorizeEffect(
    { family: "credentials.use", actor: "runtime", environmentName: "OTHER_TOKEN" },
    new Set(["credentials.use"]),
    grants,
    capabilities,
  ), /lacks a matching/);
});

test("authorizeEffect enforces path and branch constraints", () => {
  const grants = [{
    family: "files.write" as const,
    actor: "worker" as const,
    paths: ["/tmp/allowed"],
    branchPrefixes: ["autopilot/"],
  }];

  assert.doesNotThrow(() => authorizeEffect(
    { family: "files.write", actor: "worker", path: "/tmp/allowed/file", branch: "autopilot/run/item" },
    new Set(["files.write"]),
    grants,
    capabilities,
  ));
  assert.throws(() => authorizeEffect(
    { family: "files.write", actor: "worker", path: "/tmp/outside" },
    new Set(["files.write"]),
    grants,
    capabilities,
  ), /lacks a matching/);
});
