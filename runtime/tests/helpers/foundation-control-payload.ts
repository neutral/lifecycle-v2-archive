import { existsSync, readFileSync } from "node:fs";
import type { DeliveryControlRecordKind } from "../../src/foundation/control/kind-registry.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";

export function validDeliveryControlPayload(
  kind: DeliveryControlRecordKind,
): ControlJsonObject {
  const relative = kind === "integration-assessment"
    ? "spec-source/examples/integration-assessment-structural-valid/subject.json"
    : `spec-source/examples/${kind}-payload-structural-valid/subject.json`;
  const fixture = [
    new URL(`../../../../${relative}`, import.meta.url),
    new URL(`../../../${relative}`, import.meta.url),
  ].find((candidate) => existsSync(candidate));
  if (fixture === undefined) {
    throw new Error(`The ${kind} payload fixture is unavailable from source and compiled test layouts`);
  }
  const bytes = readFileSync(fixture);
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${kind} payload fixture is not one JSON object`);
  }
  return value as ControlJsonObject;
}
