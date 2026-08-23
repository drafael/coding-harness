import { isAbsolute, resolve } from "node:path";
import { AutopilotError } from "./errors.js";
import {
  assertKnownKeys,
  canonicalJson,
  expectInteger,
  expectLiteral,
  expectRecord,
  expectString,
  expectStringArray,
  isRecord,
  sha256,
} from "./json.js";

export const GRANT_FAMILIES = [
  "files.read",
  "files.write",
  "process.execute",
  "network.access",
  "credentials.use",
  "git.commit",
  "remote.push",
  "change-request.open",
  "change-request.update",
  "review-thread.resolve",
  "merge.execute",
] as const;

export type GrantFamily = (typeof GRANT_FAMILIES)[number];
export type EffectActor = "worker" | "runtime" | "adapter" | "delivery";
export type RunMode = "single" | "independent-queue" | "ordered-stack";
export type DeliveryMode = "local-commits" | "change-request-ready" | "merge-verified";
export type AssuranceLevel = "cooperative" | "enforced";
export type ResolutionSource = "invocation" | "project" | "user" | "default" | "repository";

export interface CapabilityGrant {
  readonly family: GrantFamily;
  readonly actor: EffectActor;
  readonly paths?: readonly string[];
  readonly commands?: readonly string[];
  readonly repositories?: readonly string[];
  readonly remotes?: readonly string[];
  readonly branchPrefixes?: readonly string[];
  readonly environmentNames?: readonly string[];
}

export interface CommandGate {
  readonly id: string;
  readonly type: "command";
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly environmentNames: readonly string[];
  readonly appliesTo: readonly string[];
}

export interface SearchGate {
  readonly id: string;
  readonly type: "search";
  readonly query: string;
  readonly paths: readonly string[];
  readonly expectedCount: number;
  readonly appliesTo: readonly string[];
}

export type VerificationGate = CommandGate | SearchGate;

export type Predicate =
  | { readonly type: "gate-passed"; readonly gateId: string }
  | { readonly type: "path-present"; readonly path: string }
  | { readonly type: "path-absent"; readonly path: string }
  | { readonly type: "search-count"; readonly query: string; readonly paths: readonly string[]; readonly expectedCount: number };

export interface EvidenceWaiver {
  readonly gateId: string;
  readonly failurePattern: string;
  readonly alternativeGateIds: readonly string[];
  readonly reason: string;
}

export interface RunLimits {
  readonly maxAttemptsPerItem: number;
  readonly maxReplans: number;
  readonly maxParallel: number;
  readonly attemptTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxAdapterLineBytes: number;
  readonly maxRetainedOutputBytes: number;
}

export interface RecordedAssumption {
  readonly statement: string;
  readonly source: string;
}

export interface RepositorySpec {
  readonly root: string;
  readonly baseRef: string;
  readonly baseCommit: string;
  readonly writableRoots: readonly string[];
}

export interface DeliveryTarget {
  readonly provider: "github" | "gitlab";
  readonly remote: string;
  readonly baseBranch: string;
}

export interface AmendmentReference {
  readonly runId: string;
  readonly itemId: string;
}

export interface ReviewFeedbackThread {
  readonly threadId: string;
  readonly contentHash: string;
  readonly url: string;
  readonly resolve: boolean;
}

export interface ReviewFeedbackSnapshot {
  readonly observedHeadCommit: string;
  readonly threads: readonly ReviewFeedbackThread[];
}

export interface CommitPolicy {
  readonly preCommitHook: "run" | "skip";
  readonly writableRoots: readonly string[];
  readonly environmentNames: readonly string[];
}

export interface WorkItem {
  readonly id: string;
  readonly title?: string;
  readonly objective: string;
  readonly writableRoots: readonly string[];
  readonly dependsOn: readonly string[];
  readonly acceptance: readonly Predicate[];
  readonly branchName: string;
  readonly ticket?: string;
}

