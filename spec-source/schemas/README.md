# Lifecycle Schemas

> Status: Draft

This directory publishes the machine-readable structural contracts selected by
the Lifecycle specification. All schemas use JSON Schema Draft 2020-12 and
stable Lifecycle URNs.

Schema validation establishes that a value has the selected bounded shape.
For example, a well-shaped Receipt can still name the wrong Seal, and a
well-shaped Packet can still lack adequate support. The semantic validator must
reopen the referenced subjects and apply the owning rules. JSON Schema does not
replace the normative
rules for authority, event order, relationship cardinality, canonicalization,
digests, reduction, sealing, archive, or security. Those rules remain in the
owning specification documents and require semantic validation.

## Control Record Store

- [`common.schema.json`](common.schema.json) defines shared identifiers,
  digests, paths, time values, actors, and Control revision references.
- [`control-record-store.schema.json`](control-record-store.schema.json)
  defines the identity and physical contract of one per-Delivery SQLite
  Control Record Store.
- [`control-record-revision.schema.json`](control-record-revision.schema.json)
  defines the one generic immutable revision envelope shared by every Control
  record family.
- [`control-record-event.schema.json`](control-record-event.schema.json)
  defines the closed twenty-five-event Delivery vocabulary and the exact,
  bounded payload of each event kind.
- [`control-record-file.schema.json`](control-record-file.schema.json) defines
  the content-addressed file references retained beside the store.
- [`control-record-store-seal.schema.json`](control-record-store-seal.schema.json)
  defines the immutable semantic store seal.
- [`control-record-store-archive.schema.json`](control-record-store-archive.schema.json)
  defines the archive manifest for one sealed store and its referenced files.
- [`control-lifecycle-profile.schema.json`](control-lifecycle-profile.schema.json)
  defines common revision states, ownership and editing policy, event
  relationships, the closed Delivery family registry, and the selected physical
  Store version. The v7 profile selects Event v6, Delivery reduction v5, and
  SQLite user version 3. The logical Store and revision envelopes select v2;
  file, seal and archive envelopes remain v1.

The generic revision envelope deliberately does not embed a union of every
family payload. The registry selects exactly one independent payload schema
from `recordKind`; validators apply that schema to the revision payload. This
keeps each family closed without recreating a complete-schema cascade.

## Delivery Payloads

Each file below validates only the record-owned payload for one family. Exact
relationships to other records stay in the generic revision envelope.

- [`director-brief-payload.schema.json`](director-brief-payload.schema.json)
  defines exact Director semantic input scoped to one Activity or one operation
  in a retained Work Delegation.
- [`work-delegation-payload.schema.json`](work-delegation-payload.schema.json)
  defines finite Director-supplied resource authority separately from the mandate,
  plus the closed reservation and cumulative accounting carriers. Each delegated
  reservation is retained in its existing Activity opening; stop requests remain
  private operational custody until the exact stopped event records them.
- [`agent-attempt-payload.schema.json`](agent-attempt-payload.schema.json)
  defines one funded, provider-neutral invocation contract.
- [`agent-work-product-payload.schema.json`](agent-work-product-payload.schema.json)
  defines the retained semantic Markdown result of an agent activity.
- [`execution-receipt-payload.schema.json`](execution-receipt-payload.schema.json)
  defines runtime-observed provider and compiler outcomes.
- [`candidate-revision-payload.schema.json`](candidate-revision-payload.schema.json)
  defines one runtime-observed reversible Candidate state.
- [`integration-assessment-payload.schema.json`](integration-assessment-payload.schema.json)
  defines exact source-independent integration construction and context facts;
  result state remains in the successor Candidate Revision.
- [`work-boundary-payload.schema.json`](work-boundary-payload.schema.json)
  defines the complete proposed or admitted Work Boundary envelope, including
  its nested mandate, exact governing basis, and selected profiles.
- [`material-condition-payload.schema.json`](material-condition-payload.schema.json)
  defines a runtime-derived condition that blocks honest work under the active
  mandate.
- [`director-decision-payload.schema.json`](director-decision-payload.schema.json)
  defines one exact authenticated admission, readmission, acceptance, or
  no-ship decision.
- [`candidate-seal-payload.schema.json`](candidate-seal-payload.schema.json)
  defines the runtime-authenticated facts that establish the exact evaluation
  subject.
- [`check-receipt-payload.schema.json`](check-receipt-payload.schema.json)
  defines modality-aware baseline or final Check outcomes.
- [`evidence-packet-payload.schema.json`](evidence-packet-payload.schema.json)
  defines bounded normalized Evidence ledgers and readiness.
- [`closure-payload.schema.json`](closure-payload.schema.json) defines the
  sufficient terminal Delivery facts after the authenticated transaction and
  exact Execution Containment, Runtime Retirement, and Reclamation handoff.
- [`delivery-reduction.schema.json`](delivery-reduction.schema.json) defines
  the ephemeral state derived from ordered events and referenced immutable
  revisions. Post-Closure store disposition is a non-event observation
  overlay that preserves closed standing and the terminal Candidate outcome.
  Activity recovery remains distinct from Candidate work condition, including
  recoverable `in-progress` work before effect intent.

## Repository, Knowledge, Projection, and Execution Inputs

