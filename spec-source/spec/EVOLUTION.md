# Lifecycle Evolution

> Status: Draft

## Purpose

This document defines how Lifecycle publications, repositories, Control Record
Stores, record families, protocols, compilers, adapters, and conformance claims
evolve without ambiguous authority or silent compatibility.

Lifecycle protects product and Process meaning across transitions. A newer
runtime cannot reinterpret an older database, Markdown document, Journal,
Evidence carrier, or authenticated subject merely because fields, rows, or
headings look similar.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Independent Version Coordinates

A version answers which contract gives bytes or behavior their meaning. Those
contracts change at different boundaries: a public request can change while a
Knowledge schema remains fixed, and an implementation selection can change for
future work while an open Attempt still binds its prior selection. One package
number cannot express all of these relationships.

Lifecycle therefore uses independent coordinates:

<!-- markdownlint-disable MD013 -->

| Coordinate | Identifies |
| --- | --- |
| Specification publication | One immutable normative document, schema, diagnostic, fixture, and Release Notes set. |
| Repository Contract | Repository-visible discriminator, selected publication, target layout, and installed implementation compatibility. |
| Control Record Store profile | One Process-scoped physical SQLite carrier, custody layout, SQL schema, invariants, limits, seal, and archive contract. |
| Control revision and relationship profile | Common logical revision fields, typed payload boundary, semantic Markdown binding, exact relationship targets, ordering, and logical digest. |
| Control event and reducer profile | Closed event vocabulary and payloads, predecessor chain, atomic finalization, replay, standing, recovery, and eligible-operation derivation. |
| Control family registry | Closed family names, semantic owners, authority classes, edit windows, revision policies, finalization events, payload profiles, and relationship cardinalities. |
| Governed authoring profile | Working-file template, editor capability, edit window, submission, observation, normalization, abandonment, Containment, Retirement, Reclamation, and recovery. |
| Adjacent-file profile | Allowed purposes, content-addressed naming, byte identity, descriptor, retention, disclosure, limits, and archive behavior. |
| Store seal and archive profiles | Logical inventory, terminal head, immutable seal, SQLite retrieval integrity, complete movement, and read-only verification. |
| Knowledge schema | Repository-authored product-meaning shape and semantic processing. |
| Atlas integration selection | Exact external release, immutable specification revision, authored format, processor contract revision, resolved profile, output schemas, Lifecycle consumer profile, admitted historical-snapshot semantics, no-write rules, immutable governing snapshots, explicit integration and context-change readmission, and conditional exact-result acceptance. |
| Projection schema and profile | Compiled context carrier and role-specific closure algorithm. |
| Agent Work Product templates, parser, and compiler | Exact body-only role grammar, local handles, normalized semantic value, fixed runtime bindings, reference resolution, and typed Work Product compilation. |
| Provider input profile | Exact materialization, inventory, role brief, Projection, subject, and capability-visible bytes. |
| Candidate Revision Carrier profile | Immutable manifest, Git object closure, root tree, publication, availability, materialization, reference, and reclamation rules. |
| Execution Backend and Cell profiles | Private Specification, Input Set, Image, allocation, one-time dispatch, observation, cancellation, retrieval, Output Carrier and Manifest, Containment, Retirement, and Reclamation contracts. |
| Runtime protocol | Public operations, state semantics, transactions, inspection, export, recovery, and errors. |
| Interface protocol | Public requests, views, eligible-operation presentation, and CLI handoff. |
| Provider-adapter protocol | Provider-neutral rendering, governed Cell workspace, provider control-plane separation, provider effect, and bounded observation contract. |
| Authority-subject profile | Exact authenticated subject construction, signature selection, replay, and validity rules. |
| Conformance profile | Exact features, limits, fixtures, operated scenarios, and exclusions claimed. |

<!-- markdownlint-enable MD013 -->

A publication, Repository Contract, implementation package, or conformance
claim states every coordinate on which its behavior depends. Package version
`1.0.0` is not a substitute for any omitted coordinate.

SQLite library versions, page layout, row identifiers, query plans, and archive
filenames are implementation or retrieval facts unless an owning profile
explicitly selects them. They are not semantic version coordinates by
proximity to the Control Record Store.

## Current Foundation rc.17 Cut

