import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "../../src/foundation/repository/contract.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { DiagnosticCollector, foundationValidationImplementation, validationDigestSubject, validationResultDigest } from "../../src/foundation/validation/result.js";
import { validateFoundationSchema } from "../../src/foundation/validation/schema-engine.js";

const executeFile = promisify(execFile);
const PUBLICATION_DIGEST = sha256Bytes("validation-test-publication");
const SUBJECT_DIGEST = sha256Bytes("validation-test-subject");

function nullPrototypeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => nullPrototypeJson(item));
  if (value !== null && typeof value === "object") {
    const result = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = nullPrototypeJson(child);
    }
    return result;
  }
  return value;
}

function validResult(): ReturnType<DiagnosticCollector["result"]> {
  const collector = new DiagnosticCollector();
  collector.add({
    stage: "schema",
    code: "lifecycle.schema.notice",
    severity: "warning",
    message: "A human-readable warning",
    path: "records/behavior/example.md",
    pointer: "/kind",
    line: 4,
    column: 3,
    related: ["behavior.example", "src/example.ts"],
    facts: { expected: "behavior", observed: "example" },
  });
  return collector.result({
    profile: "validation-test-v1",
    publicationDigest: PUBLICATION_DIGEST,
    subjectKind: "knowledge-record",
    subjectId: "behavior.example",
    subjectDigest: SUBJECT_DIGEST,
    subjectRevision: 1,
    subjectLocator: "records/behavior/example.md",
    stages: [{ id: "schema", complete: true, durationMs: 7 }],
    limits: { documentBytes: 4096, diagnostics: 128 },
    observedAt: "2026-08-22T12:00:00.000Z",
  });
}

