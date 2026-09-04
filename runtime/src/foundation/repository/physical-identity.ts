import { lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { isAbsolute, normalize, parse, sep } from "node:path";
import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";

export const FOUNDATION_REPOSITORY_PHYSICAL_IDENTITY_SCHEMA =
  "lifecycle.repository-physical-identity.v1" as const;

export type FoundationPhysicalDirectoryIdentity = Readonly<{
  absolutePath: string;
  device: string;
  inode: string;
}>;

export type FoundationRepositoryPhysicalIdentitySubject = Readonly<{
  schema: typeof FOUNDATION_REPOSITORY_PHYSICAL_IDENTITY_SCHEMA;
  repository: FoundationPhysicalDirectoryIdentity;
  gitCommonDirectory: FoundationPhysicalDirectoryIdentity;
}>;

export type FoundationRepositoryPhysicalIdentity = Readonly<{
  subject: FoundationRepositoryPhysicalIdentitySubject;
  digest: Sha256;
}>;

const CODE = "lifecycle.repository.physical-identity";

function fail(message: string, facts: Readonly<Record<string, unknown>> = {}): never {
  throw new FoundationError(CODE, message, { observedFacts: facts });
}

function physicalDirectory(absolutePath: string, label: string): Readonly<{
  absolutePath: string;
  stats: BigIntStats;
}> {
  const filesystemRoot = parse(absolutePath).root;
  if (!isAbsolute(absolutePath) || normalize(absolutePath) !== absolutePath ||
      absolutePath === filesystemRoot || absolutePath.endsWith(sep)) {
    fail(`${label} must use exact host-native normalized absolute path syntax`, { absolutePath });
  }

  let stats: BigIntStats;
  let resolved: string;
  try {
    stats = lstatSync(absolutePath, { bigint: true });
    resolved = realpathSync.native(absolutePath);
  } catch (error) {
    fail(`${label} cannot be observed exactly`, {
      absolutePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(`${label} must be one physical directory, not a symlink or another file kind`, { absolutePath });
  }
  if (resolved !== absolutePath) {
    fail(`${label} must already equal its canonical physical realpath`, { absolutePath, resolved });
  }
  return Object.freeze({ absolutePath: resolved, stats });
}

function directoryIdentity(absolutePath: string, label: string): FoundationPhysicalDirectoryIdentity {
  const physical = physicalDirectory(absolutePath, label);
  return Object.freeze({
    absolutePath: physical.absolutePath,
    device: physical.stats.dev.toString(10),
    inode: physical.stats.ino.toString(10),
  });
}

/**
 * Captures the runtime-private physical target referent whose digest enters an
 * Agent Attempt. Absolute paths remain in this private value; public carriers
 * bind only `digest`.
 */
export function captureRepositoryPhysicalIdentity(input: Readonly<{
  repository: string;
  gitCommonDirectory: string;
}>): FoundationRepositoryPhysicalIdentity {
  const subject: FoundationRepositoryPhysicalIdentitySubject = Object.freeze({
    schema: FOUNDATION_REPOSITORY_PHYSICAL_IDENTITY_SCHEMA,
    repository: directoryIdentity(input.repository, "Repository root"),
    gitCommonDirectory: directoryIdentity(input.gitCommonDirectory, "Git common directory"),
  });
  return Object.freeze({ subject, digest: digestCanonical(subject) });
}

/** Re-observes both physical directories and rejects replacement or retargeting. */
export function verifyRepositoryPhysicalIdentity(
  expected: FoundationRepositoryPhysicalIdentity,
): FoundationRepositoryPhysicalIdentity {
  if (expected.digest !== digestCanonical(expected.subject)) {
    fail("Repository physical-identity digest does not bind its exact subject");
  }
  const observed = captureRepositoryPhysicalIdentity({
    repository: expected.subject.repository.absolutePath,
    gitCommonDirectory: expected.subject.gitCommonDirectory.absolutePath,
  });
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    fail("The physical target changed identity after attachment");
  }
  return observed;
}
