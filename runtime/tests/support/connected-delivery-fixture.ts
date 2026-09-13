import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDeliveryControlRecordStore, openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import type { ControlRecordRevision } from "../../src/foundation/control/types.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import { FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { git } from "../../src/foundation/repository/git.js";
import type { FoundationCheckBinding } from "../../src/foundation/repository/types.js";
import { preflightFoundationPreparationBasisV7 } from "../../src/foundation/process/preparation-context-v7.js";
import { operateFoundationPreparationRuntimeV7 } from "../../src/foundation/process/preparation-runtime-v7.js";
import { operateFoundationCandidateAgentRuntimeV7 } from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import { operateFoundationIntegrationRuntimeV1 } from "../../src/foundation/process/integration-runtime-v1.js";
import { evaluateDeliveryV7 } from "../../src/foundation/process/evaluation-runtime-v7.js";
import { admitDeliveryV7 } from "../../src/foundation/transaction/admission-v7.js";
import { importCandidateRevisionCarrierIntoRepository } from "../../src/foundation/candidate/carrier-import.js";
import { FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1 } from "../../src/foundation/attempt/execution-cell-v1.js";
import { FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1 } from "../../src/util/agent-execution-cell-operation-v1.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { executionContractFixture } from "./execution-contract-fixture.js";
import { installedHarness, type AgentCellFixtureOutputEntry, type AgentCellFixtureOutputProducer } from "./agent-cell-runtime-fixture.js";
import { installedDockerAgentHarness } from "./docker-agent-cell-runtime-fixture.js";
import { createConnectedCheckOperator } from "./connected-check-cell.js";

const SECRET = "connected-operation-fixture-authority-not-a-production-secret";
export function connectedAuthorityCredential(purpose: Parameters<typeof receiveFoundationAuthorityCredential>[1]): ReturnType<typeof receiveFoundationAuthorityCredential> {
  return receiveFoundationAuthorityCredential(SECRET, purpose);
}
export const CONNECTED_RUNTIME_ID = "runtime:connected-course";
export const CONNECTED_DIRECTOR_ID = "director:connected-course";
export const CONNECTED_BACKEND_LIMITS = Object.freeze({ maximumWallTimeMilliseconds: 30 * 60 * 1000, maximumProcesses: 128,
  maximumStorageBytes: 256 * 1024 * 1024, maximumOutputEntries: 10000, maximumOutputBytes: 256 * 1024 * 1024,
  maximumOutputEntryBytes: 4 * 1024 * 1024, maximumEvents: 10000 });

export async function writeConnectedFile(root: string, path: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}

export function connectedKnowledgeDocument(kind: "description" | "check" | "blueprint"): string {
  const specs = {
    description: { responsibility: "Own the connected source.", coverage: [{ path: "src", mode: "tree", role: "primary", exclude: [] }],
      behavior: ["exposes the requested value"], boundaries: ["no authority effects"], invariants: ["tracked source"], dependencies: [], failure: ["wrong result"], rationale: ["one owner"] },
    check: { proposition: "The source satisfies its bounded contract.", subjects: [{ kind: "candidate", selector: "src/demo.ts" }], evidenceKinds: ["command"],
      requiredBindings: ["binding.check.demo"], evaluation: { pass: "Expected result", fail: "Wrong result", indeterminate: "Unavailable", notRun: "Not executed" },
      limits: ["Deterministic test execution is not operated qualification"], freshness: { subjectBinding: "exact", maximumAgeMs: null, environmentBinding: "exact" }, falsifiers: ["Wrong source"] },
    blueprint: { decision: "Keep the source behavior explicit.", scope: ["source"], components: ["demo"], constraints: ["one entrypoint"], interfaces: ["demo"],
      dataFlows: ["input to result"], tradeoffs: ["explicit behavior"], evolution: [] },
  };
  const sections = { description: ["Responsibility", "Behavior", "Boundaries", "Rationale"], check: ["Proposition", "Evaluation", "Evidence", "Limits"], blueprint: ["Decision", "Structure", "Tradeoffs", "Evolution"] };
  const fields = { schema: "lifecycle.knowledge-record.v2", kind, id: `${kind}.demo`, title: `Connected ${kind}`, status: "current", revision: 1, supersedes: null,
    summary: `Own the connected ${kind}.`, owners: [CONNECTED_DIRECTOR_ID], sources: [], relationships: [], conflicts: [], tags: [], spec: specs[kind] };
  return `---\n${JSON.stringify(fields, null, 2)}\n---\n\n# Connected ${kind}\n\n${sections[kind].map((section) => `## ${section}\n\n${section} for the bounded source.`).join("\n\n")}\n`;
}

