import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionOutputManifestEntryV1,
  type FoundationExecutionOutputManifestV1,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  reopenFoundationValidatedExecutionOutput,
  validateFoundationExecutionOutput,
  type FoundationExecutionOutputStagingV1,
  type FoundationExecutionOutputStagingBindingV1,
  type FoundationExecutionOutputStagingPlanV1,
  type FoundationStagedExecutionOutputArtifactV1,
} from "../../src/foundation/execution/output-validation.js";
import {
  createFoundationExecutionOutputStoreV1,
  type FoundationExecutionOutputStoreBindingV1,
  type FoundationExecutionOutputStoreDescriptorV1,
  type FoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  canonicalJson,
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  builderExecutionContractFixture,
  digest,
  executionContractFixture,
  type ExecutionContractFixture,
} from "../support/execution-contract-fixture.js";

const RUNNER_DIGEST = digest("runner-implementation");

type OutputFile = Readonly<{
  entry: FoundationExecutionOutputManifestEntryV1;
  bytes: Uint8Array;
}>;

type ReaderPlan = Readonly<{
  file: OutputFile;
  path?: string;
  byteLength?: number;
  digest?: Sha256;
  read?: () => AsyncIterable<Uint8Array>;
}>;

type StagingOptions = Readonly<{
  failAfterFirstChunk?: boolean;
  resolveWithoutConsumption?: boolean;
  substituteBinding?: boolean;
  substituteReplayBeforeCommit?: boolean;
  substituteReplayAfterCommit?: boolean;
  substituteCommitBinding?: boolean;
  failCommit?: boolean;
  failAbort?: boolean;
}>;

type StagingStats = {
  begins: number;
  stages: number;
  commits: number;
  aborts: number;
  replays: number;
  maximumChunkBytes: number;
  plans: FoundationExecutionOutputStagingPlanV1[];
  manifestBytes: Uint8Array[];
};

