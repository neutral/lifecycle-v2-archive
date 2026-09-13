# Lifecycle Control Record Store

> Status: Draft

## Purpose

This document defines the Lifecycle Foundation rc.17 Delivery Control Record
Store, the common lifecycle of every Delivery Control record, the closed
Delivery record-family registry, the append-only event source, and the exact
seal and archive boundary.

Delivery Control preserves what the Director supplied or authenticated, what an
assigned agent proposed, what the runtime observed or derived, and which exact
revision caused each Process milestone. Control is not Product Knowledge, the
Candidate, canonical product state, provider conversation, or a mutable Process
state object.

The Foundation rc.17 rule is:

```text
one Delivery
  -> one runtime-owned Control Record Store
  -> immutable logical record revisions plus one event chain
  -> one sufficient Closure
  -> one sealed complete store archive
```

The SQLite database is the primary retained carrier. Semantic Markdown and its
typed payload are columns of one immutable logical record revision. The runtime
MUST NOT duplicate either value into an adjacent Markdown record, reconstruct a
revision from exported prose, or promote Delivery Control onto repository HEAD.

[Delivery](DELIVERY.md) owns Process meaning, the sole legal event reduction,
operation eligibility, transactions, and recovery semantics. This document
also owns the common Activity-kernel mechanics that durably execute those
semantics. [Authority](AUTHORITY.md) owns authenticated
Director decisions. [Agent Attempts](ATTEMPTS.md) owns provider execution and
agent work-product submission. [Evidence](EVIDENCE.md) owns Checks, sealing,
review, and Evidence meaning. [Processing](PROCESSING.md) owns canonical JSON,
digests, identifiers, ordering, and general processing security. This document
owns the common Delivery Control carrier and record lifecycle across those
domains.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Foundation rc.17 Hard Cut

The current Control Store cut is selected only by these coordinated fresh
Foundation values:

<!-- markdownlint-disable MD013 -->

| Coordinate | Selected value |
| --- | --- |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.17` |
| Repository contract | `lifecycle.repository.v22` |
| Runtime protocol | `lifecycle.runtime.foundation.v17` |
| Interface protocol | `lifecycle.interface.foundation.v17` |
| Provider adapter | `lifecycle.provider-adapter.v7` |
| Store | `lifecycle.control-record-store.v2` |
| Physical SQLite version | `user_version = 3` |
| Record revision | `lifecycle.control-record-revision.v2` |
| Control lifecycle profile | `foundation-delivery-control-lifecycle-v7` |
| Event | `lifecycle.control-record-event.v6` |
| Delivery reduction | `lifecycle.delivery-reduction.v5` |
| Referenced file | `lifecycle.control-record-file.v1` |
| Candidate Revision Carrier manifest | `lifecycle.candidate-revision-carrier-manifest.v1` |
| Operation support | `lifecycle.control-record-operation-support.v1` |
| Store seal | `lifecycle.control-record-store-seal.v1` |
| Archive manifest | `lifecycle.control-record-store-archive.v1` |

<!-- markdownlint-enable MD013 -->

The product package remains `1.0.0`. These coordinates are independent; no
package label substitutes for an exact repository, runtime, interface,
provider, store, record, event, seal, or archive selection.

The fourteen selected payload schemas are:

<!-- markdownlint-disable MD013 -->

| Family | Payload schema |
| --- | --- |
| `director-brief` | `urn:lifecycle:schema:director-brief-payload:v2` |
| `work-delegation` | `urn:lifecycle:schema:work-delegation-payload:v2` |
| `agent-attempt` | `urn:lifecycle:schema:agent-attempt-payload:v3` |
| `agent-work-product` | `urn:lifecycle:schema:agent-work-product-payload:v5` |
| `execution-receipt` | `urn:lifecycle:schema:execution-receipt-payload:v3` |
| `candidate-revision` | `urn:lifecycle:schema:candidate-revision-payload:v3` |
| `integration-assessment` | `urn:lifecycle:schema:integration-assessment-payload:v1` |
| `work-boundary` | `urn:lifecycle:schema:work-boundary-payload:v6` |
| `material-condition` | `urn:lifecycle:schema:material-condition-payload:v4` |
| `director-decision` | `urn:lifecycle:schema:director-decision-payload:v5` |
| `candidate-seal` | `urn:lifecycle:schema:candidate-seal-payload:v2` |
| `check-receipt` | `urn:lifecycle:schema:check-receipt-payload:v3` |
| `evidence-packet` | `urn:lifecycle:schema:evidence-packet-payload:v2` |
| `closure` | `urn:lifecycle:schema:closure-payload:v6` |

<!-- markdownlint-enable MD013 -->

Foundation rc.17 does not read, migrate, adopt, import, promote, or continue an
unsupported Delivery Store, document, Process Git ref, tracked Control tree,
Journal, repository contract, runtime or interface protocol, or Provider
Adapter. A fresh v22 target containing recognized unsupported or mixed
Delivery Control MUST be refused. Shape similarity, an export, and a matching
digest string do not create compatibility.

No Work Boundary, Evidence component, terminal observation, Closure, index, or
other Delivery Control object is committed or promoted onto HEAD. Acceptance
moves only the exact authorized Candidate product result and governed product
meaning defined by Delivery. The complete Delivery Control history remains in
its off-HEAD store and sealed off-HEAD archive.

## Control Boundaries

### Control, Knowledge, and Candidate

Lifecycle keeps these physical and semantic subjects distinct:

- **Product Knowledge** is repository-authored durable product meaning on HEAD
  under the Knowledge contracts.
- **Candidate** is the sole reversible, noncanonical product-state object and
  advances only through reducer-selected immutable Candidate Revisions under
  an admitted Work Boundary.
- **Candidate Revision Carrier** is the immutable content-addressed Git object
  closure sufficient to reconstruct one exact Candidate Revision. Its
  canonical manifest is a digest-bound adjacent Control file, while the Git
  objects remain in the installation Carrier Store outside SQLite and outside
  the Delivery archive root.
- **Delivery Control** is one Delivery's governed decisions, proposals,
  observations, proof bindings, milestones, and Closure in its Control Record
  Store.

Putting Control in a Git worktree, under a tracked path, beside Knowledge, or
inside a Candidate materialization does not grant it Product or Knowledge
authority. Putting product bytes, a Carrier object closure, Knowledge, or
ordinary development files in the Control Store does not make them a Candidate
or canonical product state. A Carrier manifest retained as an adjacent file is
bounded Control evidence about exact external Git bytes; it does not move those
bytes into Control or make a Carrier another record family.

The Repository Contract and Product State compiler MUST exclude the active and
archived Control Store roots. Candidate observation and sealing MUST likewise
exclude them. A transaction MUST fail before canonical motion when the exact
Candidate would add, alter, remove, or depend on Control Store bytes.

### Runtime producer and semantic owner

The runtime is the physical producer of every retained Control record
revision. It assigns the record kind and identity, writes typed payload and
relationships, normalizes the semantic Markdown, calculates the logical
digest, validates the family policy, and appends the revision and its
finalization event atomically.

Physical production does not transfer semantic authorship or authority:

- `director-supplied` means the Director supplied the retained semantics without
  authenticating a Process effect;
- `agent-proposed` means the assigned agent proposed the retained semantics
  inside one exact Agent Attempt;
- `director-authenticated` means the Director authenticated the exact typed
  decision subject and semantic revision;
- `runtime-observed` means the runtime directly established the operative
  fact through its owned observer or qualified adapter; and
- `runtime-derived` means the runtime deterministically compiled the value
  from exact retained inputs and the selected rule set.

Director provenance identifies the capacity in which the input or decision was
supplied, whether its principal represents a human or an agent. The `agent`
actor kind and `agent-proposed` class identify semantic work from an assigned
Agent Attempt. A software Director supplies its Director Brief through the
Director input contract; its Worker output cannot relabel itself as Director
input or authentication. The [operating roles](AUTHORITY.md#operating-roles)
remain separate from physical actor identity.

Every revision records both a `producer` actor and a `semanticAuthor` actor.
They MUST satisfy the closed family registry. Runtime normalization,
validation, identity assignment, or retention MUST NOT relabel Director or agent
semantics as runtime-observed or runtime-derived. A record-level authority
class likewise MUST NOT promote an agent proposal into Director authority or
turn a runtime observation into product acceptance.

### Access is not standing

`private` is not a record standing, authority class, retention class, or
Process state. The store instead applies explicit custody and access rules.
The Director, an assigned agent, an interface, and the runtime can have different
read or edit capabilities over the same governed Delivery without changing the
record's meaning.

Credentials, authority secret bytes, Execution Handles, allocation keys,
backend coordinates, Reclamation coordinates, locks, and executable
capabilities are access-restricted support, not semantic Control fields. Their
sanitized existence, bounded identity, use, and disposition MAY be recorded
without retaining a secret or private coordinate in a revision, event,
logical inventory, export, or public Process view.

## One Store Per Delivery

One active Delivery has exactly one Control Record Store identity containing:

- schema, store, target, Process kind, and Process identities;
- creation time;
- logical Control records and every retained revision;
- typed relationships from each revision;
- one append-only Process event chain;
- descriptors for every retained adjacent file;
- bounded mutable operation support for live activities; and
- at most one terminal store seal.

The Process kind is exactly `delivery`. Store and Process identities are
immutable and unique within one runtime custody domain. Opening a store with a
different expected target, Process, or creation identity MUST fail. One
Delivery MUST NOT span several writable databases, and one database MUST NOT
contain several Deliveries.

The active Foundation physical profile contains exactly:

```text
<runtime-selected-active-root>/
  control-record-store.sqlite
  files/
  drafts/
