import {
  chmod,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseCandidateRevisionCarrierManifest } from "../candidate/carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE,
  type FoundationCandidateRevisionCarrierManifestV1,
} from "../candidate/carrier-types.js";
import { FoundationError } from "../error.js";
import {
  assertDeliveryEventEnvelope,
  type DeliveryEventDescriptor,
} from "../process/delivery-event-registry.js";
import {
  createDeliveryReplay,
  type IncrementalDeliveryReplay,
  type ReducedDeliveryState,
} from "../process/delivery-reducer.js";
import { ensureDirectory } from "../support/filesystem.js";
import {
  canonicalJson,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import {
  assertDeliveryControlRecordPolicy,
  deliveryControlRecordPolicy,
} from "./kind-registry.js";
import {
  canonicalControlEventJsonObject,
  canonicalControlJsonObject,
  compileControlRecordEvent,
  compileControlRecordRevision,
  controlIdentifier,
  controlRecordKind,
  controlTimestamp,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { WorkDelegationReference } from "./work-delegation.js";
import {
  compileWorkDelegationStopRequest,
  parseWorkDelegationStopRequest,
  type WorkDelegationStopRequest,
} from "./work-delegation-stop.js";
import {
  CONTROL_RECORD_FILE_SCHEMA,
  CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
  CONTROL_RECORD_STORE_SCHEMA,
  CONTROL_RECORD_STORE_SEAL_SCHEMA,
  type ControlActor,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordFile,
  type ControlRecordFileInput,
  type ControlRecordOperationSupport,
  type ControlRecordOperationSupportCoordinate,
  type ControlRecordOperationSupportMutation,
  type ControlRecordOperationSupportMutationResult,
  type ControlRecordOperationSupportPut,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendResult,
  type ControlRecordStoreAppendWithFiles,
  type ControlRecordStoreAppendWithFilesResult,
  type ControlRecordStoreIdentity,
  type ControlRecordStoreIntegrity,
  type ControlRecordStoreOpenOptions,
  type ControlRecordStoreOperationBatch,
  type ControlRecordStoreOperationBatchResult,
  type ControlRecordStoreOperationBatchWithFiles,
  type ControlRecordStoreOperationBatchWithFilesResult,
  type ControlRecordStorePaths,
  type ControlRecordStoreSeal,
} from "./types.js";

const DATABASE_FILENAME = "control-record-store.sqlite";
const FILES_DIRECTORY = "files";
const DRAFTS_DIRECTORY = "drafts";
const ARCHIVE_MANIFEST_FILENAME = "archive-manifest.json";
export const CONTROL_RECORD_STORE_DATABASE_APPLICATION_ID = 0x4c435253;
export const CONTROL_RECORD_STORE_DATABASE_USER_VERSION = 3;
const FILE_PATTERN = /^sha256-([a-f0-9]{64})$/u;
const MAXIMUM_CONTROL_RECORDS = 10_000;
const MAXIMUM_CONTROL_REVISIONS = 25_000;
const MAXIMUM_JOURNAL_EVENTS = 100_000;
const MAXIMUM_APPEND_BATCH_ITEMS = 256;
const MAXIMUM_REFERENCED_FILES = 4_096;
const MAXIMUM_REFERENCED_FILE_BYTES = 256 * 1024 * 1024;
const MAXIMUM_REFERENCED_FILE_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_STORE_ROOT_BYTES = 16 * 1024 * 1024 * 1024;
const MAXIMUM_PENDING_FILE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAXIMUM_OPERATION_SUPPORT_ENTRIES = 256;
const PENDING_FILE_MANIFEST_SCHEMA = "lifecycle.control-record-store-pending-file-batch.v1";
const PENDING_FILE_PREFIX = ".pending-file-";
const SQLITE_TRANSIENT_FILENAMES = Object.freeze([
  `${DATABASE_FILENAME}-journal`,
  `${DATABASE_FILENAME}-wal`,
  `${DATABASE_FILENAME}-shm`,
]);

type SqlRow = Readonly<Record<string, string | number | bigint | Uint8Array | null>>;

type PreparedOperationSupportPut = Readonly<{
  action: "put";
  activityId: string;
  supportKind: string;
  payloadJson: string;
  payloadDigest: Sha256;
  expected: ControlRecordOperationSupportCoordinate | null;
  result: ControlRecordOperationSupport;
}>;

type PreparedOperationSupportDelete = Readonly<{
  action: "delete";
  activityId: string;
  expected: ControlRecordOperationSupportCoordinate;
}>;

type PreparedOperationSupportMutation =
  | PreparedOperationSupportPut
  | PreparedOperationSupportDelete;

type OperationSupportTombstone = Readonly<{
  state: "deleted";
  storeId: string;
  processId: string;
  activityId: string;
  supportKind: string;
  generation: number;
  deleted: ControlRecordOperationSupportCoordinate;
}>;

type RetainedOperationSupport =
  | Readonly<{ state: "live"; support: ControlRecordOperationSupport }>
  | OperationSupportTombstone;

type AppendTransactionResult = Readonly<{
  appends: readonly ControlRecordStoreAppendResult[];
  replay: IncrementalDeliveryReplay | null;
  disposition: "appended" | "retained";
}>;

function fail(code: string, message: string, observedFacts?: unknown): never {
  throw new FoundationError(`lifecycle.control-record-store.${code}`, message, {
    observedFacts,
  });
}

function parseJsonObject(
  value: string,
  label: string,
  profile: "revision" | "event" = "revision",
): ControlJsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("database-json", `${label} is not valid JSON`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    fail("database-json", `${label} is not one JSON object`);
  }
  const object = parsed as ControlJsonObject;
  const canonical = profile === "event"
    ? canonicalControlEventJsonObject(object, label)
    : canonicalControlJsonObject(object, label);
  if (canonical !== value) {
    fail("database-json", `${label} is not canonical JSON`);
  }
  return object;
}

function frozenJsonObject(canonical: string, label: string): ControlJsonObject {
  const value = parseJsonObject(canonical, label);
  const pending: object[] = [value];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const member of Array.isArray(current) ? current : Object.values(current)) {
      if (member !== null && typeof member === "object") pending.push(member);
    }
    Object.freeze(current);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") fail("database-shape", `${label} must be text`);
  return value;
}

function expectInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("database-shape", `${label} must be one safe integer`);
  }
  return value;
}

