export const TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS = 8_192;
export const TUI_FRAME_DRAFT_MAXIMUM_BYTES = 64 * 1_024;
export const TUI_FRAME_EXCERPT_MAXIMUM_BYTES = 4 * 1_024;
export const TUI_FRAME_EXCERPT_MAXIMUM_LINES = 32;

const encoder = new TextEncoder();
const REPLACEMENT = "\uFFFD";

function forbidden(codePoint: number, allowLf: boolean): boolean {
  if (codePoint === 0x0a) return !allowLf;
  return codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff);
}

function codeUnitBound(value: string, maximum: number): Readonly<{ value: string; complete: boolean }> {
  if (value.length <= maximum) return Object.freeze({ value, complete: true });
  let end = maximum;
  const final = value.charCodeAt(end - 1);
  if (end > 0 && final >= 0xd800 && final <= 0xdbff) end -= 1;
  return Object.freeze({ value: value.slice(0, end), complete: false });
}

function safe(value: string, allowLf: boolean, maximumCodeUnits: number): Readonly<{ value: string; complete: boolean }> {
  const bounded = codeUnitBound(value, maximumCodeUnits);
  let output = "";
  let complete = bounded.complete;
  for (const scalar of bounded.value) {
    const point = scalar.codePointAt(0)!;
    if (forbidden(point, allowLf)) {
      output += REPLACEMENT;
      complete = false;
    } else {
      output += scalar;
    }
  }
  return Object.freeze({ value: output, complete });
}

/** One bounded line safe for OpenTUI TextRenderable or process diagnostics. */
export function tuiSafeLine(
  value: string,
  maximumCodeUnits = TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS,
): string {
  const selected = safe(value, false, maximumCodeUnits);
  return `${selected.value}${selected.complete ? "" : " … [display bounded]"}`;
}

/** Bounded LF-preserving plain text. No ANSI, OSC, C0, C1, or bidi control survives. */
export function tuiSafeText(
  value: string,
  maximumCodeUnits = TUI_PRESENTATION_SOURCE_MAX_CODE_UNITS,
): Readonly<{ value: string; complete: boolean }> {
  return safe(value, true, maximumCodeUnits);
}

export function tuiSafeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("A terminal JSON value must be serializable");
  return tuiSafeLine(serialized);
}

/** Preserve only the exact semantic-input character set and 64 KiB UTF-8 bound. */
export function normalizeFrameDraft(
  value: string,
  maximumBytes = TUI_FRAME_DRAFT_MAXIMUM_BYTES,
): Readonly<{
  value: string;
  changed: boolean;
  byteLimited: boolean;
}> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > TUI_FRAME_DRAFT_MAXIMUM_BYTES) {
    throw new RangeError(`Frame draft normalization bound must be an integer from 0 through ${TUI_FRAME_DRAFT_MAXIMUM_BYTES}`);
  }
  let output = "";
  let bytes = 0;
  let changed = false;
  let byteLimited = false;
  for (const scalar of value) {
    const point = scalar.codePointAt(0)!;
    if (forbidden(point, true)) {
      changed = true;
      continue;
    }
    const size = encoder.encode(scalar).byteLength;
    if (bytes + size > maximumBytes) {
      changed = true;
      byteLimited = true;
      break;
    }
    output += scalar;
    bytes += size;
  }
  return Object.freeze({ value: output, changed, byteLimited });
}

/** A separately bounded, plain-text Frame region with an exact completeness signal. */
export function frameDisplayExcerpt(value: string): Readonly<{
  value: string;
  complete: boolean;
}> {
  const lines = value.split("\n");
  const lineLimited = lines.length > TUI_FRAME_EXCERPT_MAXIMUM_LINES;
  const selectedLines = lines.slice(0, TUI_FRAME_EXCERPT_MAXIMUM_LINES);
  let output = "";
  let bytes = 0;
  let byteLimited = false;
  let unsafe = false;
  outer: for (let lineIndex = 0; lineIndex < selectedLines.length; lineIndex += 1) {
    if (lineIndex > 0) {
      if (bytes + 1 > TUI_FRAME_EXCERPT_MAXIMUM_BYTES) {
        byteLimited = true;
        break;
      }
      output += "\n";
      bytes += 1;
    }
    for (const scalar of selectedLines[lineIndex]!) {
      const point = scalar.codePointAt(0)!;
      const rendered = forbidden(point, false) ? REPLACEMENT : scalar;
      unsafe ||= rendered !== scalar;
      const size = encoder.encode(rendered).byteLength;
      if (bytes + size > TUI_FRAME_EXCERPT_MAXIMUM_BYTES) {
        byteLimited = true;
        break outer;
      }
      output += rendered;
      bytes += size;
    }
  }
  return Object.freeze({
    value: output.length === 0 ? "(empty excerpt)" : output,
    complete: !lineLimited && !byteLimited && !unsafe,
  });
}

export function hasTuiUnsafeText(value: string): boolean {
  for (const scalar of value) {
    if (forbidden(scalar.codePointAt(0)!, false)) return true;
  }
  return false;
}
