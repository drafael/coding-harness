import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Predicate, RunCharter } from "./charter.js";
import {
  predicateIdentity,
  type PredicateEvaluationReceipt,
  type PredicateOutcome,
  type PredicateResult,
} from "./done.js";
import type { JournalRecord } from "./journal.js";
import { canonicalJson, isRecord, sha256 } from "./json.js";
import type { RunProjection } from "./reducer.js";

export interface PredicateEvidenceEntry extends PredicateResult {
  readonly itemId: string;
  readonly evaluationReceiptId: string | null;
}

export interface ReviewEvidenceFinding {
  readonly itemId: string;
  readonly gateId: string;
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

function expectedValue(predicate: Predicate): string | number | boolean {
  switch (predicate.type) {
    case "gate-passed":
      return "PASSED_OR_WAIVED";
    case "path-present":
      return true;
    case "path-absent":
      return false;
    case "search-count":
      return predicate.expectedCount;
  }
}

function receiptHashMatches(value: Record<string, unknown>, receiptId: string): boolean {
  const { receiptId: _receiptId, ...withoutId } = value;
  return sha256(canonicalJson(withoutId)) === receiptId;
}

async function readPredicateReceipt(runDirectory: string, receiptId: string): Promise<PredicateEvaluationReceipt | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(runDirectory, "receipts", `${receiptId}.json`), "utf8"));
    if (!isRecord(value) || value.schemaVersion !== 1 || value.type !== "predicate-evaluation"
      || value.receiptId !== receiptId || !receiptHashMatches(value, receiptId) || !Array.isArray(value.results)
      || !value.results.every(isRecord)) {
      return undefined;
    }
    return value as unknown as PredicateEvaluationReceipt;
  } catch {
    return undefined;
  }
}

function blockedEntry(
  itemId: string,
  predicate: Predicate,
  predicateIndex: number,
  subject: string,
): PredicateEvidenceEntry {
  return {
    itemId,
    predicateId: predicateIdentity(itemId, predicateIndex, predicate),
    predicateIndex,
    predicate,
    outcome: "blocked",
    subject,
    reason: "No current predicate observation is available.",
    evidenceReceiptIds: [],
    observed: null,
    expected: expectedValue(predicate),
    evaluationReceiptId: null,
  };
}

function validOutcome(value: unknown): value is PredicateOutcome {
  return value === "met" || value === "not-met" || value === "blocked";
}

function resultMatches(result: PredicateResult, itemId: string, predicate: Predicate, predicateIndex: number): boolean {
  const observedValid = result.observed === null || typeof result.observed === "string"
    || typeof result.observed === "number" || typeof result.observed === "boolean";
  const expectedValid = typeof result.expected === "string" || typeof result.expected === "number"
    || typeof result.expected === "boolean";
  return result.predicateId === predicateIdentity(itemId, predicateIndex, predicate)
    && result.predicateIndex === predicateIndex
    && canonicalJson(result.predicate) === canonicalJson(predicate)
    && validOutcome(result.outcome)
    && typeof result.subject === "string"
    && typeof result.reason === "string"
    && Array.isArray(result.evidenceReceiptIds)
    && result.evidenceReceiptIds.every((id) => typeof id === "string")
    && observedValid
    && expectedValid;
}

