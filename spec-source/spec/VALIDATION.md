# Lifecycle Validation

> Status: Draft

## Purpose

This document defines standard Lifecycle validation profiles, conceptual stages,
completeness, validity, result objects, diagnostics, deterministic ordering,
semantic checks, fixture expectations, and validation security.

Validation establishes whether one exact subject satisfies one selected
contract. It does not supply missing Product Knowledge, perform Director
judgment, grant capability, accept a Candidate, or move canonical state.
[Execution](EXECUTION.md) owns the exact private Candidate Carrier and
Execution Backend subjects whose validation facts are consumed by the profiles
below. Those mechanics do not create a public Validation Result profile or a
Director-facing operation.

## Validation Result

A standard machine-readable result conforms to
[`validation-result.schema.json`](../schemas/validation-result.schema.json) and
contains:

- `schema`, exactly `lifecycle.validation-result.v1`;
- `specificationRevision`, the immutable publication revision or explicit Draft
  development identity;
- `publicationDigest`, the exact publication manifest digest, or `null` only
  when an explicitly incomplete Draft-development invocation has not bound one;
- `profile`, one requested standard profile or an implementation-owned
  namespaced profile;
- `subject`, including exact kind, identity, digest, revision, and locator when
  applicable;
- `complete`, whether every required stage of the requested profile finished;
- `valid`, whether the complete result contains no standard error diagnostic;
- ordered `stages` with explicitly declared completeness, derived validity,
  full diagnostic count, and duration;
- ordered `diagnostics`;
- `implementation`, identifying validator build, claim, schema engine, profiles,
  formats, and extensions;
- `limits`, the named material processing limits applied;
- `observedAt`; and
- the standard result `digest`.

Completeness answers whether the validator finished the selected profile;
validity answers what that completed work found about its exact subject.
Neither field says whether a Delivery can continue, whether Evidence is
sufficient, or whether an effect applied. Those conclusions belong to their
operation owners.

`complete: false` requires `valid: false`. An incomplete result does not show
that unperformed checks passed or failed. For example, unavailable required
bytes leave an observation incomplete. Completely observed bytes that violate
a schema can support a conclusive invalid result. Recovery and correction need
that distinction: restoration can complete the former observation, while the
latter supplies a definite defect to repair.

`complete: true, valid: false` means every required stage finished and at least
one error diagnostic exists.

`complete: true, valid: true` means every required stage finished and no
standard error diagnostic exists. Warnings and information diagnostics remain
visible and do not make the standard result invalid.

Every required stage appears exactly once in profile dependency order. The
validator declares each stage `complete` or incomplete as an input to result
construction. It MUST NOT infer incompleteness from a diagnostic-code suffix,
message, missing duration, or diagnostic count. An incomplete stage has
`valid: false`, and therefore makes the overall result incomplete and invalid.

The result `digest` is the canonical-value digest of the exact
`$defs.digestSubject` projection in
[`validation-result.schema.json`](../schemas/validation-result.schema.json).
That projection contains:

- `schema`, `specificationRevision`, `publicationDigest`, and `profile`;
- the complete normalized `subject`;
- overall `complete` and `valid`;
- every stage projected to `id`, `complete`, and `valid` in profile order;
- deterministic diagnostics projected without `message` and independently
  sorted by their deterministic fields;
- the exact applied `limits` object.

The projection excludes `observedAt`, `implementation`, stage `durationMs`,
stage `diagnosticCount`, diagnostic messages, and implementation-owned
information diagnostics. A diagnostic is implementation-owned only when its
code is outside the reserved `lifecycle.` namespace; standard information
diagnostics remain in the digest. Standard error and warning facts remain in
the digest, and an implementation-owned error or warning remains because it
changes the reported validity or supported profile.

The full result retains excluded operational metadata for inspection. A
validator constructs and freezes the full result only after the normalized
subject, explicit stage states, ordered diagnostics, limits, and digest are all
known. It MUST NOT publish a result, mutate its subject, and recompute its
digest afterward.

`implementation.schemaEngine` is a structured identity containing the exact
engine implementation and version, Draft dialect, format-assertion package, and
installed schema-set digest. `implementation.digest` binds that identity with
the validator identity, claimed class, supported profiles, format assertion,
and interpreted extensions. For a repository-bound profile, `supportedProfiles`
and `extensions` MUST equal the contract selections that the validator actually
interpreted. A string engine label, an omitted schema-set digest, or a selection
that differs from the contract is not an exact implementation identity.

A repository or organization policy can run an additional namespaced profile
that elevates a warning or adds policy diagnostics. It MUST NOT alter the
standard result, reuse the same digest, or present policy validity as standard
validity without naming the profile.

## Standard Profiles

Every standard profile identifier carries its own version. An implementation
MUST support the complete requirements of that exact profile before it claims
the profile. A partial implementation uses an implementation-owned namespaced
identifier and discloses every omitted standard stage. A validator MUST NOT
silently map a prior profile to a current one.

### `publication-release-v1`

Validates one immutable publication package and, when lifecycle status is
claimed, its external Release Notes, Publication Statement, and independently
selected release-authority trust root.

The profile validates:

- canonical specification identity `lifecycle` across the Publication
  Manifest, Fixture Manifest, repository-contract fixtures, Release Notes, and
  Publication Statement;
- exact specification-revision equality across every non-negative publication
  carrier that selects the active qualification revision; a Discipline Pack
  authoring revision is separately retained provenance and is not such a
  selection;
- complete code-point-ordered document, schema, and fixture inventories and
  exact file byte digests;
- declared document status equality and the distinction between document
  maturity and publication lifecycle status;
- Publication Manifest, Release Notes, statement-subject, and statement
  self-digests under the exact acyclic construction in Processing;
- Release Notes change identities, owner paths, schema and profile sets,
  hard-cut fields, limitations, and operator actions, including their required
  ordering and uniqueness;
- immutable source-revision syntax and non-Draft candidate or release identity;
- exact publication-authority principal and key selection plus Ed25519
  signature verification over the canonical statement subject; and
- status eligibility: `candidate` requires a frozen internally coherent
  package, while `released` additionally requires Accepted document scope and
  all applicable Conformance gates.

An invocation that has no independently selected release-authority trust root
can validate manifest preparation but MUST return `complete: false` for a
claimed lifecycle status. An embedded or caller-substituted key cannot complete
the profile.

### `lifecycle-document-v1`

Validates one exact repository-authored Knowledge Lifecycle Document under one
selected document profile.

For every Lifecycle Document it performs:

- strict UTF-8, byte-limit, delimiter, and RFC 8259 JSON-header parsing;
- duplicate-key, bounded-data-model, and profile-specific header validation;
- exact CommonMark title, section, anchor, fragment, and repetition rules;
- typed-reference shape and reference-target resolution where the selected
  profile requires a closed subject set;
- header/body authority separation and provenance-class validation;
- body and fragment digest reproduction; and
- external whole-document byte-digest reproduction from the exact retained
  bytes supplied as the validation subject.

Repository-authored Knowledge preserves its source layout and body bytes under
the Knowledge v2 source and semantic digest rules. This profile does not parse,
validate, or confer standing on a Control Record Store revision or a derived
Markdown export of one.

### `lifecycle.agent-work-product-parser.v4`

Validates one submitted governed `semantic.md` value against the exact
Attempt-bound body profile for `reconnaissance`, `builder`, or `reviewer`.

It performs exact bounded UTF-8 and LF normalization, title and supported-
section validation, local-anchor and typed-metadata validation, role-specific
semantic-combination checks, omission handling, and return-local handle
resolution. It treats permitted section order, metadata order, blank-line
layout, and sole-code-span token spelling as nonsemantic. It rejects Control
headers, fixed runtime bindings, global identities, digests, canonical ordering
assertions, runtime wrappers, and any role profile not selected by the Attempt.

The parser produces one bounded ephemeral typed runtime value. That value is
not a public schema, fixture carrier, retained Control revision, or
Agent-authored protocol envelope. Invalid Agent semantics produce
`invalid-submission`; parser failure does not create an Agent Work Product.

### `lifecycle.agent-work-product-compiler.v4`

Validates deterministic compilation from one valid parser value and the exact
frozen Agent Attempt bindings into the `agent-work-product` Control payload and
semantic Markdown retained in one immutable Control revision.

It reproduces fixed-binding injection, exact reference resolution,
deterministic global identity assignment, scalar normalization and set ordering,
runtime-canonical semantic Markdown rendering, semantic preservation, body and
fragment bindings, payload-schema validation, relationship validation, and the
revision logical digest. Workspace-raw, observed-submission, parse-result,
fixed-binding, retained-body, and Work Product digests remain distinct.

Two valid drafts that produce the same normalized typed semantic value MUST
compile to byte-identical retained Markdown, payload, body binding, fragments,
and logical revision when their exact fixed inputs are the same. The compiler
reparses its rendered Markdown and requires semantic equality before retention.

Deterministic disproof of an Agent-proposed reference or semantic relationship
is `invalid-submission`. A missing fixed binding, unstable identity, invalid
payload, non-reproducible body binding, or retained-revision invariant failure
is `runtime-failure`. The compiler MUST NOT repair invalid Agent semantics,
invent a claim, or relabel agent-proposed content as a runtime fact.

