import { FoundationError } from "../error.js";
import { FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS } from "../repository/contract.js";
import type { FoundationKnowledgeStructuralLimits } from "./types.js";

export const FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS: FoundationKnowledgeStructuralLimits = Object.freeze({
  maximumFileBytes: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumFileBytes,
  maximumFrontMatterBytes: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumFrontMatterBytes,
  maximumJsonDepth: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumJsonDepth,
  maximumJsonNodes: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumJsonNodes,
  maximumObjectProperties: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumObjectProperties,
  maximumArrayItems: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumArrayItems,
  maximumBodyLines: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumBodyLines,
  maximumHeadings: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumHeadings,
  maximumHeadingBytes: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumHeadingBytes,
  maximumPathBytes: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumPathBytes,
});

export const FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITATIONS: readonly string[] = Object.freeze([]);

export type KnowledgeJsonObject = Record<string, unknown>;

function scalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function assertScalarText(value: string, source: string): void {
  if (!scalarString(value)) {
    throw new FoundationError("lifecycle.knowledge.unicode", `${source} contains an unpaired Unicode surrogate`);
  }
}

export function decodeKnowledgeUtf8(bytes: Buffer, source: string, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumFileBytes) {
    throw new FoundationError(
      "lifecycle.knowledge.limit-invalid",
      `${source} maximum byte limit must be an integer from 1 through ${FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumFileBytes}`,
    );
  }
  if (bytes.byteLength > maximumBytes) {
    throw new FoundationError("lifecycle.knowledge.file-too-large", `${source} exceeds the ${maximumBytes}-byte Knowledge limit`);
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new FoundationError("lifecycle.knowledge.bom", `${source} contains a forbidden UTF-8 byte-order mark`);
  }
  if (bytes.includes(0)) throw new FoundationError("lifecycle.knowledge.nul", `${source} contains a forbidden NUL byte`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new FoundationError("lifecycle.knowledge.utf8", `${source} is not well-formed UTF-8`);
  }
  assertScalarText(text, source);
  for (let index = text.indexOf("\r"); index >= 0; index = text.indexOf("\r", index + 1)) {
    if (text[index + 1] !== "\n") {
      throw new FoundationError("lifecycle.knowledge.line-ending", `${source} uses a line ending other than LF or CRLF`);
    }
  }
  return text;
}

export function assertKnowledgeJsonTextBounds(
  text: string,
  source: string,
  maximumDepth = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumJsonDepth,
): void {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const token = text[index]!;
    if (token === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') break;
        index += 1;
      }
      if (index >= text.length) return;
      let next = index + 1;
      while (next < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[next]!)) next += 1;
      if (text[next] === ":") {
        try {
          const key = JSON.parse(text.slice(start, index + 1)) as string;
          if (key === "__proto__") {
            throw new FoundationError("lifecycle.knowledge.json-key", `${source} contains the unsafe JSON object key __proto__`);
          }
        } catch (error) {
          if (error instanceof FoundationError) throw error;
          // The strict JSON parser owns malformed-string diagnostics.
        }
      }
      continue;
    }
    if (token === "{" || token === "[") {
      depth += 1;
      if (depth > maximumDepth) {
        throw new FoundationError("lifecycle.knowledge.json-depth", `${source} exceeds the maximum JSON depth of ${maximumDepth}`);
      }
    } else if (token === "}" || token === "]") {
      depth -= 1;
    }
  }
}