export interface ProposedRunCharter {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sourceText: string;
  readonly createdAt: string;
  readonly repository: RepositorySpec;
  readonly harnessAdapter: "pi" | "claude-code" | "codex" | "opencode";
  readonly mode: RunMode;
  readonly work: readonly WorkItem[];
  readonly delivery: DeliveryMode;
  readonly deliveryTarget?: DeliveryTarget;
  readonly grants: readonly CapabilityGrant[];
  readonly gates: readonly VerificationGate[];
  readonly waivers: readonly EvidenceWaiver[];
  readonly limits: RunLimits;
  readonly assumptions: readonly RecordedAssumption[];
  readonly minimumAssurance: AssuranceLevel;
  readonly resolutionSources: Readonly<Record<string, ResolutionSource>>;
  readonly predecessorRunId?: string;
  readonly amends?: AmendmentReference;
  readonly reviewFeedback?: ReviewFeedbackSnapshot;
  readonly commitPolicy?: CommitPolicy;
}

export interface RunCharter extends ProposedRunCharter {
  readonly charterHash: string;
}

const DEFAULT_LIMITS: RunLimits = {
  maxAttemptsPerItem: 3,
  maxReplans: 1,
  maxParallel: 1,
  attemptTimeoutMs: 1_800_000,
  idleTimeoutMs: 300_000,
  maxAdapterLineBytes: 1_048_576,
  maxRetainedOutputBytes: 4_194_304,
};

function parseGrant(value: unknown, path: string): CapabilityGrant {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["family", "actor", "paths", "commands", "repositories", "remotes", "branchPrefixes", "environmentNames"], path);
  const grant: CapabilityGrant = {
    family: expectLiteral(object.family, GRANT_FAMILIES, `${path}.family`),
    actor: expectLiteral(object.actor, ["worker", "runtime", "adapter", "delivery"], `${path}.actor`),
    ...(object.paths === undefined ? {} : { paths: expectStringArray(object.paths, `${path}.paths`) }),
    ...(object.commands === undefined ? {} : { commands: expectStringArray(object.commands, `${path}.commands`) }),
    ...(object.repositories === undefined ? {} : { repositories: expectStringArray(object.repositories, `${path}.repositories`) }),
    ...(object.remotes === undefined ? {} : { remotes: expectStringArray(object.remotes, `${path}.remotes`) }),
    ...(object.branchPrefixes === undefined ? {} : { branchPrefixes: expectStringArray(object.branchPrefixes, `${path}.branchPrefixes`) }),
    ...(object.environmentNames === undefined ? {} : { environmentNames: expectStringArray(object.environmentNames, `${path}.environmentNames`) }),
  };
  return grant;
}

function parsePredicate(value: unknown, path: string): Predicate {
  const object = expectRecord(value, path);
  const type = expectLiteral(object.type, ["gate-passed", "path-present", "path-absent", "search-count"], `${path}.type`);
  if (type === "gate-passed") {
    assertKnownKeys(object, ["type", "gateId"], path);
    return { type, gateId: expectString(object.gateId, `${path}.gateId`) };
  }
  if (type === "path-present" || type === "path-absent") {
    assertKnownKeys(object, ["type", "path"], path);
    return { type, path: expectString(object.path, `${path}.path`) };
  }
  assertKnownKeys(object, ["type", "query", "paths", "expectedCount"], path);
  return {
    type,
    query: expectString(object.query, `${path}.query`),
    paths: expectStringArray(object.paths, `${path}.paths`),
    expectedCount: expectInteger(object.expectedCount, `${path}.expectedCount`),
  };
}

