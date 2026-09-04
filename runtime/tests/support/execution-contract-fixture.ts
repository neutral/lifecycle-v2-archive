import type { FoundationRetrievedExecutionOutputV1 } from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionImageReferenceV1,
  type FoundationExecutionInputSetReferenceV1,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

export type ExecutionContractFixture = Readonly<{
  profile: FoundationExecutionBackendProfileV1;
  image: FoundationExecutionImageReferenceV1;
  inputSet: FoundationExecutionInputSetReferenceV1;
  specification: FoundationExecutionSpecificationV1;
}>;

export function digest(label: string): Sha256 {
  return digestCanonical({ fixture: label });
}

export function executionContractFixture(salt = "default"): ExecutionContractFixture {
  const profileSubject = {
    schema: "lifecycle.execution-backend-profile.v1",
    profileId: "lifecycle.execution-backend-profile.fault-injection.v1",
    backendKind: "fault-injection",
    usage: "test-only",
    implementation: {
      id: "runtime.execution-backend.fault-injection",
      version: "1.0.0",
      implementationDigest: digest("backend-implementation"),
      contractDigest: digest("backend-contract"),
    },
    engineContract: {
      kind: "deterministic-test-engine",
      compatibilityProfileId: "deterministic-test-engine-v1",
      compatibleVersion: "1.0.0",
      contractDigest: digest("engine-contract"),
    },
    platforms: [{ os: "linux", architecture: "amd64", variant: null }],
    isolation: {
      mechanism: "deterministic-test-cell",
      modelsFailureSemantics: true,
      productionIsolationClaim: false,
    },
    lifecycleGuarantees: {
      deterministicAllocation: true,
      oneCellPerSpecification: true,
      oneTimeDispatch: true,
      directObservation: true,
      monotonicCancellation: true,
      retrievalAfterContainment: true,
      retirementBeforeCompletion: true,
      reclamationAfterRetirement: true,
    },
    imagePolicy: {
      immutableDigestRequired: true,
      mutableTagsAllowed: false,
      platformVerification: true,
      runnerAndToolInventoryVerification: true,
    },
    transferPolicy: {
      inputModes: ["bounded-archive"],
      outputModes: ["bounded-archive"],
      contentValidation: "runtime-independent",
      physicalIdentityIsLogicalInput: false,
    },
    networkPolicy: {
      providerControlPlaneModes: ["none"],
      agentProductNetworkModes: ["none"],
      separationRequired: true,
    },
    credentialPolicy: {
      injectionModes: ["none"],
      agentAccess: false,
      outputDisclosure: false,
      diagnosticDisclosure: false,
    },
    limits: {
      maximumWallTimeMilliseconds: 60_000,
      maximumProcesses: 8,
      maximumStorageBytes: 1_048_576,
      maximumOutputEntries: 16,
      maximumOutputBytes: 1_048_576,
      maximumOutputEntryBytes: 1_048_576,
      maximumEvents: 100,
    },
    outputPolicy: {
      manifestProfile: "lifecycle.execution-output-manifest.v1",
      allowedModeClasses: ["regular", "executable"],
      linksAllowed: false,
      specialFilesAllowed: false,
      extraEntriesAllowed: false,
    },
    qualificationClaims: [],
  } as const;
  const profile = parseFoundationExecutionBackendProfile({
    ...profileSubject,
    digest: selfDigest(profileSubject),
  });
  const image = Object.freeze({
    imageId: "lifecycle.execution-image.test.v1",
    imageDigest: digest(`image-${salt}`),
  });
  const inputSet = Object.freeze({
    profileId: "lifecycle.execution-input-set.v1" as const,
    digest: digest(`input-set-${salt}`),
  });
  const outputContractSubject = {
    manifestProfile: "lifecycle.execution-output-manifest.v1",
    declaredOutputRoots: [{
      path: "outputs",
      purpose: "agent-work-product",
      required: false,
      allowedModeClasses: ["regular"],
      maximumEntries: 16,
      maximumBytes: 1_048_576,
    }],
    allowedModeClasses: ["regular", "executable"],
    extraEntriesAllowed: false,
  } as const;
  const specificationSubject = {
    schema: "lifecycle.execution-specification.v1",
    owner: {
      kind: "agent-attempt",
      activityId: `activity.${salt}`,
      attempt: {
        kind: "agent-attempt",
        id: `attempt.${salt}`,
        revision: 1,
        digest: digest(`attempt-${salt}`),
      },
    },
    backendProfile: {
      profileId: profile.profileId,
      profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    },
    image,
    inputSet,
    operation: {
      kind: "agent-attempt",
      role: "reconnaissance",
      providerDescriptorDigest: digest("provider"),
      adapterImplementationDigest: digest("adapter"),
    },
    runner: {
      contractId: "lifecycle.execution-cell-runner.v1",
      contractDigest: digest("runner-contract"),
      operationId: "agent-attempt.reconnaissance",
      argumentsDigest: digest(`runner-arguments-${salt}`),
    },
    environment: [],
    capabilities: {
      capabilityProfileDigest: digest("capabilities"),
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "repository-toolchain",
      externalEffects: false,
      dockerDaemonAccess: false,
    },
    networkPolicy: {
      agentProductNetwork: "none",
      agentPolicyDigest: digest("agent-network"),
      providerControlPlane: "none",
      providerPolicyDigest: null,
      separationRequired: true,
    },
    credentialPolicy: {
      mode: "none",
      bindings: [],
      agentAccess: false,
      outputDisclosure: false,
    },
    limits: {
      wallTimeMilliseconds: 30_000,
      processes: 4,
      storageBytes: 1_048_576,
      outputEntries: 16,
      outputBytes: 1_048_576,
      outputEntryBytes: 1_048_576,
      events: 100,
    },
    outputContract: {
      ...outputContractSubject,
      digest: selfDigest(outputContractSubject),
    },
    terminalPolicy: {
      directObservationRequired: true,
      containmentRequired: true,
      retrievalAfterContainment: true,
      retirementRequired: true,
      reclamation: "asynchronous-private",
    },
  } as const;
  const specification = parseFoundationExecutionSpecification({
    value: { ...specificationSubject, digest: selfDigest(specificationSubject) },
    backendProfile: profile,
    image,
    inputSet,
  });
  return Object.freeze({ profile, image, inputSet, specification });
}

