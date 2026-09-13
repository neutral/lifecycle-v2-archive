import { FoundationError } from "../error.js";
import type { FoundationProjectionProfile } from "../repository/types.js";
import { compareCodePoints } from "../validation/ordering.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { FOUNDATION_PROJECTION_COMPILER_IDENTITY } from "./orientation.js";
import type { FoundationProjectionRequest } from "./types.js";

export type FoundationMandatoryProjectionFactsV1 = Readonly<{
  mandatoryItems: number; mandatoryBytes: number; sourceBytes: number;
  maximumMandatoryItems: number; maximumMandatoryBytes: number;
  maximumItemBytes: number; maximumSourceBytes: number;
  oversized: readonly Readonly<{ id: string; bytes: number }>[];
}>;
export type FoundationMandatoryProjectionMeasurementV1 =
  | Readonly<Omit<FoundationMandatoryProjectionFactsV1, "oversized"> & {
      kind: "complete-closure"; oversized: Readonly<{ count: number; digest: Sha256; witness: Readonly<{ id: string; bytes: number }> | null }>;
    }>
  | Readonly<{ kind: "mandatory-item"; category: string; id: string; locator: string;
      objectId: string; observedBytes: number; maximumItemBytes: number }>;
export type FoundationMandatoryProjectionRefusalV1 = Readonly<{
  request: FoundationProjectionRequest;
  requestDigest: Sha256; profile: FoundationProjectionProfile;
  compiler: typeof FOUNDATION_PROJECTION_COMPILER_IDENTITY;
  measurement: FoundationMandatoryProjectionMeasurementV1;
  refusalFactsDigest: Sha256; error: FoundationError;
}>;
const witnesses = new WeakMap<object, Readonly<{ profile: FoundationProjectionProfile; measurement: FoundationMandatoryProjectionMeasurementV1 }>>();
const refusals = new WeakMap<object, FoundationMandatoryProjectionRefusalV1>();

export function foundationMandatoryProjectionRefusalV1(value: unknown): FoundationMandatoryProjectionRefusalV1 | null {
  return value !== null && typeof value === "object" ? refusals.get(value) ?? null : null;
}

/** Binding preserves the owner-produced witness; diagnostic text cannot manufacture it. */
export function bindFoundationMandatoryProjectionRefusalV1(value: unknown, request: FoundationProjectionRequest | null): FoundationMandatoryProjectionRefusalV1 | null {
  if (!(value instanceof FoundationError) || request === null) return null;
  const witness = witnesses.get(value);
  if (witness === undefined || witness.profile.digest !== request.profile.digest) return null;
  const facts = Object.freeze({ requestDigest: request.digest, profile: request.profile,
    compiler: FOUNDATION_PROJECTION_COMPILER_IDENTITY, measurement: witness.measurement });
  const refusal = Object.freeze({ request, ...facts,
    refusalFactsDigest: digestCanonical({ schema: "lifecycle.projection-mandatory-refusal.v1", ...facts }), error: value });
  refusals.set(value, refusal);
  return refusal;
}

export function retainFoundationMandatoryProjectionRefusalV1(result: object, refusal: FoundationMandatoryProjectionRefusalV1): void {
  if (refusals.get(refusal.error) !== refusal) throw new TypeError("Projection refusal is not owner-produced");
  refusals.set(result, refusal);
}

export function completeMandatoryProjectionSizeErrorV1(request: FoundationProjectionRequest, facts: FoundationMandatoryProjectionFactsV1): FoundationError {
  const limits = ["maximumMandatoryItems", "maximumMandatoryBytes", "maximumItemBytes", "maximumSourceBytes"] as const;
  const counts = ["mandatoryItems", "mandatoryBytes", "sourceBytes", ...limits] as const;
  if (counts.some((key) => !Number.isSafeInteger(facts[key]) || facts[key] < 0) ||
      limits.some((key) => facts[key] !== request.profile[key]) ||
      !Array.isArray(facts.oversized) || facts.oversized.some(({ id, bytes }) =>
        typeof id !== "string" || id.length === 0 || !Number.isSafeInteger(bytes) || bytes <= facts.maximumItemBytes) ||
      !(facts.mandatoryItems > facts.maximumMandatoryItems || facts.mandatoryBytes > facts.maximumMandatoryBytes ||
        facts.sourceBytes > facts.maximumSourceBytes || facts.oversized.length > 0)) {
    throw new TypeError("Complete-closure refusal requires exact measured excess above the selected bounds");
  }
  const error = new FoundationError("lifecycle.projection.mandatory-too-large", "Complete mandatory Projection material exceeds the selected profile", { observedFacts: facts });
  const oversized = facts.oversized.map(({ id, bytes }) => Object.freeze({ id, bytes }))
    .sort((a, b) => compareCodePoints(a.id, b.id));
  const witness = oversized.find(({ id }) => /^[\x21-\x7e]{1,512}$/u.test(id)) ?? null;
  const measurement = Object.freeze({ ...facts, kind: "complete-closure" as const,
    oversized: Object.freeze({ count: oversized.length, digest: digestCanonical(oversized), witness }) });
  witnesses.set(error, Object.freeze({ profile: request.profile, measurement }));
  bindFoundationMandatoryProjectionRefusalV1(error, request);
  return error;
}

/** An exact required Git object size proves this single item cannot fit, without reading its oversized bytes. */
export function mandatoryProjectionItemSizeErrorV1(input: Readonly<{
  profile: FoundationProjectionProfile; category: string; id: string; locator: string; objectId: string; observedBytes: number;
}>): FoundationError {
  if (!Number.isSafeInteger(input.observedBytes) || input.observedBytes <= input.profile.maximumItemBytes) {
    throw new TypeError("Mandatory-item refusal requires a measured size above its exact bound");
  }
  const measurement = Object.freeze({ kind: "mandatory-item" as const, category: input.category, id: input.id,
    locator: input.locator, objectId: input.objectId, observedBytes: input.observedBytes, maximumItemBytes: input.profile.maximumItemBytes });
  const error = new FoundationError("lifecycle.projection.mandatory-too-large", "An exact mandatory Git object exceeds the selected per-item bound", {
    observedFacts: { ...measurement, profile: input.profile.id },
  });
  witnesses.set(error, Object.freeze({ profile: input.profile, measurement }));
  return error;
}
