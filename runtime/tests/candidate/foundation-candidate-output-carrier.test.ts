import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCandidateOutputCarrierPublisherForTesting,
  publishCandidateRevisionCarrierFromCandidateOutput,
  type FoundationCandidateOutputCompleteTreeEntryV1,
  type FoundationCandidateOutputCompleteTreeV1,
} from "../../src/foundation/candidate/candidate-output-carrier.js";
import { materializeCandidateRevisionCarrier } from "../../src/foundation/candidate/carrier-materialization.js";
import { openCandidateRevisionCarrier } from "../../src/foundation/candidate/carrier-store.js";
import { FoundationError } from "../../src/foundation/error.js";
import { git } from "../../src/foundation/repository/git.js";
import type { Sha256 } from "../../src/foundation/validation/canonical.js";
import { withProcessCancellation } from "../../src/util/process.js";

const COMPILATION_PARENT = join(
  "candidate-revision-carrier-compilation",
  "v1",
);

type Fixture = Readonly<{
  root: string;
  machineHome: string;
  materializations: string;
}>;

async function fixture(context: { after(callback: () => void | Promise<void>): void }): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-output-carrier-")));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const machineHome = join(root, "machine");
  const materializations = join(root, "materializations");
  await mkdir(machineHome, { mode: 0o700 });
  await mkdir(materializations, { mode: 0o700 });
  await chmod(machineHome, 0o700);
  await chmod(materializations, 0o700);
  return Object.freeze({ root, machineHome, materializations });
}

function sha256(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256;
}

function entry(
  path: string,
  bytes: Uint8Array,
  mode: "100644" | "100755" = "100644",
  reader?: () => AsyncIterable<Uint8Array>,
): FoundationCandidateOutputCompleteTreeEntryV1 {
  return Object.freeze({
    candidateRepositoryPath: path,
    candidateGitMode: mode,
    byteLength: bytes.byteLength,
    digest: sha256(bytes),
    read: reader ?? (() => (async function* () {
      for (let offset = 0; offset < bytes.byteLength; offset += 3) {
        yield Uint8Array.from(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 3)));
      }
    })()),
  });
}

function completeTree(
  entries: readonly FoundationCandidateOutputCompleteTreeEntryV1[],
): FoundationCandidateOutputCompleteTreeV1 {
  return Object.freeze({
    declaredRootPath: "candidate-output",
    entries: Object.freeze([...entries]),
  });
}

function healthyTree(): FoundationCandidateOutputCompleteTreeV1 {
  return completeTree([
    entry(".gitattributes", Buffer.from("*.txt filter=must-not-run\n", "utf8")),
    entry("bin/tool", Buffer.from("#!/bin/sh\nexit 0\n", "utf8"), "100755"),
    entry("empty.txt", Buffer.alloc(0)),
    entry("nested/binary.dat", Buffer.from([0, 1, 2, 255, 0, 128])),
    entry("product.txt", Buffer.from("complete successor\n", "utf8")),
  ]);
}

async function assertCompilationEmpty(machineHome: string): Promise<void> {
  assert.deepEqual(
    await readdir(join(machineHome, COMPILATION_PARENT)),
    [],
  );
}

function unavailableWithoutLocator(error: unknown, value: Fixture): boolean {
  if (!(error instanceof FoundationError) ||
      error.code !== "lifecycle.candidate.output-carrier-unavailable") return false;
  const serialized = JSON.stringify(error.toJSON());
  return !serialized.includes(value.root) &&
    !serialized.includes(value.machineHome) &&
    !serialized.includes("compile-") &&
    !serialized.includes("retained-artifact");
}

