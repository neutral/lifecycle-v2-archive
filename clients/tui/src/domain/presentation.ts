import type {
  FoundationAttemptView,
  FoundationControlReference,
  FoundationControlFamilySummary,
  FoundationDeliveryOperation,
  FoundationDeliveryView,
  FoundationRuntimeObservation,
} from "@neutral/lifecycle-protocol";
import { foundationTuiActivityView } from "./activity.js";
import { deriveFoundationTuiJourney, type FoundationTuiJourney } from "./journey.js";
import { foundationTuiOperationPolicy } from "./operation-policy.js";

export const FOUNDATION_TUI_TAB_IDS = Object.freeze([
  "inbox",
  "now",
  "frame",
  "next-pass",
  "boundary",
  "candidate",
  "decision",
  "evidence",
  "attempt",
  "journal",
  "control",
  "exact",
] as const);

export type FoundationTuiTabId = typeof FOUNDATION_TUI_TAB_IDS[number];
export type FoundationTuiFactRow = Readonly<{
  label: string;
  value: string;
  emphasis: "ordinary" | "canonical" | "noncanonical" | "warning" | "unavailable";
}>;
export type FoundationTuiHero = Readonly<{
  priority: number;
  tone: "critical" | "attention" | "decision" | "working" | "ready" | "quiet" | "closed";
  eyebrow: string;
  title: string;
  body: string;
  owner: "Founder" | "Caller" | "Lifecycle" | "None";
  supporting: readonly string[];
}>;
export type FoundationTuiTruthLane = Readonly<{
  id: "canonical" | "working";
  title: string;
  status: string;
  tone: "healthy" | "attention" | "noncanonical" | "closed" | "unavailable";
  summary: string;
  facts: readonly FoundationTuiFactRow[];
}>;
export type FoundationTuiActionCard = Readonly<{
  operationId: FoundationDeliveryOperation;
  title: string;
  summary: string;
  consequence: string;
  badges: readonly string[];
  expectedStateRelationship: string;
  requiredInputIds: readonly string[];
  founderAuthorityRequired: boolean;
  investmentPerInvocation: boolean;
  capabilityProfileIds: null;
  effectRoute: "canonical-cli" | "canonical-cli-handoff";
  handoffReason: string;
}>;
export type FoundationTuiTab = Readonly<{
  id: FoundationTuiTabId;
  label: string;
  summary: string;
  rows: readonly FoundationTuiFactRow[];
  omittedRowCount: number;
}>;

export type FoundationTuiAttemptViewState =
  | Readonly<{ kind: "available"; view: FoundationAttemptView }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "unavailable"; message: string }>;

type FrameCurrent = Readonly<{
  deliveryId: string;
  status: "available" | "incomplete" | "empty" | "stale" | "unavailable";
  attemptId: string | null;
  journalHeadSequence: number | null;
  journalHeadDigest: string | null;
  summary: FoundationAttemptView["agentSemantics"]["summary"];
  proposal: FoundationAttemptView["agentSemantics"]["roleSemantics"];
  diagnosticCodes: readonly string[];
  message: string;
}>;

export type FoundationTuiPresentation = Readonly<{
  schema: "lifecycle.tui-presentation.v3";
  targetId: string;
  repository: Readonly<{
    headCommit: string;
    contractDigest: string;
    productDigest: string;
    atlas: FoundationRuntimeObservation["repository"]["atlas"];
    validation: "valid";
  }>;
  journey: FoundationTuiJourney;
  generation: string | null;
  semantics: FoundationDeliveryView["semantics"] | null;
  nextPass: readonly FoundationDeliveryView["nextPass"][number][];
  activity: FoundationDeliveryView["activity"] | null;
  decisionReadiness: FoundationDeliveryView["decisionReadiness"] | null;
  controlFamilies: readonly FoundationControlFamilySummary[];
  hero: FoundationTuiHero;
  canonicalLane: FoundationTuiTruthLane;
  workingLane: FoundationTuiTruthLane;
  frame: Readonly<{ current: FrameCurrent | null }>;
  actions: readonly FoundationTuiActionCard[];
  tabs: readonly FoundationTuiTab[];
}>;

export const FOUNDATION_TUI_HANDOFF_REASON =
  "Authority-bearing operations remain explicit reviewed CLI handoffs; non-authority passes execute only through canonical CLI child processes.";

type Delivery = NonNullable<FoundationRuntimeObservation["delivery"]>;

