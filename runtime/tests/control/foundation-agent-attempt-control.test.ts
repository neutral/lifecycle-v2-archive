import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retainAgentAttempt } from "../../src/foundation/control/agent-attempt.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { openControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const RUNTIME = "foundation-runtime";
const CREATED = "2026-08-29T15:00:00.000Z";

function identity(): ControlRecordStoreIdentity {
  return Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-attempt",
    targetId: "target-attempt",
    processKind: "delivery",
    processId: "delivery-attempt",
    createdAt: CREATED,
  });
}

test("runtime compiles one exact provider-neutral Agent Attempt and event", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-agent-attempt-control-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const store = await openControlRecordStore({ root, identity: identity(), create: true });
  context.after(() => store.close());
  store.append({
    event: {
      eventId: "event-created",
      eventKind: "delivery-created",
      occurredAt: CREATED,
      actor: { kind: "runtime", id: RUNTIME },
      payload: {},
    },
  });
  const briefInput = {
    recordId: "brief-attempt",
    recordKind: "director-brief",
    revision: 1,
    producer: { kind: "runtime" as const, id: RUNTIME },
    semanticAuthor: { kind: "director" as const, id: "director" },
    semanticAuthority: "director-supplied" as const,
    createdAt: "2026-08-29T15:00:01.000Z",
    semanticMarkdown: "# Director Brief\n\nPrepare the exact boundary.\n",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: "prepare-attempt" } },
    relationships: [],
  };
  const compiledBrief = compileControlRecordRevision(store.identity.processId, briefInput);
  const brief = store.append({
    revision: briefInput,
    event: {
      eventId: "event-brief",
      eventKind: "director-brief-submitted",
      occurredAt: briefInput.createdAt,
      actor: { kind: "runtime", id: RUNTIME },
      subject: {
        recordId: compiledBrief.recordId,
        revision: compiledBrief.revision,
        digest: compiledBrief.digest,
      },
      payload: { activityId: "prepare-attempt" },
    },
  }).revision!;
  store.append({
    event: {
      eventId: "event-activity",
      eventKind: "activity-started",
      occurredAt: "2026-08-29T15:00:02.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      payload: { activityId: "prepare-attempt", operation: "delivery.prepare" },
    },
  });

  const digest = (value: string) => sha256Bytes(value);
  const execution = Object.freeze({
    backendProfile: Object.freeze({
      profileId: "lifecycle.execution-backend-profile.fault-injection.v1" as const,
      profileDigest: digest("execution-backend-profile"),
      implementationDigest: digest("execution-backend-implementation"),
    }),
    image: Object.freeze({
      imageId: "lifecycle.execution-image.test.v1",
      imageDigest: digest("execution-image"),
    }),
    inputSet: Object.freeze({
      profileId: "lifecycle.execution-input-set.v2" as const,
      digest: digest("execution-input-set"),
    }),
  });
  const executionPolicy = Object.freeze({
    cancellationPolicyDigest: digest("cancellation-policy"),
    containmentPolicyDigest: digest("containment-policy"),
    parentLossPolicyDigest: digest("parent-loss-policy"),
    retirementPolicyDigest: digest("retirement-policy"),
    recoveryPolicyDigest: digest("recovery-policy"),
  });
  const expectedPreDispatchStateDigest = digestCanonical(store.state());
  const retained = retainAgentAttempt({
    store,
    activityId: "prepare-attempt",
    operation: "delivery.prepare",
    role: "reconnaissance",
    createdAt: "2026-08-29T15:00:03.000Z",
    runtimeId: RUNTIME,
    projection: {
      id: "projection-one",
      profileId: "orientation-standard-v1",
      digest: digest("projection"),
    },
    roleSubject: { objectiveDigest: digest("objective") },
    capability: {
      profileId: "local-development-v1",
      profileDigest: digest("capability-profile"),
      effectiveGrantDigest: digest("effective-capability-grant"),
    },
    investment: {
      id: "investment-one",
      digest: digest("investment"),
      model: "gpt-5.6-sol",
      reasoning: "high",
      wallTimeMs: 60_000,
      limits: {
        tokens: null,
        events: 10_000,
        outputBytes: 1_048_576,
        toolCalls: null,
        processes: 64,
        storageBytes: 268_435_456,
      },
      rationale: "initial-probe",
    },
    provider: {
      descriptorId: "codex-exec-v6",
      descriptorDigest: digest("provider-descriptor"),
      executableIdentityClass: "oci-image-tool",
      installedIdentityDigest: digest("provider-executable"),
    },
    execution,
    authoring: {
      roleBriefDigest: digest("role-brief"),
      templateProfileId: "lifecycle.agent-work-product-body.reconnaissance.v4",
      templateDigest: digest("template"),
      parserProfileId: "lifecycle.agent-work-product-parser.v4",
      parserProfileDigest: digest("parser"),
      compilerProfileId: "lifecycle.agent-work-product-compiler.v4",
      compilerProfileDigest: digest("compiler"),
      submissionPolicy: "explicit-or-clean-natural-completion",
    },
    input: {
      contentInventoryDigest: digest("content-inventory"),
      inputMaterialDigest: digest("input-material"),
      citationRegistryDigest: digest("citation-registry"),
      evidenceSetDigest: null,
      propositionSetDigest: null,
    },
    executionPolicy,
    adjacentFilePurposes: ["provider-events", "provider-events"],
    brief: {
      kind: "director-brief",
      id: brief.recordId,
      revision: brief.revision,
      digest: brief.digest,
    },
  });

  assert.match(retained.revision.recordId, /^agent-attempt-[a-f0-9]{64}$/u);
  assert.match(String(retained.revision.payload.invocationId), /^provider-invocation-[a-f0-9]{64}$/u);
  assert.match(retained.event.eventId, /^event-agent-attempt-prepared-[a-f0-9]{64}$/u);
  assert.equal(retained.revision.recordKind, "agent-attempt");
  assert.equal(retained.revision.payload.operation, "delivery.prepare");
  assert.equal(retained.revision.payload.role, "reconnaissance");
  assert.equal(retained.revision.payload.schema, "lifecycle.agent-attempt-payload.v3");
  assert.equal(retained.revision.payload.preDispatchStateDigest, expectedPreDispatchStateDigest);
  assert.deepEqual(retained.revision.payload.capability, {
    profileId: "local-development-v1",
    profileDigest: digest("capability-profile"),
    effectiveGrantDigest: digest("effective-capability-grant"),
  });
  assert.deepEqual(retained.revision.payload.provider, {
    descriptorId: "codex-exec-v6",
    descriptorDigest: digest("provider-descriptor"),
    executableIdentityClass: "oci-image-tool",
    installedIdentityDigest: digest("provider-executable"),
    adapter: "lifecycle.provider-adapter.v7",
  });
  assert.deepEqual(retained.revision.payload.execution, execution);
  assert.deepEqual(retained.revision.payload.executionPolicy, executionPolicy);
  assert.equal("containmentPolicyDigest" in retained.revision.payload, false);
  assert.deepEqual(retained.revision.payload.adjacentFilePurposes, ["provider-events"]);
  assert.equal(retained.event.eventKind, "agent-attempt-prepared");
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), ["uses-brief"]);
  assert.equal(store.state().activities[0]?.stage, "prepared");
});

test("Agent Attempt compiler refuses a role that does not own the selected operation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-agent-attempt-role-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const store = await openControlRecordStore({ root, identity: identity(), create: true });
  context.after(() => store.close());
  assert.throws(() => retainAgentAttempt({
    store,
    activityId: "invalid-role",
    operation: "delivery.prepare",
    role: "builder",
  } as never), /role does not match/u);
});

test("reviewer Attempt requires the exact Candidate Seal relationship", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-agent-attempt-seal-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const store = await openControlRecordStore({ root, identity: identity(), create: true });
  context.after(() => store.close());
  const selected = {
    id: "selected-subject",
    revision: 1,
    digest: sha256Bytes("selected-subject"),
  };
  assert.throws(() => retainAgentAttempt({
    store,
    activityId: "review-without-seal",
    operation: "delivery.evaluate",
    role: "reviewer",
    boundary: { kind: "work-boundary", ...selected },
    candidate: { kind: "candidate-revision", ...selected },
  } as never), (error: unknown) => error instanceof Error &&
    error.message.includes("only review requires the exact Candidate Seal"));
});