function expectDigest(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("database-shape", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function actorFromJson(value: string, label: string): ControlActor {
  const parsed = parseJsonObject(value, label);
  if (
    Object.keys(parsed).length !== 2 ||
    typeof parsed.kind !== "string" ||
    !["agent", "director", "runtime"].includes(parsed.kind) ||
    typeof parsed.id !== "string"
  ) {
    fail("database-shape", `${label} has an invalid actor shape`);
  }
  return Object.freeze({
    kind: parsed.kind as ControlActor["kind"],
    id: parsed.id,
  });
}

function paths(root: string): ControlRecordStorePaths {
  const resolved = resolve(root);
  return Object.freeze({
    root: resolved,
    database: join(resolved, DATABASE_FILENAME),
    files: join(resolved, FILES_DIRECTORY),
    drafts: join(resolved, DRAFTS_DIRECTORY),
  });
}

function schemaSql(): string {
  return `
    PRAGMA application_id = ${CONTROL_RECORD_STORE_DATABASE_APPLICATION_ID};
    PRAGMA user_version = ${CONTROL_RECORD_STORE_DATABASE_USER_VERSION};

    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_id TEXT NOT NULL,
      store_id TEXT NOT NULL UNIQUE,
      target_id TEXT NOT NULL,
      process_kind TEXT NOT NULL CHECK (process_kind = 'delivery'),
      process_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE control_records (
      record_id TEXT PRIMARY KEY,
      process_id TEXT NOT NULL,
      record_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (process_id, record_id),
      FOREIGN KEY (process_id) REFERENCES store_metadata(process_id)
    ) STRICT;

    CREATE TABLE record_revisions (
      record_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      producer_json TEXT NOT NULL,
      semantic_author_json TEXT NOT NULL,
      semantic_authority TEXT NOT NULL CHECK (
        semantic_authority IN (
          'agent-proposed',
          'director-supplied',
          'director-authenticated',
          'runtime-observed',
          'runtime-derived'
        )
      ),
      created_at TEXT NOT NULL,
      semantic_markdown TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      digest TEXT NOT NULL UNIQUE,
      PRIMARY KEY (record_id, revision),
      FOREIGN KEY (record_id) REFERENCES control_records(record_id)
    ) STRICT;

    CREATE TABLE record_relationships (
      source_record_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      relation TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_revision INTEGER NOT NULL,
      target_digest TEXT NOT NULL,
      PRIMARY KEY (
        source_record_id,
        source_revision,
        relation,
        target_kind,
        target_id,
        target_revision,
        target_digest
      ),
      FOREIGN KEY (source_record_id, source_revision)
        REFERENCES record_revisions(record_id, revision),
      FOREIGN KEY (target_id, target_revision)
        REFERENCES record_revisions(record_id, revision)
    ) STRICT;

    CREATE TABLE journal_events (
      sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
      event_id TEXT NOT NULL UNIQUE,
      event_kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      subject_record_id TEXT,
      subject_revision INTEGER,
      subject_digest TEXT,
      payload_json TEXT NOT NULL,
      predecessor_digest TEXT UNIQUE,
      digest TEXT NOT NULL UNIQUE,
      CHECK (
        (subject_record_id IS NULL AND subject_revision IS NULL AND subject_digest IS NULL) OR
        (subject_record_id IS NOT NULL AND subject_revision IS NOT NULL AND subject_digest IS NOT NULL)
      ),
      FOREIGN KEY (subject_record_id, subject_revision)
        REFERENCES record_revisions(record_id, revision)
    ) STRICT;

    CREATE TABLE referenced_files (
      digest TEXT PRIMARY KEY,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      media_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE
    ) STRICT;

    CREATE TABLE pending_file_batches (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      batch_digest TEXT NOT NULL UNIQUE,
      manifest_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE pending_file_entries (
      batch_digest TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      digest TEXT NOT NULL UNIQUE,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      media_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      temporary_filename TEXT NOT NULL UNIQUE,
      preexisting INTEGER NOT NULL CHECK (preexisting IN (0, 1)),
      PRIMARY KEY (batch_digest, ordinal),
      FOREIGN KEY (batch_digest) REFERENCES pending_file_batches(batch_digest)
    ) STRICT;

    CREATE TABLE operation_support (
      activity_id TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      support_kind TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('live', 'deleted')),
      generation INTEGER NOT NULL CHECK (generation > 0),
      payload_json TEXT,
      payload_digest TEXT,
      deleted_generation INTEGER,
      deleted_payload_digest TEXT,
      CHECK (
        (
          state = 'live' AND
          payload_json IS NOT NULL AND payload_digest IS NOT NULL AND
          deleted_generation IS NULL AND deleted_payload_digest IS NULL
        ) OR (
          state = 'deleted' AND
          payload_json IS NULL AND payload_digest IS NULL AND
          deleted_generation IS NOT NULL AND deleted_generation > 0 AND
          deleted_payload_digest IS NOT NULL AND
          generation = deleted_generation + 1
        )
      ),
      FOREIGN KEY (store_id) REFERENCES store_metadata(store_id),
      FOREIGN KEY (process_id) REFERENCES store_metadata(process_id)
    ) STRICT;

    CREATE TABLE store_seal (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      closure_record_id TEXT NOT NULL,
      closure_revision INTEGER NOT NULL,
      closure_digest TEXT NOT NULL,
      head_sequence INTEGER NOT NULL,
      head_digest TEXT NOT NULL,
      logical_inventory_digest TEXT NOT NULL,
      sealed_at TEXT NOT NULL,
      FOREIGN KEY (closure_record_id, closure_revision)
        REFERENCES record_revisions(record_id, revision),
      FOREIGN KEY (head_sequence) REFERENCES journal_events(sequence)
    ) STRICT;

    CREATE TABLE work_delegation_stop_request (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      delegation_id TEXT NOT NULL,
      delegation_revision INTEGER NOT NULL CHECK (delegation_revision > 0),
      delegation_digest TEXT NOT NULL,
      request_json TEXT NOT NULL CHECK (length(CAST(request_json AS BLOB)) <= 65536),
      request_digest TEXT NOT NULL UNIQUE,
      FOREIGN KEY (delegation_id, delegation_revision)
        REFERENCES record_revisions(record_id, revision)
    ) STRICT;

    CREATE VIEW current_record_revisions AS
      SELECT revisions.*
      FROM record_revisions AS revisions
      INNER JOIN (
        SELECT record_id, MAX(revision) AS revision
        FROM record_revisions
        GROUP BY record_id
      ) AS current
      ON current.record_id = revisions.record_id
      AND current.revision = revisions.revision;

    CREATE TRIGGER store_metadata_immutable_update
      BEFORE UPDATE ON store_metadata BEGIN
        SELECT RAISE(ABORT, 'store_metadata is immutable');
      END;
    CREATE TRIGGER store_metadata_immutable_delete
      BEFORE DELETE ON store_metadata BEGIN
        SELECT RAISE(ABORT, 'store_metadata is immutable');
      END;
    CREATE TRIGGER record_revisions_contiguous_insert
      BEFORE INSERT ON record_revisions BEGIN
        SELECT CASE WHEN NEW.revision != COALESCE((
          SELECT MAX(revision) + 1
          FROM record_revisions
          WHERE record_id = NEW.record_id
        ), 1) THEN RAISE(ABORT, 'record_revisions must be contiguous') END;
      END;
    CREATE TRIGGER journal_events_contiguous_insert
      BEFORE INSERT ON journal_events BEGIN
        SELECT CASE WHEN NEW.sequence != COALESCE((
          SELECT MAX(sequence) + 1 FROM journal_events
        ), 1) THEN RAISE(ABORT, 'journal_events must be contiguous') END;
        SELECT CASE WHEN NEW.predecessor_digest IS NOT (
          SELECT digest FROM journal_events ORDER BY sequence DESC LIMIT 1
        ) THEN RAISE(ABORT, 'journal_events must bind the exact predecessor') END;
        SELECT CASE WHEN NEW.occurred_at < COALESCE((
          SELECT occurred_at FROM journal_events ORDER BY sequence DESC LIMIT 1
        ), NEW.occurred_at) THEN RAISE(ABORT, 'journal_events time cannot move backwards') END;
        SELECT CASE WHEN NEW.subject_record_id IS NOT NULL AND NEW.subject_digest IS NOT (
          SELECT digest FROM record_revisions
          WHERE record_id = NEW.subject_record_id AND revision = NEW.subject_revision
        ) THEN RAISE(ABORT, 'journal_events must bind the exact subject revision') END;
      END;

    CREATE TRIGGER control_records_immutable_update
      BEFORE UPDATE ON control_records BEGIN
        SELECT RAISE(ABORT, 'control_records are immutable');
      END;
    CREATE TRIGGER control_records_immutable_delete
      BEFORE DELETE ON control_records BEGIN
        SELECT RAISE(ABORT, 'control_records are immutable');
      END;
    CREATE TRIGGER control_records_reject_after_seal
      BEFORE INSERT ON control_records
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER record_revisions_immutable_update
      BEFORE UPDATE ON record_revisions BEGIN
        SELECT RAISE(ABORT, 'record_revisions are immutable');
      END;
    CREATE TRIGGER record_revisions_immutable_delete
      BEFORE DELETE ON record_revisions BEGIN
        SELECT RAISE(ABORT, 'record_revisions are immutable');
      END;
    CREATE TRIGGER record_revisions_reject_after_seal
      BEFORE INSERT ON record_revisions
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER record_relationships_immutable_update
      BEFORE UPDATE ON record_relationships BEGIN
        SELECT RAISE(ABORT, 'record_relationships are immutable');
      END;
    CREATE TRIGGER record_relationships_immutable_delete
      BEFORE DELETE ON record_relationships BEGIN
        SELECT RAISE(ABORT, 'record_relationships are immutable');
      END;
    CREATE TRIGGER record_relationships_reject_after_seal
      BEFORE INSERT ON record_relationships
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER journal_events_immutable_update
      BEFORE UPDATE ON journal_events BEGIN
        SELECT RAISE(ABORT, 'journal_events are immutable');
      END;
    CREATE TRIGGER journal_events_immutable_delete
      BEFORE DELETE ON journal_events BEGIN
        SELECT RAISE(ABORT, 'journal_events are immutable');
      END;
    CREATE TRIGGER journal_events_reject_after_seal
      BEFORE INSERT ON journal_events
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER referenced_files_immutable_update
      BEFORE UPDATE ON referenced_files BEGIN
        SELECT RAISE(ABORT, 'referenced_files are immutable');
      END;
    CREATE TRIGGER referenced_files_immutable_delete
      BEFORE DELETE ON referenced_files
      WHEN NOT EXISTS (
        SELECT 1 FROM pending_file_entries
        WHERE digest = OLD.digest AND preexisting = 0
      ) BEGIN
        SELECT RAISE(ABORT, 'referenced_files are immutable');
      END;
    CREATE TRIGGER referenced_files_require_pending_insert
      BEFORE INSERT ON referenced_files
      WHEN NOT EXISTS (
        SELECT 1 FROM pending_file_entries
        WHERE digest = NEW.digest
          AND byte_length = NEW.byte_length
          AND media_type = NEW.media_type
          AND purpose = NEW.purpose
          AND created_at = NEW.created_at
          AND filename = NEW.filename
          AND preexisting = 0
      ) BEGIN
        SELECT RAISE(ABORT, 'referenced_files require exact pending custody');
      END;
    CREATE TRIGGER referenced_files_reject_after_seal
      BEFORE INSERT ON referenced_files
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER pending_file_batches_immutable_update
      BEFORE UPDATE ON pending_file_batches BEGIN
        SELECT RAISE(ABORT, 'pending_file_batches are immutable');
      END;
    CREATE TRIGGER pending_file_batches_reject_after_seal
      BEFORE INSERT ON pending_file_batches
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER pending_file_entries_immutable_update
      BEFORE UPDATE ON pending_file_entries BEGIN
        SELECT RAISE(ABORT, 'pending_file_entries are immutable');
      END;
    CREATE TRIGGER pending_file_entries_reject_after_seal
      BEFORE INSERT ON pending_file_entries
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER operation_support_exact_insert
      BEFORE INSERT ON operation_support BEGIN
        SELECT CASE WHEN NEW.state != 'live' OR NEW.generation != 1
          THEN RAISE(ABORT, 'operation_support must begin live at generation 1') END;
      END;
    CREATE TRIGGER operation_support_exact_update
      BEFORE UPDATE ON operation_support BEGIN
        SELECT CASE WHEN
          NEW.activity_id IS NOT OLD.activity_id OR
          NEW.schema_id IS NOT OLD.schema_id OR
          NEW.store_id IS NOT OLD.store_id OR
          NEW.process_id IS NOT OLD.process_id OR
          NEW.support_kind IS NOT OLD.support_kind OR
          OLD.state != 'live' OR
          NEW.generation != OLD.generation + 1
          THEN RAISE(ABORT, 'operation_support update must advance one exact bound generation') END;
      END;
    CREATE TRIGGER operation_support_reject_live_delete
      BEFORE DELETE ON operation_support
      WHEN OLD.state = 'live' BEGIN
        SELECT RAISE(ABORT, 'live operation_support must be CAS-disposed before deletion');
      END;
    CREATE TRIGGER operation_support_insert_reject_after_seal
      BEFORE INSERT ON operation_support
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER operation_support_update_reject_after_seal
      BEFORE UPDATE ON operation_support
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER operation_support_delete_reject_after_seal
      BEFORE DELETE ON operation_support
      WHEN EXISTS (SELECT 1 FROM store_seal WHERE singleton = 1) BEGIN
        SELECT RAISE(ABORT, 'sealed Control Record Store is immutable');
      END;
    CREATE TRIGGER work_delegation_stop_request_immutable_update
      BEFORE UPDATE ON work_delegation_stop_request BEGIN
        SELECT RAISE(ABORT, 'work delegation stop request is immutable');
      END;
    CREATE TRIGGER work_delegation_stop_request_exact_insert
      BEFORE INSERT ON work_delegation_stop_request BEGIN
        SELECT CASE WHEN EXISTS (SELECT 1 FROM store_seal)
          THEN RAISE(ABORT, 'sealed Control Record Store is immutable') END;
        SELECT CASE WHEN NEW.delegation_digest IS NOT (
          SELECT revisions.digest FROM record_revisions AS revisions
          JOIN control_records AS records ON records.record_id = revisions.record_id
          WHERE records.record_kind = 'work-delegation' AND revisions.record_id = NEW.delegation_id
            AND revisions.revision = NEW.delegation_revision
        ) THEN RAISE(ABORT, 'stop request requires an exact work delegation') END;
      END;
    CREATE TRIGGER work_delegation_stop_request_exact_delete
      BEFORE DELETE ON work_delegation_stop_request BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM journal_events WHERE event_kind = 'work-delegation-stopped'
            AND subject_record_id = OLD.delegation_id AND subject_revision = OLD.delegation_revision
            AND subject_digest = OLD.delegation_digest
            AND json_extract(payload_json, '$.requestDigest') = OLD.request_digest
        ) THEN RAISE(ABORT, 'stop request may be removed only with its exact Journal fact') END;
      END;
    CREATE TRIGGER store_seal_exact_insert
      BEFORE INSERT ON store_seal BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM pending_file_batches
        ) THEN RAISE(ABORT, 'store_seal requires empty pending file custody') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM operation_support WHERE state = 'live'
        ) THEN RAISE(ABORT, 'store_seal requires no live operation support') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM work_delegation_stop_request
        ) THEN RAISE(ABORT, 'store_seal requires no pending work delegation stop') END;
        SELECT CASE WHEN NEW.closure_digest IS NOT (
          SELECT digest FROM record_revisions
          WHERE record_id = NEW.closure_record_id AND revision = NEW.closure_revision
        ) THEN RAISE(ABORT, 'store_seal must bind the exact Closure revision') END;
        SELECT CASE WHEN NEW.head_digest IS NOT (
          SELECT digest FROM journal_events WHERE sequence = NEW.head_sequence
        ) THEN RAISE(ABORT, 'store_seal must bind the exact Journal head') END;
      END;
    CREATE TRIGGER store_seal_immutable_update
      BEFORE UPDATE ON store_seal BEGIN
        SELECT RAISE(ABORT, 'store_seal is immutable');
      END;
    CREATE TRIGGER store_seal_immutable_delete
      BEFORE DELETE ON store_seal BEGIN
        SELECT RAISE(ABORT, 'store_seal is immutable');
      END;
  `;
}

function retainedSchemaSubject(db: DatabaseSync): readonly ControlJsonObject[] {
  const rows = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as SqlRow[];
  return Object.freeze(rows.map((row) => Object.freeze({
    type: expectString(row.type, "Database schema object type"),
    name: expectString(row.name, "Database schema object name"),
    table: expectString(row.tbl_name, "Database schema object table"),
    sql: expectString(row.sql, "Database schema object SQL"),
  })));
}

let expectedSchemaSubject: readonly ControlJsonObject[] | null = null;

function assertExactDatabaseSchema(db: DatabaseSync): void {
  if (expectedSchemaSubject === null) {
    const reference = new DatabaseSync(":memory:", {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      defensive: true,
    });
    try {
      reference.exec(schemaSql());
      expectedSchemaSubject = retainedSchemaSubject(reference);
    } finally {
      reference.close();
    }
  }
  if (canonicalJson(retainedSchemaSubject(db)) !== canonicalJson(expectedSchemaSubject)) {
    fail("database-schema", "Control Record Store database schema or invariant set is not exact");
  }
}

async function exactDirectory(path: string, label: string, create: boolean): Promise<void> {
  if (create) await ensureDirectory(path, 0o700);
  let state;
  try {
    state = await lstat(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("physical-layout", `${label} does not exist`);
    }
    throw error;
  }
  if (!state.isDirectory() || state.isSymbolicLink()) {
    fail("physical-layout", `${label} must be one physical directory`);
  }
  if (Number(state.mode & 0o7777n) !== 0o700) {
    fail("physical-layout", `${label} must use mode 0700`);
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) {
    fail("physical-layout", `${label} must be owned by the effective user`);
  }
}

async function assertStoreRootEntries(
  root: string,
  requireDatabase: boolean,
  allowSqliteTransients: boolean,
  archiveLayout: boolean,
): Promise<void> {
  const actual = (await readdir(root)).sort();
  const required = [FILES_DIRECTORY, DRAFTS_DIRECTORY];
  if (requireDatabase) required.push(DATABASE_FILENAME);
  if (archiveLayout) required.push(ARCHIVE_MANIFEST_FILENAME);
  const allowed = new Set([
    ...required,
    ...(allowSqliteTransients ? SQLITE_TRANSIENT_FILENAMES : []),
  ]);
  if (
    required.some((entry) => !actual.includes(entry)) ||
    actual.some((entry) => !allowed.has(entry))
  ) {
    fail("physical-layout", "Control Record Store root contains unsupported or missing entries", {
      actual,
      required: [...required].sort(),
      allowed: [...allowed].sort(),
    });
  }
}

async function exactDatabaseFile(path: string): Promise<void> {
  const state = await lstat(path, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
    fail("physical-layout", "Control Record Store database must be one canonical regular file");
  }
  if (Number(state.mode & 0o7777n) !== 0o600) {
    fail("physical-layout", "Control Record Store database must use mode 0600");
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) {
    fail("physical-layout", "Control Record Store database must be owned by the effective user");
  }
}

function validatedIdentity(identity: ControlRecordStoreIdentity): ControlRecordStoreIdentity {
  if (identity.schema !== CONTROL_RECORD_STORE_SCHEMA || identity.processKind !== "delivery") {
    fail("metadata", "Control Record Store identity selects an unsupported schema or Process kind");
  }
  return Object.freeze({
    schema: identity.schema,
    storeId: controlIdentifier(identity.storeId, "Control Record Store identity"),
    targetId: controlIdentifier(identity.targetId, "Target identity"),
    processKind: identity.processKind,
    processId: controlIdentifier(identity.processId, "Process identity"),
    createdAt: controlTimestamp(identity.createdAt, "Control Record Store creation time"),
  });
}

function metadata(db: DatabaseSync): ControlRecordStoreIdentity {
  const row = db.prepare(`
    SELECT schema_id, store_id, target_id, process_kind, process_id, created_at
    FROM store_metadata WHERE singleton = 1
  `).get() as SqlRow | undefined;
  if (row === undefined) fail("metadata", "Control Record Store metadata is missing");
  return validatedIdentity(Object.freeze({
    schema: expectString(row.schema_id, "Store schema") as typeof CONTROL_RECORD_STORE_SCHEMA,
    storeId: expectString(row.store_id, "Store identity"),
    targetId: expectString(row.target_id, "Store target identity"),
    processKind: expectString(row.process_kind, "Store Process kind") as "delivery",
    processId: expectString(row.process_id, "Store Process identity"),
    createdAt: expectString(row.created_at, "Store creation time"),
  }));
}

function sameIdentity(left: ControlRecordStoreIdentity, right: ControlRecordStoreIdentity): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function operationSupportCoordinate(
  value: ControlRecordOperationSupportCoordinate,
  label: string,
): ControlRecordOperationSupportCoordinate {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("operation-support-cas", `${label} must be one exact operation-support coordinate`);
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    fail("operation-support-cas", `${label} generation must be one positive safe integer`);
  }
  return Object.freeze({
    generation: value.generation,
    payloadDigest: expectDigest(value.payloadDigest, `${label} payload digest`),
  });
}

function operationSupportFromRow(
  identity: ControlRecordStoreIdentity,
  row: SqlRow,
): RetainedOperationSupport {
  const schema = expectString(row.schema_id, "Operation support schema");
  const storeId = expectString(row.store_id, "Operation support store identity");
  const processId = expectString(row.process_id, "Operation support Process identity");
  if (
    schema !== CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA ||
    storeId !== identity.storeId ||
    processId !== identity.processId
  ) {
    fail(
      "operation-support-integrity",
      "Operation support does not bind the exact selected store and Process",
    );
  }
  const activityId = controlIdentifier(
    expectString(row.activity_id, "Operation support activity identity"),
    "Operation support activity identity",
  );
  const supportKind = controlRecordKind(
    expectString(row.support_kind, "Operation support kind"),
    "Operation support kind",
  );
  const generation = expectInteger(row.generation, "Operation support generation");
  if (generation < 1) {
    fail("operation-support-integrity", "Operation support generation must be positive");
  }
  const state = expectString(row.state, "Operation support state");
  if (state === "deleted") {
    if (row.payload_json !== null || row.payload_digest !== null) {
      fail("operation-support-integrity", "Deleted operation support cannot retain payload bytes");
    }
    const deletedGeneration = expectInteger(
      row.deleted_generation,
      "Deleted operation support prior generation",
    );
    const deletedPayloadDigest = expectDigest(
      row.deleted_payload_digest,
      "Deleted operation support prior payload digest",
    );
    if (deletedGeneration < 1 || generation !== deletedGeneration + 1) {
      fail(
        "operation-support-integrity",
        "Deleted operation support does not advance its exact prior generation",
      );
    }
    return Object.freeze({
      state: "deleted",
      storeId,
      processId,
      activityId,
      supportKind,
      generation,
      deleted: Object.freeze({
        generation: deletedGeneration,
        payloadDigest: deletedPayloadDigest,
      }),
    });
  }
  if (
    state !== "live" ||
    row.deleted_generation !== null ||
    row.deleted_payload_digest !== null
  ) {
    fail("operation-support-integrity", "Operation support has an invalid live/deleted shape");
  }
  const payloadJson = expectString(row.payload_json, "Operation support payload");
  const payload = frozenJsonObject(payloadJson, "Operation support payload");
  const payloadDigest = expectDigest(row.payload_digest, "Operation support payload digest");
  if (sha256Bytes(payloadJson) !== payloadDigest) {
    fail(
      "operation-support-integrity",
      "Operation support payload digest does not reproduce its exact canonical bytes",
    );
  }
  return Object.freeze({
    state: "live",
    support: Object.freeze({
      schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
      storeId,
      processId,
      activityId,
      supportKind,
      generation,
      payload,
      payloadDigest,
    }),
  });
}

function prepareOperationSupportPut(
  identity: ControlRecordStoreIdentity,
  input: ControlRecordOperationSupportPut,
): PreparedOperationSupportPut {
  const activityId = controlIdentifier(input.activityId, "Operation support activity identity");
  const supportKind = controlRecordKind(input.supportKind, "Operation support kind");
  const payloadJson = canonicalControlJsonObject(input.payload, "Operation support payload");
  const payloadDigest = sha256Bytes(payloadJson);
  const expected = input.expected === null
    ? null
    : operationSupportCoordinate(input.expected, "Expected operation support");
  if (expected !== null && expected.generation >= Number.MAX_SAFE_INTEGER) {
    fail("operation-support-limit", "Operation support generation cannot advance safely");
  }
  const generation = expected === null ? 1 : expected.generation + 1;
  return Object.freeze({
    action: "put",
    activityId,
    supportKind,
    payloadJson,
    payloadDigest,
    expected,
    result: Object.freeze({
      schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
      storeId: identity.storeId,
      processId: identity.processId,
      activityId,
      supportKind,
      generation,
      payload: frozenJsonObject(payloadJson, "Operation support payload"),
      payloadDigest,
    }),
  });
}

function prepareOperationSupportDelete(
  activityId: string,
  expected: ControlRecordOperationSupportCoordinate,
): PreparedOperationSupportDelete {
  return Object.freeze({
    action: "delete",
    activityId: controlIdentifier(activityId, "Operation support activity identity"),
    expected: operationSupportCoordinate(expected, "Expected operation support"),
  });
}

function prepareOperationSupportMutation(
  identity: ControlRecordStoreIdentity,
  mutation: ControlRecordOperationSupportMutation,
): PreparedOperationSupportMutation {
  if (mutation.action === "put") {
    return prepareOperationSupportPut(identity, mutation.value);
  }
  if (mutation.action === "delete") {
    return prepareOperationSupportDelete(mutation.activityId, mutation.expected);
  }
  fail("operation-support-mutation", "Operation-support mutation has an unsupported action");
}

function sameOperationSupport(
  left: ControlRecordOperationSupport,
  right: ControlRecordOperationSupport,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function relationshipsFor(
  db: DatabaseSync,
  recordId: string,
  revision: number,
): readonly ControlRecordRelationship[] {
  const rows = db.prepare(`
    SELECT relation, target_kind, target_id, target_revision, target_digest
    FROM record_relationships
    WHERE source_record_id = ? AND source_revision = ?
    ORDER BY relation, target_kind, target_id, target_revision, target_digest
  `).all(recordId, revision) as SqlRow[];
  return Object.freeze(rows.map((row) => Object.freeze({
    relation: expectString(row.relation, "Relationship type"),
      target: Object.freeze({
        kind: expectString(row.target_kind, "Relationship target kind"),
        id: expectString(row.target_id, "Relationship target identity"),
        revision: expectInteger(row.target_revision, "Relationship target revision"),
        digest: expectDigest(row.target_digest, "Relationship target digest"),
      }),
  })));
}

function revisionFromRow(db: DatabaseSync, row: SqlRow): ControlRecordRevision {
  const recordId = expectString(row.record_id, "Control record identity");
  const revision = expectInteger(row.revision, "Control record revision");
  const parsed = compileControlRecordRevision(
    expectString(row.process_id, "Control record Process identity"),
    {
      recordId,
      recordKind: expectString(row.record_kind, "Control record kind"),
      revision,
      producer: actorFromJson(expectString(row.producer_json, "Control record producer"), "Control record producer"),
      semanticAuthor: actorFromJson(expectString(row.semantic_author_json, "Control record semantic author"), "Control record semantic author"),
      semanticAuthority: expectString(row.semantic_authority, "Control record semantic authority") as ControlRecordRevision["semanticAuthority"],
      createdAt: expectString(row.revision_created_at, "Control record revision creation time"),
      semanticMarkdown: expectString(row.semantic_markdown, "Control record semantic Markdown"),
      payload: parseJsonObject(expectString(row.payload_json, "Control record payload"), "Control record payload"),
      relationships: relationshipsFor(db, recordId, revision),
    },
  );
  if (parsed.digest !== expectDigest(row.digest, "Control record revision digest")) {
    fail("revision-integrity", `Control record ${recordId} revision ${revision} digest does not match its logical value`);
  }
  return parsed;
}

function exactRetainedRevisionFacts(
  db: DatabaseSync,
  recordId: string,
  revision: number,
  failureCode: "event-subject" | "relationship-reference",
  label: string,
): Readonly<{ recordKind: string; digest: Sha256 }> {
  const row = db.prepare(`
    SELECT records.record_kind, revisions.digest
    FROM record_revisions AS revisions
    INNER JOIN control_records AS records ON records.record_id = revisions.record_id
    WHERE revisions.record_id = ? AND revisions.revision = ?
  `).get(recordId, revision) as SqlRow | undefined;
  if (row === undefined) {
    fail(failureCode, `${label} does not resolve inside this Control Record Store`);
  }
  return Object.freeze({
    recordKind: expectString(row.record_kind, `${label} kind`),
    digest: expectDigest(row.digest, `${label} digest`),
  });
}

type RetainedAdjacentFileReference = Readonly<{
  digest: Sha256;
  byteLength: number;
  mediaType: string;
  purpose: string;
}>;

type CandidateCarrierManifestOwner = Readonly<{
  revision: ControlRecordRevision;
  reference: RetainedAdjacentFileReference;
}>;

function assertAdjacentFileReferenceOwnership(
  revision: ControlRecordRevision,
  reference: RetainedAdjacentFileReference,
): void {
  const claimsCarrierManifestPurpose =
    reference.purpose === FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
  const claimsCarrierManifestMediaType =
    reference.mediaType === FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
  if (revision.recordKind === "candidate-revision") {
    if (!claimsCarrierManifestPurpose || !claimsCarrierManifestMediaType) {
      fail(
        "candidate-carrier-reference",
        "candidate-revision must select the reserved Candidate Revision Carrier manifest purpose and media type",
      );
    }
    return;
  }
  if (claimsCarrierManifestPurpose || claimsCarrierManifestMediaType || reference.purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE) {
    const materials = revision.payload.rawMaterials;
    const purposes = Array.isArray(materials) ? materials.flatMap((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value) || value.availability !== "retained") return [];
      const selected = value.reference;
      return selected !== null && typeof selected === "object" && !Array.isArray(selected) ? [selected.purpose] : [];
    }) : [];
    const candidate = revision.payload.candidate;
    if (revision.recordKind === "execution-receipt" && revision.payload.role === "builder" &&
        candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) &&
        (candidate as ControlJsonObject).successorDisposition === "invalid" && (candidate as ControlJsonObject).successor === null &&
        purposes.filter((purpose) => purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE).length === 1 &&
        purposes.filter((purpose) => purpose === FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE).length === 1 &&
        (reference.purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE
          ? reference.mediaType === "application/json" && reference.byteLength <= 64 * 1024
          : claimsCarrierManifestPurpose && claimsCarrierManifestMediaType)) return;
    fail(
      "candidate-carrier-reference",
      `${revision.recordKind} cannot claim a Carrier manifest outside one exact Candidate or failed-builder repair pair`,
    );
  }
}

function candidateCarrierManifestOwner(
  revision: ControlRecordRevision,
  references: readonly RetainedAdjacentFileReference[],
): CandidateCarrierManifestOwner | null {
  if (revision.recordKind !== "candidate-revision") return null;
  if (references.length !== 1) {
    fail(
      "candidate-carrier-reference",
      "candidate-revision must select exactly one Candidate Revision Carrier manifest",
    );
  }
  return Object.freeze({ revision, reference: references[0]! });
}

function parsedCandidateCarrierManifest(
  owner: CandidateCarrierManifestOwner,
  bytes: Uint8Array,
): FoundationCandidateRevisionCarrierManifestV1 {
  try {
    return parseCandidateRevisionCarrierManifest(
      bytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    );
  } catch {
    fail(
      "candidate-carrier-manifest",
      `${owner.revision.recordKind} ${owner.revision.recordId} revision ${owner.revision.revision} does not retain one exact canonical Candidate Revision Carrier manifest`,
    );
  }
}

function assertCandidateCarrierManifestSubject(
  owner: CandidateCarrierManifestOwner,
  manifest: FoundationCandidateRevisionCarrierManifestV1,
): void {
  const state = owner.revision.payload.state;
  if (state === null || Array.isArray(state) || typeof state !== "object") {
    fail(
      "candidate-carrier-subject",
      "candidate-revision has no exact Candidate state for its Carrier manifest",
    );
  }
  const tree = expectString(
    (state as ControlJsonObject).tree,
    "candidate-revision Candidate tree",
  );
  if (manifest.rootTree !== tree) {
    fail(
      "candidate-carrier-subject",
      `${owner.revision.recordKind} ${owner.revision.recordId} revision ${owner.revision.revision} Carrier manifest does not bind its exact Candidate tree`,
    );
  }
}

function assertNoUnboundCandidateRevision(
  appends: readonly ControlRecordStoreAppend[],
): void {
  if (
    Array.isArray(appends) &&
    appends.some(({ revision }) => revision?.recordKind === "candidate-revision")
  ) {
    fail(
      "candidate-carrier-file-required",
      "candidate-revision may be retained only through a file-bound append that supplies its exact Carrier manifest bytes",
    );
  }
}

