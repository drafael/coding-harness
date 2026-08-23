import { createHash } from "node:crypto";
import { AutopilotError } from "./errors.js";
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function expectRecord(value, path) {
    if (!isRecord(value)) {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be an object`);
    }
    return value;
}
export function expectString(value, path) {
    if (typeof value !== "string" || value.length === 0) {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be a non-empty string`);
    }
    return value;
}
export function expectOptionalString(value, path) {
    return value === undefined ? undefined : expectString(value, path);
}
export function expectStringArray(value, path) {
    if (!Array.isArray(value)) {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be an array`);
    }
    return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}
export function expectInteger(value, path, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
}
export function expectBoolean(value, path) {
    if (typeof value !== "boolean") {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be a boolean`);
    }
    return value;
}
export function expectLiteral(value, allowed, path) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new AutopilotError("CHARTER_INVALID", `${path} must be one of: ${allowed.join(", ")}`);
    }
    return value;
}
export function assertKnownKeys(value, allowed, path) {
    const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknownKeys.length > 0) {
        throw new AutopilotError("CHARTER_INVALID", `${path} contains unknown fields: ${unknownKeys.join(", ")}`);
    }
}
function normalize(value) {
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
    }
    return value;
}
export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
