import type { Sha256 } from "../validation/canonical.js";
import type {
  FoundationAtlasSelection,
  FoundationResolvedAtlas,
} from "../atlas/types.js";

export type FoundationAuthorityIdentity = Readonly<{
  principalId: string;
  keyId: string;
  publicKey: `ed25519:${string}`;
}>;

export type FoundationKnowledgeRoots = Readonly<{
  behavior: "records/behavior";
  assurance: "records/assurance";
  blueprint: "records/blueprint";
  check: "records/checks";
  discipline: "records/disciplines";
  disciplineRegistry: "records/disciplines/registry.json";
  descriptionPattern: "**/_*.desc.md";
}>;

export type FoundationKnowledgeLimits = Readonly<{
  maximumRecords: number;
  maximumTotalRecordBytes: number;
  maximumFileBytes: number;
  maximumFrontMatterBytes: number;
  maximumJsonDepth: number;
  maximumJsonNodes: number;
  maximumObjectProperties: number;
  maximumArrayItems: number;
  maximumBodyLines: number;
  maximumHeadings: number;
  maximumHeadingBytes: number;
  maximumPathBytes: number;
  maximumGraphNodes: number;
  maximumGraphEdges: number;
  maximumNodeDegree: number;
  maximumSources: number;
  maximumSourcesPerRecord: number;
  maximumSourceBytes: number;
  maximumTotalSourceBytes: number;
}>;

export type FoundationSourcePolicy = Readonly<{
  repository: "exact-bound-tree";
  externalLocal: "denied";
  network: "denied";
}>;

export type FoundationRepositorySelections = Readonly<{
  schemas: readonly string[];
  profiles: readonly string[];
  controlStore: "lifecycle.control-record-store.v2";
  controlLifecycleProfile: "foundation-delivery-control-lifecycle-v7";
  controlRecordRevision: "lifecycle.control-record-revision.v2";
  controlRecordEvent: "lifecycle.control-record-event.v6";
  controlReferencedFile: "lifecycle.control-record-file.v1";
  controlStoreSeal: "lifecycle.control-record-store-seal.v1";
  controlStoreArchive: "lifecycle.control-record-store-archive.v1";
  deliveryReduction: "lifecycle.delivery-reduction.v5";
  candidateRevisionCarrierManifest: "lifecycle.candidate-revision-carrier-manifest.v1";
  executionBackendProfile: "lifecycle.execution-backend-profile.docker-local.v1";
  executionCellRunner: "lifecycle.execution-cell-runner.v1";
  executionSpecification: "lifecycle.execution-specification.v1";
  executionInputSet: "lifecycle.execution-input-set.v2";
  executionImage: "lifecycle.execution-image.v1";
  executionObservation: "lifecycle.execution-observation.v1";
  executionOutputManifest: "lifecycle.execution-output-manifest.v1";
  extensions: readonly string[];
}>;

export type FoundationCoverageExemption = Readonly<{
  path: string;
  reason: string;
}>;

export type FoundationProductStatePolicy = Readonly<{
  roots: readonly string[];
  exclusions: readonly string[];
  governedImplementationRoots: readonly string[];
  coverageExemptions: readonly FoundationCoverageExemption[];
}>;

export type FoundationNetworkPolicy = Readonly<{
  mode: "none" | "loopback" | "bounded-egress";
}>;

export type FoundationCapabilityProfile = Readonly<{
  id: string;
  candidateWrites: boolean;
  temporaryWrites: boolean;
  subprocesses: "none" | "repository-toolchain";
  network: FoundationNetworkPolicy;
  credentials: "none";
  externalEffects: readonly string[];
  digest: Sha256;
}>;