export function connectedPreparationMarkdown(profile = "execution-standard-v1", artifactPath = "src/demo.ts"): string {
  return ["# Reconnaissance Work Product", "## Outcome", "- Uncertainty: bounded", "The requested change has a complete bounded route.",
    "## Claims", "### Claim: route", "- Category: route", "- State: proposed", "- Uncertainty: bounded", "- Knowledge: check.demo", "- Knowledge: blueprint.demo", "The selected owners support the bounded route.",
    "## Citations", "### Citation: check-owner", "- Subject: check.demo", "- Supports: route", "### Citation: blueprint-owner", "- Subject: blueprint.demo", "- Supports: route",
    "## Proposal", "- Kind: work-boundary", "- Selected Knowledge: check.demo", "- Selected Knowledge: blueprint.demo",
    `- Projection profile: ${profile}`, "- Capability profile: local-development-v1", "### Objective", "Make the source expose the requested value and preserve coherent Knowledge revisions.",
    "### Mandate", "- Included: Change the source and its Product Knowledge coherently.", "- Why now: Complete the connected Runtime course.",
    "Preserve exact reversible progress across Attempts.", "### Obligation: result", "- Kind: behavior", "- Severity: required", "- Source: mandate", "- Source: blueprint.demo",
    "- Required evidence artifact: source", "The source exposes the requested value.",
    "### Artifact: source", `- Path: ${artifactPath}`, "- Role: code", "- Must change: true", "- Obligation: result", "Retain the exact source.",
    "### Check: source-check", "- Check Knowledge: check.demo", "- Binding: binding.check.demo", "- Modality: regression-guard", "- Baseline required: true", "- Final required: true", "- Obligation: result", "Observe the bounded source result.",
    "### Proposition: source-result", "- Obligation: result", "- Check: source-check", "- Evidence artifact: source", "- Evidence kind: artifact", `- Path: ${artifactPath}`, "The exact source satisfies the requested result.", ""].join("\n");
}

export function connectedBuilderMarkdown(): string {
  return "# Builder Work Product\n\n## Outcome\n- Disposition: partial\n- Uncertainty: bounded\nThe Candidate contains useful coherent progress.\n\n## Proposal\n- Kind: progress\n";
}

export type ConnectedAgentInput = Parameters<AgentCellFixtureOutputProducer>[0];
export type ConnectedSemantic = string | ((input: ConnectedAgentInput) => string);
export type ConnectedContinueOptions = Readonly<{
  activityId?: string;
  edit?: (repository: string, input: ConnectedAgentInput) => Promise<void>;
  semanticMarkdown?: ConnectedSemantic | null;
  providerExitCode?: number;
  providerOutcome?: "natural-return" | "provider-failure";
  operation?: "delivery.continue" | "delivery.revise" | "delivery.reaffirm";
  direction?: string;
}>;

