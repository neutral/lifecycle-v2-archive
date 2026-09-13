# Lifecycle Knowledge Projection

> Status: Draft

## Purpose

This document defines deterministic compilation of repository Knowledge into the
exact context supplied to one Lifecycle role. It owns projection inputs,
profiles, closure, role-specific additions, context tiers, provenance,
retrieval, bounds, caching, result objects, diagnostics, and security.

A Projection is not a generated summary of the repository. It is an immutable,
inspectable strict-JSON compilation from exact sources. It is runtime input,
not the document the Agent returns. A model can help create or revise a Work
Boundary, but a model MUST NOT decide which mandatory authoritative items the
compiler silently omits.

## Projection Classes

The two Projection classes support different decisions. Orientation makes the
registered choices and their exact retrieval routes available before a complete
proposal is selected. Execution supplies the mandatory closure already selected
by an admitted Work Boundary. Both preserve provenance and bounds, but an
Orientation discovery entry is not automatically an Execution requirement.

### Orientation Projection

An Orientation Projection supports each independently funded Delivery
reconnaissance turn before a Work Boundary exists and the read-only
reconnaissance used to resolve one frozen Material Condition. It binds:

- the Director objective;
- exact repository, Product State, raw Atlas State, complete valid Atlas
  Resolution, normalized-model, repository-contract, and specification bases;
- an exact semantically selected Atlas index preserving Map, Area, Point
  anchor/context, Resource, Check, publication-profile, and source provenance;
- the current Knowledge observation index, summaries, owners, relationships, and
  validation conditions;
- the Discipline Registry, Work Type groupings, and adopted Discipline
  summaries;
- repository implementation roots and Description coverage index;
- registered Check Bindings and capability profiles; and
- a bounded exact retrieval surface.

Those facts are carrier data, not digest-only promises. The Orientation core
contains ordered explicit Knowledge record and relationship indexes, governed
implementation roots, Description coverage and exemption entries, Check
Binding entries, Capability Profile entries, Projection Profile entries, and an
exact retrieval inventory with handles. Each sub-index has its own digest and
the core carries one aggregate index digest. The digests MUST reproduce the
explicit entries; a compiler MUST NOT substitute an unavailable private index
behind them.

Every Binding index entry carries the complete registered Check Binding object,
including all declared `checkIds`, selectors, command facts, modalities,
capability, environment, parser, limitations, and self-digest. Its derived
`checkIds`, evidence kinds, capability identity, and digest MUST equal that
object. Incompatible and currently unreferenced Bindings remain present so
reconnaissance can inspect the complete registered inventory.
Capability Profile entries likewise carry the complete profile object and
self-digest. Projection Profile entries carry the complete profile object,
self-digest, and all seven bounds.

The Orientation Projection does not claim that every indexed item is relevant
to the objective. It gives the reconnaissance role a complete trustworthy map
of current semantic owners and a deterministic way to retrieve exact sources.
The reconnaissance agent performs product judgment and proposes the exact roots
for a Work Boundary. Every selected root and material source MUST be cited by
stable identity and digest in that proposal.

Work Types and Discipline tags help reconnaissance find useful guidance. They
do not select records. Reconnaissance can propose any exact adopted Discipline
record, with or without naming a Work Type, and Director admission remains the
selection boundary.

For every fresh preparation, the Director objective is one complete
self-contained Brief supplied for that Delivery. The compiler MUST NOT inject
another Delivery's Director Brief, Work Boundary, Attempt View, interface
transcript, agent summary, or provider conversation into the Projection. The
exact fresh Brief and current repository epoch define the request.

For revision or reaffirmation, the Process derives the exact Orientation
objective from the selected operation, complete active Work Boundary, frozen
Material Condition, and Director rationale. The corresponding Agent Attempt
separately binds the fresh Investment's eligible-operation identity and the
`working` Process-state digest. The Orientation request and result still contain
no Work Boundary or Candidate field: their public subject is the derived
objective and digest, while Process state and the condition preserve the active
frozen basis. This Projection subject is distinct from the Execution Input Set:
initial preparation materializes no Candidate, while resolution materializes
the exact frozen Candidate read-only under [Execution](EXECUTION.md).

### Execution Projection

An Execution Projection supports builder, reviewer, correction, or acceptance
work after a Work Boundary has been admitted. It compiles the complete mandatory
Knowledge Closure selected by the boundary and role. Relevance is no longer a
provider search problem.

Its governing repository request is reconstructed from the active Boundary's
exact historical Snapshot, including its Atlas and bound Resources. The current
Candidate and explicit integration parent are separately bound subjects.
Execution compilation MUST NOT silently replace governing context with live
Atlas or require canonical HEAD to remain at that historical epoch. A context-
change resolution uses the exact retained integration parent to propose its
successor Boundary; authenticated readmission makes that selection active.

Its attention core carries the exact selected Capability Profile as
`{"profileId":<identity>,"profileDigest":<digest>}`. The summary beside that
binding is explanatory only. A later Agent Attempt MUST bind the same profile
identity and digest.

It also carries a compact Discipline notice: the selected Work Type ids and
each selected Discipline identity, title, summary, target path, revision, and
digests. The complete selected Discipline bodies are mounted as mandatory
material for builder and reviewer roles. They remain `discipline-guidance`, not
Product Knowledge authority.

An Execution Projection MUST fail closed when mandatory closure is unresolved,
conflicting, stale, or larger than the selected complete profile. It MUST NOT
truncate an obligation or choose a subset probabilistically.

## Projection Request

A projection request conforms to
[`projection-request.schema.json`](../schemas/projection-request.schema.json) and
contains:

- `schema`, exactly `lifecycle.projection-request.v5`;
- `class`, `role`, and `specificationRevision`;
- exact target identity and repository generation;
- for every class, exact commit, tree, Git object format, Product State,
  repository-contract, Atlas State, Atlas Resolution, and normalized Atlas
  model identities plus the deterministic repository-epoch digest for one
  loaded repository epoch;
- for Orientation, the deterministic Knowledge observation manifest and
  validation-result digests; it does not cite a Repository Snapshot,
  `repository-v9` result, or usable Knowledge Set as authority;
- for Execution, the complete valid Knowledge Set, Repository Snapshot, and
  successful `repository-v9` result digests;
- Atlas root, entrypoint, immutable specification and processor contract
  revisions, bound Atlas State, Atlas Resolution, and normalized-model digests,
  bound repository-local Resource-input digest, and complete valid resolution
  state;
