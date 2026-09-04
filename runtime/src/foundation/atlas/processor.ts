import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical } from "../validation/canonical.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES } from "./limits.js";
import { inventoryInstalledAtlasProcessor } from "./processor-filesystem.js";
import { FOUNDATION_ATLAS_PROCESSOR, FOUNDATION_ATLAS_SELECTION } from "./selection.js";
import {
  FOUNDATION_ATLAS_PROCESSOR_FILES,
  type FoundationAtlasProcessorFile,
} from "./processor-inventory.js";
import type { FoundationAtlasNormalizedModel, FoundationAtlasValidationResult } from "./types.js";

const PROCESSOR_TIMEOUT_MS = 15_000;
const MAXIMUM_SCHEMA_BYTES = 1024 * 1024;

type ExternalSchemaValidators = Readonly<{
  validationResult: ValidateFunction;
  normalized: ValidateFunction;
}>;

type WorkerMessage = Readonly<{ ok: true; json: string }> | Readonly<{
  ok: false;
  failure?: "output-bound";
}>;

let validatorsPromise: Promise<ExternalSchemaValidators> | null = null;

function processorPackageRoot(): string {
  try {
    const entrypoint = fileURLToPath(import.meta.resolve("atlas-reference-validator"));
    return resolve(dirname(entrypoint), "..");
  } catch {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", "The selected Atlas processor package is unavailable");
  }
}

async function readJson(path: string, label: string, maximumBytes = MAXIMUM_SCHEMA_BYTES): Promise<Record<string, unknown>> {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(path);
  } catch {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", `${label} is absent from the installed Atlas processor`);
  }
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", `${label} is absent or exceeds its installed byte bound`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", `${label} could not be read from the installed Atlas processor`);
  }
  try {
    return parseStrictJson(bytes.toString("utf8"), {
      maximumBytes,
      source: label,
    }) as Record<string, unknown>;
  } catch {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", `${label} is not one bounded strict JSON schema`);
  }
}

async function verifyProcessorIdentity(root: string): Promise<void> {
  const expectedDigest = digestCanonical(FOUNDATION_ATLAS_PROCESSOR_FILES);
  let actual: readonly FoundationAtlasProcessorFile[];
  try {
    actual = await inventoryInstalledAtlasProcessor(root);
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    throw new FoundationError("lifecycle.atlas.processor-unavailable", "The selected Atlas processor inventory is unavailable");
  }
  const actualDigest = digestCanonical(actual);
  if (
    expectedDigest !== FOUNDATION_ATLAS_PROCESSOR.implementationDigest ||
    actualDigest !== FOUNDATION_ATLAS_PROCESSOR.implementationDigest ||
    canonicalJson(actual) !== canonicalJson(FOUNDATION_ATLAS_PROCESSOR_FILES)
  ) {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", "Installed Atlas processor payload does not match the exact selected implementation", {
      observedFacts: {
        actualDigest,
        expectedDigest: FOUNDATION_ATLAS_PROCESSOR.implementationDigest,
        expectedFileCount: FOUNDATION_ATLAS_PROCESSOR_FILES.length,
        observedFileCount: actual.length,
        processorRevision: FOUNDATION_ATLAS_SELECTION.processorRevision,
      },
    });
  }
}

async function compileExternalSchemas(): Promise<ExternalSchemaValidators> {
  const root = processorPackageRoot();
  await verifyProcessorIdentity(root);
  const schemas = await Promise.all([
    readJson(join(root, "schemas", "common.schema.json"), "Atlas common schema"),
    readJson(join(root, "schemas", "normalized.schema.json"), "Atlas normalized-model schema"),
    readJson(join(root, "schemas", "validation-result.schema.json"), "Atlas Validation Result schema"),
  ]);
  try {
    const engine = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: true });
    engine.addFormat("date", {
      type: "string",
      validate: (value: string): boolean => {
        const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(value);
        if (match?.groups === undefined) return false;
        const year = Number(match.groups.year);
        const month = Number(match.groups.month);
        const day = Number(match.groups.day);
        if (month < 1 || month > 12 || day < 1) return false;
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return day <= days[month - 1]!;
      },
    });
    for (const schema of schemas) engine.addSchema(schema);
    const validationResult = engine.getSchema(FOUNDATION_ATLAS_SELECTION.validationResultSchema);
    const normalized = engine.getSchema(FOUNDATION_ATLAS_SELECTION.normalizedModelSchema);
    if (validationResult === undefined || normalized === undefined) throw new Error("selected Atlas schemas did not compile");
    return Object.freeze({ validationResult, normalized });
  } catch {
    throw new FoundationError("lifecycle.atlas.processor-unavailable", "Installed Atlas output schemas could not be compiled");
  }
}

async function externalValidators(): Promise<ExternalSchemaValidators> {
  validatorsPromise ??= compileExternalSchemas();
  return validatorsPromise;
}

