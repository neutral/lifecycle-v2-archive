import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { createEmptyDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { createRepositoryContract, writeRepositoryContract } from "../../src/foundation/repository/contract.js";
import { assertRepositoryEpochUnmoved, git, parseGitTreeInventory } from "../../src/foundation/repository/git.js";
import { assertExactAuthoritativePaths } from "../../src/foundation/repository/product-state.js";
import { bindRepositorySnapshot, loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import type { FoundationLoadedRepositorySnapshot } from "../../src/foundation/repository/types.js";
import { digestCanonical, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "repository-state-test-secret-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("repository-state-publication");

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

function knowledgeDocument(kind: "blueprint" | "description"): string {
  const description = kind === "description";
  const title = description ? "Application description" : "Repository state architecture";
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind,
    id: description ? "description.application" : "blueprint.repository-state",
    title,
    status: "current",
    revision: 1,
    supersedes: null,
    summary: `${title} summary.`,
    owners: ["director"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: description ? {
      responsibility: "Own the test application source.",
      coverage: [{ path: "src/app.ts", mode: "file", role: "primary", exclude: [] }],
      behavior: ["exports one value"],
      boundaries: ["contains no process control"],
      invariants: ["remains tracked"],
      dependencies: [],
      failure: ["missing export"],
      rationale: ["one exact implementation unit"],
    } : {
      decision: "Bind repository state from exact tracked bytes.",
      scope: ["repository state"],
      components: ["epoch loader", "snapshot binder"],
      constraints: ["untracked authority is refused"],
      interfaces: ["repository snapshot"],
      dataFlows: ["exact tree to snapshot"],
      tradeoffs: ["exactness over ambient convenience"],
      evolution: [],
    },
  };
  const sections = description
    ? ["Responsibility", "Behavior", "Boundaries", "Rationale"]
    : ["Decision", "Structure", "Tradeoffs", "Evolution"];
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# ${title}\n\n${sections.map((section) => `## ${section}\n\n${section} details.`).join("\n\n")}\n`;
}

async function target(options: { implementationRoots?: readonly string[]; includeRoles?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-repository-state-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-repository-state-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await write(root, ".gitignore", "node_modules/\n.lifecycle/*\n!.lifecycle/repository.json\n");
  await write(root, "records/blueprint/repository-state.md", knowledgeDocument("blueprint"));
  await write(root, "records/disciplines/registry.json", `${JSON.stringify(createEmptyDisciplineRegistry(), null, 2)}\n`);
  const authority = await createFoundationAuthority(home, "repository-state-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  let contract = createRepositoryContract({
    targetId: "repository-state-target",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: options.implementationRoots ?? ["src"],
  });
  if (options.includeRoles) {
    const mutable = structuredClone(contract) as unknown as Record<string, unknown>;
    const policy = mutable.productState as Record<string, unknown>;
    policy.roots = [...policy.roots as string[], "docs"].sort();
    mutable.digest = selfDigest(mutable);
    contract = mutable as unknown as typeof contract;
  }
  await writeRepositoryContract(root, contract);
  if (options.includeRoles) {
    await write(root, "records/behavior/.gitkeep", "");
    await write(root, "src/app.ts", "export const value = 1;\n");
    await write(root, "src/_app.desc.md", knowledgeDocument("description"));
    await write(root, "docs/guide.md", "# Guide\n");
  }
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "Create Foundation target"]);
  return root;
}

function snapshotSubject(snapshot: FoundationLoadedRepositorySnapshot["snapshot"]): Record<string, unknown> {
  return {
    targetId: snapshot.targetId,
    commit: snapshot.commit,
    tree: snapshot.tree,
    objectFormat: snapshot.objectFormat,
    contractDigest: snapshot.contractDigest,
    productStateDigest: snapshot.productStateDigest,
    atlasStateDigest: snapshot.atlasStateDigest,
    atlasResolutionDigest: snapshot.atlasResolutionDigest,
    atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest,
    knowledgeSetDigest: snapshot.knowledgeSetDigest,
  };
}

async function loadBoundRepository(root: string): Promise<FoundationLoadedRepositorySnapshot> {
  const epoch = await loadRepositoryEpoch(root);
  return await bindRepositorySnapshot(epoch, await loadKnowledgeSet(epoch));
}

test("repository snapshot reads one exact commit while reporting live authoritative dirt", async () => {
  const root = await target({ includeRoles: true });
  const clean = await loadBoundRepository(root);
  const committedContract = await readFile(join(root, ".lifecycle/repository.json"), "utf8");
  const sourceObject = (await git(root, ["rev-parse", "HEAD:src/app.ts"])).stdout.trim();
  const roles = Object.fromEntries(clean.productState.entries.map((entry) => [entry.path, entry.role]));
  assert.equal(roles[".lifecycle/repository.json"], "repository-contract");
  assert.equal(roles["atlas/atlas.md"], "atlas");
  assert.equal(roles["records/behavior/.gitkeep"], "knowledge");
  assert.equal(roles["records/disciplines/registry.json"], "knowledge");
  assert.equal(roles["src/_app.desc.md"], "knowledge");
  assert.equal(roles["src/app.ts"], "governed-implementation");
  assert.equal(roles["docs/guide.md"], "declared-product");
  assert.equal(clean.productState.entries.find((entry) => entry.path === "src/app.ts")?.objectId, sourceObject);
  assert.equal(clean.snapshot.digest, digestCanonical(snapshotSubject(clean.snapshot)));

  await writeFile(join(root, ".lifecycle/repository.json"), "not live contract JSON\n", "utf8");
  await writeFile(join(root, "atlas", "atlas.md"), "# Dirty live Atlas\n", "utf8");
  await writeFile(join(root, "src", "app.ts"), "export const value = 2;\n", "utf8");
  const dirty = await loadBoundRepository(root);
  assert.equal(dirty.contract.targetId, "repository-state-target");
  assert.equal(dirty.snapshot.digest, clean.snapshot.digest);
  assert.equal(dirty.productState.digest, clean.productState.digest);
  assert.deepEqual(dirty.worktree.modified, [".lifecycle/repository.json", "atlas/atlas.md", "src/app.ts"]);
  assert.equal(dirty.worktree.dirty, true);
  assert.notEqual(await readFile(join(root, ".lifecycle/repository.json"), "utf8"), committedContract);
});

test("repository snapshot refuses untracked and ignored authoritative material", async () => {
  const root = await target({ includeRoles: true });
  await write(root, "atlas/untracked.md", "unbound\n");
  await assert.rejects(loadRepositoryEpoch(root), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority"
  ));
  await unlink(join(root, "atlas", "untracked.md"));
  await writeFile(join(root, ".gitignore"), "node_modules/\n.lifecycle/*\n!.lifecycle/repository.json\nsrc/ignored.ts\n", "utf8");
  await write(root, "src/ignored.ts", "ignored but authoritative\n");
  await assert.rejects(loadRepositoryEpoch(root), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority"
  ));
});

