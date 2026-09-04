import { parentPort, workerData } from "node:worker_threads";
import { validateAtlas } from "atlas-reference-validator";
import { FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES } from "./limits.js";

type WorkerInput = Readonly<{
  entrypoint: string;
  profile: string;
  specificationRevision: string;
}>;

if (parentPort === null) throw new Error("Atlas processor worker requires a parent port");

try {
  const input = workerData as WorkerInput;
  const result = validateAtlas(input.entrypoint, {
    profile: input.profile,
    specificationRevision: input.specificationRevision,
  });
  const json = JSON.stringify(result.toJSON());
  if (Buffer.byteLength(json, "utf8") > FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES) {
    parentPort.postMessage(Object.freeze({ ok: false, failure: "output-bound" }));
  } else {
    parentPort.postMessage(Object.freeze({ ok: true, json }));
  }
} catch {
  // The parent owns the public failure code. Raw processor exceptions can
  // contain its private materialization path or source fragments and never
  // cross the Worker boundary.
  parentPort.postMessage(Object.freeze({ ok: false }));
}