for (const objectFormat of ["sha1", "sha256"] as const) {
  test(`validated complete Candidate output deterministically publishes and reopens a ${objectFormat} Carrier`, async (context) => {
    const value = await fixture(context);
    const candidateOutput = healthyTree();
    const first = await publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat,
      candidateOutput,
    });
    const second = await publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat,
      candidateOutput,
    });

    assert.deepEqual(second, first);
    assert.equal(first.objectFormat, objectFormat);
    assert.match(first.rootTree, objectFormat === "sha1" ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u);
    assert.deepEqual(Object.keys(first).sort(), [
      "carrierArtifactDigest",
      "manifestBytes",
      "manifestDigest",
      "objectFormat",
      "objectInventoryDigest",
      "rootTree",
    ]);
    const serialized = JSON.stringify(first);
    assert(!serialized.includes(value.root));
    assert(!serialized.includes(value.machineHome));
    assert(!serialized.includes("compile-"));
    assert(!serialized.includes("retained-artifact"));

    const reopened = await openCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: first.manifestBytes,
    });
    assert.equal(reopened.manifest.rootTree, first.rootTree);
    assert.equal(reopened.manifest.digest, first.manifestDigest);
    assert.equal(reopened.manifest.objectInventoryDigest, first.objectInventoryDigest);
    assert.equal(reopened.manifest.carrierArtifact.digest, first.carrierArtifactDigest);

    const destination = join(value.materializations, objectFormat);
    const materialized = await materializeCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: first.manifestBytes,
      destination,
    });
    assert.equal(materialized.rootTree, first.rootTree);
    assert.equal(await readFile(join(destination, "product.txt"), "utf8"), "complete successor\n");
    assert.deepEqual(
      await readFile(join(destination, "nested", "binary.dat")),
      Buffer.from([0, 1, 2, 255, 0, 128]),
    );
    assert.equal((await stat(join(destination, "bin", "tool"))).mode & 0o7777, 0o755);
    assert.equal((await stat(join(destination, "product.txt"))).mode & 0o7777, 0o644);
    await assertCompilationEmpty(value.machineHome);
  });
}

