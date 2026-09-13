import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import {
  archiveControlRecordStore,
  controlRecordStoreArchiveDirectoryName,
  openArchivedControlRecordStore,
} from "./archive.js";
import { controlIdentifier, controlTimestamp } from "./model.js";
import {
  CONTROL_RECORD_STORE_DATABASE_APPLICATION_ID,
  CONTROL_RECORD_STORE_DATABASE_USER_VERSION,
  controlRecordStorePaths,
  openControlRecordStore,
  type ControlRecordStore,
} from "./store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordStoreIdentity,
} from "./types.js";

const REGISTRY_DIRECTORY = "control-record-stores";
const ACTIVE_DIRECTORY = "active";
const ARCHIVE_DIRECTORY = "archive";
const STAGING_DIRECTORY = "staging";
const DIGEST_SEGMENT_PATTERN = /^sha256-[a-f0-9]{64}$/u;
const MAXIMUM_TARGETS_PER_AREA = 10_000;
const MAXIMUM_DELIVERIES_PER_TARGET = 10_000;
const MAXIMUM_LIST_LIMIT = 500;
const SQLITE_TRANSIENT_PATTERN = /^control-record-store\.sqlite-(?:journal|wal|shm)$/u;

type RegistryPaths = Readonly<{
  root: string;
  active: string;
  archive: string;
  staging: string;
}>;

type SelectedPaths = Readonly<{
  targetSegment: string;
  deliverySegment: string;
  activeTarget: string;
  archiveTarget: string;
  stagingTarget: string;
  active: string;
  archive: string;
  staging: string;
}>;

export type DeliveryControlRecordStoreDisposition = "active" | "archived";

export type DeliveryCustodyCreationStage =
  | "staging-ready"
  | "store-created"
  | "delivery-created"
  | "published";

export type DeliveryControlRecordStoreEntry = Readonly<{
  identity: ControlRecordStoreIdentity;
  disposition: DeliveryControlRecordStoreDisposition;
}>;

export type OpenedDeliveryControlRecordStore = DeliveryControlRecordStoreEntry & Readonly<{
  archiveManifestDigest: Sha256 | null;
  store: ControlRecordStore;
  /** Private first-opening failure, retained only when a named Activity survived. */
  initializationError?: unknown;
}>;

function fail(code: string, message: string, observedFacts?: unknown): never {
  throw new FoundationError(`lifecycle.control-record-store.custody-${code}`, message, {
    observedFacts,
  });
}