export function connectedReviewerMarkdown(input: ConnectedAgentInput): string {
  const brief = Buffer.from(input.inputEntries.get("role-brief.md")!).toString("utf8");
  const citations = [...brief.matchAll(/^- Citation handle: `([^`]+)`/gm)].map((match) => match[1]!);
  assert(citations.length > 0);
  const section = brief.split("### Acceptance Propositions\n")[1]?.split("### Capability Direction")[0];
  assert(section !== undefined);
  const propositions = [...section.matchAll(/^- (\S+): /gm)].map((match) => match[1]!);
  assert(propositions.length > 0);
  const baselines = new Set<string>();
  for (const bytes of input.inputEntries.values()) {
    const text = Buffer.from(bytes).toString("utf8");
    if (!text.startsWith("---\n")) continue;
    let value: { recordKind?: string; recordId?: string; payload?: { phase?: string } };
    try { value = JSON.parse(text.split("---\n")[1]!); } catch { continue; }
    if (value.recordKind === "check-receipt" && value.payload?.phase === "baseline" && value.recordId !== undefined) baselines.add(value.recordId);
  }
  assert(baselines.size > 0);
  return ["# Reviewer Work Product", "## Outcome", "- Disposition: complete", "- Uncertainty: bounded", "The exact supplied subjects support the bounded result.",
    "## Claims", "### Claim: review-result", "- Category: completed", "- State: proposed", "- Uncertainty: bounded", "- Path: src/demo.ts", "The supplied subjects support the reviewed source result.",
    "## Citations", ...citations.flatMap((subject, index) => [`### Citation: inspected-${index}`, `- Subject: ${subject}`, "- Supports: review-result"]),
    "## Review", "- Mandate excess: false", "### Mandate Applicability: applicability", "- Disposition: applicable", ...citations.map((_, index) => `- Citation: inspected-${index}`),
    "The admitted mandate remains applicable to the exact parent and Candidate.",
    ...[...baselines].sort().flatMap((receipt, index) => [`### Baseline Applicability: baseline-${index}`, `- Receipt: ${receipt}`, "- Disposition: applicable",
      ...citations.map((_, citation) => `- Citation: inspected-${citation}`), "The exact original baseline remains applicable to the integrated result."]),
    ...propositions.flatMap((id, index) => [`### Decision: decision-${index}`, `- Proposition: ${id}`, "- Disposition: accepted", "- Uncertainty: bounded",
      ...citations.map((_, citation) => `- Citation: inspected-${citation}`), "The supplied exact evidence supports the proposition."]), ""].join("\n");
}

export function connectedSemanticEntry(markdown: string): AgentCellFixtureOutputEntry {
  return { path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath, purpose: "agent-work-product",
    mediaType: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspaceMediaType, modeClass: "regular", bytes: Buffer.from(markdown) };
}

export async function connectedCandidateOutput(options: Readonly<{
  machineHome: string; workspace: string; input: ConnectedAgentInput;
  edit?: ConnectedContinueOptions["edit"];
}>): Promise<readonly AgentCellFixtureOutputEntry[]> {
  const { machineHome, workspace, input: selected } = options;
  const entries: AgentCellFixtureOutputEntry[] = [];
  const manifestBytes = selected.inputEntries.get(FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateManifestPath);
  assert(manifestBytes !== undefined);
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as { rootTree: string };
  const repo = await mkdtemp(join(workspace, "output-"));
  try {
    await git(repo, ["init", "-b", "work"]);
    await importCandidateRevisionCarrierIntoRepository({ machineHome, repository: repo, manifestBytes, expectedRootTree: manifest.rootTree });
    await git(repo, ["read-tree", "--reset", "-u", manifest.rootTree]);
    await options.edit?.(repo, selected);
    await git(repo, ["add", "-A", "."]);
    for (const entry of (await git(repo, ["ls-files", "--stage", "-z"])).stdout.split("\0").filter(Boolean)) {
      const [meta, path] = entry.split("\t"); assert(path !== undefined);
      entries.push({ path: `candidate-output/${path}`, purpose: "candidate-output", mediaType: "application/octet-stream",
        modeClass: meta!.startsWith("100755") ? "executable" : "regular", bytes: await readFile(join(repo, path)) });
    }
  } finally { await rm(repo, { recursive: true, force: true }); }
  return entries;
}

export function connectedRuntimeConfiguration(machineHome: string): FoundationProcessRuntimeConfigurationV7 {
  const image = executionContractFixture("agent-operation-v7").image;
  const d = (label: string) => sha256Bytes(`foundation-agent-operation-v7:${label}`);
  return { machineHome, installationId: "installation-agent-operation-v7", model: "deterministic-test", reasoning: "high",
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION, publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    execution: { image: { ...image, immutableReference: `${image.imageId}@${image.imageDigest}`, configurationDigest: d("image-configuration"),
      platform: { os: "linux", architecture: "amd64", variant: null }, nonRootUser: "65532:65532", runnerContractId: "lifecycle.execution-cell-runner.v1",
      runnerContractDigest: d("runner-contract"), runnerImplementationDigest: d("runner-implementation"), toolInventoryDigest: d("tool-inventory"),
      agentProvider: { codexVersion: "0.153.4", executableIdentity: d("agent-executable"), adapterImplementationDigest: d("runner-implementation") } } } };
}

