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

Lifecycle uses independent coordinates:

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
| Atlas integration selection | Exact external release, immutable specification revision, authored format, processor contract revision, resolved profile, output schemas, Lifecycle consumer profile, admitted historical-snapshot semantics, no-write rules, exclusive active branch lease, and exact sealed-Candidate acceptance over the admitted parent. |
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

## Current Foundation rc.10 Cut

The current Draft target is one coordinated fresh-only hard cut:

<!-- markdownlint-disable MD013 -->

| Family | Current target |
| --- | --- |
| Product package | `1.0.0` |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.10` |
| Repository Contract | `lifecycle.repository.v15` |
| Runtime protocol | `lifecycle.runtime.foundation.v10` |
| Interface protocol | `lifecycle.interface.foundation.v10` |
| Provider adapter | `lifecycle.provider-adapter.v6` |
| Default Provider Descriptor | `codex-exec-standard-v6`; `openai-codex-cli >=0.151.0 <0.152.0`; current production Image tool `0.151.0` |
| Production Execution Backend | `lifecycle.execution-backend-profile.docker-local.v1` |
| Execution Cell runner | `lifecycle.execution-cell-runner.v1` |
| Atlas release and format | `0.7.0`, authored format `1` |
| Atlas specification revision | `429fee62966f4d30e91ec2a15d27ecf353f5d68f` |
| Atlas processor contract revision | `746cbce73c51b28d617b96ca08f18d498ac749c4` |
| Atlas resolved and consumer profiles | `neutral.atlas-validator.resolved`, `lifecycle.atlas-consumer.v1` |
| Control Record Store | `lifecycle.control-record-store.v1` |
| Control record revision | `lifecycle.control-record-revision.v1` |
| Control event | `lifecycle.control-record-event.v2`, closed twenty-two-kind vocabulary |
| Adjacent referenced file | `lifecycle.control-record-file.v1` |
| Store logical inventory | `lifecycle.control-record-store-logical-inventory.v1` |
| Store seal | `lifecycle.control-record-store-seal.v1` |
| Archive manifest | `lifecycle.control-record-store-archive.v1` |
| Delivery reduction | `lifecycle.delivery-reduction.v2` |
| Control lifecycle | `foundation-delivery-control-lifecycle-v4` |
| Candidate Carrier and execution | `lifecycle.candidate-revision-carrier-manifest.v1`; `lifecycle.execution-backend-profile.docker-local.v1`; `lifecycle.execution-specification.v1`; `lifecycle.execution-input-set.v1`; `lifecycle.execution-image.v1`; `lifecycle.execution-observation.v1`; and `lifecycle.execution-output-manifest.v1` |
| Governed Attempt payloads | Agent Attempt v3, Execution Receipt v3, Candidate Revision v2, Candidate Seal v2, Check Receipt v2, and Closure v4 |
| Agent Work Product | `agent-work-product` family with `lifecycle.agent-work-product-body.<role>.v2`, selected v6 parse-result and fixed-binding subjects, and no provider-final-output carrier |
| Delivery record families | the twelve closed rc.10 families in [Control](CONTROL.md#closed-delivery-record-family-registry) |
| Knowledge and Projection | Knowledge record and Knowledge Set v1; Orientation and Execution Projection algorithms v1 under repository-v15 carriers |
| Runtime read models | disposable Inbox, selected Delivery View, Decision Readiness, Candidate difference, watch, and Control inspection under runtime/interface v10 |

<!-- markdownlint-enable MD013 -->

The package remains `1.0.0` because package version and Foundation
qualification are independent. The rc.10 coordinates above select one current
Foundation architecture and do not negotiate alternate target generations.

Within the unpublished rc.10 Draft, the Delivery reduction meaning explicitly
treats Standing, Candidate condition, Activity recovery, and physical Store
disposition as orthogonal. Clarifying the applied-initial-admission interval,
recoverable pre-effect `in-progress` activity, and terminal Store-recovery
overlay changes no event, enum, schema shape, record, repository, runtime,
interface, or migration coordinate. No authenticated publication or compatible
predecessor state is reinterpreted.

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

Foundation rc.10 deliberately omits provider-invoked live semantic validation.
An Agent may inspect and revise its governed draft, but only post-Containment
Runtime validation of the exact retrieved Output Carrier can establish a valid
Agent Work Product. A Cell, Role Brief, Input Set, or Provider Adapter cannot
advertise a validation command or provisional validity claim under this
coordinate.

The Atlas selection is mandatory and fresh-only. A missing Atlas or another
release, revision, format, or processor contract is unsupported. Foundation
does not inspect for a compatible subset, migrate authored records, or retain
another Atlas reader. The separately maintained target Atlas must select the
exact current contract before Lifecycle can establish a complete valid
repository basis. Delivery never authors that change. Once a Work Boundary is
admitted, its exact Atlas
snapshot remains historical context under the exclusive branch lease. Atlas
maintenance cannot land on that canonical branch until Closure and terminal
Store disposition complete; a future fresh Delivery then compiles it.
Acceptance imports the exact sealed Candidate Carrier over the admitted parent.
Changing the historical-snapshot, branch-lease, or terminal-application rule is
itself a Lifecycle hard cut even if the external Atlas selection is unchanged.

Within the unpublished Foundation Draft, Behavior and Assurance are separate
first-class Knowledge kinds. Behavior's sole physical root is
`records/behavior`; any other Behavior root or parent authority surface is
invalid rather than aliased, upgraded, or reinterpreted. The Orientation and
Execution Projection algorithms and profiles remain v1; the Knowledge
Projection carrier remains v4 as their strict derived typed value. Founder
authority subjects remain separately constructed canonical JSON and do not
become Control Markdown or SQLite file identity by proximity to the store.

## Current Coordinate Change Rule

The current rc.10 coordinates are complete and independent. Git history and
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

## Repository Selection

Repository Contract v15 selects:

- one exact supported specification publication;
- repository contract v15 and installed schema registry;
- semantic runtime, reducer, authority, and Control compatibility profiles
  without retaining a public presentation protocol as product meaning;
- Provider Adapter v6 and exact Provider Descriptor compatibility;
- exact production Execution Backend Profile, Image, Cell runner, Specification,
  Input Set, Output Manifest, Containment, Retirement, and Reclamation
  contracts;
- Control Store v1, revision v1, event v2, file v1, logical-inventory v1,
  seal v1, archive v1, Delivery reduction v2, and Control lifecycle v4;
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

Foundation rc.10 is fresh-project-only. Runtime and setup accept only a newly
initialized repository selecting every current coordinate. They refuse:

- any repository contract other than v15;
- any runtime or interface protocol other than v10;
- any Provider Adapter other than v6;
- any Control event, Delivery reduction, or Control lifecycle profile other
  than the exact current selection;
- a missing, unknown, test-only, or substituted production Execution Backend
  Profile, Image, or Cell runner;
- a missing Atlas or any Atlas selection other than the exact release,
  revisions, format, profiles, and schemas selected by Foundation rc.10;
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
software or copy unsupported authority into rc.10. Failure occurs before
authority secrets, Backend allocation or dispatch, provider dispatch, or
transaction preparation.

Fresh initialization is one bounded transaction over the initializer-owned
repository and custody effects. An ordinary fault restores exact
pre-invocation state. If restoration cannot be proved, setup returns typed
initialization recovery and does not create a second target, Delivery, store,
or authority identity.

## No Foundation Migration Contract

Foundation rc.10 defines no migration path. A future release can add migration
only through a new migration-bearing cut that explicitly binds:

- one exact source snapshot and source/target coordinate set;
- stable product meaning, authority provenance, accepted bytes, exclusions,
  effects, risks, and Evidence limitations;
- information loss and every new Founder decision;
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

Adding a thirteenth Delivery family under rc.10 is not an extension. Splitting
one family into several records, folding several owners into one carrier, or
turning a derived view into a retained row is breaking even when no public
operation changes.

`candidate-revision` and `work-boundary` are the only successive rc.10 families.
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
Containment, and Retirement. Foundation rc.10 selects no such route. A later
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
operation, or Founder authority subject. A Closure may bind only the immutable
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

Foundation rc.10 selects `lifecycle.control-record-event.v2` and
`lifecycle.delivery-reduction.v2` while preserving the same closed twenty-two
event kinds. The version change permits `candidate-revision-observed` to
finalize a builder outcome with no Candidate successor and updates current
Candidate and recovery derivation. Backend observations, Cell state,
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
Process semantics and cannot operate the rc.10 Store.

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
are exact-subject protocols. The rc.10 Packet's bounded artifact, coverage,
receipt-use, invalidation, independence, proposition-decision, and obligation
ledgers are the sole current Evidence structure. A later runtime cannot
reconstruct missing ledgers from prose or promote another component because its
claim looks equivalent.

Authority identifiers, keys, algorithms, subject construction, lifetime, and
replay rules are versioned. Key rotation does not rewrite history. Changing an
authenticated subject is breaking, and a runtime cannot verify an old
signature over a new construction because visible values appear equal.

Founder authority subjects remain canonical JSON values distinct from Control
revision Markdown and SQLite retrieval identity. Neither a Journal event nor a
Control revision authenticates itself.

## Provider Evolution

Provider model and CLI versions are Investment and adapter facts, not product
meaning. A provider can change without revising the Work Boundary only when the
selected adapter enforces the exact same capability, input, governed workspace,
observation, containment, cancellation, and isolation contract.

Provider Adapter v6 requires one exact governed body-only semantic Markdown
workspace inside one fresh Cell. It supports repeated inspection and correction
of that same file, explicit submission or abandonment, and independent Runtime
collection and validation after Containment. It exposes no provider-invoked
live semantic validator or Cell validity claim. Provider
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
export profile would require its own exact renderer and digest rules; rc.10
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

Foundation rc.10 has a closed Delivery registry and no dynamic SQL, family,
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
makes no rc.10 conformance, publication, or production-readiness claim while
authenticated publication, complete operated scenarios, security gates, and
independent-implementation gates remain unmet.

Another generation's result, package, database, authoring profile, Backend
result, or qualification run cannot be relabeled rc.10. Fresh rc.10
qualification must exercise repository v15, runtime and interface v10,
Provider Adapter v6, the selected Docker Backend, Candidate Carrier publication
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