function parseReviewFeedback(value: unknown, path: string): ReviewFeedbackSnapshot {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["observedHeadCommit", "threads"], path);
  if (!Array.isArray(object.threads) || object.threads.length === 0) {
    throw new AutopilotError("CHARTER_INVALID", `${path}.threads must be a non-empty array`);
  }
  const threads = object.threads.map((entry, index) => {
    const thread = expectRecord(entry, `${path}.threads[${index}]`);
    assertKnownKeys(thread, ["threadId", "contentHash", "url", "resolve"], `${path}.threads[${index}]`);
    if (typeof thread.resolve !== "boolean") {
      throw new AutopilotError("CHARTER_INVALID", `${path}.threads[${index}].resolve must be a boolean`);
    }
    return {
      threadId: expectString(thread.threadId, `${path}.threads[${index}].threadId`),
      contentHash: expectString(thread.contentHash, `${path}.threads[${index}].contentHash`),
      url: expectString(thread.url, `${path}.threads[${index}].url`),
      resolve: thread.resolve,
    };
  });
  if (new Set(threads.map(({ threadId }) => threadId)).size !== threads.length) {
    throw new AutopilotError("CHARTER_INVALID", `${path}.threads must have unique thread IDs`);
  }
  return { observedHeadCommit: expectString(object.observedHeadCommit, `${path}.observedHeadCommit`), threads };
}

function parseWorkItem(value: unknown, path: string): WorkItem {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["id", "title", "objective", "writableRoots", "dependsOn", "acceptance", "branchName", "ticket"], path);
  if (!Array.isArray(object.acceptance) || object.acceptance.length === 0) {
    throw new AutopilotError("CHARTER_INVALID", `${path}.acceptance must be a non-empty array`);
  }
  const title = object.title === undefined ? undefined : expectString(object.title, `${path}.title`);
  if (title !== undefined && (title.length > 72 || title !== title.trim() || /[\r\n]/u.test(title))) {
    throw new AutopilotError("CHARTER_INVALID", `${path}.title must be a trimmed single line of at most 72 characters`);
  }
  return {
    id: expectString(object.id, `${path}.id`),
    ...(title === undefined ? {} : { title }),
    objective: expectString(object.objective, `${path}.objective`),
    writableRoots: expectStringArray(object.writableRoots, `${path}.writableRoots`),
    dependsOn: expectStringArray(object.dependsOn, `${path}.dependsOn`),
    acceptance: object.acceptance.map((entry, index) => parsePredicate(entry, `${path}.acceptance[${index}]`)),
    branchName: expectString(object.branchName, `${path}.branchName`),
    ...(object.ticket === undefined ? {} : { ticket: expectString(object.ticket, `${path}.ticket`) }),
  };
}

function parseGate(value: unknown, path: string): VerificationGate {
  const object = expectRecord(value, path);
  const type = expectLiteral(object.type, ["command", "search"], `${path}.type`);
  if (type === "command") {
    assertKnownKeys(object, ["id", "type", "executable", "arguments", "workingDirectory", "environmentNames", "appliesTo"], path);
    return {
      id: expectString(object.id, `${path}.id`),
      type,
      executable: expectString(object.executable, `${path}.executable`),
      arguments: expectStringArray(object.arguments, `${path}.arguments`),
      workingDirectory: expectString(object.workingDirectory, `${path}.workingDirectory`),
      environmentNames: expectStringArray(object.environmentNames, `${path}.environmentNames`),
      appliesTo: expectStringArray(object.appliesTo, `${path}.appliesTo`),
    };
  }
  assertKnownKeys(object, ["id", "type", "query", "paths", "expectedCount", "appliesTo"], path);
  return {
    id: expectString(object.id, `${path}.id`),
    type,
    query: expectString(object.query, `${path}.query`),
    paths: expectStringArray(object.paths, `${path}.paths`),
    expectedCount: expectInteger(object.expectedCount, `${path}.expectedCount`),
    appliesTo: expectStringArray(object.appliesTo, `${path}.appliesTo`),
  };
}

