import type { Sha256 } from "../validation/canonical.js";

export const CONTROL_RECORD_STORE_SCHEMA = "lifecycle.control-record-store.v1" as const;
export const CONTROL_RECORD_REVISION_SCHEMA = "lifecycle.control-record-revision.v1" as const;
export const CONTROL_RECORD_EVENT_SCHEMA = "lifecycle.control-record-event.v2" as const;
export const CONTROL_RECORD_FILE_SCHEMA = "lifecycle.control-record-file.v1" as const;
export const CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA =
  "lifecycle.control-record-operation-support.v1" as const;
export const CONTROL_RECORD_STORE_SEAL_SCHEMA = "lifecycle.control-record-store-seal.v1" as const;
export const CONTROL_RECORD_STORE_ARCHIVE_SCHEMA = "lifecycle.control-record-store-archive.v1" as const;
export const CONTROL_RECORD_FILE_CUSTODY_STAGES = Object.freeze([
  "pending-recorded",
  "carrier-durable",
  "descriptor-recorded",
  "append-committed",
  "pending-cleaned",
] as const);
export const CONTROL_RECORD_OPERATION_BATCH_STAGES = Object.freeze([
  "appends-resolved",
  "support-resolved",
  "committed",
] as const);

export type ControlJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ControlJsonValue[]
  | Readonly<{ [key: string]: ControlJsonValue }>;

export type ControlJsonObject = Readonly<{ [key: string]: ControlJsonValue }>;

export type ControlActorKind = "agent" | "founder" | "runtime";

export type ControlActor = Readonly<{
  kind: ControlActorKind;
  id: string;
}>;

export type ControlSemanticAuthority =
  | "agent-proposed"
  | "founder-supplied"
  | "founder-authenticated"
  | "runtime-observed"
  | "runtime-derived";