function effectiveUid(): bigint | null {
  const value = process.geteuid?.() ?? process.getuid?.();
  return value === undefined ? null : BigInt(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertDirectory(
  path: string,
  label: string,
  exactMode: number | null = 0o700,
): Promise<void> {
  const state = await lstat(path, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink()) {
    fail("layout", `${label} must be one canonical physical directory`);
  }
  if (exactMode !== null && Number(state.mode & 0o7777n) !== exactMode) {
    fail("layout", `${label} must use mode ${exactMode.toString(8).padStart(4, "0")}`);
  }
  const uid = effectiveUid();
  if (uid !== null && state.uid !== uid) {
    fail("layout", `${label} must be owned by the effective user`);
  }
}

async function ensureDirectory(path: string, label: string): Promise<void> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (created) await chmod(path, 0o700);
  await assertDirectory(path, label);
}

async function boundedEntries(
  path: string,
  maximum: number,
  label: string,
): Promise<readonly string[]> {
  const entries: string[] = [];
  const directory = await opendir(path);
  try {
    for await (const entry of directory) {
      entries.push(entry.name);
      if (entries.length > maximum) {
        fail("limit", `${label} exceeds its bounded entry limit`, { maximum });
      }
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return Object.freeze(entries.sort());
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function identitySegment(value: string): string {
  return `sha256-${sha256Bytes(value).slice("sha256:".length)}`;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function ensureRegistryLayout(machineHome: string): Promise<RegistryPaths> {
  const home = resolve(machineHome);
  await assertDirectory(home, "Lifecycle machine home", null);
  const root = join(home, REGISTRY_DIRECTORY);
  await ensureDirectory(root, "Control Record Store registry root");

  const allowed = new Set([ACTIVE_DIRECTORY, ARCHIVE_DIRECTORY, STAGING_DIRECTORY]);
  const retained = await boundedEntries(root, allowed.size, "Control Record Store registry root");
  const unsupported = retained.filter((entry) => !allowed.has(entry));
  if (unsupported.length > 0) {
    fail("layout", "Control Record Store registry root contains unsupported entries", {
      entries: unsupported,
    });
  }

  const paths = Object.freeze({
    root,
    active: join(root, ACTIVE_DIRECTORY),
    archive: join(root, ARCHIVE_DIRECTORY),
    staging: join(root, STAGING_DIRECTORY),
  });
  await ensureDirectory(paths.active, "Active Control Record Store area");
  await ensureDirectory(paths.archive, "Archived Control Record Store area");
  await ensureDirectory(paths.staging, "Staging Control Record Store area");
  await syncDirectory(root);

  for (const [label, area] of [
    ["Active Control Record Store area", paths.active],
    ["Archived Control Record Store area", paths.archive],
    ["Staging Control Record Store area", paths.staging],
  ] as const) {
    for (const entry of await boundedEntries(area, MAXIMUM_TARGETS_PER_AREA, label)) {
      if (!DIGEST_SEGMENT_PATTERN.test(entry)) {
        fail("layout", `${label} contains a non-digest target segment`, { entry });
      }
      await assertDirectory(join(area, entry), `${label} target directory`);
    }
  }
  return paths;
}

async function readRegistryLayout(machineHome: string): Promise<RegistryPaths | null> {
  const home = resolve(machineHome);
  await assertDirectory(home, "Lifecycle machine home", null);
  const root = join(home, REGISTRY_DIRECTORY);
  if (!await pathExists(root)) return null;
  await assertDirectory(root, "Control Record Store registry root");

  const allowed = new Set([ACTIVE_DIRECTORY, ARCHIVE_DIRECTORY, STAGING_DIRECTORY]);
  const retained = await boundedEntries(root, allowed.size, "Control Record Store registry root");
  const unsupported = retained.filter((entry) => !allowed.has(entry));
  if (unsupported.length > 0) {
    fail("layout", "Control Record Store registry root contains unsupported entries", {
      entries: unsupported,
    });
  }
  const present = retained.filter((entry) => allowed.has(entry));
  if (present.length === 0) return null;
  if (present.length !== allowed.size) {
    fail("layout", "Control Record Store registry root has an incomplete physical area set", {
      entries: retained,
    });
  }

  const paths = Object.freeze({
    root,
    active: join(root, ACTIVE_DIRECTORY),
    archive: join(root, ARCHIVE_DIRECTORY),
    staging: join(root, STAGING_DIRECTORY),
  });
  for (const [label, area] of [
    ["Active Control Record Store area", paths.active],
    ["Archived Control Record Store area", paths.archive],
    ["Staging Control Record Store area", paths.staging],
  ] as const) {
    await assertDirectory(area, label);
    for (const entry of await boundedEntries(area, MAXIMUM_TARGETS_PER_AREA, label)) {
      if (!DIGEST_SEGMENT_PATTERN.test(entry)) {
        fail("layout", `${label} contains a non-digest target segment`, { entry });
      }
      await assertDirectory(join(area, entry), `${label} target directory`);
    }
  }
  return paths;
}

async function selectedPaths(
  machineHome: string,
  targetId: string,
  deliveryId: string,
): Promise<SelectedPaths> {
  const target = controlIdentifier(targetId, "Target identity");
  const delivery = controlIdentifier(deliveryId, "Delivery identity");
  const registry = await ensureRegistryLayout(machineHome);
  const targetSegment = identitySegment(target);
  const deliverySegment = identitySegment(delivery);
  const activeTarget = join(registry.active, targetSegment);
  const archiveTarget = join(registry.archive, targetSegment);
  const stagingTarget = join(registry.staging, targetSegment);
  await ensureDirectory(activeTarget, "Active target Control Record Store area");
  await ensureDirectory(archiveTarget, "Archived target Control Record Store area");
  await ensureDirectory(stagingTarget, "Staging target Control Record Store area");
  return Object.freeze({
    targetSegment,
    deliverySegment,
    activeTarget,
    archiveTarget,
    stagingTarget,
    active: join(activeTarget, deliverySegment),
    archive: join(archiveTarget, deliverySegment),
    staging: join(stagingTarget, deliverySegment),
  });
}

async function selectedReadPaths(
  machineHome: string,
  targetId: string,
  deliveryId: string,
): Promise<SelectedPaths | null> {
  const target = controlIdentifier(targetId, "Target identity");
  const delivery = controlIdentifier(deliveryId, "Delivery identity");
  const registry = await readRegistryLayout(machineHome);
  if (registry === null) return null;
  const targetSegment = identitySegment(target);
  const deliverySegment = identitySegment(delivery);
  const activeTarget = join(registry.active, targetSegment);
  const archiveTarget = join(registry.archive, targetSegment);
  const stagingTarget = join(registry.staging, targetSegment);
  const targetPresence = await Promise.all([
    pathExists(activeTarget),
    pathExists(archiveTarget),
    pathExists(stagingTarget),
  ]);
  if (targetPresence.every((present) => !present)) return null;
  if (targetPresence.some((present) => !present)) {
    fail("layout", "Selected target has an incomplete Control Record Store custody area set");
  }
  await assertDirectory(activeTarget, "Active target Control Record Store area");
  await assertDirectory(archiveTarget, "Archived target Control Record Store area");
  await assertDirectory(stagingTarget, "Staging target Control Record Store area");
  return Object.freeze({
    targetSegment,
    deliverySegment,
    activeTarget,
    archiveTarget,
    stagingTarget,
    active: join(activeTarget, deliverySegment),
    archive: join(archiveTarget, deliverySegment),
    staging: join(stagingTarget, deliverySegment),
  });
}

async function assertDatabaseFile(root: string): Promise<string> {
  const database = controlRecordStorePaths(root).database;
  const state = await lstat(database, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
    fail("metadata", "Control Record Store metadata carrier must be one canonical regular file");
  }
  if (Number(state.mode & 0o7777n) !== 0o600) {
    fail("metadata", "Control Record Store metadata carrier must use mode 0600");
  }
  const uid = effectiveUid();
  if (uid !== null && state.uid !== uid) {
    fail("metadata", "Control Record Store metadata carrier must be owned by the effective user");
  }
  return database;
}

function metadataString(value: unknown, label: string): string {
  if (typeof value !== "string") fail("metadata", `${label} must be one text value`);
  return value;
}

async function discoverStoreIdentity(root: string): Promise<ControlRecordStoreIdentity> {
  await assertDirectory(root, "Selected Control Record Store root");
  const database = await assertDatabaseFile(root);
  let connection: DatabaseSync | null = null;
  try {
    connection = new DatabaseSync(database, {
      readOnly: true,
      timeout: 1_000,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      defensive: true,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      limits: {
        length: 64 * 1024,
        sqlLength: 16 * 1024,
        column: 16,
        exprDepth: 64,
        compoundSelect: 1,
        functionArg: 8,
        attach: 0,
        likePatternLength: 256,
        variableNumber: 8,
        triggerDepth: 1,
      },
    });
    connection.enableDefensive(true);
    connection.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    const applicationId = (connection.prepare("PRAGMA application_id").get() as
      Readonly<{ application_id: number }>).application_id;
    const userVersion = (connection.prepare("PRAGMA user_version").get() as
      Readonly<{ user_version: number }>).user_version;
    if (applicationId !== CONTROL_RECORD_STORE_DATABASE_APPLICATION_ID
      || userVersion !== CONTROL_RECORD_STORE_DATABASE_USER_VERSION) {
      fail("metadata", "Selected database has unsupported Control Record Store coordinates", {
        applicationId,
        userVersion,
      });
    }
    const rows = connection.prepare(`
      SELECT schema_id, store_id, target_id, process_kind, process_id, created_at
      FROM store_metadata
      ORDER BY singleton
      LIMIT 2
    `).all() as readonly Readonly<Record<string, unknown>>[];
    if (rows.length !== 1) {
      fail("metadata", "Control Record Store must retain exactly one bounded identity row");
    }
    const row = rows[0] as Readonly<Record<string, unknown>>;
    const schema = metadataString(row.schema_id, "Store schema");
    const processKind = metadataString(row.process_kind, "Store Process kind");
    if (schema !== CONTROL_RECORD_STORE_SCHEMA || processKind !== "delivery") {
      fail("metadata", "Control Record Store identity selects unsupported coordinates");
    }
    return Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: controlIdentifier(metadataString(row.store_id, "Store identity"), "Store identity"),
      targetId: controlIdentifier(metadataString(row.target_id, "Target identity"), "Target identity"),
      processKind: "delivery",
      processId: controlIdentifier(metadataString(row.process_id, "Delivery identity"), "Delivery identity"),
      createdAt: controlTimestamp(metadataString(row.created_at, "Store creation time"), "Store creation time"),
    });
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    return fail(
      "metadata",
      "Control Record Store identity could not be discovered through bounded read-only metadata",
    );
  } finally {
    connection?.close();
  }
}

function assertSelectedIdentity(
  identity: ControlRecordStoreIdentity,
  targetId: string,
  deliveryId: string,
  physicalSegment: string,
): void {
  if (
    identity.targetId !== targetId ||
    identity.processId !== deliveryId ||
    identitySegment(identity.processId) !== physicalSegment
  ) {
    fail("selection", "Retained Store identity does not match the exact target and Delivery selection", {
      retainedTargetId: identity.targetId,
      retainedDeliveryId: identity.processId,
    });
  }
}

function sameIdentity(
  left: ControlRecordStoreIdentity,
  right: ControlRecordStoreIdentity,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function openSelectedRoot(input: Readonly<{
  root: string;
  disposition: DeliveryControlRecordStoreDisposition;
  targetId: string;
  deliveryId: string;
  physicalSegment: string;
  readOnly?: boolean;
}>): Promise<OpenedDeliveryControlRecordStore> {
  const identity = await discoverStoreIdentity(input.root);
  assertSelectedIdentity(identity, input.targetId, input.deliveryId, input.physicalSegment);
  if (input.disposition === "active") {
    const store = await openControlRecordStore({
      root: input.root,
      identity,
      create: false,
      readOnly: input.readOnly === true,
    });
    return Object.freeze({
      identity,
      disposition: input.disposition,
      archiveManifestDigest: null,
      store,
    });
  }
  const archived = await openArchivedControlRecordStore({
      archiveRoot: input.root,
      identity,
    });
  return Object.freeze({
    identity,
    disposition: input.disposition,
    archiveManifestDigest: archived.manifestDigest,
    store: archived.store,
  });
}

async function entrySet(path: string, label: string): Promise<ReadonlySet<string>> {
  await assertDirectory(path, label);
  const entries = await boundedEntries(path, MAXIMUM_DELIVERIES_PER_TARGET, label);
  for (const entry of entries) {
    if (!DIGEST_SEGMENT_PATTERN.test(entry)) {
      fail("layout", `${label} contains a non-digest Delivery segment`, { entry });
    }
    await assertDirectory(join(path, entry), `${label} Delivery directory`);
  }
  return new Set(entries);
}

async function inspectStagingRoot(root: string): Promise<ControlRecordStoreIdentity | null> {
  await assertDirectory(root, "Staging Control Record Store root");
  const entries = await boundedEntries(root, 6, "Staging Control Record Store root");
  const supported = new Set([
    "control-record-store.sqlite",
    "files",
    "drafts",
    "control-record-store.sqlite-journal",
    "control-record-store.sqlite-wal",
    "control-record-store.sqlite-shm",
  ]);
  if (entries.some((entry) => !supported.has(entry))) {
    fail("staging", "Staging Control Record Store contains unsupported entries", { entries });
  }
  if (entries.some((entry) => SQLITE_TRANSIENT_PATTERN.test(entry)) &&
      !entries.includes("control-record-store.sqlite")) {
    fail("staging", "Staging SQLite transient has no exact database carrier");
  }
  if (!entries.includes("control-record-store.sqlite")) return null;
  if (!entries.includes("files") || !entries.includes("drafts")) {
    fail("staging", "Staging Store database exists without its exact directory layout");
  }
  return discoverStoreIdentity(root);
}

async function assertNoSelectedAmbiguity(paths: SelectedPaths): Promise<Readonly<{
  active: boolean;
  archive: boolean;
  staging: boolean;
}>> {
  const active = await pathExists(paths.active);
  const archive = await pathExists(paths.archive);
  const staging = await pathExists(paths.staging);
  if (active && archive) {
    fail("conflict", "One exact Delivery exists in both active and archive custody");
  }
  if (staging && (active || archive)) {
    fail("staging", "Published and staged custody both exist for one exact Delivery");
  }
  return Object.freeze({ active, archive, staging });
}

function creationIdentity(input: Readonly<{
  targetId: string;
  deliveryId: string;
  createdAt: string;
}>): ControlRecordStoreIdentity {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const processId = controlIdentifier(input.deliveryId, "Delivery identity");
  const createdAt = controlTimestamp(input.createdAt, "Control Record Store creation time");
  const subjectDigest = sha256Bytes(canonicalJson(Object.freeze({
    schema: "lifecycle.delivery-control-record-store-identity.v1",
    targetId,
    deliveryId: processId,
  })));
  return Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: `store-${subjectDigest.slice("sha256:".length)}`,
    targetId,
    processKind: "delivery",
    processId,
    createdAt,
  });
}

function creationEventId(identity: ControlRecordStoreIdentity): string {
  return `event-delivery-created-${sha256Bytes(canonicalJson(identity)).slice("sha256:".length)}`;
}

function assertExactCreationEvent(
  store: ControlRecordStore,
  runtimeActorId: string,
  requireFresh: boolean,
): void {
  const events = store.listEvents(0, requireFresh ? 2 : 1);
  if (events.length === 0) {
    fail("creation", "Published Control Record Store has no delivery-created event");
  }
  const event = events[0];
  if (
    event === undefined ||
    event.sequence !== 1 ||
    event.eventId !== creationEventId(store.identity) ||
    event.eventKind !== "delivery-created" ||
    event.occurredAt !== store.identity.createdAt ||
    event.actor.kind !== "runtime" ||
    event.actor.id !== runtimeActorId ||
    event.subject !== null ||
    Object.keys(event.payload).length !== 0 ||
    event.predecessorDigest !== null
  ) {
    fail("creation", "Control Record Store does not begin with its exact deterministic delivery-created event");
  }
  if (requireFresh && events.length !== 1) {
    fail("staging", "A staged Control Record Store contains activity beyond Delivery creation");
  }
}

async function assertFreshStore(store: ControlRecordStore): Promise<void> {
  const integrity = await store.verifyIntegrity();
  if (
    integrity.eventCount !== 1 ||
    integrity.recordCount !== 0 ||
    integrity.revisionCount !== 0 ||
    integrity.referencedFileCount !== 0 ||
    store.hasRetainedOperationSupport()
  ) {
    fail("staging", "A staged Control Record Store is not the exact fresh Delivery inventory", integrity);
  }
  if ((await readdir(store.paths.files)).length !== 0 ||
      (await readdir(store.paths.drafts)).length !== 0) {
    fail("staging", "A staged Control Record Store contains files or authoring workspaces");
  }
}

function assertUnexecutedPreparationOpening(store: ControlRecordStore): void {
  const activities = store.state().activities;
  if (activities.length !== 1 || activities[0]!.operation !== "delivery.prepare" ||
      activities[0]!.stage !== "started" || activities[0]!.recovery?.resumesAt !== "agent-attempt-prepared" ||
      !store.hasRetainedOperationSupport(activities[0]!.id) ||
      store.listEvents(0, 10).some(({ eventKind }) => eventKind === "agent-attempt-prepared" || eventKind === "provider-effect-intended")) {
    fail("staging", "Preparation publication requires one exact first Activity with no execution allocation or intent");
  }
}

async function notifyStage(
  observer: ((stage: DeliveryCustodyCreationStage) => void | Promise<void>) | undefined,
  stage: DeliveryCustodyCreationStage,
): Promise<void> {
  await observer?.(stage);
}

export async function createDeliveryControlRecordStore(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
  createdAt: string;
  runtimeActorId: string;
  onStage?: (stage: DeliveryCustodyCreationStage) => void | Promise<void>;
  initializeBeforePublication?: (store: ControlRecordStore) => Promise<void>;
}>): Promise<OpenedDeliveryControlRecordStore> {
  const identity = creationIdentity(input);
  const runtimeActorId = controlIdentifier(input.runtimeActorId, "Runtime actor identity");
  const paths = await selectedPaths(input.machineHome, identity.targetId, identity.processId);
  await entrySet(paths.activeTarget, "Active target Control Record Store area");
  await entrySet(paths.archiveTarget, "Archived target Control Record Store area");
  await entrySet(paths.stagingTarget, "Staging target Control Record Store area");
  let physical = await assertNoSelectedAmbiguity(paths);

  if (physical.archive) {
    const retained = await openSelectedRoot({
      root: paths.archive,
      disposition: "archived",
      targetId: identity.targetId,
      deliveryId: identity.processId,
      physicalSegment: paths.deliverySegment,
    });
    retained.store.close();
    fail("conflict", "An archived Control Record Store already exists for the exact Delivery");
  }

  if (physical.active) {
    const retained = await openSelectedRoot({
      root: paths.active,
      disposition: "active",
      targetId: identity.targetId,
      deliveryId: identity.processId,
      physicalSegment: paths.deliverySegment,
    });
    if (!sameIdentity(retained.identity, identity)) {
      retained.store.close();
      fail("conflict", "Creation retry changes the exact retained Store identity");
    }
    try {
      assertExactCreationEvent(retained.store, runtimeActorId, false);
    } catch (error) {
      retained.store.close();
      throw error;
    }
    return retained;
  }

  let stagingCreated = false;
  if (!physical.staging) {
    await ensureDirectory(paths.staging, "Staging Control Record Store root");
    await syncDirectory(paths.stagingTarget);
    stagingCreated = true;
    await notifyStage(input.onStage, "staging-ready");
  }

  const stagedIdentity = await inspectStagingRoot(paths.staging);
  if (stagedIdentity !== null && !sameIdentity(stagedIdentity, identity)) {
    fail("staging", "Staging retry changes the exact retained Store identity");
  }
  const databaseExisted = stagedIdentity !== null;
  const staged = await openControlRecordStore({
    root: paths.staging,
    identity,
    create: true,
  });
  let appendedCreation = false;
  let initializationError: unknown;
  let discardFresh = false;
  try {
    if (!databaseExisted) await notifyStage(input.onStage, "store-created");
    const integrity = await staged.verifyIntegrity();
    if (integrity.eventCount === 0) {
      staged.append({
        event: {
          eventId: creationEventId(identity),
          eventKind: "delivery-created",
          occurredAt: identity.createdAt,
          actor: { kind: "runtime", id: runtimeActorId },
          payload: {},
        },
      });
      appendedCreation = true;
    }
    const hasOpening = staged.state().activities.length > 0;
    assertExactCreationEvent(staged, runtimeActorId, !hasOpening);
    if (hasOpening) {
      if (input.initializeBeforePublication === undefined) fail("staging", "An initialized Store requires its preparation creation route");
      assertUnexecutedPreparationOpening(staged);
    } else await assertFreshStore(staged);
    if (input.initializeBeforePublication !== undefined && !hasOpening) {
      try {
        await input.initializeBeforePublication(staged);
        assertUnexecutedPreparationOpening(staged);
      } catch (error) {
        initializationError = error;
        // A failed exact pin/open may be discarded only while it is unexposed
        // and the owner proves there is no Activity, support, record, or file.
        try { await assertFreshStore(staged); discardFresh = true; } catch {
          assertUnexecutedPreparationOpening(staged);
        }
      }
    }
    staged.checkpoint();
  } finally {
    staged.close();
  }
  if (discardFresh) {
    await rm(paths.staging, { recursive: true });
    await syncDirectory(paths.stagingTarget);
    throw initializationError;
  }
  if (appendedCreation) await notifyStage(input.onStage, "delivery-created");

  physical = await assertNoSelectedAmbiguity(paths);
  if (physical.active || physical.archive) {
    fail("staging", "Custody changed while the exact staged Delivery was being published");
  }
  try {
    await rename(paths.staging, paths.active);
    await syncDirectory(paths.stagingTarget);
    await syncDirectory(paths.activeTarget);
  } catch (error) {
    if (!await pathExists(paths.staging) && await pathExists(paths.active)) {
      const recovered = await openSelectedRoot({
        root: paths.active,
        disposition: "active",
        targetId: identity.targetId,
        deliveryId: identity.processId,
        physicalSegment: paths.deliverySegment,
      });
      if (!sameIdentity(recovered.identity, identity)) {
        recovered.store.close();
        fail("conflict", "Published Store identity changed during creation recovery");
      }
      assertExactCreationEvent(recovered.store, runtimeActorId, false);
      return recovered;
    }
    throw error;
  }
  if (stagingCreated || appendedCreation) await notifyStage(input.onStage, "published");

  const published = await openSelectedRoot({
    root: paths.active,
    disposition: "active",
    targetId: identity.targetId,
    deliveryId: identity.processId,
    physicalSegment: paths.deliverySegment,
  });
  if (!sameIdentity(published.identity, identity)) {
    published.store.close();
    fail("conflict", "Published Store identity does not equal its exact staged identity");
  }
  assertExactCreationEvent(published.store, runtimeActorId, false);
  return initializationError === undefined ? published : Object.freeze({ ...published, initializationError });
}

async function selectedDeliveryControlRecordStore(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
}>): Promise<Readonly<{
  paths: SelectedPaths;
  disposition: DeliveryControlRecordStoreDisposition;
}> | null> {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const deliveryId = controlIdentifier(input.deliveryId, "Delivery identity");
  const paths = await selectedReadPaths(input.machineHome, targetId, deliveryId);
  if (paths === null) return null;
  await entrySet(paths.activeTarget, "Active target Control Record Store area");
  await entrySet(paths.archiveTarget, "Archived target Control Record Store area");
  await entrySet(paths.stagingTarget, "Staging target Control Record Store area");
  const physical = await assertNoSelectedAmbiguity(paths);
  if (physical.staging) {
    await inspectStagingRoot(paths.staging);
    fail("staging", "The exact Delivery remains in retryable staging custody");
  }
  if (!physical.active && !physical.archive) {
    return null;
  }
  return Object.freeze({
    paths,
    disposition: physical.active ? "active" : "archived",
  });
}

