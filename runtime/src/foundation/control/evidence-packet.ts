import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import {
  assessFoundationEvaluationEvidenceV7,
  assertFoundationEvidencePacketV7,
  verifyFoundationAcceptanceV7,
  verifyFoundationEvidenceV7,
  type EvidencePacketArtifactObservation,
  type EvidencePacketDescriptionObservation,
  type EvidencePacketDiagnostic,
  type EvidencePacketObservation,
  type FoundationAcceptanceCurrentSubjectsV7,
  type FoundationAcceptanceDirectorSubjectV7,
  type FoundationEvidenceReferenceV7,
  type FoundationEvidenceSubjectObservationV7,
  resolveFoundationEvidenceObservationSubjectV7,
  type FoundationEvidenceVerificationInputV7,
} from "../evidence/verifier-v7.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, controlIdentifier } from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlJsonObject, ControlRecordEvent, ControlRecordRevision } from "./types.js";

export type {
  EvidencePacketReadiness,
  EvidencePacketArtifactObservation,
  EvidencePacketDescriptionObservation,
  EvidencePacketDiagnostic,
  EvidencePacketObservation,
} from "../evidence/verifier-v7.js";

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-evidence-packet.${code}`, message);
}
function reference(revision: ControlRecordRevision): FoundationEvidenceReferenceV7 {
  return Object.freeze({ id: revision.recordId, revision: revision.revision, digest: revision.digest });
}
function exactRevision(store: ControlRecordStore, selected: FoundationEvidenceReferenceV7 | null, kind: string): ControlRecordRevision {
  if (selected === null) fail("standing", `Evidence requires one exact ${kind}`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("relationship", `Evidence ${kind} reference does not resolve exactly`);
  }
  return revision;
}
function relation(packet: ControlRecordRevision, name: string, kind: string): FoundationEvidenceReferenceV7 {
  const matches = packet.relationships.filter((item) => item.relation === name);
  if (matches.length !== 1 || matches[0]!.target.kind !== kind) {
    fail("relationship", `Evidence requires exactly one ${name} ${kind} relationship`);
  }
  const target = matches[0]!.target;
  return Object.freeze({ id: target.id, revision: target.revision, digest: target.digest });
}
function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    events.push(...page);
    if (page.length < 10_000) break;
    after = page.at(-1)!.sequence;
  }
  const state = store.state();
  if (events.length !== state.journal.eventCount || (events.at(-1)?.digest ?? null) !== state.journal.headDigest) {
    fail("journal", "Evidence collection did not observe the exact current Journal head");
  }
  return Object.freeze(events);
}

/** Read retained facts only. Every returned Control relationship resolves inside the frozen inventory. */
function collectInput(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  events: readonly ControlRecordEvent[];
  selected: FoundationEvidenceVerificationInputV7["selected"];
  observation: EvidencePacketObservation;
  observationSubject: FoundationEvidenceVerificationInputV7["observationSubject"];
}>): FoundationEvidenceVerificationInputV7 {
  const revisions = new Map<string, ControlRecordRevision>();
  const pending: { id: string; revision: number; digest: Sha256; kind?: string }[] = [
    { ...input.selected.boundary, kind: "work-boundary" },
    { ...input.selected.candidate, kind: "candidate-revision" },
    { ...input.selected.seal, kind: "candidate-seal" },
    ...(input.selected.materialCondition === null ? [] : [{ ...input.selected.materialCondition, kind: "material-condition" }]),
    ...input.events.flatMap((event) => event.subject === null ? [] : [{
      id: event.subject.recordId, revision: event.subject.revision, digest: event.subject.digest,
    }]),
  ];
  for (let index = 0; index < pending.length; index += 1) {
    const target = pending[index]!;
    const key = `${target.id}\0${target.revision}`;
    const revision = revisions.get(key) ?? input.store.getRevision(target.id, target.revision);
    if (revision === null || revision.digest !== target.digest ||
        (target.kind !== undefined && revision.recordKind !== target.kind)) {
      fail("relationship", "Evidence collection cannot close one exact retained Control subject");
    }
    if (revisions.has(key)) continue;
    revisions.set(key, revision);
    pending.push(...revision.relationships.map(({ target: selected }) => selected));
  }
  return Object.freeze({
    identity: Object.freeze({ targetId: input.store.identity.targetId, storeId: input.store.identity.storeId,
      processId: input.store.identity.processId }),
    evaluationActivityId: input.activityId,
    selected: input.selected,
    events: input.events,
    revisions: Object.freeze([...revisions.values()]),
    observationSubject: input.observationSubject,
    observation: input.observation,
  });
}

/** Reopen retained runtime observations; derived readiness and semantic ledgers are not observations. */
function retainedObservation(packet: ControlRecordRevision): EvidencePacketObservation {
  assertDeliveryControlRecordPolicy(packet);
  assertDeliveryControlRecordPayload(packet);
  const payload = packet.payload;
  const artifacts = payload.artifacts as readonly ControlJsonObject[];
  const descriptions = payload.descriptionCoverage as readonly ControlJsonObject[];
  const independence = payload.reviewerIndependence as readonly ControlJsonObject[];
  if (independence.length !== 1) fail("review", "Retained Evidence does not carry one exact reviewer subject observation");
  return Object.freeze({
    evaluatedAt: payload.evaluatedAt as string,
    ruleSet: payload.ruleSet as EvidencePacketObservation["ruleSet"],
    validator: payload.validator as EvidencePacketObservation["validator"],
    artifacts: Object.freeze(artifacts.map((entry): EvidencePacketArtifactObservation => Object.freeze({
      artifactId: entry.artifactId as string,
      fileKind: entry.fileKind as EvidencePacketArtifactObservation["fileKind"],
      existence: entry.existence as EvidencePacketArtifactObservation["existence"],
      change: entry.change as EvidencePacketArtifactObservation["change"],
      contentDigest: entry.contentDigest as Sha256 | null,
      manifestDigest: entry.manifestDigest as Sha256 | null,
      schemaValidation: entry.schemaValidation as EvidencePacketArtifactObservation["schemaValidation"],
      semanticValidation: entry.semanticValidation as EvidencePacketArtifactObservation["semanticValidation"],
      limitationIds: entry.limitations as readonly string[],
    }))),
    descriptionCoverage: Object.freeze(descriptions.map((entry): EvidencePacketDescriptionObservation => Object.freeze({
      path: entry.path as string,
      descriptionId: entry.descriptionId as string | null,
      selector: entry.selector as string | null,
      ownership: entry.ownership as EvidencePacketDescriptionObservation["ownership"],
      implementationChange: entry.implementationChange as EvidencePacketDescriptionObservation["implementationChange"],
      descriptionChange: entry.descriptionChange as EvidencePacketDescriptionObservation["descriptionChange"],
      exclusionChange: entry.exclusionChange as EvidencePacketDescriptionObservation["exclusionChange"],
      obligationIds: entry.obligationIds as readonly string[],
    }))),
    reviewerSubjectDisposition: independence[0]!.subjectDisposition as EvidencePacketObservation["reviewerSubjectDisposition"],
    diagnostics: payload.diagnostics as readonly EvidencePacketDiagnostic[],
    // This is a negative recommendation only. It cannot cause acceptance readiness.
    nonReadyDisposition: payload.readiness === "no-ship-recommended" ? "no-ship-recommended" : "correctable",
  });
}

export type RetainedEvidenceVerificationInputV7 = Readonly<{
  store: ControlRecordStore;
  packet: ControlRecordRevision;
  /** Fresh physical-owner observations carry their own explicit exact subject binding. */
  observation?: FoundationEvidenceSubjectObservationV7 | undefined;
}>;

/** Collect the Packet's historical evaluation prefix without requiring a live Activity. */
export function collectRetainedEvidenceVerificationInputV7(input: RetainedEvidenceVerificationInputV7): FoundationEvidenceVerificationInputV7 {
  const stateDigestBefore = digestCanonical(input.store.state());
  const packet = exactRevision(input.store, reference(input.packet), "evidence-packet");
  if (canonicalJson(packet) !== canonicalJson(input.packet)) fail("relationship", "Supplied Packet differs from its retained exact revision");
  const events = allEvents(input.store);
  const finalizations = events.filter((event) => event.eventKind === "evidence-packet-finalized" &&
    event.subject?.recordId === packet.recordId && event.subject.revision === packet.revision && event.subject.digest === packet.digest);
  if (finalizations.length !== 1 || typeof finalizations[0]!.payload.activityId !== "string") {
    fail("journal", "Retained Evidence requires its unique exact evaluation finalization event");
  }
  const finalized = finalizations[0]!;
  // Interpretation, revision construction, and retention are distinct ordered moments.
  if (Date.parse(finalized.occurredAt) < Date.parse(packet.createdAt)) {
    fail("journal", "Evidence finalization precedes construction of its exact Packet revision");
  }
  const activityId = finalized.payload.activityId as string;
  const prefix = Object.freeze(events.slice(0, finalized.sequence - 1));
  const materialEvents = prefix.filter((event) => event.eventKind === "material-condition-frozen" && event.payload.activityId === activityId);
  if (materialEvents.length > 1 || materialEvents.some((event) => event.subject === null)) {
    fail("material-condition", "Historical evaluation does not select one exact Material Condition observation");
  }
  const materialSubject = materialEvents[0]?.subject;
  const selected = Object.freeze({
    boundary: relation(packet, "governed-by", "work-boundary"),
    candidate: relation(packet, "evaluates", "candidate-revision"),
    seal: relation(packet, "uses-seal", "candidate-seal"),
    materialCondition: materialSubject == null ? null : Object.freeze({ id: materialSubject.recordId,
      revision: materialSubject.revision, digest: materialSubject.digest }),
  });
  const retained = retainedObservation(packet);
  const observation = input.observation === undefined ? retained : Object.freeze({
    ...retained,
    ...input.observation.facts,
    // Physical sampling does not change the historical evaluation clock or selected interpretation.
    evaluatedAt: retained.evaluatedAt,
    ruleSet: retained.ruleSet,
    validator: retained.validator,
  });
  const collected = collectInput({ store: input.store, activityId, events: prefix, selected, observation,
    observationSubject: input.observation?.subject ?? resolveFoundationEvidenceObservationSubjectV7({store:input.store,subjects:selected}) });
  if (digestCanonical(input.store.state()) !== stateDigestBefore) fail("state-race", "Evidence subjects changed during retained collection");
  return collected;
}

export function verifyRetainedEvidencePacketV7(input: RetainedEvidenceVerificationInputV7) {
  const facts = collectRetainedEvidenceVerificationInputV7(input);
  const evidence = verifyFoundationEvidenceV7(facts);
  assertFoundationEvidencePacketV7(facts, input.packet, evidence);
  return evidence;
}

export function verifyRetainedAcceptanceV7(input: RetainedEvidenceVerificationInputV7 & Readonly<{
  current: FoundationAcceptanceCurrentSubjectsV7;
  parentCommit: string;
  directorDecisionSubject?: FoundationAcceptanceDirectorSubjectV7 | undefined;
}>) {
  const evidence = collectRetainedEvidenceVerificationInputV7(input);
  const result = verifyFoundationAcceptanceV7({ evidence, packet: input.packet, current: input.current,
    parentCommit: input.parentCommit, directorDecisionSubject: input.directorDecisionSubject });
  if (result.status === "not-justified") {
    throw new FoundationError(result.reason.code, result.reason.message, {
      observedFacts: {
        ...(result.reason.expected === undefined ? {} : { expected: result.reason.expected }),
        ...(result.reason.observed === undefined ? {} : { observed: result.reason.observed }),
      },
    });
  }
  return result;
}

/** Classify exact authenticated evaluation facts before retaining its required Delivery response. */
export function assessEvidencePacket(input: Readonly<{
  store: ControlRecordStore; activityId: string; observation: EvidencePacketObservation;
}>) {
  const state = input.store.state();
  const selected = Object.freeze({
    boundary: reference(exactRevision(input.store,state.subjects.activeBoundary,"work-boundary")),
    candidate: reference(exactRevision(input.store,state.subjects.candidate,"candidate-revision")),
    seal: reference(exactRevision(input.store,state.subjects.seal,"candidate-seal")),
    materialCondition: state.subjects.materialCondition,
  });
  return assessFoundationEvaluationEvidenceV7(collectInput({store:input.store,activityId:input.activityId,
    events:allEvents(input.store),selected,observation:input.observation,
    observationSubject:resolveFoundationEvidenceObservationSubjectV7({store:input.store,subjects:selected})}));
}

/** Delivery owns live finalization and append; the Evidence owner supplies all semantic interpretation. */
export function retainEvidencePacket(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  observation: EvidencePacketObservation;
  runtimeId: string;
}>): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }> {
  const activityId = controlIdentifier(input.activityId, "Evidence Packet activity identity");
  const state = input.store.state();
  const stateDigestBefore = digestCanonical(state);
  const activity = state.activities.find(({ id }) => id === activityId);
  if (activity === undefined || activity.operation !== "delivery.evaluate" || activity.family !== "agent" ||
      activity.stage !== "finalizing" || state.subjects.evidence !== null) {
    fail("activity", "Evidence Packet compilation requires one exact unfinalized evaluation activity");
  }
  const selected = Object.freeze({
    boundary: reference(exactRevision(input.store, state.subjects.activeBoundary, "work-boundary")),
    candidate: reference(exactRevision(input.store, state.subjects.candidate, "candidate-revision")),
    seal: reference(exactRevision(input.store, state.subjects.seal, "candidate-seal")),
    materialCondition: state.subjects.materialCondition,
  });
  const facts = collectInput({ store: input.store, activityId, events: allEvents(input.store), selected,
    observation: input.observation,
    observationSubject: resolveFoundationEvidenceObservationSubjectV7({store:input.store,subjects:selected}) });
  const evidence = verifyFoundationEvidenceV7(facts);
  const suffix = digestCanonical({ recordKind: "evidence-packet", storeId: input.store.identity.storeId,
    processId: input.store.identity.processId, activityId }).slice("sha256:".length);
  const revisionInput = Object.freeze({
    recordId: `evidence-packet-${suffix}`,
    recordKind: "evidence-packet",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: input.observation.evaluatedAt,
    semanticMarkdown: evidence.semanticMarkdown,
    payload: evidence.payload,
    relationships: evidence.relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  if (digestCanonical(input.store.state()) !== stateDigestBefore) fail("state-race", "Evidence subjects changed during compilation");
  const retained = input.store.append({ revision: revisionInput, event: {
    eventId: `event-evidence-packet-finalized-${suffix}`,
    eventKind: "evidence-packet-finalized",
    occurredAt: input.observation.evaluatedAt,
    actor: { kind: "runtime", id: input.runtimeId },
    subject: { recordId: compiled.recordId, revision: compiled.revision, digest: compiled.digest },
    payload: { activityId },
  } });
  if (retained.revision === null) fail("retention", "Evidence Packet revision was not retained");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
