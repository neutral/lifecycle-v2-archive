import { TextDecoder } from "node:util";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { parseStrictJson } from "../validation/strict-json.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA_ID,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_TREE_MODES,
  type FoundationCandidateRevisionCarrierArtifactV1,
  type FoundationCandidateRevisionCarrierLimitsV1,
  type FoundationCandidateRevisionCarrierManifestV1,
  type FoundationCandidateRevisionCarrierObjectV1,
} from "./carrier-types.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function invalid(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.candidate.carrier-invalid", message, {
    observedFacts,
  });
}

function objectIdPattern(objectFormat: "sha1" | "sha256"): RegExp {
  return objectFormat === "sha1" ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u;
}

function assertSafeBoundedInteger(
  value: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalid(`${label} is outside its exact safe-integer bound`, {
      maximum,
      value,
    });
  }
}

function exactInventory(
  objectFormat: "sha1" | "sha256",
  input: readonly FoundationCandidateRevisionCarrierObjectV1[],
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): readonly FoundationCandidateRevisionCarrierObjectV1[] {
  if (input.length < 1 || input.length > limits.maximumObjects) {
    invalid("Candidate Revision Carrier object inventory is outside its object-count bound", {
      maximumObjects: limits.maximumObjects,
      objectCount: input.length,
    });
  }
  const pattern = objectIdPattern(objectFormat);
  let prior: string | null = null;
  let aggregate = 0;
  const inventory = input.map((descriptor) => {
    if (!pattern.test(descriptor.objectId)) {
      invalid("Candidate Revision Carrier object identity does not match its Git object format", {
        objectFormat,
        objectId: descriptor.objectId,
      });
    }
    if (descriptor.objectType !== "blob" && descriptor.objectType !== "tree") {
      invalid("Candidate Revision Carrier inventory contains an unsupported object type", {
        objectId: descriptor.objectId,
        objectType: descriptor.objectType,
      });
    }
    assertSafeBoundedInteger(
      descriptor.byteLength,
      limits.maximumAggregateObjectBytes,
      `Candidate Revision Carrier object ${descriptor.objectId} byte length`,
    );
    if (descriptor.objectType === "tree" && descriptor.byteLength === 0) {
      invalid("Candidate Revision Carrier inventory contains an empty tree object", {
        objectId: descriptor.objectId,
      });
    }
    if (prior !== null && prior >= descriptor.objectId) {
      invalid("Candidate Revision Carrier object inventory is not strictly object-identity ordered", {
        prior,
        current: descriptor.objectId,
      });
    }
    prior = descriptor.objectId;
    aggregate += descriptor.byteLength;
    if (!Number.isSafeInteger(aggregate) || aggregate > limits.maximumAggregateObjectBytes) {
      invalid("Candidate Revision Carrier aggregate object bytes exceed their bound", {
        maximumAggregateObjectBytes: limits.maximumAggregateObjectBytes,
      });
    }
    return Object.freeze({
      objectId: descriptor.objectId,
      objectType: descriptor.objectType,
      byteLength: descriptor.byteLength,
    });
  });
  return Object.freeze(inventory);
}