export async function projectReviewFindings(
  runDirectory: string,
  records: readonly JournalRecord[],
): Promise<readonly ReviewEvidenceFinding[]> {
  const latestByGate = new Map<string, readonly ReviewEvidenceFinding[]>();
  const receiptEvents = records.filter(({ event }) => event.type === "RECEIPT_RECORDED").reverse();
  for (const { event } of receiptEvents) {
    if (event.type !== "RECEIPT_RECORDED" || event.itemId === undefined
      || (event.receiptKind !== undefined && event.receiptKind !== "review")) {
      continue;
    }
    const eventKey = event.gateId === undefined ? undefined : `${event.itemId}\0${event.gateId}`;
    if (eventKey !== undefined) {
      if (latestByGate.has(eventKey)) {
        continue;
      }
      latestByGate.set(eventKey, []);
    }
    try {
      const value: unknown = JSON.parse(await readFile(join(runDirectory, "receipts", `${event.receiptId}.json`), "utf8"));
      if (!isRecord(value) || value.receiptId !== event.receiptId || !receiptHashMatches(value, event.receiptId)
        || value.itemId !== event.itemId || typeof value.gateId !== "string"
        || (event.gateId !== undefined && value.gateId !== event.gateId) || !Array.isArray(value.reviewFindings)) {
        continue;
      }
      const key = `${event.itemId}\0${value.gateId}`;
      if (latestByGate.has(key) && key !== eventKey) {
        continue;
      }
      const findings = value.reviewFindings.flatMap((finding): readonly ReviewEvidenceFinding[] => {
        if (!isRecord(finding) || typeof finding.message !== "string" || finding.message.length === 0) {
          return [];
        }
        return [{
          itemId: event.itemId as string,
          gateId: value.gateId as string,
          ...(typeof finding.path === "string" ? { path: finding.path } : {}),
          ...(Number.isSafeInteger(finding.line) && (finding.line as number) > 0 ? { line: finding.line as number } : {}),
          message: finding.message,
        }];
      });
      latestByGate.set(key, findings);
    } catch {
      // Missing or corrupt review receipts do not become worker context.
    }
  }
  return [...latestByGate.values()].flat();
}

export async function projectPredicateEvidence(
  runDirectory: string,
  charter: RunCharter,
  projection: RunProjection,
  records: readonly JournalRecord[],
): Promise<readonly PredicateEvidenceEntry[]> {
  const latestByItem = new Map<string, PredicateEvaluationReceipt>();
  const resolvedItems = new Set<string>();
  const latestAttemptSequences = new Map(charter.work.map((item) => [
    item.id,
    records.findLast(({ event }) => event.type === "ATTEMPT_STARTED" && event.itemId === item.id)?.sequence ?? 0,
  ]));
  const receiptEvents = records.filter(({ event }) => event.type === "RECEIPT_RECORDED").reverse();
  for (const { sequence, event } of receiptEvents) {
    if (event.type !== "RECEIPT_RECORDED" || event.itemId === undefined || resolvedItems.has(event.itemId)
      || (event.receiptKind !== undefined && event.receiptKind !== "predicate")) {
      continue;
    }
    if (event.receiptKind === "predicate") {
      resolvedItems.add(event.itemId);
    }
    if (sequence <= (latestAttemptSequences.get(event.itemId) ?? 0)) {
      resolvedItems.add(event.itemId);
      continue;
    }
    const receipt = await readPredicateReceipt(runDirectory, event.receiptId);
    const expectedSubject = projection.items[event.itemId]?.subject;
    if (receipt !== undefined && receipt.itemId === event.itemId
      && (expectedSubject === undefined || receipt.subject === expectedSubject)) {
      latestByItem.set(event.itemId, receipt);
      resolvedItems.add(event.itemId);
    }
  }
  return charter.work.flatMap((item) => {
    const receipt = latestByItem.get(item.id);
    const byIdentity = new Map(receipt?.results.map((entry) => [entry.predicateId, entry]) ?? []);
    return item.acceptance.map((predicate, predicateIndex): PredicateEvidenceEntry => {
      const predicateId = predicateIdentity(item.id, predicateIndex, predicate);
      const result = byIdentity.get(predicateId);
      if (receipt === undefined || result === undefined || !resultMatches(result, item.id, predicate, predicateIndex)) {
        return blockedEntry(item.id, predicate, predicateIndex, projection.items[item.id]?.subject ?? "unobserved");
      }
      return { ...result, itemId: item.id, evaluationReceiptId: receipt.receiptId };
    });
  });
}
