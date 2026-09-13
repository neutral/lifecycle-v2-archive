import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { FoundationControlEventSchema } from "@neutral/lifecycle-protocol";
import { deliveryControlRecordPolicy } from "../../src/foundation/control/kind-registry.js";
import { validateFoundationSchema } from "../../src/foundation/validation/schema-engine.js";

function fixture(id: string): unknown {
  const relative = `spec-source/examples/${id}/subject.json`;
  const path = [new URL(`../../../../${relative}`, import.meta.url), new URL(`../../../${relative}`, import.meta.url)]
    .find(candidate => existsSync(candidate));
  assert.ok(path, `The exact ${id} structural subject is present`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

// Finite structural fixtures only, authored UNRUN. Replay, authentication,
// physical Store version refusal, reservations and stop atomicity have their
// separate owner-adjacent assertions; schema success cannot establish those facts.
test("current Control structural fixtures select the registered scoped Brief and Work Delegation schemas", () => {
  const scopes = [
    ["director-brief", "director-brief-payload-structural-valid", true],
    ["director-brief", "director-brief-standing-structural-valid", true],
    ["director-brief", "director-brief-standing-operation-invalid", false],
    ["work-delegation", "work-delegation-payload-structural-valid", true],
    ["work-delegation", "work-delegation-integrate-only-structural-valid", true],
    ["work-delegation", "work-delegation-implicit-direction-invalid", false],
  ] as const;
  for (const [kind, id, valid] of scopes) {
    const diagnostics = validateFoundationSchema(deliveryControlRecordPolicy(kind).payloadSchemaId, fixture(id), id);
    assert.equal(diagnostics.length === 0, valid, id);
  }
});

test("event v6 structural schema and public decoder agree on the finite new event shapes", () => {
  for (const [id, valid] of [
    ["control-record-event-delegation-set-structural-valid", true],
    ["control-record-event-delegation-stopped-structural-valid", true],
    ["control-record-event-standing-brief-structural-valid", true],
    ["control-record-event-mixed-brief-scope-invalid", false],
    ["control-record-event-reserved-opening-structural-valid", true],
    ["control-record-event-null-reservation-invalid", false],
  ] as const) {
    const value = fixture(id);
    assert.equal(validateFoundationSchema("urn:lifecycle:schema:control-record-event:v6", value, id).length === 0, valid, id);
    assert.equal(FoundationControlEventSchema.safeParse(value).success, valid, id);
  }
});

test("reduction v5 preserves stopped grant charges; lifecycle v7 requires physical version 3", () => {
  for (const [id, valid] of [
    ["delivery-reduction-structural-valid", true],
    ["delivery-reduction-delegation-stopped-structural-valid", true],
    ["delivery-reduction-negative-charge-invalid", false],
  ] as const) assert.equal(validateFoundationSchema("urn:lifecycle:schema:delivery-reduction:v5", fixture(id), id).length === 0, valid, id);
  const profile = fixture("control-lifecycle-profile-structural-valid") as { store: Record<string, unknown> };
  const schema = "urn:lifecycle:schema:control-lifecycle-profile:v7";
  assert.deepEqual(validateFoundationSchema(schema, profile, "profile"), []);
  assert.equal(profile.store.physicalUserVersion, 3);
  for (const physicalUserVersion of [undefined, 1, 2]) {
    const store = { ...profile.store, physicalUserVersion };
    if (physicalUserVersion === undefined) delete store.physicalUserVersion;
    assert.ok(validateFoundationSchema(schema, { ...profile, store }, "profile").length > 0);
  }
});
