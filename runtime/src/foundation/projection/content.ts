import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import type {
  FoundationProjectionByteInventoryEntry,
  FoundationProjectionContentLocator,
  FoundationProjectionMandatoryItem,
} from "./types.js";

function mountPath(tier: "mandatory" | "reachable", key: string, digest: Sha256): string {
  const keyDigest = sha256Bytes(key).slice("sha256:".length, "sha256:".length + 16);
  const layoutSegment = tier === "mandatory" ? "material" : "reachable";
  return `projection/${layoutSegment}/${keyDigest}-${digest.slice("sha256:".length)}.bin`;
}

export class ProjectionByteInventoryBuilder {
  private readonly values = new Map<string, FoundationProjectionByteInventoryEntry>();

  add(options: {
    tier: "mandatory" | "reachable";
    key: string;
    bytes: Uint8Array;
    mediaType?: string;
    encoding?: "utf-8" | "binary";
    declaredDigest?: Sha256;
  }): Readonly<{ content: FoundationProjectionContentLocator; digest: Sha256; byteLength: number; path: string }> {
    const copied = Buffer.from(options.bytes);
    const digest = sha256Bytes(copied);
    if (options.declaredDigest !== undefined && options.declaredDigest !== digest) {
      throw new FoundationError("lifecycle.projection.content-digest", `Projection content for ${options.key} differs from its declared digest`, {
        observedFacts: { actual: digest, expected: options.declaredDigest, key: options.key },
      });
    }
    const mapKey = `${options.tier}\0${options.key}`;
    if (this.values.has(mapKey)) {
      throw new FoundationError("lifecycle.projection.order-invalid", `Projection content key is duplicated: ${options.key}`);
    }
    const path = mountPath(options.tier, options.key, digest);
    this.values.set(mapKey, Object.freeze({
      tier: options.tier,
      key: options.key,
      path,
      digest,
      byteLength: copied.byteLength,
      encoding: "base64",
      bytes: copied.toString("base64"),
    }));
    return Object.freeze({
      content: Object.freeze({
        mode: "mounted",
        mediaType: options.mediaType ?? "application/octet-stream",
        encoding: options.encoding ?? "binary",
        path,
        byteLength: copied.byteLength,
        digest,
        scope: "projection-bundle",
        readOnly: true,
      }),
      digest,
      byteLength: copied.byteLength,
      path,
    });
  }

  entries(): readonly FoundationProjectionByteInventoryEntry[] {
    return Object.freeze([...this.values.values()].sort((left, right) =>
      compareCodePoints(left.tier, right.tier) || compareCodePoints(left.key, right.key)));
  }
}

export function projectionIndexBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function buildMandatoryItem(
  value: Omit<FoundationProjectionMandatoryItem, "itemDigest" | "inclusionReasons" | "relationshipPaths"> & {
    inclusionReasons: readonly string[];
    relationshipPaths: readonly (readonly string[])[];
  },
): FoundationProjectionMandatoryItem {
  const relationshipPaths = [...value.relationshipPaths]
    .map((path) => Object.freeze([...path]))
    .sort((left, right) => compareCodePoints(left.join("\0"), right.join("\0")));
  const subject = {
    ...value,
    inclusionReasons: Object.freeze(sortUniqueCodePoints(value.inclusionReasons)),
    relationshipPaths: Object.freeze(relationshipPaths),
  };
  return Object.freeze({ ...subject, itemDigest: digestCanonical(subject) });
}

export function buildTierTwoItem<T extends Record<string, unknown>>(value: T): Readonly<T & { itemDigest: Sha256 }> {
  return Object.freeze({ ...value, itemDigest: digestCanonical(value) });
}

export function decodeInventoryBytes(entry: FoundationProjectionByteInventoryEntry): Buffer {
  const bytes = Buffer.from(entry.bytes, "base64");
  if (bytes.byteLength !== entry.byteLength || sha256Bytes(bytes) !== entry.digest) {
    throw new FoundationError("lifecycle.projection.content-digest", `Projection byte inventory entry ${entry.key} is corrupt`);
  }
  return bytes;
}