function fixedStoreBinding(seed: unknown): FoundationExecutionOutputStoreBindingV1 {
  const descriptor = Object.freeze({
    byteLength: 1,
    digest: digestCanonical({ seed, kind: "descriptor" }),
  });
  const subject = Object.freeze({
    schema: "lifecycle.execution-output-store-binding.v1" as const,
    descriptor,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function stagingHarness(options: StagingOptions = {}) {
  const stored = new Map<number, Uint8Array[]>();
  const stats: StagingStats = {
    begins: 0,
    stages: 0,
    commits: 0,
    aborts: 0,
    replays: 0,
    maximumChunkBytes: 0,
    plans: [],
    manifestBytes: [],
  };
  let committed = false;

  const liveBytes = () => [...stored.values()].reduce(
    (total, chunks) => total + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    0,
  );
  const artifact = (
    binding: FoundationExecutionOutputStagingBindingV1,
  ): FoundationStagedExecutionOutputArtifactV1 => Object.freeze({
    artifactIndex: binding.artifactIndex,
    bindingDigest: binding.bindingDigest,
    byteLength: binding.byteLength,
    digest: options.substituteBinding
      ? digest("substituted-staging-binding")
      : binding.digest,
    async *read() {
      stats.replays += 1;
      const selected = stored.get(binding.artifactIndex);
      if (selected === undefined) throw new Error("staged artifact is not live");
      const substitute = options.substituteReplayBeforeCommit === true && !committed ||
        options.substituteReplayAfterCommit === true && committed;
      for (let index = 0; index < selected.length; index += 1) {
        const chunk = Uint8Array.from(selected[index]!);
        if (substitute && index === 0 && chunk.byteLength !== 0) {
          chunk[0] = chunk[0]! ^ 0xff;
        }
        yield chunk;
      }
    },
  });

  const staging: FoundationExecutionOutputStagingV1 = Object.freeze({
    async begin(input: Readonly<{
      plan: FoundationExecutionOutputStagingPlanV1;
      manifestBytes: Uint8Array;
    }>) {
      stats.begins += 1;
      stats.plans.push(input.plan);
      stats.manifestBytes.push(Uint8Array.from(input.manifestBytes));
      return Object.freeze({
        async stage(input: FoundationExecutionOutputStagingBindingV1 & Readonly<{
          bytes: AsyncIterable<Uint8Array>;
        }>) {
          stats.stages += 1;
          const chunks: Uint8Array[] = [];
          stored.set(input.artifactIndex, chunks);
          if (!options.resolveWithoutConsumption) {
            for await (const chunk of input.bytes) {
              stats.maximumChunkBytes = Math.max(stats.maximumChunkBytes, chunk.byteLength);
              chunks.push(Uint8Array.from(chunk));
              if (options.failAfterFirstChunk) throw new Error("injected staging write failure");
            }
          }
          return artifact(input);
        },
        async commit() {
          stats.commits += 1;
          if (options.failCommit) throw new Error("injected staging commit failure");
          committed = true;
          const binding = fixedStoreBinding({
            plan: input.plan,
            manifestDigest: sha256Bytes(input.manifestBytes),
          });
          return options.substituteCommitBinding === true
            ? Object.freeze({ ...binding, digest: digest("substituted-store-binding") })
            : binding;
        },
        async abort() {
          stats.aborts += 1;
          stored.clear();
          if (options.failAbort) throw new Error("injected staging abort failure");
        },
      });
    },
  });
  return Object.freeze({ staging, stats, liveBytes });
}

function outputFile(input: Readonly<{
  path: string;
  contents: string;
  purpose?: FoundationExecutionOutputManifestEntryV1["purpose"];
  modeClass?: FoundationExecutionOutputManifestEntryV1["modeClass"];
  mediaType?: string;
}>): OutputFile {
  const bytes = Uint8Array.from(Buffer.from(input.contents, "utf8"));
  return Object.freeze({
    bytes,
    entry: Object.freeze({
      path: input.path,
      entryKind: "file" as const,
      purpose: input.purpose ?? "agent-work-product",
      mediaType: input.mediaType ?? "text/plain",
      modeClass: input.modeClass ?? "regular",
      byteLength: bytes.byteLength,
      digest: sha256Bytes(bytes),
    }),
  });
}

function manifestFor(
  specification: FoundationExecutionSpecificationV1,
  files: readonly OutputFile[],
): FoundationExecutionOutputManifestV1 {
  const entries = files.map(({ entry }) => entry);
  const subject = {
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: specification.digest,
    inputSetDigest: specification.inputSet.digest,
    imageDigest: specification.image.imageDigest,
    outputContractDigest: specification.outputContract.digest,
    runnerDigest: RUNNER_DIGEST,
    completedAt: "2026-09-01T00:00:00.000Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    entryInventoryDigest: digestCanonical(entries),
  };
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function changedManifest(
  manifest: FoundationExecutionOutputManifestV1,
  change: (subject: Record<string, unknown>) => void,
): FoundationExecutionOutputManifestV1 {
  const subject = JSON.parse(canonicalJson(manifest)) as Record<string, unknown>;
  delete subject.digest;
  change(subject);
  return Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }) as FoundationExecutionOutputManifestV1;
}

function refreshManifestInventory(
  manifest: FoundationExecutionOutputManifestV1,
  entries: readonly FoundationExecutionOutputManifestEntryV1[],
): FoundationExecutionOutputManifestV1 {
  return changedManifest(manifest, (subject) => {
    subject.entries = entries;
    subject.entryCount = entries.length;
    subject.aggregateByteLength = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    subject.entryInventoryDigest = digestCanonical(entries);
  });
}

function defaultRead(bytes: Uint8Array): () => AsyncIterable<Uint8Array> {
  return async function* read() {
    yield Uint8Array.from(bytes);
  };
}

function retrievedOutput(input: Readonly<{
  manifest: FoundationExecutionOutputManifestV1;
  plans: readonly ReaderPlan[];
  carrierByteLength?: number;
  onEntries?: () => void;
}>): FoundationRetrievedExecutionOutputV1 {
  return Object.freeze({
    manifest: input.manifest,
    carrierByteLength: input.carrierByteLength ?? input.manifest.aggregateByteLength,
    async *entries() {
      input.onEntries?.();
      for (const plan of input.plans) {
        yield Object.freeze({
          path: plan.path ?? plan.file.entry.path,
          byteLength: plan.byteLength ?? plan.file.entry.byteLength,
          digest: plan.digest ?? plan.file.entry.digest,
          read: plan.read ?? defaultRead(plan.file.bytes),
        });
      }
    },
  });
}

function specificationSubject(
  specification: FoundationExecutionSpecificationV1,
): Record<string, unknown> {
  const subject = JSON.parse(canonicalJson(specification)) as Record<string, unknown>;
  delete subject.digest;
  return subject;
}

function refreshOutputContract(subject: Record<string, unknown>): void {
  const outputContract = subject.outputContract as Record<string, unknown>;
  delete outputContract.digest;
  outputContract.digest = selfDigest(outputContract);
}

function changedSpecification(
  fixture: ExecutionContractFixture,
  change: (subject: Record<string, unknown>) => void,
  profile: FoundationExecutionBackendProfileV1 = fixture.profile,
): FoundationExecutionSpecificationV1 {
  const subject = specificationSubject(fixture.specification);
  subject.backendProfile = {
    profileId: profile.profileId,
    profileDigest: profile.digest,
    implementationDigest: profile.implementation.implementationDigest,
  };
  change(subject);
  return parseFoundationExecutionSpecification({
    value: { ...subject, digest: selfDigest(subject) },
    backendProfile: profile,
    image: fixture.image,
    inputSet: fixture.inputSet,
  });
}

function changedProfile(
  profile: FoundationExecutionBackendProfileV1,
  change: (subject: Record<string, unknown>) => void,
): FoundationExecutionBackendProfileV1 {
  const subject = JSON.parse(canonicalJson(profile)) as Record<string, unknown>;
  delete subject.digest;
  change(subject);
  return parseFoundationExecutionBackendProfile({
    ...subject,
    digest: selfDigest(subject),
  });
}

async function validate(input: Readonly<{
  output: FoundationRetrievedExecutionOutputV1;
  fixture: ExecutionContractFixture;
  specification?: FoundationExecutionSpecificationV1;
  profile?: FoundationExecutionBackendProfileV1;
  runnerDigest?: Sha256;
  staging?: FoundationExecutionOutputStagingV1;
}>) {
  const staging = input.staging ?? stagingHarness().staging;
  return validateFoundationExecutionOutput({
    output: input.output,
    specification: input.specification ?? input.fixture.specification,
    backendProfile: input.profile ?? input.fixture.profile,
    runnerDigest: input.runnerDigest ?? RUNNER_DIGEST,
    staging,
  });
}

function rejectsWithCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof FoundationError && error.code === code;
}

async function outputStoreHome(t: TestContext): Promise<string> {
  const selected = await realpath(
    await mkdtemp(join(tmpdir(), "lifecycle-output-validation-store-")),
  );
  t.after(async () => await rm(selected, { recursive: true, force: true }));
  return selected;
}

function bindingForDescriptor(
  descriptor: FoundationExecutionOutputStoreDescriptorV1,
): FoundationExecutionOutputStoreBindingV1 {
  const bytes = Uint8Array.from(Buffer.from(canonicalJsonLine(descriptor), "utf8"));
  const descriptorBinding = Object.freeze({
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
  });
  const subject = Object.freeze({
    schema: "lifecycle.execution-output-store-binding.v1" as const,
    descriptor: descriptorBinding,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

test("Execution Output validation stages bounded bytes and returns immutable verified readers", async () => {
  const fixture = executionContractFixture("validated-output");
  const first = outputFile({ path: "outputs/a.txt", contents: "alpha" });
  const second = outputFile({ path: "outputs/b.txt", contents: "bravo" });
  const manifest = manifestFor(fixture.specification, [first, second]);
  let entriesOpened = 0;
  let readsOpened = 0;
  const splitRead = (file: OutputFile) => async function* read() {
    readsOpened += 1;
    yield file.bytes.slice(0, 2);
    yield file.bytes.slice(2);
  };
  const output = retrievedOutput({
    manifest,
    plans: [
      { file: first, read: splitRead(first) },
      { file: second, read: splitRead(second) },
    ],
    onEntries: () => { entriesOpened += 1; },
  });
  const staging = stagingHarness();

  assert.equal(entriesOpened, 0);
  assert.equal(readsOpened, 0);
  const validated = await validate({ output, fixture, staging: staging.staging });
  assert.equal(entriesOpened, 1);
  assert.equal(readsOpened, 2);
  assert.equal(staging.stats.begins, 1);
  assert.equal(staging.stats.stages, 2);
  assert.equal(staging.stats.commits, 1);
  assert.equal(staging.stats.aborts, 0);
  assert(staging.stats.maximumChunkBytes <= 64 * 1024);
  assert.deepEqual(staging.stats.plans, [{
    manifestDigest: manifest.digest,
    carrierByteLength: manifest.aggregateByteLength,
    artifactCount: manifest.entryCount,
  }]);
  assert.deepEqual(
    staging.stats.manifestBytes,
    [Uint8Array.from(Buffer.from(canonicalJsonLine(manifest), "utf8"))],
  );
  assert(Object.isFrozen(validated));
  assert(Object.isFrozen(validated.output));
  assert(Object.isFrozen(validated.output.manifest));
  assert(Object.isFrozen(validated.output.artifacts));
  assert.deepEqual(
    validated.output.artifacts.map(({ path }) => path),
    ["outputs/a.txt", "outputs/b.txt"],
  );
  assert.equal(validated.output.artifacts[0]!.candidateGitMode, null);
  assert.equal(validated.output.artifacts[0]!.candidateRepositoryPath, null);
  assert.equal(validated.output.candidateOutput, null);
  assert.equal(validated.outputStoreBinding.schema, "lifecycle.execution-output-store-binding.v1");

  const firstRead: Uint8Array[] = [];
  for await (const chunk of validated.output.artifacts[0]!.read()) firstRead.push(chunk);
  assert.equal(Buffer.concat(firstRead).toString("utf8"), "alpha");
  firstRead[0]![0] = 0;
  const secondRead: Uint8Array[] = [];
  for await (const chunk of validated.output.artifacts[0]!.read()) secondRead.push(chunk);
  assert.equal(Buffer.concat(secondRead).toString("utf8"), "alpha");
  assert.equal(staging.stats.replays, 4, "two pre-commit replays plus two caller replays");
});

test("fresh Output Store reopen independently reconstructs the validated output without Backend access", async (t) => {
  const fixture = executionContractFixture("output-store-reopen");
  const first = outputFile({ path: "outputs/a.txt", contents: "alpha" });
  const second = outputFile({ path: "outputs/b.txt", contents: "bravo" });
  const manifest = manifestFor(fixture.specification, [first, second]);
  const machineHome = await outputStoreHome(t);
  const committed = await validate({
    output: retrievedOutput({ manifest, plans: [{ file: first }, { file: second }] }),
    fixture,
    staging: createFoundationExecutionOutputStoreV1({ machineHome }),
  });

  const recovered = await reopenFoundationValidatedExecutionOutput({
    outputStore: createFoundationExecutionOutputStoreV1({ machineHome }),
    outputStoreBinding: committed.outputStoreBinding,
    specification: fixture.specification,
    backendProfile: fixture.profile,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.deepEqual(recovered.outputStoreBinding, committed.outputStoreBinding);
  assert.deepEqual(recovered.output.manifest, manifest);
  assert.deepEqual(
    recovered.output.artifacts.map(({ path }) => path),
    [first.entry.path, second.entry.path],
  );
  assert.equal(recovered.output.candidateOutput, null);
  for (let replay = 0; replay < 2; replay += 1) {
    const bytes: Uint8Array[] = [];
    for await (const chunk of recovered.output.artifacts[0]!.read()) bytes.push(chunk);
    assert.equal(Buffer.concat(bytes).toString("utf8"), "alpha");
    bytes[0]![0] = 0;
  }

  await assert.rejects(
    reopenFoundationValidatedExecutionOutput({
      outputStore: createFoundationExecutionOutputStoreV1({ machineHome }),
      outputStoreBinding: committed.outputStoreBinding,
      specification: fixture.specification,
      backendProfile: fixture.profile,
      runnerDigest: digest("another-runner"),
    }),
    rejectsWithCode("lifecycle.execution.output-validation.binding"),
  );
});

test("fresh Output Store reopen refuses descriptor plan and artifact-binding substitution", async (t) => {
  const fixture = executionContractFixture("output-store-semantic-binding");
  const file = outputFile({ path: "outputs/result.txt", contents: "result" });
  const manifest = manifestFor(fixture.specification, [file]);
  const machineHome = await outputStoreHome(t);
  const store = createFoundationExecutionOutputStoreV1({ machineHome });
  const committed = await validate({
    output: retrievedOutput({ manifest, plans: [{ file }] }),
    fixture,
    staging: store,
  });
  const opened = await store.reopen(committed.outputStoreBinding);

  const changedPlanSubject = Object.freeze({
    schema: opened.descriptor.schema,
    plan: Object.freeze({ ...opened.descriptor.plan, artifactCount: 2 }),
    manifest: opened.descriptor.manifest,
    artifacts: opened.descriptor.artifacts,
    artifactInventoryDigest: opened.descriptor.artifactInventoryDigest,
  });
  const changedPlanDescriptor = Object.freeze({
    ...changedPlanSubject,
    digest: selfDigest(changedPlanSubject),
  });
  const changedPlanBinding = bindingForDescriptor(changedPlanDescriptor);
  const changedPlanStore: FoundationExecutionOutputStoreV1 = Object.freeze({
    begin: store.begin,
    async reopen() {
      return Object.freeze({ ...opened, binding: changedPlanBinding, descriptor: changedPlanDescriptor });
    },
  });
  await assert.rejects(
    reopenFoundationValidatedExecutionOutput({
      outputStore: changedPlanStore,
      outputStoreBinding: changedPlanBinding,
      specification: fixture.specification,
      backendProfile: fixture.profile,
      runnerDigest: RUNNER_DIGEST,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.staging-store-plan"),
  );

  const changedArtifacts = Object.freeze([Object.freeze({
    ...opened.descriptor.artifacts[0]!,
    bindingDigest: digest("substituted-artifact-binding"),
  })]);
  const changedArtifactSubject = Object.freeze({
    schema: opened.descriptor.schema,
    plan: opened.descriptor.plan,
    manifest: opened.descriptor.manifest,
    artifacts: changedArtifacts,
    artifactInventoryDigest: digestCanonical(changedArtifacts),
  });
  const changedArtifactDescriptor = Object.freeze({
    ...changedArtifactSubject,
    digest: selfDigest(changedArtifactSubject),
  });
  const changedArtifactBinding = bindingForDescriptor(changedArtifactDescriptor);
  const changedArtifactStore: FoundationExecutionOutputStoreV1 = Object.freeze({
    begin: store.begin,
    async reopen() {
      return Object.freeze({
        ...opened,
        binding: changedArtifactBinding,
        descriptor: changedArtifactDescriptor,
      });
    },
  });
  await assert.rejects(
    reopenFoundationValidatedExecutionOutput({
      outputStore: changedArtifactStore,
      outputStoreBinding: changedArtifactBinding,
      specification: fixture.specification,
      backendProfile: fixture.profile,
      runnerDigest: RUNNER_DIGEST,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.staging-store-artifacts"),
  );
});

test("Execution Output validation refuses schema, self-digest, and exact subject binding substitutions", async () => {
  const fixture = executionContractFixture("output-bindings");
  const file = outputFile({ path: "outputs/result.txt", contents: "result" });
  const manifest = manifestFor(fixture.specification, [file]);

  const wrongSchema = changedManifest(manifest, (subject) => {
    subject.schema = "lifecycle.execution-output-manifest.v2";
  });
  await assert.rejects(
    validate({ output: retrievedOutput({ manifest: wrongSchema, plans: [{ file }] }), fixture }),
    (error: unknown) => error instanceof FoundationError,
  );

  const wrongDigest = Object.freeze({ ...manifest, digest: digest("wrong-manifest") });
  await assert.rejects(
    validate({ output: retrievedOutput({ manifest: wrongDigest, plans: [{ file }] }), fixture }),
    rejectsWithCode("lifecycle.execution.output-validation.manifest-digest"),
  );

  for (const [field, value, code] of [
    ["entryCount", 2, "entry-count"],
    ["aggregateByteLength", file.entry.byteLength + 1, "aggregate-count"],
    ["entryInventoryDigest", digest("substituted-inventory"), "inventory-digest"],
  ] as const) {
    const inconsistent = changedManifest(manifest, (subject) => {
      subject[field] = value;
    });
    await assert.rejects(
      validate({ output: retrievedOutput({ manifest: inconsistent, plans: [{ file }] }), fixture }),
      rejectsWithCode(`lifecycle.execution.output-validation.${code}`),
    );
  }

  for (const field of [
    "specificationDigest",
    "inputSetDigest",
    "imageDigest",
    "outputContractDigest",
    "runnerDigest",
  ] as const) {
    const substituted = changedManifest(manifest, (subject) => {
      subject[field] = digest(`substituted-${field}`);
    });
    await assert.rejects(
      validate({ output: retrievedOutput({ manifest: substituted, plans: [{ file }] }), fixture }),
      rejectsWithCode("lifecycle.execution.output-validation.binding"),
    );
  }

  const substitutedProfile = changedProfile(fixture.profile, (subject) => {
    (subject.implementation as Record<string, unknown>).implementationDigest =
      digest("substituted-backend-implementation");
  });
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file }] }),
      fixture,
      profile: substitutedProfile,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );
});

test("Execution Output validation refuses unsafe, aliased, colliding, duplicate, and unordered inventories", async () => {
  const fixture = executionContractFixture("output-paths");
  const base = outputFile({ path: "outputs/result.txt", contents: "result" });
  const baseManifest = manifestFor(fixture.specification, [base]);
  const cases: readonly OutputFile[][] = [
    [
      outputFile({ path: "outputs/z.txt", contents: "z" }),
      outputFile({ path: "outputs/a.txt", contents: "a" }),
    ],
    [
      outputFile({ path: "outputs/A.txt", contents: "A" }),
      outputFile({ path: "outputs/a.txt", contents: "a" }),
    ],
    [
      outputFile({ path: "outputs/same.txt", contents: "first" }),
      outputFile({ path: "outputs/same.txt", contents: "second" }),
    ],
    [outputFile({ path: "../outputs/a.txt", contents: "a" })],
    [outputFile({ path: "outputs/a.txt?version=1", contents: "a" })],
    [outputFile({ path: "outputs%2Fa.txt", contents: "a" })],
    [
      outputFile({ path: "outputs/a", contents: "a" }),
      outputFile({ path: "outputs/a/b", contents: "b" }),
    ],
  ];
  for (const files of cases) {
    const manifest = refreshManifestInventory(baseManifest, files.map(({ entry }) => entry));
    await assert.rejects(
      validate({ output: retrievedOutput({ manifest, plans: files.map((file) => ({ file })) }), fixture }),
      (error: unknown) => error instanceof FoundationError,
    );
  }

  const second = outputFile({ path: "outputs/second.txt", contents: "second" });
  const manifest = manifestFor(fixture.specification, [base, second]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file: base }, { file: base }] }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.duplicate-entry"),
  );
});

test("Execution Output validation enforces declared roots, purposes, modes, required roots, and Candidate writes", async (t) => {
  const fixture = executionContractFixture("output-contract");
  const invalidFiles = [
    outputFile({ path: "elsewhere/result.txt", contents: "result" }),
    outputFile({ path: "outputs/result.txt", contents: "result", purpose: "operational-artifact" }),
    outputFile({ path: "outputs/result.txt", contents: "result", modeClass: "executable" }),
  ] as const;
  for (const file of invalidFiles) {
    const manifest = manifestFor(fixture.specification, [file]);
    await assert.rejects(
      validate({ output: retrievedOutput({ manifest, plans: [{ file }] }), fixture }),
      (error: unknown) => error instanceof FoundationError,
    );
  }

  const candidateWithoutGrant = outputFile({
    path: "outputs/candidate.txt",
    contents: "candidate",
    purpose: "candidate-output",
  });
  await assert.rejects(
    validate({
      output: retrievedOutput({
        manifest: manifestFor(fixture.specification, [candidateWithoutGrant]),
        plans: [{ file: candidateWithoutGrant }],
      }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.candidate-writes"),
  );

  const required = changedSpecification(fixture, (subject) => {
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.required = true;
    refreshOutputContract(subject);
  });
  const emptyManifest = manifestFor(required, []);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: emptyManifest, plans: [] }),
      fixture,
      specification: required,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.required-root"),
  );

  const builderFixture = builderExecutionContractFixture("output-contract-builder");
  const builder = builderFixture.specification;
  const candidate = outputFile({
    path: "candidate-output/bin/run.sh",
    contents: "#!/bin/sh\nexit 0\n",
    purpose: "candidate-output",
    modeClass: "executable",
  });
  const candidateManifest = manifestFor(builder, [candidate]);
  const machineHome = await outputStoreHome(t);
  const outputStore = createFoundationExecutionOutputStoreV1({ machineHome });
  const validated = await validate({
    output: retrievedOutput({ manifest: candidateManifest, plans: [{ file: candidate }] }),
    fixture: builderFixture,
    specification: builder,
    staging: outputStore,
  });
  assert.equal(validated.output.artifacts[0]!.candidateGitMode, "100755");
  assert.equal(validated.output.artifacts[0]!.candidateRepositoryPath, "bin/run.sh");
  assert.deepEqual(validated.output.candidateOutput, {
    declaredRootPath: "candidate-output",
    entries: [validated.output.artifacts[0]],
  });
  const reopened = await reopenFoundationValidatedExecutionOutput({
    outputStore,
    outputStoreBinding: validated.outputStoreBinding,
    specification: builder,
    backendProfile: builderFixture.profile,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(
    reopened.output.candidateOutput?.entries[0]?.candidateRepositoryPath,
    "bin/run.sh",
  );

  const rootAsFile = outputFile({
    path: "candidate-output",
    contents: "not a complete repository tree",
    purpose: "candidate-output",
  });
  await assert.rejects(
    validate({
      output: retrievedOutput({
        manifest: manifestFor(builder, [rootAsFile]),
        plans: [{ file: rootAsFile }],
      }),
      fixture: builderFixture,
      specification: builder,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.candidate-path"),
  );
});

test("Execution Output validation enforces manifest, root, aggregate, carrier, entry, and stream bounds", async () => {
  const fixture = executionContractFixture("output-limits");
  const file = outputFile({ path: "outputs/result.txt", contents: "12345" });
  const manifest = manifestFor(fixture.specification, [file]);

  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file }], carrierByteLength: 4 }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.carrier-bytes"),
  );

  const perEntryLimited = changedSpecification(fixture, (subject) => {
    (subject.limits as Record<string, unknown>).outputEntryBytes = 4;
  });
  const perEntryManifest = manifestFor(perEntryLimited, [file]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: perEntryManifest, plans: [{ file }] }),
      fixture,
      specification: perEntryLimited,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.entry-limit"),
  );

  const countLimited = changedSpecification(fixture, (subject) => {
    (subject.limits as Record<string, unknown>).outputEntries = 1;
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.maximumEntries = 1;
    refreshOutputContract(subject);
  });
  const secondFile = outputFile({ path: "outputs/second.txt", contents: "2" });
  const countManifest = manifestFor(countLimited, [file, secondFile]);
  await assert.rejects(
    validate({
      output: retrievedOutput({
        manifest: countManifest,
        plans: [{ file }, { file: secondFile }],
      }),
      fixture,
      specification: countLimited,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.entry-limit"),
  );

  const aggregateLimited = changedSpecification(fixture, (subject) => {
    const limits = subject.limits as Record<string, unknown>;
    limits.outputBytes = 4;
    limits.outputEntryBytes = 4;
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.maximumBytes = 4;
    refreshOutputContract(subject);
  });
  const aggregateManifest = manifestFor(aggregateLimited, [file]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: aggregateManifest, plans: [{ file }] }),
      fixture,
      specification: aggregateLimited,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.aggregate-limit"),
  );

  const rootLimited = changedSpecification(fixture, (subject) => {
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.maximumBytes = 4;
    refreshOutputContract(subject);
  });
  const rootManifest = manifestFor(rootLimited, [file]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: rootManifest, plans: [{ file }] }),
      fixture,
      specification: rootLimited,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.root-limit"),
  );

  const partial = retrievedOutput({
    manifest,
    plans: [{
      file,
      read: async function* read() { yield file.bytes.slice(0, 4); },
    }],
  });
  await assert.rejects(
    validate({ output: partial, fixture }),
    rejectsWithCode("lifecycle.execution.output-validation.partial"),
  );

  const oversized = retrievedOutput({
    manifest,
    plans: [{
      file,
      read: async function* read() { yield Uint8Array.from(Buffer.from("123456", "utf8")); },
    }],
  });
  await assert.rejects(
    validate({ output: oversized, fixture }),
    rejectsWithCode("lifecycle.execution.output-validation.oversized-chunk"),
  );
});