export async function createConnectedDeliveryFixture(input: Readonly<{
  id: string;
  configureTarget?: (target: string) => Promise<void>;
  additionalCheckBindings?: readonly FoundationCheckBinding[];
  /** Real Docker Backend with deterministic Engine observations; no operated Docker claim. */
  agentBackend?: "docker-observed";
}>) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-connected-")));
  let setupStore: ControlRecordStore | null = null;
  let setupCheck: Awaited<ReturnType<typeof createConnectedCheckOperator>> | null = null;
  try {
    const target = join(workspace, "target"), machineHome = join(workspace, "machine"), authorityHome = join(workspace, "authority");
    for (const path of [target, machineHome, authorityHome]) await mkdir(path, { mode: 0o700 });
    await chmod(machineHome, 0o700);
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "."]); await git(target, ["commit", "-m", "Create Atlas"]);
    const binding = commandCheckBinding({ id: "binding.check.demo", checkIds: ["check.demo"], subjectSelectors: [{ kind: "candidate", selector: "src/demo.ts" }], executable: { relativeTo: "execution-image", path: "usr/bin/true" } });
    const contract = await initializeRepository(target, { targetId: `target-${input.id}`, directorPrincipal: CONNECTED_DIRECTOR_ID, home: authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"), publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: ["src"], checkBindings: Object.fromEntries([binding, ...(input.additionalCheckBindings ?? [])].map(value => [value.id, value])), stage: true });
    await writeConnectedFile(target, "src/demo.ts", "export const value = 'base';\n");
    await writeConnectedFile(target, "src/_source.desc.md", connectedKnowledgeDocument("description"));
    await writeConnectedFile(target, "records/checks/demo.md", connectedKnowledgeDocument("check"));
    await writeConnectedFile(target, "records/blueprint/demo.md", connectedKnowledgeDocument("blueprint"));
    await input.configureTarget?.(target);
    await git(target, ["add", "."]); await git(target, ["commit", "-m", "Create coherent connected basis"]);
    let tick = Date.parse("2026-09-05T00:00:00.000Z");
    const now = () => new Date(tick += 1000).toISOString();
    const deliveryId = `delivery-${input.id}`;
    let store = (await createDeliveryControlRecordStore({ machineHome, targetId: contract.targetId, deliveryId, createdAt: now(), runtimeActorId: CONNECTED_RUNTIME_ID })).store;
    setupStore = store;
    const configuration = connectedRuntimeConfiguration(machineHome);
    const check = await createConnectedCheckOperator({ machineHome, now });
    setupCheck = check;
    let sequence = 0;
    const invocations: { activityId: string; input: ConnectedAgentInput; dispatches: number }[] = [];
    const harness = (activityId: string, producer: AgentCellFixtureOutputProducer) => {
      const produceOutput: AgentCellFixtureOutputProducer = async (selected) => {
        invocations.push({ activityId, input: selected, dispatches: 1 });
        try { return await producer(selected); }
        catch (error) {
          // The real host truthfully reports a thrown backend callback as lost
          // dispatch. Preserve the test assertion that caused that interruption.
          const detail = error instanceof Error ? error.stack ?? error.message : String(error);
          process.stderr.write(`Connected fixture Output producer ${activityId} failed:\n${detail.slice(0, 4096)}\n`);
          throw error;
        }
      };
      return input.agentBackend === "docker-observed"
        ? installedDockerAgentHarness({ machineHome, installationId: configuration.installationId!, now, produceOutput })
        : installedHarness({ machineHome, now, backendLimits: CONNECTED_BACKEND_LIMITS, produceOutput });
    };
    const current = (kind: "candidate" | "activeBoundary" | "proposedBoundary"): ControlRecordRevision => {
      const ref = store.state().subjects[kind]; assert(ref !== null); const value = store.getRevision(ref.id, ref.revision); assert(value !== null); return value;
    };
    const fixture = {
      workspace, target, machineHome, authorityHome, contract, configuration, deliveryId, now, invocations, check,
      get store() { return store; }, current,
      async prepare(markdown: ConnectedSemantic = connectedPreparationMarkdown()) {
        const activityId = `prepare-${++sequence}`;
        const basis = await preflightFoundationPreparationBasisV7({ target, semanticMarkdown: "# Prepare\n\nChange the source and preserve coherent Knowledge revisions.\n", observedAt: now() });
        const agent = harness(activityId, async (selected) => ({ entries: [connectedSemanticEntry(typeof markdown === "string" ? markdown : markdown(selected))] }));
        return operateFoundationPreparationRuntimeV7({ store, configuration, activityId, runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:reconnaissance",
          submittedAt: now(), startedAt: now(), attemptCreatedAt: now(), basis }, { agentOperation: agent.options, boundaryFinalization: { machineHome, checkCellOperator: check.operator, now, checkOperation: { now } } });
      },
      async admit() { return admitDeliveryV7({ target, machineHome, store, authorityHome, authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: CONNECTED_RUNTIME_ID }, { now }); },
      async continue(options: ConnectedContinueOptions = {}) {
        const activityId = options.activityId ?? `continue-${++sequence}`;
        const operation = options.operation ?? "delivery.continue";
        const agent = harness(activityId, async (selected) => {
          const entries: AgentCellFixtureOutputEntry[] = [];
          if (operation === "delivery.continue") entries.push(...await connectedCandidateOutput({ machineHome, workspace, input: selected, edit: options.edit }));
          const semantic = options.semanticMarkdown === undefined ? connectedBuilderMarkdown() : options.semanticMarkdown;
          if (semantic !== null) entries.push(connectedSemanticEntry(typeof semantic === "string" ? semantic : semantic(selected)));
          return { entries, providerExitCode: options.providerExitCode, providerOutcome: options.providerOutcome };
        });
        return operateFoundationCandidateAgentRuntimeV7({ target, store, configuration, activityId, operation, runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:builder",
          opening: { directorId: CONNECTED_DIRECTOR_ID, semanticMarkdown: options.direction ?? "# Continue\n\nComplete the admitted source change.\n", submittedAt: now(), startedAt: now(), attemptCreatedAt: now() } },
        { agentOperation: agent.options, boundaryFinalization: { now, checkCellOperator: check.operator, checkOperation: { now } } });
      },
      async integrate() { return operateFoundationIntegrationRuntimeV1({ target, machineHome, store, activityId: `integrate-${++sequence}`, runtimeId: CONNECTED_RUNTIME_ID }, { now }); },
      async evaluate(markdown: ConnectedSemantic = connectedReviewerMarkdown) {
        const activityId = `evaluate-${++sequence}`;
        const agent = harness(activityId, async (selected) => ({ entries: [connectedSemanticEntry(typeof markdown === "string" ? markdown : markdown(selected))] }));
        return evaluateDeliveryV7({ target, store, configuration, contract, semanticMarkdown: "# Evaluate\n\nReview the exact integrated result.\n", directorId: CONNECTED_DIRECTOR_ID, agentId: "agent:reviewer", runtimeId: CONNECTED_RUNTIME_ID },
          { now, createActivityId: () => activityId, preparation: { now, checkCellOperator: check.operator, checkOperation: { now } }, finalization: { now }, agentOperation: agent.options });
      },
      async reopenStore() { store.close(); store = (await openDeliveryControlRecordStore({ machineHome, targetId: contract.targetId, deliveryId })).store;
        const latest = store.listEvents(0, 10_000).at(-1); if (latest !== undefined) tick = Math.max(tick, Date.parse(latest.occurredAt)); },
      async dispose() { store.close(); await check.close(); await rm(workspace, { recursive: true, force: true }); },
    };
    return fixture;
  } catch (error) {
    try { setupStore?.close(); } catch { /* Preserve the original setup refusal. */ }
    try { await setupCheck?.close(); } catch { /* Continue removing this fixture's private workspace. */ }
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
export type ConnectedDeliveryFixture = Awaited<ReturnType<typeof createConnectedDeliveryFixture>>;