/**
 * Select and open one exact Delivery without creating registry or custody
 * directories. Absence is an ordinary null observation; malformed or
 * ambiguous retained custody still fails closed.
 */
export async function openDeliveryControlRecordStoreReadOnly(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
}>): Promise<OpenedDeliveryControlRecordStore | null> {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const deliveryId = controlIdentifier(input.deliveryId, "Delivery identity");
  const selected = await selectedDeliveryControlRecordStore(input);
  if (selected === null) return null;
  return openSelectedRoot({
    root: selected.disposition === "active" ? selected.paths.active : selected.paths.archive,
    disposition: selected.disposition,
    targetId,
    deliveryId,
    physicalSegment: selected.paths.deliverySegment,
    readOnly: true,
  });
}

export async function openDeliveryControlRecordStore(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
  readOnly?: boolean;
}>): Promise<OpenedDeliveryControlRecordStore> {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const deliveryId = controlIdentifier(input.deliveryId, "Delivery identity");
  const selected = await selectedDeliveryControlRecordStore(input);
  if (selected === null) {
    fail("selection", "No Control Record Store exists for the exact target and Delivery selection");
  }
  return openSelectedRoot({
    root: selected.disposition === "active" ? selected.paths.active : selected.paths.archive,
    disposition: selected.disposition,
    targetId,
    deliveryId,
    physicalSegment: selected.paths.deliverySegment,
    readOnly: input.readOnly,
  });
}