export type FoundationProviderDescriptor = Readonly<{
  schema: "lifecycle.provider-descriptor.v7";
  id: string;
  adapter: Readonly<{
    id: string;
    version: string;
    implementationDigest: Sha256;
    protocol: "lifecycle.provider-adapter.v7";
  }>;
  provider: Readonly<{
    product: string;
    compatibleVersion: string;
    executableIdentityClass: string;
  }>;
  execution: Readonly<{
    mode: "command" | "sdk" | "service";
    freshInvocation: true;
    runnerRequirements: Readonly<{
      contractId: "lifecycle.execution-cell-runner.v1";
      productiveStart: "runner-mediated";
      workspace: "governed-semantic-workspace";
      output: "manifested-output-carrier";
      containmentMechanism: "execution-backend";
      containmentDecisionOwner: "lifecycle-runtime";
    }>;
  }>;
  authoring: Readonly<{
    workspaceFormat: "governed-body-only-semantic-markdown";
    workspaceFilename: "semantic.md";
    bodyProfileIds: readonly string[];
    parserProfileId: "lifecycle.agent-work-product-parser.v4";
    compilerProfileId: "lifecycle.agent-work-product-compiler.v4";
    workProductPayloadSchemaId: "urn:lifecycle:schema:agent-work-product-payload:v5";
    submissionTriggers: readonly ("clean-natural-completion" | "explicit")[];
    terminalOutputFallback: false;
    maximumBytes: number;
  }>;
  capabilitySupport: Readonly<{
    candidateWrites: boolean;
    temporaryWrites: boolean;
    subprocessModes: readonly ("none" | "repository-toolchain")[];
    agentProductNetworkModes: readonly ("none" | "loopback" | "bounded-egress")[];
    externalEffects: boolean;
  }>;
  controlPlane: Readonly<{
    networkRequirement: "none" | "fixed-service-channel";
    authenticationRequirement: "none" | "fixed-runner" | "isolated-broker";
    agentToolAccess: false;
    outputDisclosure: false;
  }>;
  cancellation: Readonly<{
    request: boolean;
    terminalObservation: true;
  }>;
  observation: Readonly<{
    events: boolean;
    stdout: boolean;
    stderr: boolean;
    sessionIdentity: boolean;
    rawProviderOutput: boolean;
    workspaceSubmission: true;
  }>;
  digest: Sha256;
}>;

export type FoundationProjectionProfile = Readonly<{
  id: string;
  maximumMandatoryItems: number;
  maximumMandatoryBytes: number;
  maximumItemBytes: number;
  maximumReachableItems: number;
  maximumReachableBytes: number;
  maximumSourceBytes: number;
  maximumRelationshipDepth: number;
  digest: Sha256;
}>;

export type FoundationCheckSubjectSelector = Readonly<{
  kind: "knowledge" | "implementation" | "candidate" | "repository" | "evidence" | "other";
  selector: string;
}>;

export type FoundationCheckResultParser = Readonly<{
  id: "exit-code-v1" | "json-v1" | "fuzz-campaign-v1";
  stateModel: "check-disposition-v2";
  states: readonly ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"];
}>;

export type FoundationCheckExecutableSelector = Readonly<{
  relativeTo: "candidate" | "execution-image";
  path: string;
}>;

export type FoundationCheckBinding = Readonly<{
  id: string;
  checkIds: readonly string[];
  subjectSelectors: readonly FoundationCheckSubjectSelector[];
  kind: "command";
  executable: FoundationCheckExecutableSelector;
  args: readonly string[];
  cwd: string;
  network: "none" | "loopback";
  timeoutMs: number;
  allowedModalities: readonly ("precondition" | "repair-target" | "regression-guard" | "postcondition" | "diagnostic")[];
  capabilityProfileId: string | null;
  environment: Readonly<Record<string, string>>;
  resultParser: FoundationCheckResultParser;
  mutation: "forbidden";
  implementationDigest: Sha256;
  limitations: readonly string[];
  digest: Sha256;
}>;

export type FoundationCommandCheckBindingInput = Readonly<
  Omit<FoundationCheckBinding, "kind" | "resultParser" | "mutation" | "digest"> & Readonly<{
    resultParser: FoundationCheckResultParser["id"];
  }>
>;

