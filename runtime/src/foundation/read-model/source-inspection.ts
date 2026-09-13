import {
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  FoundationSourceReferenceSchema,
  FoundationSourceResultSchema,
  foundationContextSelectionOf,
  type FoundationContextBasis,
  type FoundationSourceReference,
  type FoundationSourceResult,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import { canonicalJson, selfDigest, sha256Bytes } from "../validation/canonical.js";

const UTF8_ENCODER = new TextEncoder();
// Preserve a leading BOM as source content; inspection binds exact bytes.
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(code: string, message: string, observedFacts: unknown = {}): never {
  throw new FoundationError(`lifecycle.context-inspection.source-${code}`, message, {
    observedFacts,
  });
}

function exactUtf8Bytes(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? UTF8_ENCODER.encode(value) : value;
  if (bytes.byteLength > FOUNDATION_SOURCE_MAXIMUM_BYTES) {
    fail("oversized", "Inspection source exceeds the public source byte ceiling", {
      byteLength: bytes.byteLength,
      maximumBytes: FOUNDATION_SOURCE_MAXIMUM_BYTES,
    });
  }
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    const reencoded = UTF8_ENCODER.encode(decoded);
    if (
      reencoded.byteLength !== bytes.byteLength ||
      reencoded.some((byte, index) => byte !== bytes[index])
    ) {
      fail("text-invalid", "Inspection source does not round-trip as exact UTF-8 text");
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("text-invalid", "Inspection source must be exact UTF-8 text");
  }
  return bytes;
}

/** Construct one self-digested reference to exact bytes under a retained inspection selection. */
export function compileFoundationSourceReference(input: Readonly<{
  basis: FoundationContextBasis;
  selection?: FoundationSourceReference["selection"];
  sourceKind: FoundationSourceReference["sourceKind"];
  subject: FoundationSourceReference["subject"];
  label: string;
  path: string;
  mediaType: FoundationSourceReference["mediaType"];
  content: string | Uint8Array;
}>): FoundationSourceReference {
  const bytes = exactUtf8Bytes(input.content);
  const subject = Object.freeze({
    schema: "lifecycle.source-reference.v2" as const,
    selection: input.selection ?? input.basis.selection,
    basisDigest: input.basis.digest,
    sourceKind: input.sourceKind,
    subject: input.subject,
    label: input.label,
    path: input.path,
    mediaType: input.mediaType,
    contentDigest: sha256Bytes(bytes),
    byteLength: bytes.byteLength,
  });
  return FoundationSourceReferenceSchema.parse(Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }));
}

/** Page exact source bytes without ever splitting one UTF-8 scalar encoding. */
export function compileFoundationSourceRange(input: Readonly<{
  basis: FoundationContextBasis;
  selector: Readonly<{
    reference: FoundationSourceReference;
    startByte: number;
    maximumBytes: number;
  }>;
  content: string | Uint8Array;
}>): FoundationSourceResult {
  const reference = FoundationSourceReferenceSchema.parse(input.selector.reference);
  if (
    canonicalJson(foundationContextSelectionOf(reference.selection)) !== canonicalJson(input.basis.selection) ||
    reference.basisDigest !== input.basis.digest
  ) {
    fail("basis-substituted", "Source selection does not bind the exact retained inspection and Context basis", {
      referenceBasis: reference.basisDigest,
      actualBasis: input.basis.digest,
    });
  }

  const bytes = exactUtf8Bytes(input.content);
  if (
    bytes.byteLength !== reference.byteLength ||
    sha256Bytes(bytes) !== reference.contentDigest
  ) {
    fail("content-substituted", "Resolved source bytes do not reproduce the selected Source Reference", {
      expectedByteLength: reference.byteLength,
      actualByteLength: bytes.byteLength,
      expectedDigest: reference.contentDigest,
      actualDigest: sha256Bytes(bytes),
    });
  }
  if (input.selector.startByte > bytes.byteLength) {
    fail("range-invalid", "Source range begins after the exact source bytes", {
      startByte: input.selector.startByte,
      byteLength: bytes.byteLength,
    });
  }

  const startByte = input.selector.startByte;
  let endByte = Math.min(bytes.byteLength, startByte + input.selector.maximumBytes);
  let content: string | null = null;
  while (endByte >= startByte) {
    try {
      content = UTF8_DECODER.decode(bytes.subarray(startByte, endByte));
      break;
    } catch {
      endByte -= 1;
    }
  }
  if (content === null || (endByte === startByte && startByte < bytes.byteLength)) {
    fail("range-invalid", "Source range does not begin at a UTF-8 scalar boundary", {
      startByte,
      maximumBytes: input.selector.maximumBytes,
    });
  }
  const returned = bytes.subarray(startByte, endByte);
  return FoundationSourceResultSchema.parse(Object.freeze({
    schema: "lifecycle.source-range.v1",
    kind: "source",
    basis: input.basis,
    reference,
    startByte,
    endByte,
    nextByte: endByte < bytes.byteLength ? endByte : null,
    byteLength: returned.byteLength,
    digest: sha256Bytes(returned),
    content,
  }));
}

/** Compare two public reference carriers without trusting object identity. */
export function sameFoundationSourceReference(
  left: FoundationSourceReference,
  right: FoundationSourceReference,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