export async function archiveDeliveryControlRecordStore(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
  archivedAt: string;
}>): Promise<Readonly<{
  identity: ControlRecordStoreIdentity;
  disposition: "archived";
  manifestDigest: Sha256;
}>> {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const deliveryId = controlIdentifier(input.deliveryId, "Delivery identity");
  const archivedAt = controlTimestamp(input.archivedAt, "Control Record Store archive time");
  const paths = await selectedPaths(input.machineHome, targetId, deliveryId);
  await entrySet(paths.activeTarget, "Active target Control Record Store area");
  await entrySet(paths.archiveTarget, "Archived target Control Record Store area");
  await entrySet(paths.stagingTarget, "Staging target Control Record Store area");
  const physical = await assertNoSelectedAmbiguity(paths);
  if (physical.staging) {
    await inspectStagingRoot(paths.staging);
    fail("staging", "A staged Delivery cannot be archived");
  }
  if (!physical.active && !physical.archive) {
    fail("selection", "No Control Record Store exists for the exact target and Delivery selection");
  }

  const selectedRoot = physical.active ? paths.active : paths.archive;
  const identity = await discoverStoreIdentity(selectedRoot);
  assertSelectedIdentity(identity, targetId, deliveryId, paths.deliverySegment);
  if (controlRecordStoreArchiveDirectoryName(identity) !== paths.deliverySegment) {
    fail("selection", "Archive owner does not reproduce the exact Delivery custody segment");
  }
  const archived = await archiveControlRecordStore({
    activeRoot: paths.active,
    archiveParent: paths.archiveTarget,
    identity,
    archivedAt,
  });
  if (archived.archiveRoot !== paths.archive) {
    fail("selection", "Archive owner selected a different physical Delivery segment");
  }
  await assertDirectory(paths.archive, "Archived Control Record Store root");
  return Object.freeze({
    identity,
    disposition: "archived",
    manifestDigest: archived.manifestDigest,
  });
}