```

The runtime-selected root, `files/`, and `drafts/` MUST be physical directories
owned by the effective runtime user and use mode `0700`. The database and each
retained file MUST be one non-symbolic regular file with one link, owned by the
effective runtime user, and use mode `0600`. `drafts/` contains only governed
working values while their exact edit windows remain open and deterministic
pending-file temporary carriers while their exact custody batch remains open.
It MUST be empty before store sealing. A symlink, hard link, special file,
foreign owner, permissive mode, missing required entry, or unsupported adjacent
entry is invalid. No physical root is a public identity or may appear in an
agent prompt, retained semantic body, authority subject, or repository-visible
Control path.

## SQLite Is the Primary Carrier

Foundation uses one SQLite database with application identifier `0x4c435253`
and physical user version `2`. It contains these relations:

- immutable store metadata;
- logical record identities and kinds;
- immutable record revisions;
- immutable typed relationships;
- immutable Journal events;
- immutable referenced-file descriptors;
- one transient pending-file custody batch with its exact file entries;
- bounded mutable operation-support rows keyed by activity identity;
- one transient exact Work Delegation stop request; and
- one immutable optional store seal.

The database MUST use strict typing, foreign-key enforcement, defensive mode,
disabled extension loading, bounded SQL and value limits, and a durable
rollback-journal transaction profile. Secure deletion MUST be enabled for
every connection so replaced or disposed operation-support payload bytes do
not remain in reusable SQLite pages. Store metadata, records, revisions,
relationships, events, retained file descriptors, and seal rows MUST reject
update and delete. Pending-file custody rows are runtime-owned operational
support: they reject update, may be inserted only before sealing, and may be
deleted only by exact completion or deterministic rollback. A new descriptor
may be deleted only while the same pending batch proves that it was not
preexisting and its semantic append is wholly absent. Revision and event
insertion MUST enforce exact contiguous order.

An `lifecycle.control-record-operation-support.v1` row is the sole mutable
checkpoint for one exact live activity inside this Delivery Store. It binds
the exact store, Process, activity, support kind, positive generation,
canonical typed-payload bytes, and payload digest. Creation is compare-and-swap
against absence at generation `1`; replacement requires the exact current
generation and digest and advances exactly one generation. Deletion requires
the exact current generation and digest and replaces the live value with a
payload-free disposal tombstone. The tombstone retains only the immutable
bindings, the disposed generation and payload digest, and the exactly advanced
generation needed to prove an exact delete retry after restart. It is not live
operation support and cannot be reopened or replaced.

The support kind and all store, Process, and activity bindings are immutable.
At most 256 live rows may exist, and the total of live rows and disposal
tombstones cannot exceed the Journal-event bound. Operation support and its
disposal tombstones are runtime-writable. A bounded Director read may expose
only a sanitized activity identity, generation digest, and recovery standing.
Agents, provider adapters, Directors, and interfaces including the TUI cannot
read a private Execution Handle, allocation key, backend coordinate,
credential, or Reclamation handoff from support and cannot mutate support.
Operation support is not a Control record, Journal event, semantic authority
source, logical inventory member, export member, or alternate event source.

Execution-bearing support MAY retain the exact private Handle, deterministic
allocation key, consumed-dispatch fact, and pending Reclamation handoff needed
to recover one Cell. Before Activity completion disposes that support, the
runtime MUST establish Execution Containment, make the immutable Runtime-owned
Retirement decision, and durably transfer any remaining Reclamation obligation
to the installation-private Reclamation owner. That owner is outside the Store
and cannot append an event, change a Receipt or Closure, revive dispatch
authority, or block Store sealing merely because physical Reclamation remains
incomplete.

When one Process boundary changes operation support and appends Journal facts,
the runtime MUST resolve the ordered support mutation set and exact append
batch inside one immediate SQLite transaction. One batch may mutate each
activity support coordinate at most once. A new boundary commits both
postconditions or neither. An exact retry succeeds only when the complete
append batch and every exact support postcondition are already retained. A
retained postcondition on only one side, a different generation or digest, or
an ambiguous partial append fails closed. Creation with activity opening,
effect intent with support replacement, effect observation with support
replacement, and support disposal with activity completion use this atomic
boundary. Standalone support compare-and-swap and append primitives are
lower-level Store operations; a Process owner MUST NOT sequence them as two
commits for one boundary.

No live operation support may remain when sealing starts. In the same
transaction that creates the immutable seal, the runtime removes all verified
payload-free disposal tombstones. A sealed Store therefore contains no
operation-support rows. Insertion, replacement, or disposal after sealing is
forbidden.

SQLite page layout, row identifiers, free pages, query plans, and complete
database bytes are not the logical Control identity. Logical identity is
defined by the canonical values and digests in this document. Once archived,
the archive manifest separately binds the exact retrieval bytes of the SQLite
file.

### Work Delegation stop custody

The Store retains at most one `lifecycle.work-delegation-stop-request.v1`
request while its current delegation is stopping. This operational value has
exactly `schema`, `storeId`, `processId`, `delegation`, `requestedBy`,
`requestedAt`, and `digest`. `delegation` is the complete Work Delegation
reference; `requestedBy` is its supplying Director identity; `requestedAt` is
the Runtime-observed canonical UTC request time. The digest is SHA-256 of the
canonical JSON object with `digest` omitted. The entire retained request uses
the existing 65,536-byte Control event JSON bound. No secret, Handle, support
payload or next-operation cursor belongs in it.

A stop request uses its own short immediate SQLite transaction and does not
take the Delivery operation lock or append a Journal event. Inside that
transaction the Store replays fresh Journal facts, verifies the current exact
delegation and its supplying Director, and inserts the request against absence.
Pending file custody does not prevent recording the request. A repeated request
for that same delegation returns the first retained request; it cannot replace
its identity, time or digest. A changed delegation or Director refuses. A
terminal Activity already in progress uses its existing decision and recovery
route and cannot acquire a pending resource stop.

Every fresh `activity-started` append checks pending stop custody in the same
transaction that retains the opening, reservation and operation support. An
existing request prevents that opening, delegation replacement, and Closure.
It does not interrupt the already opened finite operation, its remaining
reserved Cells, or its exact recovery. An opening that committed first remains
reserved; a stop that committed first prevents the opening. No concurrent
Journal writer is introduced and the operation owner's cached replay is not
replaced by the stop caller.

After the existing Activity and pending file custody settle, the sole Journal
writer appends `work-delegation-stopped` over the exact delegation. Its payload
has exactly `requestDigest`, `requestedAt`, and `requestedBy`, reproducing the
retained request. The request time cannot follow the event time. The same
transaction appends this fact and deletes the operational request; either
both commit or neither does. Exact replay returns the retained event without
another stop or charge. The event's request digest also permits observation
after a lost successful return. The historical stopped fact does not
invalidate an already reserved operation or refund its charge.

Stop custody is immutable until that exact consumption. It is neither a
Control family nor part of the logical inventory. Integrity checks require its
exact current unstopped delegation, Director, digest and supported phase. No
pending stop may survive sealing. The public read distinguishes a pending
request from the reducer-derived settled stop; closing a browser does not
establish either condition.

### Runtime-owned SQL

Only the selected Lifecycle runtime may execute SQL against the database.
Directors, agents, provider adapters, Checks, interfaces, scripts, plugins, and
external tools MUST use a runtime protocol operation for inspection, authoring,
submission, validation, or export. Possession of filesystem access does not
grant SQL authority.

An implementation MUST NOT expose an arbitrary SQL endpoint, accept a caller
query as Process input, load a SQLite extension, attach another database, use a
trigger or view supplied by repository content, or treat an external database
writer as conforming. Direct SQL modification is corruption, even when the
resulting rows appear schema-shaped.

The `current_record_revisions` database view is an implementation convenience
over maximum retained revision numbers. It does not establish Process
currentness, standing, authority, or eligibility. Those properties come only
from the validated event fold and exact referenced revisions.

## Common Activity Kernel

The Delivery reducer is the sole legal Process state machine. Every public
Delivery mutation is composed through the owner of its selected operation.
Each new activity is executed through one common Activity kernel, and
`delivery.recover` routes the reducer-selected outstanding obligation back to
that same operation owner. A dispatcher, operation owner, physical adapter,
support payload, or interface MUST NOT derive or retain a competing legal
workflow coordinate.

An operation definition owns the meaning specific to one route:

- its declared eligibility requirements and exact Process inputs;
- construction and strict validation of one immutable semantic activity plan;
- the physical effects to perform and the direct observations that establish
  their outcomes; and
- compilation of the operation-specific Control revisions and events.

Ownership of the physical effect plan means declaring and requesting the exact
effect through its existing implementation owner. It does not grant the
operation definition a general Engine driver, Director signer, or canonical Git
writer. The [capability ownership contract](SECURITY.md#consequential-capability-ownership)
preserves those boundaries while the Store retains sole SQL ownership.

The reducer alone determines whether those eligibility requirements are
satisfied at the exact Journal head. An operation definition cannot make
itself eligible, replace the reducer-selected subjects, or treat its plan as a
Process-state snapshot.

The common Activity kernel owns only durable execution mechanics:

- atomically opening the activity and its operation support;
- retaining the exact operation-definition identity and immutable plan;
- comparing and replacing checkpoints under exact support generation and
  digest;
- validating each append against the current reducer-derived activity and
  registered recovery coordinate;
- atomically coordinating checkpoint changes with their exact revision and
  Journal facts;
- bounding recovery passes and accepting only durable progress or exact
  settlement; and
- atomically completing the activity and disposing its live support, including
  terminal completion through `closure-recorded`.

The kernel does not decide product meaning, manufacture an effect observation,
or compile an operation-specific semantic fact. Recovery cannot replace or
resample the retained semantic activity plan. It records only the exact
reducer-derived recovery fact, invokes the owning definition at that boundary,
and refuses no progress, subject substitution, or settlement that leaves the
activity recoverable.

When an operation needs physical execution, its owner compiles one immutable
Execution Specification and the selected subordinate Backend operates one
private Cell. Allocation, dispatch, observation, cancellation, retrieval,
Retirement, and Reclamation are not Delivery operations, reducer states,
Control families, or Journal event kinds. `delivery.recover` reopens the exact
operation support and reconciles the same Cell without accepting a caller
Handle or redispatching consumed authority. Only the owning Attempt or Check
Receipt may retain the stable sanitized execution facts established from that
mechanism.

Acceptance's immutable semantic Activity plan binds the exact sealed integrated
Candidate and its application parent. Its one effect plan authorizes one
conditional application. Conclusive parent movement finishes that effect as
`not-applied`; a fresh integration and Decision are separate eligible work.
Recovery can recognize the exact accepted commit after later forward movement,
but MUST NOT select another parent, substitute a plan, or infer non-application
from unavailable or rewritten history.

Operation support MAY retain bounded effect-specific checkpoint, private
execution coordinate, and physical observation facts needed for exact
continuation. It MUST NOT retain another workflow graph, authoritative
`stage`, eligible-operation set, or transition cursor. There is no duplicate
persisted workflow-stage DSL. Any Backend- or adapter-local phase is
reconstructed from reducer state and direct physical observation, is not a
Control fact, and cannot authorize a Journal append.

A checkpoint is current-continuation support, not immutable observation
history. The closed operation-typed `facts` that justify each transaction
observation and their runtime-derived `factsDigest` belong to that exact
`transaction-effect-observed` event. Replacing or disposing operation support
MUST NOT remove the preimage needed to validate an earlier event's shape,
operation/outcome compatibility, or digest.

For applied acceptance, the checkpoint retains the exact observed integration
parent commit and tree, accepted commit and tree, Candidate Product State and
Knowledge Set, and exact selected integration provenance. Finalization MUST
validate the immutable applied-observation contract and require its
`canonicalResultDigest` to equal the digest of that checkpoint result before
compiling Closure. A missing, malformed, or substituted observation cannot
establish accepted Closure.

`closure-recorded` completes the terminal Activity and is the final Journal
event. Any remaining Store seal or archive recovery is a physical
Store-disposition branch outside the common Activity kernel and operation
definition. It derives only the exact missing disposition from Closure and
Store integrity and MUST NOT append another event or change standing,
Candidate condition, current subjects, Activities, Closure, or Journal head.

## Common Record Lifecycle

### Logical record and working value

A logical Control record has one immutable Process identity, record identity,
and record kind. The family registry decides whether that logical record has
one revision or a contiguous succession of revisions.

An editable working value is governed runtime working state, not a retained
record revision. The runtime supplies the family template, typed context, exact
editor capability, and edit deadline. The authorized actor edits only the
semantic input surface allowed by the family. Working changes, keystrokes,
patches, commands, model reasoning, and incomplete text MUST NOT become Journal
events or operative Process facts.

The three standard edit windows are:

- `before-activity` — Director editing ends before the funded activity starts;
- `provider-active` — only the assigned agent can edit while its exact
  provider activity remains active; and
- `before-authentication` — Director editing ends before the exact decision is
  authenticated.

`none` means no actor can edit semantic input for that family. The runtime
compiles the complete semantic body and typed payload from authenticated or
observed inputs.

An editor capability is exact to target, Delivery, family, logical record,
working revision, actor, and window. It cannot be transferred, widened, or
used after the owning activity or authentication boundary. A provider session,
repository write capability, TUI text buffer, or model claim does not create an
edit capability.

### Governed working values and authoring workspace

A Director-edited working value MAY use the Store's bounded `drafts/` support
while its exact edit window remains open. It is not a retained revision and
MUST be submitted or abandoned before sealing. Its physical path and continued
existence do not create Process standing.

An Agent Work Product uses one governed authoring workspace inside the exact
Attempt Cell. The Runtime compiles the template and binding into the Execution
Input Set; the fixed cell-side runner materializes one bounded `semantic.md`
working value. The assigned Agent can revise that value across provider turns
inside the one funded Attempt. Local draft assistance may inspect explicit
bytes against the immutable authoring basis, without creating Control truth.
Intermediate writes and local observations do not submit a Work
Product, append a revision or event, or become Candidate state.

Submission closes the editor capability over one exact output claim, but the
Cell path and runner claim are not Control facts. After Execution Containment,
the Runtime retrieves the complete Execution Output Carrier, independently
validates its Output Manifest and exact semantic bytes, decodes strict UTF-8,
normalizes and parses the value, and records bounded raw, semantic, and compiler
digests in the Execution Receipt. It then renders canonical semantic Markdown
from the normalized typed value before compiling a retained Agent Work Product.
The submitted semantic digest need not equal the canonical retained body
digest.

Recovery reconciles only the exact retained Attempt, Execution Specification,
and private Handle while that Activity remains current. It MUST NOT select a
similarly named workspace, another Cell, or replacement output. Missing,
partial, substituted, linked, oversized, changing, extra-entry, or otherwise
invalid output creates no Work Product. Activity completion requires
Containment and Runtime-owned Retirement, not synchronous deletion of the Cell
workspace. Any later physical Reclamation proceeds only from the private
installation handoff and cannot change the retained Control result.

### Submission

Submission closes the edit window and presents one complete semantic value to
the runtime. Submission itself creates no retained revision until the runtime:

1. proves the actor and edit window;
2. normalizes and bounds semantic Markdown;
3. compiles and validates the complete typed payload;
4. resolves and validates every relationship and cardinality;
5. proves the family, producer, semantic author, and authority policy;
6. assigns the exact revision number and logical digest; and
7. commits the revision and its owning finalization event in one SQLite
   transaction.

A validation failure, expired edit window, provider interruption, cancellation,
or missing submission leaves no finalized record revision and no finalization
event. The runtime MAY retain a bounded support-resource digest for diagnosis,
but MUST NOT reinterpret an incomplete working value as a submitted Work
Product or Director decision.

### Finalization and immutable revision

Finalization is the successful atomic append of one exact revision and its
registry-owned event. The event subject binds the same record identity,
revision number, and logical digest. A revision without its finalization event,
or a finalization event naming unavailable or different revision bytes, is
invalid.

Revision `1` is the first legal revision. A `single` family permits only
revision `1`. A `successive` family permits revision `n + 1` only after exact
revision `n`; it cannot skip, overwrite, renumber, or change kind. The prior
revision remains immutable and addressable. A successor does not make the
predecessor false or delete it.

`candidate-revision`, `work-boundary`, and `work-delegation` are the only
successive Foundation rc.17 families. Every other standard family is
single-revision. A fresh
reconnaissance Brief, Agent Attempt, Work Product, Receipt, decision, Seal,
Check Receipt, Packet, Condition, or Closure therefore receives a new logical
record identity rather than mutating an earlier record.

### Standing and currentness

The record row contains no mutable status. Proposed, active, superseded,
unresolved, sealed, selected, acceptance-ready, accepted, abandoned, and closed
are reducer-derived standing over exact revisions and events. The latest
physical revision is not necessarily the current Process subject.

In particular:

- a Work Boundary becomes active only through the
  `transaction-effect-observed(applied)` event for its exact
  Director-authenticated admission or readmission effect;
- after an applied initial-admission effect, that Boundary is current before
  the required initialization Candidate observation; the distinct Candidate
  condition remains `absent` and exact recovery is the only eligible operation;
- the current Candidate is the exact valid reconstructible Candidate Revision
  selected by the latest applicable `candidate-revision-observed` event;
- a Material Condition remains current until exact readmission or Closure
  resolves it;
- a Candidate Seal and Evidence Packet remain usable only while their exact
  Candidate and Work Boundary join remains current;
- a Director Decision authenticates one subject but does not claim that its
  transaction completed; and
- every unresolved Activity head is recoverable, while Candidate condition
  distinguishes a `started` or `prepared` pre-effect Activity from one that has
  advanced to Candidate sealing, effect, observation, subject retention, or
  post-effect finalization; and
- Closure is terminal Process truth only when its exact finalization event is
  the Journal head; Store sealing and archive remain exact post-Closure
  physical disposition without another Process event or a change to the
  terminal Candidate condition.

No `complete`, `current`, `active`, `eligible`, or `accepted` field can override
the event fold.

## Record Revision Contract

One `lifecycle.control-record-revision.v2` logical value contains exactly:

- schema and Process identity;
- record identity, kind, and positive revision;
- producer actor;
- semantic-author actor;
- semantic-authority class;
- canonical creation time;
- normalized semantic Markdown;
- one bounded typed JSON payload;
- an ordered unique relationship set; and
- one external logical digest.

The digest is not stored inside its digest subject. A logical revision digest
is the SHA-256 digest of canonical JSON over every preceding field, including
the normalized Markdown, complete payload, and ordered relationships. It does
not hash SQLite page bytes, SQL text, an exported Markdown rendering, or an
adjacent file path.

### Semantic Markdown

Semantic Markdown is the readable meaning retained for the record. It is not a
second copy of the typed payload and cannot override it. Operational identities,
bindings, enums, times, digests, relationships, state, and eligibility belong
to the typed revision value. Markdown owns the human-readable objective,
summary, rationale, uncertainty, explanation, or disposition appropriate to
the family.

Before digesting or retaining Markdown, the runtime MUST:

- decode valid UTF-8;
- reject a BOM, NUL, an isolated carriage return, empty content, and content
  beyond 1 MiB;
- normalize CRLF to LF;
- remove every terminal LF and append exactly one LF; and
- preserve all other authored content exactly, except where the selected Agent
  Work Product v4 profile explicitly requires deterministic rendering from the
  parsed typed value.

Provider terminal-message framing is not the semantic return contract and
cannot decide whether a Work Product is valid. The assigned agent edits and
submits its governed working value during the provider-active window. The
runtime owns normalization, selected canonical body rendering, and retained
record construction.

### Typed payload

The payload is one canonical-JSON object under the owning record-family
profile. It contains the operational fields the runtime must validate, reduce,
authenticate, or inspect. It MUST NOT repeat the Markdown merely to produce a
second prose authority surface.

The runtime, not a Director or agent, supplies identities, fixed bindings,
ordering, derived values, compiler facts, envelopes, and digests. Director or
agent semantic input is compiled into the payload only under the family's
declared provenance. Unknown properties, invalid types, unsupported values,
duplicate keys, noncanonical numbers, or an unbounded value fail before
retention.

### Relationships

Each relationship has one lowercase-hyphenated relation kind and one target
containing target kind, identity, positive revision, and logical digest.
Relationships are ordered by relation, target kind, identity, revision, and
digest and MUST be unique.

Every rc.17 relationship names an exact target revision and matching logical
digest. A lineage-only, latest, or null-revision relationship is invalid.

Every standard relationship MUST satisfy the closed family registry below. A
wrong target kind, unsupported relation, missing required edge, excess edge,
cross-Delivery target, unavailable target revision, or digest mismatch fails
before finalization. The relationship table owns one direction. A runtime view
MAY derive inverse navigation but MUST NOT retain a reciprocal edge merely to
repeat the same fact.

## Event Source

The `journal_events` relation is the sole retained Delivery event source. An
event is not a separate Control record family. It is one
`lifecycle.control-record-event.v6` value containing:

- store and Process identities;
- positive contiguous sequence;
- unique event identity and event kind;
- canonical occurrence time;
- actor;
- nullable exact record-revision subject;
- one bounded typed payload;
- nullable exact predecessor-event digest; and
- logical event digest.

Only sequence `1` has a null predecessor. Every later event binds the exact
immediately preceding event digest. Event time cannot move backwards. The event
digest covers every field except itself under canonical JSON. A missing event,
gap, fork, duplicate sequence, changed predecessor, changed subject, or logical
digest mismatch is corruption; a reducer MUST fail rather than choose a branch.

An event can atomically finalize a newly inserted revision, refer to an already
retained exact revision, or have no record subject when it records a bounded
runtime milestone. Each event kind has one closed payload containing only its
event-owned occurrence, Process consequence, and continuation fields. It MUST
NOT duplicate any record-owned decision, readiness, outcome, relationship,
subject binding, or other fact. The referenced record owns that fact; the event
owns why and when it affected Process reduction.

The Journal retains lifecycle-significant operation, provider-boundary,
Candidate, submission, Receipt, boundary, authority, Evidence, transaction,
recovery, and Closure milestones. It MUST NOT become a transcript of ordinary
edits, commands, tests, provider events, model messages, Backend calls,
Retirement, Reclamation, or reasoning.

### Closed event vocabulary

The selected fresh cut has exactly these twenty-five event kinds, in the lifecycle
profile's fixed order:

```text
delivery-created
director-brief-submitted
work-delegation-set
work-delegation-stopped
activity-started
activity-recovery-recorded
agent-pre-intent-refused
agent-attempt-prepared
provider-effect-intended
provider-effect-observed
agent-work-product-submitted
agent-work-product-abandoned
integration-assessed
candidate-revision-observed
execution-receipt-recorded
work-boundary-finalized
material-condition-frozen
candidate-sealed
check-receipt-recorded
evidence-packet-finalized
director-decision-authenticated
transaction-effect-intended
transaction-effect-observed
activity-completed
closure-recorded
```

No allocate, dispatch, observe, cancel, retrieve, contain, retire, reclaim,
Cell, Handle, Carrier-publication, or materialization event exists. Those are
subordinate execution and physical-retention mechanics under the owning
Activity. Their stable results enter only the already selected Receipt,
Candidate Revision, or Closure payload when that family owns the fact.

For a builder Attempt, `candidate-revision-observed` is optional. It occurs
only when the Runtime has independently validated complete output, durably
published and reopened its Candidate Revision Carrier, and atomically retains
the exact successor Revision. Invalid, missing, incomplete, corrupt, lost, or
otherwise rejected output produces no Candidate Revision and no Candidate
event. `execution-receipt-recorded` can therefore finalize that same builder
Attempt without an intervening Candidate event, while the input Revision
remains reducer-selected.

### Atomicity and idempotence

Appending one revision and its finalization event occurs inside one immediate
SQLite transaction. Either both become durable or neither does. An event
identity is an idempotency identity: replaying the same identity and exact
logical event returns the retained fact; replaying it with different content
fails as a conflict. Idempotent replay that includes a revision MUST reproduce
the exact retained revision digest.

Recovery continues only the exact retained operation or transaction. It MAY
append a missing deterministic event or reproduce an idempotent append, but
MUST NOT resample time, manufacture a different revision, redispatch completed
provider work, infer absence as failure, or repair ambiguity with direct SQL.

## Closed Delivery Record-Family Registry

The selected fresh cut supports exactly fourteen Delivery Control record kinds. Every
family retains with and archives as part of the complete Delivery Store.

<!-- markdownlint-disable MD013 -->

| Kind | Dossier | Semantic author | Authority | Editor/window | Revisions | Finalization event |
| --- | --- | --- | --- | --- | --- | --- |
| `director-brief` | Frame | Director | `director-supplied` | Director / `before-activity` | single | `director-brief-submitted` |
| `work-delegation` | Attempt | Director | `director-supplied` | Director / `before-activity` | successive | `work-delegation-set` |
| `agent-attempt` | Attempt | runtime | `runtime-derived` | none | single | `agent-attempt-prepared` |
| `agent-work-product` | Attempt | assigned agent | `agent-proposed` | assigned agent / `provider-active` | single | `agent-work-product-submitted` |
| `execution-receipt` | Attempt | runtime | `runtime-observed` | none | single | `execution-receipt-recorded` |
| `candidate-revision` | Candidate | runtime | `runtime-observed` | none | successive | `candidate-revision-observed` |
| `integration-assessment` | Candidate | runtime | `runtime-observed` | none | single | `integration-assessed` |
| `work-boundary` | Boundary | runtime | `runtime-derived` | none | successive | `work-boundary-finalized` |
| `material-condition` | Boundary | runtime | `runtime-derived` | none | single | `material-condition-frozen` |
| `director-decision` | Decision | Director | `director-authenticated` | Director / `before-authentication` | single | `director-decision-authenticated` |
| `candidate-seal` | Evidence | runtime | `runtime-observed` | none | single | `candidate-sealed` |
| `check-receipt` | Evidence | runtime | `runtime-observed` | none | single | `check-receipt-recorded` |
| `evidence-packet` | Evidence | runtime | `runtime-derived` | none | single | `evidence-packet-finalized` |
| `closure` | Closure | runtime | `runtime-derived` | none | single | `closure-recorded` |

<!-- markdownlint-enable MD013 -->

The producer is `runtime` for all fourteen kinds. “Semantic author” in the
table does not change that physical producer. Each family has retention
`archive-with-delivery`; Foundation rc.17 does not selectively promote,
permanently prune, or leave one family on HEAD.

### Relationship registry

The only standard relationships and cardinalities are:

- `director-brief` has no relationship.
- `work-delegation` has exactly one `uses-boundary` to `work-boundary`, one
  `uses-admission` to `director-decision`, zero through two `uses-brief` to
  `director-brief`, and zero or one `revises` to `work-delegation`. Its payload
  selects every-and-only standing Brief and the exact predecessor, when present.
- `agent-attempt` has exactly one `uses-brief` to `director-brief`, zero or one
  `uses-boundary` to `work-boundary`, zero or one `uses-candidate` to
  `candidate-revision`, and zero or one `uses-seal` to `candidate-seal`.
  The reviewer variant requires all three admitted-subject relationships;
  other variants forbid `uses-seal`.
- `agent-work-product` has exactly one `result-of` to `agent-attempt`.
- `execution-receipt` has exactly one `observes-attempt` to `agent-attempt`,
  zero or one `observes-work-product` to `agent-work-product`, and zero or one
  `observes-candidate` to `candidate-revision`. The optional Candidate target
  is only the builder successor published by that Attempt; the Attempt's
  `uses-candidate` relationship already binds the exact input Revision.
- `candidate-revision` has zero or one `revises` to `candidate-revision` and
  exactly one `governed-by` to `work-boundary`, plus zero or one `result-of` to
  `agent-attempt`. A `builder-successor` requires exactly one `result-of` to
  its creating builder Attempt; other observations forbid it. An
  `integration-successor` requires exactly one `integrated-from` relationship
  to `integration-assessment`; other observations forbid that relationship.
- `integration-assessment` has exactly one `governed-by` to `work-boundary`
  and exactly one `integrates` to its source `candidate-revision`.
- `work-boundary` has exactly one `uses-brief` to `director-brief`, exactly one
  `proposed-from` to `agent-work-product`, zero or one `revises` to
  `work-boundary`, and zero or one `resolves` to `material-condition`.
- `material-condition` has exactly one `freezes` to `candidate-revision` and
  one `governed-by` to `work-boundary`. Its `agent-proposal` source requires one
  `reported-by` to `agent-work-product` and one `observed-in` to
  `execution-receipt`. Its `integration-assessment` source instead requires one
  `reported-by` to `integration-assessment` and forbids `observed-in`. The
  `projection-compilation` source forbids `reported-by`. A reviewer refusal
  requires one `observed-in` to its exact `candidate-seal`; a builder refusal
  has no Seal or `observed-in` relationship. These source-specific cardinalities
  are mandatory; optional family-level fields do not weaken them.
- `director-decision` has zero or one `selects-boundary` to `work-boundary`, any
  number of `selects-baseline-receipt` relationships to `check-receipt`, zero
  or one `continues-from-boundary` to `work-boundary`, zero or one `resolves`
  to `material-condition`, zero or one `selects-candidate` to
  `candidate-revision`, zero or one `selects-seal` to `candidate-seal`, and
  zero or one `selects-evidence` to `evidence-packet`. An admit Decision
  selects the proposed Boundary and every-and-only required modality-valid
  baseline Receipt. A readmit Decision additionally selects the exact active
  predecessor Boundary, resolved Material Condition, and continuing Candidate.
  The other typed variants prohibit those admission-only relationships and
  impose their exact acceptance or no-ship combination.
- `candidate-seal` has exactly one `seals` to `candidate-revision` and exactly
  one `governed-by` to `work-boundary`.
- `check-receipt` has zero or one `checks-boundary` to `work-boundary` and zero
  or one `checks-seal` to `candidate-seal`. Its typed phase requires exactly
  the legal baseline or final subject; neither, both, or the wrong subject is
  invalid.
- `evidence-packet` has exactly one `governed-by` to `work-boundary`, exactly
  one `evaluates` to `candidate-revision`, exactly one `uses-seal` to
  `candidate-seal`, any number of `uses-check` relationships to
  `check-receipt`, exactly one `uses-review` to `agent-work-product`, and
  exactly one `uses-review-receipt` to `execution-receipt`.
- `closure` has exactly one `closes-with` to `director-decision`, zero or one
  `governed-by` to `work-boundary`, zero or one `accepts-candidate` to
  `candidate-revision`, zero or one `accepts-evidence` to `evidence-packet`, and
  zero or one `abandons-candidate` to `candidate-revision`. Its terminal
  disposition requires the exact acceptance or no-ship combination and
  prohibits a mixed combination. Only no-ship before any Work Boundary was
  established can omit `governed-by`; every other Closure binds the exact
  current Boundary.

### Family meaning

#### Director Brief

The Director Brief is one complete Director semantic input with an explicit
lifetime. Its v2 typed payload selects the exact operation and input profile
and a closed `scope`: either `activity` with an `activityId`, or `delegation`
with a Work Delegation identity, positive revision and `delivery.continue` or
`delivery.evaluate` operation. Delegation scope binds the forthcoming record
coordinate; the delegation in turn binds the complete Brief reference, avoiding
a circular digest. The original normalized semantic Markdown and raw submission
digest and length remain exact.

Preparation uses one self-contained Frame Brief. Manually requested Continue
and Evaluate use one fresh direction Brief; Revise and Reaffirm use one fresh
boundary-resolution Brief. Their `activity` scope finalizes atomically with
opening that Activity. A standing Brief finalizes atomically with its exact
Work Delegation. Subsequent reserved Activities reuse that immutable Brief;
fresh Runtime context is not another Director submission. There is no implicit
inheritance, merged direction or resampled submission time. One Delivery still
has exactly one preparation Activity.

The Store MUST refuse a fresh append batch containing a standing Brief unless
that same batch finalizes the exact Work Delegation that selects it. The entire
batch rolls back on refusal, including earlier Briefs in the batch. Reducer
interpretation of intermediate Journal prefixes does not establish this physical
commit boundary; the Store append owner enforces it. Recognizing already
retained exact events does not create a new submission or charge.

#### Work Delegation

The Work Delegation retains the Director-supplied finite resource selection
defined by [Investment Allocation](ATTEMPT_VIEW.md#work-delegation). Its exact
active Work Boundary and applied admission distinguish funding from mandate
authority. Its first revision begins one Delivery-local identity; replacement
advances that same identity by one and names the preceding complete reference.
Replacement neither reinterprets opened Activities nor resets lifetime charges.
It requires settled work without an unresolved Material Condition. Every
standing Brief has the same supplying Director as the admission and exact
delegation scope. The ordered Brief and delegation appends share one commit.

An Activity's optional `reservation` in `activity-started` binds its exact
delegation, operation-specific decision basis, finite slots and charges. The
reducer validates the previous Journal head, exact decision-basis digest,
current Boundary and admission, selected standing Brief, and allowance before
charging once. It checks every required final Check selection and its admitted
Definition and Binding. Execution owners independently compare actual resolved
resources with those slots at allocation and exact recovery. Existing Activity,
Attempt and Check selection identities connect these facts; there is no second
slot ledger or per-Cell reservation event.

#### Agent Attempt

The Agent Attempt is the frozen runtime-derived invocation contract. It binds
the exact Director Brief for that activity. Its typed payload owns the exact
role, subject, Projection, input Candidate Revision and Carrier when applicable,
Provider Descriptor, Capability Profile, Investment, Execution Backend Profile,
Execution Image, Input Set, working-value contract, effective limits, and
output policy. It does not contain a future Work Product, provider observation,
successor Candidate Revision, Execution Handle, allocation key, credential, or
private Backend coordinate.

#### Agent Work Product

The Agent Work Product is the assigned Agent's semantic result after successful
Runtime parsing and compilation. The Agent may inspect and revise its governed
working value over multiple provider tool turns and use the selected local
draft assistance profile. Runtime independently validates the exact retrieved
submission after Containment; local observations cannot replace that validation. It supplies every operational binding
and final record mechanic. A provider final message, event stream, or
unsubmitted draft is not a Work Product.

Role-specific payload profiles distinguish reconnaissance, builder, and
reviewer semantics without creating three record families. A
reviewer Work Product remains agent-proposed independent judgment; Evidence
does not relabel it as a runtime observation.

The payload retains the complete normalized typed semantics required by every
downstream compiler and recovery route, including readable semantic scalar
values where they are operational inputs. The compiler renders the retained
Markdown body from that normalized semantic value and binds its complete body
and addressable fragments. The Receipt separately identifies raw workspace
bytes and the normalized submission. Authored layouts can therefore compile to
one canonical body while their original byte observations remain distinct.
This joined representation is one validated revision; a mismatch between
payload semantics and its canonical body bindings is invalid. Runtime components
MUST NOT recover missing typed semantics by reparsing retained or exported
Markdown.

#### Execution Receipt

The Execution Receipt is the runtime-observed terminal account of one Agent
Attempt. It records provider start and terminal facts, exact Work Product
availability, stable Backend Profile, Image, Specification, Input Set, Output
Carrier and Manifest dispositions, bounded raw-material descriptors, Execution
Containment, and Runtime-owned Retirement. It references rather than reproduces
the Attempt, Work Product, input Candidate Revision, or optional successor
Candidate Revision.

A builder Receipt can finalize without `observes-candidate` when no valid
successor was published. That absence records no rollback and no unavailable
Candidate: the Attempt's exact input Revision remains current. A reviewer and
reconnaissance Receipt likewise create no successor relationship. Receipt
payloads and relationships contain no private Handle, allocation key, backend
locator, credential, materialization path, or Reclamation state.

#### Candidate Revision

Candidate Revision is one exact valid reconstructible state of the continuing
Candidate. Successive revisions are states of that Candidate, not additional
product objects. Every Revision owns the exact immutable base, tree and state
digests, changed-subject facts, Candidate digest, and one digest-bound adjacent
Candidate Revision Carrier manifest. Its referenced Git object closure MUST
already be durable and independently reopenable in the installation Carrier
Store. A Revision has no `invalid` or `unavailable` state and does not claim
semantic progress, proof, acceptance, or canonicality.

The observation kind is `initialization`, `builder-successor`,
`integration-successor`, or `readmission-rebind`. Initialization publishes and reopens the initial Carrier
before retaining the first Revision. A builder successor MUST `revises` the
exact reducer-selected input Revision, MUST bind its creating builder Attempt,
and can be retained with `candidate-revision-observed` only after complete
output validation and Carrier publication. A valid unchanged result MAY reuse
the input Carrier while creating a distinct logical successor. Invalid or lost
output creates no Revision or event.

A readmission rebind is a successor under the same Candidate record identity.
It MUST `revises` the exact previously current Revision, MUST be `governed-by`
the newly active successor Work Boundary, MUST retain byte-identical state,
Carrier, and `candidateBaseCommit`, and MUST NOT bind an Agent Attempt. It
records the changed governance coordinate without claiming product-byte
motion.

An integration successor preserves the Candidate identity, `revises` the exact
source C selected by its Assessment, and is `integrated-from` that Assessment.
The Assessment MUST be constructed under the same governing Boundary. Its
`canonicalParent.commit` is the successor's `candidateBaseCommit`; its Carrier
and state describe the exact result and P→I contribution. Only this observation
may change the application base. Builder successors and readmission rebinds
inherit it unchanged. Ancestry retains the original base and resolves the latest
integration provenance for later revisions; the latest unrelated Assessment is
not a replacement subject.

#### Integration Assessment

An Integration Assessment is the immutable runtime-observed result of one
explicit `delivery.integrate` over source C and canonical parent P. It is not a
product result, semantic admission, or acceptance authority. Its exact
relationships bind C and the active Boundary. C owns its source application
base and Carrier; the Assessment MUST NOT duplicate those state facts.

The v1 payload selects `lifecycle.integration-assessment.foundation-v1` and
retains the complete `canonicalParent` Repository Snapshot, fixed `mergeRule`
identity and implementation digest, `outcome`, bounded exact `conflicts`,
`validation`, `contextualApplicability`, `assessedAt`, and limitations.
The fixed rule id is `lifecycle.integration.three-way.v2`. The implementation
selection binds the executable version and fixed behavior before construction
and is rechecked on recovery; repository configuration cannot replace it.

`outcome` is `constructed`, `conflicted`, or `invalid`. Constructed requires
complete valid physical/Knowledge validation and no conflict. Conflicted
requires nonempty exact path/kind facts; invalid records failed or incomplete
validation. Neither failure selects a Candidate or publishes a conflict-marker
result as a valid Carrier. Validation retains `complete`, `valid`, sorted unique
`diagnosticCodes`, and an exact public `factsDigest`. Conflicts contain normalized
path and one of content, add-add, modify-delete, rename, mode, type, unsupported.
Result state lives solely in a valid successor Candidate Revision. Its exact
Carrier manifest file digest, complete state, and observer MUST reproduce the
constructed Assessment's `validation.factsDigest` under the Processing preimage.
Rehashing a different Candidate payload cannot preserve that join. Later builder
or readmission successors keep their own facts; verification walks to the exact
integration-origin revision rather than applying the origin digest to later work.

Contextual applicability is `unchanged` or `requires-readmission`, with exact
changed comparisons for repository-contract, atlas, discipline-registry,
knowledge-closure, and required-sources. Each comparison binds admitted and
parent content digests under [Processing](PROCESSING.md#integration-canonicalization).
An unchanged comparison has no change entries; requires-readmission has at
least one. Mechanical comparison is not a judgment of mandate sufficiency.

`integration-assessed` finalizes this record with payload `{activityId}`.
A constructed Assessment can be durable before its successor append; the
unfinished guarded finalization then remains exact recovery work. Completed
conflicted/invalid assessments are complete observations without advancement.

#### Work Boundary

The Work Boundary is the complete runtime-compiled envelope for a proposed or
active Delivery basis. Its nested mandate carries the intended result and
obligations; its other fields bind the exact repository and Knowledge basis,
profile selections, Director Brief, reconnaissance Work Product, and provenance.
[Delivery](DELIVERY.md#basis-and-mandate) owns those fields' governing meaning. The runtime finalizes this exact
subject before executing its required baseline Checks; each resulting Receipt
then points to the Boundary. Reducer-derived proposal readiness requires the
complete modality-valid Receipt set, so the Boundary does not point forward to records
that do not yet exist. Before Director admission it is a proposal; the same
immutable revision becomes active only through the exact authenticated and
observed admission effect. Foundation rc.17 has no separate Preparation,
Proposal, or copied admitted-boundary record.

The v6 Work Boundary payload also retains the exact Discipline Registry digest,
selected Work Type ids, and exact advisory Discipline subset of selected
Knowledge. These are Boundary-owned context selections, not new Control
families, event facts, requirements, or evidence. Their identity remains frozen
with the Boundary and is reconstructed from retained subjects during recovery.

The repository basis directly binds the four exact Atlas identities from the
same Repository Snapshot. They remain immutable historical context for that
Boundary. A successor resolving a runtime context-change or exact reviewer
applicability Condition under Delivery can bind the complete
retained integration parent Snapshot in the same Delivery. Readmission changes
active governance, preserves Candidate bytes and its application base, and
never refreshes from live HEAD.

#### Material Condition

The Material Condition is the runtime-derived frozen fact that the active Work
Boundary can no longer govern productive work honestly. Its agent-proposal
variant binds the reporting Work Product, Execution Receipt, exact reducer-selected Candidate Revision, and
active Work Boundary. For a builder it freezes the published successor when
one exists; otherwise it freezes the Attempt's exact input Revision. It MUST
NOT select provisional Cell output or manufacture an unavailable Revision. It
preserves the source proposal's provenance without making agent prose the
Process freeze. The reporting Work Product can be a productive builder result
or a read-only reviewer result; the runtime validates the exact role-specific
joins before freezing the same record family. Revision, reaffirmation,
readmission, or no-ship resolves it under Delivery.

The runtime-owned `integration-context-change` variant has source
`{kind: "integration-assessment"}`. It binds the exact requires-readmission
Assessment through `reported-by`, freezes that Assessment's constructed
successor, and retains the active Boundary. It forbids a Work Product or
Execution Receipt source. `observedFactsDigest` is the canonical digest of the
Assessment's contextualApplicability value. This distinct source preserves
runtime provenance without creating an Agent Attempt.

The runtime-owned `projection-closure-exceeded` variant can instead have source
`projection-compilation`. Payload v3 retains exact request digest, selected
profile id/digest, compiler identity/version/digest, typed measurement, and
refusal-facts digest. It freezes the exact Candidate under the active Boundary
and, for evaluation, observes the exact Seal. A builder refusal has no Seal.
Neither invents a Work Product or Receipt. Only a compiler-owned measured witness can construct this variant.

A `complete-closure` measurement retains exact mandatory item/byte and source
byte counts, their selected limits, and an oversized-item count, canonical
complete-list digest, and one exact bounded witness when available. The complete
list orders by code-point item identity and remains reproducible from the exact
retained basis; it is not copied without bound into a Condition. A
`mandatory-item` measurement instead binds one required category/identity,
repository-relative locator, exact Git object identity, observed byte length,
and selected per-item bound. It proves that one required item cannot fit before
reading its oversized content and MUST NOT claim complete closure counts.

The refusal-facts digest uses the domain tag
`lifecycle.projection-mandatory-refusal.v1` over the request digest, complete
selected profile, compiler identity, and typed measurement. The Condition's
`observedFactsDigest` separately uses
`lifecycle.projection-condition-observed-facts.v1` over Activity identity,
kind-qualified exact Boundary/Candidate references and nullable Seal reference,
refusal event sequence
and digest, and the complete retained source. The two digests bind measurement
and Process provenance separately. Generic exceptions, partial retrieval, or
claimed trust fields cannot become this runtime fact.

#### Director Decision

The Director Decision retains the exact Director-authenticated admission,
readmission, acceptance, or no-ship subject and readable rationale. The Director
can edit the working decision only before authentication. The runtime then
produces one immutable authenticated revision. Authentication does not claim
that the corresponding recoverable transaction completed. Admission authority
binds the complete baseline Receipt set by role rather than relying on a later
query for whichever Receipts happen to be current. Readmission also names the
active predecessor separately from the successor it selects.

#### Candidate Seal

The Candidate Seal is the runtime-observed fact selecting one exact Candidate
Revision under one active Work Boundary for evaluation. It references that
Revision rather than duplicating its state or Carrier manifest. Sealing
reopens and verifies the exact Carrier and freezes the logical evaluation
subject; it does not freeze a mutable workspace, accept the result, or create
another Candidate.

#### Check Receipt

The Check Receipt is one runtime-observed Check outcome against either an exact
Work Boundary baseline subject or exact Candidate Seal. It owns execution
conditions, normalized outcome, limitations, stable Specification, Input Set,
Backend Profile, Image, Output Manifest, Containment, Retirement, and
referenced raw operational material. It contains no private Handle or
Reclamation state and remains distinct from provider claims and ordinary
builder command output. An allocated Check Cell cannot finalize its Receipt
until it is contained and retired; a Check refused before allocation records
the exact not-run or unsupported disposition without inventing a Cell.

#### Evidence Packet

The Evidence Packet is the runtime-derived exact evaluation aggregate. It
references the active Work Boundary, Candidate Revision, Candidate Seal, Check
Receipts, reviewer Work Product, and reviewer Execution Receipt. Its typed
payload owns artifact and Description coverage, Receipt reuse, invalidation,
independence, proposition decisions, obligation states, diagnostics, and
uncertainty as bounded ledgers. Those ledgers are not separate Control record
families.

The [Evidence verifier](EVIDENCE.md#evidence-verifier) owns their semantic
derivation and validation. Control owns exact revision construction and atomic
retention; the reducer owns current selection and legal finalization. Retaining
an assembly does not independently prove its acceptance justification.

#### Closure

Closure is the sufficient terminal runtime-derived record. It binds the exact
Director Decision, optional Work Boundary, accepted Candidate and Evidence or
no-ship Candidate disposition, completed transaction observation, exact
terminal execution-set digest, Execution Containment, Runtime-owned Retirement,
the immutable Reclamation-handoff obligation-set digest and count at Closure,
and terminal result. Boundary is absent only for no-ship before any proposal
existed. No separate No-Ship Selection, Candidate-Disposition Observation,
Cleanup Observation, Cell record, terminal-document set, or Control Index
survives beside it.

Before `closure-recorded`, every allocated Cell belonging to the Delivery MUST
be directly established contained, its output disposition MUST be final, and
the Runtime MUST durably retire its exact private Handle from every productive
namespace. Any remaining physical allocation MUST already have been handed to
the installation-private Reclamation owner before live operation support is
disposed. Closure retains only the stable obligation-set digest and count, not
the Handle, handoff payload, private coordinates, or later ledger standing. It
does not require completed Backend Reclamation and does not claim physical
absence or secure erasure. Reclamation success or failure cannot later revise
Closure or append a Journal event.

`terminalExecutions` and `reclamationHandoff` name different exact sets.
`terminalExecutions` is derived from finalized Execution Receipts and allocated
Check Receipts. `reclamationHandoff` accounts for every Cell allocation handed
to installation-private Reclamation. When an Agent activity ends through
`agent-pre-intent-refused` after a prearmed allocation, no Attempt or Receipt
exists; the validated subjectless event's Store, Process, and activity identity
instead anchors exactly one private Agent handoff recording `dispatchAuthorityConsumed=false`
and final Retirement, which makes the Handle non-reusable. That handoff
contributes to the Reclamation obligation set but not
the terminal execution set. A `projection-condition-required` refusal proves
that no builder or reviewer allocation exists and therefore contributes no Agent handoff. Previously allocated Check
Cells remain accounted independently. The two counts are derived independently
and MUST NOT be required to equal. Missing, duplicate, consumed, cross-activity,
cross-Delivery, or substituted handoffs fail closed.

For acceptance, `canonicalResult` binds only the exact sealed Candidate result
applied over the exact integration parent:

- `parentCommit` and `parentTree` MUST equal the exact integration parent
  resolved from the accepted Candidate lineage;
- `commit` MUST identify the accepted commit whose sole parent is
  `parentCommit` and whose tree is `tree`;
- `tree` MUST equal the sealed Candidate tree;
- `candidateDigest`, `productStateDigest`, and `knowledgeSetDigest` MUST equal
  the selected Candidate Revision, Seal, and Evidence subject; and
- protected-root validation MUST establish that the integration parent's Atlas
  and Discipline subtrees remain byte-identical in `tree`.

There is no live current-Atlas input, alternate parent, composition identity,
or separately compiled accepted Knowledge Set.

Closure's transaction facts bind the final immutable observation through its
exact `observationFactsSchema` and `observationFactsDigest`. Acceptance requires
the applied acceptance-observation schema; no-ship requires the applied
repository-observation schema. For acceptance, `canonicalResultDigest`
additionally MUST equal both the digest inside those final facts and the
canonical digest of `canonicalResult`; for no-ship it is null.

An accepted Closure records `candidateTreatment` as `integrated`. A no-ship
Closure records `abandoned` when its exact Candidate existed or `not-created`
when reduction proves no Candidate ever existed. `abandoned` permanently ends
Candidate advancement and acceptance and requires the `abandons-candidate`
relationship to the exact reducer-selected Revision. It does not claim that a
Carrier, materialization, or Backend allocation was synchronously deleted.

## Adjacent Referenced Files

The SQLite revision is sufficient for ordinary retained semantic Markdown and
typed Control facts. The adjacent `files/` directory is only for bounded large
operational material whose exact bytes must remain available, such as raw
provider output, raw Check output, a bounded proof artifact, or an exact
operation package selected for retention. It also retains the canonical
Candidate Revision Carrier manifest selected by each Candidate Revision. It
MUST NOT contain:

- a Markdown rendering of a Control revision;
- a JSON copy of a typed payload, relationship, event, seal, or reduction;
- Product Knowledge, Candidate product files, or the Carrier's Git object
  closure;
- a mutable log, cache, database journal, credential, authority secret, lock,
  executable, or physical-path manifest; or
- an unbounded provider transcript or model-reasoning capture.

Each file is one non-symbolic regular file named
`sha256-<lowercase-hex-digest>` without an extension. Its database descriptor
binds exact SHA-256 digest, byte length, media type, purpose, and creation time.
The Foundation limit is 256 MiB per file; an owning profile MAY select a lower
limit. Digest and byte length are over the original exact bytes before decoding
or normalization.

One digest cannot acquire different metadata. Adjacent bytes enter custody only
with the exact bounded append that makes them reachable from an Execution
Receipt, Check Receipt, or Candidate Revision. There is no free-standing
file-retention operation. Outside the exact transient custody state defined
below, every retained file descriptor MUST be reachable by exact digest from
an owning revision, and a physical file without a descriptor, a descriptor
without exact bytes, an unreachable descriptor, an unsupported filename,
altered bytes, length mismatch, or path substitution is an orphan or integrity
failure.

### Builder repair output

A builder Execution Receipt with an exact conclusive invalid-Candidate
observation can retain one `lifecycle.builder-repair-output.v1` descriptor.
It uses purpose `builder-repair-output`, media type `application/json`, canonical
JSON bytes, and a 64 KiB maximum. Its closed value binds the exact builder
Attempt, original Work Boundary and input Candidate, the Candidate owner's
rejection, one exact Carrier manifest file descriptor and a self-digest.
[`builder-repair-output.schema.json`](../schemas/builder-repair-output.schema.json)
owns its structural shape; [Attempts](ATTEMPTS.md#rejected-product-output-and-repair)
owns its observation and selection meaning.

The Receipt's `rawMaterials` directly selects both this small descriptor and
the unchanged Carrier manifest. The manifest uses the existing reserved
Candidate Carrier manifest purpose, media type and 256 MiB bound below; a
reference from this exact repair pair does not create a Candidate Revision.
Reusing that descriptor preserves one digest-to-metadata binding when the same
manifest already exists. Both purposes must be declared by the builder Attempt.
Other roles, missing or duplicate members, mixed subjects, unsupported purposes
and provider-authored repair descriptors cannot establish a repair selection.
Retention is atomic with its Receipt, before Activity support disposal.

The installation Carrier Store retains the complete object closure while any
live or archived Receipt references this pair. Receipt retention validates the
pair, exact observed Attempt/Candidate/Boundary joins, rejection and manifest
bindings. Generic Store opening validates retained file bytes, metadata and
reference ownership. Repair selection reopens the exact pair and joins before
using its Product bytes; terminal sealing and archive verification independently
reopen the referenced Git closure. Reference accounting includes both current
and expired repair pairs. The tree stays outside SQLite and adjacent files.
Receipt retention does not select it as current Product or governing
Knowledge, and expiration from a future builder's context does not erase
historical custody.

### Candidate Revision Carrier manifest

Every Candidate Revision selects exactly one canonical
`lifecycle.candidate-revision-carrier-manifest.v1` adjacent file. Its descriptor
uses the fixed purpose `candidate-revision-carrier-manifest` and fixed media
type
`application/vnd.lifecycle.candidate-revision-carrier-manifest+json`, and binds
the manifest's exact byte length and digest. The manifest binds at least the
Git object format, exact root tree, complete bounded object inventory, object
and byte counts, object-inventory digest, and content-addressed Carrier artifact
digest. Each object byte length is the uncompressed Git object payload length,
excluding the Git object header and every loose-object or pack framing,
compression, delta, index, and manifest byte. `aggregateObjectBytes` is the
exact sum of those inventory lengths. Semantic validation refuses every empty
reachable tree, including an empty root, because a Carrier cannot manufacture
an otherwise unrepresented empty directory. The manifest contains no
materialization path, Store path, Backend coordinate, Execution Handle,
allocation key, credential, or mutable currentness field.

The manifest is Control evidence; the corresponding Git object closure is not
an adjacent file, SQLite value, or Store archive member. The installation
Carrier Store owns that immutable closure and MUST retain and independently
reopen it while any live or retained archived Control Store references the
manifest. Carrier reference accounting treats exact Candidate Revision
references and live atomic-promotion recovery coordinates as roots. An
interruption after Carrier publication but before Candidate Revision retention
may leave a bounded unreferenced Carrier for private Reclamation, never a
Revision whose Carrier is unavailable.

Control integrity has two explicit layers. The Control Store verifies the
adjacent descriptor, exact manifest bytes, canonical value, schema, digest,
inventory shape, and reference without acquiring ownership of Carrier Store
paths. A complete Runtime integrity check additionally asks the Carrier Store
owner, through a narrow exact-digest verifier, to reopen the referenced artifact
and prove that its bytes contain exactly the declared closure. The SQLite owner
MUST NOT discover Carrier paths, treat their existence as sufficient, or weaken
a complete integrity claim when that external proof is unavailable.

Removing an entire archived Delivery under its separately defined archive
retention policy releases only that archive's Carrier references. Reclamation
MUST still refuse while another live Store, archived Store, or exact recovery
coordinate references the same Carrier. It MUST NOT infer liveness from a
materialization path or delete by broad Store or Docker pruning.

### File durability

The runtime retains selected files and their owning Control append by:

1. purely compiling every digest and descriptor, validating the complete
   bounded ordered revision/event append, and proving that every supplied file
   is selected by an exact Receipt or Candidate Revision in that append;
2. recording one canonical pending manifest and its exact file entries in an
   immediate SQLite transaction, including whether each descriptor and carrier
   already existed;
3. writing each new file through its deterministic mode-`0600` temporary name
   in `drafts/`, synchronizing the complete bytes, atomically renaming to the
   content-addressed destination in `files/`, synchronizing both directories,
   and rereading the exact carrier;
4. inserting or exactly reproducing every descriptor in an immediate SQLite
   transaction;
5. committing the complete ordered revision/event append in one SQLite
   transaction; and
6. deleting the pending rows only after that exact append is wholly durable.

Only one file-custody batch may be pending. While it is pending, an ordinary
append and every different file batch MUST refuse; only an exact retry of the
same manifest and supplied bytes may continue. The pending state may truthfully
describe no carrier yet, durable carriers without descriptors, descriptors
without the semantic append, or the wholly completed append awaiting pending
cleanup. A partial append is never recoverable as that batch.

Pending rows, deterministic temporary names, and newly staged descriptors are
operational recovery support, not logical inventory. A new descriptor becomes
part of the logical file inventory only with the wholly completed semantic
append; a preexisting referenced file never leaves that inventory merely
because a later batch reuses it. Opening and integrity verification MUST accept
an interrupted pending state only when the manifest, rows, carrier names,
bytes, descriptor presence, and wholly absent-or-complete append disposition
reproduce exactly.

An operational or ambiguous failure preserves the pending state for exact
recovery. If the append deterministically refuses in-process, rollback MUST
remove only temporary files, carriers, and descriptors newly introduced by
that pending batch; it MUST NOT remove or rewrite a preexisting referenced
file. Recovery MUST NOT adopt unknown bytes, choose among duplicates, or
silently delete an unrelated orphan. Pending file custody MUST be empty before
store sealing or archive.

## Bounded Processing Profile

Foundation rc.17 applies these inclusive per-Delivery limits before retention
or unbounded allocation:

<!-- markdownlint-disable MD013 -->

| Subject | Limit |
| --- | ---: |
| normalized semantic Markdown in one revision | 1 MiB |
| canonical typed payload in one revision | 2 MiB |
| canonical payload in one event | 64 KiB |
| canonical payload in one operation-support row | 2 MiB |
| JSON nesting depth | 64 |
| members in one JSON array or object | 16,384 |
| total JSON values in one payload | 262,144 |
| relationships in one revision | 4,096 |
| logical Control records | 10,000 |
| total retained revisions | 25,000 |
| Journal events | 100,000 |
| live operation-support rows | 256 |
| total live and disposal operation-support rows | 100,000 |
| adjacent referenced files | 4,096 |
| one adjacent referenced file | 256 MiB |
| aggregate adjacent referenced-file bytes | 8 GiB |
| complete active or archived store root | 16 GiB |

<!-- markdownlint-enable MD013 -->

Identifiers, actors, relationship names, media types, purposes, diagnostics,
Output Carrier entries, and SQL statements remain subject to their smaller
owning limits. A runtime MAY refuse at a lower disclosed operational limit,
but it MUST report that effective limit and MUST NOT claim the rc.17
qualification profile unless it supports every required fixture within these
maxima.

Exceeding a limit creates no partial revision or event. Opening, inspection,
replay, sealing, and archive verification apply the same limits to already
retained values; direct database modification cannot bypass them.

## Database Durability and Integrity

Every mutating store operation uses an immediate transaction, foreign-key
checks, and durable SQLite synchronization. A revision and finalization event
commit atomically. An event cannot name an unavailable revision. A failed
transaction rolls back before returning a refusal.

Opening, recovery, sealing, archiving, and read-only inspection MUST validate:

- physical directory and file type, ownership, mode, and link count;
- application identifier, user version, and exact immutable store identity;
- SQLite `quick_check` and foreign-key integrity;
- canonical JSON and every recomputed revision and event logical digest;
- record-kind stability and contiguous revisions;
- event sequence, predecessor chain, nondecreasing time, and exact subjects;
- family policy and relationship cardinality;
- every referenced file descriptor and exact content-addressed byte carrier;
- every Candidate Revision or Receipt-bound repair Carrier manifest and exact
  referenced immutable Git object closure in the installation Carrier Store;
- exact pending-file custody, when present, including absent-or-complete append
  disposition and the restricted recoverable carrier/descriptor combinations;
- canonical and correctly digested live operation support, exact payload-free
  disposal tombstones, store, Process, activity, kind, generation, and
  row-count bounds;
- absence of unsupported or orphan adjacent entries;
- exact Retirement completion and private Reclamation handoff before terminal
  Activity support disposal, without requiring completed Reclamation; and
- seal and archive bindings when present.

The logical inventory digest is the SHA-256 digest of the exact
`lifecycle.control-record-store-logical-inventory.v1` canonical JSON subject in
[Processing](PROCESSING.md#control-logical-digest-subjects). Its file entries
are the exact digest, byte-length, media-type, and purpose projection; file
descriptor creation time and schema do not enter this digest. SQLite physical
bytes, operation support, pending custody, and the later archive manifest are
likewise excluded. The store seal binds this logical inventory.

## Store Seal

The runtime may seal only an unsealed, completely valid store whose current
Journal head has the exact finalized Closure revision as its subject. The
`drafts/` directory and pending-file custody MUST be empty, no live operation
support may remain, and every governed working value MUST have an exact
disposition before sealing. Every referenced Candidate Revision Carrier
manifest and Git object closure MUST verify, and every Cell MUST already be
contained and Runtime-retired with any remaining Reclamation obligation
durably handed off outside Control. Completed physical Reclamation is not a
seal precondition. The seal transaction removes verified payload-free
operation-support disposal tombstones before inserting the seal, so the sealed
Store contains no operation-support rows. The
`lifecycle.control-record-store-seal.v1` value binds:

- exact Closure identity, revision, and logical digest;
- exact Journal-head sequence and digest;
- exact logical-inventory digest; and
- canonical seal time.

Seal creation is one immutable database transaction. Repeating the same exact
Closure subject and seal time is idempotent. A different Closure, digest, head,
inventory, or time conflicts. Once sealed, the database MUST reject every new
revision, event, relationship, file descriptor, and file. A seal cannot be
updated or removed.

Sealing does not claim that the store has been archived. Closure, sealing, and
archive movement are separately observed operations so recovery can resume at
the exact missing boundary.

## Complete Archive

Only a sealed, closed, integrity-valid store can be archived. The runtime MUST
first close or checkpoint every writable SQLite connection and refuse a source
root containing a live rollback journal, WAL, or shared-memory file.

The archive operation:

1. verifies the seal and recomputes its logical-inventory digest;
2. synchronizes the database, every referenced file, and owning directories;
3. verifies that `drafts/` is empty and computes the exact SQLite
   retrieval-byte digest and file inventory;
4. writes and synchronizes one
   `lifecycle.control-record-store-archive.v1` `archive-manifest.json` binding
   store identity, seal, database filename, database byte length and retrieval
   digest, every referenced filename, length and digest, and archive time;
5. atomically moves the complete active store root to a distinct off-HEAD
   archive root identified by Delivery and Closure digest;
6. synchronizes source and archive parent directories; and
7. reopens the archived database read-only and revalidates the manifest,
   retrieval bytes, complete store integrity, seal, and logical inventory.

The archive is the complete Delivery Control disposition. No family, revision,
event, file, relationship, or seal is promoted onto HEAD or left behind as a
second current store. A conflicting destination fails; the runtime MUST NOT
overwrite, merge, partially copy, or choose between archives.

The archive contains every referenced Carrier manifest but not the Git object
closures themselves. The installation Carrier Store MUST retain those closures
for as long as the archive remains retained and MUST include the archive's
exact manifest references in Carrier liveness calculation. Archive movement
does not create a Reclamation event, transfer a Handle into Control, or weaken
the independent Carrier-integrity check.

An archive retention policy can later retain or remove the complete archive as
one subject. It MUST NOT prune individual revisions, events, or files and still
claim the original seal or archive-manifest digest.

## Runtime Read-Model Layer

Foundation has one runtime-owned, disposable read-model layer over exact
Control Store, reducer, repository, Candidate, and operation-support facts. A
read model is never a Control revision, Journal event, adjacent file, mutable
Process state, authority subject, transaction input, or recovery carrier.
Deleting every presentation cache leaves replay, eligibility, Evidence,
authority, sealing, archive, and recovery unchanged.

Every read result discloses its exact subject and observation. Current Delivery
views, mutable inspection pages, Authorization Review, and watches carry one
disclosed read generation. For one Delivery that generation binds at least
Store and Process identity, physical Store
disposition, the complete validated Journal head, installed reducer and view
profiles, repository epoch, current Control subjects, and the identity and
bounded generation digest of any active operation support, plus the exact
pending Work Delegation stop request digest when present. A stop request MUST
advance the token after its durable commit even while Journal and logical
inventory remain unchanged. Reopening the same retained custody reproduces
that binding. The token exposes no
support payload, machine path, provider bytes, credential, process handle, or
transaction continuation. A result becomes stale when any bound constituent
changes.

### Exact immutable Control record inspection

The `record` selector supplies one complete Control reference: kind, identity,
revision, and digest. It reads that exact retained revision, including a
historical revision that is no longer current. Its currency is the selected
Target, Store and Process identity and the immutable reference, rather than
the complete current Delivery generation. Unrelated Journal appends and private
operation-support checkpoints MUST NOT invalidate that unchanged record read.

The Runtime MUST verify Store integrity and the exact revision, then reopen
the selected custody and verify its final Journal and revision. Store identity
and active-or-archived custody MUST remain unchanged during this read, and the
original observed Journal head MUST remain an exact prefix of the final
verified Journal. Missing custody, rollback, a different history, substituted
records, or digest mismatch MUST refuse; no similar or cached record is a
fallback. A subsequent request may reopen the same exact revision after its
required custody is restored or its lawful archive movement has finished.
Unrelated canonical Product movement cannot replace the record's Target or
Store identity and is not itself a change to the immutable record.

The result identifies the exact retained record separately from its final
Runtime observation. Reading an earlier revision does not make it current,
renew a review, or supply a mutation precondition. Interfaces may preserve its
verified body and original read observation through unrelated live refreshes.
They MUST distinguish that body from current selected subjects and disclose
when its observed selection or availability is no longer confirmed. No earlier
body may be relabeled with a later read time or current-generation claim.

This exception does not change the complete-generation contract of mutable
family or revision pages, Authorization Review, watches,
productive input, or recovery. Reads create no operation or retained progress.

### Historical Context basis

Knowledge, Atlas, Code, and Source inspection bind retained artifact selections,
not the complete current Delivery generation. A self-digested Context selection
(`lifecycle.context-selection.v1`) names the Target, Store, Process, exact
Journal origin (positive sequence and event digest), and the proposed or active
role plus exact Work Boundary reference selected at that origin. The Runtime
MUST replay the retained prefix through the sole Delivery reducer to reproduce
that role and reference. The origin remains provenance even after a successor
Boundary is proposed or admitted; it is not a claim of currentness.

The Runtime reopens that Boundary's retained Repository Snapshot and reproduces
its canonical commit and tree, Product State, Knowledge Set, raw Atlas State,
Atlas Resolution, normalized Atlas model, Resource bindings, repository
contract, and Check Binding Set. The self-digested Context basis
(`lifecycle.context-basis.v2`) binds the complete selection and these historical
dependencies. Current repository and operation observations are separate; they
MUST NOT enter or replace this basis merely because work continues.

A self-digested Code selection (`lifecycle.code-selection.v1`) additionally
names candidate or decision inspection and the exact active Boundary, Candidate
Revision, and, for a sealed decision, Candidate Seal selected at its Journal
origin. The same reducer replay MUST reproduce that combination. An absent
Candidate or absent decision Seal permits only the corresponding explicit
unavailable result. An available Code basis (`lifecycle.code-basis.v2`) binds
that selection, its active historical Context basis, exact application base,
Candidate Carrier and difference facts. Later Candidate advancement does not
replace the selected Candidate. A Code Source retains candidate-versus-decision
selection and the exact Seal when present, including for the canonical side.

Artifact reads MUST preserve the initial verified Journal head as an exact
prefix of a freshly reopened final verified Store, with unchanged Target,
Store, Process and active-or-archived custody. The retained selection origin
MUST still reproduce at that final read. Checkpoint updates and unrelated
Journal appends do not invalidate unchanged artifact dependencies. Missing or
corrupt custody, history substitution or rollback, a false historical subject
combination, unavailable required artifacts, and non-reproducible digests
produce typed unavailability or refusal. No current `HEAD`, alternate Boundary,
Candidate, Atlas epoch, or presentation cache supplies fallback truth.

Interfaces may retain the selected basis, pages and exact Source bytes across
live refreshes, including after current subjects advance. They MUST retain the
original inspection observation and distinguish an earlier selection from the
latest observed subjects. Refreshing live state MUST NOT silently replace the
selected content or relabel it with a later inspection time. A separate explicit
reselection may choose a later exact origin and subjects. Retained display bytes
do not prove continuing availability; an unsuccessful reopening remains visible.
All operation, authority, recovery and watch currency remains the complete
current generation. Inspection cannot start, continue, stop or authorize work.

### Closed context-inspection selector union

`delivery.inspect` retains its bounded Control selectors and adds exactly these
nine context selectors under
[`context-inspection-selector.schema.json`](../schemas/context-inspection-selector.schema.json):

<!-- markdownlint-disable MD013 -->

| Selector | Exact subject and selected bound |
| --- | --- |
| `knowledge-index` | one Context basis; opaque continuation or `null`; 1 through 200 records |
| `knowledge-record` | one Runtime-issued exact Knowledge reference under one Context basis |
| `code-index` | one exact Code selection; opaque continuation or `null`; 1 through 200 changed paths |
| `code-file` | one exact Code selection and Runtime-issued changed-path cursor; 4 through 262,144 returned difference bytes |
| `atlas-overview` | one Context basis; independently paged Maps, Points, and Resources; 1 through 200 rows in each collection |
| `atlas-point` | one Runtime-issued Point cursor; 1 through 100 authored records and 1 through 200 relations |
| `atlas-resource` | one exact registered Resource identity under one Context basis |
| `source` | one exact Runtime-issued Source Reference; UTF-8 byte offset; 4 through 262,144 requested bytes |
| `authorization-review` | one eligible `delivery.admit`, `delivery.accept`, or `delivery.no-ship` review under the exact expected generation |

<!-- markdownlint-enable MD013 -->

Every selector is strict and rejects additional fields. Artifact selectors bind their retained Context or Code selection;
Authorization Review binds the complete expected generation. A cursor is
an opaque SHA-256 canonical-value digest over the Context-basis digest,
collection identity, and exact semantic row key. A continuation equals the
last returned cursor, pages preserve the owning model's canonical order, and a
cursor cannot move across an inspection selection, basis, collection, subject, or result
kind. Callers can tighten a selected limit but cannot enlarge it. The runtime
rederives cursor membership and every selected reference from immutable truth;
possession of a digest is not authority or a general lookup capability.

Knowledge index results expose exact record identity, kind, status, revision,
source and semantic digests, path, title, summary, owners, tags, and Boundary
selection. One Knowledge record result exposes its complete kind-specific
public semantics, supersession, relationships, conflicts, source resolutions,
Boundary selection, and one Source Reference for the exact normalized semantic
body. It does not return authoring front matter, pre-normalization source text,
or a reconstructed Markdown rendering. No index or record result exceeds 200
rows in one collection page.

Code index results expose at most 16,384 exact changed paths for the selected
Candidate or sealed decision and page no more than 200 rows at a time. Code file
results bind the immutable canonical side, exact Candidate Revision side,
per-side mode and object disposition, exact complete difference digest, exact
returned-byte digest, and at most 262,144 raw UTF-8 difference bytes. The exact
underlying per-file difference may be at most 268,435,456 bytes. Binary,
oversized, absent, symlink, gitlink, unavailable Carrier, and unsupported rename
conditions remain explicit; the runtime MUST NOT fabricate text, parse hunks as
product truth, or reopen arbitrary Git revisions or caller paths.

Atlas overview results page Maps, Points, and Resources independently with at
most 200 rows per collection. A Point returns at most 100 authored records and
200 relations per page; a Resource returns its exact registration and observed
binding. Text Source References may describe authored Atlas files and resolved
Resources only through the shared 16,777,216-byte Source ceiling. A larger
resolved Resource remains an exact binding with `source: null`, as does a
binary Resource; the 67,108,864-byte Resource-binding ceiling does not enlarge
Source retrieval. Atlas inspection alone may use the selected
strict-JSON result ceilings of 100,663,296 bytes, 16,777,216 UTF-16 code units
per string, depth 64, 33,554,432 nodes, 16,777,216 array items, and 100,000
object properties. Those ceilings do not enlarge another operation, permit
silent truncation, or replace owner-validity rules.

A Source Reference (`lifecycle.source-reference.v2`) is a self-digested,
retained-selection- and Context-basis-bound
description of one exact textual Knowledge body, Atlas body, Atlas Resource,
canonical Git blob, or Candidate blob. It binds owner identity, repository
path, media type, complete content digest, and byte length. A Source result
returns one exact UTF-8 range, its byte offset and digest, and either the next
byte offset or terminal `null`. One Source is at most 16,777,216 bytes and one
returned range is at most 262,144 bytes. Retrieval rederives and compares the
complete reference before reading; a Source Reference is not a filesystem path,
URL, bearer capability, Evidence subject, or authority grant.

Each Source owner uses its owning identity grammar: an exact Knowledge record
ID, Atlas Resource ID, full Git blob object ID, or Candidate Revision ID as
applicable. The repository-relative path rejects absolute, dot-segment, empty,
backslash, query, fragment, and percent-encoded separator aliases; semantic
interface validation additionally enforces Unicode scalar values and the exact
4,096-byte UTF-8 ceiling that structural JSON Schema cannot express directly.

### Delivery Inbox

The Delivery Inbox is a bounded target-scoped aggregate over runtime-custodied
active and archived Delivery Stores. The runtime enumerates only exact Store
identities under its selected custody layout, validates each returned row, and
orders and paginates rows deterministically. A row binds its own Store,
Delivery, Journal head, standing, current subjects, recovery requirement,
physical disposition, and read generation.

Several Store rows do not claim one cross-Store transaction or simultaneous
instant. An unreadable, corrupt, duplicate, or changing member is surfaced as a
bounded typed finding; it is not silently omitted or chosen by recency. Inbox
selection names one exact Delivery. It cannot merge, transfer, resume, or close
another Delivery, and a target locator alone never selects the newest row.

### Selected Delivery View

One selected `lifecycle.delivery-view.v2` Delivery View is compiled under one
read generation. It joins the
Delivery reduction, exact current subjects, latest applicable Attempt View,
Candidate condition, obligation and Evidence standing, Decision Readiness,
eligible operations, recovery, and bounded Control navigation. Typed semantic
sections keep Director-supplied meaning, agent proposals, runtime observations,
runtime-derived conclusions, Evidence, and authenticated authority visibly
distinct. An interface MUST NOT assemble those sections from reads at different
generations.

The selected view can therefore expose `closed` standing and terminal Candidate
condition `accepted`, `abandoned`, or `absent` at the same time as a
`store-disposition` recovery for the missing seal or archive. That recovery
changes eligible operations to `delivery.recover`; it does not reopen or
rewrite the Process reduction.

Decision Readiness is review support inside that joined view. It may show the
exact Boundary, Candidate Revision, Seal, Evidence Packet, eligible authority
operation, complete authority-subject review, and an already authenticated
Director Decision. It MUST NOT infer a Decision, accept generic approval,
request a signature over a summary, or make Evidence equivalent to acceptance.

The view's `work` section exposes the exact retained Work Delegation selection,
its standing direction references and resolved resources, the separately
observed pending stop request, and the fixed policy's current continuation
conclusion. Lifetime charges come from the existing reduction. These values do
not create a second resource ledger or an execution-availability claim. The
pending request is captured once for both the work section and the read
generation token; an interface cannot combine a token that already binds a
stop with a work section that still reports its absence.

Agent Next Pass Investment is null when the installed model/reasoning choices
are missing or malformed. Role and Process eligibility remain disclosed.
Null means the preview is unavailable, not that an Agent needs no resources.
Reading retained work and requesting its Stop MUST NOT depend on resolving
Docker, provider credentials, or the current Execution Image. Actual new
allocation retains its independent complete selection and availability checks.

### Explicit resource controls

The public Runtime Facade operation `delivery.work` is a closed resource-control
surface with `set`, `run` and `stop` actions. It is not a Delivery Process
operation. It requires no authority credential and cannot admit, accept or
close a Delivery.

`set` binds the reviewed Delivery generation and explicitly supplied permitted
operations, original builder/reviewer directions, model/reasoning choices,
lifetime ceilings and optional expiry. Agent operations require exactly their
corresponding direction and choice. Runtime resolves the installed resource
selections and mechanically renders the grant body from that structured input;
it retains each original direction as its exact standing Director Brief. Saving
permission does not run work. A changed generation refuses before retention.

`run` binds the reviewed generation and exact saved grant reference. It invokes
the [fixed useful-work selection](ATTEMPT_VIEW.md#fixed-useful-work-selection)
in the foreground under one Delivery lock. Each existing operation owns its
normal context, finalization and effects. A completed `run` result means that
this foreground invocation reached its disclosed stop boundary; it does not
mean that the Candidate was accepted or the Delivery finished.

`stop` binds the exact grant reference without a Journal-generation
precondition: ongoing work must not make its own Stop perpetually stale. The
Store commits the bounded request independently of the long writer lock. Its
acknowledgment binds the exact reduced state, seal and immutable Journal head
observed in that commit transaction. Later work cannot invalidate that known
acknowledgment. The available Journal writer may fold a settled request; an
unavailable optional fold returns the retained acknowledgment and a bounded
finding. `pending` remains distinct from the observed `stopped` fact. Subsequent
View and watch reads disclose later movement.

Work-control results select `journal-coordinates-only`: their event and Control
lists are empty, and their exact before/after heads disclose the observed
Journal range. `changes.control.advanced` compares those heads. The result
reports a safe-integer completed-operation count, exact last Activity when
observed, selected grant, stop reason and any committed Stop acknowledgment.
The ordinary mutation event-list contract remains unchanged. A finite work
course MUST NOT fail after its effects merely because returning every event
would exceed a bounded presentation envelope.

An unknown transport outcome does not authorize automatic replay of `set` or
`run`. Interfaces retain the uncertain request, continue read-only observation,
and permit exact Stop. A temporarily idle Activity view is not proof that a
lost foreground invocation has returned between reservations.

### Exact Candidate difference

The runtime may derive a bounded Git difference only between the current
Candidate Revision's immutable application base and that exact Revision,
selected by the reducer. A caller cannot supply arbitrary Git revisions,
paths, or command text. The
result binds the Candidate reference, before and after Git identities, full
difference digest, returned-byte digest, byte and path bounds, binary findings,
and any omission or truncation. It is a disposable observation, not Evidence or
semantic progress. The runtime reconstructs the selected Revision only from its
exact retained Carrier. Missing or corrupt Carrier bytes are an integrity or
availability failure and MUST NOT fall back to a predecessor, materialization,
or similar object. Foundation does not retain a second diff artifact as
Candidate truth.

### Durable-generation watch

A watch is a bounded read that accepts one prior read generation, checks current
truth before waiting, waits only for a possible durable change, and then
reopens and revalidates the complete requested view. It returns either a changed
generation and coherent result or an unchanged timeout. File notification is a
wake-up hint, never truth. Implementations recheck around registration and use a
bounded fallback so missed notifications, Store sealing, archive movement,
repository drift, and support-only activity progress cannot create a lost
wakeup.

A watch may target the Inbox generation or one exact Delivery generation. It
does not create a service identity, Store row, support payload, Journal event,
Process stage, or automatic operation. Cancellation leaves no retained
milestone. Director-facing activity labels derive from reducer and owning
Activity facts rather than a persisted support stage; provider messages,
reasoning, authoring transcripts, and private continuation facts remain
undisclosed.

## Inspection and Export

The runtime provides bounded read-only inspection over exact logical records,
revisions, relationships, events, file descriptors, seal, archive manifest,
and reducer-derived dossiers. Read-only opening MUST enable query-only behavior
and perform the same identity and integrity checks as recovery. Inspection does
not create an event or change standing.

A human-readable Markdown export MAY render runtime-owned front matter followed
by the retained semantic Markdown body. A JSON export MAY render typed logical
values. Every export MUST identify its store, Process, record identity, kind,
revision, logical digest, and exact Journal or seal coordinate. It MUST label
itself as a derived inspection representation.

Ordinary inspection exports may vary in wrapping, display ordering, filenames,
and template presentation. Only an explicitly selected named canonical export
profile uses the canonical Lifecycle Document renderer in Processing; no such
profile is selected by the Foundation rc.17 qualification surface.

An export is not:

- an adjacent retained Control record;
- a source of SQL or reducer input;
- an import, backup, migration, or recovery carrier;
- a substitute for the SQLite logical revision;
- a new semantic revision; or
- Product Knowledge or canonical product state.

Changing line wrapping, front-matter presentation, filename, ordering for
display, or export template does not change the retained logical revision. The
runtime MUST NOT calculate the revision digest over exported bytes.

The Director can inspect every non-secret Control fact needed for judgment.
Assigned agents receive only exact projected Control subjects allowed by their
Attempt. Raw operational files require an explicit read capability and remain
subject to their media, size, and disclosure policy. Inspection MUST NOT expose
credentials, authority secret bytes, provider authentication, physical roots,
transaction handles, Execution Handles, allocation keys, Backend coordinates,
Reclamation coordinates, or another Delivery's store.

## Failure Semantics

The Control Store fails closed. At minimum, these conditions are terminal for
the attempted store operation until exact recovery or external repair authority
is available:

- unsupported store, schema, family, repository, runtime, interface, provider,
  application, or physical version;
- wrong store, target, Process, actor, producer, semantic author, authority, or
  edit window;
- malformed or noncanonical semantic Markdown, payload, relationship, time,
  identifier, or digest;
- revision gap, kind reuse, mutation, duplicate conflict, or invalid family
  cardinality;
- event gap, fork, time reversal, changed predecessor, subject mismatch, or
  idempotency conflict;
- SQLite corruption, foreign-key failure, noncanonical stored JSON, disabled
  invariant, or direct external modification;
- missing, foreign, permissive, linked, special, tampered, conflicting, or
  orphan database or file carrier;
- missing, incomplete, corrupt, substituted, or falsely unreferenced Candidate
  Revision Carrier manifest or Git object closure;
- append or file retention after seal;
- stale, substituted, cross-store, malformed, or post-seal operation support;
- an allocated Cell lacking exact Containment, Runtime-owned Retirement, or a
  durable private Reclamation handoff before Activity support disposal;
- Closure, head, logical inventory, seal, database retrieval, file inventory,
  or archive-manifest mismatch;
- hot database at archive time, partial archive, or existing archive
  destination; and
- predecessor or mixed Control discovered in a fresh v22 target.

The runtime MUST NOT repair a failure by accepting the latest row, dropping an
event, regenerating agent or Director semantics, importing an export, scanning
HEAD for similar Markdown, editing SQL, weakening a relationship, recomputing a
different digest, falling back to a predecessor Carrier, redispatching a Cell,
deleting evidence, broadly pruning physical resources, or creating a second
store. Diagnostics
must identify a safe code, stage, and bounded observed facts without exposing
restricted bytes or physical roots.

Recovery is exact and monotonic. It can reproduce an idempotent append, finish
a previously durable file descriptor, reconcile the exact private Cell named
by operation support without redispatch, finish Candidate Carrier publication
before the optional successor append, complete Containment and Retirement,
durably hand Reclamation to its private owner, complete the selected
transaction, create the missing seal for the exact Closure head, or archive the
exact sealed store. When the runtime cannot prove one continuation subject, it
refuses.

## Generic Extension Seam

The Foundation registry is closed to the fourteen Delivery families above. An
extension cannot add an additional Delivery kind, relationship, editor,
authority class, event consequence, table, SQL trigger, or archive member under
an rc.17 coordinate.

A future Process can use the generic concepts of one Process-scoped store,
immutable revisions, typed relationships, an event source, sealing, and
archiving only by defining all of the following under new exact coordinates:

- a distinct Process kind and store profile;
- a closed record-family and relationship registry;
- actor, edit-window, authority, revision, and retention policy;
- event vocabulary and reducer;
- schema, physical limits, seal subject, archive contract, validation, and
  conformance evidence; and
- explicit repository and runtime selection.

Foundation rc.17 defines no future Process, generic arbitrary record API,
dynamic registry loading, extension SQL, or cross-Process relationship. An
unknown Process kind or Control family is refused.

## Non-Goals

The Control Record Store does not:

- place Lifecycle software or Process state in the target repository;
- turn SQLite into Product Knowledge or canonical product state;
- make a Candidate materialization or Carrier object closure a database record;
- expose a Cell, Handle, Backend operation, Retirement, or Reclamation as a
  Delivery workflow or public Control object;
- retain a transcript of model reasoning, edits, commands, or provider events;
- let the Director or agent author SQL, identities, digests, ordering, fixed
  bindings, envelopes, or runtime observations;
- replace exact repository, Candidate, Check, authority, transaction,
  Containment, or Retirement observation;
- make a derived dossier or latest-revision query authoritative;
- support predecessor stores, imported exports, migration, or compatibility;
  or
- define another Process beyond the generic versioned extension seam.