/** Exact builder fixture whose Candidate root denotes one complete successor tree. */
export function builderExecutionContractFixture(salt = "builder"): ExecutionContractFixture {
  const fixture = executionContractFixture(salt);
  const specificationSubject = JSON.parse(
    canonicalJson(fixture.specification),
  ) as Record<string, unknown>;
  delete specificationSubject.digest;
  (specificationSubject.operation as Record<string, unknown>).role = "builder";
  (specificationSubject.runner as Record<string, unknown>).operationId = "agent-attempt.builder";
  (specificationSubject.capabilities as Record<string, unknown>).candidateWrites = true;
  const outputContract = specificationSubject.outputContract as Record<string, unknown>;
  outputContract.declaredOutputRoots = [{
    path: "candidate-output",
    purpose: "candidate-output",
    required: false,
    allowedModeClasses: ["regular", "executable"],
    maximumEntries: fixture.specification.limits.outputEntries,
    maximumBytes: fixture.specification.limits.outputBytes,
  }];
  delete outputContract.digest;
  outputContract.digest = selfDigest(outputContract);
  const specification = parseFoundationExecutionSpecification({
    value: {
      ...specificationSubject,
      digest: selfDigest(specificationSubject),
    },
    backendProfile: fixture.profile,
    image: fixture.image,
    inputSet: fixture.inputSet,
  });
  return Object.freeze({ ...fixture, specification });
}

export function executionOutputFixture(
  specification: FoundationExecutionSpecificationV1,
): FoundationRetrievedExecutionOutputV1 {
  const bytes = Buffer.from("bounded output\n", "utf8");
  const entries = Object.freeze([Object.freeze({
    path: "outputs/result.txt",
    entryKind: "file" as const,
    purpose: "agent-work-product",
    mediaType: "text/plain",
    modeClass: "regular" as const,
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
  })]);
  const manifestSubject = {
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: specification.digest,
    inputSetDigest: specification.inputSet.digest,
    imageDigest: specification.image.imageDigest,
    outputContractDigest: specification.outputContract.digest,
    runnerDigest: digest("runner-implementation"),
    completedAt: "2026-09-01T00:00:00.000Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength: bytes.byteLength,
    entryInventoryDigest: digestCanonical(entries),
  };
  return Object.freeze({
    manifest: Object.freeze({ ...manifestSubject, digest: selfDigest(manifestSubject) }),
    carrierByteLength: bytes.byteLength,
    async *entries() {
      yield Object.freeze({
        path: entries[0]!.path,
        byteLength: bytes.byteLength,
        digest: entries[0]!.digest,
        async *read() {
          yield Uint8Array.from(bytes);
        },
      });
    },
  });
}