async function validateStagingArea(
  path: string,
  targetId: string,
  active: ReadonlySet<string>,
  archived: ReadonlySet<string>,
): Promise<void> {
  const staged = await entrySet(path, "Staging target Control Record Store area");
  for (const segment of staged) {
    if (active.has(segment) || archived.has(segment)) {
      fail("staging", "One Delivery exists in both staged and published custody", { segment });
    }
    const identity = await inspectStagingRoot(join(path, segment));
    if (identity === null) {
      fail("staging", "Staging custody has no discoverable Store identity and requires exact creation retry");
    }
    if (identity.targetId !== targetId || identitySegment(identity.processId) !== segment) {
      fail("staging", "Staging Store identity does not match its exact digest custody segment");
    }
  }
}

export async function listDeliveryControlRecordStores(input: Readonly<{
  machineHome: string;
  targetId: string;
  afterDeliveryId?: string;
  limit?: number;
}>): Promise<Readonly<{
  deliveries: readonly DeliveryControlRecordStoreEntry[];
  nextAfterDeliveryId: string | null;
  inventoryDigest: Sha256;
}>> {
  const targetId = controlIdentifier(input.targetId, "Target identity");
  const afterDeliveryId = input.afterDeliveryId === undefined
    ? null
    : controlIdentifier(input.afterDeliveryId, "Delivery list cursor");
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_LIST_LIMIT) {
    fail("limit", `Delivery list limit must be between 1 and ${MAXIMUM_LIST_LIMIT}`);
  }
  const registry = await readRegistryLayout(input.machineHome);
  if (registry === null) {
    return Object.freeze({
      deliveries: Object.freeze([]),
      nextAfterDeliveryId: null,
      inventoryDigest: sha256Bytes(canonicalJson({
        schema: "lifecycle.delivery-registry-inventory.v1",
        targetId,
        deliveries: [],
      })),
    });
  }
  const targetSegment = identitySegment(targetId);
  const activeTarget = join(registry.active, targetSegment);
  const archiveTarget = join(registry.archive, targetSegment);
  const stagingTarget = join(registry.staging, targetSegment);
  const targetPresence = await Promise.all([
    pathExists(activeTarget),
    pathExists(archiveTarget),
    pathExists(stagingTarget),
  ]);
  if (targetPresence.every((present) => !present)) {
    return Object.freeze({
      deliveries: Object.freeze([]),
      nextAfterDeliveryId: null,
      inventoryDigest: sha256Bytes(canonicalJson({
        schema: "lifecycle.delivery-registry-inventory.v1",
        targetId,
        deliveries: [],
      })),
    });
  }
  if (targetPresence.some((present) => !present)) {
    fail("layout", "Selected target has an incomplete Control Record Store custody area set");
  }
  await assertDirectory(activeTarget, "Active target Control Record Store area");
  await assertDirectory(archiveTarget, "Archived target Control Record Store area");
  await assertDirectory(stagingTarget, "Staging target Control Record Store area");
  const active = await entrySet(activeTarget, "Active target Control Record Store area");
  const archived = await entrySet(archiveTarget, "Archived target Control Record Store area");
  for (const segment of active) {
    if (archived.has(segment)) {
      fail("conflict", "One exact Delivery exists in both active and archive custody", { segment });
    }
  }
  await validateStagingArea(stagingTarget, targetId, active, archived);

  const deliveries: DeliveryControlRecordStoreEntry[] = [];
  for (const [disposition, parent, segments] of [
    ["active", activeTarget, active],
    ["archived", archiveTarget, archived],
  ] as const) {
    for (const segment of segments) {
      const root = join(parent, segment);
      const identity = await discoverStoreIdentity(root);
      if (identity.targetId !== targetId || identitySegment(identity.processId) !== segment) {
        fail("selection", "Retained Store identity does not match its target and digest custody segment");
      }
      const opened = disposition === "active"
        ? await openControlRecordStore({ root, identity, create: false, readOnly: true })
        : (await openArchivedControlRecordStore({ archiveRoot: root, identity })).store;
      opened.close();
      deliveries.push(Object.freeze({ identity, disposition }));
    }
  }
  deliveries.sort((left, right) => compareCodePoints(left.identity.processId, right.identity.processId));
  const inventoryDigest = sha256Bytes(canonicalJson({
    schema: "lifecycle.delivery-registry-inventory.v1",
    targetId,
    deliveries: deliveries.map(({ identity, disposition }) => ({ identity, disposition })),
  }));
  const remaining = deliveries.filter(({ identity }) =>
    afterDeliveryId === null || compareCodePoints(identity.processId, afterDeliveryId) > 0);
  const selected = remaining.slice(0, limit);
  return Object.freeze({
    deliveries: Object.freeze(selected),
    nextAfterDeliveryId: remaining.length > selected.length
      ? selected.at(-1)?.identity.processId ?? null
      : null,
    inventoryDigest,
  });
}