const row = (
  label: string,
  value: string,
  emphasis: FoundationTuiFactRow["emphasis"] = "ordinary",
): FoundationTuiFactRow => Object.freeze({ label, value, emphasis });

const ref = (value: FoundationControlReference | null | undefined): string =>
  value === null || value === undefined
    ? "not present"
    : `${value.kind}:${value.id} · revision ${value.revision} · ${value.digest}`;

function actionCopy(
  operation: FoundationDeliveryOperation,
  delivery: Delivery,
): Readonly<{
  title: string;
  summary: string;
  consequence: string;
  expectedStateRelationship: string;
}> {
  switch (operation) {
    case "delivery.prepare":
      return Object.freeze({
        title: "Start fresh reconnaissance",
        summary: "Fund one bounded reconnaissance Attempt from a complete fresh Founder brief.",
        consequence: "A new Delivery and proposed Work Boundary may be retained; no Candidate exists before admission.",
        expectedStateRelationship: "Preparation creates a new Delivery rather than mutating this displayed Delivery.",
      });
    case "delivery.admit": {
      const readmission = delivery.standing === "awaiting-readmission";
      return Object.freeze({
        title: readmission ? "Readmit the resolved boundary" : "Activate the boundary and initialize the Candidate",
        summary: readmission
          ? "Authenticate the exact resolved Work Boundary while preserving Candidate continuity."
          : "Authenticate the exact proposed Work Boundary and initialize its reversible Candidate.",
        consequence: readmission
          ? "The resolved mandate becomes active without replacing the Candidate identity or immutable base."
          : "Productive Agent Attempts become eligible against one isolated, noncanonical Candidate.",
        expectedStateRelationship: "The canonical CLI authenticates the exact pending Work Boundary selected by the live Delivery.",
      });
    }
    case "delivery.continue":
      return Object.freeze({
        title: "Continue work on the Candidate",
        summary: "Fund one bounded builder Attempt against the exact current Candidate and active Work Boundary.",
        consequence: "The runtime observes a new Candidate revision, records a Receipt, and keeps the Candidate reversible.",
        expectedStateRelationship: "The exact current Candidate and active Work Boundary must still govern the next Attempt.",
      });
    case "delivery.evaluate":
      return Object.freeze({
        title: "Seal and evaluate the Candidate",
        summary: "Freeze the Candidate's exact current bytes, run its final Checks, and invoke independent review.",
        consequence: "Evidence may become ready for a Founder decision; evaluation alone cannot integrate Candidate bytes.",
        expectedStateRelationship: "The Candidate must still be evaluable under the exact active Work Boundary.",
      });
    case "delivery.revise":
      return Object.freeze({
        title: "Revise the mandate",
        summary: "Resolve the Material Condition with one complete changed mandate.",
        consequence: "A successor Work Boundary revision is proposed while the same Candidate continuity is preserved.",
        expectedStateRelationship: "The exact active boundary and Material Condition must still be the resolution subjects.",
      });
    case "delivery.reaffirm":
      return Object.freeze({
        title: "Reaffirm the mandate",
        summary: "Resolve the Material Condition with one complete unchanged mandate.",
        consequence: "A successor Work Boundary revision records the unchanged mandate while Candidate continuity is preserved.",
        expectedStateRelationship: "The exact active boundary and Material Condition must still be the resolution subjects.",
      });
    case "delivery.accept":
      return Object.freeze({
        title: "Accept the exact evidenced Candidate",
        summary: "Authenticate acceptance of the sealed Candidate bound by the current Evidence Packet.",
        consequence: "The terminal transaction integrates those exact Candidate bytes and records Closure only after required Containment and Retirement.",
        expectedStateRelationship: "The exact Candidate Seal and Evidence Packet must still be current and decision-ready.",
      });
    case "delivery.no-ship":
      return Object.freeze({
        title: "Close without shipping the Candidate",
        summary: "Authenticate a no-ship disposition for this exact Delivery.",
        consequence: "The Candidate is abandoned without integration; all required execution is contained and retired before Closure.",
        expectedStateRelationship: "The canonical CLI binds the no-ship decision to the exact live Delivery subjects.",
      });
    case "delivery.recover":
      return Object.freeze({
        title: "Resume exact recovery",
        summary: `Continue only the retained ${delivery.recovery?.resumesAt ?? "recovery"} obligation.`,
        consequence: "Recovery neither starts a replacement operation nor repeats a completed external effect.",
        expectedStateRelationship: "The exact retained recovery obligation must remain current.",
      });
  }
}