- the selected Projection Profile identity, self-digest, and all seven numeric
  bounds;
- for Orientation, the exact Director objective and its UTF-8 byte digest;
- for Execution, the exact active Work Boundary Control reference containing
  kind, identity, revision, and digest, but not the revision body;
- for builder and reviewer roles, the exact Candidate base, current Candidate
  Revision Control reference, Candidate state digest, and Carrier-manifest
  digest;
- for reviewer, the non-null exact Candidate Seal Control revision reference,
  including kind, identity, revision, and digest; the compiler separately
  resolves that reference to the supplied validated Control revision;
- requested historical and reachable-context features;
- external-local and network retrieval disposition, any exact caller authority
  subject, and every authorized external immutable source revision; and
- the request digest.

The Orientation `subject.objective` is nonempty text without NUL whose exact
UTF-8 encoding is at most 1,048,576 bytes. This semantic-text bound replaces the
generic short-text bound for this field only. It applies to the complete fresh
Director objective or complete Process-derived boundary-resolution objective,
including the governing facts and Director rationale. The parser MUST enforce
the byte bound for multibyte text as well as ASCII. A character-count schema
constraint alone does not establish it.

The complete objective remains in the attention core and participates in
`counts.coreBytes` and the selected mandatory-byte budget. The larger field
bound does not enlarge any Projection Profile or exclude context from its
accounting. A request or complete Projection that exceeds its respective bound
MUST fail closed before Agent execution; the Runtime MUST NOT truncate the
objective, omit governing facts, or expand the selected profile automatically.

The request digest is the canonical-value self-digest with only its top-level
`digest` field omitted. After request validation and compiler selection, the
Projection identity is `projection:` followed by the lowercase hexadecimal
SHA-256 digest of the RFC 8785 canonical JSON value
`{"compilerDigest":"<compiler digest>","requestDigest":"<request digest>"}`.
`projectionId` is therefore not a request field and does not participate in a
digest cycle. The same exact request and compiler descriptor have the same
Projection identity; changing either changes the identity.

The request digest binds a reviewer Seal through the Control revision
reference's `kind`, `id`, `revision`, and logical revision `digest`; it does not
embed the Seal payload or semantic body and introduces no nested self-digest.
The repository-epoch
digest is the canonical-value digest of exactly
`targetId`, `commit`, `tree`, `objectFormat`, `contractDigest`,
`productStateDigest`, and `atlasStateDigest`. It identifies loaded bytes and
does not assert that `repository-v9` or a Knowledge Set is complete or valid.
`knowledgeObservationDigest` always identifies the deterministic observation
manifest, including partial readable records, relationships, coverage,
Bindings, source dispositions, and conditions. `knowledgeSetDigest` identifies
only a complete valid usable Knowledge Set; it is null for an incomplete or
invalid Orientation observation and non-null for every Execution request and
result. `knowledgeValidationDigest` binds the exact validation result for the
observation.

Each execution Candidate coordinate has required nullable `integration`. Before
integration it is null; after integration it binds the exact Assessment reference,
source Candidate reference, and full `canonicalParent` Snapshot. Both Projection
Request v5 and Knowledge Projection v6 retain that value. Reviewer Projection
requires it and validates it against the current Candidate lineage. Ordinary
builder successors inherit the origin through their exact ancestry.

For every reviewer Projection, these three Knowledge fields remain the admitted
canonical authority basis. The reviewer request separately binds the complete
Candidate Seal Control revision. After exact reference resolution, the related
Candidate Revision identifies the Knowledge Set derived from the sealed
Candidate tree. Candidate Knowledge can legitimately differ from canonical
Knowledge; a compiler MUST validate both exact identities and MUST NOT replace
the Projection basis with the sealed Candidate identity or require the two
digests to be equal.

An Orientation request has role `reconnaissance`, uses the exact registered
`orientation-standard-v1` or implementation-owned `orientation-large-v1`
selection, and contains no Work Boundary or Candidate field. The Repository
Contract's `defaults.orientationProjectionProfileId` explicitly selects the
profile before compilation; initialization continues to select the standard
profile. A size refusal MUST NOT trigger automatic profile expansion or removal
of mandatory material. The selected profile identity, all seven bounds, and
digest remain bound by the exact Request and Projection, including boundary
resolution and retained recovery.
For initial preparation its objective is the complete newly supplied Director
Brief; no prior Attempt View, interface transcript, or provider session is an
input.
For boundary resolution, the Process-derived objective carries the exact
operation, active-boundary, frozen-condition, and Director-rationale facts while
the Agent Attempt binds the `working` Process state and fresh Investment. An
exact retained copy of that Director rationale, not an Agent restatement, is
bound into the runtime-finalized successor Work Boundary revision after a
complete boundary-resolution invocation. An
Orientation request can bind an incomplete or invalid repository observation
because exposing the exact
missing coverage, unresolved source, relationship, and Binding conditions is
its purpose. Its deterministic Knowledge observation and validation result
remain exact and the compiler carries those conditions without claiming a
usable Snapshot, `repository-v9` result, or Knowledge Set. An Execution request
has role `builder` or `reviewer` and uses `execution-standard-v1` or
`execution-large-v1`. A builder request binds the eligible current Candidate
and no Attempt Seal. A prior Process Seal may remain current during correction
until Candidate advancement clears its current joins. A reviewer request binds
the current Candidate Seal Control revision
reference. The compiler MUST validate the separately supplied Seal revision,
resolve the request reference to that exact revision, and verify that the
Seal's `seals` and `governed-by` relationships, the related Candidate Revision,
Candidate base, sealed tree, and Candidate digest agree with the request and
independent observation. This agreement does not collapse the canonical
repository and Knowledge basis into the Candidate result.

The compiler MUST reject a request whose exact bases do not agree. An
Orientation compiler MUST reject an observation whose manifest and validation
digests do not reproduce the explicit indexes and conditions. The observation's
repository path, target, commit, tree, object format, contract, Product State,
Atlas State, Atlas Resolution, normalized model, and repository-local Atlas
Resource bindings MUST equal the loaded repository epoch; a partial observation
from another epoch is stale and rejected. It MUST NOT
compile from a mixed worktree, stale cache, untracked source, provider memory, or
several repository epochs presented as one subject.

## Projection Result

A successful projection conforms to
[`knowledge-projection.schema.json`](../schemas/knowledge-projection.schema.json)
and contains:

- projection identity, class, role, profile, compiler version, and
  specification revision, including the Projection Profile and compiler
  self-digests;
- exact basis identities and digests;
- one mandatory attention core;
- ordered mandatory Knowledge items;
- ordered implementation and Check Binding items;
- ordered source-context items authorized for the role;
- one reachable-context index;
- conflict and unresolved-reference arrays, empty for a usable complete
  Execution Projection;
- an omission manifest;
- byte and item counts; and
- the projection digest.

The compiler descriptor digest is the canonical-value self-digest of its `id`
and `version`; only the descriptor's own `digest` field is omitted. The
Projection digest is the canonical-value self-digest of the complete Projection
with only its top-level `digest` omitted. The `basis.requestDigest` and derived
`projectionId` prevent result identity from depending on the result digest.
The result `profile`, `profileDigest`, and `omission` profile fields MUST equal
the exact selected request profile and its self-digest.

A failed compilation returns a standard validation result with no usable
projection. A compiler MUST NOT return a projection marked usable when required
closure did not complete.

## Context Tiers

The tiers distinguish immediate direction, required supporting material, and
available neighboring context. They are not degrees of authority. A selected
Discipline is mandatory to deliver because the Boundary chose it, but its
advice remains optional to follow. A required Assurance remains authoritative
whether the adapter renders it directly or supplies its exact bytes through a
read-only mount. Reachable material can inform an Agent claim without becoming
a governing source.

### Tier 1: attention core

The attention core is compact, presentation-neutral data that every fresh
invocation for the role receives directly. For an admitted Delivery it contains:

- objective and selected meaning;
- included and excluded outcomes;
- assumptions and falsifiers;
- selected Work Types and concise selected Discipline handles;
- exact obligation ledger;
- required artifacts and Description coverage expectations;
- product effects and risks;
- required Checks and temporal modalities;
- the complete Work Boundary acceptance propositions, preserving each exact
  identity, claim, evidence kind and identity set, obligation, effect, and risk
  set, optional path and Check identity, `allowNotApplicable` value, and
  `notApplicableCondition`;
- exact Capability Profile identity and digest, capability summary, and
  prohibited effects;
- material-condition and completion return rules; and
- exact Work Boundary and Projection-request digests.

The attention core repeats stable goals; it does not duplicate every source
body. It remains a complete typed runtime value. A provider adapter renders its
semantic direction and semantic handles as readable Markdown or
provider-native instructions, while operational identities and digests stay in
runtime custody. The rendering MUST preserve every mandate field needed for
the role, including complete obligations, effects, risks, Checks, and
acceptance propositions; it MUST NOT expose the core as provider-visible JSON
or ask the Agent to reproduce its canonical ordering or bindings.

The compiler MUST copy every acceptance proposition field from the admitted
Work Boundary without summarizing or projecting it into a smaller shape. It
MUST reject any disagreement between the Work Boundary proposition and the
corresponding core proposition.

The core does not contain the Projection's own digest. That digest is computed
only after the complete result exists. This avoids a self-reference while the
request digest and derived `projectionId` still give the core a stable
pre-result identity.

### Tier 2: mandatory material

Mandatory material contains the complete exact Knowledge Closure and supporting
items required for the role. Each item carries:

- stable item and source identities;
- kind and authority;
- source path or immutable URI;
- record revision;
- source and semantic digests;
- inclusion reasons and relationship paths;
- one per-item canonical-value digest;
- exact inline UTF-8 bytes or exact bytes at a mounted-content locator, with
  media type, encoding, byte length, and byte digest;
- a presentation hint, which is non-authoritative; and
- any limits on how the item can be used.

A mounted-content locator resolves only inside the read-only Projection portion
of the exact Execution Input Set materialized by the Backend. It MUST NOT
resolve to an ambient mutable repository path or Runtime-private host path.
Mounted content can represent arbitrary bytes. Inline content is UTF-8 only and
its declared `byteLength` is the length of its UTF-8 encoding, not a language
string length. The content digest covers the exact bytes. The item digest omits
only the item's own `itemDigest` field and therefore binds the locator,
presentation hint, byte length, content digest, provenance, reasons, and use
limit.

`presentationHint` is one of `markdown`, `json`, `source`, `diff`,
`plain-text`, or `binary`. `binary` requires mounted content with encoding
`binary`; every other hint requires UTF-8 content. A presentation hint cannot
change decoding, omit bytes, replace bytes with a summary, or affect authority.

The result carries semantically selected normalized Atlas units in the ordered
`atlas` array. Each unit declares whether it is the Atlas root, a Map, an exact
Point anchor or context record, a Resource, a Check, or a publication profile;
every unit preserves its exact Atlas unit id and source path; Point units also
preserve exact Point id, containing Map, record kind, and normalized-subject
digest. Checks and publication profiles therefore cannot be flattened into
generic context.

Tier 2 then separates governed Knowledge in `mandatory`, implementation
material in `implementation`, exact registered Bindings in `bindings`, and
exact bound source context in `sources`. An Atlas Resource registration remains
one normalized unit in `atlas`; when that Resource is selected and has one
resolved repository-local binding, its exact blob bytes are a distinct
Atlas-authority `sources` item. The source item binds a stable identity derived
from the Atlas and Resource ids, the resolved object revision, and the Resource
binding byte digest. Distinct admitted and integration-parent source occurrences
MUST have distinct item and citation identities even when the owner and exact
bytes match. It exposes only immutable Projection-bundle bytes, never an
ambient repository locator. An item appears in exactly one semantic array.
Together with `atlas`, these arrays are the complete mandatory item set; the
category arrays do not duplicate one another.

A selected Discipline is a `mandatory` Knowledge item so the agent reliably
receives the exact guidance that the Work Boundary selected. Its authority is
`discipline-guidance`, never `product-knowledge`. Mandatory delivery means
available in the Projection; it does not mean mandatory compliance and creates
no Check, obligation, proposition, or Evidence entry by itself.

Every `sources` item carries one authority and additionally carries one exact
semantic identity with `class`, `subjectId`, `subjectDigest`, and
`evidenceKind`. `class` is `source`, `candidate`, or `evidence`. Source context
has null `evidenceKind` and authority `atlas`, `informational-source`, or
`repository-reality`. Candidate material has null `evidenceKind` and authority
`runtime-authenticated-fact`. Evidence has kind `check-receipt` or
`agent-work-product`. A Check Receipt is a `runtime-authenticated-fact`; an
Agent Work Product is an `agent-proposed-claim`. A compiler MUST NOT present an
agent claim as a runtime fact or reduce a runtime fact to untyped source
context.