test("repository snapshot rejects executable semantic authority and symbolic implementation", async () => {
  const executableAtlas = await target();
  await chmod(join(executableAtlas, "atlas", "atlas.md"), 0o755);
  await git(executableAtlas, ["add", "--", "atlas/atlas.md"]);
  await git(executableAtlas, ["commit", "-m", "Make Atlas executable"]);
  await assert.rejects(loadRepositoryEpoch(executableAtlas), /must be non-executable/u);

  const symbolicImplementation = await target();
  await write(symbolicImplementation, "outside.ts", "outside\n");
  await mkdir(join(symbolicImplementation, "src"), { recursive: true });
  await symlink("../outside.ts", join(symbolicImplementation, "src", "link.ts"));
  await git(symbolicImplementation, ["add", "--", "outside.ts", "src/link.ts"]);
  await git(symbolicImplementation, ["commit", "-m", "Add symbolic implementation"]);
  await assert.rejects(loadRepositoryEpoch(symbolicImplementation), /not a tracked regular blob/u);
});

test("adopted Discipline paths and Registry obey exact tracked non-executable source custody", async () => {
  const root = await target({ implementationRoots: [] });
  await write(root, "records/disciplines/untracked.md", "untracked guidance\n");
  await assert.rejects(loadRepositoryEpoch(root), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority");
  await unlink(join(root, "records/disciplines/untracked.md"));
  const registryPath = join(root, "records/disciplines/registry.json");
  const exact = await loadBoundRepository(root);
  await writeFile(registryPath, "changed live Registry bytes\n", "utf8");
  const dirty = await loadBoundRepository(root);
  assert.equal(dirty.snapshot.digest, exact.snapshot.digest);
  assert.deepEqual(dirty.worktree.modified, ["records/disciplines/registry.json"]);
  await git(root, ["restore", "--", "records/disciplines/registry.json"]);
  await chmod(registryPath, 0o755);
  await git(root, ["add", "--", "records/disciplines/registry.json"]);
  await git(root, ["commit", "-m", "Make Registry executable"]);
  await assert.rejects(loadRepositoryEpoch(root), /must be non-executable/u);
});

test("repository snapshot rejects Gitlinks and folded authoritative aliases", async () => {
  const gitlinkTarget = await target();
  const commit = (await git(gitlinkTarget, ["rev-parse", "HEAD"])).stdout.trim();
  await git(gitlinkTarget, ["update-index", "--add", "--cacheinfo", "160000", commit, "src/vendor"]);
  await git(gitlinkTarget, ["commit", "-m", "Add implementation Gitlink"]);
  await assert.rejects(loadRepositoryEpoch(gitlinkTarget), /not a tracked regular blob/u);

  assert.throws(
    () => assertExactAuthoritativePaths([{ path: "atlas/Guide.md" }, { path: "atlas/guide.md" }]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.path.case-mismatch",
  );
  assert.throws(
    () => assertExactAuthoritativePaths([{ path: "src/app.ts" }], [{ path: "SRC/unrelated.txt" }, { path: "src/app.ts" }]),
    /case folding/u,
  );
  assert.throws(
    () => assertExactAuthoritativePaths([{ path: "atlas/caf\u00e9.md" }, { path: "atlas/cafe\u0301.md" }]),
    /Unicode normalization/u,
  );
});

test("tree inventory rejects invalid UTF-8 and malformed NUL framing", () => {
  const object = "a".repeat(40);
  const header = Buffer.from(`100644 blob ${object}\t`, "ascii");
  assert.throws(() => parseGitTreeInventory(Buffer.concat([header, Buffer.from([0xff, 0])]), "sha1"), /not valid UTF-8/u);
  assert.throws(() => parseGitTreeInventory(Buffer.concat([header, Buffer.from("path", "utf8")]), "sha1"), /not terminated by NUL/u);
});

test("repository snapshot rejects fixed predecessor Control and detects later ref motion", async () => {
  const mixed = await target();
  await write(mixed, "records/control/delivery/work-boundaries/old.json", '{"schema":"lifecycle.delivery-work-boundary.v3"}\n');
  await git(mixed, ["add", "--", "records/control/delivery/work-boundaries/old.json"]);
  await git(mixed, ["commit", "-m", "Add predecessor Control"]);
  await assert.rejects(loadRepositoryEpoch(mixed), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed"
  ));

  const moving = await target({ includeRoles: true });
  const before = await loadBoundRepository(moving);
  await writeFile(join(moving, "src", "app.ts"), "export const value = 3;\n", "utf8");
  await git(moving, ["add", "--", "src/app.ts"]);
  await git(moving, ["commit", "-m", "Move canonical ref"]);
  await assert.rejects(assertRepositoryEpochUnmoved(moving, before.epoch), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed"
  ));
});

test("empty governed implementation roots form a reproducible repository epoch", async () => {
  const root = await target({ implementationRoots: [] });
  const first = await loadBoundRepository(root);
  const second = await loadBoundRepository(root);
  assert.equal(first.snapshot.digest, second.snapshot.digest);
  assert.deepEqual(first.productState.entries.map((entry) => entry.role), [
    "repository-contract",
    "atlas",
    "atlas",
    "atlas",
    "knowledge",
    "knowledge",
  ]);
});
