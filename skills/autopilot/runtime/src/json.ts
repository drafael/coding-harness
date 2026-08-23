import { createHash } from "node:crypto";
import { AutopilotError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be an object`);
  }
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be a non-empty string`);
  }
  return value;
}

export function expectOptionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : expectString(value, path);
}

export function expectStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be an array`);
  }
  return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

export function expectInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be a boolean`);
  }
  return value;
}

export function expectLiteral<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AutopilotError("CHARTER_INVALID", `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new AutopilotError("CHARTER_INVALID", `${path} contains unknown fields: ${unknownKeys.join(", ")}`);
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