Evidence source fields are derived only from an exact Control revision validated
by its runtime owner. The generic compiler MUST NOT accept raw bytes plus
caller-authored Evidence identity, kind, authority, or subject digest. For
reviewer input, every Check Receipt MUST be one exact validated `check-receipt`
Control revision. The runtime supplies the exact current admitted Work Boundary
revision through the compiler-input correspondence seam; that revision is
referenced exactly but its complete body is neither embedded in the Projection
request nor mounted as a provider-visible source merely to perform this proof.
The compiler MUST verify its identity, revision, digest, target, and admitted
product-base basis against the request and resolved Seal. It MUST then require
`final` phase and verify the Receipt's
`checks-seal` relationship and admitted Check selection against the exact Work
Boundary and Candidate Seal revisions. `request.repository.commit` remains the
admitted product-base authority basis; it may differ from the Candidate-base
commit. The compiler renders the exact Receipt Control revision as canonical
typed Markdown only at the provider-input materialization boundary and mounts
those bytes with media type `text/markdown`; the source revision, content
digest, and semantic Evidence subject digest are the logical Control revision
digest. It MUST NOT accept an earlier Receipt revision.

### Tier 3: reachable context

The reachable-context index identifies exact current material that is adjacent
but not mandatory. It can include `related-to` records, exact Atlas identities
from the normalized model, provenance sources, historical revisions,
neighboring Descriptions, and unaffected implementation locators.

Each entry includes category, identity, kind, summary, exact source revision,
digest, exact source byte length, authorized retrieval handle, and mounted path
when mounted. Tier 3 is navigation, not hidden authority. An
item becomes mandatory only through a new boundary, a standard mandatory edge,
Description coverage, or a Process-defined Material Condition.

An Agent Work Product can cite retained Tier-3 content with citation kind `projection`
only when the entry identity occurs exactly once in the complete reachable
array, `retrieval` is `mounted`, `mountedPath` is non-null, and the verified
compiled Projection inventory proves that exact mounted entry. The citation
copies the reachable `id` and `digest` into `subjectId` and `subjectDigest`.
Its locator follows the same Agent Work Product locator contract as other citation
kinds; it does not select or resolve the subject. This citation namespace is
claim support only. It does not turn the item into Knowledge, source context,
Candidate material, Evidence, boundary authority, or a Work Boundary
`sourceId`, and it does not make the item mandatory.

A compiler bounds Tier 3 under the selected profile. Every omitted reachable
entry is represented by deterministic per-category before, after, and omitted
item and byte counts plus the complete ordered omitted identity list. Mandatory
items never enter the omission manifest.

## Mandatory Closure Algorithm

For an Execution Projection, the compiler applies these steps in order.

### 1. Validate the subject

The compiler verifies the active Work Boundary, Knowledge Set, repository,
complete valid Atlas Resolution and normalized model, Candidate where
applicable, repository contract, and specification revision. It verifies that
every selected Knowledge record is current at the bound Knowledge Set and every
Atlas unit is an exact record in the bound normalized model.

### 2. Seed exact roots

Orientation Atlas roots are the normalized Atlas root and the exact Map ids in
its authored navigation. Those Maps select their exact normalized Point records;
a context record also selects the same Point's anchor. Execution Atlas roots are
only stable Atlas Resource source identities retained in the active Work
Boundary. In either class, an authored Content or Reference target expands Atlas
closure only by an exact registered Resource id or an exact registered URI.
Maps and Point records that cite a selected Resource join the closure; no path,
filename, objective-text, prose, embedding, or lexical match can seed or expand
mandatory Atlas membership. Atlas Checks and publication profiles remain
distinct and enter neither Orientation nor Execution merely because they
exist. Their normalized records remain bound by the Atlas Resolution; a future
Projection inclusion requires a separately owned exact-id selector. Current
Foundation Projection requests define no such selector.

Roots include:

- every Knowledge identity explicitly selected by the Work Boundary;
- every Discipline identity in the Work Boundary's Discipline selection,
  which MUST be the exact Discipline subset of selected Knowledge;
- every Knowledge identity referenced by an obligation;
- every Check Definition selected by a Work Boundary Check;
- every Knowledge identity referenced by an acceptance proposition;
- every Description that owns a required or affected implementation artifact;
- every Blueprint, Behavior, or Assurance explicitly named by a required
  artifact or effect/risk proposition; and
- every exact source-context anchor declared mandatory by the Work Boundary.

A free-text objective, tag, filename similarity, embedding score, or model guess
MUST NOT create or remove a mandatory root.

A required Artifact describes a final Product obligation. A future Knowledge
Artifact path that is absent from the exact repository tree supplies no current
Knowledge root. A valid Draft, Superseded, or Retired occurrence likewise does not become
governing Knowledge merely because its path is a required Artifact. Existing
Current Knowledge and explicitly selected identities retain their ordinary
closure requirements; missing selected Knowledge or a present invalid Artifact
is not excused as future work. Candidate validation and sealing later establish
the Artifact's required final disposition. This distinction grants no additional
write capability.

A required implementation Artifact scope with no exact Git node or governed
implementation descendants can select its exact Current primary tree
Description before the first file exists. The compiler also considers ordinary
applicable primary owners and refuses ambiguous ownership. It projects the
Description, not an invented directory blob. Once descendants exist, each
governed regular file must resolve through the ordinary coverage rules.

The exact boundary-local mandate direction may source an Obligation, but it is
already exactly bound inside the active Work Boundary selected by an
authenticated Director Decision. It therefore creates no Knowledge-closure root
and no mounted source item. The compiler accepts no other boundary-local
fragment as an Obligation source.

Named Work Types MUST resolve in the bound Discipline Registry but do not add
all members to mandatory closure. Direct exact Discipline selection without a
Work Type is valid. The selected Registry and adoption bindings come from the
same admitted epoch as the Boundary; recovery never consults an ambient Pack
or current work router.

### 3. Traverse universal relationships

The compiler applies the fixed-point rules in
[Relationships](RELATIONSHIPS.md): required refinement ancestors, applicable
incoming constraints, required Checks, required dependencies and dependency
components, supersession proof, and compatible Check Bindings.

### 4. Resolve Description coverage

For every governed implementation path in required artifacts or the candidate
delta, the compiler resolves exactly one current primary Description. It adds
that Description and its mandatory closure. Missing or ambiguous coverage makes
an Execution Projection unusable.