function retainedAdjacentFileReferencesFromValidatedPayload(
  revision: ControlRecordRevision,
): readonly RetainedAdjacentFileReference[] {
  if (revision.recordKind === "candidate-revision") {
    const reference = revision.payload.carrierManifest;
    if (reference === null || Array.isArray(reference) || typeof reference !== "object") {
      fail("file-reference", "candidate-revision has no exact Carrier manifest reference");
    }
    const exact = reference as ControlJsonObject;
    const selected = Object.freeze({
      digest: expectDigest(exact.digest, "candidate-revision Carrier manifest digest"),
      byteLength: expectInteger(
        exact.byteLength,
        "candidate-revision Carrier manifest byte length",
      ),
      mediaType: expectString(
        exact.mediaType,
        "candidate-revision Carrier manifest media type",
      ),
      purpose: expectString(
        exact.purpose,
        "candidate-revision Carrier manifest purpose",
      ),
    });
    assertAdjacentFileReferenceOwnership(revision, selected);
    return Object.freeze([selected]);
  }
  if (
    revision.recordKind !== "execution-receipt" &&
    revision.recordKind !== "check-receipt"
  ) {
    return Object.freeze([]);
  }
  const rawMaterials = revision.payload.rawMaterials;
  if (!Array.isArray(rawMaterials)) {
    fail("file-reference", `${revision.recordKind} rawMaterials must be one validated array`);
  }
  const references: RetainedAdjacentFileReference[] = [];
  for (const material of rawMaterials) {
    if (material === null || Array.isArray(material) || typeof material !== "object") {
      fail("file-reference", `${revision.recordKind} rawMaterials contains an invalid entry`);
    }
    const availability = material.availability;
    if (availability === "not-retained" || availability === "unavailable") continue;
    if (availability !== "retained") {
      fail("file-reference", `${revision.recordKind} rawMaterials contains an invalid availability`);
    }
    const reference = material.reference;
    if (reference === null || Array.isArray(reference) || typeof reference !== "object") {
      fail("file-reference", `${revision.recordKind} retained raw material has no exact reference`);
    }
    const selected = Object.freeze({
      digest: expectDigest(reference.digest, `${revision.recordKind} retained file digest`),
      byteLength: expectInteger(reference.byteLength, `${revision.recordKind} retained file byte length`),
      mediaType: expectString(reference.mediaType, `${revision.recordKind} retained file media type`),
      purpose: expectString(reference.purpose, `${revision.recordKind} retained file purpose`),
    });
    assertAdjacentFileReferenceOwnership(revision, selected);
    references.push(selected);
  }
  return Object.freeze(references);
}

function assertRetainedFileReferenceDescriptor(
  db: DatabaseSync,
  revision: ControlRecordRevision,
  reference: RetainedAdjacentFileReference,
): void {
  const descriptor = db.prepare(`
    SELECT byte_length, media_type, purpose, filename
    FROM referenced_files WHERE digest = ?
  `).get(reference.digest) as SqlRow | undefined;
  if (descriptor === undefined) {
    fail(
      "file-reference",
      `${revision.recordKind} ${revision.recordId} revision ${revision.revision} references an unavailable retained file`,
      { digest: reference.digest },
    );
  }
  if (
    expectInteger(descriptor.byte_length, "Referenced file byte length") !== reference.byteLength ||
    expectString(descriptor.media_type, "Referenced file media type") !== reference.mediaType ||
    expectString(descriptor.purpose, "Referenced file purpose") !== reference.purpose ||
    expectString(descriptor.filename, "Referenced file name") !==
      `sha256-${reference.digest.slice("sha256:".length)}`
  ) {
    fail(
      "file-reference",
      `${revision.recordKind} ${revision.recordId} revision ${revision.revision} does not reproduce the retained file metadata`,
      { digest: reference.digest },
    );
  }
}

function assertRevisionPolicyAndTargets(
  db: DatabaseSync,
  revision: ControlRecordRevision,
): readonly RetainedAdjacentFileReference[] {
  assertDeliveryControlRecordPolicy(revision);
  assertDeliveryControlRecordPayload(revision);
  const retainedFileReferences = retainedAdjacentFileReferencesFromValidatedPayload(revision);
  for (const reference of retainedFileReferences) {
    assertRetainedFileReferenceDescriptor(db, revision, reference);
  }
  for (const relationship of revision.relationships) {
    if (relationship.target.revision === null) {
      fail(
        "relationship-reference",
        `${revision.recordKind} relationship ${relationship.relation} must bind one exact target revision`,
      );
    }
    const target = exactRetainedRevisionFacts(
      db,
      relationship.target.id,
      relationship.target.revision,
      "relationship-reference",
      `${revision.recordKind} relationship ${relationship.relation}`,
    );
    if (
      target.recordKind !== relationship.target.kind ||
      target.digest !== relationship.target.digest
    ) {
      fail(
        "relationship-reference",
        `${revision.recordKind} relationship ${relationship.relation} does not bind the exact retained target kind and digest`,
      );
    }
  }
  return retainedFileReferences;
}

function assertRetainedEventDescriptor(
  db: DatabaseSync,
  event: ControlRecordEvent,
): DeliveryEventDescriptor {
  const descriptor = assertDeliveryEventEnvelope(event);
  if (event.subject === null) return descriptor;
  const subject = exactRetainedRevisionFacts(
    db,
    event.subject.recordId,
    event.subject.revision,
    "event-subject",
    `${event.eventKind} event subject`,
  );
  if (subject.digest !== event.subject.digest) {
    fail("event-subject", `${event.eventKind} does not bind the exact retained subject digest`);
  }
  if (descriptor.subjectKind !== subject.recordKind) {
    fail(
      "event-subject-kind",
      `${event.eventKind} requires a ${descriptor.subjectKind ?? "subjectless"} subject, not ${subject.recordKind}`,
    );
  }
  return descriptor;
}

