import type { Sha256 } from "../validation/canonical.js";

export type FoundationAtlasSelection = Readonly<{
  release: "0.8.0";
  specificationRevision: "2c7a78540ac30138218b12803f1c045cee8b109a";
  authoredFormat: 1;
  processorRevision: "2c7a78540ac30138218b12803f1c045cee8b109a";
  validationProfile: "neutral.atlas-validator.resolved";
  validationResultSchema: "urn:atlas:schema:validation-result:1";
  normalizedModelSchema: "urn:atlas:schema:normalized:1";
  consumerProfile: "lifecycle.atlas-consumer.v2";
}>;

export type FoundationAtlasDiagnostic = Readonly<{
  code: string;
  severity: "error" | "warning" | "information";
  message: string;
  path?: string;
  pointer?: string;
  line?: number;
  column?: number;
  details?: unknown;
}>;

export type FoundationAtlasValidationResult = Readonly<{
  profile: FoundationAtlasSelection["validationProfile"];
  complete: boolean;
  valid: boolean;
  specificationRevision: FoundationAtlasSelection["specificationRevision"];
  implementation: Readonly<{
    name: "atlas-reference-validator";
    version: "0.8.0";
    status: "stable";
  }>;
  diagnostics: readonly FoundationAtlasDiagnostic[];
  normalized?: FoundationAtlasNormalizedModel;
}>;

export type FoundationAtlasResource = Readonly<{
  id: string;
  uri: string;
  title: string;
  summary?: string;
  "media-type"?: string;
}>;

export type FoundationAtlasContentTarget = Readonly<{
  resource?: string;
  uri?: string;
  selector?: string;
  label?: string;
}>;

export type FoundationAtlasReference = FoundationAtlasContentTarget & Readonly<{
  role: "evidence" | "supporting" | "implementation" | "historical" | "example";
  note?: string;
}>;

export type FoundationAtlasAreaMembership = Readonly<{
  area: string;
  context: string;
}>;

export type FoundationAtlasPointRecord = Readonly<{
  kind: "anchor" | "context";
  map: string;
  path: string;
  summary: string;
  areas: readonly FoundationAtlasAreaMembership[];
  content: readonly FoundationAtlasContentTarget[];
  references: readonly FoundationAtlasReference[];
  extensions: Readonly<Record<string, unknown>>;
  body: string;
}>;

export type FoundationAtlasRelation = Readonly<{
  sourcePoint: string;
  sourceMap: string;
  sourcePath: string;
  type: string;
  targetPoint: string;
  note: string;
  extensions: Readonly<Record<string, unknown>>;
}>;

export type FoundationAtlasPoint = Readonly<{
  id: string;
  title: string;
  summary: string;
  kinds: readonly string[];
  posture: "asserted" | "open" | "proposed" | "intended";
  lifecycle: "active" | "historical" | "superseded" | "withdrawn";
  primaryMap: string;
  anchorPath: string;
  records: readonly FoundationAtlasPointRecord[];
  relations: readonly FoundationAtlasRelation[];
  incomingRelations: readonly FoundationAtlasRelation[];
  review: unknown | null;
  extensions: Readonly<Record<string, unknown>>;
}>;

export type FoundationAtlasMap = Readonly<{
  id: string;
  title: string;
  summary: string;
  question: string;
  status: "draft" | "active" | "archived";
  path: string;
  areas: readonly Readonly<{
    id: string;
    title: string;
    summary: string;
    question: string;
    content?: readonly FoundationAtlasContentTarget[];
    references?: readonly FoundationAtlasReference[];
  }>[];
  content: readonly FoundationAtlasContentTarget[];
  references: readonly FoundationAtlasReference[];
  extensions: Readonly<Record<string, unknown>>;
  body: string;
  pointIds: readonly string[];
  anchorPointIds: readonly string[];
  contextPointIds: readonly string[];
}>;

export type FoundationAtlasCheck = Readonly<{
  id: string;
  title: string;
  summary: string;
  status: "draft" | "active" | "retired";
  level: "required" | "advisory";
  appliesTo: readonly string[];
  path: string;
  extensions: Readonly<Record<string, unknown>>;
  body: string;
}>;

export type FoundationAtlasPublicationProfile = Readonly<{
  id: string;
  title: string;
  summary: string;
  path: string;
  selection: Readonly<{
    atlas: boolean;
    maps: readonly string[];
    points: readonly Readonly<{
      id: string;
      records: readonly Readonly<{ map: string; kind: "anchor" | "context"; path: string }>[];
    }>[];
    resources: readonly string[];
    checks: readonly string[];
  }>;
  extensions: Readonly<Record<string, unknown>>;
  body: string;
}>;

export type FoundationAtlasNormalizedModel = Readonly<{
  format: 1;
  atlas: Readonly<{
    id: string;
    title: string;
    summary: string;
    navigation: readonly Readonly<{ title: string; maps: readonly string[] }>[];
    resources: readonly FoundationAtlasResource[];
    content: readonly FoundationAtlasContentTarget[];
    references: readonly FoundationAtlasReference[];
    extensions: Readonly<Record<string, unknown>>;
    body: string;
  }>;
  maps: readonly FoundationAtlasMap[];
  points: readonly FoundationAtlasPoint[];
  checks: readonly FoundationAtlasCheck[];
  publicationProfiles: readonly FoundationAtlasPublicationProfile[];
  relatedMaps: readonly Readonly<{ maps: readonly [string, string]; pointIds: readonly string[] }>[];
}>;

export type FoundationAtlasResourceBinding = Readonly<{
  resourceId: string;
  uri: string;
  path: string | null;
  mode: "100644" | null;
  objectId: string | null;
  byteDigest: Sha256 | null;
  disposition: "resolved" | "retrieval-denied" | "missing" | "unreadable" | "path-invalid";
}>;

export type FoundationAtlasResolution = Readonly<{
  schema: "lifecycle.atlas-resolution.v2";
  selection: FoundationAtlasSelection;
  atlasStateDigest: Sha256;
  resourceBindings: readonly FoundationAtlasResourceBinding[];
  resourceBindingsDigest: Sha256;
  processor: Readonly<{
    id: "atlas-reference-validator";
    version: "0.8.0";
    implementationDigest: Sha256;
  }>;
  externalValidationResultDigest: Sha256;
  normalizedModelDigest: Sha256;
  complete: true;
  valid: true;
  digest: Sha256;
}>;

export type FoundationResolvedAtlas = Readonly<{
  resolution: FoundationAtlasResolution;
  validationResult: FoundationAtlasValidationResult;
  model: FoundationAtlasNormalizedModel;
}>;