Before candidate work exists, a builder projection includes Descriptions for
all implementation paths admitted as required artifacts and every existing
implementation unit explicitly selected by the Work Boundary. After work, a
reviewer projection uses the sealed actual changed-path set as an additional
coverage root.

### 5. Apply role additions

The compiler applies the role rules below. Role additions can only add exact
items. They cannot remove universal closure.

### 6. Resolve source context

Required Knowledge sources and selected Atlas units are included only under the
request's read authority and retrieval policy. Atlas Point identity and
anchor/context kind come only from the normalized model; retrieval similarity
can surface candidates but cannot choose either. An inaccessible required
source is unresolved. Optional inaccessible context remains declared in Tier 3
with an access condition; it is not fabricated or represented as read.
For each selected resolved repository-local Atlas Resource, the compiler reads
the exact object named by the Resource binding, reproduces its byte digest, and
emits those bytes as one mandatory Atlas-authority source. A missing, denied,
unreadable, oversized, stale, or digest-mismatched selected binding fails closed.

### 7. Detect conflicts

The compiler includes every standard conflict and indeterminate authority
conflict that affects the closure. A usable Execution Projection requires no
unresolved material conflict. Orientation Projections can expose conflicts for
reconnaissance but MUST label them prominently and MUST NOT represent a resolved
meaning.

### 8. Order deterministically

Mandatory items are ordered by:

1. authority kind order: Behavior, Assurance, Blueprint, Description, Check,
   Discipline;
2. stable record identifier;
3. revision number;
4. source path or URI code-point order.

The remaining arrays use these exact Unicode code-point sort keys:

- implementation: path, then item identity;
- Bindings: Binding identity, then the ordered compatible Check identities;
- sources: reference, revision with null before strings, then item identity;
- reachable: category in the schema enum order, identity, then handle;
- conflicts: code, then identity;
- unresolved: required before optional, reference, then identity; and
- omission categories: category enum order, with omitted identities in the same
  reachable identity-and-handle order.

Every inner identity list is likewise code-point ordered and duplicate-free.
Filesystem order, map traversal order, retrieval timing, and model ranking do
not affect the digest.

### 9. Enforce the complete profile

The compiler applies item, per-item byte, total byte, relationship-depth,
source-retrieval, and reachable-index bounds. It can reject pathological input
earlier for security.

If mandatory closure exceeds a complete profile, compilation fails with
`lifecycle.projection.mandatory-too-large`. The result identifies the exact
contributing items and totals. The caller can narrow or split the Work Boundary
or select a larger supported profile. The compiler MUST NOT summarize, truncate,
drop, or rank mandatory authority to fit.

### 10. Canonicalize and digest

The compiler computes each item digest by omitting only `itemDigest` from that
item, canonicalizes the manifest, verifies
that mounted content matches every declared digest, and computes the complete
projection digest. The digest excludes adapter-specific prompt formatting and
provider session identifiers.

## Role Rules

### Reconnaissance

Reconnaissance uses an Orientation Projection. It receives:

- the complete current Knowledge index;
- the exact Discipline Registry and Work Type groupings;
- concise current-record summaries and relationship indexes;
- the exact normalized Atlas root and semantically selected Map, Point-record,
  and Resource context with full provenance;
- all validation conflicts, missing coverage, unresolved required sources, and
  Check Binding defects;
- repository implementation roots and exact coverage summary;
- supported capability profiles and every exact registered Check Binding,
  including incompatible or currently unreferenced Bindings; and
- authorized exact retrieval for records, sources, normalized Atlas units and
  their bound Resources, and repository reality.

Reconnaissance can retrieve and cite additional exact items. A mounted
reachable item uses the `projection` citation kind and remains separate from
the Knowledge and source identities that a Work Boundary can select. It MUST
return the selected identities and source digests that ground a proposed Work
Boundary. The runtime independently verifies those citations before presenting
the proposal for admission.

### Builder

A builder receives the attention core and full Execution Projection for the
active Work Boundary. It also receives:

- applicable realizations and dependency closure;
- all primary Descriptions for admitted and currently affected implementation;
- exact Candidate base, current Candidate Revision, and Carrier identity;
- required Check Definitions and executable binding guidance;
- prior failed receipts or reviewer findings still applicable to the same exact
  subject; and
- the exact product-write, input-read, temporary/cache, subprocess,
  product-network, product-credential, and external-effect envelope from the
  Capability Profile. Runtime Backend and Docker authority are not Agent
  capability.

The builder can inspect repository reality, but it MUST treat unprojected
material as observation rather than authority. When unprojected material appears
to change selected meaning, scope, effect, risk, architecture, or assurance, the
builder returns a Material Condition instead of silently widening the closure.

The builder receives each exact selected Discipline in full, with its
`discipline-guidance` authority and compact selection notice. Advisory guidance
cannot replace Product Knowledge or expand the edit window; the complete
Discipline root remains outside Candidate changes.

#### Failed integration correction

A conflict says the attempted construction could not advance the Candidate; it
does not say the builder's work is lost. Useful correction requires the exact
parent bytes that conflicted with that work, while the active Work Boundary
continues to govern. This is why the following input is a bounded read-only
correction selection rather than a new Knowledge basis or write grant.

A builder also receives correction context when the latest Integration
Assessment is conflicted or invalid under its current governing Work Boundary
and the Assessment's source Candidate is the current Candidate or an exact
ancestor through ordinary builder revisions. A successful later Assessment or
a different governing Boundary expires this selection. Correction context does
not assert that the failed result became a Candidate or changed its application
base.

The compiler reopens the Assessment's exact attempted parent Snapshot. It binds
the complete Assessment and its source Candidate, then mounts a complete
path-disposition description for every retained conflict path: file, directory,
or absent, including a blocking ancestor when present. A directory lists all
exact sorted descendant paths. Only entries equal to or below conflict paths,
and blocking ancestor entries, supply parent bytes. Descriptors preserve exact
human paths and bind each fixed-size source reference to its path and digest.
An invalid Assessment without conflicts supplies its exact diagnostics and an
explicit empty path description; it does not claim a complete physical diagnosis.

These mandatory read-only inputs enter source inventories, Projection digests,
and provider input digests under the selected complete profile. The attempted
parent does not become governing Knowledge or grant Capability. Independent
Candidate ancestry and exact Snapshot validation refuse a substituted parent,
source Candidate, or governing Boundary. Successive correction Attempts keep
this context only while the exact ancestry and latest-Assessment test holds.