test("Execution Output validation refuses missing, extra, repeated, mutated, and retry-changed Carrier entries", async () => {
  const fixture = executionContractFixture("output-carrier-integrity");
  const first = outputFile({ path: "outputs/a.txt", contents: "alpha" });
  const second = outputFile({ path: "outputs/b.txt", contents: "bravo" });
  const manifest = manifestFor(fixture.specification, [first, second]);

  await assert.rejects(
    validate({ output: retrievedOutput({ manifest, plans: [{ file: first }] }), fixture }),
    rejectsWithCode("lifecycle.execution.output-validation.missing-entry"),
  );

  const singleManifest = manifestFor(fixture.specification, [first]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: singleManifest, plans: [
        { file: first },
        { file: second },
      ] }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.extra-entry"),
  );

  await assert.rejects(
    validate({
      output: retrievedOutput({
        manifest,
        plans: [{ file: first }, { file: second, path: "outputs/substituted.txt" }],
      }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.entry-binding"),
  );

  const changedBytes = Uint8Array.from(Buffer.from("ALPHA", "utf8"));
  await assert.rejects(
    validate({
      output: retrievedOutput({
        manifest,
        plans: [{ file: first, read: defaultRead(changedBytes) }, { file: second }],
      }),
      fixture,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.byte-digest"),
  );

  let reads = 0;
  const changingOutput = retrievedOutput({
    manifest: singleManifest,
    plans: [{
      file: first,
      read: async function* read() {
        reads += 1;
        yield reads === 1 ? Uint8Array.from(first.bytes) : changedBytes;
      },
    }],
  });
  await validate({ output: changingOutput, fixture });
  await assert.rejects(
    validate({ output: changingOutput, fixture }),
    rejectsWithCode("lifecycle.execution.output-validation.byte-digest"),
  );
});

test("Execution Output validation preflights declared bounds and never allocates the declared artifact size", async () => {
  const fixture = executionContractFixture("output-streaming-boundary");
  const hugeByteLength = 2 ** 34;
  const seed = outputFile({ path: "outputs/huge.bin", contents: "x" });
  const virtualFile: OutputFile = Object.freeze({
    bytes: seed.bytes,
    entry: Object.freeze({
      ...seed.entry,
      byteLength: hugeByteLength,
      digest: digest("virtual-huge-output"),
    }),
  });

  const preflightStaging = stagingHarness();
  const overDefaultLimit = manifestFor(fixture.specification, [virtualFile]);
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: overDefaultLimit, plans: [{ file: virtualFile }] }),
      fixture,
      staging: preflightStaging.staging,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.aggregate-limit"),
  );
  assert.equal(preflightStaging.stats.begins, 0, "invalid inventory must fail before staging");

  const largeProfile = changedProfile(fixture.profile, (subject) => {
    const limits = subject.limits as Record<string, unknown>;
    limits.maximumOutputBytes = hugeByteLength;
    limits.maximumOutputEntryBytes = hugeByteLength;
  });
  const largeSpecification = changedSpecification(fixture, (subject) => {
    const limits = subject.limits as Record<string, unknown>;
    limits.outputBytes = hugeByteLength;
    limits.outputEntryBytes = hugeByteLength;
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.maximumBytes = hugeByteLength;
    refreshOutputContract(subject);
  }, largeProfile);
  const acceptedManifest = manifestFor(largeSpecification, [virtualFile]);
  const staging = stagingHarness();
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest: acceptedManifest, plans: [{ file: virtualFile }] }),
      fixture,
      specification: largeSpecification,
      profile: largeProfile,
      staging: staging.staging,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.partial"),
  );
  assert.equal(staging.stats.begins, 1);
  assert.equal(staging.stats.aborts, 1);
  assert.equal(staging.stats.commits, 0);
  assert.equal(staging.stats.maximumChunkBytes, 1);
  assert.equal(staging.liveBytes(), 0);
});