This cut selects the actor-neutral
[Director–Worker pair](AUTHORITY.md#operating-roles) under repository v22 and
runtime/interface v17. Director Brief v2, Director Decision payload v5 and
subject v4, and Authorization Review v1 have their exact current named
identities. Director provenance and the renamed Control families and events
use common schema v2, Control Store v2, revision v2, event v6, reduction v5,
Control lifecycle v7, and physical SQLite `user_version = 3`.

Finite Work Delegation v2 and stable exact artifact inspection retain their
existing responsibilities. Context and Code bases and Source References select
v2; the context-inspection selector schema selects v3. Delivery View v2 requires
the Work Delegation section and
permits an explicitly unavailable Agent Investment preview. Exact retained
inspection provenance remains separate from
the full operation, authorization, recovery, and watch generation.

Atlas 0.8.0 strict JSON source, its immutable processor, consumer v2 governing
partition, integration rule v2, and Material Condition v4 remain selected.
Every predecessor repository, Store, public protocol, and recovery plan is
refused. Earlier publications and operated results retain their exact historical
subjects; they do not qualify or continue under this cut.

The cut retains the separation of semantic Evidence assessment from Foundation provenance,
retains preparation context at first opening, and makes exact measured context
refusal a completable mandate-resolution course. Product Knowledge permits
contiguous nongoverning Draft successors above one Current revision. A builder
Receipt can retain the exact rejected Product Carrier through the new
`builder-repair-output` schema v1 for read-only correction; it does not promote
invalid Knowledge or change the selected Candidate. Permitted Projection
capacity can change through unchanged-mandate readmission, while capability
remains part of the mandate comparison. It does not grant external CI
acceptance, dynamic policy selection, linked worktrees, or a migration route.

The rc.17 Draft retains the Orientation objective's explicit
[semantic-text bound](PROJECTION.md#projection-request) in place of generic
short text. Complete boundary-resolution context remains mandatory, and the
existing Projection Profile identities and seven numeric bounds remain
unchanged. This accepted-input change belongs to the exact current Draft
schemas, compiler and publication selection. It does not reinterpret retained
requests or extend an earlier publication's limit. Current rc.17 supplies no
continuation or rebinding route for work selected under an earlier publication.

The current Draft target is one coordinated fresh-only hard cut:

<!-- markdownlint-disable MD013 -->

| Family | Current target |
| --- | --- |
| Product package | `1.0.0` |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.17` |
| Repository Contract | `lifecycle.repository.v22` |
| Runtime protocol | `lifecycle.runtime.foundation.v17` |
| Interface protocol | `lifecycle.interface.foundation.v17` |
| Provider adapter | `lifecycle.provider-adapter.v7` |
| Default Provider Descriptor | `codex-exec-standard-v7`; `openai-codex-cli >=0.153.4 <0.154.0`; current selected Image tool `0.153.4` |
| Production Execution Backend | `lifecycle.execution-backend-profile.docker-local.v1` |
| Execution Cell runner | `lifecycle.execution-cell-runner.v1` |
| Atlas release and format | `0.8.0`, authored format `1` |
| Atlas specification revision | `2c7a78540ac30138218b12803f1c045cee8b109a` |
| Atlas processor contract revision | `2c7a78540ac30138218b12803f1c045cee8b109a` |
| Atlas resolved and consumer profiles | `neutral.atlas-validator.resolved`, `lifecycle.atlas-consumer.v2` |
| Control Record Store | `lifecycle.control-record-store.v2`; physical SQLite `user_version = 3` |
| Control record revision | `lifecycle.control-record-revision.v2` |
| Control event | `lifecycle.control-record-event.v6`, closed twenty-five-kind vocabulary |
| Adjacent referenced file | `lifecycle.control-record-file.v1` |
| Store logical inventory | `lifecycle.control-record-store-logical-inventory.v1` |
| Store seal | `lifecycle.control-record-store-seal.v1` |
| Archive manifest | `lifecycle.control-record-store-archive.v1` |
| Delivery reduction | `lifecycle.delivery-reduction.v5` |
| Control lifecycle | `foundation-delivery-control-lifecycle-v7` |
| Candidate Carrier and execution | `lifecycle.candidate-revision-carrier-manifest.v1`; `lifecycle.execution-backend-profile.docker-local.v1`; `lifecycle.execution-specification.v1`; `lifecycle.execution-input-set.v2`; `lifecycle.execution-image.v1`; `lifecycle.execution-observation.v1`; and `lifecycle.execution-output-manifest.v1` |
| Governed Attempt payloads | Director Brief v2, Work Delegation v2, Agent Attempt v3, Execution Receipt v3, Candidate Revision v3, Candidate Seal v2, Check Receipt v3, and Closure v6 |
| Agent Work Product | `agent-work-product` payload v5 with `lifecycle.agent-work-product-body.<role>.v4`, selected v6 parse-result and fixed-binding subjects, and no provider-final-output carrier |
| Provider input | `lifecycle.agent-provider-input.standard-v8`, `lifecycle.agent-input-content-inventory.v8`, `lifecycle.agent-input-material.v8`, `lifecycle.agent-input-bundle-manifest.v8`, and `lifecycle.agent-input-bundle-tree.v8` |
| Director authority | `director-brief` payload v2; `director-decision` payload v5; `lifecycle.director-decision-subject.v4`; `lifecycle.authorization-review.v1` |
| Delivery record families | the fourteen closed rc.17 families in [Control](CONTROL.md#closed-delivery-record-family-registry) |
| Knowledge and Projection | Knowledge record v2, Knowledge Set v2, Discipline Registry v1, Pack v1, Work Boundary payload v6, and Projection v6 under repository-v22 carriers |
| Runtime read models | disposable Inbox, selected Delivery View v2, Decision Readiness, Candidate difference, watch, Control inspection, the closed nine-member context-inspection selector union, deterministic Authorization Review, and invocation-private challenge handoff under runtime/interface v17 |

<!-- markdownlint-enable MD013 -->

The package remains `1.0.0` because package version and Foundation
qualification are independent. The rc.17 coordinates above select one current
Foundation architecture and do not negotiate alternate target generations.

This cut replaces rc.16, Repository Contract v21, and runtime and
interface protocols v16. It has no reader, writer, adapter, alias, migration,
adoption, recovery, or challenge compatibility with those coordinates. An
unsupported carrier is observed only far enough to refuse its fixed
discriminator before authority, Process mutation, Backend allocation, or
dispatch.

The selected rc.17 cut retains advisory Discipline Knowledge v2, exact Pack
adoption, Registry Work Types, the Integration Assessment family,
explicit integration operation, independent Delivery repositories, immutable
per-revision application bases, exact context-change readmission, and
conditional publication under short canonical locking. Projection Request v5,
Knowledge Projection v6, Candidate payload v3, Boundary v6, Material Condition
v4, Work Product payload v5 with parser/compiler/body v4, Packet v2, Director
payload v5/subject v4, Closure v6, Control lifecycle v7, event v6, and reduction
v5 carry the selected contracts. Knowledge/Set v2, Pack/Registry v1, Carrier v1,
Provider Adapter v7,
and the sole Delivery Process retain their existing ownership. This is a fresh
hard cut with no reader or recovery compatibility for predecessor targets.

There is no reader, conversion, or recovery compatibility for former target
contracts. An immutable Discipline Pack is a different subject: its exact
`contract.specificationRevision` records authoring provenance. A Pack authored
at rc.9 that already selects Knowledge v2 remains adoptable if its unchanged
bytes satisfy current Knowledge v2 and target contracts. This does not retag
the manifest, read an old target, or loosen the selected runtime cut.

Runtime and interface v17 close inspection to nine exact selector kinds:
Knowledge index and record, Code index and file, Atlas overview, Point, and
Resource, Source, and Authorization Review. Every artifact result is bounded,
binds its exact retained inspection selection and historical dependencies, and
uses Runtime-issued selector-bound continuation when paged. Current observation
is separate from retained content identity. Authorization Review preserves the
full exact current generation. Productive semantic operations over an
existing Delivery require the exact generation on which the complete input was
authored. Admit, accept, and no-ship may use a volatile single-use
invocation-private challenge only after the Runtime produces the exact
deterministic Authorization Review and rederives its authority subject under
lock; neither the Review nor challenge is authority or retained Control.

Within the unpublished rc.17 Draft, the Delivery reduction meaning explicitly
treats Standing, Candidate condition, Activity recovery, and physical Store
disposition as orthogonal. Clarifying the applied-initial-admission interval,
recoverable pre-effect `in-progress` activity, and terminal Store-recovery
overlay changes no event, enum, schema shape, record, repository, runtime,
interface, or migration coordinate. No authenticated publication or compatible
predecessor state is reinterpreted.

Within this same unpublished Draft, the integrated model makes responsibility,
architectural laws, productive completeness, and operation-contract selection
lifetimes explicit. These clarify existing owners and permitted routes without
adding public fields, records, states, protocols, or a policy framework. Changes
to internal valid-context types or selected implementation mechanics do not
reinterpret retained plans or permit recovery under changed defaults. Future
changes to an exact published profile still require its own evolution review.

The same unpublished Draft makes narrow consequential capability ownership
explicit within the existing Runtime. Execution, Director authority custody,
and canonical transition expose scoped operations while ordinary composition
receives no general Engine, signer, or canonical-write primitive. This changes
no record, public field, profile, event, protocol, or deployment topology.
Existing exact-subject validation, effect-time currentness, authenticated
Decision, and retained recovery rules continue to govern each operation.
Software ownership within one executable does not establish an operating-system
privilege boundary or change publication authority.

The private source execution context now carries opaque, purpose-bound single-use
credential custody instead of raw Director secret bytes. All installed Runtime
and private interface callers change together; the former raw-secret context
is refused. This is a private API cut within the unpublished Draft, not a
change to the public request or retained Decision shape. Invalid credential
custody and invalid authority execution context use the dedicated
diagnostics in [Validation](VALIDATION.md); they do not add a public credential
field or reinterpret retained signatures.

The Draft citation registry v3 now requires `knowledgeIdentity` on every
entry, and its compact private validation facts retain the same mapping.
Knowledge entries bind an enduring identity; other entries bind null. The
compiler profile digest selects these semantics. Missing mappings and older
profile bytes are invalid, not inferred or adapted. Public Work Product
payloads, semantic templates, and runtime/interface v17 keep their existing
shapes. Exact Projection, registry, provider-input, and compiler digests reflect
the newly bound private values; no retained operation is reinterpreted.

Candidate continuity is now the reducer-selected Candidate Revision lineage and
the exact immutable Candidate Revision Carriers required by active,
recoverable, sealed, Evidence, or terminal subjects. A materialized worktree or
Cell filesystem is disposable and reconstructible; its path, inode, container
layer, or continued existence is not Candidate identity or Process continuity.

Every Agent Attempt and every executed Check uses one fresh private Execution Cell under an
exact Runtime-issued Specification, Input Set, Backend Profile, Image, and
idempotent allocation key. Dispatch authority is consumed once. Recovery may
observe, cancel, retrieve, contain, retire, or reclaim the same exact Handle but
cannot redispatch it or allocate a substitute. The first production Backend is
local Docker; its Cells receive neither the Docker socket nor a Runtime-private
target mount. `lifecycle.execution-backend-profile.fault-injection.v1` is
test-only.

Builder provider outcome, Agent Work Product validity, and Candidate successor
classification are independent. Only `promoted` selects one exact successor
whose complete Carrier was durably published first; `not-produced`,
`unavailable`, and `invalid` select no successor and leave the prior revision
current. Containment and Runtime-owned Retirement are synchronous Activity and
Closure conditions. Exact bounded Reclamation is private installation
maintenance and may complete asynchronously without creating a public workflow
or another Process.

Foundation rc.17 retains Provider Adapter v7 and
`lifecycle.local-draft-assistance.v1`, and selects provider input v8 for the
Director–Worker operating guidance and exact Director direction identities. Its
compact
immutable authoring basis and bounded local advisory command remain distinct
from independent post-Containment Runtime validation of the exact Output Carrier.
Repository contract v22 and runtime/interface v17 bind the changed current
qualification, retained resource contracts and inspection selectors. Package
1.0.0, Knowledge schema v2, Projection schema v6, and semantic body/parser/compiler
v4 do not change. No compatibility reader or mandate rebinding is implied.

The Atlas selection is mandatory and fresh-only. Missing or unsupported Atlas
coordinates fail before use; no compatible subset or alternate reader exists.
Delivery never authors Atlas. Its governing Snapshot stays immutable while
canonical state can move. Explicit integration preserves the selected parent's
Atlas bytes and requires exact Condition/readmission for changed governing
context. Acceptance conditionally applies the exact integrated Carrier over
that parent. The current contract preserves these explicit revision and
operation boundaries without a Delivery-long branch lease or lifetime-fixed
Candidate base. The external Atlas selection remains unchanged.

Within the unpublished Foundation Draft, Behavior and Assurance are separate
first-class Knowledge kinds. Behavior's sole physical root is
`records/behavior`; any other Behavior root or parent authority surface is
invalid rather than aliased, upgraded, or reinterpreted. The Orientation and
Execution Projection algorithms and profiles remain v1; the Knowledge
Projection carrier is v6 as their strict derived typed value. Director
authority subjects remain separately constructed canonical JSON and do not
become Control Markdown or SQLite file identity by proximity to the store.

## Current Coordinate Change Rule

Current selection and historical provenance answer different questions. A
Repository Contract selects the contracts under which a target may operate. A
Pack's authoring revision records where its immutable advisory bytes came
from. A retained Attempt selects what recovery must reopen. Similar-looking
version fields do not give these values interchangeable compatibility meaning.

The current rc.17 coordinates are complete and independent. Git history and
immutable Release Notes retain superseded design history; current normative
documents define only the selected contract and its fresh-only refusal
boundary.

A change increments every coordinate whose parsing, semantics, persistence,
reduction, authority, recovery, execution, eligibility, or evidence meaning
changes. Unchanged names, headings, fields, or shapes never authorize another
coordinate to interpret the current subject.

## Publication Identity and Status

A specification publication has stable identifier `lifecycle`, one version,
one immutable source revision, one publication status, complete normative
document, schema, diagnostic, and fixture inventories, exact SHA-256 file
digests, one Publication Manifest digest, and immutable Release Notes.

The Publication Manifest conforms to
[`publication-manifest.schema.json`](../schemas/publication-manifest.schema.json)
and records document maturity. Publication status is carried by a distinct
authenticated Publication Statement under
[`publication-statement.schema.json`](../schemas/publication-statement.schema.json).
The statement binds exact version, revision, immutable source revision,
Manifest digest, Release Notes digest, status, issue time, and prior statement.

Standard statuses are `draft`, `candidate`, `released`, `superseded`, and
`withdrawn`. A transition creates a new authenticated statement and never
changes publication bytes. A branch, moving tag, package label, or URL can
route to a publication but cannot identify it alone.

Released publication bytes are immutable. Even an editorial byte correction
creates a new publication. A `released` statement is invalid unless every
document in its scope is Accepted and every applicable
[Conformance](CONFORMANCE.md) gate passes.

Release Notes conform to
[`release-notes.schema.json`](../schemas/release-notes.schema.json) and bind the
exact predecessor, complete classified normative changes, compatibility and
security effects, limitations, operator actions, and hard-cut declaration.
They are content-addressed sidecars authenticated by the Publication Statement,
not members of the Manifest they describe.

## Change Classification

### Editorial change

An editorial change alters no requirement, schema, fixture outcome,
diagnostic, algorithm, digest subject, event fold, or example interpretation.
Changed released bytes still require a new immutable publication.

### Additive standard change

A change is additive only when every prior valid producer remains valid, every
prior meaning remains unchanged, and every prior consumer can safely reject or
ignore it through an existing extension rule.

An apparently optional field or row is breaking when it changes identity,
digest, relationship closure, authority, mandatory Projection membership,
capability, Evidence, reducer state, eligibility, SQL invariants, sealing,
archive, or required refusal behavior.

### Breaking change

A change is breaking when it changes parsing, canonical values, digest
subjects, semantic templates, reference resolution, provenance, authority,
mandatory context, runtime observation, record lifecycle, event order,
standing, eligibility, transaction, recovery, sealing, archive, or failure
semantics.

A breaking change receives a new affected schema, profile, registry, adapter,
protocol, repository, or qualification coordinate and declares one exact
predecessor treatment. Similar tables, fields, filenames, or prose do not make
generations compatible.

### Security correction

A security correction can require a hard cut even when a carrier shape is
unchanged. Release Notes identify unsafe behavior, affected coordinates,
required operator action, and whether predecessor material remains parseable,
validatable, inspectable, or transition-eligible.

## Schema, Store, and Logical Identity

Every standard JSON Schema has an immutable absolute `$id` naming its family
and version. Published bytes for one `$id` never change. A processor rejects an
unsupported discriminator and does not infer the closest shape.

The Control Record Store profile separately versions:

- application identifier and physical user version;
- exact tables, indexes, triggers, views, constraints, and SQL limits;
- root layout, owner, mode, file-kind, and link-count rules;
- revision, relationship, event, descriptor, seal, and archive schema;
- transaction and synchronization requirements;
- logical inventory and physical retrieval digest subjects; and
- complete open, replay, inspection, sealing, and archive verification.

Changing an operative element requires a new selected profile even when an
existing SQLite library can open the file.

A logical Control revision digest names canonical values, not the row or
database bytes that happen to carry them. An event digest likewise names its
canonical value and predecessor. A store logical-inventory digest names the
ordered logical inventory. An adjacent filename names exact file bytes. The
archive manifest's SQLite digest protects retrieval of the exact physical
database.

A successor MUST NOT treat the SQLite file hash as record or Process identity,
derive semantic identity from row order, preserve a digest while changing its
subject, or insert a self-digest into the value it identifies.

The Discipline adoption rule retains publisher-supplied revision and exact
supersession provenance without requiring every predecessor in the target. It
permits current revision adoption and later exact updates without changing the
Product Knowledge local-chain rule, record schema, digest projection, or
existing occurrence identity. This distinction belongs to the rc.12 restoration
and is not a target migration or predecessor-record interpretation route.

## Repository Selection

Repository Contract v22 selects:

- one exact supported specification publication;
- repository contract v22 and installed schema registry;
- semantic runtime, reducer, authority, and Control compatibility profiles
  without retaining a public presentation protocol as product meaning;
- Provider Adapter v7 and exact Provider Descriptor compatibility;
- exact production Execution Backend Profile, Image, Cell runner, Specification,
  Input Set, Output Manifest, Containment, Retirement, and Reclamation
  contracts;
- Control Store v2, revision v2, event v6, file v1, logical-inventory v1,
  seal v1, archive v1, Delivery reduction v5, and Control lifecycle v7;
- the closed Delivery family, relationship, and event registries;
- authoring-workspace, semantic parser, Work Product Compiler, and provider
  input profiles;
- supported Knowledge, Projection, authority, and Evidence profiles;
- validation, conformance, Candidate Carrier, execution, source, and retention
  policies; and
- explicit extensions.

Selection is exact before every authority-bearing operation. The runtime proves
that its installed publication and implementation satisfy the Repository
Contract before operating. It cannot fall back, omit an unknown profile,
attach an alternate database, adopt an export, infer Provider Descriptor bytes,
or broaden capability.

Changing provider compatibility, workspace behavior, semantic template,
parser, compiler, Backend Profile, Image, Input Set, provider-control-plane
policy, cancellation, capability, observation, or rendering identity requires a
new bound Attempt input. It cannot silently continue an Attempt frozen under
different bytes.

## Fresh-Only Hard Cut

Foundation rc.17 is fresh-project-only. Runtime and setup accept only a newly
initialized repository selecting every current coordinate. They refuse:

- any repository contract other than v22;
- any runtime or interface protocol other than v17;
- any Provider Adapter other than v7;
- any Control event, Delivery reduction, or Control lifecycle profile other
  than the exact current selection;
- a missing, unknown, test-only, or substituted production Execution Backend
  Profile, Image, or Cell runner;
- a missing Atlas or any Atlas selection other than the exact release,
  revisions, format, profiles, and schemas selected by Foundation rc.17;
- any repository-visible Control document, protected Process Git ref, Journal,
  Control tree, generated Control index, or foreign Delivery Store;
- a Markdown or JSON export presented as retained Control;
- a target containing current and unsupported Control together; and
- an active Candidate, Candidate Carrier, Cell, transaction, or recovery subject
  from another generation.

Inspection may read only the minimum fixed discriminator and reserved-path
facts needed to produce that refusal. No unsupported field, heading, row,
digest, signature, or event becomes current meaning.

Setup and runtime MUST NOT migrate, adopt, import, translate, replay, continue,
or partially initialize unsupported state. They MUST NOT launch unsupported
software or copy unsupported authority into rc.17. Failure occurs before
authority secrets, Backend allocation or dispatch, provider dispatch, or
transaction preparation.

Fresh initialization is one bounded transaction over the initializer-owned
repository and custody effects. An ordinary fault restores exact
pre-invocation state. If restoration cannot be proved, setup returns typed
initialization recovery and does not create a second target, Delivery, store,
or authority identity.

## No Foundation Migration Contract

Foundation rc.17 defines no migration path. A future release can add migration
only through a new migration-bearing cut that explicitly binds:

- one exact source snapshot and source/target coordinate set;
- stable product meaning, authority provenance, accepted bytes, exclusions,
  effects, risks, and Evidence limitations;
- information loss and every new Director decision;
- predecessor byte preservation and active-Delivery treatment;
- one recoverable transaction and its last safe rollback point; and
- exact conformance fixtures for success, refusal, interruption, and recovery.

No implementation can infer that contract from this general rule. Best-effort
row copying, Markdown import, digest preservation, SQL transformation, or
replay through current code is not a Lifecycle migration.

## Control Family Evolution

The family registry is a closed semantic protocol. Changing any family name,
dossier, semantic author, authority class, editor, edit window, revision
policy, finalization event, retention policy, payload meaning, or relationship
cardinality changes its selected registry/profile coordinate.

Adding a fifteenth Delivery family under rc.17 is not an extension. Splitting
one family into several records, folding several owners into one carrier, or
turning a derived view into a retained row is breaking even when no public
operation changes.

`candidate-revision`, `work-boundary`, and `work-delegation` are the only
successive rc.17 families.
A later runtime cannot append a revision to a single family, treat latest row as
current, or infer lineage from equal identities. Every relationship names one
exact positive target revision and logical digest; “latest,” null revision, or
cross-store resolution requires a new contract and cannot be inferred.

The normalized semantic Markdown and typed payload are joined parts of one
logical revision. A later profile cannot choose whichever side appears more
complete, use body prose to override typed facts, or preserve the old logical
digest after changing either side.

## Governed Authoring and Compiler Evolution

A semantic template and parser are a versioned language. Changing exact title,
section grammar, local handle syntax, required claims, decisions, uncertainty,
citations, effects, omission or absence rules, normalization, or limits changes
the template or parser profile.

The governed authoring profile versions the Cell-local workspace layout, file
identity, actor capability, edit window, submission, abandonment, stable read,
Containment, Runtime-owned Retirement, and asynchronous Reclamation. A new
adapter cannot treat provider terminal output as the workspace merely because
the text satisfies the parser, or preserve an old workspace as provider-session
continuity.

The normalized semantic value and Work Product Compiler are independently
versioned. Changing fixed bindings, identity assignment, reference resolution,
normalization, set ordering, fragment binding, typed payload construction, or
failure classification changes the compiler coordinate.

Canonical body rendering is also compiler meaning. Changing accepted
source-layout equivalence, canonical section or metadata order, omission rules,
anchor construction, token spelling, blank-line layout, or the distinction
between observed-submission and retained-body digests changes the parser or
compiler coordinate as applicable.

A future provider-invoked validator would version its command bytes, private
transport, correction diagnostic, exact-workspace binding, limits,
Containment, and Retirement. Foundation rc.17 selects no such route. A later
validator could not validate one profile and let Runtime finalization retain
another, and changing fixed Cell-side transport or runner support would change
the selected runner contract.

A new compiler cannot compile old bytes and label the Work Product as if the
prior Attempt selected it. An invalid Agent submission and a runtime compiler
invariant failure remain noninterchangeable across every version.

Intermediate workspace edits are not a versioned event stream or retained
record. Changing an edit does not create a semantic revision. Only exact
submission through the selected compiler can finalize one immutable Work
Product revision.

## Candidate Carrier and Execution Evolution

A Candidate Revision Carrier is immutable, content-addressed Git material
sufficient to reconstruct the exact product tree selected by a Candidate
Revision. Its manifest is a digest-bound adjacent Control file; its complete Git
object closure lives in the Carrier Store. The manifest version owns root tree,
object closure, content digests, limits, publication, reopen, availability,
materialization, and retention. Candidate identity, lineage, currentness, and
acceptance remain with Control and Delivery reduction. A physical worktree,
Cell filesystem, container layer, checkout path, or inode is reconstructible
support and cannot replace the Candidate Revision or its exact Carrier bytes.

Changing manifest construction, object-closure rules, publication ordering,
availability proof, deterministic materialization, retention roots, or
reclamation eligibility changes the Candidate Revision Carrier profile. A
successor Candidate Revision can be finalized only after its complete Carrier is
durably published. `promoted` requires one exact successor; `not-produced`,
`unavailable`, and `invalid` require no successor. An unchanged promotion may
reuse the exact predecessor Carrier without making its materialization durable
truth.

Execution Backend Profile, Specification, Input Set, Image, Cell runner,
Observation, Output Manifest, and Reclamation contracts are independently
versioned private Runtime mechanisms. A change to allocation-key identity,
idempotence, one-time dispatch, observation, cancellation, retrieval, output
collection, provider-control-plane separation, product capability, Containment,
Retirement, or exact Reclamation changes every affected coordinate.

The one-time dispatch boundary is monotonic. Once dispatch authority is durably
consumed, no newer Backend or recovery implementation may redispatch the same
Attempt or Check, allocate a substitute Cell, or treat a lost response as
`not-started`. It may only observe, cancel, retrieve, contain, retire, reclaim,
or return recovery-required refusal for the exact allocation.

Containment and Runtime-owned Retirement are synchronous completion conditions.
Retirement makes the Cell and dispatch authority permanently non-reusable and
durably hands any exact residual obligation to private Reclamation. Reclamation
may complete asynchronously, does not enter Process reduction, and cannot
become a Journal event, Control record family, Receipt workflow, public
operation, or Director authority subject. A Closure may bind only the immutable
terminal handoff or obligation-set digest and whether obligations existed at
Closure; mutable Reclamation progress remains private installation state.

Foundation selects
`lifecycle.execution-backend-profile.docker-local.v1` as its first production
Backend and `lifecycle.execution-backend-profile.fault-injection.v1` only for
deterministic test coverage. A later production Backend requires a new exact
selection and operated evidence; passing the fault-injection Backend cannot
establish production isolation or Docker conformance.

## Event and Reducer Evolution

Event kind, closed payload, actor, subject policy, ordering grammar,
predecessor rule, append protocol, idempotence, reducer input, derived standing,
state generation, eligibility, activity completion, and recovery coordinate are
versioned together by their affected profiles.

Foundation rc.17 selects `lifecycle.control-record-event.v6` and
`lifecycle.delivery-reduction.v5` with twenty-five closed event kinds.
`work-delegation-set` and `work-delegation-stopped` retain resource permission
and its settled stop. Standing Director Brief scope and an Activity's optional
exact reservation bind supplied direction and finite lifetime charges without
adding a Delivery operation. Existing Candidate outcome and recovery semantics
remain owned by their current events. Backend observations, Cell state,
Containment, Retirement, and Reclamation progress remain private inputs to
validated record finalization; they are not additional Journal event kinds or
another Process event source.

An unknown event kind is never an extension point. A successor reducer cannot
skip it, infer its effect, merge a fork, renumber a sequence, accept duplicated
record facts in its payload, or consume a provider event as a Journal event.

Derived Delivery state and Attempt Views are replaceable only when replay of
the exact selected event and revision profiles produces the same standard
meaning. They are not retained records. A cache format can change without a
Process version only when deleting and rebuilding every cache reproduces the
same output.

Closure finalization is the terminal event and completes the terminal activity.
A reducer that expects or accepts a later activity-completed event has different
Process semantics and cannot operate the rc.17 Store.

## Adjacent File, Seal, and Archive Evolution

Adjacent-file purpose, media policy, digest and filename construction, limits,
descriptor shape, reachability, disclosure, and durability are versioned. A
successor cannot discover an unknown file, infer its purpose, relabel a cache
as retained material, or adopt an undescribed carrier.

The Candidate Revision Carrier Manifest is a Control adjacent referenced file
and remains in the sealed Store inventory while its Candidate Revision is
retained. The Git object closure follows the Carrier profile in the separate
Carrier Store and is not an adjacent Control file. Private materializations,
Cell support, Handles, and Reclamation-ledger entries likewise are not adjacent
Control files and cannot acquire retained standing by appearing near a Store or
archive.

The store seal binds one exact Closure head and logical inventory. The archive
manifest separately binds physical SQLite retrieval bytes and the complete file
inventory. Changing either digest subject, cold-database rule, synchronization,
move protocol, destination identity, or post-move verification is breaking.

An archive remains one complete subject. Selective pruning, a replacement
database, or extracted Markdown cannot retain the same seal and archive
identity.

## Projection, Evidence, and Authority Evolution

Projection rules are semantic algorithms. A change to mandatory seeds,
relationship closure, authority inclusion, role partitioning, omission reasons,
or completeness changes the Projection profile. A later compiler either
reproduces the bound profile exactly or refuses it.

Check Definitions and Bindings evolve independently. Every Check Receipt binds
the exact definition, binding, environment, subject, modality, and result.
Changing a Binding later cannot strengthen an earlier Receipt.

Candidate Seal, Check Receipt, and Evidence Packet payloads and relationships
are exact-subject protocols. The rc.17 Packet's bounded artifact, coverage,
receipt-use, invalidation, independence, proposition-decision, and obligation
ledgers are the sole current Evidence structure. A later runtime cannot
reconstruct missing ledgers from prose or promote another component because its
claim looks equivalent.

The effect-free Evidence verifier separates interpretation from Delivery
assembly within the existing Evidence owner. This ownership refinement changes
no Packet shape, required evaluation provenance, public interface, Process
event, or installed topology. Retained runtime observations remain historical
inputs; the canonical owner independently observes the physical subject before
a new effect. The selected Evidence rules and validator identities still bind
the interpretation. An implementation refactor cannot silently change those
rules, reinterpret an earlier selection, or admit external proof carriers.

Authority identifiers, keys, algorithms, subject construction, lifetime, and
replay rules are versioned. Key rotation does not rewrite history. Changing an
authenticated subject is breaking, and a runtime cannot verify an old
signature over a new construction because visible values appear equal.

Director authority subjects remain canonical JSON values distinct from Control
revision Markdown and SQLite retrieval identity. Neither a Journal event nor a
Control revision authenticates itself.

## Provider Evolution

Provider model and CLI versions are Investment and adapter facts, not product
meaning. A provider can change without revising the Work Boundary only when the
selected adapter enforces the exact same capability, input, governed workspace,
observation, containment, cancellation, and isolation contract.

The current Draft selects Codex `0.153.4` with compatibility range
`>=0.153.4 <0.154.0`. This is an exact provider and Image selection change,
not a change to the Provider Adapter v7 contract, Store or event meaning, or
runtime/interface v17 request and result shapes. The Provider Descriptor
digest, executable and inventory identities, Image selection, Draft publication
digest, and exact runtime version response change together. Current packages
MUST agree on that response; an older client is not made compatible by retaining
the same protocol discriminator.

Every new Attempt binds its resolved selection. A retained Attempt MUST keep
its original exact resources through observation, retrieval, Containment, and
Retirement; a changed default cannot replace them or redispatch the Attempt.
An unavailable original selection remains unavailable until its custody is
restored. Evidence for the earlier Image does not establish operation or
conformance of the new Image. Its credential separation, restricted-read
environment, interruption, and parent-loss boundaries require their own exact
operated qualification.

The selected private Docker credential continuity mechanism retains one
execution claim, a runner-only provider-state volume, and exact settlement
before Retirement. This changes the Backend implementation/profile, installed
containment and retirement policy digests, runner executable/contract, tool
inventory, and immutable Execution Image selections. It does not change public
Adapter v7 or runtime/interface v17 shapes or reinterpret an already retained
execution. Earlier Image evidence does not qualify refreshed-credential
retention, settlement interruption, or the new private volume boundary. Those
seams require focused repository assertions and separate operated qualification
against the new exact Image.

Provider Adapter v7 requires one exact governed body-only semantic Markdown
workspace inside one fresh Cell. It supports repeated inspection and correction
of that same file, explicit submission or abandonment, and independent Runtime
collection and validation after Containment. Its local draft assistance reports
only explicit-byte and supplied-basis observations, with no live host service
or final validity claim. Provider
control-plane authentication and network access remain outside Agent product
capability; inseparable access makes the Attempt unsupported before dispatch.
No provider-authored front matter, canonical document, Control revision, SQL
value, transport envelope, or terminal-output fallback is part of the contract.

Provider session continuity is not a migration dependency. Candidate bytes,
exact Candidate Revision Carriers, Control revisions, Journal replay, and
terminal Closure preserve Lifecycle continuity. One Cell spans one Agent
Attempt, not one provider turn. A provider-native resume feature is only an
optimization within that Cell when the Runtime proves it adds no hidden
semantic or authority input.

## Read Model, Inspection, and Export Evolution

Inbox, selected Delivery View, Decision Readiness, Candidate difference, watch,
inspection, and export are bounded runtime views over exact Store, reducer,
repository, Candidate, revision, event, support-generation, seal, or archive
coordinates. They do not become primary carriers merely because a human can
edit, parse, cache, or refresh them.

Changing a presentation layout or recomputable cache does not change Process
meaning. Changing a public request, result, typed section, read generation,
staleness rule, bound, omission rule, or disclosure contract changes the
runtime or interface protocol. Turning a view into a retained row, file, event,
authority input, Evidence subject, or recovery carrier changes every affected
persistence and semantic coordinate.

Ordinary display wrapping, headings, filenames, or field order can evolve
without changing a logical revision when the export is explicitly
noncanonical and the same source coordinate remains visible. A named canonical
export profile would require its own exact renderer and digest rules; rc.17
selects no such profile.

No export is an import, backup, migration, recovery package, event source,
Knowledge record, or canonical product state. Adding any such meaning is a
breaking protocol and security change.

## Extensions and Future Processes

An extension has a globally namespaced identifier, owner, version, exact schema
and processing rules, affected objects, compatibility claim, fixtures, and
removal behavior. It cannot redefine a standard field, weaken a mandatory rule,
change standard logical digests under the same version, create authority, alter
Delivery reduction, or make acceptable a result the standard rejects.

Foundation rc.17 has a closed Delivery registry and no dynamic SQL, family,
relationship, event, trigger, or table extension seam.

A future Process can reuse the generic Control Record Store model only by
selecting a new Process kind and exact store profile, family registry,
relationship registry, event vocabulary, reducer, limits, seal subject,
archive contract, validation, and conformance evidence. It cannot share one
writable database with a Delivery or create cross-Process relationships by
default.

Deprecation is advisory until a selected range excludes the coordinate. A
notice names affected coordinate, replacement, reason, last supported release,
migration requirements when any, and authority or security consequences. A
warning cannot silently change operation.

## Conformance Across Versions

A conformance claim names one released publication, exact profiles, every
supported schema and protocol coordinate, limits, extensions, and exclusions.
Passing another publication's fixtures proves nothing about the selected one.
A candidate publication can report qualification evidence but cannot claim
released conformance.

Lifecycle Foundation 1.0.0 currently implements changing Draft material. It
makes no rc.17 conformance, publication, or production-readiness claim while
authenticated publication, complete operated scenarios, security gates, and
independent-implementation gates remain unmet.

Another generation's result, package, database, authoring profile, Backend
result, or qualification run cannot be relabeled rc.17. Fresh rc.17
qualification must exercise repository v22, runtime and interface v17,
Provider Adapter v7, the selected Docker Backend, Candidate Carrier publication
and materialization, one-time dispatch, Containment, Retirement, private
Reclamation, and every required unsupported-generation refusal.

## Evolution Review Checklist

A normative change is incomplete until review answers:

1. Which owner and dependent carriers change?
2. Which publication, repository, store, family, relationship, event, reducer,
   authoring, parser, compiler, Carrier, Backend, Specification, Input Set,
   Image, runner, adapter, protocol, seal, archive, or conformance coordinates
   change?
3. Is the change editorial, additive, breaking, or security-corrective?
4. Do exact logical values, Markdown bytes, payloads, relationships, events,
   adjacent files, or digest subjects change?
5. Does the SQLite schema, invariant set, physical layout, ownership, or
   archive protocol change?
6. Can authority, provenance, Evidence, retained history, or Product State
   receive a different meaning?
7. Can mandatory Projection content, derived standing, eligibility, activity
   completion, or recovery change?
8. What happens to open edit windows, active Attempts, Candidate Carriers,
   materializations, Cells, consumed dispatch authority, unresolved
   transactions, Retirement, Reclamation obligations, sealed stores, and
   archives?
9. Which schemas, diagnostics, fixtures, security rows, and operated scenarios
   change?
10. Is the cut migration-bearing or fresh-only, and which exact predecessor or
    mixed states must fail?
11. Can every semantic identity be recomputed without hashing SQLite physical
    bytes or trusting exports?
12. What rollback or forward-recovery path is actually defined?
13. Which historical publication and conformance claims remain exact?

A change that cannot answer these questions is not ready for publication.