function parseWaiver(value: unknown, path: string): EvidenceWaiver {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["gateId", "failurePattern", "alternativeGateIds", "reason"], path);
  return {
    gateId: expectString(object.gateId, `${path}.gateId`),
    failurePattern: expectString(object.failurePattern, `${path}.failurePattern`),
    alternativeGateIds: expectStringArray(object.alternativeGateIds, `${path}.alternativeGateIds`),
    reason: expectString(object.reason, `${path}.reason`),
  };
}

function parseLimits(value: unknown, path: string): RunLimits {
  const object = expectRecord(value, path);
  assertKnownKeys(object, Object.keys(DEFAULT_LIMITS), path);
  return {
    maxAttemptsPerItem: expectInteger(object.maxAttemptsPerItem, `${path}.maxAttemptsPerItem`, 1),
    maxReplans: expectInteger(object.maxReplans, `${path}.maxReplans`),
    maxParallel: expectInteger(object.maxParallel, `${path}.maxParallel`, 1),
    attemptTimeoutMs: expectInteger(object.attemptTimeoutMs, `${path}.attemptTimeoutMs`, 1),
    idleTimeoutMs: expectInteger(object.idleTimeoutMs, `${path}.idleTimeoutMs`, 1),
    maxAdapterLineBytes: expectInteger(object.maxAdapterLineBytes, `${path}.maxAdapterLineBytes`, 1),
    maxRetainedOutputBytes: expectInteger(object.maxRetainedOutputBytes, `${path}.maxRetainedOutputBytes`, 1),
  };
}

function parseRepository(value: unknown, path: string): RepositorySpec {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["root", "baseRef", "baseCommit", "writableRoots"], path);
  return {
    root: resolve(expectString(object.root, `${path}.root`)),
    baseRef: expectString(object.baseRef, `${path}.baseRef`),
    baseCommit: expectString(object.baseCommit, `${path}.baseCommit`),
    writableRoots: expectStringArray(object.writableRoots, `${path}.writableRoots`),
  };
}

function parseDeliveryTarget(value: unknown, path: string): DeliveryTarget {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["provider", "remote", "baseBranch"], path);
  return {
    provider: expectLiteral(object.provider, ["github", "gitlab"], `${path}.provider`),
    remote: expectString(object.remote, `${path}.remote`),
    baseBranch: expectString(object.baseBranch, `${path}.baseBranch`),
  };
}

function parseAmendment(value: unknown, path: string): AmendmentReference {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["runId", "itemId"], path);
  return { runId: expectString(object.runId, `${path}.runId`), itemId: expectString(object.itemId, `${path}.itemId`) };
}

function parseCommitPolicy(value: unknown, path: string): CommitPolicy {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["preCommitHook", "writableRoots", "environmentNames"], path);
  return {
    preCommitHook: expectLiteral(object.preCommitHook, ["run", "skip"], `${path}.preCommitHook`),
    writableRoots: expectStringArray(object.writableRoots, `${path}.writableRoots`),
    environmentNames: expectStringArray(object.environmentNames, `${path}.environmentNames`),
  };
}

function parseAssumption(value: unknown, path: string): RecordedAssumption {
  const object = expectRecord(value, path);
  assertKnownKeys(object, ["statement", "source"], path);
  return { statement: expectString(object.statement, `${path}.statement`), source: expectString(object.source, `${path}.source`) };
}

function parseResolutionSources(value: unknown, path: string): Readonly<Record<string, ResolutionSource>> {
  const object = expectRecord(value, path);
  return Object.fromEntries(
    Object.entries(object).map(([key, source]) => [
      key,
      expectLiteral(source, ["invocation", "project", "user", "default", "repository"], `${path}.${key}`),
    ]),
  );
}