The selected [local draft assistance profile](ATTEMPTS.md#local-draft-assistance)
reuses this parser and semantic compiler for advisory inspection of explicit
draft bytes against a compact immutable basis. It reports the observed source
digest, checked basis digest and scope, with bounded correction diagnostics.
A local success does not authenticate the basis or establish currentness,
Candidate validity, or submission. Runtime MUST independently run the frozen
parser/compiler basis after Containment and exact Output Carrier retrieval.
Missing or invalid basis is a runtime-failure of that local observation, never
a fabricated empty context or a claim that the draft is valid.

The durable Execution Receipt diagnostic is narrower. It contains exactly
`code`, `stage`, and `factsDigest` for the final observed submission failure.
It omits messages, source excerpts, locations, local handles, expected tokens,
provider output, and correction advice. That projection supplies stable
failure identity for recovery and inspection without retaining Agent draft
content.

### `foundation-delivery-control-lifecycle-v7`

Validates one complete `lifecycle.control-record-store.v2` subject under the
closed Foundation Delivery lifecycle profile.

It performs:

- exact Store metadata, physical profile, schema, application identifier, and
  custody validation;
- common `lifecycle.control-record-revision.v2` shape, payload-schema,
  semantic-Markdown binding, authority, producer, semantic-author,
  relationship, revision-policy, and logical-digest validation;
- complete fourteen-kind family-registry correspondence;
- complete `lifecycle.control-record-event.v6` envelope, the same closed
  twenty-five-kind vocabulary, closed-kind payload,
  contiguous sequence, immediate-predecessor, subject, atomic-finalization,
  and logical-digest validation;
- fail-closed gap, fork, duplicate, unknown-kind, cross-Delivery, illegal-order,
  unavailable-revision, and event-payload duplication checks;
- exact referenced-file descriptor and reachability validation;
- exact operation-support compare-and-swap generation, payload digest,
  activity binding, atomic support-and-event transition, one-time Cell dispatch,
  terminal Containment, Runtime-owned Retirement, and disposal rules;
- exact Candidate Revision Carrier manifest and content integrity, durable
  publication before Control selection, selected-Carrier availability, safe
  deterministic materialization, and successor nullability;
- exact private Execution Backend Profile, Specification, Input Set, Image,
  allocation-key, Handle, Output Carrier, Output Manifest, terminal observation,
  Containment, and Retirement facts without disclosure of private coordinates,
  plus any immutable terminal Reclamation handoff or obligation-set digest
  selected by Closure without mutable Reclamation progress;
- for acceptance, one same-Decision intent and effect digest with one terminal
  observation: applied facts bind the exact canonical-result digest, any
  pre-effect canonical or authoritative-worktree movement is `not-applied`, and no
  replacement parent, intent, or plan is legal;
- pure deterministic replay into one `lifecycle.delivery-reduction.v5` value,
  with `active` standing immediately after an applied initial-admission effect,
  `absent` Candidate condition whenever no current Candidate exists, and the
  terminal Candidate condition unchanged by Store-disposition recovery; an
  unresolved Candidate-touching Activity at `started` or `prepared` remains
  `in-progress` despite its pre-effect recovery coordinate when no stronger
  Material Condition, acceptance-ready Evidence, or sealed-evaluation
  projection applies, then projects `terminal-recovery` after advancing beyond
  that preparatory stage;
- exact Store logical inventory, seal, terminal head, adjacent-file set, and
  archive correspondence, preserving fourteen record families and twenty-five
  event kinds; and
- deletion-and-rebuild equivalence for every cache and derived Attempt View.

A current-row view, exported Markdown, interface cache, or caller-supplied
reduction is never replay input. The validator does not infer a missing event,
choose a branch, substitute a latest revision, or treat operation support as a
second event source.

### `knowledge-structural-v2`

Validates one governed Knowledge file without discovering other records or
repository implementation.

It performs:

- text and byte-limit checks;
- exact front-matter delimiters and JSON construction;
- kind-selected JSON Schema validation;
- physical locator-to-kind classification when the locator is supplied;
- identifier prefix and field-level lifecycle syntax;
- CommonMark parsing;
- required title and section checks;
- Discipline's advisory-only field and section shape, including optional-only
  source declarations;
- relationship syntax but not target resolution;
- coverage selector syntax but not target expansion;
- URI-reference syntax but not external retrieval; and
- source and semantic digest computation or verification.

This profile does not establish currentness, graph validity, Description
coverage, Check Binding compatibility, or repository conformance.

### `knowledge-set-v2`

Includes `knowledge-structural-v2` for every discovered record and validates one
complete Knowledge Set at an exact repository tree.

It performs:

- fixed-locator discovery;
- stable identity uniqueness;
- complete Product Knowledge revision chains and exact supersession, while
  Discipline retains structurally valid publisher revision provenance without
  requiring unadopted publisher predecessors in the target;
- current-record index construction;
- Discipline Registry shape, self-digest, adopted-record correspondence, Pack
  provenance, and Work Type references;
- Product Knowledge owner resolution required by the repository contract and
  exact Discipline publisher resolution through the adoption's Pack entry;
- typed relationship target and kind validation;
- cycle and dependency-component checks;
- current Behavior and Assurance Check requirements;
- exact reciprocal Assurance and Blueprint conflict validation plus derived
  structured Behavior conflicts;
- one ordered source-resolution result for every declaration under the selected
  retrieval policy, including explicit requiredness and disposition, while
  requiring every Discipline declaration to remain optional;
- Description primary coverage over governed implementation roots;
- Check Definition to Binding compatibility over the complete exact subject
  selector set, evidence kinds, and four-state parser model;
- repository-selected structural, graph, record, and source resource limits;
- ordered source and conflict manifest carriers; and
- deterministic Knowledge Set canonicalization and digest.

A complete valid result proves correspondence and internal contract validity. It
does not prove that product judgment is wise or that implementation conforms.

### `repository-v9`

Includes `knowledge-set-v2` and validates the complete Lifecycle repository
profile at one exact canonical commit and tree.

It performs:

- fresh-project contract selection and predecessor or mixed-state refusal;
- repository-contract schema and semantic validation;
- exact `records/behavior` selection as the sole Behavior Knowledge root,
  alongside the fixed Assurance, Blueprint, Check, Discipline, Discipline
  Registry, and Description locators;
- target, canonical ref, generation, specification publication, runtime
  compatibility, owner-registry, exact-tree source-policy, installed-schema-registry,
  supported-profile, runtime, provider, interface-protocol, and interpreted
  extension selection;
- exact Git object and file-mode checks;
- exact mandatory Atlas root, entrypoint, release, immutable specification
  revision, authored format, processor contract revision, resolved profile,
  result schemas, and consumer-profile selection;
- exact Product State and Atlas State construction under their published
  schemas and digest subjects;
- selected Atlas processor availability and installed file-manifest digest;
- complete valid external resolved validation, schema-valid normalized output,
  exact repository-local Resource bindings, and Atlas Resolution reproduction;
- preservation of Map, Area, Point anchor/context, relation, Resource, Check,
  publication-profile, and source provenance required by the selected Atlas
  consumer contract;
- one repository snapshot digest over target, commit, tree, Git object format,
  contract, Product State, Atlas State, Atlas Resolution, normalized Atlas
  model, and Knowledge Set;
- rejection of ignored, untracked, symbolic, executable, submodule, Gitlink, or
  otherwise unbound authoritative material;
- governed implementation root and exemption validation;
- Check Binding and Capability Profile registry validation;
- exclusion and refusal of every repository-visible Delivery Control carrier;
- exact repository-v22 selection of Control Store v2, revision v2, event v6,
  file v1, seal v1, archive v1, Delivery reduction v5,
  `foundation-delivery-control-lifecycle-v7`, runtime-v17, interface-v17,
  Provider Adapter v7,
  `lifecycle.execution-backend-profile.docker-local.v1`,
  `lifecycle.execution-cell-runner.v1`, Candidate Revision Carrier Manifest v1,
  Execution Specification v1, Input Set v2, Image v1, Observation v1, Output
  Manifest v1, and exact Atlas integration coordinates; and
- one coherent repository-epoch result.

The Knowledge input is one separately completed valid `knowledge-set-v2` result
and manifest whose subject digest, publication digest, commit, tree, Product
State, Atlas State, Atlas Resolution, and normalized-model bases match the
repository snapshot. Snapshot binding derives the Knowledge Set digest from
that manifest; it does not accept an unaccompanied caller-supplied digest.
Repository validation does not rerun Knowledge from live worktree bytes, read
Atlas meaning from the mutable worktree, or mutate either completed result.

Non-authoritative live worktree dirt can be reported separately. A tracked
authoritative modification, or untracked or ignored material below an
authoritative root, makes `repository-v9` invalid. It never replaces or changes
the exact canonical snapshot subject reported by the result.

### `lifecycle.work-boundary.foundation-v3`

Validates one immutable `work-boundary` Control revision against a complete
`repository-v9` result, the exact reconnaissance Work Product, and the selected
Foundation Control lifecycle profile. Proposal readiness and active standing
are reducer-derived; they are not separate records or variants.

It performs:

- identity, revision, supersession, and resolution validation;
- complete field-root derived changed-field paths for revision, a nonempty
  semantic change for revision, and an empty stable semantic projection for
  the objective, mandate, selected Knowledge, Checks, and propositions for
  reaffirmation even though fresh provenance coordinates differ;
- exclusion of freshly observed repository, Product State, Atlas, Knowledge
  Set, Projection-compiler, and Check Binding-set coordinates from the semantic
  changed-field set while still requiring those baseline coordinates to be
  exact and current;
- exact repository, Atlas State, Atlas Resolution, normalized-model, Product
  State, Knowledge Set, compiler, Capability Profile, Projection profile, and
  Check Binding bases;
- selected current Knowledge identity and digest checks;
- source-context authority and immutability checks;
- mandate completeness and non-itinerary structure;
- obligation normalization and coverage;
- required artifact role and path checks;
- Description expectations;
- effect, risk, and treatment coverage, including portable lexical
  normalization of `local-read` and `local-write` Effect targets and rejection
  when the resulting repository scope is at, below, or contains the
  authoritative Atlas root;
- Check Definition, Binding, modality, baseline, and environment compatibility;
- exact evidence-identity closure from every risk, obligation, and proposition
  to a declared required artifact, with Check Receipts derived through the
  selected Check rather than predeclared as future identities;
- proposition coverage for every required obligation, effect, risk, artifact,
  and exclusion;
- exact `uses-brief`, `proposed-from`, optional `revises`, and optional
  `resolves` relationship cardinality;
- typed-payload, semantic-Markdown, body-binding, compiler-coordinate, and
  logical-revision-digest validation;
- baseline Receipt completeness and exact same-Boundary subject binding; and
- absence of future admission, transaction, Candidate, or canonical-result
  observations from the immutable Boundary revision.

This profile does not compile a Projection or prove a final Candidate.

Preparation compiles the exact revision from one Director Brief, reconnaissance
Agent Work Product, complete Repository Snapshot and `repository-v9` result,
Knowledge Set, Orientation Projection, and selected profiles. The runtime then
runs every selected baseline Check against that same revision. The event fold
derives proposal readiness only when the complete modality-valid Receipt set is
durable and the activity completes. A stale Receipt, missing or duplicate
required Check, unknown citation or path, incompatible profile, material
uncertainty, or incomplete Containment or Retirement makes preparation fail
closed without inventing another Boundary carrier.

### `lifecycle.director-decision.foundation-v1`

Validates one immutable `director-decision` Control revision and its exact
`admit`, `readmit`, `accept`, or `no-ship` authenticated subject.

It performs:

- exact Decision variant, target, Delivery, reducer head, generation,
  repository basis, selected role-bearing Control revisions, and transaction
  rule binding;
- every-and-only proposal-ready Boundary and baseline Receipt selection for
  `admit` and `readmit`;
- active predecessor, Material Condition, and continuing Candidate selection
  for `readmit`;
- exact active Boundary, Candidate Revision, Candidate Seal, and
  acceptance-ready Evidence Packet selection for `accept`;
- for `accept`, the exact integration parent commit and tree, exact sealed
  Candidate tree, Candidate no-Atlas-delta proof, and authority for no alternate
  parent, Atlas selection, merge, rebase, or composition;
- exact available Boundary, Candidate, Condition, and supported disposition
  selection for `no-ship`, including legal nullability before admission;
- for `no-ship`, the selected Boundary's historical repository and Atlas basis
  when one exists, or one complete valid exact current basis when no Boundary
  trust subject has ever existed;
- canonical subject digest, authorization time, optional expiry, nonce,
  principal, key, algorithm, and Ed25519 signature verification;
- `authorizes` relationship correspondence; and
- semantic Markdown, typed payload, relationship, and logical revision digest
  correspondence.

A valid Decision authenticates only its exact subject. Admission, readmission,
acceptance, and no-ship standing change only after the retained transaction
effect is truthfully observed and the event fold applies it.

The configured principal may represent a human or an agent Director. Validation
MUST apply the same exact identity, signature, subject, and currentness rules;
it MUST NOT infer authority from a role label or require an additional human
decision because the caller is an agent. A Worker proposal remains outside this
authentication contract until the responsible Director supplies an exact
authorized decision through its owning route.

### `lifecycle.integration-assessment.foundation-v1`

Validates one runtime-owned Assessment and its exact governed-by/integrates
relationships, complete self-digested parent Snapshot, fixed retained merge rule,
ordered conflict/diagnostic/context facts, and supported outcome. Constructed
requires complete valid result observation with no conflicts. Failed assembly
selects no Candidate. Integration successors require the exact Assessment/source
join and P application base; ordinary successors cannot change that base.

The structural fixture profile
`integration-assessment-payload-structural-fixture-v1` checks bounded payload
shape and conditional outcome fields only. Exact relationship, currentness,
Carrier, merge execution, and contextual fingerprint validation require semantic
and physical owners; schema success is not operated integration evidence.

### `lifecycle.material-condition.foundation-v3`

Validates the exact active Boundary, frozen Candidate, common immutable record,
and source-specific joins. Agent proposals require a Work Product and Execution
Receipt. Integration context change requires its exact constructed Assessment,
requires-readmission comparison, and successor Candidate, with no fake Agent
record. Its observedFactsDigest binds contextualApplicability. The Projection
compilation variant requires an exact compiler-owned complete-closure or
mandatory-item measurement, its request/profile/compiler binding, an explicit
pre-intent refusal requiring a Condition, and the exact Boundary/Candidate/Seal
joins. It forbids invented Agent provenance. All variants preserve source
provenance and exact currentness; none supplies Director rationale or activates
a new mandate. Source-specific relationships fail under
`lifecycle.control-record-policy.relationship-cardinality`; mismatched refusal
provenance fails under `lifecycle.delivery.condition.binding` or the exact
reducer reference/payload diagnostic before retention.

### `orientation-projection-v1`

Validates one Orientation Projection against one exact loaded repository epoch,
deterministic Knowledge observation, repository and Knowledge validation
results, and exact Director objective. Knowledge observation can be incomplete
or invalid; Orientation exists to expose those conditions and therefore does
not require a usable Repository Snapshot or Knowledge Set. Atlas is different:
the request still requires one complete valid Atlas Resolution and normalized
model because Foundation cannot prepare a Delivery without its mandatory
context system.

It performs:

- coherent repository and objective basis;
- the complete Orientation objective's semantic-text UTF-8 byte bound and its
  exact reproduction in the attention core, as owned by
  [Projection Request](PROJECTION.md#projection-request);
- complete deterministic observation index and validation-condition exposure,
  including every readable current Knowledge record and relationship;
- governed implementation roots, Description coverage and exemptions, every
  exact registered Check Binding, supported Capability and Projection Profiles,
  and retrieval-inventory binding;
- exact Atlas State, Atlas Resolution, normalized-model, semantic-unit, and
  authorized Resource binding;
- reachable-context handle identity;
- all seven exact profile bounds, per-item limits, count recomputation, and the
  deterministic per-category omission manifest;
- exact core and item content digests;
- deterministic ordering; and
- Projection digest.

An Orientation Projection can be usable while it exposes product conflicts for
reconnaissance. It MUST not represent those conflicts as resolved.

### `execution-projection-v1`

Validates or independently recompiles one builder or reviewer Projection from
an exact active Work Boundary and subject.

It performs:

- every request and basis check in [Projection](PROJECTION.md);
- exact mandatory root seeding;
- universal relationship fixed-point closure;
- role-specific additions;
- Description coverage of admitted and actual affected implementation;
- Check Binding closure;
- complete Candidate Seal and sealed Candidate observation for reviewer;
- required source-context availability;
- authority-conflict and unresolved-reference handling;
- attention-core obligation completeness;
- exact item provenance and inclusion reasons;
- zero mandatory omission;
- all seven profile bounds and exact count recomputation;
- empty conflict and unresolved-reference arrays in a successful result;
- deterministic ordering and content mounts; and
- Projection digest.

A mandatory closure that cannot fit the selected complete profile is an invalid
or incomplete result according to the failure cause. It is never a valid
truncated Projection.

### `lifecycle.agent-attempt-payload.v3`

Validates one Agent Attempt immediately before provider dispatch.

It performs:

- exact Process and repository state;
- role-to-subject compatibility;
- active Work Boundary and Projection currentness;
- Candidate Revision and Seal binding as the role requires, plus the exact
  Attempt evidence-set digest;
- exact registered Capability Profile identity and materialized effective-grant
  subset;
- no unauthorized writes for read-only roles;
- Investment allocation bounds fixed before dispatch;
- Provider Descriptor v7, adapter rendering, protocol, and compatibility
  identity;
- exact Execution Backend Profile, Execution Specification, Execution Input
  Set, Execution Image, fixed Cell-runner contract, and idempotent allocation
  key selected privately by the Runtime;
- proof that provider control-plane network and authentication are separated
  from Agent product capability, or `unsupported` before dispatch;
- absence of a Cell-visible Docker socket, Runtime-private target mount,
  authority root, Control Store, another Cell, or mutable Candidate Carrier;
- exact governed semantic-body template, Agent Work Product parser and
  compiler, payload schema, and implementation digests;
- complete installed role support for reconnaissance, builder, or reviewer
  before dispatch of that role;
- the exact combined citation-only registry of unique Attempt-bound item
  identities with runtime-owned kind, digest, and locator, including only
  unique verified mounted reachable Projection items and without asking the
  Agent to reproduce any citation mechanics;
- exact immutable bounded Input Set inventory and digest, including the selected
  Candidate Revision Carrier or proof subject, Projection mounts, Role Brief,
  semantic template, and Cell-runner command without a cyclic output digest;
- exact compiled Role Brief identification of Worker, technical assignment,
  and Director counterpart, with the selected Director Brief and
  [operating guidance](AUTHORITY.md#operating-roles), without authority credentials
  or a new human approval requirement;
- cancellation, parent-loss, Cell Containment, workspace, submission,
  Retirement, and Reclamation policy; and
- typed payload, semantic Markdown, relationships, ordering, and logical
  revision digest.

A Provider Adapter or Execution Backend that cannot enforce the exact
Capability Profile, provider-control-plane separation, governed workspace,
bound role template, Image, Input Set, or no-Docker-socket/no-target-mount rule
makes the Attempt unsupported before dispatch. It MUST NOT substitute a broader
profile, host workspace, or provider terminal-output carrier.

### `lifecycle.execution-receipt-payload.v3`

Validates one provider Execution Receipt after any terminal invocation outcome.

It performs:

- exact Agent Attempt, Provider Descriptor, Investment, Capability Profile, and
  Execution Specification and Input Set binding;
- exact sanitized Backend Profile, Image, Cell-runner, Specification, Input Set,
  Output Manifest, terminal-observation, Containment, and Retirement digests or
  classifications without exposing allocation key, Handle, Cell identity,
  Engine endpoint, credential, private environment, path, or Reclamation
  coordinate;
- allocation idempotence, durable one-time dispatch consumption, and refusal of
  any redispatch or replacement Cell after the dispatch boundary;
- rendering, supported capability materialization, immutable Input Set
  availability, and exact provider-control-plane separation for every
  productively started or returned provider execution;
- first-trigger provider outcome, productive-start, cancellation, terminal
  observation, and Cell Containment consistency;
- normalized failure code, stage, and bounded facts identity without raw error
  content;
- retrieved Output Carrier and Manifest availability, governed workspace exact
  observed byte count and byte digest,
  UTF-8 validity, submission disposition, and bounded retention without
  embedding workspace bytes, a transcript, provider events, or base64 bytes in
  the Receipt;
- correspondence between the Agent Attempt workspace bound and the observed
  submission before semantic parsing;
- separate parser provenance, template and implementation digests,
  final submission diagnostic, disposition, and semantic-IR digest when valid;
- separate compiler provenance, implementation and fixed-binding digests,
  disposition, and bounded failure facts;
- exact classification of malformed semantic Markdown as parser
  `invalid-submission`, disproved Attempt-bound Agent semantics as compiler
  `rejected` and `invalid-submission`, and post-parse compiler invariant failure
  as `runtime-failure`;
- refusal of Agent-authored citation kind, locator, digest, identity, or order,
  reviewer aggregate `Complete`, and Work Boundary semantic-proposal
  `Complete`, with runtime derivation of those canonical mechanics;
- reviewer aggregate completeness derived only after every-and-only projected
  proposition coverage and from `review-complete` versus
  `review-indeterminate`, plus Work Boundary semantic-proposal
  `complete: true` derived only after complete proposal validation;
- exact Agent Work Product revision, logical digest, runtime-canonical body and
  fragment bindings, and semantic subject binding when compilation succeeds,
  without requiring its body digest to equal the observed submission digest;
- exact citation kind, locator, subject digest, identity, and ordering derived
  from the unique frozen Attempt registry by Agent-authored item identity only;
  for `projection` citations this includes mounted reachable-item membership
  reproduced from the Attempt's verified compiled Projection, with
  inaccessible, resolver, duplicate-identity, and non-reachable material absent
  from that registry;
- provider-output and resource-bound facts;
- exact input Candidate Revision and Carrier binding for builder and reviewer roles,
  null for reconnaissance;
- builder-only `candidateSuccessorDisposition` of `promoted`, `not-produced`,
  `unavailable`, or `invalid`: `promoted` requires one exact successor Candidate
  Revision and Carrier, while every other value requires a null successor and
  creates no Candidate Revision; and
- Containment and Runtime-owned Retirement observation plus typed payload,
  semantic Markdown, relationships, ordering, and logical revision digest
  without allowing execution disposition to rewrite provider outcome, Work
  Product validity, or Candidate successor classification.

An invocation with no valid Agent Work Product can still have one valid Receipt
and, independently, a promoted complete valid Candidate successor. An invalid,
unavailable, or absent Candidate output leaves the prior Candidate current even
when the Work Product is valid. The Receipt itself classifies provider failures;
an Attempt View does not reinterpret an exception.

### `attempt-view-v1`

Validates one disposable Attempt View compiled from one exact validated Store
head. The view is not a Control record, event, authority subject, or recovery
input.

It performs:

- exact Control Store, Delivery, event-head, reducer, view-profile, Attempt,
  Work Product, Receipt, input Candidate Revision, optional promoted successor,
  Boundary, and activity binding;
- one coherent coordinate with no mixture of stale and current projections;
- strict separation of runtime observations, runtime-derived conclusions,
  agent-proposed semantics, and Director-supplied or authenticated values;
- complete active-Boundary obligation and Evidence-state coverage;
- exact Candidate, Material Condition, Check, review, and Evidence standing;
- exact provider outcome, Work Product disposition, and Candidate successor
  disposition without inferring one from another;
- only sanitized stable Execution Backend Profile, Image, Input Set, Output
  Manifest, Containment, and Retirement facts, with no private Handle, Cell,
  Engine, credential, path, allocation-key, or Reclamation coordinate;
- exact complete eligible-operation identities from the same reduction;
- bounded Investment observations without interpreting cost, time, tool count,
  output volume, or Candidate motion as progress; and
- the diagnostics and fail-closed incompleteness rules in
  [Attempt View](ATTEMPT_VIEW.md#failure-and-incomplete-views).

Deleting every view cache MUST leave compilation, eligibility, and recovery
unchanged. Before acting, the runtime reopens and revalidates the live Store;
the view is never a transition permit.

### `lifecycle.check-receipt.foundation-v1`

Validates one Check Receipt.

It performs:

- Check Definition and Binding currentness and compatibility;
- exact proof subject and phase;
- null active-boundary and Candidate-base commits for a pre-admission base
  subject, and exact non-null values for working and sealed subjects;
- modality legality;
- proof-environment contract and observed digest;
- exact Backend Profile, Image, Specification, Input Set, Cell-runner,
  Output Manifest, mechanism lifecycle, timeout, cancellation, parser, and
  mutation facts;
- exact Binding-requested condition derivation;
- closed runtime-enforced conditions and Director-managed host assumptions;
- verified Cell Containment and Runtime-owned Retirement after natural return,
  timeout, or cancellation;
- protected runtime environment construction;
- disposition semantics;
- exact raw-output byte digests, byte counts, media types, locators, retention,
  and redaction;
- truthful separation of requested and enforced environment policy;
- inherited limitations; and
- typed payload, semantic Markdown, relationships, ordering, and logical
  revision digest.

A schema-valid `pass` with missing required campaign, semantic result,
Containment, or Retirement facts is invalid.

A signaled mechanism is valid only with `operational-error` disposition. A
validator rejects a Receipt that treats signal termination as a semantic
product result, claims an unmediated network request was enforced, exposes a
private execution coordinate, or reports a semantic result without verified
Containment, Retirement, and protected-environment construction.

### `lifecycle.candidate-seal.foundation-v1`

Validates one Candidate Seal and its underlying immutable Candidate Revision
Carrier.

It performs:

- immutable Candidate base and active boundary identity;
- exact selected Carrier manifest, complete Git object closure, durable
  publication, and availability;
- complete sealed tree, diff, path inventory, and artifact-set reproduction from
  that Carrier;
- file kind and Git mode validation;
- ignored/untracked/prohibited material exclusion;
- changed Knowledge Set validation against the Candidate tree;
- Description coverage over the Candidate;
- required artifact disposition; and
- typed payload, semantic Markdown, relationships, ordering, and logical
  revision digest.

### `lifecycle.evidence-packet.foundation-v2`

Includes the current Check Receipt, Candidate Seal, reviewer Attempt, reviewer
Agent Work Product, and Execution Receipt validation and validates one
`evidence-packet` Control revision. Artifact observation, Description coverage,
Receipt reuse, invalidation, reviewer independence, review decisions, and
obligation standing are typed ledgers inside this one Packet payload; they are
not separate current carriers.

The [Evidence verifier](EVIDENCE.md#evidence-verifier) owns this interpretation
independently of Packet assembly. It validates exact retained justification
after evaluation as well as during finalization, preserving required Activity
and event provenance. Reducer-derived currentness and fresh physical
observations remain separately required when that justification is selected
for a new canonical effect.

It performs:

- exact Work Boundary, admitted canonical Product State and Knowledge Set,
  Candidate Seal result Product State and Knowledge Set, and reviewer Projection
  basis, without requiring the canonical and Candidate states to be equal;
- exact current Candidate integration lineage and parent Snapshot, required
  Condition/readmission provenance, and reviewer mandate/baseline applicability;
- required artifact and Description coverage results;
- baseline and final Receipt completeness by selected Check, Binding, phase,
  and modality;
- modality-legal baseline dispositions and passing required final Receipts;
- Receipt reuse and invalidation decisions;
- reviewer Agent Attempt, validated Execution Receipt, exact compiled
  Projection identity, Agent Work Product, and independence facts;
- exactly one legal decision per acceptance proposition;
- exact decision limitation and missing-obligation fields compiled from the
  reviewer Work Product's typed payload and body fragment;
- Evidence, Knowledge, and path citation subject identity;
- final obligation ledger completeness;
- effect and risk coverage;
- uncertainty and diagnostic consistency;
- acceptance-readiness derivation; and
- typed payload, semantic Markdown, relationships, ordering, and logical
  revision digest.

Every Packet relationship resolves to exactly one retained Control revision of
the registry-permitted kind. Each subject MUST match the Packet Delivery, Work
Boundary, Candidate Seal, and reviewer coordinate. A missing, duplicate,
altered, wrong-kind, or cross-subject revision is invalid even when the Packet
payload alone passes JSON Schema.

`readiness: acceptance-ready` is invalid unless every required obligation is
`satisfied`, every required proposition is accepted or legally not applicable,
and no material uncertainty remains.

### `lifecycle.delivery-closure.foundation-v1`

Validates one sufficient accepted or no-ship `closure` Control revision after
an applied Director-authenticated terminal transaction.

It performs:

- exact active Work Boundary and accepted or no-ship terminal subject;
- exact Director Decision, applied effect digest, outcome, and observation time;
- disposition-specific Work Boundary, Candidate Revision, Candidate Seal, and
  Evidence Packet relationship cardinality;
- exact sealed Candidate publication over the exact integration parent, or
  verified no-ship non-publication;
- exact integration parent commit and tree plus accepted commit and tree when
  accepted;
- equality of accepted tree, Candidate digest, Product State digest, and
  Knowledge Set digest with the selected Candidate Revision, Seal, and Evidence
  subject;
- proof that the Candidate contains no Atlas delta relative to its exact
  application parent and carries that parent's Atlas subtree byte-identically
  into the accepted tree;
- legal `integrated`, `abandoned`, or `not-created` Candidate
  treatment;
- complete Containment and Runtime-owned Retirement facts, empty Store drafts,
  removed live Activity support, and the immutable terminal Reclamation handoff
  or obligation-set digest and whether obligations existed at Closure, without
  retaining mutable Reclamation progress;
- runtime, rule, repository, protocol, provider, and terminal-time coordinates;
- typed payload, semantic Markdown, relationships, ordering, and logical
  revision digest; and
- atomic correspondence with the final `closure-recorded` event.

The validator resolves the exact Repository Contract and Decision and repeats
the authentication and transaction checks; cached convenience values are not
trusted. Closure is valid only as the exact final event subject in the same
Store. Store sealing and archive verification follow without appending another
event and MUST preserve the exact closed standing, terminal Candidate
condition, Closure subject, completed Activities, and Journal head. A runtime
checkpoint, exported view, operation result, or repository file is not
substitute terminal evidence.

### `runtime-interface-v17`

Validates the exact public runtime and interface protocol v17 boundary.
`delivery.prepare` has only `schema`, `target`, `operation`, and `input`.
Every mutation of an existing Delivery additionally has exactly `deliveryId`.
It requires 1 through 1,048,576 NUL-free UTF-8 bytes of semantic Markdown for
prepare and no-ship, and requires null input for admit, accept, and recover.
Continue, evaluate, revise, and reaffirm require an input with both that
semantic Markdown and the exact positive `expectedGeneration` returned by the
complete read on which it was authored. Integration instead requires exactly
the generation-only input defined by [Delivery](DELIVERY.md#semantic-operation-input),
with no semantic Markdown, Agent role, or Investment. A missing, malformed, or
stale generation is refused before an Activity, Cell allocation, dispatch, record,
event, or effect. Director authentication remains an operation-owned
machine-custodied channel outside the public request. The profile rejects a caller-selected
identity, expected target or Process, package reference, observed time, machine
configuration, Investment mechanics, authority bytes, or any additional field.
The generation is a runtime-issued staleness precondition, not caller-authored
Process state.

The separate `delivery.work` request validates the closed set/run/stop union in
[Control](CONTROL.md#explicit-resource-controls). Set requires exact permitted
operation/direction/Agent-choice correspondence and finite safe-integer
ceilings. Set and run require the reviewed generation; run and stop bind an
exact existing grant reference. Stop rejects a generation precondition and
uses only required machine custody. A work result binds its exact action,
selected grant, observed Journal range, settled-operation count and any
transaction-observed Stop acknowledgment. Empty event and Control lists do not
mean an unchanged Journal when the selected projection is coordinates-only.

The protocol exposes the bounded Delivery Inbox, one coherent selected Delivery
View, typed semantic sections, Decision Readiness, exact Candidate difference,
durable-generation watch, exact Control inspection, reducer facts, eligible
operations, recovery coordinate, export, and the closed nine-member context
inspection selector union: Knowledge index, Knowledge record, Code index, Code
file, Atlas overview, Atlas Point, Atlas Resource, Source, and Authorization
Review. Every selector is structurally exact; every paged result uses a
Runtime-issued selector-bound cursor; mutable views and Authorization Review
bind a complete generation, while immutable artifact inspection binds its
retained provenance and exact historical dependencies; and every returned collection, source range, text,
diff, Atlas value, and authorization review stays within the bounds in
[Control](CONTROL.md#closed-context-inspection-selector-union). Arbitrary
repository paths, query languages, caller-selected result shapes, and
caller-authored cursors are invalid. Every read result discloses its applicable selection, observation,
completeness, bounds, and typed unavailability or truncation. Exact artifact
selectors name retained references and a Journal origin; the Runtime MUST
reproduce that origin and subject combination with the sole reducer, reopen
each immutable dependency, and verify final custody and the original Journal
prefix. A caller cannot manufacture valid provenance by hashing a different
combination. Later checkpoints or subject advancement do not invalidate an
unchanged selected artifact. These selectors accept no caller-authored Process
state, events, record bodies, observed time, machine paths, checkpoint payloads,
or transaction mechanics.

An Authorization Review is read-only deterministic presentation of the exact
current admit, accept, or no-ship subject. It is valid only when all review
facts rederive from one Store head and its `authorizationReviewDigest`
reproduces. It cannot
carry authority bytes, signature, challenge, secret location, transaction
mechanics, or proof of approval. A Runtime may issue the invocation-private
challenge selected by [Authority](AUTHORITY.md#invocation-private-challenge-handoff)
only after producing that exact review. Challenge bytes are volatile,
single-use, session- and subject-bound, and never a schema, retained Control
record, Evidence fact, or public authorization result. Expired, consumed,
stale, substituted, or ambiguous challenges are refused without effect.

The protocol exposes no Execution Backend, Cell, Handle, allocation, dispatch,
retrieval, Retirement, Reclamation, Docker, or Candidate materialization
operation. Public views may carry only the sanitized stable execution facts
required by Attempt View, Receipt, Evidence, and recovery semantics. Private
Backend coordinates and maintenance state are neither public workflow nor
Delivery state.

## Validation Stages

Standard profiles use these conceptual stages in dependency order:

1. **Text** — encoding, BOM, prohibited characters, line endings, and byte
   limits.
2. **Header / JSON** — delimiters, one RFC 8259 object, duplicate keys, bounded
   data model, and construction.
3. **Schema** — Draft 2020-12 validation under the exact publication set.
4. **Body / semantics** — CommonMark title, profile-selected section rules,
   anchors, typed metadata, provenance, and header/body non-conflict.
5. **Carrier integrity** — Knowledge source and semantic digests, or Control
   payload, semantic body, fragments, relationships, ordering, and logical
   revision digests.
6. **Discovery** — Knowledge locators, Discipline Registry and Work Types,
   implementation roots, Atlas inputs, registries, and Control records.
7. **Atlas resolution** — exact supported selection, raw State, qualified
   processor, resolved external result, normalized model, Resource bindings,
   provenance preservation, and no partial output.
8. **Identity and currentness** — stable IDs, revisions, status, owners, and
   supersession.
9. **Relationships** — target kinds, cycles, dependency components, incoming
   constraints, and conflict facts.
10. **Coverage and Bindings** — Description primary coverage, Check Definition
   requirements, Binding compatibility, and capability.
11. **Repository epoch** — exact Git tree, Product State, unbound material, and
   repository contract.
12. **Boundary** — selected Knowledge, advisory Discipline subset and Work Types,
    mandate, obligations, artifacts, effects,
    risks, Checks, propositions, baseline, and authority.
13. **Projection** — deterministic closure, role additions, source availability,
    provenance, bounds, omission, and digest.
14. **Attempt and execution** — exact subject, capability, investment,
    Provider Adapter v7, Backend Profile, Specification, Input Set, Image,
    allocation and one-time dispatch, Cell runner, cancellation, Containment,
    Retirement, semantic parser, compiler, Output Manifest, and result contract.
15. **Store events and reduction** — immutable event continuity, legal order,
    exact revision subjects, replay, derived state, and eligibility.
16. **Carrier, seal, and proof** — Candidate Revision Carrier publication and
    availability, deterministic materialization, Candidate identity, final
    artifacts, Receipts, environment, and non-mutation.
17. **Review and Evidence** — independence, proposition decisions, obligation
    ledger, and acceptance readiness.
18. **Authority and transaction** — exact authorization subject, protected
    commit, canonical motion, and recovery.
19. **Information closure** — durable carriers, Containment, Runtime-owned
    Retirement, immutable terminal Reclamation handoff facts, and private orphan
    accounting.

An implementation MAY combine stages internally. A standard diagnostic MUST
still identify the applicable standard stage.

A detected input error can make dependent checks inapplicable while independent
files and stages continue. A validator SHOULD continue when doing so is safe and
cannot produce misleading stronger state.

An operational failure, unsupported adapter, inaccessible required current
source, or resource limit that prevents a required stage sets the stage and
overall result to `complete: false`. An unavailable optional source or source on
a historical record is a warning and does not make the source stage incomplete.
A completed stage can be invalid.

A Discipline declaration with `sources[].required: true` is a completed invalid
record, not a required-source completeness condition. Validation emits
`lifecycle.discipline.source-required`, does not pass that declaration to source
resolution as required, and does not make the source stage incomplete solely
because the cited bytes are unavailable.

Stage completeness is an explicit processing fact. A validator MUST preserve
the typed failure and bounded machine facts that explain an incomplete stage;
it MUST NOT reduce the failure to a generic message or infer stage state from a
diagnostic naming convention.

## Required Semantic Validation

JSON Schema alone never completes a standard profile. A conforming validator
performs every applicable requirement in the owning specification, including at
least:

- strict Knowledge Lifecycle Document framing and header/body authority
  separation;
- exact Control revision payload, semantic Markdown, body and fragment binding,
  relationship, ordering, and logical-digest reproduction;
- exact governed Agent Work Product role-template parsing and ephemeral typed
  runtime-value construction;
- deterministic Work Product fixed-binding injection, global identity
  assignment, reference resolution, set normalization, and provenance
  preservation;
- separation of Agent invalid-submission from compiler runtime-failure;
- complete Control Store event sequence, predecessor, event-order, subject, and
  payload validation plus deterministic reducer replay;
- orthogonal correspondence among governing Boundary standing, Candidate
  existence and condition, Activity recovery, current subjects, physical Store
  disposition, and eligible operations at every durable head;
- exact locator-to-Knowledge-kind classification;
- stable identity prefix and uniqueness;
- one current revision per identity;
- complete revision and supersession chains;
- owner registry resolution, with Discipline's sole publisher resolved through
  its exact Registry Pack entry instead of target Product Knowledge owners;
- body title and section uniqueness;
- exact Discipline Registry self-digest, adoption-to-record equality, Pack
  provenance, and Work Type reference validity without implicit selection;
- `required: false` on every Discipline source declaration, without treating
  an invalid true value as a required source-resolution input;
- relationship source/target kind rules and mandatory closure effects;
- refinement and Check-dependency cycle detection;
- required dependency strongly connected component completeness;
- current Behavior and Assurance `verified-by` coverage;
- Check Definition and Binding semantic compatibility;
- exact equality of Check subject selectors and preservation of `pass`, `fail`,
  `indeterminate`, `not-run`, `unsupported`, and `operational-error` under
  `check-disposition-v2`;
- exact Description primary coverage cardinality;
- exclusion of the complete `records/control/` namespace from Description
  coverage, independent of the configured Delivery Control locator;
- structured, reciprocal, and indeterminate authority conflicts;
- exact source requiredness, retrieval authority, immutable revision,
  disposition, and ordered manifest inclusion;
- repository-selected Knowledge count, byte, structural, graph, and source
  bounds with fail-closed stage completeness;
- Product State membership and unbound-authority rejection;
- Work Boundary obligation and proposition coverage;
- exact equality between the Work Boundary Discipline subset and its selected
  Discipline Knowledge identities, without deriving obligations or Evidence;
- Work Boundary evidence identities resolve only to declared required
  artifacts;
- portable lexical normalization of `local-read` and `local-write` Work
  Boundary Effect targets, with bidirectional Atlas-scope exclusion and no
  repository-path reinterpretation of non-local Effect target text;
- baseline modality semantics;
- deterministic Projection fixed point and zero mandatory omission;
- mounted content and cache revalidation;
- role-compatible Agent Attempt subject and capability;
- exact private Execution Backend Profile, Specification, Input Set, Image,
  idempotent allocation key, one-time dispatch, terminal observation, Output
  Manifest, Containment, and Retirement binding without disclosing private
  coordinates;
- provider control-plane network and authentication separation from Agent
  product capability, including unsupported refusal when separation is not
  enforceable;
- complete Candidate Revision Carrier integrity, publication before selection,
  deterministic materialization, and selected-Carrier availability;
- exact independent classification of provider outcome, Work Product validity,
  and builder Candidate successor disposition;
- Candidate Seal reproducibility;
- final proof subject non-mutation;
- fuzz or property campaign semantic result where required;
- exact Receipt freshness and reuse;
- reviewer independence and complete proposition decisions;
- obligation ledger derivation without weighted substitution;
- exact retained governing and integration-parent Snapshots, independent
  Delivery repositories and locks, original-baseline applicability, guarded
  context-change finalization/readmission, protected-root validation over P→I,
  and conditional acceptance with fresh integration after conclusive stale CAS;
- exact Director authorization and replay prevention;
- transaction recovery identity;
- exact Closure revision loading, final-event correspondence, synchronous
  Containment and Retirement, Store sealing, archive verification, terminal
  status derivation, and preservation of that terminal reduction through
  Store-disposition recovery; and
- complete bounded private Reclamation accounting against the immutable terminal
  handoff or obligation-set digest, without placing mutable progress in Control
  or creating a public maintenance workflow.

A validator MUST NOT invent missing product meaning, resolve an authority
conflict with model judgment, infer currentness from recency, or treat a passing
command as an adequate Check without validating the Check's proposition and
Binding semantics.

## Diagnostics

Each standard diagnostic contains:

- `code`, a stable identifier in the reserved `lifecycle.` namespace;
- `severity`, `error`, `warning`, or `information`;
- a concise `message`;
- `stage`;
- a primary `location` with URI/path, JSON Pointer, line, column, or equivalent
  when one exists;
- `related` exact identities and locations when useful; and
- bounded machine-readable `facts`.

Messages can improve without changing codes. An implementation-specific
condition uses an implementation-owned prefix that does not begin
`lifecycle.`.

A validator MUST order diagnostics according to [Processing](PROCESSING.md). It
MUST NOT discard earlier errors merely because a later stage cannot run.

When a schema engine reports several nested failures, the validator preserves
each bounded schema diagnostic with its JSON Pointer, keyword facts, and primary
record locator. A wrapper error MUST NOT collapse those failures into one
message or discard their machine-readable locations.

### Required standard diagnostics

The publication reserves at least these codes. Owning documents can reserve
additional codes in the same family.

<!-- markdownlint-disable MD013 -->

| Code | Default severity | Condition |
| --- | --- | --- |
| `lifecycle.specification.conflict` | error | Normative prose and another publication carrier conflict. |
| `lifecycle.publication.identity-mismatch` | error | A publication carrier does not use the canonical specification identifier or exact selected revision and manifest digest. |
| `lifecycle.publication.manifest-invalid` | error | Publication inventory, byte digest, document status, ordering, membership, or self-digest is invalid. |
| `lifecycle.publication.release-notes-invalid` | error | Release Notes shape, ordering, digest, change coverage, or hard-cut field is invalid or mismatched. |
| `lifecycle.publication.statement-invalid` | error | A Publication Statement has an invalid shape, subject digest, prior-statement binding, artifact digest, source revision, or self-digest. |
| `lifecycle.publication.authentication-invalid` | error | Publication principal, key, algorithm, signature, or external trust-root verification fails. |
| `lifecycle.publication.status-ineligible` | error | Candidate or released lifecycle status is claimed without the required maturity, frozen package, or Conformance gate. |
| `lifecycle.text.invalid` | error | Text violates encoding, BOM, Unicode, NUL, line-ending, or byte requirements. |
| `lifecycle.front-matter.invalid` | error | Knowledge Lifecycle Document delimiters or header boundaries are invalid. |
| `lifecycle.json.invalid` | error | JSON cannot be constructed under the Lifecycle bounded data model. |
| `lifecycle.schema.invalid` | error | A value fails its applicable exact JSON Schema. |
| `lifecycle.schema.unsupported` | error | A required vocabulary, reference, or format assertion is unsupported. |
| `lifecycle.document.profile-unsupported` | error | The selected Knowledge document profile is unavailable or mismatched. |
| `lifecycle.document.header-body-conflict` | error | Knowledge body prose contradicts an operative typed header value or attempts to add authority. |
| `lifecycle.document.digest-mismatch` | error | A Knowledge source, semantic, body, fragment, or selected external digest does not reproduce. |
| `lifecycle.interface.request-invalid` | error | A public Runtime request fails its exact interface schema, including a productive semantic operation with an omitted or malformed expected generation. |
| `lifecycle.path.invalid` | error | A repository path violates normalization, length, kind, or ownership rules. |
| `lifecycle.source.unbound` | error | Required authority bytes are ignored, untracked, mutable, or from another epoch. |
| `lifecycle.source.inaccessible` | error | A required source cannot be read or verified under the authorized policy. |
| `lifecycle.repository.contract-invalid` | error | Repository-v22 contract shape or semantic selection is invalid. |
| `lifecycle.repository.predecessor-unsupported` | error | An unsupported-generation or mixed repository carrier is presented to the fresh-only rc.17 route. |
| `lifecycle.repository.epoch-mixed` | error | One result combines incompatible repository epochs. |
| `lifecycle.repository.product-state` | error | Product State membership or digest is invalid. |
| `lifecycle.repository.untracked-authority` | error | Untracked or ignored material appears under an authoritative root. |
| `lifecycle.repository.knowledge-invalid` | error | The supplied Knowledge Set result is incomplete, invalid, publication-mismatched, or bound to another snapshot. |
| `lifecycle.repository.control-present` | error | Repository-visible Delivery Control or runtime custody material is present in the fresh repository-v22 subject. |
| `lifecycle.read-model.generation-stale` | error | A mutable read, Authorization Review, or mutation binds a superseded runtime-issued generation. |
| `lifecycle.work-delegation.invalid` | error | Resource permission lacks an exact settled admission, original direction, permitted operation/selection combination, valid expiry or adequate lifetime ceiling. |
| `lifecycle.work-delegation.resource-limit` | error | The complete reservation cannot fit the existing bounded Control opening without dropping required resource facts. |
| `lifecycle.work-delegation.reservation-context` | error | A proposed reservation lacks its exact current decision, grant, admission, permitted operation, available retained resource selection or remaining allowance. |
| `lifecycle.work-delegation.policy-binding` | error | A useful-work decision cannot bind the retained Candidate, Attempt, integration or proof facts on which it relies. |
| `lifecycle.work-delegation.runtime-binding` | error | Foreground composition cannot establish one exact reserved Activity, its single charge, original direction or settled continuation. |
| `lifecycle.work-delegation.runtime-interrupted` | error | A foreground invocation cannot establish its operation return; retained effects require observation before any fresh explicit course. |
| `lifecycle.work-delegation.current-subject` | error | An explicit run selects a different grant from the current retained Work Delegation. |
| `lifecycle.work-delegation.stop-request-invalid` | error | Stop request shape, exact Store/Process/grant/Director bindings, timestamp or self-digest is invalid. |
| `lifecycle.read-model.inspection-selection` | error | An artifact selection does not reproduce its exact Target, Store, Process, retained Journal prefix, Boundary role, or Candidate/Seal combination. |
| `lifecycle.context-inspection.selector-invalid` | error | A context inspection selector is outside the closed nine-member union, contains extra fields, or violates a selector bound. |
| `lifecycle.context-inspection.cursor-invalid` | error | A cursor is malformed, expired, replays against another selector, target, Delivery, context basis, or retained selection, or cannot be reopened exactly. |
| `lifecycle.context-inspection.result-bound` | warning | An otherwise valid Code, Knowledge, Atlas, or Source result reaches a declared returned-item, text, diff, or range bound and reports exact truncation or continuation. |
| `lifecycle.context-inspection.source-invalid` | error | A Source Reference or requested range is unbound, inaccessible, outside its selected historical basis, or exceeds the exact source bounds. |
| `lifecycle.authorization-review.binding` | error | Authorization Review facts or digest do not rederive from one exact current Store head and authority subject. |
| `lifecycle.authorization-challenge.invalid` | error | An invocation-private challenge is malformed, expired, consumed, stale, substituted, ambiguous, cross-session, or bound to another exact review or authority subject. |
| `lifecycle.delivery-inbox.member-invalid` | error | A discovered Delivery Store is unreadable, corrupt, duplicated, or changes during bounded enumeration. |
| `lifecycle.delivery-view.incoherent` | error | Selected Delivery sections do not bind one exact read generation. |
| `lifecycle.candidate-diff.unavailable` | error | The exact runtime-selected Candidate Revision Carriers needed for the difference are unavailable. |
| `lifecycle.candidate-diff.bound` | warning | The exact difference exceeds a returned-byte, path, or binary-display bound and is explicitly truncated or omitted. |
| `lifecycle.candidate.carrier-invalid` | error | Candidate Revision Carrier manifest, root tree, Git object closure, inventory, bounds, bytes, or digest is invalid or mutable. |
| `lifecycle.candidate.carrier-unavailable` | error | A Carrier selected by an active, recoverable, sealed, Evidence, or terminal subject cannot be reopened exactly. |
| `lifecycle.candidate.publication-order` | error | Control selects a Candidate Revision before its complete Carrier was durably published and verified. |
| `lifecycle.candidate.materialization-invalid` | error | A Candidate materialization escapes, substitutes, mutates, or fails to reproduce its exact Carrier. |
| `lifecycle.delivery-watch.request-invalid` | error | A watch selection, prior generation, or timeout is malformed or unsupported. |
| `lifecycle.atlas.binding-invalid` | error | Atlas State, Resource bindings, Resolution, or a dependent subject does not reproduce one coherent exact binding. |
| `lifecycle.atlas.candidate-mutation` | error | A Work Boundary selects an Atlas artifact or Effect scope, or a Candidate creates, changes, moves, or deletes a path at or below the authoritative Atlas root. |
| `lifecycle.atlas.invalid` | error | The selected resolved Atlas validation completed with `valid: false`. |
| `lifecycle.atlas.missing` | error | The mandatory regular root Atlas or fixed entrypoint is absent from the exact bound tree. |
| `lifecycle.atlas.normalized-invalid` | error | Normalized output is missing, fails the selected schema, exposes partial output, or does not reproduce its bound digest. |
| `lifecycle.atlas.processing-incomplete` | error | Required Atlas discovery, parsing, resolution, or output validation did not complete. |
| `lifecycle.atlas.processor-unavailable` | error | The exact qualified Atlas processor or its installed file-manifest identity is unavailable or mismatched. |
| `lifecycle.atlas.resource-unbound` | error | A repository-local Atlas Resource used by resolution or Projection lacks an exact authorized same-epoch binding. |
| `lifecycle.atlas.result-invalid` | error | The external Atlas Validation Result fails its selected schema, profile, revision, implementation, state, or digest contract. |
| `lifecycle.atlas.selection-unsupported` | error | The target Atlas selection differs from Foundation's exact release, revisions, format, profile, schemas, or consumer profile. |
| `lifecycle.candidate.repair-output-invalid` | error | Receipt-bound repair descriptors, exact source joins, rejection, paired manifest, or Candidate continuity do not satisfy the closed repair contract. |
| `lifecycle.candidate.repair-output-unavailable` | error | Exact selected repair bytes cannot currently be reopened from retained custody; they cannot be silently omitted. |
| `lifecycle.knowledge.kind-location` | error | Knowledge kind and physical locator disagree. |
| `lifecycle.knowledge.id-duplicate` | error | Two Knowledge records use the same stable identity and revision. |
| `lifecycle.knowledge.current-duplicate` | error | More than one current revision exists for one Knowledge identity. |
| `lifecycle.knowledge.current-not-latest` | error | A current Product Knowledge revision has a later non-Draft revision, or a current Discipline has a later local revision. |
| `lifecycle.knowledge.revision-gap` | error | A Knowledge revision sequence is incomplete. |
| `lifecycle.knowledge.authority-conflict` | error | Applicable current Knowledge sources conflict materially. |
| `lifecycle.discipline.pack-invalid` | error | A supplied Pack manifest self-digest, ordered inventory, exact record bytes or digests, sole publisher, or curated Set membership is invalid. |

| `lifecycle.discipline.registry` | error | The Discipline Registry envelope or exact keys are invalid. |
| `lifecycle.discipline.registry-encoding` | error | The Registry is not valid UTF-8 JSON. |
| `lifecycle.discipline.registry-source` | error | The Registry source cannot supply exact supported authoritative content. |
| `lifecycle.discipline.registry-missing` | error | The selected tracked Discipline Registry is absent. |
| `lifecycle.discipline.registry-pack` | error | A Registry Pack entry has invalid fields or shape. |
| `lifecycle.discipline.registry-adoption` | error | An adoption entry has invalid fields, a non-Discipline identity, or an unsupported target path. |
| `lifecycle.discipline.registry-work-type` | error | A Work Type has invalid fields or cites a non-Discipline identity. |
| `lifecycle.discipline.registry-duplicate` | error | A Registry identity is repeated. |
| `lifecycle.discipline.registry-pack-missing` | error | An adoption cites a Pack absent from the Registry. |
| `lifecycle.discipline.registry-adoption-missing` | error | A Work Type cites a Discipline absent from the adoption inventory. |
| `lifecycle.discipline.registry-digest` | error | The Registry self-digest does not reproduce its canonical subject. |
| `lifecycle.discipline.registry-coverage` | error | Adoptions do not exactly cover current adopted Discipline records. |
| `lifecycle.discipline.registry-adoption-mismatch` | error | An adoption does not bind the exact current record identity, revision, path, source digest, and semantic digest. |
| `lifecycle.discipline.publisher-owner` | error | An adopted Discipline does not retain its sole Registry Pack publisher owner. |
| `lifecycle.discipline.candidate-mutation` | error | A proposed Boundary write scope or Candidate change intersects the frozen Discipline root. |
| `lifecycle.discipline.source-required` | error | A Discipline source declares `required: true`; Discipline provenance must remain optional and cannot affect Knowledge Set completeness. |
| `lifecycle.relationship.target-missing` | error | A required Knowledge relationship target does not resolve. |
| `lifecycle.relationship.kind-invalid` | error | Knowledge relationship source and target kinds are invalid. |
| `lifecycle.relationship.cycle` | error | A Knowledge relationship that must be acyclic contains a cycle. |
| `lifecycle.description.coverage-missing` | error | A governed implementation artifact has no current primary Description. |
| `lifecycle.description.coverage-ambiguous` | error | A governed implementation artifact has several current primary Descriptions. |
| `lifecycle.check.required-missing` | error | A current Behavior or Assurance lacks a required current Check. |
| `lifecycle.check.binding-missing` | error | An included Check has no required repository Binding. |
| `lifecycle.check.binding-incompatible` | error | Binding evidence, subject, capability, freshness, or result semantics are incompatible. |
| `lifecycle.boundary.basis-mismatch` | error | Work Boundary bases do not identify one coherent repository and Knowledge epoch. |
| `lifecycle.boundary.compilation-invalid` | error | A Work Boundary does not compile reproducibly from its exact Brief, reconnaissance Work Product, and runtime basis. |
| `lifecycle.boundary.relationship-invalid` | error | Work Boundary Brief, Work Product, predecessor, or Material Condition relationships violate the closed registry. |
| `lifecycle.boundary.baseline-invalid` | error | The selected baseline Receipt set is missing, duplicated, stale, cross-subject, or modality-invalid. |
| `lifecycle.boundary.authority-invalid` | error | Admission authentication does not bind the exact proposal-ready Boundary and basis. |
| `lifecycle.projection.discipline-invalid` | error | Discipline discovery or selected guidance does not bind the exact Registry, Work Types, and selected advisory records. |
| `lifecycle.projection.request-invalid` | error | A Projection request violates semantic requirements, including the Orientation objective's UTF-8 byte bound. Structural schema failures retain the schema diagnostic. |
| `lifecycle.projection.basis-mismatch` | error | Projection request bases do not identify one coherent subject. |
| `lifecycle.projection.profile-mismatch` | error | Projection class, role, profile identity, profile digest, or selected bounds disagree. |
| `lifecycle.projection.mandatory-omission` | error | Mandatory Projection closure was omitted, truncated, or summarized. |
| `lifecycle.projection.source-inaccessible` | error | Required projected source is inaccessible under current authority. |
| `lifecycle.projection.citation-identity-conflict` | error | Knowledge occurrences sharing exact source bytes disagree on revision identity; differing admitted and Candidate revisions alone are valid. |
| `lifecycle.projection.authority-conflict` | error | Applicable mandatory authority conflicts. |
| `lifecycle.projection.reviewer-seal` | error | Reviewer Projection does not bind the exact current Candidate Seal and sealed Candidate Revision. |
| `lifecycle.control.store-invalid` | error | Store metadata, SQLite profile, custody, or selected lifecycle profile is invalid. |
| `lifecycle.control.record-invalid` | error | A Control revision violates common shape, family payload, semantics, authority, revision, or logical-digest rules. |
| `lifecycle.control.relationship-invalid` | error | A Control relationship violates its exact source, target, revision, kind, or cardinality rule. |
| `lifecycle.control.event-invalid` | error | A Control Record Event violates its envelope, kind, payload, actor, subject, time, or logical-digest contract. |
| `lifecycle.control.sequence-gap` | error | The retained event chain skips an expected positive sequence or immediate predecessor. |
| `lifecycle.control.fork` | error | More than one event claims the same predecessor or sequence. |
| `lifecycle.control.order-invalid` | error | Event kind, subject, activity, intent/observation, or terminal order violates the closed Delivery grammar. |
| `lifecycle.control.reference-unavailable` | error | A required exact record revision or referenced file cannot be resolved and validated. |
| `lifecycle.control.support-invalid` | error | Operation support generation, digest, activity binding, atomic transition, or disposal is invalid. |
| `lifecycle.control.reduction-mismatch` | error | Replaying the complete Store event chain does not reproduce the reported Delivery reduction. |
| `lifecycle.control.seal-invalid` | error | Logical inventory, Closure head, referenced-file set, or Store seal does not reproduce. |
| `lifecycle.control.archive-invalid` | error | Archive membership, retrieval-byte digest, read-only custody, or sealed-Store correspondence is invalid. |
| `lifecycle.attempt.subject-mismatch` | error | Agent Attempt subject differs from the current Boundary, Candidate Revision, Seal, or Evidence Packet. |
| `lifecycle.attempt.role-incompatible` | error | Role, Projection, subject, capability, or Work Product contract are incompatible. |
| `lifecycle.attempt.capability-escalation` | error | Attempt capability exceeds or weakens the selected Capability Profile. |
| `lifecycle.attempt.investment-invalid` | error | Investment is absent, out of bounds, changed after dispatch, or not fresh for the invocation. |
| `lifecycle.attempt.provider-unsupported` | error | Provider Adapter v7 or the selected Backend cannot enforce required compatibility, control-plane separation, workspace, or capability. |
| `lifecycle.attempt.input-invalid` | error | Execution Input Set, selected Carrier, Projection material, semantic template, inventory, or digest is incomplete, mutable, cyclic, or mismatched. |
| `lifecycle.agent-work-product.template-invalid` | error | Submitted semantic Markdown violates the exact Attempt-selected role body profile. |
| `lifecycle.agent-work-product.mechanics-authored` | error | Agent semantics attempt to author a runtime binding, identity, relationship, ordering, digest, header, or envelope. |
| `lifecycle.agent-work-product.binding` | error | A frozen Attempt binding is absent, stale, substituted, or injected under the wrong provenance. |
| `lifecycle.agent-work-product.reference` | error | An Agent-proposed reference cannot be resolved uniquely within the Attempt registry. |
| `lifecycle.agent-work-product.compiler` | error | Valid parsed semantics cannot produce one deterministic valid Work Product payload and body binding. |
| `lifecycle.execution.binding` | error | Receipt does not bind the exact Attempt, provider, Investment, capability, Backend Profile, Specification, Input Set, or Image. |
| `lifecycle.execution.backend-unsupported` | error | The selected production Backend Profile, Engine relationship, Image, runner, capability, or effective limit cannot be enforced. |
| `lifecycle.execution.control-plane-unseparated` | error | Provider control-plane authentication or network access cannot be separated from Agent product capability before dispatch. |
| `lifecycle.execution.provider-credential-custody-v1.busy` | error | Another execution or unfinished private transition retains the installed provider credential claim; retrying must preserve the exact selection. |
| `lifecycle.execution.provider-credential-custody-v1.unavailable` | error | Exact private credential custody is temporarily unavailable; restoration permits the retained obligation to continue. |
| `lifecycle.execution.provider-credential-custody-v1.changed-auth` | error | The installed credential generation changed during an active claim or settlement; the Runtime cannot overwrite either generation. |
| `lifecycle.execution.provider-credential-custody-v1.reprovision-required` | error | A conclusively lost final credential generation has settled; future execution requires separately provisioned different private credentials. |
| `lifecycle.execution.cell-authority-exposed` | error | A Cell can reach the Docker Engine socket, Runtime-private target mount, Director authority, Control Store, canonical Git write authority, or another Cell. |
| `lifecycle.execution.private-fact-disclosed` | error | A public Receipt, record, result, diagnostic, log, CLI response, or interface view exposes a Handle, Cell identity, allocation key, Engine endpoint, credential, private path, environment value, or Reclamation coordinate. |
| `lifecycle.execution.public-workflow` | error | A Control carrier, public protocol, CLI, TUI, read model, or recovery route adds a Cell, job, container, Backend, Retirement, or Reclamation operation, state machine, stage, selectable identity, or operator action alongside Delivery. |
| `lifecycle.execution.allocation-conflict` | error | One allocation key resolves to a different Specification, Cell, or Handle, creates more than one productive allocation, or recreates or substitutes a Cell after its retained Handle is authoritatively absent. |
| `lifecycle.execution.dispatch-replayed` | error | Dispatch is attempted after its durable one-time authority was consumed. |
| `lifecycle.execution.handle-mismatch` | error | Observation, cancellation, retrieval, Retirement, or Reclamation binds a substituted or cross-operation Handle. |
| `lifecycle.execution.terminal` | error | Provider terminal, productive-start, cancellation, Cell observation, allocation-response, dispatch-response, or timing facts are inconsistent, including allocation after creation before return or dispatch after start before return. |
| `lifecycle.execution.output-invalid` | error | Output Carrier or Manifest is missing required completeness, exceeds bounds, escapes its root, or disagrees with retrieved bytes. |
| `lifecycle.execution.workspace` | error | Retrieved workspace observation, submission, byte length, digest, parse disposition, or Work Product correspondence is invalid. |
| `lifecycle.execution.candidate-revision` | error | Input Candidate or optional promoted-successor nullability, identity, Carrier, logical digest, or role correspondence is invalid. |
| `lifecycle.execution.containment` | error | Activity would retain a result or complete while a productive Cell process or writer is not proved absent from the selected effect boundary. |
| `lifecycle.execution.retirement` | error | Runtime-owned Retirement is missing, inconsistent, reusable, or does not bind the exact terminal Cell and output disposition. |
| `lifecycle.execution.reclamation-pending` | warning | Exact private Reclamation remains pending or failed after valid Retirement; the residue is inert, bounded, and durably owned. |
| `lifecycle.execution.reclamation-invalid` | error | A Reclamation obligation is unowned, cross-subject, unbounded, falsely claims absence, or requests broad pruning. |
| `lifecycle.attempt-view.binding` | error | Attempt View subjects do not join at one exact Store head. |
| `lifecycle.attempt-view.stale` | error | The displayed coordinate is no longer current. |
| `lifecycle.attempt-view.obligation-missing` | error | An active-Boundary obligation is absent from the view. |
| `lifecycle.attempt-view.provenance` | error | Agent semantics are represented as runtime facts or Director authority. |
| `lifecycle.attempt-view.eligibility` | error | A displayed operation is not in the exact reducer result. |
| `lifecycle.attempt-view.incomplete` | error | A limit, race, or unavailable source prevents complete derivation. |
| `lifecycle.receipt.subject-mismatch` | error | Check Receipt does not bind the exact Check subject. |
| `lifecycle.receipt.environment-mismatch` | error | Proof environment violates the required contract or freshness class. |
| `lifecycle.receipt.result-invalid` | error | Check disposition and normalized mechanism facts are inconsistent. |
| `lifecycle.seal.base-mismatch` | error | Candidate Seal does not derive from the exact Candidate Revision and immutable base. |
| `lifecycle.seal.inventory-incomplete` | error | Sealed path, mode, type, object, or artifact inventory is incomplete. |
| `lifecycle.evidence.subject-mismatch` | error | Evidence Packet or one of its relationships binds another Boundary, Seal, Candidate, or Delivery. |
| `lifecycle.evidence.receipt-missing` | error | A required baseline or final Check Receipt is absent. |
| `lifecycle.evidence.review-independence` | error | Reviewer independence facts are not satisfied. |
| `lifecycle.evidence.review-incomplete` | error | Proposition decision ledger is missing, duplicate, or illegal. |
| `lifecycle.evidence.obligation-unsatisfied` | error | A required obligation is not satisfied. |
| `lifecycle.evidence.acceptance-ready-invalid` | error | Packet claims readiness while a required condition remains. |
| `lifecycle.evidence.unsupported-verifier` | error | The exact selected Evidence rule set or validator is unsupported. |
| `lifecycle.evidence.observation-subject` | error | Runtime observation does not bind the exact evaluation Boundary, Candidate, and Seal. |
| `lifecycle.evidence.packet-mismatch` | error | The retained Packet differs from the justification derived from its exact supporting inputs. |
| `lifecycle.evidence.not-ready` | error | Verified Evidence does not justify acceptance readiness. |
| `lifecycle.evidence.superseded-boundary` | error | The evaluated Work Boundary is not the exact current active Boundary. |
| `lifecycle.evidence.wrong-candidate` | error | The evaluated Candidate Revision is not the exact current Candidate Revision. |
| `lifecycle.evidence.wrong-seal` | error | The evaluated Seal is not the exact current Seal. |
| `lifecycle.evidence.wrong-evidence` | error | The verified Packet is not the exact current Evidence Packet. |
| `lifecycle.evidence.current-material-condition` | error | A current Material Condition prevents acceptance of the selected justification. |
| `lifecycle.evidence.integration-required` | error | The selected Candidate lacks exact retained integration provenance required for evaluation or acceptance. |
| `lifecycle.evidence.stale-parent` | error | The selected acceptance parent differs from the exact integration parent. |
| `lifecycle.evidence.wrong-director-subject` | error | A supplied Director subject does not select the exact verified acceptance justification. |
| `lifecycle.delivery.operation-ineligible` | error | A requested operation is not eligible at the exact current Store head. |
| `lifecycle.delivery.condition.binding` | error | Material Condition does not bind its exact Boundary, Candidate Revision, Work Product, Receipt, or source facts. |
| `lifecycle.delivery.admission.binding` | error | Admission or readmission does not bind the exact Decision, Boundary, baseline, repository basis, Candidate, or Condition. |
| `lifecycle.integration.assessment-invalid` | error | An Integration Assessment has invalid exact Snapshot, source/currentness, outcome, ordering, digest, or contextual comparison facts. |
| `lifecycle.integration.merge-invalid` | error | The fixed exact B/C/P merge cannot establish supported, complete, correctly bound integration facts or its retained implementation selection. |
| `lifecycle.repository.git-basis-invalid` | error | Private retained Git basis identity, topology, or immutable binding is invalid. |
| `lifecycle.repository.git-basis-unavailable` | error | The exact retained historical Git subject cannot be reopened. |
| `lifecycle.repository.git-basis-incomplete` | error | Required exact historical Git objects or complete Snapshot inputs are unavailable. |
| `lifecycle.repository.git-context-invalid` | error | Private Delivery Git context has an invalid exact identity, topology, history, or Candidate binding. |
| `lifecycle.repository.git-context-incomplete` | error | Required exact Delivery work history cannot be completely retained or reopened. |
| `lifecycle.execution.input-set.git-context-binding` | error | A builder or reviewer Input Set lacks one exact canonical Delivery Git context, complete pack, or matching Candidate binding. |
| `lifecycle.delivery.repository-drift` | error | The selected new canonical effect cannot establish its exact integration parent or required clean target checkout. Historical admission and productive continuation do not require live HEAD equality. |
| `lifecycle.delivery.candidate-drift` | error | Candidate differs from the exact subject of the requested operation. |
| `lifecycle.authority.subject-mismatch` | error | Director Decision authentication binds a different exact subject. |
| `lifecycle.authority.signature-invalid` | error | Principal, key, algorithm, signature, expiry, or replay validation failed. |
| `lifecycle.authority.credential` | error | The invocation-private authority credential is missing, forged, consumed, discarded, or bound to another purpose. |
| `lifecycle.authority.context` | error | The private execution context is invalid, carries legacy raw-secret fields, or supplies authority material to a non-authority operation; refusal precedes owner dispatch. |
| `lifecycle.transaction.subject-mismatch` | error | A retained transaction plan is not the exact plan permitted by the authenticated Decision and deterministic variant rule. |
| `lifecycle.transaction.recovery-invalid` | error | Recovery would reconstruct, redispatch, or substitute another effect subject. |
| `lifecycle.delivery.closure.binding` | error | Closure disposition, Decision, transaction, final observation facts or digest, canonical result digest, Boundary, Candidate, Seal, or Evidence relationships disagree. |
| `lifecycle.delivery.closure.retirement` | error | Closure Containment, Retirement, live-support removal, or immutable Reclamation handoff or obligation-set facts are incomplete or inconsistent. |
| `lifecycle.delivery.closure.final-event` | error | Closure is not the exact subject of the final `closure-recorded` event. |
| `lifecycle.reclamation.residue-unowned` | error | Terminal run-owned residue remains without one exact bounded private Reclamation owner. |
| `lifecycle.reclamation.broad-prune` | error | Maintenance attempts discovery-based or non-exact deletion of Docker, filesystem, Carrier, or another Delivery resource. |

<!-- markdownlint-enable MD013 -->

A validator MAY emit more specific codes defined by an owning document. It MUST
not replace a required catalog code with a generic message.

## Determinism and Reproducibility

For one exact publication set, profile, subject, authorized retrieval result, and
published limit set, two conforming validators MUST agree on:

- `complete` and `valid`;
- every required standard diagnostic code and severity;
- normalized subject identity and digest;
- standard stage completeness;
- canonical result digest under the exact schema-defined digest projection.

Messages, durations, observation time, implementation identity and telemetry,
full diagnostic counts, and implementation-owned information diagnostics can
differ without changing the digest. Required standard diagnostics and facts,
the normalized subject, profile stages, applied limits, completeness, and
validity cannot.

A validator SHOULD expose a deterministic mode that omits wall-clock durations
from comparison evidence while retaining them in operational telemetry.

## Resource Limits

An implementation publishes every material limit in its conformance claim and
validation result. Standard profiles require minimum capacities published with
the release metadata.

For `knowledge-set-v2`, the repository contract selects the exact positive
limits up to the ceilings in [Knowledge](KNOWLEDGE.md). The Validation Result
echoes every selected Knowledge limit plus bounded observed record and source
counts and bytes. Count and aggregate-byte limits are preflight conditions;
crossing one makes the affected stage incomplete even when already-parsed items
would otherwise form a valid subset.

For `repository-v9`, the exact Foundation Atlas limits are those owned by
[Atlas Integration](ATLAS.md): installed-processor inventory is limited to
1,024 filesystem entries, depth 16, 16 MiB per file, 64 MiB aggregate, and
15,000 ms; the processor Worker and the strict-JSON parser share one 64 MiB
result maximum and the Worker has a 15,000 ms elapsed bound; Resource binding
is limited to 16,384 registrations, 64 MiB per unique resolved blob, 256 MiB
across unique resolved blobs, and 15,000 ms. Processor inventory uses bounded
metadata preflight before payload reads. Resource binding validates count and
Resource-id uniqueness before blob reads and reads and hashes each unique Git
object identity at most once.

Crossing an installed-processor inventory bound or observing an inventory
mismatch emits `lifecycle.atlas.processor-unavailable`. Crossing the Worker
output or elapsed bound, or the Resource count, aggregate-byte, or elapsed bound,
makes Atlas resolution incomplete and emits
`lifecycle.atlas.processing-incomplete`. Duplicate Resource ids or malformed
strict JSON emit `lifecycle.atlas.result-invalid`. None of these failures can
produce a partial normalized model or disclose raw paths, bytes, or caught
processor messages.

When an input exceeds an implementation limit below the standard minimum, the
standard profile is unsupported or incomplete. When it exceeds the standard
profile bound, the validator emits the applicable standard diagnostic.

A validator MUST NOT claim `valid: true` after silently dropping records,
relationships, projected items, Receipts, decisions, diagnostics, or residual
artifacts.

## Validation Security

Validation does not grant read, execution, network, credential, daemon, or
external-effect authority.

A profile requiring external-local or network retrieval, Check execution, or
transaction inspection receives explicit authority and reports the exact policy.
Structural validation MUST NOT retrieve external content or execute a Binding.

A validator treats Knowledge bodies, Atlas content, external resources, agent
output, provider events, command output, and fixture content as untrusted data.
It MUST NOT execute text from those sources unless one exact Check Binding and
Capability Profile authorizes the mechanism.

Parser, schema, graph, Markdown, archive, decompression, and external retrieval
implementations MUST apply bounded depth, size, count, and time policies.

## Fixture Contract

The repository fixture manifest is a canonical JSON object binding
`specificationId: lifecycle`, one exact `specificationRevision`, and one entry
per fixture directory. Each entry contains:

- `id`, stable within the publication set;
- `path`, relative to `examples/`;
- `profile`;
- `complete`;
- `valid`;
- `diagnostics`, a sorted array of required standard diagnostic codes for an
  invalid fixture;
- `subjectDigest` when the fixture fixes an exact canonical subject; and
- `description`.

A fixture directory contains every source required for its claimed profile or
an exact adapter declaration. A fixture requiring Git identity includes the
canonical fixture tree manifest used to reproduce that identity.

`repository-contract-fixture-v9` is the narrow publication-integrity profile
for repository contract v22. It validates the exact repository contract,
selected rc.17 coordinates, fresh-only reserved-path rules, environment bounds,
and fixed predecessor discriminators. Passing this fixture profile is not
`repository-v9` observation evidence and does not substantiate a Repository
Validator conformance claim.

Predecessor fixture bytes retain only the minimum discriminator and
reserved-path facts needed to prove
`lifecycle.repository.predecessor-unsupported`. A current fixture MUST NOT
parse, validate, translate, migrate, or continue another predecessor field.
Those bytes are refusal fixtures, not compatibility carriers.

Current Control structural fixtures use strict `subject.json` values for the
Store, lifecycle registry, record revision, event, referenced file, seal,
archive, reduction, and each closed family payload. The required current
fixture profiles are:

- `agent-attempt-payload-structural-fixture-v3`;
- `agent-work-product-payload-structural-fixture-v5`;
- `atlas-resolution-structural-fixture-v2`;
- `capability-profile-structural-fixture-v2`;
- `candidate-revision-carrier-manifest-structural-fixture-v1`;
- `candidate-revision-payload-structural-fixture-v3`;
- `candidate-seal-payload-structural-fixture-v2`;
- `check-receipt-payload-structural-fixture-v3`;
- `closure-payload-structural-fixture-v6`;
- `control-lifecycle-profile-structural-fixture-v7`;
- `control-record-event-structural-fixture-v6`;
- `control-record-file-structural-fixture-v1`;
- `control-record-revision-structural-fixture-v2`;
- `control-record-store-archive-structural-fixture-v1`;
- `control-record-store-seal-structural-fixture-v1`;
- `control-record-store-structural-fixture-v2`;
- `context-inspection-selector-structural-fixture-v3`;
- `delivery-reduction-structural-fixture-v5`;
- `discipline-pack-structural-fixture-v1`;
- `discipline-registry-structural-fixture-v1`;
- `evidence-packet-payload-structural-fixture-v2`;
- `execution-backend-profile-structural-fixture-v1`;
- `execution-image-structural-fixture-v1`;
- `execution-input-set-structural-fixture-v2`;
- `execution-observation-structural-fixture-v1`;
- `execution-output-manifest-structural-fixture-v1`;
- `execution-receipt-payload-structural-fixture-v3`;
- `execution-specification-structural-fixture-v1`;
- `director-brief-payload-structural-fixture-v2`;
- `director-decision-payload-structural-fixture-v5`;
- `knowledge-record-structural-fixture-v2`;
- `material-condition-payload-structural-fixture-v4`;
- `provider-descriptor-structural-fixture-v7`;
- `repository-contract-fixture-v9`;
- `work-boundary-payload-structural-fixture-v6`; and
- `work-delegation-payload-structural-fixture-v2`.

The Atlas Resolution fixture family includes one complete valid exact
selection, one incomplete result that illegally exposes a partial model, one
substituted processor version that must fail structurally, and one same-format
unsupported-release selection that must fail structurally; the latter two are
refusal fixtures, not compatibility carriers. The event fixture family
includes a negative subject proving that event payloads cannot duplicate
record-owned facts. Discipline record fixtures prove that optional source
provenance is valid while an obligation field or required source is invalid.
The Pack fixture retains its exact rc.9 authoring provenance; current schema
validation is separate from that historical coordinate. Repository fixtures
cover a valid fresh v22 selection, unsupported-generation discriminators,
prohibited migration input, mixed state, and bounded environment overflow.
The [v21 refusal fixture](../examples/repository-v21-predecessor-invalid/.lifecycle/repository.json)
retains only the exact predecessor schema discriminators needed to prove
fresh-only refusal. It supplies no predecessor role, authority, or record
compatibility.

Agent semantic parser/compiler behavior, Store replay, recovery, transactions,
and derived Attempt Views require focused implementation and operated evidence;
the payload fixtures do not prove those routes. No independently retained
Attempt View or predecessor Delivery-document fixture is a current rc.17
carrier.

Director–Worker coverage checks the compiled operating guidance for every
Worker assignment, exact Director Brief provenance, identical configured-
principal validation for human and agent Directors, and refusal of a Worker
claim as authentication. Existing assignment, input-integrity, provenance, and
authority diagnostics retain those boundaries; a role label adds no new
authentication mechanism or diagnostic class.

Execution fixtures cover idempotent allocation, one-time dispatch, observation,
cancellation, allocation after creation before return, dispatch after start
before return, retrieval, Output Manifest validation, Containment, Retirement, and
exact Reclamation obligations. The production operated row uses
`lifecycle.execution-backend-profile.docker-local.v1` and proves that a Cell
receives no Docker socket or Runtime-private target mount.
`lifecycle.execution-backend-profile.fault-injection.v1` MAY exercise every
interruption window, but it is test-only and MUST
NOT satisfy production Backend selection, a production operated row, or a
released Complete Lifecycle System claim.

The Atlas Work Boundary scope rule is likewise semantic and cross-subject, not
a structural JSON rule. `Effect.target` remains `plainText` because only
`local-read` and `local-write` kinds denote repository path scopes, while a
standalone Work Boundary payload does not carry the Repository Contract's
authoritative Atlas root as schema input. Therefore no
`work-boundary-payload-structural-fixture-v6` subject can prove the required
post-normalization intersection. Conformance instead requires focused compiler
or finalization evidence covering `.`, dot components, repeated separators,
backslash separators, lexical `..`, the exact Atlas root, a descendant, a safe
sibling, and a non-local opaque-text control.

An invalid fixture MUST require at least one standard error diagnostic. It MAY
allow additional diagnostics when independent implementations reach the same
primary failure through different safe continuation paths; the manifest names
required and allowed sets separately.

A valid fixture requires `complete: true`, `valid: true`, and no error
diagnostic. A fixture marked incomplete states the exact required stage that
cannot finish and why.

Fixture content demonstrates requirements. It does not create a requirement
absent from the normative specification.

## Conformance Use

[Conformance](CONFORMANCE.md) defines which profiles and fixture coverage each
implementation class requires. Passing a fixture subset is evidence only for
those covered rules. Schema compilation alone is never a complete Lifecycle
conformance claim.