export function prepareKnowledgeJson(
  value: unknown,
  text: string,
  source: string,
  limits: FoundationKnowledgeStructuralLimits = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
): unknown {
  assertKnowledgeJsonTextBounds(text, source, limits.maximumJsonDepth);
  let nodes = 0;

  function visit(current: unknown, depth: number): unknown {
    nodes += 1;
    if (nodes > limits.maximumJsonNodes) {
      throw new FoundationError("lifecycle.knowledge.json-nodes", `${source} exceeds the maximum JSON node count of ${limits.maximumJsonNodes}`);
    }
    if (depth > limits.maximumJsonDepth) {
      throw new FoundationError("lifecycle.knowledge.json-depth", `${source} exceeds the maximum JSON depth of ${limits.maximumJsonDepth}`);
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") {
      assertScalarText(current, source);
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) {
        throw new FoundationError("lifecycle.knowledge.json-number", `${source} contains a non-finite or unsafe JSON number`);
      }
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maximumArrayItems) {
        throw new FoundationError("lifecycle.knowledge.json-array", `${source} contains an array exceeding ${limits.maximumArrayItems} items`);
      }
      return Object.freeze(current.map((item) => visit(item, depth + 1)));
    }
    if (typeof current !== "object") {
      throw new FoundationError("lifecycle.knowledge.json-type", `${source} contains a value outside the Lifecycle JSON data model`);
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FoundationError("lifecycle.knowledge.json-object", `${source} contains an unsafe JSON object prototype`);
    }
    const entries = Object.entries(current as Record<string, unknown>);
    if (entries.length > limits.maximumObjectProperties) {
      throw new FoundationError("lifecycle.knowledge.json-object", `${source} contains an object exceeding ${limits.maximumObjectProperties} properties`);
    }
    const result = Object.create(null) as KnowledgeJsonObject;
    for (const [key, child] of entries) {
      assertScalarText(key, `${source} object key`);
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: visit(child, depth + 1),
      });
    }
    return Object.freeze(result);
  }

  return visit(value, 1);
}

export function knowledgeObject(value: unknown, code: string, label: string): KnowledgeJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(code, `${label} must be one JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FoundationError(code, `${label} must be one plain JSON object`);
  }
  return value as KnowledgeJsonObject;
}

export function exactKnowledgeKeys(
  value: KnowledgeJsonObject,
  required: readonly string[],
  optional: readonly string[],
  extensionsAllowed: boolean,
  code: string,
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (extensionsAllowed && /^x-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key)) continue;
    throw new FoundationError(code, `${label} has unsupported field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new FoundationError(code, `${label} is missing required field ${key}`);
  }
}

export function normalizedKnowledgePath(
  value: unknown,
  label: string,
  maximumPathBytes = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumPathBytes,
): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new FoundationError("lifecycle.path.invalid", `${label} must be one nonempty repository-relative path`);
  }
  assertScalarText(value, label);
  if (Buffer.byteLength(value, "utf8") > maximumPathBytes) {
    throw new FoundationError(
      "lifecycle.path.invalid",
      `${label} exceeds the ${maximumPathBytes}-byte repository path limit`,
    );
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("?") ||
    value.includes("#") ||
    /%[0-9a-f]{2}/iu.test(value) ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new FoundationError("lifecycle.path.invalid", `${label} must be one normalized repository-relative path`);
  }
  return value;
}

export function assertKnowledgeBodyBounds(
  body: string,
  source: string,
  maximumBodyLines = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumBodyLines,
): void {
  assertScalarText(body, source);
  const lineCount = body.length === 0 ? 0 : 1 + [...body.matchAll(/\n/gu)].length;
  if (lineCount > maximumBodyLines) {
    throw new FoundationError(
      "lifecycle.knowledge.body-lines",
      `${source} exceeds the maximum body line count of ${maximumBodyLines}`,
    );
  }
}

export function assertKnowledgeHeadingBounds(
  text: string,
  count: number,
  source: string,
  limits: Pick<FoundationKnowledgeStructuralLimits, "maximumHeadings" | "maximumHeadingBytes"> = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
): void {
  if (count > limits.maximumHeadings) {
    throw new FoundationError(
      "lifecycle.knowledge.heading-count",
      `${source} exceeds the maximum heading count of ${limits.maximumHeadings}`,
    );
  }
  if (Buffer.byteLength(text, "utf8") > limits.maximumHeadingBytes) {
    throw new FoundationError(
      "lifecycle.knowledge.heading-size",
      `${source} contains a heading exceeding ${limits.maximumHeadingBytes} bytes`,
    );
  }
}