test("Execution Output staging revokes all provisional bytes after partial and operational failures", async () => {
  const fixture = executionContractFixture("output-staging-failure");
  const first = outputFile({ path: "outputs/a.txt", contents: "alpha" });
  const second = outputFile({ path: "outputs/b.txt", contents: "bravo" });
  const manifest = manifestFor(fixture.specification, [first, second]);

  const missing = stagingHarness();
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file: first }] }),
      fixture,
      staging: missing.staging,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.missing-entry"),
  );
  assert.equal(missing.stats.stages, 1);
  assert.equal(missing.stats.aborts, 1);
  assert.equal(missing.liveBytes(), 0);

  for (const [options, expectedCode] of [
    [{ failAfterFirstChunk: true }, "staging-write"],
    [{ resolveWithoutConsumption: true }, "staging-consumption"],
    [{ failCommit: true }, "staging-commit"],
  ] as const) {
    const staging = stagingHarness(options);
    await assert.rejects(
      validate({
        output: retrievedOutput({ manifest, plans: [{ file: first }, { file: second }] }),
        fixture,
        staging: staging.staging,
      }),
      rejectsWithCode(`lifecycle.execution.output-validation.${expectedCode}`),
    );
    assert.equal(staging.stats.aborts, 1);
    assert.equal(staging.stats.commits, options.failCommit === true ? 1 : 0);
    assert.equal(staging.liveBytes(), 0);
  }

  const failedAbort = stagingHarness({
    resolveWithoutConsumption: true,
    failAbort: true,
  });
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file: first }, { file: second }] }),
      fixture,
      staging: failedAbort.staging,
    }),
    rejectsWithCode("lifecycle.execution.output-validation.staging-abort"),
  );

  const malformedCommittedBinding = stagingHarness({ substituteCommitBinding: true });
  await assert.rejects(
    validate({
      output: retrievedOutput({ manifest, plans: [{ file: first }, { file: second }] }),
      fixture,
      staging: malformedCommittedBinding.staging,
    }),
    rejectsWithCode("lifecycle.execution.output-store.binding"),
  );
  assert.equal(malformedCommittedBinding.stats.commits, 1);
  assert.equal(
    malformedCommittedBinding.stats.aborts,
    0,
    "a resolved Store commit cannot be rolled back as provisional staging",
  );
});