function actionCard(operation: FoundationDeliveryOperation, delivery: Delivery): FoundationTuiActionCard {
  const policy = foundationTuiOperationPolicy(operation);
  const copy = actionCopy(operation, delivery);
  const requiredInputIds = [
    ...(policy.inputKind === "semantic-markdown" ? ["semantic Markdown file"] : []),
    ...(policy.authoritySecretRequired ? ["Founder authority secret file"] : []),
  ];
  return Object.freeze({
    operationId: operation,
    ...copy,
    badges: Object.freeze(policy.classes.map((value) => value.toUpperCase())),
    requiredInputIds: Object.freeze(requiredInputIds),
    founderAuthorityRequired: policy.authoritySecretRequired,
    investmentPerInvocation: policy.investmentRequired,
    capabilityProfileIds: null,
    effectRoute: policy.exposure === "enabled-frame-prepare" || policy.exposure === "enabled-next-pass"
      ? "canonical-cli"
      : "canonical-cli-handoff",
    handoffReason: FOUNDATION_TUI_HANDOFF_REASON,
  });
}

function candidateSummary(condition: Delivery["candidateCondition"] | "absent"): string {
  switch (condition) {
    case "absent": return "No Candidate has been initialized for this view.";
    case "ready-for-work": return "The exact current Candidate Revision is ready for another bounded Agent Attempt.";
    case "in-progress": return "A bounded operation is working from the exact current Candidate Revision.";
    case "needs-correction": return "The same Candidate Revision remains current for correction.";
    case "paused-for-boundary": return "Candidate work is paused until the admitted mandate is resolved.";
    case "sealed-under-evaluation": return "The exact sealed Candidate is under final Checks and independent review.";
    case "ready-for-decision": return "Evidence is ready for the Founder to accept or choose no-ship.";
    case "terminal-recovery": return "Only the retained Candidate activity at its exact recovery boundary may continue.";
    case "accepted": return "The exact evidenced Candidate was accepted and integrated.";
    case "abandoned": return "The Candidate was abandoned and the Delivery closed without integration.";
  }
}

function heroTone(delivery: Delivery | null): FoundationTuiHero["tone"] {
  if (delivery === null) return "ready";
  if (delivery.standing === "closed") return "closed";
  if (delivery.recovery !== null || delivery.standing === "boundary-paused") return "attention";
  if (
    delivery.standing === "awaiting-admission" ||
    delivery.standing === "awaiting-readmission" ||
    delivery.standing === "decision-ready"
  ) return "decision";
  if (delivery.activities.some(({ stage }) => stage !== "completed")) return "working";
  return "ready";
}

function attemptViewMatchesDelivery(
  view: FoundationAttemptView,
  delivery: Delivery,
): boolean {
  return view.coordinate.storeId === delivery.storeId &&
    view.coordinate.processId === delivery.processId &&
    view.coordinate.journal.headSequence === delivery.journal.headSequence &&
    view.coordinate.journal.headDigest === delivery.journal.headDigest;
}

function executionRows(view: FoundationAttemptView): readonly FoundationTuiFactRow[] {
  const selected = view.attemptContract.execution;
  const observed = view.providerExecution.execution;
  const output = observed?.outputManifest;
  const backendLabel = selected.backendProfile.profileId ===
      "lifecycle.execution-backend-profile.docker-local.v1"
    ? "Docker Execution Backend"
    : "Fault-injection Test Backend";
  return Object.freeze([
    row("Attempt", ref(view.coordinate.attempt)),
    row("Activity", view.attemptContract.activityId),
    row("Operation", view.attemptContract.operation),
    row("Role", view.attemptContract.role),
    row(
      "Backend Profile",
      `${backendLabel} · ${selected.backendProfile.profileId} · ${selected.backendProfile.profileDigest}`,
    ),
    row("Execution Image", `${selected.image.imageId} · ${selected.image.imageDigest}`),
    row("Agent product network", selected.network.agentProductNetwork),
    row(
      "Provider service",
      selected.services.providerControlPlane === "fixed-service-channel"
        ? "fixed service channel"
        : "none",
    ),
    row("Network separation", selected.network.separationRequired ? "required" : "not required"),
    row("Wall-time limit", `${selected.effectiveLimits.wallTimeMilliseconds} ms`),
    row("Process limit", String(selected.effectiveLimits.processes)),
    row("Storage limit", `${selected.effectiveLimits.storageBytes} bytes`),
    row("Output-entry limit", String(selected.effectiveLimits.outputEntries)),
    row("Output-byte limit", `${selected.effectiveLimits.outputBytes} bytes`),
    row("Per-entry output limit", `${selected.effectiveLimits.outputEntryBytes} bytes`),
    row("Event limit", String(selected.effectiveLimits.events)),
    row("Dispatch", view.providerExecution.effect.intended ? "authority consumed" : "not dispatched"),
    row("Specification", observed?.specificationDigest ?? "not observed"),
    row("Runner", observed?.runnerDigest ?? "not observed"),
    row("Observation", observed?.observationDigest ?? "not observed"),
    row(
      "Output Manifest",
      output === undefined
        ? "not observed"
        : output.digest === null
          ? output.availability
          : `${output.availability} · ${output.digest}`,
    ),
    row(
      "Containment",
      view.providerExecution.containment?.classification ?? "not observed",
    ),
    row(
      "Retirement",
      view.providerExecution.retirement?.classification ?? "not observed",
    ),
  ]);
}