function runWorker(entrypoint: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./processor-worker.js", import.meta.url), {
        workerData: {
          entrypoint,
          profile: FOUNDATION_ATLAS_SELECTION.validationProfile,
          specificationRevision: FOUNDATION_ATLAS_SELECTION.specificationRevision,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 8,
        },
      });
    } catch {
      reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor worker could not start"));
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processing exceeded its time bound"));
    }, PROCESSOR_TIMEOUT_MS);
    worker.once("message", (message: WorkerMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (!message.ok && message.failure === "output-bound") {
        reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor output exceeds its byte bound"));
        return;
      }
      if (!message.ok) {
        reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor did not complete"));
        return;
      }
      if (Buffer.byteLength(message.json, "utf8") > FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES) {
        reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor output exceeds its byte bound"));
        return;
      }
      resolveResult(message.json);
    });
    worker.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor worker failed"));
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas processor exited without one result", {
        observedFacts: { exitCode: code },
      }));
    });
  });
}

function schemaFailure(
  code: "lifecycle.atlas.result-invalid" | "lifecycle.atlas.normalized-invalid",
  label: string,
  validator: ValidateFunction,
): never {
  throw new FoundationError(code, `${label} does not conform to the exact selected Atlas schema`, {
    observedFacts: {
      errors: (validator.errors ?? []).map(({ instancePath, keyword, schemaPath }) => ({ instancePath, keyword, schemaPath })),
    },
  });
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Parse the Worker result under the same explicit byte maximum it enforces. */
export function parseAtlasProcessorOutput(json: string): unknown {
  try {
    return parseStrictJson(json, {
      maximumBytes: FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES,
      source: "Atlas processor result",
    });
  } catch {
    throw new FoundationError("lifecycle.atlas.result-invalid", "Atlas processor output is not one bounded strict JSON result");
  }
}

/** Execute and independently validate the exact selected external processor. */
export async function processMaterializedAtlas(entrypoint: string): Promise<Readonly<{
  result: FoundationAtlasValidationResult;
  resultDigest: ReturnType<typeof digestCanonical>;
  model: FoundationAtlasNormalizedModel;
  modelDigest: ReturnType<typeof digestCanonical>;
}>> {
  const validators = await externalValidators();
  // Schema compilation is cached, but the Worker resolves and executes the
  // installed processor afresh. Reproduce its exact inventory immediately
  // before every dispatch so a long-lived runtime never records a stale
  // qualified identity for newly loaded bytes.
  await verifyProcessorIdentity(processorPackageRoot());
  const json = await runWorker(entrypoint);
  await verifyProcessorIdentity(processorPackageRoot());
  const value = parseAtlasProcessorOutput(json);
  const normalizedJsonValue = JSON.parse(canonicalJson(value)) as unknown;
  if (!validators.validationResult(normalizedJsonValue)) {
    schemaFailure("lifecycle.atlas.result-invalid", "Atlas Validation Result", validators.validationResult);
  }
  const result = deepFreezeJson(normalizedJsonValue as FoundationAtlasValidationResult);
  if (
    result.profile !== FOUNDATION_ATLAS_SELECTION.validationProfile ||
    result.specificationRevision !== FOUNDATION_ATLAS_SELECTION.specificationRevision ||
    result.implementation.name !== FOUNDATION_ATLAS_PROCESSOR.id ||
    result.implementation.version !== FOUNDATION_ATLAS_PROCESSOR.version ||
    result.implementation.status !== "working"
  ) {
    throw new FoundationError("lifecycle.atlas.result-invalid", "Atlas processor result does not match the exact selected coordinates", {
      observedFacts: {
        implementation: result.implementation,
        profile: result.profile,
        specificationRevision: result.specificationRevision,
      },
    });
  }
  if (!result.complete) {
    throw new FoundationError("lifecycle.atlas.processing-incomplete", "Atlas resolved processing did not complete", {
      observedFacts: { diagnosticCodes: result.diagnostics.map(({ code }) => code) },
    });
  }
  if (!result.valid) {
    throw new FoundationError("lifecycle.atlas.invalid", "Lifecycle requires one complete valid resolved Atlas", {
      observedFacts: {
        complete: result.complete,
        diagnosticCodes: result.diagnostics.map(({ code }) => code),
        valid: result.valid,
      },
    });
  }
  if (result.normalized === undefined) {
    throw new FoundationError("lifecycle.atlas.normalized-invalid", "A complete valid Atlas result omitted its normalized model");
  }
  if (!validators.normalized(result.normalized)) {
    schemaFailure("lifecycle.atlas.normalized-invalid", "Atlas normalized model", validators.normalized);
  }
  const model = deepFreezeJson(
    JSON.parse(canonicalJson(result.normalized)) as FoundationAtlasNormalizedModel,
  );
  return Object.freeze({
    result,
    resultDigest: digestCanonical(result),
    model,
    modelDigest: digestCanonical(model),
  });
}
