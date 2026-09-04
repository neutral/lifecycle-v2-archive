import {
  parseFoundationExecutionBackendProfile,
  type FoundationExecutionBackendProfileV1,
} from "./contracts.js";
import { digestCanonical, selfDigest } from "../validation/canonical.js";

const IMPLEMENTATION = Object.freeze({
  schema: "lifecycle.docker-execution-backend-implementation.private.v1",
  backend: "runtime.execution-backend.docker-cli-v1",
  driver: "lifecycle.execution.docker-cli-engine-driver.v1",
  transport: "bounded-archive",
  runner: "lifecycle.execution-cell-runner.v1",
  authenticatedAgentIsolation:
    "internal-cell-network-plus-fixed-destination-tls-proxy-plus-current-codex-restricted-read-networkless-inner-sandbox",
});

const ENGINE_CONTRACT = Object.freeze({
  schema: "lifecycle.docker-engine-contract.private.v1",
  apiCompatibility: "1.48",
  requiredPlatform: "linux",
  immutableImages: true,
});

/** Exact first production profile; installation selects Engine and Image, not policy. */
export function foundationDockerExecutionBackendProfileV1():
FoundationExecutionBackendProfileV1 {
  const subject = {
    schema: "lifecycle.execution-backend-profile.v1",
    profileId: "lifecycle.execution-backend-profile.docker-local.v1",
    backendKind: "docker-local",
    usage: "production",
    implementation: {
      id: "runtime.execution-backend.docker-cli",
      version: "1.0.0",
      implementationDigest: digestCanonical(IMPLEMENTATION),
      contractDigest: digestCanonical({
        schema: "lifecycle.docker-execution-backend-contract.private.v1",
        allocation: "deterministic",
        dispatch: "one-time",
        observation: "direct",
        containment: "required",
        retirement: "required",
        reclamation: "asynchronous-private",
      }),
    },
    engineContract: {
      kind: "docker-engine",
      compatibilityProfileId: "docker-engine-api-v1-48",
      compatibleVersion: "1.48",
      contractDigest: digestCanonical(ENGINE_CONTRACT),
    },
    platforms: [
      { os: "linux", architecture: "amd64", variant: null },
      { os: "linux", architecture: "arm64", variant: null },
    ],
    isolation: {
      mechanism: "oci-container",
      nonRootRunner: true,
      privileged: false,
      hostPidNamespace: false,
      hostNetworkNamespace: false,
      dockerSocket: false,
      canonicalRepositoryMount: false,
      runtimeCustodyMount: false,
      completeProcessBoundary: true,
      productionIsolationClaim: true,
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
      providerControlPlaneModes: ["none", "fixed-service-channel"],
      agentProductNetworkModes: ["none"],
      separationRequired: true,
    },
    credentialPolicy: {
      injectionModes: ["none", "fixed-runner"],
      agentAccess: false,
      outputDisclosure: false,
      diagnosticDisclosure: false,
    },
    limits: {
      maximumWallTimeMilliseconds: 86_400_000,
      maximumProcesses: 1_024,
      maximumStorageBytes: 10_737_418_240,
      maximumOutputEntries: 100_000,
      maximumOutputBytes: 1_073_741_824,
      maximumOutputEntryBytes: 268_435_456,
      maximumEvents: 1_000_000,
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
  return parseFoundationExecutionBackendProfile(Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }));
}
