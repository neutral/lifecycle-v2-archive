import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import { assertIndependentGitRepository } from "./independent-git.js";
import { FOUNDATION_ATLAS_SELECTION } from "../atlas/selection.js";
import {
  FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID,
  FOUNDATION_INTERFACE_PROTOCOL,
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_REPOSITORY_SCHEMA_VERSION,
  FOUNDATION_RUNTIME_PROTOCOL,
  FOUNDATION_SPECIFICATION_ID,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_SPECIFICATION_STATUS,
} from "../constants.js";
import {
  canonicalJson,
  canonicalPrettyJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema, foundationRepositorySchemaIds } from "../validation/schema-engine.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { array, enumeration, exactKeys, gitObject, integer, knowledgeId, normalizedPath, object, opaqueId, ownerId, sha256, singleLine, text, uniqueStrings } from "../validation/value.js";
import { atomicWrite } from "../support/filesystem.js";
import { protectedCheckEnvironmentName } from "../support/check-environment.js";
import { CODEX_COMPATIBILITY } from "../../version.js";
import { attachedHead, canonicalRepository, gitCommonDirectory, trackedFiles } from "./git.js";
import type {
  FoundationCapabilityProfile,
  FoundationCheckBinding,
  FoundationCommandCheckBindingInput,
  FoundationCoverageExemption,
  FoundationKnowledgeLimits,
  FoundationProjectionProfile,
  FoundationProviderDescriptor,
  FoundationRepositoryAttachment,
  FoundationRepositoryContract,
} from "./types.js";