export function createFoundationTuiPresentation(
  observation: FoundationRuntimeObservation,
  attemptViewState: FoundationTuiAttemptViewState = Object.freeze({
    kind: "unavailable",
    message: "The derived Attempt View has not been inspected for this snapshot.",
  }),
  deliveryView: FoundationDeliveryView | null = null,
): FoundationTuiPresentation {
  const delivery = observation.delivery;
  const journey = deriveFoundationTuiJourney(observation);
  const activity = foundationTuiActivityView(observation).value;
  const subjects = delivery?.subjects;
  const exactAttemptView = delivery !== null && attemptViewState.kind === "available" &&
    attemptViewMatchesDelivery(attemptViewState.view, delivery)
    ? attemptViewState.view
    : null;
  const actions = Object.freeze(
    (delivery?.eligibleOperations ?? []).map((operation) => actionCard(operation, delivery!)),
  );
  const tabs: readonly FoundationTuiTab[] = Object.freeze([
    Object.freeze({
      id: "inbox",
      label: "Inbox",
      summary: "Runtime-owned portfolio of concurrent Deliveries; selection binds an exact generation.",
      rows: Object.freeze([
        row("Selected Delivery", delivery?.processId ?? "none", delivery === null ? "unavailable" : "canonical"),
        row("Standing", delivery?.standing ?? "none"),
        row("Attention", journey.attentionOwner),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "now",
      label: "Now",
      summary: "Current exact Delivery facts",
      rows: Object.freeze([
        row("Delivery", delivery?.processId ?? "none", delivery === null ? "unavailable" : "canonical"),
        row("Standing", delivery?.standing ?? "none"),
        row("Candidate", delivery?.candidateCondition ?? "absent", "noncanonical"),
        row("Eligible", (delivery?.eligibleOperations ?? []).join(", ") || "none"),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "frame",
      label: "Frame",
      summary: "One complete fresh brief creates one new Delivery.",
      rows: Object.freeze([
        row("Input", "No prior Candidate, Attempt View, Journal, or provider context is implicit."),
        row("Delivery", delivery?.processId ?? "not created"),
        row("Proposed boundary", ref(subjects?.proposedBoundary)),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "next-pass",
      label: "Next Pass",
      summary: "Founder direction for one runtime-eligible pass against the exact selected Delivery generation.",
      rows: Object.freeze([
        row("Delivery", delivery?.processId ?? "none", delivery === null ? "unavailable" : "canonical"),
        row("Active boundary", ref(subjects?.activeBoundary)),
        row("Candidate", ref(subjects?.candidate), "noncanonical"),
        row("Eligible passes", (delivery?.eligibleOperations ?? []).filter((operation) => [
          "delivery.continue",
          "delivery.revise",
          "delivery.reaffirm",
          "delivery.evaluate",
        ].includes(operation)).join(", ") || "none"),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "boundary",
      label: "Boundary",
      summary: "Current Work Boundary and Material Condition references",
      rows: Object.freeze([
        row("Proposed", ref(subjects?.proposedBoundary)),
        row("Active", ref(subjects?.activeBoundary)),
        row("Material Condition", ref(subjects?.materialCondition)),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "candidate",
      label: "Candidate",
      summary: "Reversible, noncanonical product state",
      rows: Object.freeze([
        row("Condition", delivery?.candidateCondition ?? "absent", "noncanonical"),
        row("Revision", ref(subjects?.candidate)),
        row("Seal", ref(subjects?.seal)),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "decision",
      label: "Decision",
      summary: "Joined exact Boundary, Candidate Seal, Checks, review, Evidence, and terminal choices.",
      rows: Object.freeze([
        row("Boundary", ref(subjects?.activeBoundary)),
        row("Candidate", ref(subjects?.candidate), "noncanonical"),
        row("Candidate Seal", ref(subjects?.seal)),
        row("Evidence Packet", ref(subjects?.evidence)),
        row("Terminal choices", (delivery?.eligibleOperations ?? []).filter((operation) =>
          operation === "delivery.accept" || operation === "delivery.no-ship").join(", ") || "not ready"),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "evidence",
      label: "Evidence",
      summary: "Exact Evidence and Closure references",
      rows: Object.freeze([
        row("Evidence Packet", ref(subjects?.evidence)),
        row("Closure", ref(subjects?.closure)),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "attempt",
      label: "Attempt",
      summary: "Sanitized execution selection and observation for the exact derived Agent Attempt.",
      rows: exactAttemptView === null
        ? Object.freeze([
            row("Activity", activity?.id ?? "none"),
            row("Operation", activity?.operation ?? "none"),
            row("Family", activity?.family ?? "none"),
            row("Stage", activity?.stage ?? "none"),
            row("Execution selection", "not available for this exact Journal coordinate", "unavailable"),
          ])
        : executionRows(exactAttemptView),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "journal",
      label: "Journal",
      summary: "Exact Delivery event-chain coordinate",
      rows: Object.freeze([
        row("Events", String(delivery?.journal.eventCount ?? 0)),
        row("Head sequence", delivery?.journal.headSequence === null || delivery === null ? "none" : String(delivery.journal.headSequence)),
        row("Head digest", delivery?.journal.headDigest ?? "none"),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "control",
      label: "Control",
      summary: "Runtime-backed Control family and revision explorer.",
      rows: Object.freeze([
        row("Delivery", delivery?.processId ?? "none"),
        row("Selection", "Choose a family or revision through exact runtime inspection."),
      ]),
      omittedRowCount: 0,
    }),
    Object.freeze({
      id: "exact",
      label: "Exact",
      summary: "Repository, Store, Delivery, and Journal coordinates",
      rows: Object.freeze([
        row("Target", observation.repository.targetId ?? "unavailable", "canonical"),
        row("Store", delivery?.storeId ?? "none"),
        row("Delivery", delivery?.processId ?? "none"),
        row("Contract", observation.repository.repositoryContractDigest ?? "unavailable"),
        row("Product digest", observation.repository.productDigest ?? "unavailable"),
        row("Atlas release", observation.repository.atlas === null
          ? "unavailable"
          : `${observation.repository.atlas.selection.release} · authored format ${observation.repository.atlas.selection.authoredFormat}`),
        row("Atlas specification", observation.repository.atlas?.selection.specificationRevision ?? "unavailable"),
        row("Atlas processor", observation.repository.atlas === null
          ? "unavailable"
          : `${observation.repository.atlas.processor.id}@${observation.repository.atlas.processor.version} · ${observation.repository.atlas.processor.implementationDigest}`),
        row("Atlas state", observation.repository.atlas?.stateDigest ?? "unavailable"),
        row("Atlas Resolution", observation.repository.atlas?.resolutionDigest ?? "unavailable"),
        row("Atlas normalized model", observation.repository.atlas?.normalizedModelDigest ?? "unavailable"),
        row("Atlas Resource bindings", observation.repository.atlas?.resourceBindingsDigest ?? "unavailable"),
        row("HEAD", observation.repository.headCommit ?? "unavailable"),
        row("Journal head", delivery?.journal.headDigest ?? "none"),
        row("Store disposition", delivery?.storeDisposition.stage ?? "none"),
      ]),
      omittedRowCount: 0,
    }),
  ]);
  const candidateCondition = delivery?.candidateCondition ?? "absent";
  const frameCurrent = delivery === null
    ? null
    : attemptViewState.kind === "empty"
      ? Object.freeze({
          deliveryId: delivery.processId,
          status: "empty" as const,
          attemptId: null,
          journalHeadSequence: delivery.journal.headSequence,
          journalHeadDigest: delivery.journal.headDigest,
          summary: null,
          proposal: null,
          diagnosticCodes: Object.freeze([]),
          message: "No Agent Attempt is retained at this exact Journal head.",
        })
      : attemptViewState.kind === "unavailable"
        ? Object.freeze({
            deliveryId: delivery.processId,
            status: "unavailable" as const,
            attemptId: null,
            journalHeadSequence: delivery.journal.headSequence,
            journalHeadDigest: delivery.journal.headDigest,
            summary: null,
            proposal: null,
            diagnosticCodes: Object.freeze([]),
            message: attemptViewState.message,
          })
        : (() => {
            const view = attemptViewState.view;
            const coherent = attemptViewMatchesDelivery(view, delivery);
            if (!coherent) {
              return Object.freeze({
                deliveryId: delivery.processId,
                status: "stale" as const,
                attemptId: null,
                journalHeadSequence: delivery.journal.headSequence,
                journalHeadDigest: delivery.journal.headDigest,
                summary: null,
                proposal: null,
                diagnosticCodes: Object.freeze([]),
                message: "The derived Attempt View does not bind this exact Delivery and Journal coordinate.",
              });
            }
            const submissionDiagnostic = view.agentSemantics.submissionDiagnostics.diagnostic;
            const diagnosticCodes = Object.freeze([...new Set([
              ...view.diagnostics.map(({ code }) => code),
              ...(submissionDiagnostic === null ? [] : [submissionDiagnostic.code]),
            ])].sort());
            return Object.freeze({
              deliveryId: delivery.processId,
              status: view.complete ? "available" as const : "incomplete" as const,
              attemptId: view.coordinate.attempt.id,
              journalHeadSequence: view.coordinate.journal.headSequence,
              journalHeadDigest: view.coordinate.journal.headDigest,
              summary: view.agentSemantics.summary,
              proposal: view.agentSemantics.roleSemantics,
              diagnosticCodes,
              message: view.complete
                ? submissionDiagnostic === null
                  ? "Exact agent semantics from one reducer-derived Attempt View coordinate."
                  : "The Attempt was observed completely, but its semantic submission did not produce a valid Work Product."
                : "The reducer-derived Attempt View is incomplete; only its retained exact semantics are shown.",
            });
          })();
  return Object.freeze({
    schema: "lifecycle.tui-presentation.v3",
    targetId: observation.repository.targetId ?? "unavailable",
    repository: Object.freeze({
      headCommit: observation.repository.headCommit ?? "unavailable",
      contractDigest: observation.repository.repositoryContractDigest ?? "unavailable",
      productDigest: observation.repository.productDigest ?? "unavailable",
      atlas: observation.repository.atlas,
      validation: "valid",
    }),
    generation: deliveryView?.generation.digest ?? null,
    semantics: deliveryView?.semantics ?? null,
    nextPass: Object.freeze([...(deliveryView?.nextPass ?? [])]),
    activity: deliveryView?.activity ?? null,
    decisionReadiness: deliveryView?.decisionReadiness ?? null,
    controlFamilies: Object.freeze([...(deliveryView?.controlFamilies ?? [])]),
    journey,
    hero: Object.freeze({
      priority: 1,
      tone: heroTone(delivery),
      eyebrow: journey.currentPhaseLabel,
      title: candidateCondition.replaceAll("-", " "),
      body: journey.stateExplanation,
      owner: journey.attentionOwner === "founder"
        ? "Founder"
        : journey.attentionOwner === "runtime"
          ? "Lifecycle"
          : journey.attentionOwner === "none"
            ? "None"
            : "Caller",
      supporting: Object.freeze([]),
    }),
    canonicalLane: Object.freeze({
      id: "canonical",
      title: "Canonical product",
      status: observation.repository.headCommit ?? "unavailable",
      tone: observation.repository.valid ? "healthy" : "attention",
      summary: "Repository product facts are runtime-observed.",
      facts: Object.freeze([]),
    }),
    workingLane: Object.freeze({
      id: "working",
      title: "Candidate",
      status: candidateCondition,
      tone: delivery === null || delivery.subjects.candidate === null
        ? "unavailable"
        : delivery.standing === "closed"
          ? "closed"
          : "noncanonical",
      summary: candidateSummary(candidateCondition),
      facts: Object.freeze([]),
    }),
    frame: Object.freeze({
      current: frameCurrent,
    }),
    actions,
    tabs,
  });
}