function finalizationEventCount(db: DatabaseSync, revision: ControlRecordRevision): number {
  const policy = deliveryControlRecordPolicy(revision.recordKind);
  return expectInteger(
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM journal_events
      WHERE event_kind = ?
        AND subject_record_id = ?
        AND subject_revision = ?
        AND subject_digest = ?
    `).get(
      policy.finalizationEvent,
      revision.recordId,
      revision.revision,
      revision.digest,
    ) as SqlRow).count,
    `${revision.recordKind} finalization event count`,
  );
}

function assertExactRevisionFinalization(
  revision: ControlRecordRevision,
  event: ControlRecordEvent,
): void {
  const policy = deliveryControlRecordPolicy(revision.recordKind);
  if (event.eventKind !== policy.finalizationEvent) {
    fail(
      "revision-finalization",
      `${revision.recordKind} must finalize with ${policy.finalizationEvent}`,
    );
  }
  if (
    event.subject === null ||
    event.subject.recordId !== revision.recordId ||
    event.subject.revision !== revision.revision ||
    event.subject.digest !== revision.digest
  ) {
    fail("event-subject", "An atomically appended revision must be the exact event subject");
  }
}

function eventFromRow(identity: ControlRecordStoreIdentity, row: SqlRow): ControlRecordEvent {
  const subjectRecordId = row.subject_record_id;
  const subject = subjectRecordId === null
    ? null
    : Object.freeze({
      recordId: expectString(subjectRecordId, "Event subject record identity"),
      revision: expectInteger(row.subject_revision, "Event subject revision"),
      digest: expectDigest(row.subject_digest, "Event subject digest"),
    });
  const event = compileControlRecordEvent({
    storeId: identity.storeId,
    processId: identity.processId,
    sequence: expectInteger(row.sequence, "Event sequence"),
    predecessorDigest: row.predecessor_digest === null
      ? null
      : expectDigest(row.predecessor_digest, "Event predecessor digest"),
    event: {
      eventId: expectString(row.event_id, "Event identity"),
      eventKind: expectString(row.event_kind, "Event kind"),
      occurredAt: expectString(row.occurred_at, "Event time"),
      actor: actorFromJson(expectString(row.actor_json, "Event actor"), "Event actor"),
      subject,
      payload: parseJsonObject(expectString(row.payload_json, "Event payload"), "Event payload", "event"),
    },
  });
  if (event.digest !== expectDigest(row.digest, "Event digest")) {
    fail("event-integrity", `Event ${event.eventId} digest does not match its logical value`);
  }
  return event;
}

async function durableRename(temporary: string, destination: string): Promise<void> {
  await rename(temporary, destination);
  const directory = await open(resolve(destination, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function verifyFileCarrier(path: string, expected: Readonly<{
  digest: Sha256;
  byteLength: number;
}>): Promise<Uint8Array> {
  const state = await lstat(path, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
    fail("file-integrity", `${basename(path)} must be one canonical regular file`);
  }
  if (Number(state.mode & 0o7777n) !== 0o600) {
    fail("file-integrity", `${basename(path)} must use mode 0600`);
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) {
    fail("file-integrity", `${basename(path)} must be owned by the effective user`);
  }
  if (state.size !== BigInt(expected.byteLength)) {
    fail("file-integrity", `${basename(path)} byte length does not match its database fact`);
  }
  const bytes = await readFile(path);
  if (sha256Bytes(bytes) !== expected.digest) {
    fail("file-integrity", `${basename(path)} bytes do not match their content address`);
  }
  return bytes;
}

type PendingFileManifestAppend = Readonly<{
  revision: Readonly<{
    recordId: string;
    revision: number;
    digest: Sha256;
  }> | null;
  event: ControlRecordEventInput;
}>;

type PendingFileManifest = Readonly<{
  schema: typeof PENDING_FILE_MANIFEST_SCHEMA;
  storeId: string;
  processId: string;
  files: readonly ControlRecordFile[];
  appends: readonly PendingFileManifestAppend[];
  supportMutations: readonly ControlRecordOperationSupportMutation[];
}>;

type PreparedPendingFile = Readonly<{
  bytes: Uint8Array;
  descriptor: ControlRecordFile;
  filename: string;
}>;

type PendingFileEntry = Readonly<{
  descriptor: ControlRecordFile;
  filename: string;
  temporaryFilename: string;
  preexisting: boolean;
}>;

type PendingFileBatch = Readonly<{
  digest: Sha256;
  manifestJson: string;
  manifest: PendingFileManifest;
  entries: readonly PendingFileEntry[];
}>;

type PreparedPendingFileBatch = Readonly<{
  digest: Sha256;
  manifestJson: string;
  manifest: PendingFileManifest;
  files: readonly PreparedPendingFile[];
  appends: readonly ControlRecordStoreAppend[];
  supportMutations: readonly PreparedOperationSupportMutation[];
}>;

function exactObjectKeys(
  value: ControlJsonObject,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const selected = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(selected)) {
    fail("pending-file-integrity", `${label} has unsupported or missing fields`);
  }
}

function pendingObject(value: unknown, label: string): ControlJsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("pending-file-integrity", `${label} must be one JSON object`);
  }
  return value as ControlJsonObject;
}

function pendingArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("pending-file-integrity", `${label} must be one JSON array`);
  }
  return value;
}

function sameFileDescriptor(left: ControlRecordFile, right: ControlRecordFile): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function compileControlRecordFile(input: ControlRecordFileInput): ControlRecordFile {
  if (!(input.bytes instanceof Uint8Array)) {
    fail("file", "Referenced file content must be bytes");
  }
  if (input.bytes.byteLength > MAXIMUM_REFERENCED_FILE_BYTES) {
    fail("file", "Referenced file exceeds the Control Record Store limit");
  }
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(input.mediaType)) {
    fail("file", "Referenced file media type is invalid");
  }
  return Object.freeze({
    schema: CONTROL_RECORD_FILE_SCHEMA,
    digest: sha256Bytes(input.bytes),
    byteLength: input.bytes.byteLength,
    mediaType: input.mediaType,
    purpose: controlIdentifier(input.purpose, "Referenced file purpose"),
    createdAt: controlTimestamp(input.createdAt, "Referenced file creation time"),
  });
}

function pendingTemporaryFilename(batchDigest: Sha256, fileDigest: Sha256): string {
  return `${PENDING_FILE_PREFIX}${batchDigest.slice("sha256:".length)}-${fileDigest.slice("sha256:".length)}.tmp`;
}

function pendingEventInput(
  identity: ControlRecordStoreIdentity,
  input: ControlRecordEventInput,
): ControlRecordEventInput {
  const compiled = compileControlRecordEvent({
    storeId: identity.storeId,
    processId: identity.processId,
    sequence: 1,
    predecessorDigest: null,
    event: input,
  });
  assertDeliveryEventEnvelope(compiled);
  return Object.freeze({
    eventId: compiled.eventId,
    eventKind: compiled.eventKind,
    occurredAt: compiled.occurredAt,
    actor: compiled.actor,
    subject: compiled.subject,
    payload: compiled.payload,
  });
}

function preparePendingFileBatch(
  identity: ControlRecordStoreIdentity,
  input: ControlRecordStoreAppendWithFiles | ControlRecordStoreOperationBatchWithFiles,
): PreparedPendingFileBatch {
  if (
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > MAXIMUM_REFERENCED_FILES
  ) {
    fail(
      "file-batch-bound",
      `File custody requires between 1 and ${MAXIMUM_REFERENCED_FILES} files`,
    );
  }

  const requestedSupportMutations = "supportMutations" in input
    ? input.supportMutations
    : Object.freeze([]);
  if (
    !Array.isArray(requestedSupportMutations) ||
    requestedSupportMutations.length > MAXIMUM_OPERATION_SUPPORT_ENTRIES
  ) {
    fail(
      "operation-batch-bound",
      `File custody may bind at most ${MAXIMUM_OPERATION_SUPPORT_ENTRIES} support mutations`,
    );
  }
  const supportMutations = Object.freeze(requestedSupportMutations.map((mutation) =>
    prepareOperationSupportMutation(identity, mutation)));
  const supportActivityIds = new Set<string>();
  for (const mutation of supportMutations) {
    if (supportActivityIds.has(mutation.activityId)) {
      fail(
        "operation-batch-conflict",
        "A file-custody operation batch may mutate each activity support coordinate at most once",
      );
    }
    supportActivityIds.add(mutation.activityId);
  }
  if (
    !Array.isArray(input.appends) ||
    input.appends.length < 1 ||
    input.appends.length > MAXIMUM_APPEND_BATCH_ITEMS
  ) {
    fail(
      "file-batch-bound",
      `File custody requires between 1 and ${MAXIMUM_APPEND_BATCH_ITEMS} ordered appends`,
    );
  }

  const byDigest = new Map<Sha256, PreparedPendingFile>();
  for (const file of input.files) {
    if (!(file.bytes instanceof Uint8Array)) {
      fail("file", "Referenced file content must be bytes");
    }
    const bytes = Uint8Array.from(file.bytes);
    const descriptor = compileControlRecordFile(Object.freeze({ ...file, bytes }));
    const existing = byDigest.get(descriptor.digest);
    if (existing !== undefined) {
      if (!sameFileDescriptor(existing.descriptor, descriptor)) {
        fail("file-conflict", "One referenced file digest cannot name different metadata");
      }
      continue;
    }
    byDigest.set(descriptor.digest, Object.freeze({
      bytes,
      descriptor,
      filename: `sha256-${descriptor.digest.slice("sha256:".length)}`,
    }));
  }
  const files = Object.freeze([...byDigest.values()].sort((left, right) =>
    left.descriptor.digest < right.descriptor.digest ? -1 : 1));

  const eventIds = new Set<string>();
  const revisionCoordinates = new Set<string>();
  const retainedReferences = new Map<Sha256, RetainedAdjacentFileReference>();
  const candidateCarrierOwners: CandidateCarrierManifestOwner[] = [];
  const snapshotAppends: ControlRecordStoreAppend[] = [];
  const appends = Object.freeze(input.appends.map((append): PendingFileManifestAppend => {
    const revision = append.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, append.revision);
    if (revision !== null) {
      assertDeliveryControlRecordPolicy(revision);
      assertDeliveryControlRecordPayload(revision);
      const coordinate = `${revision.recordId}\u0000${revision.revision}`;
      if (revisionCoordinates.has(coordinate)) {
        fail(
          "batch-conflict",
          `File custody repeats Control revision ${revision.recordId} revision ${revision.revision}`,
        );
      }
      revisionCoordinates.add(coordinate);
      const references = retainedAdjacentFileReferencesFromValidatedPayload(revision);
      for (const reference of references) {
        const existing = retainedReferences.get(reference.digest);
        if (existing !== undefined && canonicalJson(existing) !== canonicalJson(reference)) {
          fail("file-conflict", "One referenced file digest cannot bind different Control metadata");
        }
        retainedReferences.set(reference.digest, reference);
      }
      const candidateOwner = candidateCarrierManifestOwner(revision, references);
      if (candidateOwner !== null) candidateCarrierOwners.push(candidateOwner);
    }
    const event = pendingEventInput(identity, append.event);
    if (eventIds.has(event.eventId)) {
      fail("batch-conflict", `File custody repeats event identity ${event.eventId}`);
    }
    eventIds.add(event.eventId);
    if (revision !== null) {
      const compiledEvent = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: 1,
        predecessorDigest: null,
        event,
      });
      assertExactRevisionFinalization(revision, compiledEvent);
    }
    snapshotAppends.push(Object.freeze(revision === null
      ? { event }
      : {
        revision: Object.freeze({
          recordId: revision.recordId,
          recordKind: revision.recordKind,
          revision: revision.revision,
          producer: revision.producer,
          semanticAuthor: revision.semanticAuthor,
          semanticAuthority: revision.semanticAuthority,
          createdAt: revision.createdAt,
          semanticMarkdown: revision.semanticMarkdown,
          payload: revision.payload,
          relationships: revision.relationships,
        }),
        event,
      }));
    return Object.freeze({
      revision: revision === null
        ? null
        : Object.freeze({
          recordId: revision.recordId,
          revision: revision.revision,
          digest: revision.digest,
        }),
      event,
    });
  }));

  const parsedCarrierManifests = new Map<
    Sha256,
    FoundationCandidateRevisionCarrierManifestV1
  >();
  for (const owner of candidateCarrierOwners) {
    const supplied = byDigest.get(owner.reference.digest);
    if (supplied === undefined) {
      fail(
        "candidate-carrier-file-required",
        `${owner.revision.recordKind} ${owner.revision.recordId} revision ${owner.revision.revision} must supply its exact Carrier manifest bytes in the same file-bound append`,
      );
    }
    if (
      supplied.descriptor.byteLength !== owner.reference.byteLength ||
      supplied.descriptor.mediaType !== owner.reference.mediaType ||
      supplied.descriptor.purpose !== owner.reference.purpose
    ) {
      fail(
        "candidate-carrier-reference",
        `${owner.revision.recordKind} ${owner.revision.recordId} revision ${owner.revision.revision} does not reproduce its supplied Carrier manifest descriptor`,
      );
    }
    let manifest = parsedCarrierManifests.get(owner.reference.digest);
    if (manifest === undefined) {
      manifest = parsedCandidateCarrierManifest(owner, supplied.bytes);
      parsedCarrierManifests.set(owner.reference.digest, manifest);
    }
    assertCandidateCarrierManifestSubject(owner, manifest);
  }

  for (const file of files) {
    const reference = retainedReferences.get(file.descriptor.digest);
    if (
      reference === undefined ||
      reference.byteLength !== file.descriptor.byteLength ||
      reference.mediaType !== file.descriptor.mediaType ||
      reference.purpose !== file.descriptor.purpose
    ) {
      fail(
        "file-unbound",
        `File ${file.descriptor.digest} is not selected by one exact Control revision in the same append batch`,
      );
    }
  }

  const manifest: PendingFileManifest = Object.freeze({
    schema: PENDING_FILE_MANIFEST_SCHEMA,
    storeId: identity.storeId,
    processId: identity.processId,
    files: Object.freeze(files.map(({ descriptor }) => descriptor)),
    appends,
    supportMutations: Object.freeze(supportMutations.map((mutation): ControlRecordOperationSupportMutation =>
      mutation.action === "put"
        ? Object.freeze({
          action: "put" as const,
          value: Object.freeze({
            activityId: mutation.activityId,
            supportKind: mutation.supportKind,
            payload: mutation.result.payload,
            expected: mutation.expected,
          }),
        })
        : Object.freeze({
          action: "delete" as const,
          activityId: mutation.activityId,
          expected: mutation.expected,
        }))),
  });
  const manifestJson = canonicalJson(manifest);
  if (Buffer.byteLength(manifestJson, "utf8") > MAXIMUM_PENDING_FILE_MANIFEST_BYTES) {
    fail("file-batch-bound", "File custody manifest exceeds its operational bound");
  }
  return Object.freeze({
    digest: sha256Bytes(manifestJson),
    manifestJson,
    manifest,
    files,
    appends: Object.freeze(snapshotAppends),
    supportMutations,
  });
}

function parsedPendingFile(value: unknown, label: string): ControlRecordFile {
  const object = pendingObject(value, label);
  exactObjectKeys(
    object,
    ["schema", "digest", "byteLength", "mediaType", "purpose", "createdAt"],
    label,
  );
  if (object.schema !== CONTROL_RECORD_FILE_SCHEMA) {
    fail("pending-file-integrity", `${label} selects an unsupported descriptor schema`);
  }
  const digest = expectDigest(object.digest, `${label} digest`);
  const byteLength = expectInteger(object.byteLength, `${label} byte length`);
  const mediaType = expectString(object.mediaType, `${label} media type`);
  if (
    byteLength < 0 ||
    byteLength > MAXIMUM_REFERENCED_FILE_BYTES ||
    !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(mediaType)
  ) {
    fail("pending-file-integrity", `${label} exceeds the adjacent-file profile`);
  }
  return Object.freeze({
    schema: CONTROL_RECORD_FILE_SCHEMA,
    digest,
    byteLength,
    mediaType,
    purpose: controlIdentifier(expectString(object.purpose, `${label} purpose`), `${label} purpose`),
    createdAt: controlTimestamp(
      expectString(object.createdAt, `${label} creation time`),
      `${label} creation time`,
    ),
  });
}

function parsedPendingAppend(
  identity: ControlRecordStoreIdentity,
  value: unknown,
  label: string,
): PendingFileManifestAppend {
  const object = pendingObject(value, label);
  exactObjectKeys(object, ["revision", "event"], label);
  let revision: PendingFileManifestAppend["revision"] = null;
  if (object.revision !== null) {
    const rawRevision = pendingObject(object.revision, `${label} revision`);
    exactObjectKeys(rawRevision, ["recordId", "revision", "digest"], `${label} revision`);
    const revisionNumber = expectInteger(rawRevision.revision, `${label} revision number`);
    if (revisionNumber < 1) {
      fail("pending-file-integrity", `${label} revision number must be positive`);
    }
    revision = Object.freeze({
      recordId: controlIdentifier(
        expectString(rawRevision.recordId, `${label} record identity`),
        `${label} record identity`,
      ),
      revision: revisionNumber,
      digest: expectDigest(rawRevision.digest, `${label} revision digest`),
    });
  }

  const rawEvent = pendingObject(object.event, `${label} event`);
  exactObjectKeys(
    rawEvent,
    ["eventId", "eventKind", "occurredAt", "actor", "subject", "payload"],
    `${label} event`,
  );
  const actor = actorFromJson(canonicalJson(pendingObject(rawEvent.actor, `${label} actor`)), `${label} actor`);
  const payload = pendingObject(rawEvent.payload, `${label} payload`);
  let subject: ControlRecordEventInput["subject"] = null;
  if (rawEvent.subject !== null) {
    const rawSubject = pendingObject(rawEvent.subject, `${label} subject`);
    exactObjectKeys(rawSubject, ["recordId", "revision", "digest"], `${label} subject`);
    subject = Object.freeze({
      recordId: expectString(rawSubject.recordId, `${label} subject identity`),
      revision: expectInteger(rawSubject.revision, `${label} subject revision`),
      digest: expectDigest(rawSubject.digest, `${label} subject digest`),
    });
  }
  const event = pendingEventInput(identity, Object.freeze({
    eventId: expectString(rawEvent.eventId, `${label} event identity`),
    eventKind: expectString(rawEvent.eventKind, `${label} event kind`),
    occurredAt: expectString(rawEvent.occurredAt, `${label} event time`),
    actor,
    subject,
    payload,
  }));
  return Object.freeze({ revision, event });
}

function parsedPendingSupportMutation(
  identity: ControlRecordStoreIdentity,
  value: unknown,
  label: string,
): ControlRecordOperationSupportMutation {
  const parsedCoordinate = (
    selected: unknown,
    coordinateLabel: string,
  ): ControlRecordOperationSupportCoordinate => {
    const coordinate = pendingObject(selected, coordinateLabel);
    exactObjectKeys(coordinate, ["generation", "payloadDigest"], coordinateLabel);
    return operationSupportCoordinate(Object.freeze({
      generation: expectInteger(coordinate.generation, `${coordinateLabel} generation`),
      payloadDigest: expectDigest(coordinate.payloadDigest, `${coordinateLabel} payload digest`),
    }), coordinateLabel);
  };
  const object = pendingObject(value, label);
  if (object.action === "put") {
    exactObjectKeys(object, ["action", "value"], label);
    const rawValue = pendingObject(object.value, `${label} value`);
    exactObjectKeys(
      rawValue,
      ["activityId", "supportKind", "payload", "expected"],
      `${label} value`,
    );
    const expected = rawValue.expected === null
      ? null
      : parsedCoordinate(rawValue.expected, `${label} expected coordinate`);
    const mutation = Object.freeze({
      action: "put" as const,
      value: Object.freeze({
        activityId: expectString(rawValue.activityId, `${label} activity identity`),
        supportKind: expectString(rawValue.supportKind, `${label} support kind`),
        payload: pendingObject(rawValue.payload, `${label} payload`),
        expected,
      }),
    });
    const prepared = prepareOperationSupportMutation(identity, mutation);
    if (prepared.action !== "put") {
      fail("pending-file-integrity", `${label} did not compile as one support put`);
    }
    return Object.freeze({
      action: "put" as const,
      value: Object.freeze({
        activityId: prepared.activityId,
        supportKind: prepared.supportKind,
        payload: prepared.result.payload,
        expected: prepared.expected,
      }),
    });
  }
  if (object.action === "delete") {
    exactObjectKeys(object, ["action", "activityId", "expected"], label);
    const mutation = Object.freeze({
      action: "delete" as const,
      activityId: expectString(object.activityId, `${label} activity identity`),
      expected: parsedCoordinate(object.expected, `${label} expected coordinate`),
    });
    const prepared = prepareOperationSupportMutation(identity, mutation);
    if (prepared.action !== "delete") {
      fail("pending-file-integrity", `${label} did not compile as one support deletion`);
    }
    return Object.freeze({
      action: "delete" as const,
      activityId: prepared.activityId,
      expected: prepared.expected,
    });
  }
  fail("pending-file-integrity", `${label} has an unsupported action`);
}

function parsePendingFileManifest(
  identity: ControlRecordStoreIdentity,
  value: string,
): PendingFileManifest {
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_PENDING_FILE_MANIFEST_BYTES) {
    fail("pending-file-integrity", "Pending file custody manifest exceeds its bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("pending-file-integrity", "Pending file custody manifest is not JSON");
  }
  const object = pendingObject(parsed, "Pending file custody manifest");
  if (canonicalJson(object) !== value) {
    fail("pending-file-integrity", "Pending file custody manifest is not canonical JSON");
  }
  exactObjectKeys(
    object,
    ["schema", "storeId", "processId", "files", "appends", "supportMutations"],
    "Pending file custody manifest",
  );
  if (
    object.schema !== PENDING_FILE_MANIFEST_SCHEMA ||
    object.storeId !== identity.storeId ||
    object.processId !== identity.processId
  ) {
    fail("pending-file-integrity", "Pending file custody manifest crosses its exact Store or Process");
  }
  const rawFiles = pendingArray(object.files, "Pending file custody files");
  const rawAppends = pendingArray(object.appends, "Pending file custody appends");
  const rawSupportMutations = pendingArray(
    object.supportMutations,
    "Pending file custody support mutations",
  );
  if (
    rawFiles.length < 1 ||
    rawFiles.length > MAXIMUM_REFERENCED_FILES ||
    rawAppends.length < 1 ||
    rawAppends.length > MAXIMUM_APPEND_BATCH_ITEMS ||
    rawSupportMutations.length > MAXIMUM_OPERATION_SUPPORT_ENTRIES
  ) {
    fail("pending-file-integrity", "Pending file custody manifest exceeds its item bounds");
  }
  const files = Object.freeze(rawFiles.map((file, index) =>
    parsedPendingFile(file, `Pending file ${index + 1}`)));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1]!.digest >= files[index]!.digest) {
      fail("pending-file-integrity", "Pending file custody descriptors are not uniquely ordered");
    }
  }
  const eventIds = new Set<string>();
  const revisionCoordinates = new Set<string>();
  const appends = Object.freeze(rawAppends.map((append, index) => {
    const parsedAppend = parsedPendingAppend(identity, append, `Pending append ${index + 1}`);
    if (eventIds.has(parsedAppend.event.eventId)) {
      fail("pending-file-integrity", "Pending file custody repeats an event identity");
    }
    eventIds.add(parsedAppend.event.eventId);
    if (parsedAppend.revision !== null) {
      const coordinate = `${parsedAppend.revision.recordId}\u0000${parsedAppend.revision.revision}`;
      if (revisionCoordinates.has(coordinate)) {
        fail("pending-file-integrity", "Pending file custody repeats a revision coordinate");
      }
      revisionCoordinates.add(coordinate);
    }
    return parsedAppend;
  }));
  const supportActivityIds = new Set<string>();
  const supportMutations = Object.freeze(rawSupportMutations.map((mutation, index) => {
    const parsedMutation = parsedPendingSupportMutation(
      identity,
      mutation,
      `Pending support mutation ${index + 1}`,
    );
    const activityId = parsedMutation.action === "put"
      ? parsedMutation.value.activityId
      : parsedMutation.activityId;
    if (supportActivityIds.has(activityId)) {
      fail("pending-file-integrity", "Pending file custody repeats a support activity identity");
    }
    supportActivityIds.add(activityId);
    return parsedMutation;
  }));
  return Object.freeze({
    schema: PENDING_FILE_MANIFEST_SCHEMA,
    storeId: identity.storeId,
    processId: identity.processId,
    files,
    appends,
    supportMutations,
  });
}

function pendingFileBatch(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
): PendingFileBatch | null {
  const row = db.prepare("SELECT * FROM pending_file_batches WHERE singleton = 1").get() as SqlRow | undefined;
  if (row === undefined) {
    const entryCount = expectInteger(
      (db.prepare("SELECT COUNT(*) AS count FROM pending_file_entries").get() as SqlRow).count,
      "Pending file entry count",
    );
    if (entryCount !== 0) {
      fail("pending-file-integrity", "Pending file entries exist without their exact batch");
    }
    return null;
  }
  const digest = expectDigest(row.batch_digest, "Pending file batch digest");
  const manifestJson = expectString(row.manifest_json, "Pending file batch manifest");
  if (sha256Bytes(manifestJson) !== digest) {
    fail("pending-file-integrity", "Pending file batch digest does not reproduce its manifest");
  }
  const manifest = parsePendingFileManifest(identity, manifestJson);
  const rows = db.prepare(`
    SELECT * FROM pending_file_entries
    WHERE batch_digest = ? ORDER BY ordinal
  `).all(digest) as SqlRow[];
  if (rows.length !== manifest.files.length) {
    fail("pending-file-integrity", "Pending file entry inventory does not match its manifest");
  }
  const entries = Object.freeze(rows.map((entry, index): PendingFileEntry => {
    if (expectInteger(entry.ordinal, "Pending file ordinal") !== index) {
      fail("pending-file-integrity", "Pending file ordinals are not exact and contiguous");
    }
    const descriptor = Object.freeze({
      schema: CONTROL_RECORD_FILE_SCHEMA,
      digest: expectDigest(entry.digest, "Pending file digest"),
      byteLength: expectInteger(entry.byte_length, "Pending file byte length"),
      mediaType: expectString(entry.media_type, "Pending file media type"),
      purpose: expectString(entry.purpose, "Pending file purpose"),
      createdAt: expectString(entry.created_at, "Pending file creation time"),
    });
    if (!sameFileDescriptor(descriptor, manifest.files[index]!)) {
      fail("pending-file-integrity", "Pending file entry does not reproduce its manifest descriptor");
    }
    const filename = expectString(entry.filename, "Pending file name");
    const temporaryFilename = expectString(entry.temporary_filename, "Pending temporary file name");
    if (
      filename !== `sha256-${descriptor.digest.slice("sha256:".length)}` ||
      temporaryFilename !== pendingTemporaryFilename(digest, descriptor.digest)
    ) {
      fail("pending-file-integrity", "Pending file carrier names do not reproduce their exact digests");
    }
    const preexisting = expectInteger(entry.preexisting, "Pending file preexisting flag");
    if (preexisting !== 0 && preexisting !== 1) {
      fail("pending-file-integrity", "Pending file preexisting flag is invalid");
    }
    return Object.freeze({
      descriptor,
      filename,
      temporaryFilename,
      preexisting: preexisting === 1,
    });
  }));
  return Object.freeze({ digest, manifestJson, manifest, entries });
}

function pendingAppendState(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
  manifest: PendingFileManifest,
): "absent" | "complete" {
  const rows = manifest.appends.map(({ event }) => db.prepare(`
    SELECT * FROM journal_events WHERE event_id = ?
  `).get(event.eventId) as SqlRow | undefined);
  const retainedCount = rows.filter((row) => row !== undefined).length;
  if (retainedCount !== 0 && retainedCount !== manifest.appends.length) {
    fail("pending-file-integrity", "Pending file append is partially retained");
  }
  if (retainedCount === 0) {
    for (const append of manifest.appends) {
      if (append.revision === null) continue;
      if (db.prepare(`
        SELECT 1 AS retained FROM record_revisions
        WHERE record_id = ? AND revision = ?
      `).get(append.revision.recordId, append.revision.revision) !== undefined) {
        fail("pending-file-integrity", "Pending file append has a revision without its exact event");
      }
    }
    return "absent";
  }

  let previous: ControlRecordEvent | null = null;
  for (let index = 0; index < manifest.appends.length; index += 1) {
    const append = manifest.appends[index]!;
    const retained = eventFromRow(identity, rows[index]!);
    const reproduced = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: retained.sequence,
      predecessorDigest: retained.predecessorDigest,
      event: append.event,
    });
    if (
      reproduced.digest !== retained.digest ||
      (
        previous !== null &&
        (
          retained.sequence !== previous.sequence + 1 ||
          retained.predecessorDigest !== previous.digest
        )
      )
    ) {
      fail("pending-file-integrity", "Pending file append does not reproduce one exact retained sequence");
    }
    if (append.revision !== null) {
      const revisionRow = db.prepare(`
        SELECT digest FROM record_revisions
        WHERE record_id = ? AND revision = ?
      `).get(append.revision.recordId, append.revision.revision) as SqlRow | undefined;
      if (
        revisionRow === undefined ||
        expectDigest(revisionRow.digest, "Pending retained revision digest") !== append.revision.digest
      ) {
        fail("pending-file-integrity", "Pending file append revision does not reproduce its retained digest");
      }
    }
    previous = retained;
  }
  return "complete";
}

function retainedOperationSupportForPending(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
  activityId: string,
): RetainedOperationSupport | null {
  const row = db.prepare(`
    SELECT
      activity_id, schema_id, store_id, process_id, support_kind, state,
      generation, payload_json, payload_digest,
      deleted_generation, deleted_payload_digest
    FROM operation_support
    WHERE activity_id = ?
  `).get(activityId) as SqlRow | undefined;
  return row === undefined ? null : operationSupportFromRow(identity, row);
}

function pendingSupportPrecondition(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
  mutation: PreparedOperationSupportMutation,
): boolean {
  const retained = retainedOperationSupportForPending(db, identity, mutation.activityId);
  if (mutation.action === "put" && mutation.expected === null) return retained === null;
  const expected = mutation.expected;
  if (expected === null) return false;
  return retained?.state === "live" &&
    retained.support.generation === expected.generation &&
    retained.support.payloadDigest === expected.payloadDigest &&
    (mutation.action === "delete" || retained.support.supportKind === mutation.supportKind);
}

function pendingSupportPostcondition(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
  mutation: PreparedOperationSupportMutation,
): boolean {
  const retained = retainedOperationSupportForPending(db, identity, mutation.activityId);
  if (mutation.action === "put") {
    return retained?.state === "live" && sameOperationSupport(retained.support, mutation.result);
  }
  return retained?.state === "deleted" &&
    retained.deleted.generation === mutation.expected.generation &&
    retained.deleted.payloadDigest === mutation.expected.payloadDigest;
}

function pendingOperationState(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
  manifest: PendingFileManifest,
): "absent" | "complete" {
  const appendState = pendingAppendState(db, identity, manifest);
  const prepared = manifest.supportMutations.map((mutation) =>
    prepareOperationSupportMutation(identity, mutation));
  if (appendState === "absent") {
    if (!prepared.every((mutation) => pendingSupportPrecondition(db, identity, mutation))) {
      fail(
        "pending-file-integrity",
        "Pending file custody has absent appends without its exact support precondition",
      );
    }
    return "absent";
  }
  if (!prepared.every((mutation) => pendingSupportPostcondition(db, identity, mutation))) {
    fail(
      "pending-file-integrity",
      "Pending file custody has retained appends without its exact support postcondition",
    );
  }
  return "complete";
}

function fileDescriptorFromRow(row: SqlRow, label: string): ControlRecordFile {
  return Object.freeze({
    schema: CONTROL_RECORD_FILE_SCHEMA,
    digest: expectDigest(row.digest, `${label} digest`),
    byteLength: expectInteger(row.byte_length, `${label} byte length`),
    mediaType: expectString(row.media_type, `${label} media type`),
    purpose: expectString(row.purpose, `${label} purpose`),
    createdAt: controlTimestamp(
      expectString(row.created_at, `${label} creation time`),
      `${label} creation time`,
    ),
  });
}

function assertExactFileDescriptorRow(
  row: SqlRow,
  descriptor: ControlRecordFile,
  filename: string,
): void {
  if (
    !sameFileDescriptor(fileDescriptorFromRow(row, "Referenced file"), descriptor) ||
    expectString(row.filename, "Referenced file name") !== filename
  ) {
    fail("file-conflict", "One referenced file digest cannot name different metadata");
  }
}

async function verifyPendingTemporary(
  path: string,
  maximumBytes: number,
): Promise<void> {
  const state = await lstat(path, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
    fail("pending-file-integrity", `${basename(path)} must be one pending regular file`);
  }
  if (Number(state.mode & 0o7777n) !== 0o600) {
    fail("pending-file-integrity", `${basename(path)} must use mode 0600`);
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) {
    fail("pending-file-integrity", `${basename(path)} must be owned by the effective user`);
  }
  if (state.size > BigInt(maximumBytes)) {
    fail("pending-file-integrity", `${basename(path)} exceeds its pending file bound`);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function deterministicAppendFailure(error: unknown): boolean {
  if (!(error instanceof FoundationError)) return false;
  return !([
    "lifecycle.control-record-store.batch-order",
    "lifecycle.control-record-store.batch-partial",
    "lifecycle.control-record-store.database-shape",
    "lifecycle.control-record-store.database-integrity",
    "lifecycle.control-record-store.database-schema",
    "lifecycle.control-record-store.event-conflict",
    "lifecycle.control-record-store.event-integrity",
    "lifecycle.control-record-store.file-batch-conflict",
    "lifecycle.control-record-store.revision-integrity",
    "lifecycle.control-record-store.revision-conflict",
    "lifecycle.control-record-store.revision-finalization",
    "lifecycle.control-record-store.file-integrity",
    "lifecycle.control-record-store.pending-file-integrity",
    "lifecycle.control-record-store.work-stop-integrity",
    "lifecycle.control-record-store.physical-layout",
  ] as const).some((code) => code === error.code);
}

function semanticReferencedFileRows(
  db: DatabaseSync,
  identity: ControlRecordStoreIdentity,
): readonly SqlRow[] {
  const rows = db.prepare("SELECT * FROM referenced_files ORDER BY digest").all() as SqlRow[];
  const pending = pendingFileBatch(db, identity);
  if (
    pending === null ||
    pendingOperationState(db, identity, pending.manifest) === "complete"
  ) {
    return Object.freeze(rows);
  }
  const operational = new Set(
    pending.entries
      .filter(({ preexisting }) => !preexisting)
      .map(({ descriptor }) => descriptor.digest),
  );
  return Object.freeze(rows.filter((row) =>
    !operational.has(expectDigest(row.digest, "Referenced file digest"))));
}

export class ControlRecordStore implements Disposable {
  readonly identity: ControlRecordStoreIdentity;
  readonly paths: ControlRecordStorePaths;
  readonly readOnly: boolean;
  readonly archiveLayout: boolean;
  readonly #db: DatabaseSync;
  #closed = false;
  #replay: IncrementalDeliveryReplay;

  private constructor(
    db: DatabaseSync,
    identity: ControlRecordStoreIdentity,
    storePaths: ControlRecordStorePaths,
    readOnly: boolean,
    archiveLayout: boolean,
  ) {
    this.#db = db;
    this.identity = identity;
    this.paths = storePaths;
    this.readOnly = readOnly;
    this.archiveLayout = archiveLayout;
    this.#replay = createDeliveryReplay((subject) =>
      this.getRevision(subject.recordId, subject.revision));
  }

  static async open(options: ControlRecordStoreOpenOptions): Promise<ControlRecordStore> {
    const storePaths = paths(options.root);
    const expectedIdentity = validatedIdentity(options.identity);
    const readOnly = options.readOnly === true;
    const archiveLayout = options.archiveLayout === true;
    if (options.create && readOnly) fail("open", "A read-only Control Record Store cannot be created");
    if (archiveLayout && (options.create || !readOnly)) {
      fail("open", "An archived Control Record Store must be opened read-only without creation");
    }
    await exactDirectory(storePaths.root, "Control Record Store root", options.create);
    await exactDirectory(storePaths.files, "Control Record Store files directory", options.create);
    await exactDirectory(storePaths.drafts, "Control Record Store drafts directory", options.create);

    let existed = true;
    try {
      await lstat(storePaths.database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") existed = false;
      else throw error;
    }
    if (!existed && !options.create) fail("open", "Control Record Store database does not exist");
    await assertStoreRootEntries(storePaths.root, existed, existed, archiveLayout);
    if (!existed) {
      const databaseHandle = await open(storePaths.database, "wx", 0o600);
      try {
        await databaseHandle.sync();
      } finally {
        await databaseHandle.close();
      }
      await chmod(storePaths.database, 0o600);
    }
    await exactDatabaseFile(storePaths.database);

    const db = new DatabaseSync(storePaths.database, {
      readOnly,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      defensive: true,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      limits: {
        length: 8 * 1024 * 1024,
        sqlLength: 1024 * 1024,
        column: 128,
        exprDepth: 64,
        compoundSelect: 16,
        functionArg: 32,
        attach: 0,
        likePatternLength: 4096,
        variableNumber: 128,
        triggerDepth: 16,
      },
    });
    try {
      db.enableDefensive(true);
      db.exec(`
        PRAGMA trusted_schema = OFF;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA secure_delete = ON;
      `);
      if (!readOnly) {
        db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = EXTRA; PRAGMA temp_store = MEMORY; PRAGMA locking_mode = NORMAL;");
      } else {
        db.exec("PRAGMA query_only = ON;");
      }

      if (!existed) {
        db.exec(schemaSql());
        db.prepare(`
          INSERT INTO store_metadata (
            singleton, schema_id, store_id, target_id, process_kind, process_id, created_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?)
        `).run(
          expectedIdentity.schema,
          expectedIdentity.storeId,
          expectedIdentity.targetId,
          expectedIdentity.processKind,
          expectedIdentity.processId,
          expectedIdentity.createdAt,
        );
        await chmod(storePaths.database, 0o600);
      }
      await exactDatabaseFile(storePaths.database);
      await assertStoreRootEntries(storePaths.root, true, false, archiveLayout);

      const applicationId = (db.prepare("PRAGMA application_id").get() as Readonly<{ application_id: number }>).application_id;
      const userVersion = (db.prepare("PRAGMA user_version").get() as Readonly<{ user_version: number }>).user_version;
      if (applicationId !== CONTROL_RECORD_STORE_DATABASE_APPLICATION_ID
        || userVersion !== CONTROL_RECORD_STORE_DATABASE_USER_VERSION) {
        fail("version", "Control Record Store database has unsupported physical coordinates", {
          applicationId,
          userVersion,
        });
      }
      assertExactDatabaseSchema(db);
      const retainedIdentity = metadata(db);
      if (!sameIdentity(retainedIdentity, expectedIdentity)) {
        fail("metadata", "Control Record Store identity does not match the requested exact Process");
      }
      const store = new ControlRecordStore(
        db,
        retainedIdentity,
        storePaths,
        readOnly,
        archiveLayout,
      );
      await store.verifyIntegrity();
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  /** Operational stop custody is separate from the sole Journal writer. */
  getWorkDelegationStopRequest(): WorkDelegationStopRequest | null {
    const row = this.#db.prepare("SELECT * FROM work_delegation_stop_request WHERE singleton = 1").get() as SqlRow | undefined;
    if (row === undefined) return null;
    const request = parseWorkDelegationStopRequest(parseJsonObject(
      expectString(row.request_json, "Work delegation stop request"), "Work delegation stop request", "event"));
    if (request.storeId !== this.identity.storeId || request.processId !== this.identity.processId ||
        request.delegation.id !== row.delegation_id || request.delegation.revision !== row.delegation_revision ||
        request.delegation.digest !== row.delegation_digest || request.digest !== row.request_digest) {
      fail("work-stop-integrity", "Stop request custody must reproduce its exact Store and delegation bindings");
    }
    return request;
  }

  /**
   * Retain one monotonic request without taking the Delivery-long operation
   * lock or appending a Journal event. The current finite operation may settle.
   * A lost return can observe the first request again, including after folding.
   */
  requestWorkDelegationStop(input: Readonly<{
    delegation: WorkDelegationReference;
    requestedBy: string;
    requestedAt: string;
  }>): Readonly<{
    request: WorkDelegationStopRequest;
    disposition: "pending" | "stopped";
    observation: Readonly<{
      state: ReducedDeliveryState;
      seal: ControlRecordStoreSeal | null;
      head: ControlRecordEvent | null;
    }>;
  }> {
    if (this.readOnly) fail("read-only", "Cannot request a stop through a read-only Store");
    const proposed = compileWorkDelegationStopRequest({ ...input,
      storeId: this.identity.storeId, processId: this.identity.processId });
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      // The separate stop caller cannot rely on the connection's earlier replay.
      const history = this.#replaySemanticHistory(false);
      const state = history.replay.finish();
      const seal = this.getSeal();
      const current = state.delegation.current;
      const revision = this.getRevision(proposed.delegation.id, proposed.delegation.revision);
      if (current === null || canonicalJson(current.reference) !== canonicalJson({
        id: proposed.delegation.id, revision: proposed.delegation.revision, digest: proposed.delegation.digest,
      }) || revision === null || revision.recordKind !== "work-delegation" || revision.digest !== proposed.delegation.digest ||
          revision.semanticAuthor.kind !== "director" || revision.semanticAuthor.id !== proposed.requestedBy) {
        fail("work-stop-subject", "Stop requires the current exact delegation and its supplying Director");
      }
      let result: Readonly<{ request: WorkDelegationStopRequest; disposition: "pending" | "stopped" }>;
      if (current.stopped) {
        const row = this.#db.prepare(`
          SELECT * FROM journal_events WHERE event_kind = 'work-delegation-stopped'
            AND subject_record_id = ? AND subject_revision = ? AND subject_digest = ?
          ORDER BY sequence DESC LIMIT 1
        `).get(revision.recordId, revision.revision, revision.digest) as SqlRow | undefined;
        if (row === undefined) fail("work-stop-integrity", "Stopped delegation must retain its exact Journal request");
        const event = eventFromRow(this.identity, row);
        const request = compileWorkDelegationStopRequest({ storeId: this.identity.storeId, processId: this.identity.processId,
          delegation: proposed.delegation,
          requestedBy: expectString(event.payload.requestedBy as SqlRow[string], "Stopped Director"),
          requestedAt: expectString(event.payload.requestedAt as SqlRow[string], "Stopped request time") });
        if (event.payload.requestDigest !== request.digest) fail("work-stop-integrity", "Stopped request digest differs");
        result = Object.freeze({ request, disposition: "stopped" });
      } else {
        if (state.standing === "closed" || seal !== null || state.activities.some(activity =>
          activity.stage !== "completed" && (activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship"))) {
          fail("work-stop-terminal", "Terminal work must finish through its exact decision or recovery route");
        }
        const pending = this.getWorkDelegationStopRequest();
        if (pending !== null) {
          if (canonicalJson(pending.delegation) !== canonicalJson(proposed.delegation) || pending.requestedBy !== proposed.requestedBy) {
            fail("work-stop-integrity", "Pending stop must still concern the same current delegation");
          }
          result = Object.freeze({ request: pending, disposition: "pending" });
        } else {
          if (Date.parse(proposed.requestedAt) < Date.parse(revision.createdAt)) {
            fail("work-stop-time", "A stop request cannot precede the delegation it stops");
          }
          this.#db.prepare(`
            INSERT INTO work_delegation_stop_request
              (singleton, delegation_id, delegation_revision, delegation_digest, request_json, request_digest)
              VALUES (1, ?, ?, ?, ?, ?)
          `).run(revision.recordId, revision.revision, revision.digest, canonicalJson(proposed), proposed.digest);
          result = Object.freeze({ request: proposed, disposition: "pending" });
        }
      }
      const head = state.journal.eventCount === 0 ? null
        : this.listEvents(state.journal.eventCount - 1, 1)[0] ?? null;
      if (state.journal.eventCount === 0 ? state.journal.headDigest !== null
        : head === null || head.sequence !== state.journal.eventCount || head.digest !== state.journal.headDigest) {
        fail("work-stop-integrity", "Stop observation must bind the exact committed Journal head");
      }
      // Capture all mutable facts in this same transaction. Later projection
      // must not mix this replay with a newer seal or writer observation.
      const committed = Object.freeze({ ...result, observation: Object.freeze({ state, seal, head }) });
      this.#db.exec("COMMIT");
      this.#replay = history.replay;
      return committed;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  #assertWorkDelegationStopBoundary(event: ControlRecordEvent): WorkDelegationStopRequest | null {
    const pending = this.getWorkDelegationStopRequest();
    if (event.eventKind === "work-delegation-stopped") {
      if (pending === null || event.subject === null || event.subject.recordId !== pending.delegation.id ||
          event.subject.revision !== pending.delegation.revision || event.subject.digest !== pending.delegation.digest ||
          canonicalJson(event.payload) !== canonicalJson({ requestDigest: pending.digest,
            requestedAt: pending.requestedAt, requestedBy: pending.requestedBy })) {
        fail("work-stop-integrity", "Settling a stop requires its exact retained request in the same transaction");
      }
      return pending;
    }
    if (pending !== null && (event.eventKind === "activity-started" ||
        event.eventKind === "work-delegation-set" || event.eventKind === "closure-recorded")) {
      fail("work-stop-pending", "The retained stop must settle before another Activity, delegation or Closure");
    }
    return null;
  }

  append(input: ControlRecordStoreAppend): ControlRecordStoreAppendResult {
    return this.appendBatch(Object.freeze([input]))[0]!;
  }

  /**
   * Append one bounded ordered Control sequence as a single SQLite commit.
   * Every item remains one ordinary optional-revision/event append; batching
   * changes only their shared durability boundary.
   */
  appendBatch(inputs: readonly ControlRecordStoreAppend[]): readonly ControlRecordStoreAppendResult[] {
    assertNoUnboundCandidateRevision(inputs);
    return this.#runAppendBatchTransaction(inputs, null);
  }

  #runAppendBatchTransaction(
    inputs: readonly ControlRecordStoreAppend[],
    expectedPendingFileBatch: PendingFileBatch | null,
  ): readonly ControlRecordStoreAppendResult[] {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.#appendBatchInTransaction(inputs, expectedPendingFileBatch);
      this.#db.exec("COMMIT");
      if (result.replay !== null) this.#replay = result.replay;
      return result.appends;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  #appendBatchInTransaction(
    inputs: readonly ControlRecordStoreAppend[],
    expectedPendingFileBatch: PendingFileBatch | null,
  ): AppendTransactionResult {
    if (this.readOnly) fail("read-only", "Cannot append to a read-only Control Record Store");
    if (
      !Array.isArray(inputs) ||
      inputs.length < 1 ||
      inputs.length > MAXIMUM_APPEND_BATCH_ITEMS
    ) {
      fail(
        "batch-bound",
        `A Control Record Store append batch must contain between 1 and ${MAXIMUM_APPEND_BATCH_ITEMS} ordered items`,
      );
    }

    const compiled = inputs.map((input) => {
      const revision = input.revision === undefined
        ? null
        : compileControlRecordRevision(this.identity.processId, input.revision);
      if (revision !== null) assertDeliveryControlRecordPolicy(revision);
      return Object.freeze({ input, revision });
    });
    const eventIds = new Set<string>();
    const revisionCoordinates = new Set<string>();
    for (const item of compiled) {
      const eventId = controlIdentifier(item.input.event.eventId, "Control record event identity");
      if (eventIds.has(eventId)) {
        fail("batch-conflict", `Append batch repeats event identity ${eventId}`);
      }
      eventIds.add(eventId);
      if (item.revision !== null) {
        const coordinate = `${item.revision.recordId}\u0000${item.revision.revision}`;
        if (revisionCoordinates.has(coordinate)) {
          fail(
            "batch-conflict",
            `Append batch repeats Control revision ${item.revision.recordId} revision ${item.revision.revision}`,
          );
        }
        revisionCoordinates.add(coordinate);
      }
    }

      const retainedPendingFileBatch = pendingFileBatch(this.#db, this.identity);
      if (
        expectedPendingFileBatch === null
          ? retainedPendingFileBatch !== null
          : (
            retainedPendingFileBatch === null ||
            retainedPendingFileBatch.digest !== expectedPendingFileBatch.digest ||
            retainedPendingFileBatch.manifestJson !== expectedPendingFileBatch.manifestJson
          )
      ) {
        fail(
          "file-batch-conflict",
          expectedPendingFileBatch === null
            ? "Pending file custody must recover before another Control append"
            : "Pending file custody changed before its exact Control append",
        );
      }
      const retainedRows = compiled.map(({ input }) => this.#db.prepare(`
        SELECT * FROM journal_events WHERE event_id = ?
      `).get(input.event.eventId) as SqlRow | undefined);
      const retainedCount = retainedRows.filter((row) => row !== undefined).length;
      if (retainedCount !== 0) {
        if (retainedCount !== compiled.length) {
          fail(
            "batch-partial",
            "Append batch is partially retained and cannot be replayed as one atomic boundary",
            { retainedCount, batchSize: compiled.length },
          );
        }
        const retained: ControlRecordStoreAppendResult[] = [];
        let previousEvent: ControlRecordEvent | null = null;
        for (let index = 0; index < compiled.length; index += 1) {
          const item = compiled[index]!;
          const existingEvent = eventFromRow(this.identity, retainedRows[index]!);
          assertRetainedEventDescriptor(this.#db, existingEvent);
          const reproduced = compileControlRecordEvent({
            storeId: this.identity.storeId,
            processId: this.identity.processId,
            sequence: existingEvent.sequence,
            predecessorDigest: existingEvent.predecessorDigest,
            event: item.input.event,
          });
          assertRetainedEventDescriptor(this.#db, reproduced);
          if (reproduced.digest !== existingEvent.digest) {
            fail(
              "event-conflict",
              `Event identity ${item.input.event.eventId} already names different logical content`,
            );
          }
          if (
            previousEvent !== null &&
            (
              existingEvent.sequence !== previousEvent.sequence + 1 ||
              existingEvent.predecessorDigest !== previousEvent.digest
            )
          ) {
            fail(
              "batch-order",
              "Retained append batch events are not one exact contiguous sequence in supplied order",
            );
          }

          const existingRevision = item.revision === null
            ? null
            : this.getRevision(item.revision.recordId, item.revision.revision);
          if (item.revision !== null && existingRevision?.digest !== item.revision.digest) {
            fail(
              "revision-conflict",
              "Idempotent batch replay names a different Control record revision",
            );
          }
          if (existingRevision !== null) {
            assertRevisionPolicyAndTargets(this.#db, existingRevision);
            assertExactRevisionFinalization(existingRevision, existingEvent);
            if (finalizationEventCount(this.#db, existingRevision) !== 1) {
              fail(
                "revision-finalization",
                "A retained revision must have exactly one registry finalization event",
              );
            }
          } else if (existingEvent.subject !== null) {
            const subject = this.getRevision(
              existingEvent.subject.recordId,
              existingEvent.subject.revision,
            );
            if (subject === null) {
              fail(
                "event-subject",
                "Event subject does not resolve to one exact retained Control record revision",
              );
            }
            const policy = deliveryControlRecordPolicy(subject.recordKind);
            if (
              existingEvent.eventKind === policy.finalizationEvent &&
              finalizationEventCount(this.#db, subject) !== 1
            ) {
              fail(
                "revision-finalization",
                "A retained revision must have exactly one registry finalization event",
              );
            }
          }
          retained.push(Object.freeze({ revision: existingRevision, event: existingEvent }));
          previousEvent = existingEvent;
        }
        return Object.freeze({
          appends: Object.freeze(retained),
          replay: null,
          disposition: "retained",
        });
      }

      if (this.#db.prepare("SELECT 1 AS sealed FROM store_seal WHERE singleton = 1").get() !== undefined) {
        fail("sealed", "A sealed Control Record Store cannot accept another revision or event");
      }

      const eventCount = expectInteger(
        (this.#db.prepare("SELECT COUNT(*) AS count FROM journal_events").get() as SqlRow).count,
        "Journal event count",
      );
      if (eventCount + compiled.length > MAXIMUM_JOURNAL_EVENTS) {
        fail("event-limit", "Control Record Store append batch exceeds its Journal event limit");
      }

      const candidateReplay = this.#replay.fork();
      const results: ControlRecordStoreAppendResult[] = [];
      const initialHead = this.#db.prepare(`
        SELECT sequence, occurred_at, digest
        FROM journal_events ORDER BY sequence DESC LIMIT 1
      `).get() as SqlRow | undefined;
      let sequence = initialHead === undefined
        ? 1
        : expectInteger(initialHead.sequence, "Journal head sequence") + 1;
      let predecessorDigest: Sha256 | null = initialHead === undefined
        ? null
        : expectDigest(initialHead.digest, "Journal head digest");
      let predecessorTime: string | null = initialHead === undefined
        ? null
        : expectString(initialHead.occurred_at, "Journal head time");

      for (const item of compiled) {
        const compiledRevision = item.revision;
        if (compiledRevision !== null) {
          if (this.getRevision(compiledRevision.recordId, compiledRevision.revision) !== null) {
            fail(
              "revision-conflict",
              "A fresh append batch cannot finalize an already retained Control record revision",
            );
          }
          const revisionCount = expectInteger(
            (this.#db.prepare("SELECT COUNT(*) AS count FROM record_revisions").get() as SqlRow).count,
            "Control revision count",
          );
          if (revisionCount >= MAXIMUM_CONTROL_REVISIONS) {
            fail("revision-limit", "Control Record Store reached its revision limit");
          }
          const current = this.#db.prepare(`
            SELECT records.record_kind, MAX(revisions.revision) AS maximum_revision
            FROM control_records AS records
            LEFT JOIN record_revisions AS revisions ON revisions.record_id = records.record_id
            WHERE records.record_id = ?
            GROUP BY records.record_id, records.record_kind
          `).get(compiledRevision.recordId) as SqlRow | undefined;
          if (current === undefined) {
            const recordCount = expectInteger(
              (this.#db.prepare("SELECT COUNT(*) AS count FROM control_records").get() as SqlRow).count,
              "Control record count",
            );
            if (recordCount >= MAXIMUM_CONTROL_RECORDS) {
              fail("record-limit", "Control Record Store reached its logical record limit");
            }
            if (compiledRevision.revision !== 1) {
              fail("revision-order", "A new Control record must begin at revision 1");
            }
            this.#db.prepare(`
              INSERT INTO control_records (record_id, process_id, record_kind, created_at)
              VALUES (?, ?, ?, ?)
            `).run(
              compiledRevision.recordId,
              compiledRevision.processId,
              compiledRevision.recordKind,
              compiledRevision.createdAt,
            );
          } else {
            if (expectString(current.record_kind, "Existing Control record kind") !== compiledRevision.recordKind) {
              fail("revision-kind", "A Control record identity cannot change kind across revisions");
            }
            if (
              compiledRevision.revision !==
              expectInteger(current.maximum_revision, "Current Control record revision") + 1
            ) {
              fail("revision-order", "A Control record revision must follow its exact current revision");
            }
          }
          assertRevisionPolicyAndTargets(this.#db, compiledRevision);
          this.#db.prepare(`
            INSERT INTO record_revisions (
              record_id, revision, producer_json, semantic_author_json,
              semantic_authority, created_at, semantic_markdown, payload_json, digest
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            compiledRevision.recordId,
            compiledRevision.revision,
            canonicalJson(compiledRevision.producer),
            canonicalJson(compiledRevision.semanticAuthor),
            compiledRevision.semanticAuthority,
            compiledRevision.createdAt,
            compiledRevision.semanticMarkdown,
            canonicalJson(compiledRevision.payload),
            compiledRevision.digest,
          );
          const insertRelationship = this.#db.prepare(`
            INSERT INTO record_relationships (
              source_record_id, source_revision, relation, target_kind, target_id,
              target_revision, target_digest
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const relationship of compiledRevision.relationships) {
            insertRelationship.run(
              compiledRevision.recordId,
              compiledRevision.revision,
              relationship.relation,
              relationship.target.kind,
              relationship.target.id,
              relationship.target.revision,
              relationship.target.digest,
            );
          }
        }

        const occurredAt = controlTimestamp(item.input.event.occurredAt, "Control record event time");
        if (
          predecessorTime !== null &&
          new Date(occurredAt).valueOf() < new Date(predecessorTime).valueOf()
        ) {
          fail("event-time", "Control record event time cannot move backwards");
        }
        const event = compileControlRecordEvent({
          storeId: this.identity.storeId,
          processId: this.identity.processId,
          sequence,
          predecessorDigest,
          event: item.input.event,
        });
        assertRetainedEventDescriptor(this.#db, event);
        if (compiledRevision !== null) {
          assertExactRevisionFinalization(compiledRevision, event);
        } else if (event.subject !== null) {
          const subject = this.getRevision(event.subject.recordId, event.subject.revision);
          if (subject === null) {
            fail(
              "event-subject",
              "Event subject does not resolve to one exact retained Control record revision",
            );
          }
          const policy = deliveryControlRecordPolicy(subject.recordKind);
          if (
            event.eventKind === policy.finalizationEvent &&
            finalizationEventCount(this.#db, subject) !== 0
          ) {
            fail(
              "revision-finalization",
              "A Control record revision cannot have another finalization event",
            );
          }
        }
        const settledStop = this.#assertWorkDelegationStopBoundary(event);
        candidateReplay.append(event);
        this.#db.prepare(`
          INSERT INTO journal_events (
            sequence, event_id, event_kind, occurred_at, actor_json,
            subject_record_id, subject_revision, subject_digest, payload_json,
            predecessor_digest, digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.sequence,
          event.eventId,
          event.eventKind,
          event.occurredAt,
          canonicalJson(event.actor),
          event.subject?.recordId ?? null,
          event.subject?.revision ?? null,
          event.subject?.digest ?? null,
          canonicalJson(event.payload),
          event.predecessorDigest,
          event.digest,
        );
        if (settledStop !== null) {
          this.#db.prepare("DELETE FROM work_delegation_stop_request WHERE singleton = 1 AND request_digest = ?").run(settledStop.digest);
        }
        if (compiledRevision !== null && finalizationEventCount(this.#db, compiledRevision) !== 1) {
          fail(
            "revision-finalization",
            "An appended revision must have exactly one registry finalization event",
          );
        } else if (compiledRevision === null && event.subject !== null) {
          const subject = this.getRevision(event.subject.recordId, event.subject.revision);
          if (subject === null) {
            fail(
              "event-subject",
              "Event subject does not resolve to one exact retained Control record revision",
            );
          }
          const policy = deliveryControlRecordPolicy(subject.recordKind);
          if (
            event.eventKind === policy.finalizationEvent &&
            finalizationEventCount(this.#db, subject) !== 1
          ) {
            fail(
              "revision-finalization",
              "A retained revision must have exactly one registry finalization event",
            );
          }
        }
        results.push(Object.freeze({ revision: compiledRevision, event }));
        sequence += 1;
        predecessorDigest = event.digest;
        predecessorTime = event.occurredAt;
      }

      // A standing direction is supplied with its grant. Intermediate Journal
      // prefixes can be reduced, but the Store must not commit an orphan Brief
      // that another invocation could later adopt as new resource permission.
      for (const result of results) {
        if (result.event.eventKind !== "director-brief-submitted" ||
            !Object.hasOwn(result.event.payload, "delegationId")) continue;
        const brief = result.revision;
        const grant = results.find(item => item.event.eventKind === "work-delegation-set" &&
          item.revision !== null && item.revision.recordId === result.event.payload.delegationId &&
          item.revision.revision === result.event.payload.delegationRevision)?.revision;
        if (brief === null || grant === undefined || grant === null ||
            !grant.relationships.some(link => link.relation === "uses-brief" && link.target.kind === "director-brief" &&
              link.target.id === brief.recordId && link.target.revision === brief.revision && link.target.digest === brief.digest)) {
          fail("work-delegation-brief-batch", "Standing Director direction must finalize with its exact selecting Work Delegation in one atomic batch");
        }
      }

      return Object.freeze({
        appends: Object.freeze(results),
        replay: candidateReplay,
        disposition: "appended",
      });
  }

  #getRetainedOperationSupport(activityId: string): RetainedOperationSupport | null {
    const selectedActivityId = controlIdentifier(
      activityId,
      "Operation support activity identity",
    );
    const row = this.#db.prepare(`
      SELECT
        activity_id, schema_id, store_id, process_id, support_kind, state,
        generation, payload_json, payload_digest,
        deleted_generation, deleted_payload_digest
      FROM operation_support
      WHERE activity_id = ?
    `).get(selectedActivityId) as SqlRow | undefined;
    return row === undefined ? null : operationSupportFromRow(this.identity, row);
  }

  /** Observe any support history, or exact live Activity support, without exposing its mechanics to custody. */
  hasRetainedOperationSupport(activityId?: string): boolean {
    return activityId === undefined
      ? this.#db.prepare("SELECT 1 FROM operation_support LIMIT 1").get() !== undefined
      : this.#getRetainedOperationSupport(activityId)?.state === "live";
  }

  /** Read the exact live recovery support for one Delivery activity. */
  getOperationSupport(activityId: string): ControlRecordOperationSupport | null {
    const retained = this.#getRetainedOperationSupport(activityId);
    return retained?.state === "live" ? retained.support : null;
  }

  #putOperationSupportInTransaction(
    prepared: PreparedOperationSupportPut,
  ): ControlRecordOperationSupport {
    const current = this.#getRetainedOperationSupport(prepared.activityId);
    if (prepared.expected === null) {
      if (current !== null) {
        fail(
          "operation-support-cas",
          "Operation support creation requires the exact activity coordinate to be absent",
        );
      }
      const liveCount = expectInteger(
        (this.#db.prepare(`
          SELECT COUNT(*) AS count FROM operation_support WHERE state = 'live'
        `).get() as SqlRow).count,
        "Live operation support count",
      );
      if (liveCount >= MAXIMUM_OPERATION_SUPPORT_ENTRIES) {
        fail(
          "operation-support-limit",
          "Control Record Store reached its live operation-support limit",
        );
      }
      const retainedCount = expectInteger(
        (this.#db.prepare("SELECT COUNT(*) AS count FROM operation_support").get() as SqlRow).count,
        "Retained operation support count",
      );
      if (retainedCount >= MAXIMUM_JOURNAL_EVENTS) {
        fail(
          "operation-support-limit",
          "Control Record Store reached its operation-support disposal limit",
        );
      }
      this.#db.prepare(`
        INSERT INTO operation_support (
          activity_id, schema_id, store_id, process_id, support_kind, state,
          generation, payload_json, payload_digest,
          deleted_generation, deleted_payload_digest
        ) VALUES (?, ?, ?, ?, ?, 'live', ?, ?, ?, NULL, NULL)
      `).run(
        prepared.activityId,
        CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
        this.identity.storeId,
        this.identity.processId,
        prepared.supportKind,
        prepared.result.generation,
        prepared.payloadJson,
        prepared.payloadDigest,
      );
    } else {
      if (
        current?.state !== "live" ||
        current.support.supportKind !== prepared.supportKind ||
        current.support.generation !== prepared.expected.generation ||
        current.support.payloadDigest !== prepared.expected.payloadDigest
      ) {
        fail(
          "operation-support-cas",
          "Operation support update does not match the exact retained activity generation and digest",
        );
      }
      const result = this.#db.prepare(`
        UPDATE operation_support
        SET
          state = 'live', generation = ?, payload_json = ?, payload_digest = ?,
          deleted_generation = NULL, deleted_payload_digest = NULL
        WHERE
          activity_id = ? AND state = 'live' AND
          generation = ? AND payload_digest = ?
      `).run(
        prepared.result.generation,
        prepared.payloadJson,
        prepared.payloadDigest,
        prepared.activityId,
        prepared.expected.generation,
        prepared.expected.payloadDigest,
      );
      if (Number(result.changes) !== 1) {
        fail("operation-support-cas", "Operation support changed before its exact update");
      }
    }
    const retained = this.#getRetainedOperationSupport(prepared.activityId);
    if (
      retained?.state !== "live" ||
      !sameOperationSupport(retained.support, prepared.result)
    ) {
      fail(
        "operation-support-integrity",
        "Operation support write did not retain its exact canonical value",
      );
    }
    return retained.support;
  }

  #deleteOperationSupportInTransaction(
    prepared: PreparedOperationSupportDelete,
  ): ControlRecordOperationSupport {
    const current = this.#getRetainedOperationSupport(prepared.activityId);
    if (
      current?.state !== "live" ||
      current.support.generation !== prepared.expected.generation ||
      current.support.payloadDigest !== prepared.expected.payloadDigest
    ) {
      fail(
        "operation-support-cas",
        "Operation support deletion does not match the exact retained activity generation and digest",
      );
    }
    if (current.support.generation >= Number.MAX_SAFE_INTEGER) {
      fail("operation-support-limit", "Operation support generation cannot advance safely");
    }
    const result = this.#db.prepare(`
      UPDATE operation_support
      SET
        state = 'deleted', generation = ?,
        payload_json = NULL, payload_digest = NULL,
        deleted_generation = ?, deleted_payload_digest = ?
      WHERE
        activity_id = ? AND state = 'live' AND
        generation = ? AND payload_digest = ?
    `).run(
      current.support.generation + 1,
      prepared.expected.generation,
      prepared.expected.payloadDigest,
      prepared.activityId,
      prepared.expected.generation,
      prepared.expected.payloadDigest,
    );
    if (Number(result.changes) !== 1) {
      fail("operation-support-cas", "Operation support changed before its exact deletion");
    }
    const retained = this.#getRetainedOperationSupport(prepared.activityId);
    if (
      retained?.state !== "deleted" ||
      retained.deleted.generation !== prepared.expected.generation ||
      retained.deleted.payloadDigest !== prepared.expected.payloadDigest
    ) {
      fail(
        "operation-support-integrity",
        "Operation support deletion did not retain its exact disposal coordinate",
      );
    }
    return current.support;
  }

  #operationSupportPostcondition(
    prepared: PreparedOperationSupportMutation,
  ): boolean {
    const retained = this.#getRetainedOperationSupport(prepared.activityId);
    if (prepared.action === "put") {
      return retained?.state === "live" &&
        sameOperationSupport(retained.support, prepared.result);
    }
    return retained?.state === "deleted" &&
      retained.deleted.generation === prepared.expected.generation &&
      retained.deleted.payloadDigest === prepared.expected.payloadDigest;
  }

  #operationSupportMutationResult(
    prepared: PreparedOperationSupportMutation,
  ): ControlRecordOperationSupportMutationResult {
    return Object.freeze({
      action: prepared.action,
      activityId: prepared.activityId,
      support: prepared.action === "put" ? prepared.result : null,
    });
  }

  /**
   * Create or replace one activity's recovery support under an exact
   * compare-and-swap coordinate. A null expectation means the row must not
   * exist; an existing expectation advances exactly one generation. This is a
   * lower-level support-only primitive. A Process boundary that also appends
   * Journal facts must use commitOperationBatch so the two postconditions
   * cannot split.
   */
  putOperationSupport(input: ControlRecordOperationSupportPut): ControlRecordOperationSupport {
    if (this.readOnly) {
      fail("read-only", "Cannot write operation support in a read-only Control Record Store");
    }
    if (this.getSeal() !== null) {
      fail("sealed", "A sealed Control Record Store cannot accept operation support");
    }
    const prepared = prepareOperationSupportPut(this.identity, input);

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.getSeal() !== null) {
        fail("sealed", "A sealed Control Record Store cannot accept operation support");
      }
      if (pendingFileBatch(this.#db, this.identity) !== null) {
        fail(
          "file-batch-conflict",
          "Pending file custody must recover before operation support can change",
        );
      }
      const retained = this.#putOperationSupportInTransaction(prepared);
      this.#db.exec("COMMIT");
      return retained;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  /**
   * Dispose one activity's support at its exact retained CAS coordinate. This
   * lower-level support-only primitive leaves a bounded disposal tombstone for
   * retry proof; Process completion must use commitOperationBatch.
   */
  deleteOperationSupport(
    activityId: string,
    expected: ControlRecordOperationSupportCoordinate,
  ): ControlRecordOperationSupport {
    if (this.readOnly) {
      fail("read-only", "Cannot delete operation support in a read-only Control Record Store");
    }
    if (this.getSeal() !== null) {
      fail("sealed", "A sealed Control Record Store cannot delete operation support");
    }
    const prepared = prepareOperationSupportDelete(activityId, expected);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.getSeal() !== null) {
        fail("sealed", "A sealed Control Record Store cannot delete operation support");
      }
      if (pendingFileBatch(this.#db, this.identity) !== null) {
        fail(
          "file-batch-conflict",
          "Pending file custody must recover before operation support can change",
        );
      }
      const current = this.#deleteOperationSupportInTransaction(prepared);
      this.#db.exec("COMMIT");
      return current;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  /**
   * Atomically resolve one exact ordered support mutation set and one exact
   * Control append batch. Exact retries require both retained postconditions;
   * a split or partially retained side fails closed.
   */
  commitOperationBatch(
    input: ControlRecordStoreOperationBatch,
  ): ControlRecordStoreOperationBatchResult {
    if (this.readOnly) {
      fail("read-only", "Cannot commit an operation batch in a read-only Control Record Store");
    }
    if (this.getSeal() !== null) {
      fail("sealed", "A sealed Control Record Store cannot accept an operation batch");
    }
    assertNoUnboundCandidateRevision(input.appends);
    if (
      !Array.isArray(input.supportMutations) ||
      input.supportMutations.length < 1 ||
      input.supportMutations.length > MAXIMUM_OPERATION_SUPPORT_ENTRIES
    ) {
      fail(
        "operation-batch-bound",
        `An operation batch must contain between 1 and ${MAXIMUM_OPERATION_SUPPORT_ENTRIES} support mutations`,
      );
    }
    const prepared = input.supportMutations.map((mutation) =>
      prepareOperationSupportMutation(this.identity, mutation));
    const activityIds = new Set<string>();
    for (const mutation of prepared) {
      if (activityIds.has(mutation.activityId)) {
        fail(
          "operation-batch-conflict",
          "An operation batch may mutate each activity support coordinate at most once",
        );
      }
      activityIds.add(mutation.activityId);
    }

    let committed = false;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.getSeal() !== null) {
        fail("sealed", "A sealed Control Record Store cannot accept an operation batch");
      }
      const appendResult = this.#appendBatchInTransaction(input.appends, null);
      input.onStage?.("appends-resolved");

      if (appendResult.disposition === "appended") {
        for (const mutation of prepared) {
          if (this.#operationSupportPostcondition(mutation)) {
            fail(
              "operation-batch-partial",
              "Operation support already has the requested postcondition while the append batch was absent",
            );
          }
          if (mutation.action === "put") {
            this.#putOperationSupportInTransaction(mutation);
          } else {
            this.#deleteOperationSupportInTransaction(mutation);
          }
        }
      } else {
        for (const mutation of prepared) {
          if (!this.#operationSupportPostcondition(mutation)) {
            fail(
              "operation-batch-partial",
              "Retained appends do not have the exact operation-support postcondition",
            );
          }
        }
      }
      input.onStage?.("support-resolved");

      const result: ControlRecordStoreOperationBatchResult = Object.freeze({
        supportMutations: Object.freeze(prepared.map((mutation) =>
          this.#operationSupportMutationResult(mutation))),
        appends: appendResult.appends,
      });
      this.#db.exec("COMMIT");
      committed = true;
      if (appendResult.replay !== null) this.#replay = appendResult.replay;
      input.onStage?.("committed");
      return result;
    } catch (error) {
      if (!committed) {
        try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      }
      throw error;
    }
  }

  getRevision(recordId: string, revision: number): ControlRecordRevision | null {
    const row = this.#db.prepare(`
      SELECT
        records.process_id,
        records.record_kind,
        revisions.record_id,
        revisions.revision,
        revisions.producer_json,
        revisions.semantic_author_json,
        revisions.semantic_authority,
        revisions.created_at AS revision_created_at,
        revisions.semantic_markdown,
        revisions.payload_json,
        revisions.digest
      FROM record_revisions AS revisions
      INNER JOIN control_records AS records ON records.record_id = revisions.record_id
      WHERE revisions.record_id = ? AND revisions.revision = ?
    `).get(recordId, revision) as SqlRow | undefined;
    return row === undefined ? null : revisionFromRow(this.#db, row);
  }

  /** List immutable revisions for one exact logical Control record. */
  listRevisions(input: Readonly<{
    recordId: string;
    afterRevision?: number;
    limit?: number;
  }>): readonly ControlRecordRevision[] {
    const recordId = controlIdentifier(input.recordId, "Control revision-list record identity");
    const afterRevision = input.afterRevision ?? 0;
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
      fail("inspection", "Revision cursor must be one nonnegative safe integer");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      fail("inspection", "Revision inspection limit must be between 1 and 1000");
    }
    const rows = this.#db.prepare(`
      SELECT
        records.process_id,
        records.record_kind,
        revisions.record_id,
        revisions.revision,
        revisions.producer_json,
        revisions.semantic_author_json,
        revisions.semantic_authority,
        revisions.created_at AS revision_created_at,
        revisions.semantic_markdown,
        revisions.payload_json,
        revisions.digest
      FROM record_revisions AS revisions
      INNER JOIN control_records AS records ON records.record_id = revisions.record_id
      WHERE revisions.record_id = ? AND revisions.revision > ?
      ORDER BY revisions.revision
      LIMIT ?
    `).all(recordId, afterRevision, limit) as SqlRow[];
    return Object.freeze(rows.map((row) => revisionFromRow(this.#db, row)));
  }

  /** Return bounded aggregate facts for one registered Control family. */
  inspectRecordFamily(recordKind: string): Readonly<{
    recordKind: string;
    recordCount: number;
    revisionCount: number;
    current: ControlRecordRevision | null;
  }> {
    const kind = deliveryControlRecordPolicy(recordKind).kind;
    const counts = this.#db.prepare(`
      SELECT
        COUNT(DISTINCT records.record_id) AS record_count,
        COUNT(revisions.revision) AS revision_count
      FROM control_records AS records
      LEFT JOIN record_revisions AS revisions ON revisions.record_id = records.record_id
      WHERE records.record_kind = ?
    `).get(kind) as SqlRow;
    const currentRow = this.#db.prepare(`
      SELECT
        records.process_id,
        records.record_kind,
        revisions.record_id,
        revisions.revision,
        revisions.producer_json,
        revisions.semantic_author_json,
        revisions.semantic_authority,
        revisions.created_at AS revision_created_at,
        revisions.semantic_markdown,
        revisions.payload_json,
        revisions.digest
      FROM current_record_revisions AS revisions
      INNER JOIN control_records AS records ON records.record_id = revisions.record_id
      WHERE records.record_kind = ?
      ORDER BY revisions.created_at DESC, revisions.record_id DESC
      LIMIT 1
    `).get(kind) as SqlRow | undefined;
    return Object.freeze({
      recordKind: kind,
      recordCount: expectInteger(counts.record_count, "Control family record count"),
      revisionCount: expectInteger(counts.revision_count, "Control family revision count"),
      current: currentRow === undefined ? null : revisionFromRow(this.#db, currentRow),
    });
  }

  listCurrentRevisions(input: Readonly<{
    recordKinds: readonly string[];
    afterRecordId?: string | null;
    limit?: number;
  }>): readonly ControlRecordRevision[] {
    if (input.recordKinds.length < 1 || input.recordKinds.length > 32) {
      fail("inspection", "Current-revision inspection requires between 1 and 32 Control families");
    }
    const recordKinds = [...new Set(input.recordKinds.map((kind) =>
      deliveryControlRecordPolicy(kind).kind))].sort();
    const afterRecordId = input.afterRecordId === undefined || input.afterRecordId === null
      ? ""
      : controlIdentifier(input.afterRecordId, "Current-revision cursor");
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      fail("inspection", "Current-revision inspection limit must be between 1 and 1000");
    }
    const placeholders = recordKinds.map(() => "?").join(", ");
    const rows = this.#db.prepare(`
      SELECT
        records.process_id,
        records.record_kind,
        revisions.record_id,
        revisions.revision,
        revisions.producer_json,
        revisions.semantic_author_json,
        revisions.semantic_authority,
        revisions.created_at AS revision_created_at,
        revisions.semantic_markdown,
        revisions.payload_json,
        revisions.digest
      FROM current_record_revisions AS revisions
      INNER JOIN control_records AS records ON records.record_id = revisions.record_id
      WHERE records.record_kind IN (${placeholders}) AND revisions.record_id > ?
      ORDER BY revisions.record_id
      LIMIT ?
    `).all(...recordKinds, afterRecordId, limit) as SqlRow[];
    return Object.freeze(rows.map((row) => revisionFromRow(this.#db, row)));
  }

  listEvents(afterSequence = 0, limit = 1000): readonly ControlRecordEvent[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      fail("inspection", "Event cursor must be one nonnegative safe integer");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      fail("inspection", "Event inspection limit must be between 1 and 10000");
    }
    const rows = this.#db.prepare(`
      SELECT * FROM journal_events
      WHERE sequence > ?
      ORDER BY sequence
      LIMIT ?
    `).all(afterSequence, limit) as SqlRow[];
    return Object.freeze(rows.map((row) => eventFromRow(this.identity, row)));
  }

  async #beginPendingFileBatch(
    prepared: PreparedPendingFileBatch,
  ): Promise<Readonly<{ batch: PendingFileBatch; created: boolean }>> {
    const retained = pendingFileBatch(this.#db, this.identity);
    if (retained !== null) {
      if (
        retained.digest !== prepared.digest ||
        retained.manifestJson !== prepared.manifestJson
      ) {
        fail(
          "file-batch-conflict",
          "A different file custody batch is already pending for this Delivery",
        );
      }
      return Object.freeze({ batch: retained, created: false });
    }

    await this.verifyIntegrity();
    const retryDisposition = pendingAppendState(this.#db, this.identity, prepared.manifest);
    for (const mutation of prepared.supportMutations) {
      const exact = retryDisposition === "absent"
        ? pendingSupportPrecondition(this.#db, this.identity, mutation)
        : pendingSupportPostcondition(this.#db, this.identity, mutation);
      if (!exact) {
        fail(
          "operation-support-cas",
          retryDisposition === "absent"
            ? "File custody cannot begin without the exact operation-support precondition"
            : "File custody retry does not reproduce the exact operation-support postcondition",
        );
      }
    }
    const entries: PendingFileEntry[] = [];
    let newCount = 0;
    let newBytes = 0;
    for (const file of prepared.files) {
      const row = this.#db.prepare(`
        SELECT * FROM referenced_files WHERE digest = ?
      `).get(file.descriptor.digest) as SqlRow | undefined;
      const destination = join(this.paths.files, file.filename);
      if (row !== undefined) {
        assertExactFileDescriptorRow(row, file.descriptor, file.filename);
        await verifyFileCarrier(destination, file.descriptor);
      } else {
        newCount += 1;
        newBytes += file.descriptor.byteLength;
        try {
          await lstat(destination);
          fail("file-orphan", `File carrier ${file.filename} exists without one retained descriptor`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      entries.push(Object.freeze({
        descriptor: file.descriptor,
        filename: file.filename,
        temporaryFilename: pendingTemporaryFilename(prepared.digest, file.descriptor.digest),
        preexisting: row !== undefined,
      }));
    }
    const totals = this.#db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(byte_length), 0) AS total_bytes
      FROM referenced_files
    `).get() as SqlRow;
    if (expectInteger(totals.count, "Referenced file count") + newCount > MAXIMUM_REFERENCED_FILES) {
      fail("file-limit", "Control Record Store would exceed its referenced-file count limit");
    }
    if (
      expectInteger(totals.total_bytes, "Referenced file aggregate bytes") + newBytes >
      MAXIMUM_REFERENCED_FILE_TOTAL_BYTES
    ) {
      fail("file-limit", "Control Record Store would exceed its referenced-file aggregate byte limit");
    }

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.getSeal() !== null) {
        fail("sealed", "A sealed Control Record Store cannot begin file custody");
      }
      if (pendingFileBatch(this.#db, this.identity) !== null) {
        fail("file-batch-conflict", "Another file custody batch began concurrently");
      }
      const currentDisposition = pendingAppendState(this.#db, this.identity, prepared.manifest);
      for (const mutation of prepared.supportMutations) {
        const exact = currentDisposition === "absent"
          ? pendingSupportPrecondition(this.#db, this.identity, mutation)
          : pendingSupportPostcondition(this.#db, this.identity, mutation);
        if (!exact) {
          fail(
            "operation-support-cas",
            currentDisposition === "absent"
              ? "File custody cannot begin after its operation-support precondition changed"
              : "File custody retry no longer reproduces its operation-support postcondition",
          );
        }
      }
      for (const entry of entries) {
        const row = this.#db.prepare(`
          SELECT * FROM referenced_files WHERE digest = ?
        `).get(entry.descriptor.digest) as SqlRow | undefined;
        if (entry.preexisting) {
          if (row === undefined) {
            fail("file-conflict", "A preexisting referenced file disappeared during custody");
          }
          assertExactFileDescriptorRow(row, entry.descriptor, entry.filename);
        } else if (row !== undefined) {
          fail("file-conflict", "A new referenced file descriptor appeared during custody");
        }
      }
      this.#db.prepare(`
        INSERT INTO pending_file_batches (singleton, batch_digest, manifest_json)
        VALUES (1, ?, ?)
      `).run(prepared.digest, prepared.manifestJson);
      const insertEntry = this.#db.prepare(`
        INSERT INTO pending_file_entries (
          batch_digest, ordinal, digest, byte_length, media_type, purpose,
          created_at, filename, temporary_filename, preexisting
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      entries.forEach((entry, ordinal) => insertEntry.run(
        prepared.digest,
        ordinal,
        entry.descriptor.digest,
        entry.descriptor.byteLength,
        entry.descriptor.mediaType,
        entry.descriptor.purpose,
        entry.descriptor.createdAt,
        entry.filename,
        entry.temporaryFilename,
        entry.preexisting ? 1 : 0,
      ));
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
    const batch = pendingFileBatch(this.#db, this.identity);
    if (batch === null) {
      fail("pending-file-integrity", "Committed pending file custody is unavailable");
    }
    return Object.freeze({ batch, created: true });
  }

  async #writePendingFileCarriers(
    batch: PendingFileBatch,
    prepared: PreparedPendingFileBatch,
  ): Promise<void> {
    const byDigest = new Map(prepared.files.map((file) => [file.descriptor.digest, file]));
    for (const entry of batch.entries) {
      const file = byDigest.get(entry.descriptor.digest);
      if (file === undefined || !sameFileDescriptor(file.descriptor, entry.descriptor)) {
        fail("file-batch-conflict", "File custody retry does not reproduce its exact bytes and descriptor");
      }
      const destination = join(this.paths.files, entry.filename);
      let destinationExists = true;
      try {
        await verifyFileCarrier(destination, entry.descriptor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") destinationExists = false;
        else throw error;
      }
      if (entry.preexisting && !destinationExists) {
        fail("file-integrity", `Preexisting file carrier ${entry.filename} is missing`);
      }
      if (!entry.preexisting && !destinationExists) {
        const temporary = join(this.paths.drafts, entry.temporaryFilename);
        try {
          await verifyPendingTemporary(temporary, entry.descriptor.byteLength);
          await rm(temporary);
          await syncDirectory(this.paths.drafts);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(file.bytes);
          await handle.sync();
        } finally {
          await handle.close().catch(() => undefined);
        }
        await durableRename(temporary, destination);
        await syncDirectory(this.paths.drafts);
        await verifyFileCarrier(destination, entry.descriptor);
      }
    }
  }

  #recordPendingFileDescriptors(batch: PendingFileBatch): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = pendingFileBatch(this.#db, this.identity);
      if (
        current === null ||
        current.digest !== batch.digest ||
        current.manifestJson !== batch.manifestJson
      ) {
        fail("file-batch-conflict", "Pending file custody changed before descriptor retention");
      }
      for (const entry of current.entries) {
        const row = this.#db.prepare(`
          SELECT * FROM referenced_files WHERE digest = ?
        `).get(entry.descriptor.digest) as SqlRow | undefined;
        if (row === undefined) {
          if (entry.preexisting) {
            fail("file-integrity", "A preexisting referenced file descriptor disappeared");
          }
          this.#db.prepare(`
            INSERT INTO referenced_files (
              digest, byte_length, media_type, purpose, created_at, filename
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            entry.descriptor.digest,
            entry.descriptor.byteLength,
            entry.descriptor.mediaType,
            entry.descriptor.purpose,
            entry.descriptor.createdAt,
            entry.filename,
          );
        } else {
          assertExactFileDescriptorRow(row, entry.descriptor, entry.filename);
        }
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  async #cleanPendingFileBatch(
    batch: PendingFileBatch,
    removeNewCarriers: boolean,
  ): Promise<void> {
    const retained = pendingFileBatch(this.#db, this.identity);
    if (retained === null) return;
    if (retained.digest !== batch.digest || retained.manifestJson !== batch.manifestJson) {
      fail("file-batch-conflict", "Pending file custody changed before cleanup");
    }
    const appendState = pendingOperationState(this.#db, this.identity, retained.manifest);
    if (
      (removeNewCarriers && appendState !== "absent") ||
      (!removeNewCarriers && appendState !== "complete")
    ) {
      fail("pending-file-integrity", "Pending file cleanup does not match its exact append disposition");
    }

    let removedDraft = false;
    let removedCarrier = false;
    for (const entry of retained.entries) {
      if (entry.preexisting) continue;
      const temporary = join(this.paths.drafts, entry.temporaryFilename);
      try {
        await verifyPendingTemporary(temporary, entry.descriptor.byteLength);
        await rm(temporary);
        removedDraft = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (removeNewCarriers) {
        const destination = join(this.paths.files, entry.filename);
        try {
          await verifyFileCarrier(destination, entry.descriptor);
          await rm(destination);
          removedCarrier = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    if (removedDraft) await syncDirectory(this.paths.drafts);
    if (removedCarrier) await syncDirectory(this.paths.files);

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = pendingFileBatch(this.#db, this.identity);
      if (current === null) {
        this.#db.exec("COMMIT");
        return;
      }
      if (current.digest !== retained.digest || current.manifestJson !== retained.manifestJson) {
        fail("file-batch-conflict", "Pending file custody changed during cleanup");
      }
      if (removeNewCarriers) {
        for (const entry of current.entries) {
          if (entry.preexisting) continue;
          this.#db.prepare("DELETE FROM referenced_files WHERE digest = ?").run(entry.descriptor.digest);
        }
      }
      this.#db.prepare("DELETE FROM pending_file_entries WHERE batch_digest = ?").run(current.digest);
      this.#db.prepare("DELETE FROM pending_file_batches WHERE singleton = 1").run();
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }

  async appendWithFiles(
    input: ControlRecordStoreAppendWithFiles,
  ): Promise<ControlRecordStoreAppendWithFilesResult> {
    if (this.readOnly) fail("read-only", "Cannot append files to a read-only Control Record Store");
    if (this.getSeal() !== null) fail("sealed", "A sealed Control Record Store cannot append files");
    const prepared = preparePendingFileBatch(this.identity, input);
    const selected = await this.#beginPendingFileBatch(prepared);
    if (selected.created) await input.onStage?.("pending-recorded");
    await this.#writePendingFileCarriers(selected.batch, prepared);
    await input.onStage?.("carrier-durable");
    this.#recordPendingFileDescriptors(selected.batch);
    await input.onStage?.("descriptor-recorded");

    let appends: readonly ControlRecordStoreAppendResult[];
    try {
      appends = this.#runAppendBatchTransaction(prepared.appends, selected.batch);
    } catch (error) {
      if (deterministicAppendFailure(error)) {
        await this.#cleanPendingFileBatch(selected.batch, true);
      }
      throw error;
    }
    await input.onStage?.("append-committed");
    await this.#cleanPendingFileBatch(selected.batch, false);
    await input.onStage?.("pending-cleaned");
    return Object.freeze({
      files: Object.freeze(prepared.files.map(({ descriptor }) => descriptor)),
      appends,
    });
  }

  /**
   * Resolve referenced-file custody, ordered Control appends, and exact
   * operation-support CAS mutations as one recoverable operation. The pending
   * manifest binds all three inputs before any carrier is published; the
   * appends and support mutations then share one SQLite transaction.
   */
  async commitOperationBatchWithFiles(
    input: ControlRecordStoreOperationBatchWithFiles,
  ): Promise<ControlRecordStoreOperationBatchWithFilesResult> {
    if (this.readOnly) fail("read-only", "Cannot commit files to a read-only Control Record Store");
    if (this.getSeal() !== null) fail("sealed", "A sealed Control Record Store cannot accept files");
    if (
      !Array.isArray(input.supportMutations) ||
      input.supportMutations.length < 1 ||
      input.supportMutations.length > MAXIMUM_OPERATION_SUPPORT_ENTRIES
    ) {
      fail(
        "operation-batch-bound",
        `A file operation batch must contain between 1 and ${MAXIMUM_OPERATION_SUPPORT_ENTRIES} support mutations`,
      );
    }
    const prepared = preparePendingFileBatch(this.identity, input);
    const selected = await this.#beginPendingFileBatch(prepared);
    if (selected.created) await input.onStage?.("pending-recorded");
    await this.#writePendingFileCarriers(selected.batch, prepared);
    await input.onStage?.("carrier-durable");
    this.#recordPendingFileDescriptors(selected.batch);
    await input.onStage?.("descriptor-recorded");

    let committed = false;
    let appendResult: AppendTransactionResult;
    let mutationResults: readonly ControlRecordOperationSupportMutationResult[];
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        if (this.getSeal() !== null) {
          fail("sealed", "A sealed Control Record Store cannot accept a file operation batch");
        }
        appendResult = this.#appendBatchInTransaction(prepared.appends, selected.batch);
        if (appendResult.disposition === "appended") {
          for (const mutation of prepared.supportMutations) {
            if (this.#operationSupportPostcondition(mutation)) {
              fail(
                "operation-batch-partial",
                "Operation support already has the requested postcondition while file-bound appends were absent",
              );
            }
            if (mutation.action === "put") this.#putOperationSupportInTransaction(mutation);
            else this.#deleteOperationSupportInTransaction(mutation);
          }
        } else {
          for (const mutation of prepared.supportMutations) {
            if (!this.#operationSupportPostcondition(mutation)) {
              fail(
                "operation-batch-partial",
                "Retained file-bound appends do not have the exact operation-support postcondition",
              );
            }
          }
        }
        mutationResults = Object.freeze(prepared.supportMutations.map((mutation) =>
          this.#operationSupportMutationResult(mutation)));
        this.#db.exec("COMMIT");
        committed = true;
        if (appendResult.replay !== null) this.#replay = appendResult.replay;
      } catch (error) {
        if (!committed) {
          try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
        }
        throw error;
      }
    } catch (error) {
      if (deterministicAppendFailure(error)) {
        await this.#cleanPendingFileBatch(selected.batch, true);
      }
      throw error;
    }
    await input.onStage?.("append-committed");
    await this.#cleanPendingFileBatch(selected.batch, false);
    await input.onStage?.("pending-cleaned");
    return Object.freeze({
      files: Object.freeze(prepared.files.map(({ descriptor }) => descriptor)),
      appends: appendResult!.appends,
      supportMutations: mutationResults!,
    });
  }

  #replaySemanticHistory(requireSealable: boolean): Readonly<{
    count: number;
    headDigest: Sha256 | null;
    replay: IncrementalDeliveryReplay;
  }> {
    const count = expectInteger(
      (this.#db.prepare("SELECT COUNT(*) AS count FROM journal_events").get() as SqlRow).count,
      "Event count",
    );
    if (count > MAXIMUM_JOURNAL_EVENTS) {
      fail("event-limit", "Control Record Store exceeds its Journal event limit");
    }
    const replay = createDeliveryReplay((subject) =>
      this.getRevision(subject.recordId, subject.revision));
    let cursor = 0;
    let expectedPredecessor: Sha256 | null = null;
    while (cursor < count) {
      const page = this.listEvents(cursor, 256);
      if (page.length === 0) {
        fail("event-integrity", "Control record event history ended before its declared count");
      }
      for (const event of page) {
        if (event.sequence !== cursor + 1 || event.predecessorDigest !== expectedPredecessor) {
          fail("event-integrity", "Control record event history contains a gap, fork, or predecessor mismatch");
        }
        assertRetainedEventDescriptor(this.#db, event);
        replay.append(event);
        cursor = event.sequence;
        expectedPredecessor = event.digest;
      }
    }
    if (cursor !== count) {
      fail("event-integrity", "Control record event history count does not match its terminal sequence");
    }
    if (requireSealable) replay.assertSealable();
    else replay.finish();
    return Object.freeze({ count, headDigest: expectedPredecessor, replay });
  }

  async verifyIntegrity(): Promise<ControlRecordStoreIntegrity> {
    await exactDirectory(this.paths.root, "Control Record Store root", false);
    await exactDirectory(this.paths.files, "Control Record Store files directory", false);
    await exactDirectory(this.paths.drafts, "Control Record Store drafts directory", false);
    await exactDatabaseFile(this.paths.database);
    await assertStoreRootEntries(this.paths.root, true, false, this.archiveLayout);
    assertExactDatabaseSchema(this.#db);
    const quickCheck = this.#db.prepare("PRAGMA quick_check").all() as SqlRow[];
    if (
      quickCheck.length !== 1 ||
      !Object.values(quickCheck[0] ?? {}).includes("ok")
    ) {
      fail("database-integrity", "SQLite quick_check did not establish Control Record Store integrity", quickCheck);
    }
    const foreignKeyCheck = this.#db.prepare("PRAGMA foreign_key_check").all() as SqlRow[];
    if (foreignKeyCheck.length > 0) {
      fail(
        "database-integrity",
        "SQLite foreign_key_check found a Control Record Store reference outside its exact retained rows",
        foreignKeyCheck,
      );
    }
    const secureDelete = expectInteger(
      (this.#db.prepare("PRAGMA secure_delete").get() as SqlRow).secure_delete,
      "SQLite secure-delete setting",
    );
    if (secureDelete !== 1) {
      fail(
        "database-integrity",
        "SQLite secure deletion is required for mutable operation support",
      );
    }

    const pending = pendingFileBatch(this.#db, this.identity);
    const pendingState = pending === null
      ? null
      : pendingOperationState(this.#db, this.identity, pending.manifest);

    const operationSupportRows = this.#db.prepare(`
      SELECT
        activity_id, schema_id, store_id, process_id, support_kind, state,
        generation, payload_json, payload_digest,
        deleted_generation, deleted_payload_digest
      FROM operation_support
      ORDER BY activity_id
    `).all() as SqlRow[];
    const liveOperationSupportCount = operationSupportRows.filter((row) =>
      row.state === "live").length;
    if (liveOperationSupportCount > MAXIMUM_OPERATION_SUPPORT_ENTRIES) {
      fail(
        "operation-support-limit",
        "Control Record Store exceeds its live operation-support limit",
      );
    }
    if (operationSupportRows.length > MAXIMUM_JOURNAL_EVENTS) {
      fail(
        "operation-support-limit",
        "Control Record Store exceeds its operation-support disposal limit",
      );
    }
    for (const row of operationSupportRows) {
      operationSupportFromRow(this.identity, row);
    }

    const semanticHistory = this.#replaySemanticHistory(false);
    const { count, headDigest } = semanticHistory;
    const stopRequest = this.getWorkDelegationStopRequest();
    if (stopRequest !== null) {
      const state = semanticHistory.replay.finish();
      const current = state.delegation.current;
      const grant = this.getRevision(stopRequest.delegation.id, stopRequest.delegation.revision);
      if (current === null || current.stopped || state.standing === "closed" || grant === null ||
          canonicalJson(current.reference) !== canonicalJson({ id: stopRequest.delegation.id,
            revision: stopRequest.delegation.revision, digest: stopRequest.delegation.digest }) ||
          grant.recordKind !== "work-delegation" || grant.digest !== stopRequest.delegation.digest ||
          grant.semanticAuthor.kind !== "director" || grant.semanticAuthor.id !== stopRequest.requestedBy ||
          Date.parse(stopRequest.requestedAt) < Date.parse(grant.createdAt) ||
          state.activities.some(activity => activity.stage !== "completed" &&
            (activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship"))) {
        fail("work-stop-integrity", "Pending stop must bind its current unsettled delegation and supplying Director");
      }
    }

    const revisionCount = expectInteger(
      (this.#db.prepare("SELECT COUNT(*) AS count FROM record_revisions").get() as SqlRow).count,
      "Control revision count",
    );
    if (revisionCount > MAXIMUM_CONTROL_REVISIONS) {
      fail("revision-limit", "Control Record Store exceeds its revision limit");
    }
    const recordRevisions = new Map<string, number>();
    const revisionPage = this.#db.prepare(`
      SELECT
        records.process_id,
        records.record_kind,
        revisions.record_id,
        revisions.revision,
        revisions.producer_json,
        revisions.semantic_author_json,
        revisions.semantic_authority,
        revisions.created_at AS revision_created_at,
        revisions.semantic_markdown,
        revisions.payload_json,
        revisions.digest
      FROM record_revisions AS revisions
      INNER JOIN control_records AS records ON records.record_id = revisions.record_id
      ORDER BY revisions.record_id, revisions.revision
      LIMIT 8 OFFSET ?
    `);
    let revisionOffset = 0;
    const reachableFileReferences = new Map<Sha256, RetainedAdjacentFileReference>();
    const candidateCarrierOwners = new Map<Sha256, CandidateCarrierManifestOwner[]>();
    while (revisionOffset < revisionCount) {
      const rows = revisionPage.all(revisionOffset) as SqlRow[];
      if (rows.length === 0) {
        fail("revision-integrity", "Control revision inventory ended before its retained count");
      }
      for (const row of rows) {
        const revision = revisionFromRow(this.#db, row);
        const expectedRevision = (recordRevisions.get(revision.recordId) ?? 0) + 1;
        if (revision.revision !== expectedRevision) {
          fail("revision-integrity", `${revision.recordId} contains a revision gap or duplicate`);
        }
        recordRevisions.set(revision.recordId, revision.revision);
        const retainedFileReferences = assertRevisionPolicyAndTargets(this.#db, revision);
        for (const reference of retainedFileReferences) {
          reachableFileReferences.set(reference.digest, reference);
        }
        const candidateOwner = candidateCarrierManifestOwner(
          revision,
          retainedFileReferences,
        );
        if (candidateOwner !== null) {
          const owners = candidateCarrierOwners.get(candidateOwner.reference.digest) ?? [];
          owners.push(candidateOwner);
          candidateCarrierOwners.set(candidateOwner.reference.digest, owners);
        }
        if (finalizationEventCount(this.#db, revision) !== 1) {
          fail(
            "revision-finalization",
            `${revision.recordKind} ${revision.recordId} revision ${revision.revision} must have exactly one registry finalization event`,
          );
        }
      }
      revisionOffset += rows.length;
    }
    if (revisionOffset !== revisionCount) {
      fail("revision-integrity", "Control revision inventory count changed during integrity verification");
    }

    const fileRows = this.#db.prepare("SELECT * FROM referenced_files ORDER BY digest").all() as SqlRow[];
    const pendingEntries = new Map(
      (pending?.entries ?? []).map((entry) => [entry.descriptor.digest, entry]),
    );
    const retainedFileDigests = new Set(fileRows.map((row) =>
      expectDigest(row.digest, "Referenced file digest")));
    const managedDigests = new Set(retainedFileDigests);
    for (const entry of pending?.entries ?? []) managedDigests.add(entry.descriptor.digest);
    if (managedDigests.size > MAXIMUM_REFERENCED_FILES) {
      fail("file-limit", "Control Record Store exceeds its referenced-file count limit");
    }
    const referencedNames = new Set<string>();
    const presentCarrierDigests = new Set<Sha256>();
    let totalManagedBytes = 0;
    for (const row of fileRows) {
      const descriptor = fileDescriptorFromRow(row, "Referenced file");
      const digest = descriptor.digest;
      const filename = expectString(row.filename, "Referenced file name");
      if (filename !== `sha256-${digest.slice("sha256:".length)}`) {
        fail("file-integrity", "Referenced file name does not reproduce its digest");
      }
      const pendingEntry = pendingEntries.get(digest);
      if (
        pendingEntry !== undefined &&
        (
          !sameFileDescriptor(descriptor, pendingEntry.descriptor) ||
          filename !== pendingEntry.filename
        )
      ) {
        fail("pending-file-integrity", "Pending file custody does not reproduce its descriptor row");
      }
      referencedNames.add(filename);
      const reachable = reachableFileReferences.has(digest);
      const recoverableUnreachable =
        pendingEntry !== undefined &&
        !pendingEntry.preexisting &&
        pendingState === "absent";
      if (!reachable && !recoverableUnreachable) {
        fail(
          "file-orphan",
          `Referenced file descriptor ${digest} is not reachable from one immutable owning Control revision`,
        );
      }
      if (pendingEntry?.preexisting === true && !reachable) {
        fail("pending-file-integrity", "Pending custody labels an unreachable descriptor as preexisting");
      }
      totalManagedBytes += descriptor.byteLength;
      if (totalManagedBytes > MAXIMUM_REFERENCED_FILE_TOTAL_BYTES) {
        fail("file-limit", "Control Record Store exceeds its referenced-file aggregate byte limit");
      }
      try {
        const bytes = await verifyFileCarrier(join(this.paths.files, filename), descriptor);
        const owners = candidateCarrierOwners.get(digest) ?? [];
        if (owners.length > 0) {
          const manifest = parsedCandidateCarrierManifest(owners[0]!, bytes);
          for (const owner of owners) {
            assertCandidateCarrierManifestSubject(owner, manifest);
          }
        }
        presentCarrierDigests.add(digest);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          !recoverableUnreachable
        ) {
          throw error;
        }
      }
    }
    for (const entry of pending?.entries ?? []) {
      if (retainedFileDigests.has(entry.descriptor.digest)) continue;
      if (entry.preexisting || pendingState === "complete") {
        fail("pending-file-integrity", "Pending file custody is missing a required descriptor row");
      }
      referencedNames.add(entry.filename);
      totalManagedBytes += entry.descriptor.byteLength;
      if (totalManagedBytes > MAXIMUM_REFERENCED_FILE_TOTAL_BYTES) {
        fail("file-limit", "Control Record Store exceeds its pending-file aggregate byte limit");
      }
      try {
        await verifyFileCarrier(join(this.paths.files, entry.filename), entry.descriptor);
        presentCarrierDigests.add(entry.descriptor.digest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const name of await readdir(this.paths.files)) {
      if (!FILE_PATTERN.test(name)) {
        fail("file-orphan", `Control Record Store files directory contains unsupported entry ${name}`);
      }
      if (!referencedNames.has(name)) {
        fail("file-orphan", `Control Record Store files directory contains unreferenced content ${name}`);
      }
    }
    const pendingTemporaryNames = new Map(
      (pending?.entries ?? [])
        .filter(({ preexisting }) => !preexisting)
        .map((entry) => [entry.temporaryFilename, entry]),
    );
    for (const name of await readdir(this.paths.drafts)) {
      if (!name.startsWith(PENDING_FILE_PREFIX)) continue;
      const entry = pendingTemporaryNames.get(name);
      if (entry === undefined) {
        fail("pending-file-integrity", `Drafts contains unsupported pending file ${name}`);
      }
      await verifyPendingTemporary(join(this.paths.drafts, name), entry.descriptor.byteLength);
      if (
        pendingState === "complete" ||
        presentCarrierDigests.has(entry.descriptor.digest)
      ) {
        fail(
          "pending-file-integrity",
          `Pending temporary file ${name} conflicts with its durable custody stage`,
        );
      }
    }
    const databaseState = await lstat(this.paths.database, { bigint: true });
    if (databaseState.size + BigInt(totalManagedBytes) > BigInt(MAXIMUM_STORE_ROOT_BYTES)) {
      fail("store-limit", "Control Record Store exceeds its complete-root byte limit");
    }

    const recordCount = expectInteger(
      (this.#db.prepare("SELECT COUNT(*) AS count FROM control_records").get() as SqlRow).count,
      "Control record count",
    );
    if (recordCount > MAXIMUM_CONTROL_RECORDS) {
      fail("record-limit", "Control Record Store exceeds its logical record limit");
    }
    if (recordRevisions.size !== recordCount) {
      fail("revision-integrity", "Every Control record must retain at least one contiguous revision");
    }
    const seal = this.getSeal();
    if (seal !== null) {
      if (stopRequest !== null) fail("seal-work-stop", "A sealed Control Record Store cannot retain a pending stop");
      if (pending !== null) {
        fail("seal-pending-files", "A sealed Control Record Store cannot retain pending file custody");
      }
      if (operationSupportRows.length > 0) {
        fail(
          "seal-operation-support",
          "A sealed Control Record Store cannot retain operation-support rows",
        );
      }
      controlTimestamp(seal.sealedAt, "Control Record Store seal time");
      const closure = this.getRevision(seal.closure.recordId, seal.closure.revision);
      const headRow = this.#db.prepare(`
        SELECT event_kind, subject_record_id, subject_revision, subject_digest, digest
        FROM journal_events WHERE sequence = ?
      `).get(seal.head.sequence) as SqlRow | undefined;
      if (
        closure === null ||
        closure.recordKind !== "closure" ||
        closure.digest !== seal.closure.digest ||
        seal.head.sequence !== count ||
        headRow === undefined ||
        expectString(headRow.event_kind, "Sealed Journal head kind") !==
          deliveryControlRecordPolicy("closure").finalizationEvent ||
        expectString(headRow.subject_record_id, "Sealed Journal head subject identity") !== closure.recordId ||
        expectInteger(headRow.subject_revision, "Sealed Journal head subject revision") !== closure.revision ||
        expectDigest(headRow.subject_digest, "Sealed Journal head subject digest") !== closure.digest ||
        expectDigest(headRow.digest, "Sealed Journal head digest") !== seal.head.digest
      ) {
        fail("seal-integrity", "Store seal does not bind the exact Closure Journal head");
      }
      if (this.logicalInventoryDigest() !== seal.logicalInventoryDigest) {
        fail("seal-integrity", "Store seal does not bind the exact logical inventory");
      }
      this.#replaySemanticHistory(true);
      await exactDirectory(this.paths.drafts, "Control Record Store drafts directory", false);
      const draftEntries = await readdir(this.paths.drafts);
      if (draftEntries.length > 0) {
        fail("seal-drafts", "A sealed Control Record Store cannot retain governed authoring workspaces", draftEntries);
      }
    }
    const integrity = Object.freeze({
      integrity: "ok",
      eventCount: count,
      recordCount,
      revisionCount,
      referencedFileCount: semanticReferencedFileRows(this.#db, this.identity).length,
      headDigest,
    });
    this.#replay = semanticHistory.replay;
    return integrity;
  }

  checkpoint(): void {
    if (this.readOnly) return;
    this.#db.exec("PRAGMA optimize");
  }

  /**
   * Return the current Delivery truth derived from the already verified event
   * chain. The value is an ephemeral replay result; no mutable state row is
   * retained in SQLite.
   */
  state(): ReducedDeliveryState {
    return this.#replay.finish();
  }

  getSeal(): ControlRecordStoreSeal | null {
    const row = this.#db.prepare("SELECT * FROM store_seal WHERE singleton = 1").get() as SqlRow | undefined;
    if (row === undefined) return null;
    return Object.freeze({
      schema: CONTROL_RECORD_STORE_SEAL_SCHEMA,
      closure: Object.freeze({
        recordId: expectString(row.closure_record_id, "Store seal Closure identity"),
        revision: expectInteger(row.closure_revision, "Store seal Closure revision"),
        digest: expectDigest(row.closure_digest, "Store seal Closure digest"),
      }),
      head: Object.freeze({
        sequence: expectInteger(row.head_sequence, "Store seal Journal head sequence"),
        digest: expectDigest(row.head_digest, "Store seal Journal head digest"),
      }),
      logicalInventoryDigest: expectDigest(row.logical_inventory_digest, "Store seal logical inventory digest"),
      sealedAt: expectString(row.sealed_at, "Store seal time"),
    });
  }

  listRetainedFiles(): readonly ControlRecordFile[] {
    const rows = semanticReferencedFileRows(this.#db, this.identity);
    if (rows.length > MAXIMUM_REFERENCED_FILES) {
      fail("file-limit", "Control Record Store exceeds its referenced-file count limit");
    }
    return Object.freeze(rows.map((row) => fileDescriptorFromRow(row, "Referenced file")));
  }

  /**
   * Reopen one exact immutable adjacent file already selected by retained
   * Control. The physical Store coordinate remains private to this owner.
   */
  async readRetainedFile(
    digest: Sha256,
  ): Promise<Readonly<{ descriptor: ControlRecordFile; bytes: Uint8Array }> | null> {
    const descriptor = this.listRetainedFiles().find((file) => file.digest === digest);
    if (descriptor === undefined) return null;
    const filename = `sha256-${descriptor.digest.slice("sha256:".length)}`;
    const bytes = await verifyFileCarrier(join(this.paths.files, filename), descriptor);
    return Object.freeze({
      descriptor,
      bytes: Uint8Array.from(bytes),
    });
  }

  logicalInventoryDigest(): Sha256 {
    const events = (this.#db.prepare(`
      SELECT sequence, event_id, event_kind, digest
      FROM journal_events ORDER BY sequence
    `).all() as SqlRow[]).map((row) => Object.freeze({
      sequence: expectInteger(row.sequence, "Logical inventory event sequence"),
      eventId: expectString(row.event_id, "Logical inventory event identity"),
      eventKind: expectString(row.event_kind, "Logical inventory event kind"),
      digest: expectDigest(row.digest, "Logical inventory event digest"),
    }));
    const revisions = (this.#db.prepare(`
      SELECT records.record_id, records.record_kind, revisions.revision, revisions.digest
      FROM control_records AS records
      INNER JOIN record_revisions AS revisions ON revisions.record_id = records.record_id
      ORDER BY records.record_id, revisions.revision
    `).all() as SqlRow[]).map((row) => Object.freeze({
      recordId: expectString(row.record_id, "Logical inventory record identity"),
      recordKind: expectString(row.record_kind, "Logical inventory record kind"),
      revision: expectInteger(row.revision, "Logical inventory record revision"),
      digest: expectDigest(row.digest, "Logical inventory record digest"),
    }));
    const files = semanticReferencedFileRows(this.#db, this.identity).map((row) => Object.freeze({
      digest: expectDigest(row.digest, "Logical inventory file digest"),
      byteLength: expectInteger(row.byte_length, "Logical inventory file byte length"),
      mediaType: expectString(row.media_type, "Logical inventory file media type"),
      purpose: expectString(row.purpose, "Logical inventory file purpose"),
    }));
    return sha256Bytes(canonicalJson(Object.freeze({
      schema: "lifecycle.control-record-store-logical-inventory.v1",
      store: this.identity,
      events: Object.freeze(events),
      revisions: Object.freeze(revisions),
      files: Object.freeze(files),
    })));
  }

  async seal(input: Readonly<{
    closure: Readonly<{ recordId: string; revision: number; digest: Sha256 }>;
    sealedAt: string;
  }>): Promise<ControlRecordStoreSeal> {
    if (this.readOnly) fail("read-only", "Cannot seal a read-only Control Record Store");
    if (this.getWorkDelegationStopRequest() !== null) {
      fail("seal-work-stop", "Control Record Store cannot seal while a work delegation stop is pending");
    }
    if (pendingFileBatch(this.#db, this.identity) !== null) {
      fail("seal-pending-files", "Control Record Store cannot seal while file custody is pending");
    }
    if (
      expectInteger(
        (this.#db.prepare(`
          SELECT COUNT(*) AS count FROM operation_support WHERE state = 'live'
        `).get() as SqlRow).count,
        "Live operation support count",
      ) !== 0
    ) {
      fail(
        "seal-operation-support",
        "Control Record Store cannot seal while operation support remains live",
      );
    }
    await exactDirectory(this.paths.drafts, "Control Record Store drafts directory", false);
    const draftEntries = await readdir(this.paths.drafts);
    if (draftEntries.length > 0) {
      fail("seal-drafts", "Control Record Store cannot seal while governed authoring workspaces remain", draftEntries);
    }
    await this.verifyIntegrity();
    const existing = this.getSeal();
    if (existing !== null) {
      if (
        existing.closure.recordId !== input.closure.recordId ||
        existing.closure.revision !== input.closure.revision ||
        existing.closure.digest !== input.closure.digest ||
        existing.sealedAt !== input.sealedAt
      ) {
        fail("seal-conflict", "Control Record Store is already sealed for a different exact subject");
      }
      return existing;
    }
    controlTimestamp(input.sealedAt, "Control Record Store seal time");
    const closure = this.getRevision(input.closure.recordId, input.closure.revision);
    if (
      closure === null ||
      closure.recordKind !== "closure" ||
      closure.digest !== input.closure.digest
    ) {
      fail("seal-subject", "Control Record Store seal requires one exact retained Closure revision");
    }
    this.#replaySemanticHistory(true);

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM operation_support WHERE state = 'deleted'").run();
      const headRow = this.#db.prepare(`
        SELECT sequence, event_kind, subject_record_id, subject_revision, subject_digest, digest
        FROM journal_events ORDER BY sequence DESC LIMIT 1
      `).get() as SqlRow | undefined;
      if (
        headRow === undefined ||
        expectString(headRow.event_kind, "Journal head event kind") !==
          deliveryControlRecordPolicy("closure").finalizationEvent ||
        expectString(headRow.subject_record_id, "Journal head subject identity") !== closure.recordId ||
        expectInteger(headRow.subject_revision, "Journal head subject revision") !== closure.revision ||
        expectDigest(headRow.subject_digest, "Journal head subject digest") !== closure.digest
      ) {
        fail("seal-subject", "Closure must be the exact subject of the current Journal head");
      }
      const logicalInventoryDigest = this.logicalInventoryDigest();
      const seal: ControlRecordStoreSeal = Object.freeze({
        schema: CONTROL_RECORD_STORE_SEAL_SCHEMA,
        closure: Object.freeze({
          recordId: closure.recordId,
          revision: closure.revision,
          digest: closure.digest,
        }),
        head: Object.freeze({
          sequence: expectInteger(headRow.sequence, "Journal head sequence"),
          digest: expectDigest(headRow.digest, "Journal head digest"),
        }),
        logicalInventoryDigest,
        sealedAt: input.sealedAt,
      });
      this.#db.prepare(`
        INSERT INTO store_seal (
          singleton, closure_record_id, closure_revision, closure_digest,
          head_sequence, head_digest, logical_inventory_digest, sealed_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seal.closure.recordId,
        seal.closure.revision,
        seal.closure.digest,
        seal.head.sequence,
        seal.head.digest,
        seal.logicalInventoryDigest,
        seal.sealedAt,
      );
      this.#db.exec("COMMIT");
      this.checkpoint();
      return seal;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original error owns the refusal */ }
      throw error;
    }
  }
}

export async function openControlRecordStore(
  options: ControlRecordStoreOpenOptions,
): Promise<ControlRecordStore> {
  return ControlRecordStore.open(options);
}

export function controlRecordStorePaths(root: string): ControlRecordStorePaths {
  return paths(root);
}
