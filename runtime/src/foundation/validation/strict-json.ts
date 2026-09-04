import { LifecycleError } from "../../errors.js";

export type StrictJsonOptions = {
  maximumBytes?: number;
  maximumDepth?: number;
  maximumNodes?: number;
  maximumObjectProperties?: number;
  maximumArrayItems?: number;
  source?: string;
};

const DEFAULT_MAXIMUM_DEPTH = 256;
const DEFAULT_MAXIMUM_NODES = 1_000_000;
const DEFAULT_MAXIMUM_OBJECT_PROPERTIES = 100_000;
const DEFAULT_MAXIMUM_ARRAY_ITEMS = 100_000;

function validUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

export function parseStrictJson(text: string, options: StrictJsonOptions = {}): unknown {
  const source = options.source ?? "JSON";
  const maximumBytes = options.maximumBytes ?? 4 * 1024 * 1024;
  const maximumDepth = options.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH;
  const maximumNodes = options.maximumNodes ?? DEFAULT_MAXIMUM_NODES;
  const maximumObjectProperties = options.maximumObjectProperties ?? DEFAULT_MAXIMUM_OBJECT_PROPERTIES;
  const maximumArrayItems = options.maximumArrayItems ?? DEFAULT_MAXIMUM_ARRAY_ITEMS;
  for (const [label, value] of [
    ["maximumBytes", maximumBytes],
    ["maximumDepth", maximumDepth],
    ["maximumNodes", maximumNodes],
    ["maximumObjectProperties", maximumObjectProperties],
    ["maximumArrayItems", maximumArrayItems],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new LifecycleError({
        code: "foundation.json.limit",
        message: `${source} ${label} must be one positive safe integer`,
      });
    }
  }
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new LifecycleError({ code: "foundation.json.size", message: `${source} exceeds ${maximumBytes} bytes` });
  }
  if (text.includes("\0")) throw new LifecycleError({ code: "foundation.json.nul", message: `${source} contains a NUL byte` });

  let index = 0;
  let nodes = 0;
  const length = text.length;

  function fail(message: string): never {
    throw new LifecycleError({
      code: "foundation.json.parse",
      message: `${source}: ${message} at code-unit offset ${index}`,
      observedFacts: { source, offset: index },
    });
  }

  function whitespace(): void {
    while (index < length && /[\u0009\u000a\u000d\u0020]/u.test(text[index]!)) index += 1;
  }

  function stringValue(): string {
    if (text[index] !== '"') fail("expected a JSON string");
    const start = index;
    index += 1;
    while (index < length) {
      const unit = text.charCodeAt(index);
      if (unit === 0x22) {
        index += 1;
        const encoded = text.slice(start, index);
        let parsed: string;
        try {
          parsed = JSON.parse(encoded) as string;
        } catch {
          fail("malformed JSON string");
        }
        if (!validUnicodeScalars(parsed)) fail("JSON string contains an unpaired surrogate");
        return parsed;
      }
      if (unit === 0x5c) {
        index += 1;
        if (index >= length) fail("truncated JSON escape");
        if (text[index] === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(text.slice(index + 1, index + 5))) fail("malformed Unicode escape");
          index += 5;
          continue;
        }
        if (!/["\\/bfnrt]/u.test(text[index]!)) fail("unsupported JSON escape");
        index += 1;
        continue;
      }
      if (unit <= 0x1f) fail("unescaped control character in JSON string");
      index += 1;
    }
    fail("unterminated JSON string");
  }

  function numberValue(): number {
    const match = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (!match) fail("malformed JSON number");
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON number is outside the finite IEEE-754 domain");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail("JSON integer exceeds the safe interoperable range");
    return value;
  }

  function literal(token: "true" | "false" | "null", value: boolean | null): boolean | null {
    if (!text.startsWith(token, index)) fail(`expected ${token}`);
    index += token.length;
    return value;
  }

  function arrayValue(depth: number): unknown[] {
    index += 1;
    whitespace();
    const result: unknown[] = [];
    if (text[index] === "]") {
      index += 1;
      return result;
    }
    while (index < length) {
      if (result.length >= maximumArrayItems) {
        fail(`JSON array exceeds ${maximumArrayItems} items`);
      }
      result.push(value(depth + 1));
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      if (text[index] !== ",") fail("expected comma or array end");
      index += 1;
      whitespace();
    }
    fail("unterminated JSON array");
  }

  function objectValue(depth: number): Record<string, unknown> {
    index += 1;
    whitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (text[index] === "}") {
      index += 1;
      return result;
    }
    while (index < length) {
      if (keys.size >= maximumObjectProperties) {
        fail(`JSON object exceeds ${maximumObjectProperties} properties`);
      }
      const key = stringValue();
      if (keys.has(key)) fail(`duplicate JSON object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[index] !== ":") fail("expected colon after object key");
      index += 1;
      whitespace();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value(depth + 1),
      });
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      if (text[index] !== ",") fail("expected comma or object end");
      index += 1;
      whitespace();
    }
    fail("unterminated JSON object");
  }

  function value(depth: number): unknown {
    whitespace();
    nodes += 1;
    if (nodes > maximumNodes) fail(`JSON value exceeds ${maximumNodes} nodes`);
    if (depth > maximumDepth) fail(`JSON value exceeds depth ${maximumDepth}`);
    const token = text[index];
    if (token === "{") return objectValue(depth);
    if (token === "[") return arrayValue(depth);
    if (token === '"') return stringValue();
    if (token === "t") return literal("true", true);
    if (token === "f") return literal("false", false);
    if (token === "n") return literal("null", null);
    return numberValue();
  }

  const parsed = value(1);
  whitespace();
  if (index !== length) fail("trailing JSON content");
  return parsed;
}