function semanticManifest(
  value: FoundationCandidateRevisionCarrierManifestV1,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): FoundationCandidateRevisionCarrierManifestV1 {
  const pattern = objectIdPattern(value.objectFormat);
  if (!pattern.test(value.rootTree)) {
    invalid("Candidate Revision Carrier root tree does not match its Git object format", {
      objectFormat: value.objectFormat,
      rootTree: value.rootTree,
    });
  }
  const inventory = exactInventory(value.objectFormat, value.objectInventory, limits);
  if (value.objectCount !== inventory.length) {
    invalid("Candidate Revision Carrier object count does not match its inventory", {
      declared: value.objectCount,
      observed: inventory.length,
    });
  }
  const aggregateObjectBytes = inventory.reduce((sum, descriptor) => {
    const next = sum + descriptor.byteLength;
    if (!Number.isSafeInteger(next)) invalid("Candidate Revision Carrier aggregate object bytes are unsafe");
    return next;
  }, 0);
  if (value.aggregateObjectBytes !== aggregateObjectBytes) {
    invalid("Candidate Revision Carrier aggregate object bytes do not match its inventory", {
      declared: value.aggregateObjectBytes,
      observed: aggregateObjectBytes,
    });
  }
  const objectInventoryDigest = digestCanonical(inventory);
  if (value.objectInventoryDigest !== objectInventoryDigest) {
    invalid("Candidate Revision Carrier object-inventory digest does not match its inventory", {
      declared: value.objectInventoryDigest,
      observed: objectInventoryDigest,
    });
  }
  const root = inventory.find(({ objectId }) => objectId === value.rootTree);
  if (root?.objectType !== "tree") {
    invalid("Candidate Revision Carrier root tree is absent or not a tree object", {
      rootTree: value.rootTree,
    });
  }
  assertSafeBoundedInteger(
    value.carrierArtifact.byteLength,
    limits.maximumCarrierArtifactBytes,
    "Candidate Revision Carrier artifact byte length",
  );
  if (value.carrierArtifact.byteLength < 1) {
    invalid("Candidate Revision Carrier artifact must contain bytes");
  }
  if (!SHA256_PATTERN.test(value.carrierArtifact.digest)) {
    invalid("Candidate Revision Carrier artifact digest is not one lowercase SHA-256 digest");
  }
  if (value.digest !== selfDigest(value as unknown as Record<string, unknown>)) {
    invalid("Candidate Revision Carrier manifest self-digest does not match its logical value");
  }
  return Object.freeze({
    schema: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA,
    objectFormat: value.objectFormat,
    rootTree: value.rootTree,
    allowedTreeModes: FOUNDATION_CANDIDATE_REVISION_CARRIER_TREE_MODES,
    objectInventory: inventory,
    objectCount: inventory.length,
    aggregateObjectBytes,
    objectInventoryDigest,
    carrierArtifact: Object.freeze({
      format: FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT,
      byteLength: value.carrierArtifact.byteLength,
      digest: value.carrierArtifact.digest,
    }),
    digest: value.digest,
  });
}

export function compileCandidateRevisionCarrierManifest(input: Readonly<{
  objectFormat: "sha1" | "sha256";
  rootTree: string;
  objectInventory: readonly FoundationCandidateRevisionCarrierObjectV1[];
  carrierArtifact: FoundationCandidateRevisionCarrierArtifactV1;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
}>): Readonly<{
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  manifestBytes: Uint8Array;
}> {
  const inventory = exactInventory(input.objectFormat, input.objectInventory, input.limits);
  const subject = {
    schema: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA,
    objectFormat: input.objectFormat,
    rootTree: input.rootTree,
    allowedTreeModes: FOUNDATION_CANDIDATE_REVISION_CARRIER_TREE_MODES,
    objectInventory: inventory,
    objectCount: inventory.length,
    aggregateObjectBytes: inventory.reduce((sum, descriptor) => sum + descriptor.byteLength, 0),
    objectInventoryDigest: digestCanonical(inventory),
    carrierArtifact: Object.freeze({
      format: FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT,
      byteLength: input.carrierArtifact.byteLength,
      digest: input.carrierArtifact.digest,
    }),
  } as const;
  const manifest = semanticManifest(Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }), input.limits);
  assertFoundationSchema(
    FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA_ID,
    manifest,
    "Candidate Revision Carrier manifest",
  );
  return Object.freeze({
    manifest,
    manifestBytes: Buffer.from(canonicalJson(manifest), "utf8"),
  });
}

export function parseCandidateRevisionCarrierManifest(
  bytes: Uint8Array,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): FoundationCandidateRevisionCarrierManifestV1 {
  if (bytes.byteLength < 1 || bytes.byteLength > limits.maximumManifestBytes) {
    invalid("Candidate Revision Carrier manifest is outside its byte bound", {
      byteLength: bytes.byteLength,
      maximumManifestBytes: limits.maximumManifestBytes,
    });
  }
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    invalid("Candidate Revision Carrier manifest is not exact UTF-8", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const value = parseStrictJson(text, {
      maximumBytes: limits.maximumManifestBytes,
      maximumDepth: 16,
      maximumNodes: limits.maximumObjects * 4 + 64,
      maximumObjectProperties: 32,
      maximumArrayItems: limits.maximumObjects,
      source: "Candidate Revision Carrier manifest",
    });
    assertFoundationSchema(
      FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA_ID,
      value,
      "Candidate Revision Carrier manifest",
    );
    if (canonicalJson(value) !== text) {
      invalid("Candidate Revision Carrier manifest bytes are not canonical JSON");
    }
    return semanticManifest(value as FoundationCandidateRevisionCarrierManifestV1, limits);
  } catch (error) {
    if (error instanceof FoundationError && error.code === "lifecycle.candidate.carrier-invalid") {
      throw error;
    }
    invalid("Candidate Revision Carrier manifest is invalid", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function candidateRevisionCarrierInventoryDigest(
  inventory: readonly FoundationCandidateRevisionCarrierObjectV1[],
): Sha256 {
  return digestCanonical(inventory);
}
