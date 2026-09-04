import { FoundationProtocolError } from "./protocol-error.js";

export type FoundationStrictJsonLimits = Readonly<{
  maximumBytes?: number;
  maximumDepth?: number;
  maximumNodes?: number;
  maximumStringCodeUnits?: number;
  maximumArrayItems?: number;
  maximumObjectProperties?: number;
  source?: string;
}>;

const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 16 * 1024 * 1024,
  maximumDepth: 64,
  maximumNodes: 250_000,
  maximumStringCodeUnits: 1024 * 1024,
  maximumArrayItems: 100_000,
  maximumObjectProperties: 100_000,
});

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new FoundationProtocolError("lifecycle.interface.json-limit", `${label} must be one positive safe integer`);
  }
  return selected;
}

function decodeInput(input: string | Uint8Array, maximumBytes: number, source: string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > maximumBytes) {
    throw new FoundationProtocolError(
      "lifecycle.interface.json-size",
      `${source} exceeds the ${maximumBytes}-byte public JSON bound`,
    );
  }
  if (typeof input === "string") return input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new FoundationProtocolError("lifecycle.interface.json-utf8", `${source} is not well-formed UTF-8`);
  }
}

class StrictJsonParser {
  readonly #source: string;
  readonly #label: string;
  readonly #maximumDepth: number;
  readonly #maximumNodes: number;
  readonly #maximumStringCodeUnits: number;
  readonly #maximumArrayItems: number;
  readonly #maximumObjectProperties: number;
  #index = 0;
  #nodes = 0;

  constructor(source: string, label: string, limits: Required<Omit<FoundationStrictJsonLimits, "maximumBytes" | "source">>) {
    this.#source = source;
    this.#label = label;
    this.#maximumDepth = limits.maximumDepth;
    this.#maximumNodes = limits.maximumNodes;
    this.#maximumStringCodeUnits = limits.maximumStringCodeUnits;
    this.#maximumArrayItems = limits.maximumArrayItems;
    this.#maximumObjectProperties = limits.maximumObjectProperties;
  }

  parse(): unknown {
    this.#whitespace();
    const value = this.#value(0);
    this.#whitespace();
    if (this.#index !== this.#source.length) this.#syntax("contains trailing data");
    return value;
  }

  #fail(code: string, detail: string): never {
    throw new FoundationProtocolError(code, `${this.#label} ${detail} at UTF-16 offset ${this.#index}`);
  }