- [`repository-contract.schema.json`](repository-contract.schema.json),
  [`product-state.schema.json`](product-state.schema.json),
  [`atlas-state.schema.json`](atlas-state.schema.json),
  [`atlas-resolution.schema.json`](atlas-resolution.schema.json), and
  [`repository-snapshot.schema.json`](repository-snapshot.schema.json) define
  the target repository, raw Atlas bytes, selected external resolved result,
  and exact observed epoch.
  Atlas Resolution structurally fixes the supported selection, complete/valid
  result combinations, and disposition-dependent Resource binding fields.
  `uniqueItems` rejects repeated complete Resource binding values; uniqueness
  by `resourceId`, code-point ordering, and digest equality remain semantic
  processor requirements because standard JSON Schema cannot compare one
  property across arbitrary array items.
- [`knowledge-record.schema.json`](knowledge-record.schema.json) defines the
  governed Knowledge v2 document envelope and six kind-specific values,
  preserving Discipline as advisory guidance.
- [`discipline-pack.schema.json`](discipline-pack.schema.json) defines exact
  publisher-owned distribution inventory, authoring provenance, and curated Sets.
- [`discipline-registry.schema.json`](discipline-registry.schema.json) defines
  tracked target adoption and Work Type discovery without implicit selection.
- [`projection-request.schema.json`](projection-request.schema.json) and
  [`knowledge-projection.schema.json`](knowledge-projection.schema.json)
  define bounded context selection and projection.
- [`capability-profile.schema.json`](capability-profile.schema.json),
  [`investment-allocation.schema.json`](investment-allocation.schema.json),
  and [`provider-descriptor.schema.json`](provider-descriptor.schema.json)
  define invocation inputs and the provider seam.

## Candidate Carriers and Private Execution

- [`candidate-revision-carrier-manifest.schema.json`](candidate-revision-carrier-manifest.schema.json)
  defines the content-addressed manifest for the Git object closure that can
  reconstruct one exact Candidate Revision.
- [`builder-repair-output.schema.json`](builder-repair-output.schema.json)
  binds a complete rejected Product Carrier to its builder Receipt for exact
  read-only repair, without selecting a Candidate Revision.
- [`execution-backend-profile.schema.json`](execution-backend-profile.schema.json)
  defines one installed Runtime-private Backend configuration and its bounded
  enforcement claims.
- [`execution-image.schema.json`](execution-image.schema.json) defines one
  immutable execution image, runner, and support-file identity.
- [`execution-input-set.schema.json`](execution-input-set.schema.json) defines
  the complete immutable logical input to one Agent Attempt or Check.
- [`execution-specification.schema.json`](execution-specification.schema.json)
  defines one Runtime-derived instruction for a subordinate Execution Cell.
- [`execution-observation.schema.json`](execution-observation.schema.json)
  defines sanitized direct terminal and containment facts without exposing a
  Handle or backend coordinate.
- [`execution-output-manifest.schema.json`](execution-output-manifest.schema.json)
  defines the every-and-only inventory of bounded provisional Cell output.

These schemas describe private mechanics and stable retained facts. They add no
Control family, Delivery event, public operation, CLI command, TUI stage, or
parallel workflow. The Delivery reducer remains the sole legal Process state
machine.

## Runtime and Interface Boundary

- [`context-inspection-selector.schema.json`](context-inspection-selector.schema.json)
  defines the closed nine-member selector union for bounded Knowledge, Code,
  Atlas, Source, and Authorization Review inspection.
- [`productive-semantic-operation.schema.json`](productive-semantic-operation.schema.json)
  defines the exact continue, evaluate, revise, and reaffirm input and requires
  the Runtime-issued expected read generation alongside semantic Markdown.
- [`authorization-review.schema.json`](authorization-review.schema.json)
  defines the deterministic read-only admit, accept, and no-ship review core.

The invocation-private Authorization Challenge has no public or retained JSON
Schema. It is volatile transport support and cannot become authority, Control,
Evidence, or a compatibility carrier.

## Validation and Publication

- [`validation-result.schema.json`](validation-result.schema.json) defines the
  standard validation result and diagnostic carrier.
- [`fixture-manifest.schema.json`](fixture-manifest.schema.json) defines
  expected fixture subjects and outcomes.
- [`publication-manifest.schema.json`](publication-manifest.schema.json),
  [`release-notes.schema.json`](release-notes.schema.json),
  [`publication-statement.schema.json`](publication-statement.schema.json),
  and [`conformance-claim.schema.json`](conformance-claim.schema.json) define
  publication identity, change, status, and implementation claims.

Knowledge processing selects `knowledge-structural-v2` and `knowledge-set-v2`;
target validation selects `repository-v9`. Pack and Registry structural
fixtures select their `discipline-pack-structural-fixture-v1` and
`discipline-registry-structural-fixture-v1` profiles. Semantic digest, provenance,
selection, and advisory-authority checks remain processor obligations.

A schema processor MUST register referenced schemas under their declared `$id`
values. Implementations MUST NOT claim conformance merely because a value
passes JSON Schema. The standard validation profiles and semantic requirements
are specified in [`../spec/VALIDATION.md`](../spec/VALIDATION.md).
