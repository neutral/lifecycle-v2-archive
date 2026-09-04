import { createHash } from "node:crypto";
import { LifecycleError } from "../../errors.js";

export type Sha256 = `sha256:${string}`;

function assertUnicodeScalarValue(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new LifecycleError({ code: "foundation.canonical.unicode", message: `Canonical JSON rejects an unpaired high surrogate at ${path}` });
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new LifecycleError({ code: "foundation.canonical.unicode", message: `Canonical JSON rejects an unpaired low surrogate at ${path}` });
    }
  }
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarValue(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LifecycleError({ code: "foundation.canonical.number", message: `Canonical JSON rejects non-finite number at ${path}` });
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new LifecycleError({ code: "foundation.canonical.number", message: `Canonical JSON rejects unsafe integer at ${path}` });
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new LifecycleError({ code: "foundation.canonical.cycle", message: `Canonical JSON rejects cyclic value at ${path}` });
    seen.add(value);
    const result = `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new LifecycleError({ code: "foundation.canonical.cycle", message: `Canonical JSON rejects cyclic value at ${path}` });
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LifecycleError({ code: "foundation.canonical.object", message: `Canonical JSON accepts only plain objects at ${path}` });
    }
    seen.add(value);
    // RFC 8785 orders object properties by UTF-16 code units, which is the
    // ordering implemented by Array.prototype.sort without a comparator.
    const members = Object.keys(value as Record<string, unknown>).sort().map((key) => {
      assertUnicodeScalarValue(key, `${path} key`);
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new LifecycleError({ code: "foundation.canonical.undefined", message: `Canonical JSON rejects undefined object member at ${path}.${key}` });
      }
      return `${JSON.stringify(key)}:${canonicalize(child, `${path}.${key}`, seen)}`;
    });
    seen.delete(value);
    return `{${members.join(",")}}`;
  }
  throw new LifecycleError({ code: "foundation.canonical.type", message: `Canonical JSON rejects ${typeof value} at ${path}` });
}

/** RFC 8785 canonical JSON for the bounded JSON value domain used by Lifecycle. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new Set());
}

export function canonicalJsonLine(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function prettyCanonicalize(value: unknown, path: string, depth: number, seen: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return canonicalize(value, path, seen);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new LifecycleError({ code: "foundation.canonical.cycle", message: `Canonical JSON rejects cyclic value at ${path}` });
    if (value.length === 0) return "[]";
    seen.add(value);
    const indentation = "  ".repeat(depth + 1);
    const closingIndentation = "  ".repeat(depth);
    const result = `[\n${value
      .map((item, index) => `${indentation}${prettyCanonicalize(item, `${path}[${index}]`, depth + 1, seen)}`)
      .join(",\n")}\n${closingIndentation}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new LifecycleError({ code: "foundation.canonical.cycle", message: `Canonical JSON rejects cyclic value at ${path}` });
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LifecycleError({ code: "foundation.canonical.object", message: `Canonical JSON accepts only plain objects at ${path}` });
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    if (keys.length === 0) return "{}";
    seen.add(value);
    const indentation = "  ".repeat(depth + 1);
    const closingIndentation = "  ".repeat(depth);
    const result = `{\n${keys.map((key) => {
      assertUnicodeScalarValue(key, `${path} key`);
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new LifecycleError({ code: "foundation.canonical.undefined", message: `Canonical JSON rejects undefined object member at ${path}.${key}` });
      }
      return `${indentation}${JSON.stringify(key)}: ${prettyCanonicalize(child, `${path}.${key}`, depth + 1, seen)}`;
    }).join(",\n")}\n${closingIndentation}}`;
    seen.delete(value);
    return result;
  }
  throw new LifecycleError({ code: "foundation.canonical.type", message: `Canonical JSON rejects ${typeof value} at ${path}` });
}

export function canonicalPrettyJson(value: unknown): string {
  return `${prettyCanonicalize(value, "$", 0, new Set())}\n`;
}

export function sha256Bytes(value: string | Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestCanonical(value: unknown): Sha256 {
  return sha256Bytes(canonicalJson(value));
}

export function selfDigest<T extends Record<string, unknown>>(value: T, field = "digest"): Sha256 {
  const subject: Record<string, unknown> = { ...value };
  delete subject[field];
  return digestCanonical(subject);
}

export function assertDigest(value: unknown, label = "digest"): asserts value is Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new LifecycleError({ code: "foundation.digest", message: `${label} must be one lowercase SHA-256 digest` });
  }
}