export const FOUNDATION_REPOSITORY_CONTRACT_PATH = ".lifecycle/repository.json" as const;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}` as Sha256;
const MODALITIES = ["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"] as const;
const CHECK_BINDING_FIELDS = Object.freeze([
  "id",
  "checkIds",
  "subjectSelectors",
  "kind",
  "executable",
  "args",
  "cwd",
  "network",
  "timeoutMs",
  "allowedModalities",
  "capabilityProfileId",
  "environment",
  "resultParser",
  "mutation",
  "implementationDigest",
  "limitations",
  "digest",
] as const);
const COMMAND_CHECK_BINDING_INPUT_FIELDS = Object.freeze([
  "id",
  "checkIds",
  "subjectSelectors",
  "executable",
  "args",
  "cwd",
  "network",
  "timeoutMs",
  "allowedModalities",
  "capabilityProfileId",
  "environment",
  "resultParser",
  "implementationDigest",
  "limitations",
] as const);
const FOUNDATION_REPOSITORY_CONTRACT_SCHEMA_ID = "urn:lifecycle:schema:repository-contract:v22";
export const FOUNDATION_REPOSITORY_SCHEMA_SELECTION = foundationRepositorySchemaIds();
export const FOUNDATION_REPOSITORY_PROFILE_SELECTION = Object.freeze([
  "knowledge-set-v2",
  "knowledge-structural-v2",
  "repository-v9",
]);
export const FOUNDATION_REPOSITORY_EXTENSION_SELECTION = Object.freeze([] as string[]);
export const FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS: FoundationKnowledgeLimits = Object.freeze({
  maximumRecords: 65_536,
  maximumTotalRecordBytes: 256 * 1024 * 1024,
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFrontMatterBytes: 512 * 1024,
  maximumJsonDepth: 64,
  maximumJsonNodes: 65_536,
  maximumObjectProperties: 4_096,
  maximumArrayItems: 4_096,
  maximumBodyLines: 131_072,
  maximumHeadings: 4_096,
  maximumHeadingBytes: 16_384,
  maximumPathBytes: 4_096,
  maximumGraphNodes: 65_536,
  maximumGraphEdges: 262_144,
  maximumNodeDegree: 4_096,
  maximumSources: 262_144,
  maximumSourcesPerRecord: 128,
  maximumSourceBytes: 4 * 1024 * 1024,
  maximumTotalSourceBytes: 256 * 1024 * 1024,
});

const PROVIDER_ADAPTER_SUBJECT = Object.freeze({
  id: "codex-exec" as const,
  version: "lifecycle-foundation-v7" as const,
  protocol: FOUNDATION_PROVIDER_PROTOCOL,
});

const PROVIDER_ADAPTER = Object.freeze({
  id: PROVIDER_ADAPTER_SUBJECT.id,
  version: PROVIDER_ADAPTER_SUBJECT.version,
  implementationDigest: digestCanonical(PROVIDER_ADAPTER_SUBJECT),
  protocol: PROVIDER_ADAPTER_SUBJECT.protocol,
});

const PROVIDER_DESCRIPTOR_SUBJECT = Object.freeze({
  schema: "lifecycle.provider-descriptor.v7" as const,
  id: FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID,
  adapter: PROVIDER_ADAPTER,
  provider: Object.freeze({
    product: "openai-codex-cli" as const,
    compatibleVersion: CODEX_COMPATIBILITY.executableRange,
    executableIdentityClass: "execution-image-tool-inventory-v1" as const,
  }),
  execution: Object.freeze({
    mode: "command" as const,
    freshInvocation: true as const,
    runnerRequirements: Object.freeze({
      contractId: "lifecycle.execution-cell-runner.v1" as const,
      productiveStart: "runner-mediated" as const,
      workspace: "governed-semantic-workspace" as const,
      output: "manifested-output-carrier" as const,
      containmentMechanism: "execution-backend" as const,
      containmentDecisionOwner: "lifecycle-runtime" as const,
    }),
  }),
  authoring: Object.freeze({
    workspaceFormat: "governed-body-only-semantic-markdown" as const,
    workspaceFilename: "semantic.md" as const,
    bodyProfileIds: Object.freeze([
      "lifecycle.agent-work-product-body.builder.v4",
      "lifecycle.agent-work-product-body.reconnaissance.v4",
      "lifecycle.agent-work-product-body.reviewer.v4",
    ] as const),
    parserProfileId: "lifecycle.agent-work-product-parser.v4" as const,
    compilerProfileId: "lifecycle.agent-work-product-compiler.v4" as const,
    workProductPayloadSchemaId: "urn:lifecycle:schema:agent-work-product-payload:v5" as const,
    submissionTriggers: Object.freeze(["clean-natural-completion", "explicit"] as const),
    terminalOutputFallback: false as const,
    maximumBytes: 1024 * 1024,
  }),
  capabilitySupport: Object.freeze({
    candidateWrites: true as const,
    temporaryWrites: true as const,
    subprocessModes: Object.freeze(["none", "repository-toolchain"] as const),
    agentProductNetworkModes: Object.freeze(["none", "loopback", "bounded-egress"] as const),
    externalEffects: false as const,
  }),
  controlPlane: Object.freeze({
    networkRequirement: "fixed-service-channel" as const,
    authenticationRequirement: "fixed-runner" as const,
    agentToolAccess: false as const,
    outputDisclosure: false as const,
  }),
  cancellation: Object.freeze({
    request: true as const,
    terminalObservation: true as const,
  }),
  observation: Object.freeze({
    events: true as const,
    stdout: false as const,
    stderr: false as const,
    sessionIdentity: true as const,
    rawProviderOutput: true as const,
    workspaceSubmission: true as const,
  }),
});

export const FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR: FoundationProviderDescriptor = Object.freeze({
  ...PROVIDER_DESCRIPTOR_SUBJECT,
  digest: selfDigest(PROVIDER_DESCRIPTOR_SUBJECT),
});

/** Full installed Provider Descriptor values available to repository and Attempt validation. */
export function installedProviderDescriptors(): Readonly<Record<string, FoundationProviderDescriptor>> {
  return Object.freeze({
    [FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.id]: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
  });
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right)));
}

function exactClosedKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  code: string,
  label: string,
): void {
  const expected = new Set(required);
  const unsupported = Object.keys(value).find((key) => !expected.has(key));
  if (unsupported !== undefined) throw new FoundationError(code, `${label} has unsupported field ${unsupported}`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new FoundationError(code, `${label} is missing required field ${missing}`);
}

function exactStringSelection(value: unknown, label: string, expected: readonly string[]): readonly string[] {
  const parsed = uniqueStrings(value, label, expected.length, expected.length, 512).sort(compareCodePoints);
  if (parsed.some((entry, index) => entry !== expected[index])) {
    throw new FoundationError("lifecycle.repository.selection", `${label} must equal the exact supported selection`, {
      observedFacts: { actual: parsed, expected },
    });
  }
  return Object.freeze(parsed);
}

function parseCapabilityProfile(value: unknown, key: string): FoundationCapabilityProfile {
  const source = object(value, "lifecycle.repository.capability", `Capability profile ${key}`);
  exactKeys(source, ["id", "candidateWrites", "temporaryWrites", "subprocesses", "network", "credentials", "externalEffects", "digest"], [], "lifecycle.repository.capability", `Capability profile ${key}`);
  const network = object(source.network, "lifecycle.repository.capability", `Capability profile ${key} network`);
  exactKeys(network, ["mode"], [], "lifecycle.repository.capability", `Capability profile ${key} network`);
  const parsed: FoundationCapabilityProfile = {
    id: opaqueId(source.id, `Capability profile ${key} id`),
    candidateWrites: source.candidateWrites === true,
    temporaryWrites: source.temporaryWrites === true,
    subprocesses: enumeration(source.subprocesses, `Capability profile ${key} subprocesses`, ["none", "repository-toolchain"] as const),
    network: {
      mode: enumeration(
        network.mode,
        `Capability profile ${key} network mode`,
        ["none", "loopback", "bounded-egress"] as const,
      ),
    },
    credentials: enumeration(source.credentials, `Capability profile ${key} credentials`, ["none"] as const),
    externalEffects: uniqueStrings(source.externalEffects, `Capability profile ${key} external effects`, 0, 128, 512).sort(compareCodePoints),
    digest: sha256(source.digest, `Capability profile ${key} digest`),
  };
  if (parsed.id !== key || selfDigest(parsed) !== parsed.digest) throw new FoundationError("lifecycle.repository.capability-digest", `Capability profile ${key} identity or digest is invalid`);
  return Object.freeze(parsed);
}

function parseProjectionProfile(value: unknown, key: string): FoundationProjectionProfile {
  const source = object(value, "lifecycle.repository.projection", `Projection profile ${key}`);
  exactKeys(source, ["id", "maximumMandatoryItems", "maximumMandatoryBytes", "maximumItemBytes", "maximumReachableItems", "maximumReachableBytes", "maximumSourceBytes", "maximumRelationshipDepth", "digest"], [], "lifecycle.repository.projection", `Projection profile ${key}`);
  const parsed: FoundationProjectionProfile = {
    id: opaqueId(source.id, `Projection profile ${key} id`),
    maximumMandatoryItems: integer(source.maximumMandatoryItems, `Projection profile ${key} maximum mandatory items`, 1, 100_000),
    maximumMandatoryBytes: integer(source.maximumMandatoryBytes, `Projection profile ${key} maximum mandatory bytes`, 1024, 256 * 1024 * 1024),
    maximumItemBytes: integer(source.maximumItemBytes, `Projection profile ${key} maximum item bytes`, 1, 256 * 1024 * 1024),
    maximumReachableItems: integer(source.maximumReachableItems, `Projection profile ${key} maximum reachable items`, 0, 1_000_000),
    maximumReachableBytes: integer(source.maximumReachableBytes, `Projection profile ${key} maximum reachable bytes`, 0, 1024 * 1024 * 1024),
    maximumSourceBytes: integer(source.maximumSourceBytes, `Projection profile ${key} maximum source bytes`, 0, 256 * 1024 * 1024),
    maximumRelationshipDepth: integer(source.maximumRelationshipDepth, `Projection profile ${key} maximum relationship depth`, 1, 256),
    digest: sha256(source.digest, `Projection profile ${key} digest`),
  };
  if (parsed.id !== key || selfDigest(parsed) !== parsed.digest) throw new FoundationError("lifecycle.repository.projection-digest", `Projection profile ${key} identity or digest is invalid`);
  return Object.freeze(parsed);
}

function normalizedCheckBindingSubject(
  value: unknown,
  expectedId?: string,
): Readonly<Omit<FoundationCheckBinding, "digest">> {
  const label = expectedId === undefined ? "Check Binding" : `Check Binding ${expectedId}`;
  const source = object(value, "lifecycle.repository.binding", label);
  exactClosedKeys(source, CHECK_BINDING_FIELDS, "lifecycle.repository.binding", label);
  const environment = object(source.environment, "lifecycle.repository.binding", `${label} environment`);
  if (Object.keys(environment).length > 128) {
    throw new FoundationError(
      "lifecycle.repository.binding-environment-limit",
      `${label} environment cannot contain more than 128 variables`,
    );
  }
  const environmentValues: Record<string, string> = {};
  for (const [name, entry] of Object.entries(environment)) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) throw new FoundationError("lifecycle.repository.binding-environment", `${label} has invalid environment name ${name}`);
    if (protectedCheckEnvironmentName(name)) {
      throw new FoundationError(
        "lifecycle.repository.binding-environment-protected",
        `${label} cannot replace runtime-owned environment name ${name}`,
        { observedFacts: { bindingId: expectedId ?? null, name } },
      );
    }
    environmentValues[name] = singleLine(entry, `${label} environment ${name}`, 4096);
  }
  const subjectSelectors = array(source.subjectSelectors, `${label} subject selectors`, 1, 64).map((entry, index) => {
    const selectorLabel = `${label} subject selector ${index}`;
    const selector = object(entry, "lifecycle.repository.binding-subject", selectorLabel);
    exactClosedKeys(selector, ["kind", "selector"], "lifecycle.repository.binding-subject", selectorLabel);
    return Object.freeze({
      kind: enumeration(selector.kind, `${selectorLabel} kind`, ["knowledge", "implementation", "candidate", "repository", "evidence", "other"] as const),
      selector: text(selector.selector, `${selectorLabel} selector`),
    });
  }).sort((left, right) => compareCodePoints(`${left.kind}\0${left.selector}`, `${right.kind}\0${right.selector}`));
  if (new Set(subjectSelectors.map(({ kind, selector }) => `${kind}\0${selector}`)).size !== subjectSelectors.length) {
    throw new FoundationError("lifecycle.repository.binding-subject", `${label} repeats one subject selector`);
  }
  const parser = object(source.resultParser, "lifecycle.repository.binding-parser", `${label} result parser`);
  exactClosedKeys(parser, ["id", "stateModel", "states"], "lifecycle.repository.binding-parser", `${label} result parser`);
  const parserStates = array(parser.states, `${label} result parser states`, 6, 6);
  const expectedStates = ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] as const;
  if (parserStates.some((state, index) => state !== expectedStates[index])) {
    throw new FoundationError("lifecycle.repository.binding-parser", `${label} result parser must declare the exact check-disposition-v2 state order`);
  }
  const id = opaqueId(source.id, `${label} id`);
  if (expectedId !== undefined && id !== expectedId) {
    throw new FoundationError("lifecycle.repository.binding-digest", `Check Binding ${expectedId} identity is invalid`);
  }
  const executable = object(source.executable, "lifecycle.repository.binding-executable", `${label} executable`);
  exactClosedKeys(
    executable,
    ["relativeTo", "path"],
    "lifecycle.repository.binding-executable",
    `${label} executable`,
  );
  return Object.freeze({
    id,
    checkIds: Object.freeze(uniqueStrings(source.checkIds, `${label} Check identities`, 0, 4096, 160)
      .map((entry, index) => knowledgeId(entry, `${label} Check identity ${index}`))
      .sort(compareCodePoints)),
    subjectSelectors: Object.freeze(subjectSelectors),
    kind: enumeration(source.kind, `${label} kind`, ["command"] as const),
    executable: Object.freeze({
      relativeTo: enumeration(
        executable.relativeTo,
        `${label} executable relationship`,
        ["candidate", "execution-image"] as const,
      ),
      path: normalizedPath(executable.path, `${label} executable path`),
    }),
    args: Object.freeze(array(source.args, `${label} arguments`, 0, 256)
      .map((item, index) => text(item, `${label} argument ${index}`, 16_384))),
    cwd: source.cwd === "." ? "." : normalizedPath(source.cwd, `${label} cwd`),
    network: enumeration(source.network, `${label} network`, ["none", "loopback"] as const),
    timeoutMs: integer(source.timeoutMs, `${label} timeout`, 1, 24 * 60 * 60 * 1000),
    allowedModalities: Object.freeze(uniqueStrings(source.allowedModalities, `${label} modalities`, 1, MODALITIES.length, 64)
      .map((item, index) => enumeration(item, `${label} modality ${index}`, MODALITIES))
      .sort(compareCodePoints)),
    capabilityProfileId: source.capabilityProfileId === null ? null : opaqueId(source.capabilityProfileId, `${label} capability profile`),
    environment: Object.freeze(sortedRecord(environmentValues)),
    resultParser: Object.freeze({
      id: enumeration(parser.id, `${label} result parser identity`, ["exit-code-v1", "json-v1", "fuzz-campaign-v1"] as const),
      stateModel: enumeration(parser.stateModel, `${label} result state model`, ["check-disposition-v2"] as const),
      states: Object.freeze([...expectedStates]) as FoundationCheckBinding["resultParser"]["states"],
    }),
    mutation: enumeration(source.mutation, `${label} mutation`, ["forbidden"] as const),
    implementationDigest: sha256(source.implementationDigest, `${label} implementation digest`),
    limitations: Object.freeze(uniqueStrings(source.limitations, `${label} limitations`, 0, 128, 4096).sort(compareCodePoints)),
  });
}

export function parseFoundationCheckBinding(value: unknown, expectedId?: string): FoundationCheckBinding {
  const subject = normalizedCheckBindingSubject(value, expectedId);
  const source = value as Readonly<Record<string, unknown>>;
  const digest = sha256(source.digest, `${expectedId === undefined ? "Check Binding" : `Check Binding ${expectedId}`} digest`);
  const parsed = Object.freeze({ ...subject, digest });
  if (selfDigest(parsed) !== parsed.digest) {
    throw new FoundationError("lifecycle.repository.binding-digest", `${expectedId === undefined ? "Check Binding" : `Check Binding ${expectedId}`} digest is invalid`);
  }
  return Object.freeze(parsed);
}

export function parseFoundationCheckBindingRegistry(value: unknown): Readonly<Record<string, FoundationCheckBinding>> {
  const source = object(value, "lifecycle.repository.bindings", "Check Bindings");
  const bindings = Object.fromEntries(Object.entries(source).map(([key, entry]) => {
    const id = opaqueId(key, `Check Binding registry identity ${key}`);
    return [id, parseFoundationCheckBinding(entry, id)];
  }));
  return Object.freeze(sortedRecord(bindings));
}

export function createFoundationCommandCheckBinding(
  input: FoundationCommandCheckBindingInput,
): FoundationCheckBinding {
  const source = object(input, "lifecycle.repository.binding-input", "Command Check Binding semantic input");
  exactClosedKeys(
    source,
    COMMAND_CHECK_BINDING_INPUT_FIELDS,
    "lifecycle.repository.binding-input",
    "Command Check Binding semantic input",
  );
  const complete = {
    id: source.id,
    checkIds: source.checkIds,
    subjectSelectors: source.subjectSelectors,
    kind: "command" as const,
    executable: source.executable,
    args: source.args,
    cwd: source.cwd,
    network: source.network,
    timeoutMs: source.timeoutMs,
    allowedModalities: source.allowedModalities,
    capabilityProfileId: source.capabilityProfileId,
    environment: source.environment,
    resultParser: {
      id: source.resultParser,
      stateModel: "check-disposition-v2" as const,
      states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] as const,
    },
    mutation: "forbidden" as const,
    implementationDigest: source.implementationDigest,
    limitations: source.limitations,
    digest: ZERO_DIGEST,
  };
  const subject = normalizedCheckBindingSubject(complete);
  return parseFoundationCheckBinding({ ...subject, digest: selfDigest(subject) });
}

function parseKnowledgeLimits(value: unknown): FoundationKnowledgeLimits {
  const source = object(value, "lifecycle.repository.knowledge-limits", "Repository Knowledge limits");
  const names = Object.keys(FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS) as (keyof FoundationKnowledgeLimits)[];
  exactKeys(source, names, [], "lifecycle.repository.knowledge-limits", "Repository Knowledge limits");
  const limits = Object.fromEntries(names.map((name) => [
    name,
    integer(source[name], `Repository Knowledge limit ${name}`, 1, FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS[name]),
  ])) as unknown as FoundationKnowledgeLimits;
  if (limits.maximumFrontMatterBytes > limits.maximumFileBytes ||
      limits.maximumFileBytes > limits.maximumTotalRecordBytes ||
      limits.maximumGraphNodes > limits.maximumRecords ||
      limits.maximumNodeDegree > limits.maximumGraphEdges ||
      limits.maximumSourcesPerRecord > limits.maximumSources ||
      limits.maximumSourceBytes > limits.maximumTotalSourceBytes) {
    throw new FoundationError("lifecycle.repository.knowledge-limits", "Repository Knowledge limits have an invalid aggregate or component relationship");
  }
  return Object.freeze(limits);
}

export function defaultCapabilityProfiles(): Readonly<Record<string, FoundationCapabilityProfile>> {
  const base = {
    id: "local-development-v1",
    candidateWrites: true,
    temporaryWrites: true,
    subprocesses: "repository-toolchain" as const,
    network: { mode: "none" as const },
    credentials: "none" as const,
    externalEffects: [] as string[],
    digest: ZERO_DIGEST,
  };
  const profile = { ...base, digest: selfDigest(base) };
  return Object.freeze({ [profile.id]: Object.freeze(profile) });
}

export function defaultProjectionProfiles(): Readonly<Record<string, FoundationProjectionProfile>> {
  const values = [
    { id: "orientation-standard-v1", maximumMandatoryItems: 256, maximumMandatoryBytes: 4 * 1024 * 1024, maximumItemBytes: 1 * 1024 * 1024, maximumReachableItems: 4096, maximumReachableBytes: 32 * 1024 * 1024, maximumSourceBytes: 8 * 1024 * 1024, maximumRelationshipDepth: 24 },
    { id: "execution-standard-v1", maximumMandatoryItems: 512, maximumMandatoryBytes: 8 * 1024 * 1024, maximumItemBytes: 1 * 1024 * 1024, maximumReachableItems: 4096, maximumReachableBytes: 32 * 1024 * 1024, maximumSourceBytes: 8 * 1024 * 1024, maximumRelationshipDepth: 32 },
    { id: "execution-large-v1", maximumMandatoryItems: 4096, maximumMandatoryBytes: 64 * 1024 * 1024, maximumItemBytes: 4 * 1024 * 1024, maximumReachableItems: 16_384, maximumReachableBytes: 128 * 1024 * 1024, maximumSourceBytes: 32 * 1024 * 1024, maximumRelationshipDepth: 128 },
    { id: "orientation-large-v1", maximumMandatoryItems: 512, maximumMandatoryBytes: 8 * 1024 * 1024, maximumItemBytes: 1 * 1024 * 1024, maximumReachableItems: 4096, maximumReachableBytes: 32 * 1024 * 1024, maximumSourceBytes: 8 * 1024 * 1024, maximumRelationshipDepth: 32 },
  ].map((value) => ({ ...value, digest: selfDigest({ ...value, digest: ZERO_DIGEST }) }));
  return Object.freeze(Object.fromEntries(values.map((value) => [value.id, Object.freeze(value)])));
}

export function createRepositoryContract(options: {
  targetId: string;
  canonicalBranch: string;
  authority: FoundationRepositoryContract["authority"];
  publicationDigest: Sha256;
  owners?: readonly string[];
  implementationRoots?: readonly string[];
  coverageExemptions?: readonly FoundationCoverageExemption[];
  checkBindings?: Readonly<Record<string, FoundationCheckBinding>>;
}): FoundationRepositoryContract {
  const capabilityProfiles = defaultCapabilityProfiles();
  const projectionProfiles = defaultProjectionProfiles();
  const providerDescriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  const withoutDigest = {
    $schema: FOUNDATION_REPOSITORY_SCHEMA,
    schemaVersion: FOUNDATION_REPOSITORY_SCHEMA_VERSION,
    targetId: options.targetId,
    generation: 1,
    canonicalBranch: options.canonicalBranch,
    specification: {
      id: FOUNDATION_SPECIFICATION_ID,
      revision: FOUNDATION_SPECIFICATION_REVISION,
      publicationDigest: options.publicationDigest,
      status: FOUNDATION_SPECIFICATION_STATUS,
    },
    runtime: {
      compatible: FOUNDATION_RUNTIME_PROTOCOL,
      interface: FOUNDATION_INTERFACE_PROTOCOL,
    },
    provider: {
      defaultDescriptorId: providerDescriptor.id,
      defaultDescriptorDigest: providerDescriptor.digest,
      protocol: FOUNDATION_PROVIDER_PROTOCOL,
    },
    processes: ["delivery"] as const,
    atlas: { root: "atlas", entrypoint: "atlas/atlas.md", readOnly: true, selection: FOUNDATION_ATLAS_SELECTION },
    knowledge: {
      roots: { behavior: "records/behavior", assurance: "records/assurance", blueprint: "records/blueprint", check: "records/checks", discipline: "records/disciplines", disciplineRegistry: "records/disciplines/registry.json", descriptionPattern: "**/_*.desc.md" },
      owners: [...(options.owners ?? [options.authority.principalId])].sort(compareCodePoints),
      limits: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS,
    },
    sourcePolicy: { repository: "exact-bound-tree", externalLocal: "denied", network: "denied" },
    selections: {
      schemas: FOUNDATION_REPOSITORY_SCHEMA_SELECTION,
      profiles: FOUNDATION_REPOSITORY_PROFILE_SELECTION,
      controlStore: "lifecycle.control-record-store.v2",
      controlLifecycleProfile: "foundation-delivery-control-lifecycle-v7",
      controlRecordRevision: "lifecycle.control-record-revision.v2",
      controlRecordEvent: "lifecycle.control-record-event.v6",
      controlReferencedFile: "lifecycle.control-record-file.v1",
      controlStoreSeal: "lifecycle.control-record-store-seal.v1",
      controlStoreArchive: "lifecycle.control-record-store-archive.v1",
      deliveryReduction: "lifecycle.delivery-reduction.v5",
      candidateRevisionCarrierManifest: "lifecycle.candidate-revision-carrier-manifest.v1",
      executionBackendProfile: "lifecycle.execution-backend-profile.docker-local.v1",
      executionCellRunner: "lifecycle.execution-cell-runner.v1",
      executionSpecification: "lifecycle.execution-specification.v1",
      executionInputSet: "lifecycle.execution-input-set.v2",
      executionImage: "lifecycle.execution-image.v1",
      executionObservation: "lifecycle.execution-observation.v1",
      executionOutputManifest: "lifecycle.execution-output-manifest.v1",
      extensions: FOUNDATION_REPOSITORY_EXTENSION_SELECTION,
    },
    productState: {
      roots: [".lifecycle/repository.json", "atlas", "records/behavior", "records/assurance", "records/blueprint", "records/checks", "records/disciplines", ...(options.implementationRoots ?? ["src", "lib", "app", "packages"])].sort(compareCodePoints),
      exclusions: [".git", ".lifecycle/runtime"],
      governedImplementationRoots: [...(options.implementationRoots ?? ["src", "lib", "app", "packages"])].sort(compareCodePoints),
      coverageExemptions: [...(options.coverageExemptions ?? [])].sort((left, right) => compareCodePoints(left.path, right.path)),
    },
    checkBindings: sortedRecord({ ...(options.checkBindings ?? {}) }),
    capabilityProfiles,
    projectionProfiles,
    defaults: {
      capabilityProfileId: "local-development-v1",
      orientationProjectionProfileId: "orientation-standard-v1",
      executionProjectionProfileId: "execution-standard-v1",
      providerDescriptorId: providerDescriptor.id,
    },
    authority: options.authority,
    digest: ZERO_DIGEST,
  } as const;
  return parseRepositoryContract(Object.freeze({ ...withoutDigest, digest: selfDigest(withoutDigest) }));
}

/** Identify only a retired repository coordinate; never interpret its payload. */
export function hasPreFoundationRepositoryDiscriminator(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Readonly<Record<string, unknown>>;
  const schemaMatch = typeof source.$schema === "string"
    ? /^lifecycle\.repository\.v(?<version>[1-9][0-9]*)$/u.exec(source.$schema)
    : null;
  const schemaVersion = schemaMatch?.groups?.version === undefined
    ? null
    : Number(schemaMatch.groups.version);
  return (schemaVersion !== null && Number.isSafeInteger(schemaVersion) && schemaVersion < FOUNDATION_REPOSITORY_SCHEMA_VERSION) ||
    (Number.isSafeInteger(source.schemaVersion) && (source.schemaVersion as number) < FOUNDATION_REPOSITORY_SCHEMA_VERSION);
}

export function parseRepositoryContract(value: unknown): FoundationRepositoryContract {
  const candidate = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (candidate?.$schema !== FOUNDATION_REPOSITORY_SCHEMA || candidate.schemaVersion !== FOUNDATION_REPOSITORY_SCHEMA_VERSION) {
    const predecessor = hasPreFoundationRepositoryDiscriminator(candidate);
    if (predecessor) {
      throw new FoundationError(
        "lifecycle.repository.predecessor-unsupported",
        `Repository contract must be ${FOUNDATION_REPOSITORY_SCHEMA}; predecessor contracts are unsupported`,
      );
    }
  }
  const candidateAtlas = candidate?.atlas !== null && typeof candidate?.atlas === "object" &&
      !Array.isArray(candidate.atlas)
    ? candidate.atlas as Record<string, unknown>
    : null;
  const candidateSelection = candidateAtlas?.selection !== null &&
      typeof candidateAtlas?.selection === "object" && !Array.isArray(candidateAtlas.selection)
    ? candidateAtlas.selection as Record<string, unknown>
    : null;
  if (candidateSelection !== null) {
    const observedSelection = Object.freeze({
      release: typeof candidateSelection.release === "string" ? candidateSelection.release : null,
      specificationRevision: typeof candidateSelection.specificationRevision === "string"
        ? candidateSelection.specificationRevision
        : null,
      authoredFormat: Number.isSafeInteger(candidateSelection.authoredFormat)
        ? candidateSelection.authoredFormat
        : null,
      processorRevision: typeof candidateSelection.processorRevision === "string"
        ? candidateSelection.processorRevision
        : null,
      validationProfile: typeof candidateSelection.validationProfile === "string"
        ? candidateSelection.validationProfile
        : null,
      validationResultSchema: typeof candidateSelection.validationResultSchema === "string"
        ? candidateSelection.validationResultSchema
        : null,
      normalizedModelSchema: typeof candidateSelection.normalizedModelSchema === "string"
        ? candidateSelection.normalizedModelSchema
        : null,
      consumerProfile: typeof candidateSelection.consumerProfile === "string"
        ? candidateSelection.consumerProfile
        : null,
    });
    if (canonicalJson(observedSelection) !== canonicalJson(FOUNDATION_ATLAS_SELECTION)) {
      throw new FoundationError(
        "lifecycle.atlas.selection-unsupported",
        "Repository Atlas selection does not equal the one exact Foundation-supported contract",
        {
          observedFacts: {
            expected: FOUNDATION_ATLAS_SELECTION,
            observed: observedSelection,
          },
        },
      );
    }
  }
  assertFoundationSchema(FOUNDATION_REPOSITORY_CONTRACT_SCHEMA_ID, value, FOUNDATION_REPOSITORY_CONTRACT_PATH);
  const source = object(value, "lifecycle.repository.contract", "Repository contract");
  if (source.$schema !== FOUNDATION_REPOSITORY_SCHEMA || source.schemaVersion !== FOUNDATION_REPOSITORY_SCHEMA_VERSION) {
    throw new FoundationError(
      "lifecycle.repository.contract-invalid",
      `Repository contract must be ${FOUNDATION_REPOSITORY_SCHEMA}`,
    );
  }
  exactKeys(source, ["$schema", "schemaVersion", "targetId", "generation", "canonicalBranch", "specification", "runtime", "provider", "processes", "atlas", "knowledge", "sourcePolicy", "selections", "productState", "checkBindings", "capabilityProfiles", "projectionProfiles", "defaults", "authority", "digest"], [], "lifecycle.repository.contract", "Repository contract");
  const specification = object(source.specification, "lifecycle.repository.contract", "Repository specification binding");
  exactKeys(specification, ["id", "revision", "publicationDigest", "status"], [], "lifecycle.repository.contract", "Repository specification binding");
  const runtime = object(source.runtime, "lifecycle.repository.contract", "Repository runtime binding");
  exactKeys(runtime, ["compatible", "interface"], [], "lifecycle.repository.contract", "Repository runtime binding");
  const provider = object(source.provider, "lifecycle.repository.contract", "Repository provider binding");
  exactKeys(provider, ["defaultDescriptorId", "defaultDescriptorDigest", "protocol"], [], "lifecycle.repository.contract", "Repository provider binding");
  const atlas = object(source.atlas, "lifecycle.repository.contract", "Repository Atlas binding");
  exactKeys(atlas, ["root", "entrypoint", "readOnly", "selection"], [], "lifecycle.repository.contract", "Repository Atlas binding");
  const atlasSelection = object(atlas.selection, "lifecycle.repository.contract", "Repository Atlas selection");
  exactKeys(atlasSelection, ["release", "specificationRevision", "authoredFormat", "processorRevision", "validationProfile", "validationResultSchema", "normalizedModelSchema", "consumerProfile"], [], "lifecycle.repository.contract", "Repository Atlas selection");
  const knowledge = object(source.knowledge, "lifecycle.repository.contract", "Repository Knowledge binding");
  exactKeys(knowledge, ["roots", "owners", "limits"], [], "lifecycle.repository.contract", "Repository Knowledge binding");
  const roots = object(knowledge.roots, "lifecycle.repository.contract", "Repository Knowledge roots");
  exactKeys(roots, ["behavior", "assurance", "blueprint", "check", "discipline", "disciplineRegistry", "descriptionPattern"], [], "lifecycle.repository.contract", "Repository Knowledge roots");
  const sourcePolicy = object(source.sourcePolicy, "lifecycle.repository.contract", "Repository source policy");
  exactKeys(sourcePolicy, ["repository", "externalLocal", "network"], [], "lifecycle.repository.contract", "Repository source policy");
  const selections = object(source.selections, "lifecycle.repository.contract", "Repository support selections");
  exactKeys(selections, [
    "schemas",
    "profiles",
    "controlStore",
    "controlLifecycleProfile",
    "controlRecordRevision",
    "controlRecordEvent",
    "controlReferencedFile",
    "controlStoreSeal",
    "controlStoreArchive",
    "deliveryReduction",
    "candidateRevisionCarrierManifest",
    "executionBackendProfile",
    "executionCellRunner",
    "executionSpecification",
    "executionInputSet",
    "executionImage",
    "executionObservation",
    "executionOutputManifest",
    "extensions",
  ], [], "lifecycle.repository.contract", "Repository support selections");
  const productState = object(source.productState, "lifecycle.repository.contract", "Repository Product State policy");
  exactKeys(productState, ["roots", "exclusions", "governedImplementationRoots", "coverageExemptions"], [], "lifecycle.repository.contract", "Repository Product State policy");
  const defaults = object(source.defaults, "lifecycle.repository.contract", "Repository defaults");
  exactKeys(defaults, ["capabilityProfileId", "orientationProjectionProfileId", "executionProjectionProfileId", "providerDescriptorId"], [], "lifecycle.repository.contract", "Repository defaults");
  const authority = object(source.authority, "lifecycle.repository.contract", "Repository authority");
  exactKeys(authority, ["principalId", "keyId", "publicKey"], [], "lifecycle.repository.contract", "Repository authority");

  const coverageExemptions = array(productState.coverageExemptions, "Coverage exemptions", 0, 100_000).map((entry, index) => {
    const exemption = object(entry, "lifecycle.repository.coverage", `Coverage exemption ${index}`);
    exactKeys(exemption, ["path", "reason"], [], "lifecycle.repository.coverage", `Coverage exemption ${index}`);
    return { path: normalizedPath(exemption.path, `Coverage exemption ${index} path`), reason: text(exemption.reason, `Coverage exemption ${index} reason`, 4096) };
  }).sort((left, right) => compareCodePoints(left.path, right.path));

  const capabilitySource = object(source.capabilityProfiles, "lifecycle.repository.capabilities", "Capability profiles");
  const capabilityProfiles = sortedRecord(Object.fromEntries(Object.entries(capabilitySource).map(([key, entry]) => [key, parseCapabilityProfile(entry, key)])));
  const projectionSource = object(source.projectionProfiles, "lifecycle.repository.projections", "Projection profiles");
  const projectionProfiles = sortedRecord(Object.fromEntries(Object.entries(projectionSource).map(([key, entry]) => [key, parseProjectionProfile(entry, key)])));
  const checkBindings = parseFoundationCheckBindingRegistry(source.checkBindings);

  const contract: FoundationRepositoryContract = {
    $schema: FOUNDATION_REPOSITORY_SCHEMA,
    schemaVersion: FOUNDATION_REPOSITORY_SCHEMA_VERSION,
    targetId: opaqueId(source.targetId, "Target identity"),
    generation: integer(source.generation, "Repository generation", 1),
    canonicalBranch: (() => { const value = singleLine(source.canonicalBranch, "Canonical branch", 1024); if (!value.startsWith("refs/heads/")) throw new FoundationError("lifecycle.repository.branch", "Canonical branch must be one refs/heads reference"); return value; })(),
    specification: {
      id: enumeration(specification.id, "Specification id", [FOUNDATION_SPECIFICATION_ID] as const),
      revision: singleLine(specification.revision, "Specification revision", 512),
      publicationDigest: sha256(specification.publicationDigest, "Specification publication digest"),
      status: enumeration(specification.status, "Specification status", ["draft", "accepted"] as const),
    },
    runtime: {
      compatible: enumeration(runtime.compatible, "Runtime compatibility", [FOUNDATION_RUNTIME_PROTOCOL] as const),
      interface: enumeration(runtime.interface, "Interface compatibility", [FOUNDATION_INTERFACE_PROTOCOL] as const),
    },
    provider: {
      defaultDescriptorId: opaqueId(provider.defaultDescriptorId, "Default Provider Descriptor"),
      defaultDescriptorDigest: sha256(provider.defaultDescriptorDigest, "Default Provider Descriptor digest"),
      protocol: enumeration(provider.protocol, "Provider protocol", [FOUNDATION_PROVIDER_PROTOCOL] as const),
    },
    processes: (() => { const values = array(source.processes, "Processes", 1, 1); if (values[0] !== "delivery") throw new FoundationError("lifecycle.repository.process", "Delivery is the only foundation Process"); return ["delivery"] as const; })(),
    atlas: {
      root: enumeration(atlas.root, "Atlas root", ["atlas"] as const),
      entrypoint: enumeration(atlas.entrypoint, "Atlas entrypoint", ["atlas/atlas.md"] as const),
      readOnly: (() => {
        if (atlas.readOnly !== true) throw new FoundationError("lifecycle.repository.atlas-selection", "Repository Atlas binding must be read-only");
        return true as const;
      })(),
      selection: {
        release: enumeration(atlasSelection.release, "Atlas release", [FOUNDATION_ATLAS_SELECTION.release] as const),
        specificationRevision: enumeration(atlasSelection.specificationRevision, "Atlas specification revision", [FOUNDATION_ATLAS_SELECTION.specificationRevision] as const),
        authoredFormat: (() => {
          if (atlasSelection.authoredFormat !== FOUNDATION_ATLAS_SELECTION.authoredFormat) throw new FoundationError("lifecycle.repository.atlas-selection", "Repository Atlas authored format is unsupported");
          return FOUNDATION_ATLAS_SELECTION.authoredFormat;
        })(),
        processorRevision: enumeration(atlasSelection.processorRevision, "Atlas processor revision", [FOUNDATION_ATLAS_SELECTION.processorRevision] as const),
        validationProfile: enumeration(atlasSelection.validationProfile, "Atlas validation profile", [FOUNDATION_ATLAS_SELECTION.validationProfile] as const),
        validationResultSchema: enumeration(atlasSelection.validationResultSchema, "Atlas Validation Result schema", [FOUNDATION_ATLAS_SELECTION.validationResultSchema] as const),
        normalizedModelSchema: enumeration(atlasSelection.normalizedModelSchema, "Atlas normalized-model schema", [FOUNDATION_ATLAS_SELECTION.normalizedModelSchema] as const),
        consumerProfile: enumeration(atlasSelection.consumerProfile, "Atlas consumer profile", [FOUNDATION_ATLAS_SELECTION.consumerProfile] as const),
      },
    },
    knowledge: {
      roots: {
        behavior: enumeration(roots.behavior, "Behavior root", ["records/behavior"] as const),
        assurance: enumeration(roots.assurance, "Assurance root", ["records/assurance"] as const),
        blueprint: enumeration(roots.blueprint, "Blueprint root", ["records/blueprint"] as const),
        check: enumeration(roots.check, "Check root", ["records/checks"] as const),
        discipline: enumeration(roots.discipline, "Discipline root", ["records/disciplines"] as const),
        disciplineRegistry: enumeration(roots.disciplineRegistry, "Discipline registry", ["records/disciplines/registry.json"] as const),
        descriptionPattern: enumeration(roots.descriptionPattern, "Description pattern", ["**/_*.desc.md"] as const),
      },
      owners: uniqueStrings(knowledge.owners, "Knowledge owners", 1, 4096, 160).map((entry, index) => ownerId(entry, `Knowledge owner ${index}`)).sort(compareCodePoints),
      limits: parseKnowledgeLimits(knowledge.limits),
    },
    sourcePolicy: {
      repository: enumeration(sourcePolicy.repository, "Repository source policy", ["exact-bound-tree"] as const),
      externalLocal: enumeration(sourcePolicy.externalLocal, "External-local source policy", ["denied"] as const),
      network: enumeration(sourcePolicy.network, "Network source policy", ["denied"] as const),
    },
    selections: {
      schemas: exactStringSelection(selections.schemas, "Repository schema selection", FOUNDATION_REPOSITORY_SCHEMA_SELECTION),
      profiles: exactStringSelection(selections.profiles, "Repository validation-profile selection", FOUNDATION_REPOSITORY_PROFILE_SELECTION),
      controlStore: enumeration(selections.controlStore, "Repository Control Store", ["lifecycle.control-record-store.v2"] as const),
      controlLifecycleProfile: enumeration(selections.controlLifecycleProfile, "Repository Control lifecycle profile", ["foundation-delivery-control-lifecycle-v7"] as const),
      controlRecordRevision: enumeration(selections.controlRecordRevision, "Repository Control record revision", ["lifecycle.control-record-revision.v2"] as const),
      controlRecordEvent: enumeration(selections.controlRecordEvent, "Repository Control record event", ["lifecycle.control-record-event.v6"] as const),
      controlReferencedFile: enumeration(selections.controlReferencedFile, "Repository Control referenced file", ["lifecycle.control-record-file.v1"] as const),
      controlStoreSeal: enumeration(selections.controlStoreSeal, "Repository Control Store seal", ["lifecycle.control-record-store-seal.v1"] as const),
      controlStoreArchive: enumeration(selections.controlStoreArchive, "Repository Control Store archive", ["lifecycle.control-record-store-archive.v1"] as const),
      deliveryReduction: enumeration(selections.deliveryReduction, "Repository Delivery reduction", ["lifecycle.delivery-reduction.v5"] as const),
      candidateRevisionCarrierManifest: enumeration(selections.candidateRevisionCarrierManifest, "Repository Candidate Revision Carrier manifest", ["lifecycle.candidate-revision-carrier-manifest.v1"] as const),
      executionBackendProfile: enumeration(selections.executionBackendProfile, "Repository Execution Backend Profile", ["lifecycle.execution-backend-profile.docker-local.v1"] as const),
      executionCellRunner: enumeration(selections.executionCellRunner, "Repository Execution Cell runner", ["lifecycle.execution-cell-runner.v1"] as const),
      executionSpecification: enumeration(selections.executionSpecification, "Repository Execution Specification", ["lifecycle.execution-specification.v1"] as const),
      executionInputSet: enumeration(selections.executionInputSet, "Repository Execution Input Set", ["lifecycle.execution-input-set.v2"] as const),
      executionImage: enumeration(selections.executionImage, "Repository Execution Image", ["lifecycle.execution-image.v1"] as const),
      executionObservation: enumeration(selections.executionObservation, "Repository Execution Observation", ["lifecycle.execution-observation.v1"] as const),
      executionOutputManifest: enumeration(selections.executionOutputManifest, "Repository Execution Output Manifest", ["lifecycle.execution-output-manifest.v1"] as const),
      extensions: exactStringSelection(selections.extensions, "Repository extension selection", FOUNDATION_REPOSITORY_EXTENSION_SELECTION),
    },
    productState: {
      roots: uniqueStrings(productState.roots, "Product State roots", 1, 4096, 4096).map((entry, index) => normalizedPath(entry, `Product State root ${index}`)).sort(compareCodePoints),
      exclusions: uniqueStrings(productState.exclusions, "Product State exclusions", 1, 4096, 4096).map((entry, index) => normalizedPath(entry, `Product State exclusion ${index}`)).sort(compareCodePoints),
      governedImplementationRoots: uniqueStrings(productState.governedImplementationRoots, "Governed implementation roots", 0, 4096, 4096).map((entry, index) => normalizedPath(entry, `Governed implementation root ${index}`)).sort(compareCodePoints),
      coverageExemptions,
    },
    checkBindings,
    capabilityProfiles,
    projectionProfiles,
    defaults: {
      capabilityProfileId: opaqueId(defaults.capabilityProfileId, "Default capability profile"),
      orientationProjectionProfileId: opaqueId(defaults.orientationProjectionProfileId, "Default Orientation Projection profile"),
      executionProjectionProfileId: opaqueId(defaults.executionProjectionProfileId, "Default Execution Projection profile"),
      providerDescriptorId: opaqueId(defaults.providerDescriptorId, "Default Provider Descriptor"),
    },
    authority: {
      principalId: ownerId(authority.principalId, "Authority principal"),
      keyId: opaqueId(authority.keyId, "Authority key"),
      publicKey: (() => { const value = text(authority.publicKey, "Authority public key", 4096); if (!value.startsWith("ed25519:")) throw new FoundationError("lifecycle.repository.authority-key", "Authority public key must be Ed25519"); return value as `ed25519:${string}`; })(),
    },
    digest: sha256(source.digest, "Repository contract digest"),
  };

  if (!(contract.defaults.capabilityProfileId in contract.capabilityProfiles)) throw new FoundationError("lifecycle.repository.default-capability", "Default capability profile is not registered");
  if (!(contract.defaults.orientationProjectionProfileId in contract.projectionProfiles) || !(contract.defaults.executionProjectionProfileId in contract.projectionProfiles)) throw new FoundationError("lifecycle.repository.default-projection", "Default Projection profile is not registered");
  if (contract.defaults.providerDescriptorId !== contract.provider.defaultDescriptorId) throw new FoundationError("lifecycle.repository.default-provider", "Default Provider Descriptor does not match the repository provider selection");
  for (const binding of Object.values(contract.checkBindings)) {
    if (binding.capabilityProfileId !== null && !(binding.capabilityProfileId in contract.capabilityProfiles)) throw new FoundationError("lifecycle.repository.binding-capability", `Check Binding ${binding.id} references an unknown capability profile`);
  }
  if (contract.specification.revision !== FOUNDATION_SPECIFICATION_REVISION) throw new FoundationError("lifecycle.repository.specification", `Repository selects unsupported specification revision ${contract.specification.revision}`);
  if (selfDigest(contract) !== contract.digest) throw new FoundationError("lifecycle.repository.digest", "Repository contract digest does not match its exact canonical subject");
  return Object.freeze(contract);
}

export async function readRepositoryContract(repository: string): Promise<FoundationRepositoryContract> {
  const path = join(repository, FOUNDATION_REPOSITORY_CONTRACT_PATH);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new FoundationError("lifecycle.repository.contract-missing", `Repository contract is unavailable at ${FOUNDATION_REPOSITORY_CONTRACT_PATH}`, { observedFacts: { cause: error instanceof Error ? error.message : String(error) } });
  }
  return parseRepositoryContract(parseStrictJson(raw, { source: FOUNDATION_REPOSITORY_CONTRACT_PATH }));
}

export async function writeRepositoryContract(repository: string, contract: FoundationRepositoryContract): Promise<void> {
  await atomicWrite(join(repository, FOUNDATION_REPOSITORY_CONTRACT_PATH), canonicalPrettyJson(contract), 0o644);
}

export async function loadRepositoryContract(path: string): Promise<{ repository: string; contract: FoundationRepositoryContract }> {
  const repository = await canonicalRepository(path);
  await assertIndependentGitRepository(repository);
  return { repository, contract: await readRepositoryContract(repository) };
}

async function assertNoTrackedControl(repository: string, commit: string): Promise<void> {
  const controlPaths = (await trackedFiles(repository, commit)).filter(
    (path) => path === "records/control" || path.startsWith("records/control/"),
  );
  for (const path of controlPaths) {
    throw new FoundationError(
      "lifecycle.repository.epoch-mixed",
      `Fresh repository v22 attachment refuses tracked Delivery Control at ${path}; Control Record Stores remain off HEAD in runtime custody`,
      { observedFacts: { path } },
    );
  }
}

export async function attachRepository(path: string): Promise<FoundationRepositoryAttachment> {
  const repository = await canonicalRepository(path);
  await assertIndependentGitRepository(repository);
  const [contract, head, common] = await Promise.all([readRepositoryContract(repository), attachedHead(repository), gitCommonDirectory(repository)]);
  await assertNoTrackedControl(repository, head.commit);
  if (head.branch !== contract.canonicalBranch) throw new FoundationError("lifecycle.repository.branch-mismatch", "Attached branch does not match the repository contract", { observedFacts: { actual: head.branch, expected: contract.canonicalBranch } });
  return Object.freeze({ repository, gitCommonDirectory: common, contractPath: resolve(repository, FOUNDATION_REPOSITORY_CONTRACT_PATH), contract, headCommit: gitObject(head.commit, "HEAD commit"), headTree: gitObject(head.tree, "HEAD tree"), branch: head.branch });
}
