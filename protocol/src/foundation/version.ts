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

/** Exact installed contract identity emitted by the installed Foundation CLI. */
export const FOUNDATION_RUNTIME_VERSION_EXPECTATION = Object.freeze({
  runtimeVersion: "1.0.0" as const,
  runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
  specificationId: "lifecycle" as const,
  specificationRevision: "lifecycle.foundation.1.0.0-rc.17" as const,
  specificationStatus: "draft" as const,
  authenticatedPublicationStatus: null,
  provider: Object.freeze({
    defaultDescriptorId: "codex-exec-standard-v7" as const,
    protocol: "lifecycle.provider-adapter.v7" as const,
  }),
  codex: Object.freeze({
    executableRange: ">=0.153.4 <0.154.0" as const,
    generatedWith: "0.153.4" as const,
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

const FoundationAuthorizationUnavailableFactsSchema = z.object({
  invocationId: z.string().length(36).regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u),
  authorizationSubmission: z.literal("may-have-started"),
}).strict();

export const FoundationCliErrorValueSchema = z.object({
  code: FoundationOpaqueIdSchema,
  message: z.string().min(1).max(65_536),
  retryable: z.boolean(),
  repositoryChanged: z.boolean().nullable(),
  operationalStateChanged: z.boolean().nullable(),
  recoveryActions: z.array(z.object({
    action: z.string().min(1).max(512),
    detail: z.string().min(1).max(65_536),
  }).strict()).max(128),
  observedFacts: FoundationJsonValueSchema.optional(),
  diagnostics: z.array(FoundationJsonObjectSchema).max(100_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.code === "runtime.authorization-result-unavailable") {
    if (value.repositoryChanged !== null || value.operationalStateChanged !== null ||
        value.retryable !== false || value.recoveryActions.length !== 0 ||
        value.diagnostics !== undefined || !FoundationAuthorizationUnavailableFactsSchema.safeParse(value.observedFacts).success) {
      context.addIssue({ code: "custom", message: "Unobserved authorization requires unknown effects and exact bounded observation facts" });
    }
  } else if (value.repositoryChanged === null || value.operationalStateChanged === null) {
    context.addIssue({ code: "custom", message: "Only an unobserved authorization result may report unknown change facts" });
  }
});

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