test("Candidate output Carrier compilation refuses path aliases, Git administration, prefix collisions, and unsupported modes", async (context) => {
  const value = await fixture(context);
  const invalidTrees: readonly FoundationCandidateOutputCompleteTreeV1[] = [
    completeTree([entry(".git/config", Buffer.from("bad"))]),
    completeTree([
      entry("A.txt", Buffer.from("one")),
      entry("a.txt", Buffer.from("two")),
    ]),
    completeTree([
      entry("file", Buffer.from("one")),
      entry("file/nested", Buffer.from("two")),
    ]),
    completeTree([
      Object.freeze({
        ...entry("file", Buffer.from("one")),
        candidateGitMode: "120000",
      }) as unknown as FoundationCandidateOutputCompleteTreeEntryV1,
    ]),
  ];

  for (const candidateOutput of invalidTrees) {
    await assert.rejects(
      publishCandidateRevisionCarrierFromCandidateOutput({
        machineHome: value.machineHome,
        objectFormat: "sha1",
        candidateOutput,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.candidate.output-carrier-invalid",
    );
  }
});

test("Candidate output Carrier compilation refuses short, overlong, and digest-substituted retained bytes", async (context) => {
  const value = await fixture(context);
  const expected = Buffer.from("exact", "utf8");
  const short = entry("file", expected, "100644", () => (async function* () {
    yield Buffer.from("exac", "utf8");
  })());
  const overlong = entry("file", expected, "100644", () => (async function* () {
    yield expected;
    yield Buffer.from("!", "utf8");
  })());
  const substituted = entry("file", expected, "100644", () => (async function* () {
    yield Buffer.from("other", "utf8");
  })());

  for (const selected of [short, overlong, substituted]) {
    await assert.rejects(
      publishCandidateRevisionCarrierFromCandidateOutput({
        machineHome: value.machineHome,
        objectFormat: "sha1",
        candidateOutput: completeTree([selected]),
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.candidate.output-carrier-invalid",
    );
    await assertCompilationEmpty(value.machineHome);
  }
});

test("Candidate output Carrier compilation refuses a zero-length stream chunk as deterministic invalid output", async (context) => {
  const value = await fixture(context);
  const expected = Buffer.from("exact", "utf8");
  const nonProgressing = entry("file", expected, "100644", () => (async function* () {
    yield Buffer.alloc(0);
    yield expected;
  })());

  await assert.rejects(
    publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput: completeTree([nonProgressing]),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.output-carrier-invalid",
  );
  await assertCompilationEmpty(value.machineHome);
});

test("Candidate output Carrier compilation classifies retained-byte reopen failure as locator-free unavailability", async (context) => {
  const value = await fixture(context);
  const bytes = Buffer.from("exact", "utf8");
  const unavailable = entry("file", bytes, "100644", () => {
    throw new Error(`private retained bytes at ${value.root} are unavailable`);
  });

  await assert.rejects(
    publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput: completeTree([unavailable]),
    }),
    (error: unknown) => unavailableWithoutLocator(error, value),
  );
  await assertCompilationEmpty(value.machineHome);
});

test("Candidate output Carrier compilation classifies Git command failures as locator-free unavailability", async (context) => {
  const value = await fixture(context);
  const cases = [
    Object.freeze({
      name: "hash-object exit",
      matches: (args: readonly string[]) => args[0] === "hash-object",
      result: Object.freeze({
        stdout: "",
        stderr: `private failure at ${value.root}`,
        exitCode: 1,
        signal: null,
      }),
    }),
    Object.freeze({
      name: "cat-file timeout",
      matches: (args: readonly string[]) => args[0] === "cat-file" && args[1] === "-t",
      result: Object.freeze({
        stdout: "",
        stderr: `private timeout at ${value.root}`,
        exitCode: 1,
        signal: "SIGTERM" as const,
        timedOut: true,
      }),
    }),
    Object.freeze({
      name: "update-index truncation",
      matches: (args: readonly string[]) => args[0] === "update-index",
      result: Object.freeze({
        stdout: "",
        stderr: `private truncated output at ${value.root}`,
        exitCode: 0,
        signal: null,
        stderrTruncated: true,
      }),
    }),
    Object.freeze({
      name: "write-tree truncation",
      matches: (args: readonly string[]) => args[0] === "write-tree",
      result: Object.freeze({
        stdout: "not-an-object-id",
        stderr: `private truncated output at ${value.root}`,
        exitCode: 0,
        signal: null,
        stdoutTruncated: true,
      }),
    }),
  ] as const;

  for (const selected of cases) {
    let injected = false;
    const gitCommand: typeof git = async (repository, args, options) => {
      if (!injected && selected.matches(args)) {
        injected = true;
        return selected.result;
      }
      return await git(repository, args, options);
    };
    const publish = createCandidateOutputCarrierPublisherForTesting({ gitCommand });
    await assert.rejects(
      publish({
        machineHome: value.machineHome,
        objectFormat: "sha1",
        candidateOutput: completeTree([entry("file", Buffer.from(selected.name, "utf8"))]),
      }),
      (error: unknown) => unavailableWithoutLocator(error, value),
    );
    assert.equal(injected, true, `${selected.name} failure was not injected`);
    await assertCompilationEmpty(value.machineHome);
  }
});

test("Candidate output Carrier compilation classifies Git mismatch and Store publication or open failure as locator-free unavailability", async (context) => {
  const value = await fixture(context);
  const candidateOutput = completeTree([entry("file", Buffer.from("exact", "utf8"))]);

  const mismatchedFormat = createCandidateOutputCarrierPublisherForTesting({
    resolveObjectFormat: async () => "sha256",
  });
  await assert.rejects(
    mismatchedFormat({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput,
    }),
    (error: unknown) => unavailableWithoutLocator(error, value),
  );
  await assertCompilationEmpty(value.machineHome);

  const publicationFailure = createCandidateOutputCarrierPublisherForTesting({
    publishCarrier: async () => {
      throw new FoundationError("test.private-publication-failure", `private ${value.root}`);
    },
  });
  await assert.rejects(
    publicationFailure({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput,
    }),
    (error: unknown) => unavailableWithoutLocator(error, value),
  );
  await assertCompilationEmpty(value.machineHome);

  const reopenFailure = createCandidateOutputCarrierPublisherForTesting({
    openCarrier: async () => {
      throw new FoundationError("test.private-open-failure", `private ${value.root}`);
    },
  });
  await assert.rejects(
    reopenFailure({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput,
    }),
    (error: unknown) => unavailableWithoutLocator(error, value),
  );
  await assertCompilationEmpty(value.machineHome);

  const reopenMismatch = createCandidateOutputCarrierPublisherForTesting({
    openCarrier: async (input) => {
      const opened = await openCandidateRevisionCarrier(input);
      return Object.freeze({
        ...opened,
        manifest: Object.freeze({
          ...opened.manifest,
          rootTree: "0".repeat(40),
        }),
      });
    },
  });
  await assert.rejects(
    reopenMismatch({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput,
    }),
    (error: unknown) => unavailableWithoutLocator(error, value),
  );
  await assertCompilationEmpty(value.machineHome);
});

test("Candidate output Carrier compilation detects private source substitution without disclosing a locator", async (context) => {
  const value = await fixture(context);
  const bytes = Buffer.from("exact bytes", "utf8");
  const substituted = entry("file", bytes, "100644", () => (async function* () {
    yield bytes;
    const [compilationRoot] = await readdir(join(value.machineHome, COMPILATION_PARENT));
    assert(compilationRoot !== undefined);
    const source = join(value.machineHome, COMPILATION_PARENT, compilationRoot, "retained-artifact");
    await rename(source, `${source}.substituted`);
    await writeFile(source, "same length!", { mode: 0o600 });
    await chmod(source, 0o600);
  })());

  let observedJson = "";
  await assert.rejects(
    publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput: completeTree([substituted]),
    }),
    (error: unknown) => {
      if (!(error instanceof FoundationError) ||
          error.code !== "lifecycle.candidate.output-carrier-unavailable") return false;
      observedJson = JSON.stringify(error.toJSON());
      return true;
    },
  );
  const serialized = observedJson;
  assert(!serialized.includes(value.root));
  assert(!serialized.includes(value.machineHome));
  assert(!serialized.includes("compile-"));
  assert(!serialized.includes("retained-artifact"));
  await assertCompilationEmpty(value.machineHome);
});