export type FoundationRepositoryContract = Readonly<{
  $schema: "lifecycle.repository.v22";
  schemaVersion: 22;
  targetId: string;
  generation: number;
  canonicalBranch: string;
  specification: Readonly<{
    id: "lifecycle";
    revision: string;
    publicationDigest: Sha256;
    status: "draft" | "accepted";
  }>;
  runtime: Readonly<{
    compatible: "lifecycle.runtime.foundation.v17";
    interface: "lifecycle.interface.foundation.v17";
  }>;
  provider: Readonly<{
    defaultDescriptorId: string;
    defaultDescriptorDigest: Sha256;
    protocol: "lifecycle.provider-adapter.v7";
  }>;
  processes: readonly ["delivery"];
  atlas: Readonly<{
    root: "atlas";
    entrypoint: "atlas/atlas.md";
    readOnly: true;
    selection: FoundationAtlasSelection;
  }>;
  knowledge: Readonly<{
    roots: FoundationKnowledgeRoots;
    owners: readonly string[];
    limits: FoundationKnowledgeLimits;
  }>;
  sourcePolicy: FoundationSourcePolicy;
  selections: FoundationRepositorySelections;
  productState: FoundationProductStatePolicy;
  checkBindings: Readonly<Record<string, FoundationCheckBinding>>;
  capabilityProfiles: Readonly<Record<string, FoundationCapabilityProfile>>;
  projectionProfiles: Readonly<Record<string, FoundationProjectionProfile>>;
  defaults: Readonly<{
    capabilityProfileId: string;
    orientationProjectionProfileId: string;
    executionProjectionProfileId: string;
    providerDescriptorId: string;
  }>;
  authority: FoundationAuthorityIdentity;
  digest: Sha256;
}>;

export type FoundationRepositoryAttachment = Readonly<{
  repository: string;
  gitCommonDirectory: string;
  contractPath: string;
  contract: FoundationRepositoryContract;
  headCommit: string;
  headTree: string;
  branch: string;
}>;

export type FoundationGitObjectFormat = "sha1" | "sha256";

export type FoundationRepositoryEpoch = Readonly<{
  ref: string;
  commit: string;
  tree: string;
  objectFormat: FoundationGitObjectFormat;
}>;

export type FoundationGitTreeEntry = Readonly<{
  path: string;
  mode: string;
  type: string;
  objectId: string;
}>;

export const FOUNDATION_PRODUCT_STATE_ROLE_PRECEDENCE = [
  "repository-contract",
  "atlas",
  "knowledge",
  "governed-implementation",
  "declared-product",
] as const;

export type FoundationProductStateRole = (typeof FOUNDATION_PRODUCT_STATE_ROLE_PRECEDENCE)[number];

export type FoundationProductStateEntry = Readonly<{
  path: string;
  mode: "100644" | "100755";
  objectId: string;
  role: FoundationProductStateRole;
}>;

export type FoundationProductState = Readonly<{
  entries: readonly FoundationProductStateEntry[];
  digest: Sha256;
}>;

export type FoundationAtlasStateEntry = Readonly<{
  path: string;
  mode: "100644";
  objectId: string;
}>;

export type FoundationAtlasState = Readonly<{
  entries: readonly FoundationAtlasStateEntry[];
  digest: Sha256;
}>;

export type FoundationAuthoritativeWorktreeState = Readonly<{
  dirty: boolean;
  modified: readonly string[];
  untracked: readonly string[];
  ignored: readonly string[];
}>;

export type FoundationRepositorySnapshotBasis = Readonly<{
  targetId: string;
  commit: string;
  tree: string;
  objectFormat: FoundationGitObjectFormat;
  contractDigest: Sha256;
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
}>;

export type FoundationRepositorySnapshot = Readonly<FoundationRepositorySnapshotBasis & {
  knowledgeSetDigest: Sha256;
  digest: Sha256;
}>;

export type FoundationLoadedRepositoryEpoch = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  epoch: FoundationRepositoryEpoch;
  treeEntries: readonly FoundationGitTreeEntry[];
  productState: FoundationProductState;
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
  worktree: FoundationAuthoritativeWorktreeState;
}>;

/**
 * Exact current repository identity without interpreting the current Atlas.
 * Admitted operations use this coordinate only to bind the physical target,
 * Repository Contract, and raw canonical tree before reopening their
 * historical Work Boundary basis.
 */
export type FoundationLoadedRepositoryIdentityEpoch = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  epoch: FoundationRepositoryEpoch;
  treeEntries: readonly FoundationGitTreeEntry[];
}>;

export type FoundationLoadedRepositorySnapshot = Readonly<FoundationLoadedRepositoryEpoch & {
  snapshot: FoundationRepositorySnapshot;
}>;