export type ControlRecordRelationshipTarget = Readonly<{
  kind: string;
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type ControlRecordRelationship = Readonly<{
  relation: string;
  target: ControlRecordRelationshipTarget;
}>;

export type ControlRecordRevisionInput = Readonly<{
  recordId: string;
  recordKind: string;
  revision: number;
  producer: ControlActor;
  semanticAuthor: ControlActor;
  semanticAuthority: ControlSemanticAuthority;
  createdAt: string;
  semanticMarkdown: string;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>;

export type ControlRecordRevision = Readonly<{
  schema: typeof CONTROL_RECORD_REVISION_SCHEMA;
  processId: string;
  recordId: string;
  recordKind: string;
  revision: number;
  producer: ControlActor;
  semanticAuthor: ControlActor;
  semanticAuthority: ControlSemanticAuthority;
  createdAt: string;
  semanticMarkdown: string;
  payload: ControlJsonObject;
  relationships: readonly ControlRecordRelationship[];
  digest: Sha256;
}>;

export type ControlRecordEventSubject = Readonly<{
  recordId: string;
  revision: number;
  digest: Sha256;
}>;

export type ControlRecordEventInput = Readonly<{
  eventId: string;
  eventKind: string;
  occurredAt: string;
  actor: ControlActor;
  subject?: ControlRecordEventSubject | null;
  payload: ControlJsonObject;
}>;

export type ControlRecordEvent = Readonly<{
  schema: typeof CONTROL_RECORD_EVENT_SCHEMA;
  storeId: string;
  processId: string;
  sequence: number;
  eventId: string;
  eventKind: string;
  occurredAt: string;
  actor: ControlActor;
  subject: ControlRecordEventSubject | null;
  payload: ControlJsonObject;
  predecessorDigest: Sha256 | null;
  digest: Sha256;
}>;

export type ControlRecordFileInput = Readonly<{
  bytes: Uint8Array;
  mediaType: string;
  purpose: string;
  createdAt: string;
}>;

export type ControlRecordFile = Readonly<{
  schema: typeof CONTROL_RECORD_FILE_SCHEMA;
  digest: Sha256;
  byteLength: number;
  mediaType: string;
  purpose: string;
  createdAt: string;
}>;

export type ControlRecordStoreIdentity = Readonly<{
  schema: typeof CONTROL_RECORD_STORE_SCHEMA;
  storeId: string;
  targetId: string;
  processKind: "delivery";
  processId: string;
  createdAt: string;
}>;

export type ControlRecordStorePaths = Readonly<{
  root: string;
  database: string;
  files: string;
  drafts: string;
}>;

export type ControlRecordStoreOpenOptions = Readonly<{
  root: string;
  identity: ControlRecordStoreIdentity;
  create: boolean;
  readOnly?: boolean;
  archiveLayout?: boolean;
}>;

export type ControlRecordStoreAppend = Readonly<{
  revision?: ControlRecordRevisionInput;
  event: ControlRecordEventInput;
}>;

export type ControlRecordStoreAppendResult = Readonly<{
  revision: ControlRecordRevision | null;
  event: ControlRecordEvent;
}>;

export type ControlRecordFileCustodyStage =
  typeof CONTROL_RECORD_FILE_CUSTODY_STAGES[number];

export type ControlRecordStoreAppendWithFiles = Readonly<{
  files: readonly ControlRecordFileInput[];
  appends: readonly ControlRecordStoreAppend[];
  onStage?: (stage: ControlRecordFileCustodyStage) => void | Promise<void>;
}>;

export type ControlRecordStoreAppendWithFilesResult = Readonly<{
  files: readonly ControlRecordFile[];
  appends: readonly ControlRecordStoreAppendResult[];
}>;

export type ControlRecordOperationSupportCoordinate = Readonly<{
  generation: number;
  payloadDigest: Sha256;
}>;

/**
 * Mutable runtime recovery support for one exact Delivery activity. This is
 * not a Control record, Journal event, or logical-inventory member.
 */
export type ControlRecordOperationSupport = Readonly<{
  schema: typeof CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA;
  storeId: string;
  processId: string;
  activityId: string;
  supportKind: string;
  generation: number;
  payload: ControlJsonObject;
  payloadDigest: Sha256;
}>;

export type ControlRecordOperationSupportPut = Readonly<{
  activityId: string;
  supportKind: string;
  payload: ControlJsonObject;
  expected: ControlRecordOperationSupportCoordinate | null;
}>;

export type ControlRecordOperationSupportMutation =
  | Readonly<{
      action: "put";
      value: ControlRecordOperationSupportPut;
    }>
  | Readonly<{
      action: "delete";
      activityId: string;
      expected: ControlRecordOperationSupportCoordinate;
    }>;

export type ControlRecordOperationBatchStage =
  typeof CONTROL_RECORD_OPERATION_BATCH_STAGES[number];

export type ControlRecordStoreOperationBatch = Readonly<{
  supportMutations: readonly ControlRecordOperationSupportMutation[];
  appends: readonly ControlRecordStoreAppend[];
  onStage?: (stage: ControlRecordOperationBatchStage) => void;
}>;

export type ControlRecordOperationSupportMutationResult = Readonly<{
  action: "put" | "delete";
  activityId: string;
  support: ControlRecordOperationSupport | null;
}>;

export type ControlRecordStoreOperationBatchResult = Readonly<{
  supportMutations: readonly ControlRecordOperationSupportMutationResult[];
  appends: readonly ControlRecordStoreAppendResult[];
}>;

/**
 * One crash-recoverable custody transaction whose retry identity binds the
 * referenced file bytes, ordered Control appends, and exact operation-support
 * compare-and-swap mutations. The asynchronous boundary exists only for file
 * durability; the appends and support mutations still share one SQLite commit.
 */
export type ControlRecordStoreOperationBatchWithFiles = Readonly<{
  files: readonly ControlRecordFileInput[];
  appends: readonly ControlRecordStoreAppend[];
  supportMutations: readonly ControlRecordOperationSupportMutation[];
  onStage?: (stage: ControlRecordFileCustodyStage) => void | Promise<void>;
}>;

export type ControlRecordStoreOperationBatchWithFilesResult = Readonly<{
  files: readonly ControlRecordFile[];
  appends: readonly ControlRecordStoreAppendResult[];
  supportMutations: readonly ControlRecordOperationSupportMutationResult[];
}>;

export type ControlRecordStoreIntegrity = Readonly<{
  integrity: "ok";
  eventCount: number;
  recordCount: number;
  revisionCount: number;
  referencedFileCount: number;
  headDigest: Sha256 | null;
}>;

export type ControlRecordStoreSeal = Readonly<{
  schema: typeof CONTROL_RECORD_STORE_SEAL_SCHEMA;
  closure: ControlRecordEventSubject;
  head: Readonly<{
    sequence: number;
    digest: Sha256;
  }>;
  logicalInventoryDigest: Sha256;
  sealedAt: string;
}>;

export type ControlRecordStoreArchiveManifest = Readonly<{
  schema: typeof CONTROL_RECORD_STORE_ARCHIVE_SCHEMA;
  store: ControlRecordStoreIdentity;
  seal: ControlRecordStoreSeal;
  database: Readonly<{
    filename: "control-record-store.sqlite";
    byteLength: number;
    retrievalDigest: Sha256;
  }>;
  files: readonly Readonly<{
    filename: string;
    reference: Readonly<{
      digest: Sha256;
      byteLength: number;
      mediaType: string;
      purpose: string;
    }>;
  }>[];
  archivedAt: string;
}>;