test("Candidate output Carrier compilation interruption leaves no compiler root or published successor", async (context) => {
  const value = await fixture(context);
  const controller = new AbortController();
  let enteredResolve!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve;
  });
  let continueResolve!: () => void;
  const continueStream = new Promise<void>((resolve) => {
    continueResolve = resolve;
  });
  const bytes = Buffer.from("interrupted", "utf8");
  const interrupted = entry("file", bytes, "100644", () => (async function* () {
    yield bytes.subarray(0, 4);
    enteredResolve();
    await continueStream;
    yield bytes.subarray(4);
  })());

  const running = withProcessCancellation(
    { signal: controller.signal },
    async () => await publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: value.machineHome,
      objectFormat: "sha1",
      candidateOutput: completeTree([interrupted]),
    }),
  );
  await entered;
  controller.abort();
  continueResolve();
  await assert.rejects(
    running,
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.output-carrier-unavailable" &&
      error.retryable,
  );
  await assertCompilationEmpty(value.machineHome);
  await assert.rejects(
    readdir(join(
      value.machineHome,
      "candidate-revision-carriers",
      "v1",
      "objects",
    )),
    { code: "ENOENT" },
  );
});

test("Candidate output Carrier compilation refuses a symlink-substituted machine-home coordinate", async (context) => {
  const value = await fixture(context);
  const alias = join(value.root, "machine-alias");
  await symlink(value.machineHome, alias, "dir");
  await assert.rejects(
    publishCandidateRevisionCarrierFromCandidateOutput({
      machineHome: alias,
      objectFormat: "sha1",
      candidateOutput: healthyTree(),
    }),
    (error: unknown) => {
      if (!(error instanceof FoundationError) ||
          error.code !== "lifecycle.candidate.output-carrier-unavailable") return false;
      const serialized = JSON.stringify(error.toJSON());
      assert(!serialized.includes(value.root));
      assert(!serialized.includes(alias));
      return true;
    },
  );
});
