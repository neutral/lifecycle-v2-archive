import type { FoundationRetrievedExecutionOutputV1 } from "../../src/foundation/execution/backend.js";
import type { FoundationExecutionOutputManifestEntryV1, FoundationExecutionSpecificationV1 } from "../../src/foundation/execution/contracts.js";
import { canonicalJsonLine, digestCanonical, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";

// External runner bytes only. Runtime validates the Output, observes execution,
// retains the Check Receipt and interprets support through its actual owners.
export function checkExecutionOutput(
  specification: FoundationExecutionSpecificationV1,
  options: Readonly<{ exitCode?: number; observedAt?: string; stdout?: string }> = {},
): FoundationRetrievedExecutionOutputV1 {
  const subjectDigest = sha256Bytes(`foundation-check-operation-v7:proof-subject-${specification.digest}`);
  const exitCode = options.exitCode ?? 0;
  const proofSubject = Object.freeze({
    schema: "lifecycle.check-cell-proof.v1" as const,
    startedAt: options.observedAt ?? "2026-09-01T00:00:00.010Z",
    finishedAt: options.observedAt ?? "2026-09-01T00:00:00.020Z",
    exitCode,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    parserId: "exit-code-v1" as const,
    parserDisposition: "passed" as const,
    subjectBeforeDigest: subjectDigest,
    subjectAfterDigest: subjectDigest,
    subjectIntegrity: "unchanged" as const,
    resultFacts: Object.freeze([Object.freeze({ name: "exit-code", value: exitCode })]),
  });
  const proof = Object.freeze({ ...proofSubject, digest: selfDigest(proofSubject) });
  const raw = Object.freeze({
    schema: "lifecycle.check-cell-raw-streams.v1" as const,
    stdoutBase64: Buffer.from(options.stdout ?? "deterministic Check passed\n", "utf8").toString("base64"),
    stderrBase64: "",
  });
  const values = Object.freeze([
    Object.freeze({
      path: "check-proof/result.json",
      purpose: "check-proof" as const,
      mediaType: "application/json",
      bytes: Uint8Array.from(Buffer.from(canonicalJsonLine(proof), "utf8")),
    }),
    Object.freeze({
      path: "raw-check-output/streams.json",
      purpose: "raw-check-output" as const,
      mediaType: "application/json",
      bytes: Uint8Array.from(Buffer.from(canonicalJsonLine(raw), "utf8")),
    }),
  ]);
  const entries: readonly FoundationExecutionOutputManifestEntryV1[] = Object.freeze(
    values.map((value) => Object.freeze({
      path: value.path,
      entryKind: "file" as const,
      purpose: value.purpose,
      mediaType: value.mediaType,
      modeClass: "regular" as const,
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    })),
  );
  const aggregateByteLength = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
  const manifestSubject = Object.freeze({
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: specification.digest,
    inputSetDigest: specification.inputSet.digest,
    imageDigest: specification.image.imageDigest,
    outputContractDigest: specification.outputContract.digest,
    runnerDigest: specification.runner.contractDigest,
    completedAt: options.observedAt ?? "2026-09-01T00:00:00.100Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength,
    entryInventoryDigest: digestCanonical(entries),
  });
  return Object.freeze({
    manifest: Object.freeze({
      ...manifestSubject,
      digest: selfDigest(manifestSubject),
    }),
    carrierByteLength: aggregateByteLength,
    async *entries() {
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = entries[index]!;
        const bytes = values[index]!.bytes;
        yield Object.freeze({
          path: descriptor.path,
          byteLength: descriptor.byteLength,
          digest: descriptor.digest,
          async *read() { yield Uint8Array.from(bytes); },
        });
      }
    },
  });
}
