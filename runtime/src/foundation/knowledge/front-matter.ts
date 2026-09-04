import { Parser } from "commonmark";
import { FoundationError } from "../error.js";
import { sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { parseStrictJson } from "../validation/strict-json.js";
import type { FoundationKnowledgeLimits } from "../repository/types.js";
import {
  FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
  assertKnowledgeBodyBounds,
  assertKnowledgeHeadingBounds,
  assertKnowledgeJsonTextBounds,
  decodeKnowledgeUtf8,
  prepareKnowledgeJson,
} from "./structural.js";
import type { FoundationMarkdownHeading } from "./types.js";

export const KNOWLEDGE_MAXIMUM_FILE_BYTES = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumFileBytes;
export const KNOWLEDGE_MAXIMUM_FRONT_MATTER_BYTES = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumFrontMatterBytes;

export type ParsedKnowledgeDocument = Readonly<{
  sourceText: string;
  frontMatterValue: unknown;
  body: string;
  bodyNormalized: string;
  headings: readonly FoundationMarkdownHeading[];
  sourceDigest: Sha256;
}>;

type Line = Readonly<{
  content: string;
  start: number;
  contentEnd: number;
  end: number;
  line: number;
}>;

function lines(text: string): readonly Line[] {
  const result: Line[] = [];
  let start = 0;
  let number = 1;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    if (newline < 0) {
      const raw = text.slice(start);
      const contentEnd = raw.endsWith("\r") ? text.length - 1 : text.length;
      result.push({ content: text.slice(start, contentEnd), start, contentEnd, end: text.length, line: number });
      break;
    }
    const contentEnd = newline > start && text[newline - 1] === "\r" ? newline - 1 : newline;
    result.push({ content: text.slice(start, contentEnd), start, contentEnd, end: newline + 1, line: number });
    start = newline + 1;
    number += 1;
  }
  if (text.length === 0) return [];
  return result;
}

export function parseMarkdownHeadings(
  body: string,
  source = "Knowledge Markdown body",
  limits: FoundationKnowledgeLimits | typeof FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
): readonly FoundationMarkdownHeading[] {
  for (let index = body.indexOf("\r"); index >= 0; index = body.indexOf("\r", index + 1)) {
    if (body[index + 1] !== "\n") {
      throw new FoundationError("lifecycle.knowledge.line-ending", `${source} uses a line ending other than LF or CRLF`);
    }
  }
  const normalized = body.replace(/\r\n/gu, "\n");
  assertKnowledgeBodyBounds(normalized, source, limits.maximumBodyLines);
  const result: FoundationMarkdownHeading[] = [];
  let headingCount = 0;
  let active: { level: number; line: number; text: string } | null = null;
  const document = new Parser({ smart: false, time: false }).parse(normalized);
  const walker = document.walker();
  for (let step = walker.next(); step !== null; step = walker.next()) {
    if (step.node.type === "heading") {
      if (step.entering) {
        headingCount += 1;
        assertKnowledgeHeadingBounds("", headingCount, source, limits);
        if (step.node.parent?.type === "document") {
          active = { level: step.node.level, line: step.node.sourcepos[0][0], text: "" };
        }
      } else if (active !== null) {
        const text = active.text.trim();
        assertKnowledgeHeadingBounds(text, headingCount, source, limits);
        if (active.level === 1 || active.level === 2) {
          result.push({ level: active.level, text, line: active.line });
        }
        active = null;
      }
      continue;
    }
    if (active === null || !step.entering) continue;
    if (step.node.type === "text" || step.node.type === "code") {
      active.text += step.node.literal ?? "";
    } else if (step.node.type === "softbreak" || step.node.type === "linebreak") {
      active.text += "\n";
    }
  }
  return Object.freeze(result);
}

export function parseKnowledgeDocument(
  path: string,
  bytes: Buffer,
  limits: FoundationKnowledgeLimits | typeof FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
): ParsedKnowledgeDocument {
  const sourceText = decodeKnowledgeUtf8(bytes, path, limits.maximumFileBytes);
  const sourceLines = lines(sourceText);
  if (sourceLines.length < 3 || sourceLines[0]!.content !== "---" || sourceLines[0]!.end === sourceLines[0]!.contentEnd) {
    throw new FoundationError("lifecycle.knowledge.front-matter", `${path} must begin with an exact --- delimiter line`);
  }

  const closingIndex = sourceLines.findIndex((line, index) => index > 0 && line.content === "---");
  if (closingIndex < 0) throw new FoundationError("lifecycle.knowledge.front-matter", `${path} is missing its closing --- delimiter line`);
  const closing = sourceLines[closingIndex]!;
  if (closing.end === closing.contentEnd) {
    throw new FoundationError("lifecycle.knowledge.front-matter", `${path} closing delimiter must be followed by a line ending and Markdown body`);
  }

  const frontMatterText = sourceText.slice(sourceLines[0]!.end, closing.start);
  if (Buffer.byteLength(frontMatterText, "utf8") > limits.maximumFrontMatterBytes) {
    throw new FoundationError("lifecycle.knowledge.front-matter-size", `${path} front matter exceeds ${limits.maximumFrontMatterBytes} bytes`);
  }
  assertKnowledgeJsonTextBounds(frontMatterText, `${path} front matter`, limits.maximumJsonDepth);
  const parsedFrontMatter = parseStrictJson(frontMatterText, {
    source: `${path} front matter`,
    maximumBytes: limits.maximumFrontMatterBytes,
  });
  const frontMatterValue = prepareKnowledgeJson(parsedFrontMatter, frontMatterText, `${path} front matter`, limits);
  if (frontMatterValue === null || typeof frontMatterValue !== "object" || Array.isArray(frontMatterValue)) {
    throw new FoundationError("lifecycle.knowledge.front-matter-object", `${path} front matter must contain exactly one JSON object`);
  }

  const body = sourceText.slice(closing.end);
  if (body.length === 0 || body.trim().length === 0) {
    throw new FoundationError("lifecycle.knowledge.body-empty", `${path} must contain a nonempty Markdown body`);
  }
  const bodyNormalized = body.replace(/\r\n/gu, "\n");
  assertKnowledgeBodyBounds(bodyNormalized, `${path} body`, limits.maximumBodyLines);
  return Object.freeze({
    sourceText,
    frontMatterValue,
    body,
    bodyNormalized,
    headings: parseMarkdownHeadings(bodyNormalized, `${path} body`, limits),
    sourceDigest: sha256Bytes(bytes),
  });
}
