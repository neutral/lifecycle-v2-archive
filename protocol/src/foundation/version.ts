import { z } from "zod/v4";
import {
  parseFoundationStrictJson,
  type FoundationStrictJsonLimits,
} from "../strict-json.js";
import {
  FOUNDATION_RUNTIME_PROTOCOL,
  FoundationJsonObjectSchema,
  FoundationJsonValueSchema,
  FoundationOpaqueIdSchema,
  FoundationSha256Schema,
} from "./core.js";
import { protocolParse } from "./internal.js";

/** Exact compatibility identity emitted by the installed Foundation CLI. */
export const FOUNDATION_RUNTIME_VERSION_EXPECTATION = Object.freeze({
  runtimeVersion: "1.0.0" as const,
  runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
  specificationId: "lifecycle" as const,
  specificationRevision: "lifecycle.foundation.1.0.0-rc.10" as const,
  specificationStatus: "draft" as const,
  authenticatedPublicationStatus: null,
  provider: Object.freeze({
    defaultDescriptorId: "codex-exec-standard-v6" as const,
    protocol: "lifecycle.provider-adapter.v6" as const,
  }),
  codex: Object.freeze({
    executableRange: ">=0.151.0 <0.152.0" as const,
    generatedWith: "0.151.0" as const,
    protocol: "exec-jsonl-v1" as const,
  }),
});

export const FoundationRuntimeVersionSchema = z.object({
  runtimeVersion: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.runtimeVersion),
  runtimeProtocol: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.runtimeProtocol),
  specificationId: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.specificationId),
  specificationRevision: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.specificationRevision),
  specificationStatus: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.specificationStatus),
  publicationDigest: FoundationSha256Schema,
  authenticatedPublicationStatus: z.null(),
  provider: z.object({
    defaultDescriptorId: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.provider.defaultDescriptorId),
    defaultDescriptorDigest: FoundationSha256Schema,
    protocol: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.provider.protocol),
  }).strict(),
  codex: z.object({
    executableRange: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.codex.executableRange),
    generatedWith: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.codex.generatedWith),
    protocol: z.literal(FOUNDATION_RUNTIME_VERSION_EXPECTATION.codex.protocol),
  }).strict(),
}).strict();

export type FoundationRuntimeVersion = z.output<typeof FoundationRuntimeVersionSchema>;

export function parseFoundationRuntimeVersion(value: unknown): FoundationRuntimeVersion {
  return protocolParse(
    FoundationRuntimeVersionSchema,
    value,
    "lifecycle.interface.version-invalid",
    "Lifecycle executable version",
  );
}

export function parseFoundationRuntimeVersionJson(
  input: string | Uint8Array,
  limits: FoundationStrictJsonLimits = {},
): FoundationRuntimeVersion {
  return parseFoundationRuntimeVersion(parseFoundationStrictJson(input, {
    ...limits,
    maximumBytes: limits.maximumBytes ?? 64 * 1024,
    source: limits.source ?? "Lifecycle executable version JSON",
  }));
}

export const FoundationCliErrorValueSchema = z.object({
  code: FoundationOpaqueIdSchema,
  message: z.string().min(1).max(65_536),
  retryable: z.boolean(),
  repositoryChanged: z.boolean(),
  operationalStateChanged: z.boolean(),
  recoveryActions: z.array(z.object({
    action: z.string().min(1).max(512),
    detail: z.string().min(1).max(65_536),
  }).strict()).max(128),
  observedFacts: FoundationJsonValueSchema.optional(),
  diagnostics: z.array(FoundationJsonObjectSchema).max(100_000).optional(),
}).strict();

export const FoundationCliErrorSchema = z.object({ error: FoundationCliErrorValueSchema }).strict();
export type FoundationCliError = z.output<typeof FoundationCliErrorValueSchema>;

export function parseFoundationCliError(value: unknown): FoundationCliError {
  return protocolParse(
    FoundationCliErrorSchema,
    value,
    "lifecycle.interface.error-invalid",
    "Lifecycle CLI error",
  ).error;
}

export function parseFoundationCliErrorJson(
  input: string | Uint8Array,
  limits: FoundationStrictJsonLimits = {},
): FoundationCliError {
  return parseFoundationCliError(parseFoundationStrictJson(input, {
    ...limits,
    maximumBytes: limits.maximumBytes ?? 1024 * 1024,
    source: limits.source ?? "Lifecycle CLI error JSON",
  }));
}