test("validation result is schema-exact, immutable, and hashes only its declared projection", async () => {
  const result = validResult();
  const schemasRoot = fileURLToPath(new URL("../../../../spec-source/schemas/", import.meta.url));
  const common = JSON.parse(await readFile(resolve(schemasRoot, "common.schema.json"), "utf8"));
  const validation = JSON.parse(await readFile(resolve(schemasRoot, "validation-result.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false });
  ajv.addSchema(common);
  ajv.addSchema(validation);
  const validateResult = ajv.getSchema("urn:lifecycle:schema:validation-result:v1");
  const validateDigest = ajv.getSchema("urn:lifecycle:schema:validation-result:v1#/$defs/digestSubject");
  assert(validateResult);
  assert(validateDigest);
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  const subject = validationDigestSubject(result);
  assert.equal(validateDigest(subject), true, JSON.stringify(validateDigest.errors));
  assert.equal(result.digest, validationResultDigest(result));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.subject), true);
  assert.equal(Object.isFrozen(result.diagnostics[0]?.facts), true);
  assert.equal(result.implementation.schemaEngine.implementation, "ajv");
  assert.match(result.implementation.schemaEngine.schemaSetDigest, /^sha256:/u);
  assert.throws(() => { (result as { valid: boolean }).valid = false; }, TypeError);
});

test("stage completeness is explicit and incomplete always means invalid", () => {
  const incomplete = new DiagnosticCollector().result({
    profile: "validation-test-v1",
    publicationDigest: PUBLICATION_DIGEST,
    subjectKind: "knowledge-record",
    subjectId: "behavior.example",
    stages: [{ id: "schema", complete: false }],
  });
  assert.equal(incomplete.stages[0]?.complete, false);
  assert.equal(incomplete.stages[0]?.valid, false);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.valid, false);

  const collector = new DiagnosticCollector();
  collector.add({
    stage: "schema",
    code: "validator.telemetry.incomplete",
    severity: "warning",
    message: "A suffix does not define stage state",
  });
  const complete = collector.result({
    profile: "validation-test-v1",
    publicationDigest: PUBLICATION_DIGEST,
    subjectKind: "knowledge-record",
    subjectId: "behavior.example",
    stages: [{ id: "schema", complete: true }],
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.valid, true);
});

test("validation implementation identity cannot substitute another installed schema set", () => {
  const standard = foundationValidationImplementation(["validation-test-v1"], []);
  const { digest: _digest, ...standardSubject } = standard;
  const substitutedSubject = {
    ...standardSubject,
    schemaEngine: { ...standard.schemaEngine, schemaSetDigest: sha256Bytes("substituted schema set") },
  };
  assert.throws(() => new DiagnosticCollector().result({
    profile: "validation-test-v1",
    publicationDigest: PUBLICATION_DIGEST,
    subjectKind: "knowledge-record",
    subjectId: "behavior.example",
    stages: ["schema"],
    implementation: {
      ...substitutedSubject,
      digest: digestCanonical(substitutedSubject),
    } as typeof standard,
  }), /exact installed schema engine/u);
});

test("schema validation is prototype-independent inside the strict JSON value domain", () => {
  const schemaId = "urn:lifecycle:schema:provider-descriptor:v7";
  const ordinary = structuredClone(FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR);
  const withoutPrototypes = nullPrototypeJson(ordinary);
  assert.deepEqual(
    validateFoundationSchema(schemaId, withoutPrototypes, "provider-null-prototype.json"),
    validateFoundationSchema(schemaId, ordinary, "provider-null-prototype.json"),
  );

  const invalidOrdinary = { ...ordinary, schema: "not-the-provider-schema" };
  const invalidWithoutPrototypes = nullPrototypeJson(invalidOrdinary);
  assert.deepEqual(
    validateFoundationSchema(schemaId, invalidWithoutPrototypes, "invalid-provider.json"),
    validateFoundationSchema(schemaId, invalidOrdinary, "invalid-provider.json"),
  );

  assert.throws(
    () => validateFoundationSchema(
      schemaId,
      { ...ordinary, undefinedIsNotJson: undefined },
      "non-json-provider.json",
    ),
    /rejects undefined object member/u,
  );
});

test("diagnostics use Unicode code-point ordering and preserve typed facts", () => {
  const collector = new DiagnosticCollector();
  collector.add({
    stage: "schema",
    code: "lifecycle.schema.invalid",
    message: "Supplementary-plane locator",
    path: "\u{10000}",
    facts: { keyword: "type", allowed: ["object", "null"], actual: 7 },
  });
  collector.add({
    stage: "schema",
    code: "lifecycle.schema.invalid",
    message: "Private-use locator",
    path: "\u{e000}",
    facts: { keyword: "required", missing: "kind" },
  });
  const result = collector.result({
    profile: "validation-test-v1",
    publicationDigest: PUBLICATION_DIGEST,
    subjectKind: "knowledge-record",
    subjectId: "behavior.example",
    stages: [{ id: "schema", complete: true }],
  });
  assert.equal(result.diagnostics[0]?.location.locator, "\u{e000}");
  assert.deepEqual(result.diagnostics[1]?.facts, { actual: 7, allowed: ["object", "null"], keyword: "type" });
});

test("validation digest is stable across processes and operational metadata", async () => {
  const resultModule = new URL("../../src/foundation/validation/result.js", import.meta.url).href;
  const canonicalModule = new URL("../../src/foundation/validation/canonical.js", import.meta.url).href;
  const script = `
    import { DiagnosticCollector, foundationValidationImplementation } from ${JSON.stringify(resultModule)};
    import { digestCanonical } from ${JSON.stringify(canonicalModule)};
    const collector = new DiagnosticCollector();
    collector.add({
      stage: "schema",
      code: "lifecycle.schema.notice",
      severity: "warning",
      message: process.argv[1],
      path: "records/behavior/example.md",
      facts: { keyword: "type", expected: "object" }
    });
    if (process.argv[2] === "extra") collector.add({
      stage: "schema",
      code: "validator.telemetry",
      severity: "information",
      message: "implementation detail",
      facts: { worker: process.pid }
    });
    const marker = process.argv[2] === "extra" ? "b" : "a";
    const standard = foundationValidationImplementation(["validation-test-v1"], []);
    const { digest: ignoredDigest, ...standardSubject } = standard;
    const implementationSubject = { ...standardSubject, id: "validator." + marker };
    const result = collector.result({
      profile: "validation-test-v1",
      publicationDigest: ${JSON.stringify(PUBLICATION_DIGEST)},
      subjectKind: "knowledge-record",
      subjectId: "behavior.example",
      subjectDigest: ${JSON.stringify(SUBJECT_DIGEST)},
      subjectRevision: 1,
      subjectLocator: "records/behavior/example.md",
      stages: [{ id: "schema", complete: true, durationMs: Number(process.argv[3]) }],
      limits: { diagnostics: 128, documentBytes: 4096 },
      observedAt: marker === "a" ? "2026-08-22T12:00:00.000Z" : "2026-08-22T12:01:00.000Z",
      implementation: { ...implementationSubject, digest: digestCanonical(implementationSubject) }
    });
    process.stdout.write(JSON.stringify({ digest: result.digest, result }));
  `;
  const first = JSON.parse((await executeFile(process.execPath, ["--input-type=module", "-e", script, "first message", "base", "3"])).stdout);
  const second = JSON.parse((await executeFile(process.execPath, ["--input-type=module", "-e", script, "second message", "extra", "900"])).stdout);
  assert.notDeepEqual(first.result, second.result);
  assert.equal(first.digest, second.digest);
});
