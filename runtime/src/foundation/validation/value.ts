import { LifecycleError } from "../../errors.js";
import type { Sha256 } from "./canonical.js";

export type JsonObject = Record<string, unknown>;

export function object(value: unknown, code: string, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LifecycleError({ code, message: `${label} must be one JSON object` });
  }
  return value as JsonObject;
}

export function exactKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = [], code = "foundation.object.keys", label = "Object"): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && !/^x-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key)) {
      throw new LifecycleError({ code, message: `${label} has unsupported field ${key}` });
    }
  }
  for (const key of required) {
    if (!(key in value)) throw new LifecycleError({ code, message: `${label} is missing required field ${key}` });
  }
}

export function text(value: unknown, label: string, maximum = 16_384): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\0")) {
    throw new LifecycleError({ code: "foundation.value.text", message: `${label} must be nonempty text of at most ${maximum} characters without NUL` });
  }
  return value;
}

export function singleLine(value: unknown, label: string, maximum = 1_024): string {
  const result = text(value, label, maximum);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(result)) {
    throw new LifecycleError({ code: "foundation.value.single_line", message: `${label} must be one printable line` });
  }
  return result;
}

export function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new LifecycleError({ code: "foundation.value.boolean", message: `${label} must be boolean` });
  return value;
}

export function integer(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new LifecycleError({ code: "foundation.value.integer", message: `${label} must be an integer from ${minimum} through ${maximum}` });
  }
  return value as number;
}

export function enumeration<const Values extends readonly string[]>(value: unknown, label: string, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new LifecycleError({ code: "foundation.value.enum", message: `${label} must be one of ${values.join(", ")}` });
  }
  return value as Values[number];
}

export function array(value: unknown, label: string, minimum = 0, maximum = 4096): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new LifecycleError({ code: "foundation.value.array", message: `${label} must contain ${minimum} through ${maximum} items` });
  }
  return value;
}

export function uniqueStrings(value: unknown, label: string, minimum = 0, maximum = 4096, itemMaximum = 16_384): string[] {
  const values = array(value, label, minimum, maximum).map((item, index) => text(item, `${label}[${index}]`, itemMaximum));
  if (new Set(values).size !== values.length) throw new LifecycleError({ code: "foundation.value.unique", message: `${label} contains duplicate values` });
  return values;
}

export function opaqueId(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) throw new LifecycleError({ code: "foundation.value.id", message: `${label} is not a valid opaque identity` });
  return result;
}

export function ownerId(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(result)) throw new LifecycleError({ code: "foundation.value.owner", message: `${label} is not a valid owner identity` });
  return result;
}

export function knowledgeId(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!/^(?:behavior|assurance|blueprint|description|check|discipline)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u.test(result)) {
    throw new LifecycleError({ code: "foundation.value.knowledge_id", message: `${label} is not a valid Knowledge identity` });
  }
  return result;
}

export function normalizedPath(value: unknown, label: string): string {
  const result = text(value, label, 4096);
  if (result.startsWith("/") || result.includes("\\") || result.includes("//") || result.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new LifecycleError({ code: "foundation.value.path", message: `${label} must be one normalized repository-relative path` });
  }
  return result;
}

export function sha256(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new LifecycleError({ code: "foundation.value.digest", message: `${label} must be one lowercase SHA-256 digest` });
  }
  return value as Sha256;
}

export function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new LifecycleError({ code: "foundation.value.git_object", message: `${label} must be one Git object identity` });
  }
  return value;
}

export function nullable<T>(value: unknown, parser: (value: unknown) => T): T | null {
  return value === null ? null : parser(value);
}

export function rfc3339(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(result) || Number.isNaN(Date.parse(result))) {
    throw new LifecycleError({ code: "foundation.value.time", message: `${label} must be one RFC 3339 UTC timestamp` });
  }
  return result;
}