function parseProposed(value: unknown, allowHash: boolean): ProposedRunCharter {
  const object = expectRecord(value, "charter");
  const keys = [
    "schemaVersion", "runId", "sourceText", "createdAt", "repository", "harnessAdapter", "mode", "work", "delivery", "deliveryTarget", "grants", "gates",
    "waivers", "limits", "assumptions", "minimumAssurance", "resolutionSources", "predecessorRunId", "amends", "reviewFeedback", "commitPolicy",
  ];
  assertKnownKeys(object, allowHash ? [...keys, "charterHash"] : keys, "charter");
  if (object.schemaVersion !== 1) {
    throw new AutopilotError("CHARTER_INVALID", "charter.schemaVersion must be 1");
  }
  if (!Array.isArray(object.work) || object.work.length === 0 || !Array.isArray(object.grants) || !Array.isArray(object.gates) || !Array.isArray(object.waivers) || !Array.isArray(object.assumptions)) {
    throw new AutopilotError("CHARTER_INVALID", "charter work, grants, gates, waivers, and assumptions must be arrays; work must not be empty");
  }
  const proposed: ProposedRunCharter = {
    schemaVersion: 1,
    runId: expectString(object.runId, "charter.runId"),
    sourceText: expectString(object.sourceText, "charter.sourceText"),
    createdAt: expectString(object.createdAt, "charter.createdAt"),
    repository: parseRepository(object.repository, "charter.repository"),
    harnessAdapter: expectLiteral(object.harnessAdapter, ["pi", "claude-code", "codex", "opencode"], "charter.harnessAdapter"),
    mode: expectLiteral(object.mode, ["single", "independent-queue", "ordered-stack"], "charter.mode"),
    work: object.work.map((entry, index) => parseWorkItem(entry, `charter.work[${index}]`)),
    delivery: expectLiteral(object.delivery, ["local-commits", "change-request-ready", "merge-verified"], "charter.delivery"),
    ...(object.deliveryTarget === undefined ? {} : { deliveryTarget: parseDeliveryTarget(object.deliveryTarget, "charter.deliveryTarget") }),
    grants: object.grants.map((entry, index) => parseGrant(entry, `charter.grants[${index}]`)),
    gates: object.gates.map((entry, index) => parseGate(entry, `charter.gates[${index}]`)),
    waivers: object.waivers.map((entry, index) => parseWaiver(entry, `charter.waivers[${index}]`)),
    limits: parseLimits(object.limits, "charter.limits"),
    assumptions: object.assumptions.map((entry, index) => parseAssumption(entry, `charter.assumptions[${index}]`)),
    minimumAssurance: expectLiteral(object.minimumAssurance, ["cooperative", "enforced"], "charter.minimumAssurance"),
    resolutionSources: parseResolutionSources(object.resolutionSources, "charter.resolutionSources"),
    ...(object.predecessorRunId === undefined ? {} : { predecessorRunId: expectString(object.predecessorRunId, "charter.predecessorRunId") }),
    ...(object.amends === undefined ? {} : { amends: parseAmendment(object.amends, "charter.amends") }),
    ...(object.reviewFeedback === undefined ? {} : { reviewFeedback: parseReviewFeedback(object.reviewFeedback, "charter.reviewFeedback") }),
    ...(object.commitPolicy === undefined ? {} : { commitPolicy: parseCommitPolicy(object.commitPolicy, "charter.commitPolicy") }),
  };
  validateCharterSemantics(proposed);
  return proposed;
}

function validateRelativeRoots(roots: readonly string[], path: string): void {
  for (const root of roots) {
    if (isAbsolute(root) || root.split(/[\\/]/).includes("..")) {
      throw new AutopilotError("CHARTER_INVALID", `${path} must contain repository-relative paths without '..'`);
    }
  }
}

function relativeRootWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalizedRoot === "." || normalizedRoot === "" || normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function validateCharterSemantics(charter: ProposedRunCharter): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(charter.runId)) {
    throw new AutopilotError("CHARTER_INVALID", "runId must be a safe path component of at most 128 characters");
  }
  if (Number.isNaN(Date.parse(charter.createdAt))) {
    throw new AutopilotError("CHARTER_INVALID", "createdAt must be an ISO date-time");
  }
  if (charter.commitPolicy !== undefined) {
    validateRelativeRoots(charter.commitPolicy.writableRoots, "charter.commitPolicy.writableRoots");
    if (charter.commitPolicy.writableRoots.some((root) =>
      !charter.repository.writableRoots.some((repositoryRoot) => relativeRootWithin(root, repositoryRoot))
    )) {
      throw new AutopilotError("CHARTER_INVALID", "commitPolicy has a writable root outside repository writable roots");
    }
    if (charter.commitPolicy.preCommitHook === "skip" && charter.commitPolicy.writableRoots.length > 0) {
      throw new AutopilotError("CHARTER_INVALID", "skipped pre-commit hooks cannot declare writable roots");
    }
  }
  const itemIds = new Set(charter.work.map(({ id }) => id));
  if (itemIds.size !== charter.work.length) {
    throw new AutopilotError("CHARTER_INVALID", "work item IDs must be unique");
  }
  const branchNames = new Set(charter.work.map(({ branchName }) => branchName));
  if (branchNames.size !== charter.work.length) {
    throw new AutopilotError("CHARTER_INVALID", "work item branches must be unique");
  }
  const gateIds = new Set(charter.gates.map(({ id }) => id));
  if (gateIds.size !== charter.gates.length) {
    throw new AutopilotError("CHARTER_INVALID", "gate IDs must be unique");
  }
  validateRelativeRoots(charter.repository.writableRoots, "charter.repository.writableRoots");
  for (const item of charter.work) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.id)) {
      throw new AutopilotError("CHARTER_INVALID", `work item ID must be a safe path component: ${item.id}`);
    }
    validateRelativeRoots(item.writableRoots, `work item ${item.id} writableRoots`);
    if (item.writableRoots.some((root) => !charter.repository.writableRoots.some((repositoryRoot) => relativeRootWithin(root, repositoryRoot)))) {
      throw new AutopilotError("CHARTER_INVALID", `work item ${item.id} has a writable root outside repository writable roots`);
    }
    for (const predicate of item.acceptance) {
      if (predicate.type === "path-present" || predicate.type === "path-absent") {
        validateRelativeRoots([predicate.path], `work item ${item.id} predicate path`);
      } else if (predicate.type === "search-count") {
        validateRelativeRoots(predicate.paths, `work item ${item.id} predicate paths`);
      }
    }
    if (item.dependsOn.includes(item.id) || item.dependsOn.some((id) => !itemIds.has(id))) {
      throw new AutopilotError("CHARTER_INVALID", `work item ${item.id} has an invalid dependency`);
    }
    for (const predicate of item.acceptance) {
      if (predicate.type === "gate-passed" && !gateIds.has(predicate.gateId)) {
        throw new AutopilotError("CHARTER_INVALID", `work item ${item.id} references unknown gate ${predicate.gateId}`);
      }
    }
  }
  for (const gate of charter.gates) {
    if (gate.type === "command") {
      validateRelativeRoots([gate.workingDirectory], `gate ${gate.id} workingDirectory`);
    } else {
      validateRelativeRoots(gate.paths, `gate ${gate.id} paths`);
    }
    if (gate.appliesTo.some((id) => !itemIds.has(id))) {
      throw new AutopilotError("CHARTER_INVALID", `gate ${gate.id} applies to an unknown item`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new AutopilotError("CHARTER_INVALID", "work graph contains a cycle");
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    const item = charter.work.find((candidate) => candidate.id === id);
    item?.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  charter.work.forEach(({ id }) => visit(id));
  for (const waiver of charter.waivers) {
    if (!gateIds.has(waiver.gateId) || waiver.alternativeGateIds.length === 0 || waiver.alternativeGateIds.some((id) => !gateIds.has(id))) {
      throw new AutopilotError("CHARTER_INVALID", `waiver for ${waiver.gateId} has unknown or missing alternative gates`);
    }
  }
  if (charter.mode === "single" && charter.work.length !== 1) {
    throw new AutopilotError("CHARTER_INVALID", "single mode requires exactly one work item");
  }
  if (charter.amends !== undefined) {
    if (charter.mode !== "single" || charter.work.length !== 1 || charter.work[0]?.id !== charter.amends.itemId) {
      throw new AutopilotError("CHARTER_INVALID", "amendments require single mode and the predecessor item ID");
    }
    if (charter.delivery !== "change-request-ready" || charter.deliveryTarget === undefined) {
      throw new AutopilotError("CHARTER_INVALID", "amendments require change-request-ready delivery");
    }
    if (charter.predecessorRunId !== undefined && charter.predecessorRunId !== charter.amends.runId) {
      throw new AutopilotError("CHARTER_INVALID", "predecessorRunId must match amends.runId");
    }
  }
  if (charter.reviewFeedback !== undefined) {
    if (charter.amends === undefined || charter.reviewFeedback.observedHeadCommit !== charter.repository.baseCommit) {
      throw new AutopilotError("CHARTER_INVALID", "review feedback requires an amendment bound to its observed head commit");
    }
    if (charter.reviewFeedback.threads.some(({ contentHash }) => !/^[a-f0-9]{64}$/u.test(contentHash))) {
      throw new AutopilotError("CHARTER_INVALID", "review feedback content hashes must be lowercase SHA-256 identities");
    }
    if (charter.reviewFeedback.threads.some(({ resolve: shouldResolve }) => shouldResolve)
      && !charter.grants.some(({ family, actor }) => family === "review-thread.resolve" && actor === "delivery")) {
      throw new AutopilotError("CHARTER_INVALID", "resolvable review feedback requires a delivery review-thread.resolve grant");
    }
  }
  if (charter.mode === "ordered-stack") {
    charter.work.forEach((item, index) => {
      const expected = index === 0 ? [] : [charter.work[index - 1]?.id];
      if (canonicalJson(item.dependsOn) !== canonicalJson(expected)) {
        throw new AutopilotError("CHARTER_INVALID", "ordered-stack items must form one explicit chain in work order");
      }
    });
  }
  if (charter.delivery !== "local-commits" && charter.deliveryTarget === undefined) {
    throw new AutopilotError("CHARTER_INVALID", "remote delivery requires deliveryTarget");
  }
  if (charter.delivery === "merge-verified" && !charter.grants.some(({ family, actor }) => family === "merge.execute" && actor === "delivery")) {
    throw new AutopilotError("CHARTER_INVALID", "merge-verified delivery requires a delivery merge.execute grant");
  }
}

export function parseProposedCharter(value: unknown): ProposedRunCharter {
  return parseProposed(value, false);
}

function deepFreeze(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    Object.freeze(value);
  } else if (isRecord(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}

export function sealCharter(value: unknown): RunCharter {
  const proposed = parseProposed(value, false);
  const charter: RunCharter = { ...proposed, charterHash: sha256(canonicalJson(proposed)) };
  deepFreeze(charter);
  return charter;
}

export function parseSealedCharter(value: unknown): RunCharter {
  if (!isRecord(value)) {
    throw new AutopilotError("CHARTER_INVALID", "charter must be an object");
  }
  const proposed = parseProposed(value, true);
  const charterHash = expectString(value.charterHash, "charter.charterHash");
  const expectedHash = sha256(canonicalJson(proposed));
  if (charterHash !== expectedHash) {
    throw new AutopilotError("CHARTER_TAMPERED", "charter hash does not match its immutable content");
  }
  const charter: RunCharter = { ...proposed, charterHash };
  deepFreeze(charter);
  return charter;
}

export function defaultRunLimits(): RunLimits {
  return { ...DEFAULT_LIMITS };
}
