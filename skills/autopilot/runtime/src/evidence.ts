import { mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { EvidenceWaiver, RunCharter, VerificationGate, WorkItem } from "./charter.js";
import { AutopilotError } from "./errors.js";
import { writeImmutableJson } from "./journal.js";
import { canonicalJson, sha256 } from "./json.js";
import { runVerificationCommand } from "./repository.js";

export type ReceiptStatus = "PASSED" | "FAILED" | "WAIVED" | "UNVERIFIED";

export interface VerificationReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly runId: string;
  readonly itemId: string;
  readonly gateId: string;
  readonly subject: string;
  readonly gateDefinitionHash: string;
  readonly environmentIdentity: string;
  readonly status: ReceiptStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitCode: number | null;
  readonly observedCount?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly executor: string;
  readonly truncated: boolean;
  readonly waiverReason?: string;
}

function gateApplies(gate: VerificationGate, item: WorkItem): boolean {
  return gate.appliesTo.length === 0 || gate.appliesTo.includes(item.id);
}

export function redactEnvironmentSecrets(text: string, environmentNames: readonly string[]): string {
  const secretNames = environmentNames.filter((name) => /(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name));
  return secretNames.reduce((current, name) => {
    const value = process.env[name];
    return value === undefined || value.length < 4 ? current : current.replaceAll(value, "****");
  }, text);
}

async function collectFiles(path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function pathWithin(candidate: string, root: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export async function countLiteral(worktreePath: string, paths: readonly string[], query: string): Promise<number> {
  let count = 0;
  const root = await realpath(worktreePath);
  for (const relativePath of paths) {
    const candidate = resolve(root, relativePath);
    if (!pathWithin(candidate, root)) {
      throw new AutopilotError("CAPABILITY_DENIED", `search path escapes the worktree: ${relativePath}`);
    }
    let realCandidate: string;
    try {
      realCandidate = await realpath(candidate);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (!pathWithin(realCandidate, root)) {
      throw new AutopilotError("CAPABILITY_DENIED", `search path resolves outside the worktree: ${relativePath}`);
    }
    let files: readonly string[];
    try {
      files = await collectFiles(realCandidate);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
        files = [realCandidate];
      } else if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        files = [];
      } else {
        throw error;
      }
    }
    for (const file of files) {
      const content = await readFile(file, "utf8");
      let cursor = 0;
      while ((cursor = content.indexOf(query, cursor)) >= 0) {
        count += 1;
        cursor += Math.max(query.length, 1);
      }
    }
  }
  return count;
}

function environmentIdentity(gate: VerificationGate): string {
  const environmentNames = gate.type === "command" ? gate.environmentNames : [];
  const environmentHashes = Object.fromEntries(environmentNames.map((name) => {
    const value = process.env[name];
    const identity = value === undefined
      ? null
      : /(TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)/i.test(name) ? "present-secret" : sha256(value);
    return [name, identity];
  }));
  return sha256(canonicalJson({ node: process.version, platform: process.platform, arch: process.arch, environmentHashes }));
}

function withReceiptId(receipt: Omit<VerificationReceipt, "receiptId">): VerificationReceipt {
  return { ...receipt, receiptId: sha256(canonicalJson(receipt)) };
}

function withoutReceiptId({ receiptId: _receiptId, ...receipt }: VerificationReceipt): Omit<VerificationReceipt, "receiptId"> {
  return receipt;
}

export async function executeGate(
  charter: RunCharter,
  item: WorkItem,
  gate: VerificationGate,
  worktreePath: string,
  subject: string,
): Promise<VerificationReceipt> {
  const startedAt = new Date().toISOString();
  const gateDefinitionHash = sha256(canonicalJson(gate));
  const identity = environmentIdentity(gate);
  if (gate.type === "command") {
    const root = await realpath(worktreePath);
    const workingDirectory = await realpath(resolve(root, gate.workingDirectory));
    if (!pathWithin(workingDirectory, root)) {
      throw new AutopilotError("CAPABILITY_DENIED", `gate working directory escapes the worktree: ${gate.workingDirectory}`);
    }
    const result = await runVerificationCommand(
      gate.executable,
      gate.arguments,
      workingDirectory,
      gate.environmentNames,
      charter.limits.attemptTimeoutMs,
      charter.limits.maxRetainedOutputBytes,
    );
    return withReceiptId({
      schemaVersion: 1,
      runId: charter.runId,
      itemId: item.id,
      gateId: gate.id,
      subject,
      gateDefinitionHash,
      environmentIdentity: identity,
      status: result.exitCode === 0 ? "PASSED" : "FAILED",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      stdout: redactEnvironmentSecrets(result.stdout, gate.environmentNames),
      stderr: redactEnvironmentSecrets(result.stderr, gate.environmentNames),
      executor: basename(gate.executable),
      truncated: result.truncated,
    });
  }
  const observedCount = await countLiteral(worktreePath, gate.paths, gate.query);
  return withReceiptId({
    schemaVersion: 1,
    runId: charter.runId,
    itemId: item.id,
    gateId: gate.id,
    subject,
    gateDefinitionHash,
    environmentIdentity: identity,
    status: observedCount === gate.expectedCount ? "PASSED" : "FAILED",
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: null,
    observedCount,
    stdout: `Observed ${observedCount}; expected ${gate.expectedCount}.`,
    stderr: "",
    executor: "autopilot-search",
    truncated: false,
  });
}

function applyWaiver(
  receipt: VerificationReceipt,
  waiver: EvidenceWaiver,
  receipts: readonly VerificationReceipt[],
): VerificationReceipt {
  const output = `${receipt.stdout}\n${receipt.stderr}`;
  const alternativesPass = waiver.alternativeGateIds.every((id) => receipts.some(({ gateId, status }) => gateId === id && status === "PASSED"));
  if (receipt.status !== "FAILED" || !output.includes(waiver.failurePattern) || !alternativesPass) {
    return receipt;
  }
  const waived = { ...receipt, status: "WAIVED" as const, waiverReason: waiver.reason };
  return withReceiptId(withoutReceiptId(waived));
}

export async function executeItemGates(
  charter: RunCharter,
  item: WorkItem,
  worktreePath: string,
  subject: string,
): Promise<readonly VerificationReceipt[]> {
  const direct: VerificationReceipt[] = [];
  for (const gate of charter.gates.filter((candidate) => gateApplies(candidate, item))) {
    direct.push(await executeGate(charter, item, gate, worktreePath, subject));
  }
  return direct.map((receipt) => {
    const waiver = charter.waivers.find(({ gateId }) => gateId === receipt.gateId);
    return waiver === undefined ? receipt : applyWaiver(receipt, waiver, direct);
  });
}

export async function storeReceipt(runDirectory: string, receipt: VerificationReceipt): Promise<string> {
  await mkdir(join(runDirectory, "receipts"), { recursive: true, mode: 0o700 });
  const path = join(runDirectory, "receipts", `${receipt.receiptId}.json`);
  try {
    await writeImmutableJson(path, receipt);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const existing = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw error;
    }
  }
  return path;
}

export function receiptIsFresh(receipt: VerificationReceipt, subject: string, gate: VerificationGate): boolean {
  return receipt.subject === subject && receipt.gateDefinitionHash === sha256(canonicalJson(gate)) && receipt.environmentIdentity === environmentIdentity(gate);
}