test("Execution Output validation rejects staged binding and byte substitution and rechecks every replay", async () => {
  const fixture = executionContractFixture("output-staging-substitution");
  const file = outputFile({ path: "outputs/result.txt", contents: "result" });
  const manifest = manifestFor(fixture.specification, [file]);

  for (const [options, expectedCode] of [
    [{ substituteBinding: true }, "staging-binding"],
    [{ substituteReplayBeforeCommit: true }, "staging-substitution"],
  ] as const) {
    const staging = stagingHarness(options);
    await assert.rejects(
      validate({
        output: retrievedOutput({ manifest, plans: [{ file }] }),
        fixture,
        staging: staging.staging,
      }),
      rejectsWithCode(`lifecycle.execution.output-validation.${expectedCode}`),
    );
    assert.equal(staging.stats.aborts, 1);
    assert.equal(staging.liveBytes(), 0);
  }

  const changing = stagingHarness({ substituteReplayAfterCommit: true });
  const validated = await validate({
    output: retrievedOutput({ manifest, plans: [{ file }] }),
    fixture,
    staging: changing.staging,
  });
  await assert.rejects(async () => {
    for await (const _chunk of validated.output.artifacts[0]!.read()) {
      // A complete replay must finish its digest check.
    }
  }, rejectsWithCode("lifecycle.execution.output-validation.staging-substitution"));
  assert.equal(changing.stats.commits, 1);
  assert.equal(changing.stats.aborts, 0);
});