  #syntax(detail: string): never {
    return this.#fail("lifecycle.interface.json-syntax", detail);
  }

  #node(): void {
    this.#nodes += 1;
    if (this.#nodes > this.#maximumNodes) {
      this.#fail("lifecycle.interface.json-nodes", "exceeds the JSON node bound");
    }
  }

  #whitespace(): void {
    while (this.#index < this.#source.length) {
      const value = this.#source.charCodeAt(this.#index);
      if (value !== 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) return;
      this.#index += 1;
    }
  }

  #value(depth: number): unknown {
    if (depth > this.#maximumDepth) this.#fail("lifecycle.interface.json-depth", "exceeds the JSON nesting bound");
    this.#node();
    const current = this.#source[this.#index];
    if (current === "{") return this.#object(depth + 1);
    if (current === "[") return this.#array(depth + 1);
    if (current === "\"") return this.#string();
    if (current === "t") return this.#literal("true", true);
    if (current === "f") return this.#literal("false", false);
    if (current === "n") return this.#literal("null", null);
    if (current === "-" || (current !== undefined && current >= "0" && current <= "9")) return this.#number();
    return this.#syntax("does not contain a JSON value");
  }

  #literal<T>(token: string, value: T): T {
    if (this.#source.slice(this.#index, this.#index + token.length) !== token) this.#syntax("contains an invalid literal");
    this.#index += token.length;
    return value;
  }

  #number(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(this.#source.slice(this.#index));
    if (match === null) return this.#syntax("contains an invalid number");
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      this.#fail("lifecycle.interface.json-number", "contains a number outside Lifecycle's interoperable JSON domain");
    }
    return value;
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#source.length) {
      const unit = this.#source.charCodeAt(this.#index);
      if (unit === 0x22) {
        this.#index += 1;
        let parsed: string;
        try {
          parsed = JSON.parse(this.#source.slice(start, this.#index)) as string;
        } catch {
          return this.#syntax("contains a malformed string");
        }
        if (parsed.length > this.#maximumStringCodeUnits) {
          this.#fail("lifecycle.interface.json-string", "contains a string larger than the public bound");
        }
        for (let index = 0; index < parsed.length; index += 1) {
          const value = parsed.charCodeAt(index);
          if (value >= 0xd800 && value <= 0xdbff) {
            const next = parsed.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) this.#fail("lifecycle.interface.json-unicode", "contains an unpaired surrogate");
            index += 1;
          } else if (value >= 0xdc00 && value <= 0xdfff) {
            this.#fail("lifecycle.interface.json-unicode", "contains an unpaired surrogate");
          }
        }
        return parsed;
      }
      if (unit < 0x20) this.#syntax("contains an unescaped control character");
      if (unit === 0x5c) {
        this.#index += 1;
        const escaped = this.#source[this.#index];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(this.#source.slice(this.#index + 1, this.#index + 5))) {
            this.#syntax("contains an invalid Unicode escape");
          }
          this.#index += 5;
          continue;
        }
        if (escaped === undefined || !/["\\/bfnrt]/u.test(escaped)) this.#syntax("contains an invalid escape");
      }
      this.#index += 1;
    }
    return this.#syntax("contains an unterminated string");
  }

  #array(depth: number): unknown[] {
    this.#index += 1;
    this.#whitespace();
    const output: unknown[] = [];
    if (this.#source[this.#index] === "]") {
      this.#index += 1;
      return output;
    }
    while (this.#index < this.#source.length) {
      if (output.length >= this.#maximumArrayItems) this.#fail("lifecycle.interface.json-array", "exceeds the array-item bound");
      output.push(this.#value(depth));
      this.#whitespace();
      if (this.#source[this.#index] === "]") {
        this.#index += 1;
        return output;
      }
      if (this.#source[this.#index] !== ",") this.#syntax("requires a comma or array end");
      this.#index += 1;
      this.#whitespace();
    }
    return this.#syntax("contains an unterminated array");
  }

  #object(depth: number): Record<string, unknown> {
    this.#index += 1;
    this.#whitespace();
    const output: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.#source[this.#index] === "}") {
      this.#index += 1;
      return output;
    }
    while (this.#index < this.#source.length) {
      if (keys.size >= this.#maximumObjectProperties) this.#fail("lifecycle.interface.json-object", "exceeds the object-property bound");
      if (this.#source[this.#index] !== "\"") this.#syntax("requires a string object key");
      const key = this.#string();
      if (keys.has(key)) this.#fail("lifecycle.interface.json-duplicate", `contains duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.#whitespace();
      if (this.#source[this.#index] !== ":") this.#syntax("requires a colon after an object key");
      this.#index += 1;
      this.#whitespace();
      const value = this.#value(depth);
      Object.defineProperty(output, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.#whitespace();
      if (this.#source[this.#index] === "}") {
        this.#index += 1;
        return output;
      }
      if (this.#source[this.#index] !== ",") this.#syntax("requires a comma or object end");
      this.#index += 1;
      this.#whitespace();
    }
    return this.#syntax("contains an unterminated object");
  }
}

/** Parse one bounded RFC 8259 JSON value without duplicate keys, repair, or
 * trailing content. */
export function parseFoundationStrictJson(
  input: string | Uint8Array,
  limits: FoundationStrictJsonLimits = {},
): unknown {
  const maximumBytes = positiveLimit(limits.maximumBytes, DEFAULT_LIMITS.maximumBytes, "maximumBytes");
  const source = limits.source ?? "Foundation public JSON";
  const text = decodeInput(input, maximumBytes, source);
  return new StrictJsonParser(text, source, {
    maximumDepth: positiveLimit(limits.maximumDepth, DEFAULT_LIMITS.maximumDepth, "maximumDepth"),
    maximumNodes: positiveLimit(limits.maximumNodes, DEFAULT_LIMITS.maximumNodes, "maximumNodes"),
    maximumStringCodeUnits: positiveLimit(
      limits.maximumStringCodeUnits,
      DEFAULT_LIMITS.maximumStringCodeUnits,
      "maximumStringCodeUnits",
    ),
    maximumArrayItems: positiveLimit(limits.maximumArrayItems, DEFAULT_LIMITS.maximumArrayItems, "maximumArrayItems"),
    maximumObjectProperties: positiveLimit(
      limits.maximumObjectProperties,
      DEFAULT_LIMITS.maximumObjectProperties,
      "maximumObjectProperties",
    ),
  }).parse();
}
