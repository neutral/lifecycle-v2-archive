import {
  foundationContextSelectionOf,
  type FoundationInspectionSelection,
  type FoundationContextInspectionResult,
  type FoundationContextInspectionSelector,
  type FoundationDeliveryGeneration,
  type FoundationDeliveryState,
} from "@neutral/lifecycle-protocol";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../repository/snapshot.js";
import type { FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import {
  compileFoundationAtlasOverviewInspection,
  compileFoundationAtlasPointInspection,
  compileFoundationAtlasResourceInspection,
  resolveFoundationAtlasInspectionSource,
} from "./atlas-inspection.js";
import { compileFoundationAuthorizationReviewInspection } from "./authorization-inspection.js";
import {
  compileFoundationCodeFile,
  compileFoundationCodeIndex,
  resolveFoundationCodeInspectionSource,
} from "./code-inspection.js";
import {
  assertFoundationInspectionGeneration,
  compileFoundationContextBasis,
} from "./context-basis.js";
import {
  compileFoundationDeliveryQueryBasisForBoundaryReference,
  type FoundationDeliveryQueryBasis,
} from "./delivery-query-basis.js";
import {
  compileFoundationKnowledgeIndex,
  compileFoundationKnowledgeRecord,
  resolveFoundationKnowledgeInspectionSource,
} from "./knowledge-inspection.js";
import { compileFoundationSourceRange } from "./source-inspection.js";
import { resolveFoundationInspectionSelection } from "./inspection-selection.js";

export type FoundationContextInspectionRuntimeOwners = Readonly<{
  compileQueryBasis: typeof compileFoundationDeliveryQueryBasisForBoundaryReference;
  loadCurrentSnapshot(target: string): Promise<FoundationLoadedRepositorySnapshot>;
  resolveSelection?: (store: ControlRecordStore, selection: FoundationInspectionSelection) => void;
}>;

async function loadCurrentSnapshot(target: string): Promise<FoundationLoadedRepositorySnapshot> {
  const loaded = await loadRepositoryEpoch(target);
  const result = await validateKnowledgeSet(loaded);
  if (
    result.knowledgeSet === null ||
    !result.validation.complete ||
    !result.validation.valid
  ) {
    throw new FoundationError(
      "lifecycle.context-inspection.repository-invalid",
      "Authorization Review cannot bind an incomplete or invalid current repository snapshot",
      {
        diagnostics: result.validation.diagnostics,
        observedFacts: Object.freeze({ validationResultDigest: result.validation.digest }),
      },
    );
  }
  return await bindRepositorySnapshot(loaded, result.knowledgeSet);
}

const DEFAULT_OWNERS: FoundationContextInspectionRuntimeOwners = Object.freeze({
  compileQueryBasis: compileFoundationDeliveryQueryBasisForBoundaryReference,
  loadCurrentSnapshot,
});

function fail(code: string, message: string, observedFacts: unknown = {}): never {
  throw new FoundationError(`lifecycle.context-inspection.${code}`, message, {
    observedFacts,
  });
}

function boundaryReference(
  selected: FoundationDeliveryState["subjects"]["activeBoundary"],
): Readonly<{ kind: "work-boundary"; id: string; revision: number; digest: `sha256:${string}` }> {
  if (selected === null) fail("boundary-absent", "Context selection has no current Work Boundary");
  return Object.freeze({
    kind: "work-boundary",
    id: selected.id,
    revision: selected.revision,
    digest: selected.digest,
  });
}

async function selectedContextQuery(input: Readonly<{
  machineHome: string;
  target: string;
  store: ControlRecordStore;
  selector: Extract<
    FoundationContextInspectionSelector,
    { kind: "knowledge-index" | "knowledge-record" | "atlas-overview" | "atlas-point" | "atlas-resource" }
  >;
  owners: FoundationContextInspectionRuntimeOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  return await input.owners.compileQueryBasis({
    machineHome: input.machineHome,
    target: input.target,
    store: input.store,
    boundary: input.selector.context.boundary.reference,
    inspectionSelection: input.selector.context,
  });
}

async function candidateQuery(input: Readonly<{
  machineHome: string;
  target: string;
  store: ControlRecordStore;
  selector: Extract<FoundationContextInspectionSelector, { kind: "code-index" | "code-file" }>;
  owners: FoundationContextInspectionRuntimeOwners;
}>): Promise<FoundationDeliveryQueryBasis | null> {
  if (input.selector.selection.candidate === null) return null;
  const context = foundationContextSelectionOf(input.selector.selection);
  return await input.owners.compileQueryBasis({
    machineHome: input.machineHome, target: input.target, store: input.store,
    boundary: context.boundary.reference, inspectionSelection: context,
  });
}

async function sourceQuery(input: Readonly<{
  machineHome: string;
  target: string;
  store: ControlRecordStore;
  selector: Extract<FoundationContextInspectionSelector, { kind: "source" }>;
  owners: FoundationContextInspectionRuntimeOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  const selection = foundationContextSelectionOf(input.selector.reference.selection);
  const query = await input.owners.compileQueryBasis({
    machineHome: input.machineHome, target: input.target, store: input.store,
    boundary: selection.boundary.reference, inspectionSelection: selection,
  });
  const basis = compileFoundationContextBasis(query, selection);
  if (basis.digest !== input.selector.reference.basisDigest) {
    fail("source-basis-substituted", "Source Reference does not reproduce its exact retained Context basis");
  }
  return query;
}

/** Select only artifact provenance; Authorization Review retains full currentness. */
export function foundationArtifactInspectionSelection(selector: FoundationContextInspectionSelector): FoundationInspectionSelection | null {
  switch (selector.kind) {
    case "knowledge-index": case "knowledge-record": case "atlas-overview": case "atlas-point": case "atlas-resource":
      return selector.context;
    case "code-index": case "code-file": return selector.selection;
    case "source": return selector.reference.selection;
    case "authorization-review": return null;
  }
}

function authorizationBoundary(input: Readonly<{
  state: FoundationDeliveryState;
  operation: Extract<
    FoundationContextInspectionSelector,
    { kind: "authorization-review" }
  >["operation"];
}>): ReturnType<typeof boundaryReference> | null {
  if (input.operation === "delivery.admit") {
    return boundaryReference(
      input.state.subjects.proposedBoundary ?? input.state.subjects.activeBoundary,
    );
  }
  if (input.operation === "delivery.accept") {
    return boundaryReference(input.state.subjects.activeBoundary);
  }
  const selected = input.state.subjects.activeBoundary ?? input.state.subjects.proposedBoundary;
  return selected === null ? null : boundaryReference(selected);
}

/** Route the closed nine-selector v17 context-inspection union to Runtime owners. */
export async function compileFoundationContextInspection(input: Readonly<{
  machineHome: string;
  target: string;
  store: ControlRecordStore;
  state: FoundationDeliveryState;
  generation: FoundationDeliveryGeneration;
  selector: FoundationContextInspectionSelector;
  owners?: FoundationContextInspectionRuntimeOwners;
}>): Promise<FoundationContextInspectionResult> {
  const owners = input.owners ?? DEFAULT_OWNERS;
  const selection = foundationArtifactInspectionSelection(input.selector);
  if (selection !== null) (owners.resolveSelection ?? resolveFoundationInspectionSelection)(input.store, selection);
  else if (input.selector.kind === "authorization-review") {
    assertFoundationInspectionGeneration(input.selector.expectedGeneration, input.generation);
  }

  if (
    input.selector.kind === "knowledge-index" ||
    input.selector.kind === "knowledge-record" ||
    input.selector.kind === "atlas-overview" ||
    input.selector.kind === "atlas-point" ||
    input.selector.kind === "atlas-resource"
  ) {
    const query = await selectedContextQuery({ ...input, selector: input.selector, owners });
    const basis = compileFoundationContextBasis(query, input.selector.context);
    if (input.selector.kind === "knowledge-index") {
      return compileFoundationKnowledgeIndex({ query, basis, selector: input.selector });
    }
    if (input.selector.kind === "knowledge-record") {
      return compileFoundationKnowledgeRecord({ query, basis, selector: input.selector });
    }
    if (input.selector.kind === "atlas-overview") {
      return compileFoundationAtlasOverviewInspection({ query, basis, selector: input.selector });
    }
    if (input.selector.kind === "atlas-point") {
      return compileFoundationAtlasPointInspection({ query, basis, selector: input.selector });
    }
    return await compileFoundationAtlasResourceInspection({
      query,
      basis,
      selector: input.selector,
    });
  }

  if (input.selector.kind === "code-index" || input.selector.kind === "code-file") {
    const query = await candidateQuery({ ...input, selector: input.selector, owners });
    return input.selector.kind === "code-index"
      ? await compileFoundationCodeIndex({
          ...input,
          repository: input.target,
          query,
          selector: input.selector,
        })
      : await compileFoundationCodeFile({
          ...input,
          repository: input.target,
          query,
          selector: input.selector,
        });
  }

  if (input.selector.kind === "source") {
    const query = await sourceQuery({ ...input, selector: input.selector, owners });
    const basis = compileFoundationContextBasis(query, foundationContextSelectionOf(input.selector.reference.selection));
    const content = input.selector.reference.sourceKind === "knowledge-body"
      ? resolveFoundationKnowledgeInspectionSource({
          query,
          basis,
          reference: input.selector.reference,
        })
      : input.selector.reference.sourceKind === "atlas-body" ||
          input.selector.reference.sourceKind === "atlas-resource"
        ? await resolveFoundationAtlasInspectionSource({
            query,
            basis,
            reference: input.selector.reference,
          })
        : await resolveFoundationCodeInspectionSource({
            ...input,
            repository: input.target,
            query,
            reference: input.selector.reference,
          });
    if (content === null) {
      fail("source-substituted", "Source Reference does not reproduce one exact Runtime-owned inspection source");
    }
    return compileFoundationSourceRange({
      basis,
      selector: input.selector,
      content,
    });
  }

  const selectedAuthorizationBoundary = authorizationBoundary({
    state: input.state,
    operation: input.selector.operation,
  });
  const query = selectedAuthorizationBoundary !== null
    ? await owners.compileQueryBasis({
        machineHome: input.machineHome,
        target: input.target,
        store: input.store,
        boundary: selectedAuthorizationBoundary,
      })
    : null;
  const currentRepository = query === null
    ? await owners.loadCurrentSnapshot(input.target)
    : null;
  return compileFoundationAuthorizationReviewInspection({
    store: input.store,
    generation: input.generation,
    selector: input.selector,
    query,
    currentRepository,
  });
}