#### Rejected Product repair

A builder selects the latest completed invalid-output Receipt carrying the exact
repair pair defined by [Control](CONTROL.md#builder-repair-output), while its
original input Candidate and governing Boundary remain the selected basis.
A later completed builder without a new repair pair does not revoke that
material while Product state and the governing mandate remain unchanged.
The Runtime may carry that selection through a contiguous chain of
`readmission-rebind` revisions only when their Candidate state and Carrier bytes
are identical and each corresponding Boundary is an exact unchanged-mandate
reaffirmation. The Work Boundary owner supplies that semantic comparison;
Projection MUST NOT implement another definition of unchanged mandate. Original
subjects remain repair provenance and the current Boundary alone governs.

The compiler structurally reopens the rejected Carrier and the selected valid
Candidate. It supplies the bounded rejection explanation, complete ordered
Candidate-to-rejected-tree difference inventory, exact changed Product bytes,
and explicit deleted-path dispositions in a separate read-only repair namespace.
It binds their sources in the Projection and provider Input Set. It MUST NOT
parse the rejected Knowledge into governing context or initialize the writable
workspace from rejected output. The builder decides which observations to use
and must produce a complete valid next Candidate under its current Boundary.

The ordinary mandatory count, byte, item and source bounds apply. A measured
impossible repair closure follows the builder Material Condition route; an
unavailable or substituted selected Carrier does not become an optional omission.
An ordinary builder or integration successor, changed semantic mandate,
unrelated Boundary or contradictory ancestry cannot carry the prior selection
forward as though it described the current writable input.

### Reviewer

A reviewer request is valid only after Candidate sealing has produced the
complete Candidate Seal Control revision and the runtime can resolve the
request's exact `{kind,id,revision,digest}` reference to that revision. A
reviewer receives the same authority closure as the builder plus:

- the sealed candidate identity and complete changed-path inventory;
- exact base-to-candidate diff or a mounted diff artifact;
- exact canonical typed Markdown renderings of current final Check Receipt
  Control revisions;
- actual Description coverage for every changed governed implementation path;
- actual changed Knowledge records and an explicit assertion that the Candidate
  contains no Atlas path change;
- every acceptance proposition and required evidence mapping; and
- builder claims clearly separated from runtime-authenticated facts.

The reviewer receives the same selected Discipline guidance as the builder.
Review can mention useful adherence or a material mismatch, but Discipline
alone never creates an acceptance failure. A requirement that must gate
acceptance must already exist in an authoritative obligation or proposition.

The compiler validates Candidate Knowledge and Description coverage from the
sealed Candidate observation, not from the base Knowledge Set. Every sealed
changed governed path is an additional coverage root. The result's Projection
basis nevertheless remains the admitted canonical Knowledge Set; the complete
Seal separately binds the validated Candidate Knowledge Set. The compiler MUST
NOT require those two Knowledge Set digests to be equal. The result's exact
Binding items carry the registered Binding body, all declared `checkIds`, and a
separate `compatibleCheckIds` resolution for this Projection; their identities
and digests MUST equal the corresponding Orientation Binding index entries.

Governing, integration-parent, and Candidate Knowledge closures remain basis-
qualified collections. Parent Knowledge comes from the exact retained Snapshot;
its occurrence identity MUST remain distinct from admitted and result identity,
including when all three contain equal bytes. Citation subject validation and
exact retrieval preserve that basis. Upstream B→P changes are visible context,
not Delivery-authored changes. Reviewer inputs include exact original baselines
and all mandatory applicability subjects under
[Evidence](EVIDENCE.md#integration-applicability-review).
The compiler MUST preserve every basis occurrence of a shared Knowledge identity,
including when they have equal source bytes. Different revision numbers or
source digests between bases MUST NOT be treated as a conflict by themselves
or reconciled by choosing one. Occurrences with the same source digest must
agree on enduring identity, revision, semantic digest, and kind; a discrepancy
is inconsistent metadata, not a legitimate change between bases. Each Set
still independently validates its own relationships, supersession, and conflict
rules.

A changed Description is Knowledge even when its path is under an
implementation root or selected as a required documentation artifact.
Reviewer coverage applies to governed implementation
artifacts, not recursively to the Description record itself. Changed Knowledge
enters the Candidate Knowledge closure through its owning record rules.

The reviewer MUST NOT receive unretained builder reasoning or provider session
history as evidence. A summary can orient review but cannot substitute for the
sealed result or Receipt.

## Projection Profiles

The standard profiles have these exact seven bounds. MiB means 1,048,576 bytes.

<!-- markdownlint-disable MD013 -->

| Profile | Mandatory items | Mandatory bytes | Per-item bytes | Reachable items | Reachable bytes | Source bytes | Relationship depth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `orientation-standard-v1` | 256 | 4 MiB | 1 MiB | 4096 | 32 MiB | 8 MiB | 24 |
| `execution-standard-v1` | 512 | 8 MiB | 1 MiB | 4096 | 32 MiB | 8 MiB | 32 |
| `execution-large-v1` | 4096 | 64 MiB | 4 MiB | 16384 | 128 MiB | 32 MiB | 128 |

<!-- markdownlint-enable MD013 -->

The seven fields are `maximumMandatoryItems`, `maximumMandatoryBytes`,
`maximumItemBytes`, `maximumReachableItems`, `maximumReachableBytes`,
`maximumSourceBytes`, and `maximumRelationshipDepth`. Their meanings are exact:

- mandatory items are all entries across `atlas`, `mandatory`,
  `implementation`, `bindings`, and `sources`;
- mandatory bytes are `counts.coreBytes` plus the exact content byte lengths of
  those five arrays;
- per-item bytes bound the exact content byte length of every Tier 2 item;
- reachable items and bytes are the retained `reachable` entries and the sum of
  their declared exact byte lengths;
- source bytes are the sum of exact content byte lengths in `sources`, so source
  content satisfies both the source and mandatory-byte bounds; and
- relationship depth is the number of edges, not nodes, in the longest
  relationship path used to include an item. A represented path stores its root
  and every successive target identity, so its edge count is array length minus
  one and the release ceiling of 128 edges permits 129 identities.

All byte counts are raw byte counts. Inline text counts its UTF-8 encoding.
Mounted arbitrary content counts its exact mounted bytes. Content repeated in
two distinct items counts once for each item; the compiler therefore removes an
exact duplicate identity before constructing the arrays rather than discounting
duplicate bytes. The static schema maxima are release ceilings, while the
selected profile supplies the tighter operative bounds.

An implementation can expose larger implementation-owned profiles, but it MUST
identify all seven bounds and MUST NOT present a partial profile as a standard
complete profile.

The current Foundation implementation additionally registers
`orientation-large-v1`: 512 mandatory items, 8 MiB mandatory bytes, 1 MiB per
item, 4096 reachable items, 32 MiB reachable bytes, 8 MiB source bytes, and 32
relationship edges. This optional Repository Contract entry has its own exact
identity and digest. Selecting it is explicit Director-directed canonical
configuration; it does not change any standard profile, grant capability,
create authority, or relax complete mandatory closure. Unknown Orientation
profiles and altered bounds under this identity are invalid. Preparation and
boundary resolution use their exact selected repository basis; retained
operations reopen the original Request rather than consulting changed defaults.

The closed Request and Projection schemas admit this bounded implementation
selection. Its fixture and implementation checks establish exact selection and
refusal behavior, not operated qualification or a publication status transition.
Existing Foundation v22 targets retain their identities and standard defaults;
they can register and explicitly select this profile under the current exact
Draft publication. This addition supplies no predecessor interpretation or
implicit migration.

An implementation that cannot support the mandatory bytes of a standard profile
returns `complete: false`; it does not claim a valid smaller projection.

## Retrieval and Projection Supplements

A runtime MAY expose exact on-demand retrieval for Tier 3 through a Context
Resolver. The resolver accepts only a handle present in the Projection, applies
the request's authority and retrieval policy, and returns:

- original projection digest;
- requested handle and item identity;
- exact source revision and digest;
- retrieved bytes or a typed inaccessible result;
- retrieval time; and
- resolver identity.

A successful retrieval creates a Projection Supplement. Supplements are
observations attached to the original Projection. They do not mutate its digest,
change mandatory closure, or grant authority.

The current Agent Work Product `projection` citation kind does not cite a
resolver or inaccessible entry. Such an entry remains ineligible until an
installed owned Supplement contract binds the retrieved bytes back to the exact
Projection.

When a retrieved item reveals a material missing obligation or conflict, the
Agent returns a Material Condition. A later Work Boundary or Projection can make
that item mandatory through the normal authority route.

The first conforming implementation MAY materialize all authorized Tier 3 items
in a read-only bundle instead of running a resolver service. It still records
the same handles, identities, and digests.

## Omission Manifest

The omission manifest proves what the compiler did not include. It contains:

- profile identity, profile self-digest, and the exact seven bounds;
- the six ordered categories eligible for omission;
- per-category item and byte counts before, after, and omitted;
- `enumerationComplete: true` for every category;
- deterministic policy `category-code-point-prefix-v1`; and
- every omitted item identity in exact category-and-identity order; and
- a statement that mandatory closure has zero omissions.

A projection with any mandatory omission is invalid. A prompt or adapter MUST
not hide the omission manifest when it presents Tier 3 availability to an Agent.

The compiler sorts the complete eligible set by category in the schema's enum
order, then by item identity and retrieval handle in Unicode code-point order.
Within each category it retains the longest prefix that still satisfies the
selected reachable-item and reachable-byte bounds. It records all remaining
identities as omitted. The before count and byte total cover the complete
enumerated category; the after pair covers retained entries; the omitted pair
is their exact difference. The manifest profile digest and bounds MUST equal the
selected request profile.

## Counts

`counts` is reproducible bookkeeping, not a summary estimate. Each of `atlas`,
`mandatory`, `implementation`, `bindings`, `sources`, and `reachable` contains
the exact array item count and the sum of that array's declared content or
reachable byte lengths. `coreBytes` is the byte length of the RFC 8785 canonical
JSON encoding of `core`. `conflicts` and `unresolved` are exact array counts.

`counts.totalBytes` is the supplied-content volume: `coreBytes` plus the byte
totals for `atlas`, `mandatory`, `implementation`, `bindings`, `sources`, and
`reachable`. It excludes JSON framing outside `core`, omission bookkeeping,
and conflict or unresolved diagnostic text. It does not replace any profile
bound. The compiler and validator MUST recompute every count and reject a
mismatch.

## Caching

A cached Projection is reusable only when all cache-key facts match exactly:

- specification revision;
- compiler descriptor digest;
- projection class, role, and profile;
- request digest and Orientation objective digest;
- repository commit, tree, Product State digest, and repository-epoch digest;
- repository-contract digest;
- Atlas State, Atlas Resolution, normalized-model, and repository-local Atlas
  Resource-bindings digests;
- Knowledge observation manifest and validation-result digests;
- Knowledge Set digest when one exists and always for Execution;
- Work Boundary digest for execution;
- candidate digest for candidate-sensitive roles;
- retrieval policy and external immutable source revisions; and
- standard profile bounds.

A cache hit MUST reverify every mounted content digest before dispatch. A
provider session, branch name, wall clock, or objective text alone is not a
cache identity.

## Role Brief and Semantic Template Compilation

For every dispatched Agent Attempt, the runtime binds one complete validated
Projection to one exact role subject and deterministically compiles:

- one concise body-only Role Brief that quotes the exact normalized selected
  Director Brief and explains the Worker role, its technical assignment, its
  Director counterpart, projected source handles, effective capability, and
  workspace behavior in readable Markdown under the
  [operating-roles contract](AUTHORITY.md#operating-roles);
  and
- one versioned semantic-workspace template selected for that role, including
  the only allowed dispositions, sections, typed proposal fields, and
  local-handle grammar.

The complete Projection, role subject, Director Brief Control identity and
envelope, admitted Work Boundary when present, Candidate coordinate when
present, Capability Profile, Investment, and planned Attempt remain typed
runtime values. The Role Brief renders only the meaning an Agent needs; it has
no Control front matter, global identity, digest, envelope, or canonical
binding. Its quoted Director direction, exact Role Brief bytes, template, and
typed runtime coordinates enter the pre-Attempt input-material digest. The
runtime uses the template to initialize the governed `semantic.md` workspace;
it does not expose a second read-only template file. These inputs are immutable
for the invocation. A Role Brief is explanatory input and cannot add Knowledge,
authority, capability, or an eligible operation not already present in the
typed runtime values.

The technical assignment comes from the exact Projection `role`; the Director
counterpart is the supplier of the bound Director Brief. The compiler MUST NOT
infer that either role is human, invent a counterpart identity, or create a
human approval dependency. It renders the concise operating guidance into the
existing Role Brief without adding a new Process, Control family, or authority
selection. A manually requested Attempt quotes its fresh activity direction;
a delegated pass quotes its exact original standing direction.

The Role Brief, exact projected source files, and governed workspace are the
provider-facing contract. The Agent MUST NOT receive or reproduce a Control
record schema closure, global identity rules, set-order rules, digest
algorithms, fixed runtime bindings, or transport envelope. It edits only the
body-only semantic Markdown selected by the template, beginning with the exact
title and containing no front matter or delimiter lines. Retained Markdown is
a durable Control representation, not IPC among runtime functions.
[Agent Attempts](ATTEMPTS.md) owns workspace observation, semantic parsing, and
deterministic Agent Work Product compilation.

## Presentation and Provider Adapters

The Delivery Inbox, selected Delivery View, Decision Readiness, Candidate
difference, and watch result are runtime read models, not Knowledge
Projections. They may render exact Projection references already selected by a
retained Attempt, but they do not traverse Knowledge closure, become provider
input, grant read capability, or supply context to a later Agent Attempt. Every
Next Pass invocation compiles a fresh Projection through the normal request and
closure rules.

A Projection is presentation-neutral. A provider adapter can:

- render the exact compiled Role Brief into the provider's supported
  instruction surface;
- choose provider-specific event plumbing for dispatch and observation; and
- apply provider compatibility requirements.

The Runtime compiles projected bytes into the exact Execution Input Set. The
Backend and fixed Cell runner alone materialize Tier 2 bytes, expose permitted
Tier 3 retrieval, and initialize the governed semantic workspace from the role
template. The provider adapter receives those fixed Cell-side coordinates; it
does not create paths, grant filesystem authority, or own their lifecycle.

The adapter MUST NOT:

- change field meaning;
- omit a mandatory attention-core field;
- replace exact content with an uncited summary;
- merge Agent or provider memory into the Projection;
- add capability or authority; or
- ask the Agent to manufacture a Control revision envelope, fixed binding,
  global identifier, ordering, digest, or transport wrapper; or
- represent provider formatting as part of the projection digest.

## Security

These rules preserve correctness and confinement among good-faith collaborators.
They do not add a separate adversarial-insider threat model or claim protection
from a collaborator who controls the runtime or immutable source publication.

The compiler and resolver MUST:

- process only exact tracked or otherwise explicitly immutable authorized
  inputs;
- reject symlinks, submodules, executable replacements, path escapes, encoded
  separators, NUL values, and case-folded aliases where prohibited;
- keep Director credentials, provider credentials, ephemeral runtime state, and
  unrelated target data out of Projection content;
- deny external retrieval by default;
- enforce explicit schemes, hosts, networks, timeouts, size limits, redirects,
  and content types for authorized retrieval;
- treat all content as untrusted information that cannot raise instruction
  priority or grant tools; and
- make Projection materializations unreachable at Runtime Retirement and track
  any remaining physical Cell bytes through private Reclamation.

## Standard Projection Diagnostics

A compiler reserves these codes:

<!-- markdownlint-disable MD013 -->

| Code | Condition |
| --- | --- |
| `lifecycle.projection.request-invalid` | Projection Request shape, semantics, or self-digest is invalid. |
| `lifecycle.projection.basis-mismatch` | Request bases do not identify one coherent operation subject, including separately bound admitted and sealed Candidate bases for review. |
| `lifecycle.projection.profile-mismatch` | Class, role, profile identity, self-digest, or selected bounds disagree. |
| `lifecycle.projection.index-invalid` | An explicit Orientation index is incomplete, incorrectly ordered, or digest-invalid. |
| `lifecycle.projection.knowledge-invalid` | The bound Knowledge Set is incomplete or invalid for the requested profile. |
| `lifecycle.projection.discipline-invalid` | Discipline discovery or selected guidance disagrees with its exact Registry, Work Types, selected record bytes, or advisory authority. |

| `lifecycle.projection.boundary-invalid` | The Work Boundary is invalid, stale, or unsupported. |
| `lifecycle.projection.root-unresolved` | A mandatory selected or Obligation-source identity does not resolve to its one exact current or boundary-local subject. |
| `lifecycle.projection.relationship-unresolved` | Mandatory relationship closure cannot resolve. |
| `lifecycle.projection.description-missing` | A governed implementation path has no primary Description. |
| `lifecycle.projection.description-ambiguous` | A governed implementation path has several primary Descriptions. |
| `lifecycle.projection.check-binding-missing` | An included Check has no compatible binding. |
| `lifecycle.projection.check-binding-mismatch` | Candidate and base closure resolve incompatible exact bytes for one Binding identity. |
| `lifecycle.projection.citation-identity-conflict` | Knowledge occurrences sharing an exact source digest disagree on enduring identity, revision, semantic digest, or kind. Different source digests across admitted and Candidate bases do not cause this diagnostic. |
| `lifecycle.projection.authority-conflict` | Applicable current sources conflict materially. |
| `lifecycle.projection.source-inaccessible` | Required source context is not available under current authority. |
| `lifecycle.projection.source-stale` | A required source does not bind the exact current record revision or declared digest. |
| `lifecycle.projection.mandatory-too-large` | Complete mandatory closure exceeds the selected profile. |
| `lifecycle.projection.bounds-invalid` | Reachable, source, per-item, or relationship-depth totals exceed or misstate the selected bounds. |
| `lifecycle.projection.counts-invalid` | Projection or omission item and byte counts do not reproduce the represented arrays. |
| `lifecycle.projection.mandatory-omission` | Mandatory closure was omitted, truncated, or summarized. |
| `lifecycle.projection.reviewer-seal` | Reviewer Projection does not bind the exact current Candidate Seal and observation. |
| `lifecycle.projection.content-digest` | Mounted or inline bytes differ from their declared digest. |
| `lifecycle.projection.order-invalid` | Projection item identity or ordering is duplicate, nondeterministic, or incorrect. |
| `lifecycle.projection.cache-stale` | A cached projection does not match every exact cache-key fact. |
| `lifecycle.projection.external-denied` | External retrieval was requested without an allowed policy. |
| `lifecycle.projection.compiler-failure` | The compiler encountered an implementation-owned failure without a more specific standard condition. |

<!-- markdownlint-enable MD013 -->

Implementations use their own namespace for operational conditions not defined
by this specification.
