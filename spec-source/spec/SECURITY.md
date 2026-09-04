# Lifecycle Security

> Status: Draft

## Purpose

This document defines the Lifecycle security model for repository knowledge,
Delivery Control, Process authority, context compilation, agent execution,
evidence, recovery, and canonical transactions.

Lifecycle operates capable probabilistic agents against valuable source code
and product knowledge. Security therefore depends on exact authority, custody,
identity, and effect boundaries, not on an agent consistently obeying prose.

[Authority](AUTHORITY.md) defines who can decide and authenticate product
truth. [Control](CONTROL.md) defines the per-Delivery Control Record Store,
common record lifecycle, event source, sealing, and archive.
[Processing](PROCESSING.md) defines canonical values, digests, parsing, and
reference resolution. [Agent Attempts](ATTEMPTS.md) defines provider-neutral
capability, governed authoring, and observation. [Evidence](EVIDENCE.md) and
[Delivery](DELIVERY.md) define proof and truth transitions.
[Execution](EXECUTION.md) defines immutable Candidate Revision Carriers,
private Execution Backends and Cells, one-time dispatch, containment,
retirement, and asynchronous reclamation.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Security Objectives

A conforming Lifecycle implementation protects these objectives:

1. repository, provider, interface, and Control prose cannot grant Founder or
   runtime authority;
2. an agent cannot expand its Work Boundary, edit window, role, or capability;
3. Candidate work cannot change canonical product truth without the exact
   authenticated terminal transaction;
4. one target, Delivery, store, activity, Attempt, Candidate, authority
   subject, and transaction cannot be confused with another;
5. one Control revision, event, relationship, file, seal, or archive cannot be
   substituted for another;
6. mandatory Knowledge and Projection material cannot be silently removed,
   replaced, or relabeled;
7. provider messages, events, memory, output, and prose cannot become durable
   authority, runtime observation, or Evidence;
8. proof and independent review cannot mutate the exact Candidate they judge;
9. credentials, authority secret bytes, physical roots, process handles,
   recovery handles, and unrestricted SQL remain outside semantic Control;
10. interruption and recovery cannot redispatch or complete a different
    subject;
11. resource exhaustion is bounded and reported without manufacturing a
    complete revision, event, result, or proof;
12. an untrusted package label, manifest field, embedded key, or claim issuer
    cannot manufacture specification publication status;
13. a Journal fork, gap, digest mismatch, direct database mutation, mixed
    generation, or cross-subject reference cannot reduce into apparently valid
    state;
14. no Delivery Control byte can become Product Knowledge, Candidate state, or
    canonical product truth by placement or export; and
15. a Candidate Revision cannot select missing, substituted, incomplete, or
    unpublished Carrier bytes;
16. an Execution Cell cannot acquire Founder authority, canonical Git write
    authority, a Docker control socket, or a Runtime-private target mount;
17. a retained dispatch boundary cannot be replayed through a replacement Cell,
    Handle, Backend, or Provider invocation;
18. activity completion and Closure require proved Containment and
    Runtime-owned Retirement, while Reclamation failure remains bounded,
    private, and truthful rather than manufacturing completion or blocking the
    Process; and
19. security failure preserves the strongest truthful reversible state rather
    than claiming success.

## Trust and Custody Domains

Lifecycle separates at least these domains:

<!-- markdownlint-disable MD013 -->

| Domain | Authority and trust |
| --- | --- |
| Founder authority | Supplies semantics and authenticates selected product and Process transitions. Secret material never enters repository, provider, or semantic Control context. |
| Canonical repository | Retains accepted product, Atlas, and Product Knowledge. Content has only the authority established by its kind and accepted state. |
| Delivery Control Record Store | Retains one Delivery's immutable revisions, exact relationships, Journal events, referenced-file descriptors, and terminal seal. It is off HEAD, noncanonical, and runtime-operated, but its readable non-secret facts are not a lesser or “private” record class. |
| Runtime-custodied support | Holds credentials, locks, checkpoints, opaque Execution Handles, transaction support, result collection, retirement obligations, and bounded recovery facts. It is access-restricted operational custody, not semantic Control or an alternate event source. |
| Candidate Revision Carrier store | Holds immutable content-addressed Git material and canonical Carrier manifests sufficient to reconstruct retained Candidate Revisions. Carrier bytes are physical product-state support, not Control, currentness, lineage, or canonical product truth. |
| Execution Backend | Implements one selected private Backend Profile, allocates and operates Cells from Runtime-issued Specifications and idempotent allocation keys, and returns opaque Handles and Output Carriers. It owns no Process, Candidate, Evidence, or Founder authority. |
| Execution Cell | One disposable physical execution allocation for one Agent Attempt or Check. Its workspace, process tree, and output are provisional and nonauthoritative until Runtime collection and validation. It cannot claim live semantic validity. |
| Lifecycle runtime | Trusted to validate contracts, own SQL, select exact Carrier and execution subjects, consume dispatch authority once, enforce capability and edit windows, observe exact facts, publish Candidate Carriers, bind Evidence, retire Cells, execute canonical transactions, recover, seal, and archive. |
| Lifecycle installation | Supplies the selected immutable specification identity, schemas, runtime, interfaces, compilers, Provider Adapters, Execution Backend Profiles and Images, and exact Atlas processor implementation bound by the Repository Contract and Atlas Resolution. |
| Specification publication authority | Authenticates publication status for one exact Manifest and Release Notes digest through a separately trusted release key. It does not own target Founder decisions or implementation conformance. |
| Candidate | Reversible, noncanonical product proposal state under one admitted Work Boundary. Continuity is the reducer-selected Candidate Revision lineage plus exact available Carriers, not a workspace or Cell. |
| Provider process | Nonauthoritative execution principal inside one exact Attempt Cell and constrained by its Specification, Input Set, Provider Descriptor, Capability Profile, and edit capability. |
| Check process | Good-faith nonauthoritative proof producer inside one exact Check Cell over one immutable materialized subject under one Check Binding. Its Receipt distinguishes runtime enforcement from assumptions. |
| Atlas and external sources | The exact normalized Atlas and bound Resources carry only the context authority their owners establish, remain read-only to Delivery, and cannot raise instruction priority. |
| Interfaces and outer agents | Callers and presentation adapters that may request eligible operations but cannot supply reducer facts, execute SQL, or bypass runtime validation. |
| External systems | Network, daemon, deployment platform, package registry, notification system, billing system, or another effect domain. Denied unless explicitly bound. |

<!-- markdownlint-enable MD013 -->

Physical roots, Engine authority, and credentials for different custody domains
MUST be separated. An implementation MUST reject aliasing, containment,
symlink substitution, shared writable custody, a Runtime-private target mount,
or a Cell-visible Docker control endpoint that would expose a stronger domain
through a weaker one.

The activity checkpoint is physically retained in the Delivery Store's
runtime-writable operation-support table. That deliberate co-location gives
the checkpoint the same exact store and Process binding; it does not make the
row semantic Control, a Journal fact, an export member, or an authority source.
The Founder may inspect the retained value through a bounded runtime operation;
agents, provider adapters, and interfaces including the TUI cannot mutate it.
Runtime SQL ownership and the support row's compare-and-swap contract remain
the edit boundary. Journal facts and checkpoint mutations belonging to one
Process boundary commit in one immediate transaction; a crash cannot leave
either side durably ahead. Exact disposal removes payload bytes, retains only a
bounded retry tombstone, and requires SQLite secure deletion.

`private` is not a Control-record standing, authority class, lifecycle state,
or retention policy. Access is granted by exact capability and custody rules.
The same retained revision can be inspectable by the Founder, projected in
part to an assigned agent, and writable only by the runtime without acquiring
three meanings.

## Threat Model

Lifecycle assumes the founder-dev and deliberately selected agents act in good
faith. It still treats inputs, generated bytes, observations, and support as
potentially mistaken, malformed, stale, compromised, or accidentally unsafe:

- repository Markdown, source comments, generated files, test output, and
  dependency metadata;
- normalized Atlas records, Atlas Check and publication-policy text, Knowledge
  bodies, and linked Resource material;
- Candidate code and build scripts;
- Founder semantic input before authentication;
- provider prompts, messages, hidden memory, events, and final output;
- governed working files and incomplete drafts;
- Check commands, artifacts, and output;
- interface projections and caller-supplied request fields;
- SQLite files, adjacent files, archive manifests, and direct external writes;
- environment variables, current-directory state, and ambient tool config;
- symbolic links, hard links, special files, case aliases, and path races;
- stale runtime or interface processes;
- interrupted provider, admission, acceptance, no-ship, seal, and archive
  operations;
- missing, substituted, corrupt, or partially published Candidate Revision
  Carriers;
- reused allocation keys, repeated dispatch, substituted Execution Handles,
  missing Cells, malformed Output Carriers, and incomplete Output Manifests;
- abandoned Cell processes, unreclaimed backend allocations, or
  runtime-custodied support; and
- excessive but good-faith resource requests or unexpectedly large projects.

This is a correctness and authority model, not an adversarial-insider model.
Ordinary model error and process interruption are sufficient reasons for every
boundary below.

## Authority Security

### Explicit subjects

Every authority statement binds one exact canonical-JSON subject digest,
principal, key, algorithm, purpose, and validity interval. The subject binds
exact logical Control revisions and current Process coordinates. Authority for
one Work Boundary, Candidate, Evidence Packet, Founder Decision, Closure, or
transaction MUST NOT be reused for another.

The runtime MUST construct the authority subject independently from validated
typed values and exact revision references. It MUST NOT ask an agent to
serialize it, accept a caller-restated reducer view, or ask a Founder to sign a
Markdown rendering, interface summary, Journal event, SQLite file digest, or
cached state value in place of those canonical bytes.

A `founder-decision` revision retains the authenticated decision subject and
readable rationale under the family contract. Authentication establishes the
Founder decision; it does not itself prove that admission, acceptance, or
no-ship completed. Only the matching operated transaction observations and
event fold establish that consequence. An admission subject binds its complete
baseline Receipt set with explicit relationship roles; a readmission subject
also distinguishes the active predecessor Boundary from the selected
successor. Recovery reproduces those selections from the signed historical
Journal basis before it may continue the exact transaction.

### Secrets

Founder authority secrets MUST be supplied through an operating-system or
hardware boundary that does not expose their bytes to:

- repository or Candidate files;
- Atlas or Knowledge content;
- Control payloads, semantic Markdown, relationships, events, files, seals, or
  archives;
- governed authoring workspaces;
- provider prompts, packages, messages, or environment variables;
- Check commands or proof subjects;
- logs, diagnostics, status views, exports, or crash reports; or
- public runtime and interface objects.

A command that does not require authority MUST NOT receive authority material.
The runtime SHOULD use purpose-specific signing keys and SHOULD support key
rotation without rewriting historical authenticated subjects.

### Confused-deputy prevention

The runtime MUST resolve the exact target, Repository Contract, Delivery,
Journal head, current Work Boundary, Candidate Revision, authority purpose,
and eligible transition before accepting an authority input.

An interface or outer agent cannot turn a generic statement such as
“continue,” “ship,” or “stop” into an authority-bearing transition unless the
Founder was shown and explicitly selected the exact current subject and choice
required by Delivery. A stale display, omitted revision, inferred disposition,
or matching prose is insufficient.

## Instruction and Semantic Input Security

Repository and external content can contain instructions addressed to an
agent. All Markdown, including Knowledge bodies, Founder input, governed
working values, Agent Work Products, and inspection exports, is untrusted
input. It has only the semantic authority assigned by its exact source and
record family.

Within a Control revision, the typed payload and exact relationships own
identities, bindings, enums, times, digests, operational facts, and referenced
subjects. The normalized semantic Markdown owns readable meaning appropriate
to the family. Markdown cannot override its typed value, create an eligible
operation, authenticate a Founder choice, establish a runtime observation,
change a Candidate, or grant authority. A disagreement is invalid and MUST NOT
be resolved by model judgment or parser precedence.

An Agent Work Product remains `agent-proposed`. The runtime may compile typed
semantic claims from the governed Markdown under the Attempt-selected parser
and compiler, but it cannot relabel those claims as direct observations.
Candidate Revision, Execution Receipt, Check Receipt, Evidence Packet, Founder
Decision, and Closure facts come from their owning runtime or authority
boundaries.

An implementation MUST preserve this priority:

```text
runtime security and capability invariants
-> selected Lifecycle specification and Delivery contract
-> exact Agent Attempt and admitted Work Boundary
-> authenticated Founder direction for the exact subject
-> role-specific Lifecycle guidance
-> compiled project knowledge according to its authority kind
-> repository and external content
-> provider-generated plans, memory, messages, and prose
```

A lower-priority source cannot grant authority to:

- reveal a secret or physical custody root;
- inspect or write a denied subject;
- execute SQL against the Control Record Store;
- use ambient network, credential, or daemon access;
- alter canonical Git state, Product Knowledge, Control, or another Delivery;
- make Candidate changes to repository contracts, Control, or any Atlas path
  eligible for canonical motion;
- waive or replace a Check;
- reinterpret a Knowledge authority owner;
- expand scope, effects, risks, capability, or edit duration;
- accept the provider's own result; or
- suppress a Material Condition.

Prompt text is not the enforcement boundary. Physical custody, capability
materialization, exact revision compilation, direct observation, event replay,
and authenticated transactions enforce the boundary.

Runtime components exchange validated typed values and events. They MUST NOT
use retained or exported Markdown as transient runtime IPC, recover an
operational fact by scraping presentation text, or let a display renderer
become a second parser. Semantic Markdown enters a typed value only through its
selected submission or retention compiler.

## Knowledge and Projection Integrity

### Exact source binding

A Knowledge Set and Projection bind exact source identities, revisions, and
digests from one repository epoch. A provider cannot replace a mandatory item
with a summary, similar file, generated note, current live version, or
similarly named Atlas Point, context record, or Resource.

Source identities MUST be owner-scoped and unambiguous within the selected
Projection. An Atlas Point identity comes only from exact resolved identity,
never title, path, or similarity. A relationship, Atlas Content or Reference
edge, or Description does not transfer the authority of its target. Compilers
preserve authority kind, anchor/context provenance, and owner through selection
and rendering.

An Agent Work Product citation can name only an exact local item already
mounted in the Attempt-bound citation registry. Citation transfers no
authority, widens no read capability, and cannot relabel repository reality as
Knowledge, Candidate state, Evidence, or Work Boundary authority.

### Poisoned context

A validly formatted Knowledge record can still contain false or unsafe
content. Structural validation establishes identity, ownership,
relationships, and completeness; it does not establish factual correctness.

Founder judgment, source authority, Checks, repository reality, and independent
review remain necessary. A Projection MUST include known conflicts,
uncertainty, assumptions, and falsifiers required by its role rather than
presenting one source as uncontested truth.

### Mandatory omission

A compiler MUST fail when mandatory context cannot fit, cannot resolve, has a
digest mismatch, or is structurally ambiguous. Ranking, summarization,
provider context limits, and token cost cannot silently remove it.

The exact Projection inventory proves what was included or omitted. A provider
cannot claim that a mandatory item was absent when the exact bundle proves it
was present, and the runtime cannot claim that omitted bytes were supplied.

## Control Record Store Security

### One exact store

One Delivery has exactly one writable Control Record Store. The database MUST
bind its immutable store, target, Delivery, Process-kind, and creation
identities. Opening it under different expected identities fails.

The active store and sealed archive remain outside repository HEAD, every
Candidate, provider write grant, and Check proof subject. Product State and
Candidate observers MUST exclude those roots. A Candidate that adds, alters,
removes, or depends on Control Store bytes is ineligible for canonical motion.

The runtime MUST reject a second writable store for the same Delivery,
multiple Deliveries in one store, an unknown store selected by filesystem
discovery, or a caller-supplied database path in place of runtime custody.

### Physical carrier

The active store root, `files/`, and `drafts/` MUST be non-symbolic physical
directories owned by the effective runtime user with mode `0700`. The SQLite
database, retained files, and governed semantic files MUST be non-symbolic
regular files owned by that user, have one link, and use mode `0600`.

The runtime MUST reject a missing required entry, unexpected top-level entry,
symlink, hard link, special file, foreign owner, permissive mode, changed file
identity, containment overlap, or path substitution. Validation and use MUST
be race-resistant through pinned handles, descriptor-relative operations, or
an equivalent construction.

SQLite rollback journals, WAL files, shared-memory files, and temporary
artifacts are operational carrier state, never logical Control. Their presence
must obey the selected SQLite profile and blocks sealing or archive when that
profile requires a cold database.

Every Store connection MUST enable SQLite secure deletion. Mutable
operation-support replacement and disposal MUST NOT leave the prior canonical
payload bytes recoverable in reusable database pages. A disposal tombstone may
retain only immutable bindings, the disposed generation and digest, and its
advanced generation; it cannot retain payload bytes or act as live support.

The exact transient pending-file batch, its entries, and deterministic
`drafts/` carriers are likewise runtime-owned operational recovery state. They
MUST NOT enter semantic identity or logical inventory, grant an external writer
SQL authority, or survive store sealing. Integrity verification accepts them
only while they reproduce the one exact bounded file-and-append operation.

### Runtime-only SQL

Only the selected Lifecycle runtime may execute SQL against the Control Record
Store. Founders, agents, Provider Adapters, Checks, interfaces, scripts,
plugins, and external viewers MUST use bounded runtime operations for
authoring, submission, inspection, replay, or export.

The runtime MUST NOT expose arbitrary SQL, accept caller query text as Process
input, attach another database, enable extension loading, execute schema or
trigger text from repository content, or treat an external writer as
conforming. Possession of filesystem access does not grant SQL authority.

Direct SQL modification is corruption even if the resulting row looks valid.
A “current revision” view, row identifier, timestamp, or SQL query result does
not establish Process standing. Only complete validated Journal replay plus
exact referenced revisions establishes standing and eligibility.

### Coordinate-bound read models

Only the runtime enumerates Control Store custody, queries SQLite, resolves
record relationships, resolves exact Candidate Revision Carriers, and
interprets live operation support for the Delivery Inbox, selected Delivery
View, Candidate difference, watch result, or Control inspection. An interface
supplies only a typed bounded selection and prior public read generation. It
cannot submit SQL, filesystem roots, Git revisions, command text, support
payloads, Execution Handles, Backend endpoints, Cell identities, or provider
coordinates.

Every result is bounded, typed, and disclosure-filtered before it crosses the
runtime boundary. A changing or corrupt Store is reported rather than skipped;
a stale generation refuses mutation rather than silently rebasing Founder
input. Watch cancellation and unchanged timeout create no retained fact. Raw
diff bytes, provider messages, authoring transcripts, physical paths,
credentials, authority material, Engine endpoints, Handles, allocation keys,
reclamation coordinates, and transaction continuations remain under their
existing access rules.

### Exact database profile and invariants

The runtime MUST select the exact SQLite application identifier, physical user
version, schema objects, tables, indexes, triggers, and views defined by the
Control profile. It MUST use strict typing, foreign keys, defensive mode,
disabled extension loading, bounded SQL/value limits, and durable
transactions.

Opening, append, recovery, replay, inspection, sealing, and archive verification
MUST check the exact installed schema and every semantic invariant, including:

- immutable store identity;
- rejection of row update and deletion;
- contiguous revision and event sequences;
- record-kind stability and family policy;
- canonical stored JSON and bounded values;
- exact logical revision and event digests;
- exact relationship targets and cardinalities;
- event predecessor, time, actor, payload, and subject rules;
- finalization-event atomicity;
- referenced-file reachability and exact bytes;
- exact pending-file custody and wholly absent-or-complete semantic append;
- absence of unsupported or orphan entries; and
- seal and archive bindings when present.

`quick_check` and foreign-key integrity are necessary but not sufficient. A
database can satisfy SQLite structural checks while violating the closed
Lifecycle schema or semantic registry. The runtime MUST fail rather than
repairing, reindexing, dropping, or recreating an untrusted invariant in place.

### Logical and physical identities

A Control revision logical digest covers its canonical typed value, normalized
semantic Markdown, payload, and ordered exact relationships. An event logical
digest covers its canonical event value and predecessor coordinate. The store
logical-inventory digest covers the exact ordered semantic inventory defined by
Processing.

SQLite page bytes, row order, file modification time, query plan, journal
layout, exported Markdown, and archive filename are not semantic identity. The
SQLite retrieval-byte digest in an archive manifest protects exact retrieval
of that physical database only. It MUST NOT identify a record, event, current
subject, Process standing, Evidence claim, or Delivery result.

The runtime MUST recompute semantic digests from canonical logical values,
never trust stored digest strings alone, and never replace semantic identity
with the SQLite file hash.

### Revision and event integrity

Every finalized revision and its registry-owned finalization event are appended
atomically. A revision without its finalization event, an event naming missing
or different revision bytes, a repeated revision with different content, or a
partial append is invalid.

Every event kind has one closed payload and exact subject policy. An event may
retain only event-owned occurrence and continuation facts. It MUST NOT repeat a
record-owned fact such as Candidate state, Work Boundary semantics, Check
outcome, Evidence readiness, Founder choice, or Closure disposition.

A missing event, sequence gap, changed predecessor, time reversal, fork,
unknown kind, duplicate conflict, cross-Delivery subject, unavailable target,
or logical-digest mismatch fails closed. The runtime MUST NOT choose the newest
row or longest chain, merge branches, skip an unknown event, synthesize a
missing fact, or trust a cache over retained history.

### Governed semantic authoring

Founder and Agent semantics are edited only through the exact family edit
capability and time window. A governed Agent workspace inside the exact Attempt
Cell contains one bounded `semantic.md` file and no other writable semantic
entry. It is outside HEAD, every Candidate Revision Carrier, and the sealed
archive. Its continued physical existence is not Process continuity.

An edit capability binds target, Delivery, family, logical record, prospective
revision, actor, activity, and window. It cannot be transferred, widened, or
used after activity completion, abandonment, authentication, or expiry. A
provider session, terminal message, TUI buffer, repository write grant, or
filesystem access does not create an edit capability.

The runtime opens the file without following links, verifies type, owner, mode,
link count, size, and stable identity, reads at most the exact limit plus one
detection byte, decodes strict UTF-8, and parses the observed value. For an
Agent Work Product it renders one canonical semantic body from the resulting
typed value, then compiles the exact family value. The observed draft digest and
retained canonical body digest are distinct provenance subjects. Intermediate edits,
keystrokes, tool calls, messages, reasoning, and invalid drafts are not Control
revisions or Journal events.

Foundation rc.10 supplies no provider-invoked semantic validator, validator
credential, private callback, or live validity response. The assigned Agent may
inspect and revise only the governed workspace granted by the Attempt. The Cell
runner can materialize and collect that workspace but MUST NOT claim that a
provisional draft is valid.

After Cell Containment, the runtime retrieves the exact Execution Output
Carrier and independently validates the final file through the selected parser
and compiler. A Cell or provider claim cannot substitute for that operation.
Parser or compiler failure is classified only from the exact retrieved final
workspace and cannot be converted into a provider success or repaired from
terminal prose.

Successful submission, abandonment, or terminal failure closes the edit window.
The Runtime MUST prove Cell Containment and record Runtime-owned Retirement
before Activity completion. Recovery may observe, cancel, retrieve, or retire
only the exact retained Execution Handle and MUST NOT redispatch it or adopt a
replacement workspace. A missing, extra-entry, substituted, linked, oversized,
changing, or foreign-owned output workspace is never adopted as a revision.
Physical Reclamation may follow asynchronously under the installation-private
maintenance contract.

### Adjacent referenced files

The adjacent `files/` directory holds only bounded larger operational bytes
whose exact retention is selected by an owning revision or event. Each file is
a regular single-link mode-`0600` carrier named by its exact SHA-256 content
digest. Its descriptor binds digest, byte length, media type, purpose, and
creation time.

An adjacent file MUST NOT be a second Markdown or JSON copy of a revision,
payload, relationship, event, seal, or reduction. It MUST NOT contain Product
Knowledge, Candidate product files, a mutable log, database journal,
credential, authority secret, lock, executable, physical-path manifest,
unbounded transcript, or captured model reasoning.

The runtime may bring new adjacent bytes into custody only with the exact
bounded Control append whose Candidate Revision, Execution Receipt, or Check
Receipt selects them. It first retains one canonical pending manifest, writes
each new file through a deterministic exclusive mode-`0600` temporary carrier
in `drafts/`, synchronizes and atomically renames it to the digest name, rereads
the exact bytes, retains the descriptor, commits the complete ordered append,
and only then clears pending custody. There is no free-standing file-retention
route.

While custody is pending, every ordinary append and different batch refuses.
Only the exact retry may resume, and the semantic append must be wholly absent
or wholly complete. A deterministic append refusal may remove only descriptors
and carriers proven new to that batch; an ambiguous or operational failure
preserves the batch for recovery. Preexisting referenced files are immutable
through both paths. One digest cannot acquire different metadata. Outside
exact pending recovery, missing bytes, mismatched bytes, an unreachable
descriptor, or an undescribed physical file is an integrity failure, not a
discovery or repair opportunity.

### Seal and archive

The runtime may seal only a valid, closed store whose Journal head is the exact
Closure finalization event, whose `drafts/` directory is empty, whose
pending-file custody is absent, and whose operation support has no live row.
The seal transaction removes every verified payload-free disposal tombstone,
leaving no operation-support row in the sealed Store. The seal binds the exact
Closure revision, Journal head, and logical inventory. It is immutable and
prohibits every later revision, event, relationship, descriptor, file append,
or operation-support mutation.

Archive is a distinct recoverable effect after sealing. The runtime closes or
checkpoints writable SQLite connections, proves the database is cold,
synchronizes every carrier, computes the SQLite retrieval-byte digest and file
inventory, writes one exact archive manifest, atomically moves the complete
store to its off-HEAD archive root, and reopens it read-only for full
verification.

A partial copy, merge, conflicting destination, remaining writable source,
changed SQLite bytes, missing referenced file, or manifest mismatch fails. The
runtime MUST NOT promote selected Control records onto HEAD, leave a second
current store, prune individual history while claiming the same seal, or use an
export as recovery input.

## Filesystem and Candidate Security

### Physical containment

Every authorized repository, Candidate Revision Carrier, Candidate
materialization, Execution Input Set, Cell workspace, Output Carrier,
runtime-support, Control Store, and archive root MUST be resolved physically.
Each file open MUST remain within the intended root after resolving every
traversed component.

Structural roots reject symbolic links and unexpected file kinds. An
implementation MUST defend against replacement between validation and use
through file-descriptor-relative operations, pinned directory handles,
immutable Git-object reads, or an equivalent race-resistant construction.

An Execution Cell MUST NOT receive the Runtime-private target checkout,
Candidate Carrier store, Control Store, authority custody, Docker Engine socket,
Backend credential root, another Cell, or reclamation ledger as a writable or
readable mount. Input enters only through the exact immutable Execution Input
Set, and output leaves only through the exact bounded Output Carrier contract.

### Candidate Carrier isolation, publication, and observation

A builder writes broadly only inside its exact disposable Candidate
materialization and separately bound Cell-local tool state. Canonical
repository files and Git references, Product Knowledge, Control Stores and
archives, Lifecycle installation, Founder secrets, other Candidate Carriers,
and other Deliveries remain outside its grants.

Candidate copies of a Repository Contract or Control bytes are nonauthoritative
proposal bytes. Every Candidate change at or below the authoritative Atlas root
is prohibited, including Maps, Points, Resources, Checks, publication profiles,
and nested Atlases. Candidate observation, sealing, review, and the terminal
transaction reject any such change before canonical motion.

A Candidate path, identity, predecessor, state digest, Carrier identity, or
change class is not accepted from provider output. After complete Cell
Containment, the Runtime retrieves one exact Output Carrier, validates its
Manifest and complete Git material independently, and classifies the builder
successor as `promoted`, `not-produced`, `unavailable`, or `invalid`.

For `promoted`, the Runtime MUST construct and verify one immutable,
content-addressed Candidate Revision Carrier sufficient to reproduce the exact
root tree. It MUST durably publish and reopen the complete Carrier before the
atomic Control append selects the successor Candidate Revision. The Carrier
manifest binds format, root tree, complete bounded Git object inventory, byte
and object counts, and exact digests; it does not own Candidate identity,
lineage, currentness, Work Boundary, or Attempt meaning. An unchanged promoted
result MAY reuse the predecessor Carrier under a new logical revision.

For `not-produced`, `unavailable`, or `invalid`, successor identity is null and
no Candidate Revision is appended. The existing reducer-selected Candidate
Revision remains current; that is not rollback, fresh observation, or
predecessor substitution. A complete valid filesystem result may be promoted
even when provider outcome or Agent Work Product validity is unsuccessful, and
a valid Agent Work Product cannot manufacture missing Candidate output.

The Runtime MUST reject missing objects, inventory mismatch, unexpected object
reachability, special or linked files, unsupported modes, repository-contract
failure, Atlas mutation, digest mismatch, mutable Carrier bytes, or a Control
selection made before durable Carrier publication. It records only stable typed
identities, normalized repository-relative facts, sanitized Backend facts, and
exact logical digests. It MUST NOT retain an absolute materialization path,
Engine endpoint, Cell identifier, Execution Handle, allocation key, credential,
or reclamation coordinate in semantic Control.

### Canonical isolation

Only the runtime's selected transaction code can move the canonical branch or
integrate accepted product bytes. Provider and Check processes MUST NOT receive
canonical Git write capability.

Immediately before canonical motion, the runtime MUST verify the exact
canonical parent, Candidate Revision and Carrier, active Work Boundary,
Evidence Packet, Founder Decision, Journal coordinate, and retained transaction
support. It MUST also prove that the Candidate contains no Atlas delta, the
canonical branch still names the exact admitted parent, the authoritative
target checkout is completely clean, and the sealed Candidate tree reproduces
exactly from its Carrier. Any canonical or worktree movement blocks the
compare-and-swap and is conclusively `not-applied` under that authority.
Recovery can only recognize or complete the same exact retained effect; it
cannot select another parent or result.

## Process, Executable, and Environment Security

### Backend, Image, and executable identity

The Runtime MUST select one exact Execution Backend Profile and Execution Image
before allocation. The first production profile is
`lifecycle.execution-backend-profile.docker-local.v1`; it binds one compatible
local Docker Engine relationship, exact Image identity, fixed
`lifecycle.execution-cell-runner.v1` contract, transport, capabilities, and
effective limits. A mutable tag, ambient Engine context, caller-selected daemon,
or similarly named image is not exact identity.

Provider, Git, shell, Node, Check adapter, and other security-relevant
executables inside the Cell are selected by the immutable Execution Image and
Specification. The Runtime independently verifies the Image identity and the
stable public executable provenance required by the Receipt. An ambient alias,
shell function, current-directory executable, package-manager hook, or mutable
PATH entry MUST NOT replace a selected executable after allocation.

The current Agent Image selects exact Codex `0.151.0` under Provider
Descriptor range `>=0.151.0 <0.152.0`. Its operated security boundary keeps
provider authentication in the fixed runner and gives the Agent a
restricted-read tool environment that cannot read that authentication. Codex
0.150.x MUST be refused before dispatch. Any other descriptor-compatible
0.151.x Image requires a new immutable Image and executable identity plus the
same credential-separation, restricted-read, containment, and parent-loss
qualification before production selection.

### Environment

Cell environments are compiled from the Execution Specification, selected
Capability Profile, Backend Profile, and Image. Agent product capability and
provider control-plane connectivity are distinct grants. The Cell runner
constructs a closed bounded environment and rejects Binding names that would
replace exact values it owns, including `PATH`, `HOME`, `TMPDIR`, `LANG`,
`LC_ALL`, and `TZ`. A Binding may intentionally select another permitted entry;
that request is configuration, not an enforcement claim.

Required environment values are exact capability inputs and appear by public
name or digest without disclosing secret values. A Check Receipt states which
conditions were requested, runtime-enforced, or host-assumed.

### Cell dispatch, containment, retirement, and parent loss

The Backend allocates from the exact Execution Specification and idempotent
allocation key. Repeating `allocate` for that pair MUST identify the same Cell
and opaque Handle or fail; it MUST NOT create a second productive allocation.
The Runtime durably consumes dispatch authority before calling `dispatch`.
After that boundary, recovery may call only `observe`, `cancel`, `retrieve`, or
the separately governed reclamation operation; it MUST NOT dispatch the same or
a replacement Cell again.

Every Agent Attempt and every executed Check has timeout, cancellation,
descendant, and parent-loss behavior bound by its exact Specification. The fixed Cell runner
owns the complete process tree inside the Cell. Before a semantic result,
Candidate successor, Receipt, Activity completion, or Closure can be retained,
the Runtime MUST prove Execution Containment: no productive process or writer
remains inside the selected effect boundary.

The Runtime then records Execution Retirement, the durable decision that the
exact Handle will never again be dispatched or productively reused and that
output disposition and Reclamation responsibility are final. Parent loss does
not relax either rule. Missing Backend state after dispatch is a truthful
terminal ambiguity or unavailable result, never evidence of `not-started` and
never authority to redispatch.

Reclamation establishes physical absence and MAY complete asynchronously after
Retirement. It is installation-private, exact-identity-bound, bounded, and
idempotent. It MUST NOT broadly enumerate or prune Docker resources, Carrier
bytes, target paths, or another Delivery. Reclamation failure leaves inert,
observable residue and an exact maintenance obligation; it does not restore
dispatch authority or block an otherwise sufficient Closure.

## Network, Daemon, and External Effects

Agent product network is denied unless the selected Capability Profile grants
an exact policy. The policy identifies protocol, address family, destination
class, DNS and proxy behavior, credential availability, and whether external
mutation is possible.

A provider may require separately selected control-plane network and
authentication to perform the Provider Adapter invocation. That channel is
runtime-supplied execution support, not Agent product capability. It MUST be
limited to the exact provider service and purpose, remain unavailable to
repository commands except through the adapter, and expose no Founder authority
or unrelated credentials. If the Backend cannot separate required provider
control-plane access from the Agent's requested product capability, the Attempt
is `unsupported` before dispatch.

A Foundation local Check Binding's `network` value is a requested host
condition, not necessarily a mediation claim. If the runner cannot enforce the
requested isolation, it records the host condition as unverified or returns
`unsupported`; it cannot claim mediated denial.

`loopback` means loopback-only and excludes ambient proxies, forwarders, or a
local socket that exposes unrestricted host authority unless the profile
declares that mediation.

Foundation rc.10 creates no semantic-validator endpoint or cell-local callback.
A provider receives neither a general listen capability nor the Runtime's
host-socket namespace merely because it operates a governed semantic workspace.

Access to a Docker-compatible daemon is broad host-mediated authority. Only the
trusted Runtime-side Docker Backend may receive the exact selected Engine
endpoint. No Cell may receive that socket or a proxy for it. The Backend Profile
MUST declare Engine identity, API compatibility, Image identity, possible host
exposure, resource policy, sharing, Containment, Retirement, and Reclamation
evidence. A container or filesystem sandbox does not make an unrestricted
daemon isolated.

External mutation, deployment, publication, messaging, spending, and another
irreversible or compensatable effect require a Process and authority boundary
immediately before the effect. Review after an unauthorized effect is not a
security control.

## Build and Dependency Security

Repository toolchains and dependencies can execute arbitrary code under the
builder capability. A profile distinguishes reading metadata, using installed
dependencies, running repository scripts, fetching packages, executing native
tools, and publishing or modifying a registry.

Package fetching requires explicit network policy and produces provenance when
relevant to Evidence. Lockfile presence does not establish dependency
authenticity or safety. Build caches and generated tool state remain reversible
support unless the Work Boundary explicitly requires product artifacts; they
MUST NOT silently enter the Candidate or accepted result.

## Check and Evidence Security

### Exact proof subject

A Check executes against the exact bound Work Boundary baseline or Candidate
Seal. It MUST NOT choose a newer worktree, provider-reported path, unsealed
Candidate, or similarly named revision.

The runtime resolves the exact relationship target, materializes a disposable
proof subject, and binds Check Definition, Binding, environment, toolchain,
modality, and subject. A Check Receipt owns the direct outcome; ordinary
builder commands and Agent claims are not Check Receipts.

### Mutation detection

Proof is nonproductive. The local runner snapshots its disposable subject
before and after execution and treats mutation as `operational-error` even when
the assertion appears to pass. Delivery independently revalidates canonical
repository and transaction subjects before motion.

The local runner does not claim observation of arbitrary host files or external
systems. A proposition requiring such detection needs another qualified
mechanism and is otherwise `unsupported`.

### Untrusted commands and output

A repository-registered command is not authoritative merely because it is
registered. Requested conditions, runtime-enforced conditions, and host
assumptions remain distinct. Output is bounded nonauthoritative bytes and
cannot issue runtime instructions, disclose secrets, alter condition classes,
or establish acceptance.

Large retained Check output uses an exact content-addressed adjacent file.
Check Receipt Markdown and payload MUST NOT embed an unbounded text or base64
copy.

### Independent review and packet compilation

The reviewer receives no Candidate write capability and binds the exact
Candidate Seal, Candidate Revision, active Work Boundary, selected Check
Receipts, and complete proposition set. Provider identity, prior productive
participation, Projection, and subject bindings are checked under the selected
independence profile.

The reviewer Agent Work Product remains agent-proposed judgment. The runtime
compiles the Evidence Packet from exact revisions and deterministic ledgers.
Neither provider prose nor an event payload can assert Evidence readiness. A
changed Candidate or Work Boundary invalidates the old evaluation coordinate.

## Provider Output and Event Security

Provider output and event streams are untrusted and size-bounded. The runtime
MUST parse them with nonexecuting parsers and MUST NOT interpolate them into a
shell, path, SQL statement, schema reference, authority subject, or diagnostic
format without validation and escaping.

Provider terminal text is not the semantic-return contract in Provider Adapter
v6. The assigned Agent edits the exact governed body-only Markdown workspace
inside its Cell while its provider-active window remains open, validates and
corrects the same file when useful, then explicitly submits or abandons it. Only
after Cell Containment does the Runtime retrieve and validate the exact Output
Carrier and Manifest. The Runtime supplies all typed bindings, identities,
references, ordering, digests, serialization, revision mechanics, and event
mechanics.

The parser accepts only the exact role template and local semantic grammar. It
rejects agent-authored front matter, runtime bindings, envelopes, transport
objects, malformed handles, and missing required meaning. Compiler failure
after valid normalized Agent semantics is `runtime-failure`, not Agent failure,
and MUST NOT be repaired by altering the authored semantics.

The Runtime produces no live correction exchange. After Containment, final
semantic validation may retain only the submission diagnostic's code, stage,
and facts digest. It MUST NOT retain a draft excerpt, path, provider message,
credential, capability token, runtime binding, authoring transcript, or
replacement semantic interpretation.

Raw provider bytes and provider events may be retained only when an owning
policy selects bounded operational material through an adjacent-file
descriptor. A Control payload or body MUST NOT contain those bytes, a base64
copy, provider transcript, physical path, credential, process handle, Engine
endpoint, Cell identifier, Execution Handle, allocation key, reclamation
coordinate, or arbitrary provider event object.

Public Attempt Views and Receipts may disclose only stable sanitized execution
facts selected by [Execution](EXECUTION.md): exact Backend Profile, Image,
Specification, Input Set, Output Manifest, terminal-observation, Containment,
and Retirement digests or classifications as applicable. Backend coordinates,
provider-control-plane credentials, private environment values, and physical
locators remain operation support.

Provider events are transient observations, not Journal events. They cannot
establish Process progress, completion, failure, a Work Product field,
Candidate state, Evidence, eligibility, or continuation. The runtime appends a
bounded Journal milestone only when its own exact observation contract is
satisfied. Effect intent precedes the provider effect; effect observation
follows it.

Sensitive material detected in provider events or output SHOULD be redacted
from presentation. Redaction MUST NOT change a canonical logical value; such a
value must never contain the secret in the first place.

## Resource Exhaustion

Implementations enforce the exact limits owned by Control, Processing,
Projection, Agent Attempts, Evidence, and Delivery, including:

- source files, bytes, path depth, and directory entries;
- JSON depth, members, total values, strings, and schema recursion;
- Control records, revisions, relationships, Journal events, and stores;
- semantic Markdown and governed workspace bytes;
- adjacent referenced files, individual bytes, aggregate bytes, and complete
  store-root bytes;
- Knowledge records and relationships;
- Projection items, closure depth, rendered bytes, and citation registries;
- provider package, events, duration, processes, output, tools, and storage;
- Candidate Revision Carrier objects, bytes, manifests, materialization paths,
  publication attempts, and retained references;
- Execution Specifications, Input Sets, Cells, Output Carriers, Output
  Manifests, allocation attempts, retrieval bytes, and retirement or
  reclamation obligations;
- Check output, proof artifacts, and duration;
- diagnostics, interfaces, exports, and inspection results; and
- runtime-custodied recovery support.

Crossing a limit produces no partial finalized revision or event and no
manufactured completeness. Opening, replay, inspection, sealing, and archive
verification enforce the same limits on retained values. A runtime MAY refuse
at a lower disclosed operational limit but cannot claim the qualification
profile unless it supports its required maxima.

Limits SHOULD preserve bounded status, cancellation, Containment, Retirement,
authenticated no-ship, exact recovery, sealing, and exact reclamation tracking
even when productive work cannot continue.

## Concurrency and Locking

One physical target has at most one authority-bearing Lifecycle operation in
the critical section defined by Delivery. Locks bind physical target, canonical
ref, Delivery, activity, and owner process.

The standard local Git implementation uses the exact physical Git common
directory as its operation domain. Linked worktrees sharing that directory
serialize guarded operations even when their repository roots and target
identities differ. Distinct Git common directories own distinct local operation
domains.

A lock file's presence is insufficient. The runtime verifies ownership,
liveness, generation, and staleness under the selected lock protocol. A busy
refusal states that the operation did not start without exposing the physical
common-directory path or recommending deletion of support files.

Separate Deliveries can perform reconnaissance in parallel because each owns a
distinct Control Record Store and no Candidate. Parallelism does not permit
two preparation activities inside one Delivery, cross-store references,
shared edit capabilities, or simultaneous authority-bearing mutation of one
physical target.

Candidate work and read-only observation can overlap only when exact subjects
and isolation make mixed epochs impossible. Interfaces MUST NOT combine facts
from different Journal heads, stores, repository epochs, or Candidate
revisions.

Direct Atlas maintenance can occur only outside Delivery and must not land on a
canonically leased branch. An active Delivery continues to use the exact
historical Atlas snapshot admitted by its Work Boundary; the runtime never
adopts or refreshes a newer Atlas into that Delivery. Continuation, evaluation,
revision, readmission, and acceptance guard the complete canonical commit and
tree plus full authoritative-worktree cleanliness. Any movement is a branch-
lease violation, blocks productive and authority-bearing operations, and is not
a Material Condition. Exact restoration or no-ship is required.

Within one installed Lifecycle machine custody, at most one admitted, unclosed
Delivery may hold the lease for one target and canonical branch. Initial
admission establishes it under the target lock; readmission retains it; accept
or no-ship releases it after Closure and terminal Store disposition. The lease
is an operating rule plus exact movement detector, not a physical lock against
another installation or manual actor. Acceptance is the lease holder's sole
authorized branch move and applies only the exact sealed Candidate tree over
the exact admitted parent.

## Transaction and Recovery Security

An authority-bearing operation uses exact runtime-custodied transaction support
binding every public input required to complete or verify the transition. The
runtime appends one typed effect-intent event before an admission, canonical,
or disposition effect. Only direct post-effect observation can append the
matching observed milestone.

Transaction execution locators, authority secret bytes, process handles, and
physical paths remain outside semantic Control. An exact bounded operation
package whose bytes must survive may be retained as a content-addressed
adjacent file only under the selected purpose and disclosure policy; its digest
does not itself prove effect completion.

An applied initial-admission observation establishes the admitted Boundary as
the governing authority before Candidate initialization finishes. That
recover-only interval MUST expose Candidate condition `absent`, not infer a
Candidate from transaction recovery, and MUST NOT authorize productive work.
For an existing Candidate, a pre-effect recovery obligation MUST NOT falsely
present ordinary `started` or `prepared` work as post-effect terminal recovery;
the exact Activity stage and recovery coordinate remain visible and only
`delivery.recover` remains eligible.
After Closure, Store-seal or archive recovery likewise MUST NOT obscure the
authenticated `accepted`, `abandoned`, or no-Candidate disposition.

Recovery:

- binds the same target, Delivery, activity, authority subject, prepared
  effect, and Journal predecessor;
- finds runtime-custodied support by exact identity, never caller path or
  directory discovery;
- verifies the same repository, Work Boundary, Candidate, Evidence, and
  currentness constraints;
- does not repeat `dispatch`, allocate a replacement Cell, or redispatch a
  provider or Check to manufacture missing support or output;
- does not accept a different Candidate, rationale, or disposition;
- appends only the exact next observation, revision, or event;
- does not bypass a failed security precondition; and
- removes Activity support only after proving the effect or truthful terminal
  failure, collecting or classifying output, proving Containment, and durably
  recording Retirement and handing any exact residual obligation to private
  Reclamation.

Provider effect intent or consumed Cell dispatch without observation is an
unresolved effect boundary, not proof of `not-started`. Admission, acceptance,
or no-ship intent without observation likewise permits only recovery of that
exact transaction. A competing Cell, Handle, allocation key, package, duplicate
disposition, observation without intent, unmatched prepared digest, changed
current subject, or cross-target support is an integrity failure.

Closure is compiled only after the terminal transaction, Candidate disposition,
every productive Cell's Containment, Runtime-owned Retirement, and the truthful
terminal Reclamation handoff are directly observed. Closure MAY bind the
immutable obligation-set digest and whether obligations existed at Closure; it
MUST NOT retain mutable Reclamation progress, private coordinates, or a later
absence claim. Physical Reclamation is not a Closure precondition. The
finalization event is the final Journal head and completes the terminal
activity. Recovery cannot append an `activity-completed` event after Closure or
substitute a later state into the authenticated decision.

Seal and archive recovery are monotonic continuations after Closure. Recovery
may create the missing seal for the exact Closure head or archive the exact
sealed store; it cannot reopen a sealed store, change its inventory, or create
a second archive.

## Installation and Supply-Chain Security

The Repository Contract selects one installed Lifecycle specification and
runtime compatibility set by immutable digest or authenticated release
identity. The runtime verifies installed bytes before operation.

The Atlas processor is part of that verified installation boundary. Atlas
Resolution binds the canonical digest of its exact installed file manifest or
package inventory, not a mutable executable pathname, dependency cache, or
ambient sibling checkout. The processor result remains untrusted until its
shape, exact specification revision, normalized output, and digests are
independently validated by the Lifecycle integration seam. Processor package
resolution, schema loading, inventory, Worker execution, result parsing,
private materialization, Resource binding, and cleanup MUST each apply their
published count, depth, per-item byte, aggregate-byte, and elapsed-time bounds
before trusting or comparing derived identity. Installed-processor inventory
MUST first traverse metadata under bounded entry and depth counts, reject
symbolic or unsupported entries, and establish per-file and aggregate declared
sizes before it opens payload bytes. Repository-local Atlas Resource binding
MUST preflight Resource count and identity uniqueness before Git reads, read
and hash each distinct Git blob object at most once, and apply an aggregate
unique-blob byte bound. The Worker and the independent strict-JSON parser MUST
apply the same explicit processor-result byte maximum.

A bound crossing makes the applicable Atlas stage incomplete or the selected
processor unavailable; it cannot validate a retained subset. Processor
package resolution, schema loading, inventory, Worker execution, result
parsing, private materialization, Resource binding, and cleanup failures cross
the integration seam only as stable Lifecycle error codes with bounded public
facts. Raw caught messages, physical processor or temporary roots, target
paths, Resource bytes, and source bytes MUST NOT enter diagnostics, observed
facts, CLI output, or retained Control.

A candidate publication keeps the inventoried Publication Manifest,
content-addressed Release Notes, and authenticated Publication Statement as
distinct carriers. A verifier reconstructs the Manifest and sidecar digests,
selects the publication principal and public key independently, verifies the
signature over the exact canonical subject, and confirms every coordinate.

An embedded key, self-signed package, Git tag, registry label, HTTPS location,
checksum without a trusted statement, target Founder key, or conformance-claim
issuer is not publication authentication. Signature failure, trust-root
mismatch, coordinate mismatch, or missing immutable source revision fails
closed without changing the last authenticated publication status.

A development checkout, symlinked installation, or local override can be used
only under an explicit development profile that cannot claim released
conformance.

### Foundation rc.10 fresh-project boundary

Foundation rc.10 operates only freshly initialized repositories selecting:

- `lifecycle.foundation.1.0.0-rc.10`;
- `lifecycle.repository.v15`;
- `lifecycle.runtime.foundation.v10`;
- `lifecycle.interface.foundation.v10`;
- `lifecycle.provider-adapter.v6`;
- `lifecycle.control-record-event.v2`;
- `lifecycle.delivery-reduction.v2`;
- `foundation-delivery-control-lifecycle-v4`;
- `lifecycle.candidate-revision-carrier-manifest.v1`;
- `lifecycle.execution-backend-profile.docker-local.v1` as the first production
  Execution Backend Profile;
- `lifecycle.execution-cell-runner.v1`;
- `lifecycle.execution-specification.v1`;
- `lifecycle.execution-input-set.v1`;
- `lifecycle.execution-image.v1`;
- `lifecycle.execution-observation.v1`;
- `lifecycle.execution-output-manifest.v1`; and
- the exact Atlas selection in [Atlas Integration](ATLAS.md), including release
  `0.7.0`, specification revision
  `429fee62966f4d30e91ec2a15d27ecf353f5d68f`, and processor contract revision
  `746cbce73c51b28d617b96ca08f18d498ac749c4`.

`lifecycle.execution-backend-profile.fault-injection.v1` is test-only. Setup
and runtime MUST reject it as a production selection or fallback.

Setup and runtime may inspect only the fixed repository discriminators and
reserved-path presence needed to apply the predecessor and mixed-carrier
refusal defined by [Control](CONTROL.md#foundation-rc10-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).

Repository v15 grants Behavior Knowledge meaning only to tracked content under
the exact `records/behavior` root selected by the contract. The retired
`records/intent` Behavior locator cannot supply Knowledge, acquire authority by
resemblance, or be migrated into current meaning.

They MUST NOT parse predecessor content into rc.10 meaning, launch predecessor
software, migrate a Journal, adopt exported Markdown, copy an authority subject,
or write a partial successor layout. Unsupported and mixed state fail before
authority secrets are accessed, an Agent Attempt is dispatched, or a
transaction is prepared.

Unsupported-generation material has no standing. It is neither a runtime that
may operate nor a source contract that may be adopted. Setup and runtime
recognize fixed discriminators only far enough to return fresh-only refusal.

Fresh initialization is one bounded transaction over initializer-owned
repository discriminators, directories, modes, and runtime custody. An ordinary
failure restores exact pre-invocation state. If restoration cannot be proved,
setup returns typed initialization recovery and does not claim initialization
or create a replacement identity.

## Information Retention and Disclosure

The complete Control Record Store retains the bounded Delivery meaning needed
for Founder judgment, exact replay, recovery, Evidence, Closure, inspection,
and audit. It is not hidden merely because it remains off HEAD. Runtime
inspection exposes every non-secret fact allowed by the caller's exact access
capability.

Runtime-custodied support can contain source material, private Candidate
materializations, governed drafts, raw operational bytes, provider events,
credentials, locks, opaque Handles, environment details, output collection,
Retirement facts, private Reclamation obligations, and recovery state. It MUST
have one exact owner, bounded identity, declared lifetime and size, no Founder
authority secret in provider-visible custody, and parent-loss handling where
applicable.

The governed workspace and Cell-runner collection support are such subjects.
They are not a retained file service, live semantic-validator service, or
second Control carrier. Containment and Retirement, rather than synchronous
workspace deletion, close their productive lifetime. Later Reclamation remains
exactly tracked installation maintenance.

Selected bounded raw provider or Check bytes can remain as adjacent referenced
files and archive with their Delivery. Candidate Revision Carriers remain only
while selected by the exact active, recoverable, Evidence, acceptance, or
declared retention roots in [Execution](EXECUTION.md). Ordinary transcripts,
reasoning, keystrokes, commands, caches, Cells, materializations, and unselected
raw output are support handed to exact asynchronous Reclamation when their
recovery purpose ends.

Closure and the exact complete store inventory are sufficient terminal Control
truth. Any retained Reclamation handoff is the immutable terminal obligation-set
fact, not current maintenance state. After Closure, the runtime empties
`drafts/`, seals the logical inventory, and archives the entire store off HEAD.
No generated Control index, promoted Evidence subtree, terminal-document set,
or duplicate Markdown graph remains on the canonical branch.

An archive retention policy can later retain or remove the complete archive as
one subject. It cannot prune selected revisions, events, relationships, or
files while retaining the original seal or archive identity.

Status, inspection, and interface views expose only the facts required for
judgment and recovery. They omit credentials, authority secrets, physical
roots, process handles, transaction locators, Engine endpoints, Cell and Handle
identities, allocation keys, reclamation coordinates, and another Delivery's
Control.
Derived Attempt Views and Delivery state are reproducible, nonretained
projections. Eligibility shown in a view is descriptive; the runtime revalidates
the exact live subject before every effect.

## Failure Semantics

Security failures fail closed for authority and effects while preserving valid
reversible work when safe. Examples include:

- invalid Agent semantics create no Work Product but do not by themselves
  suppress a complete independently valid Candidate successor;
- missing, incomplete, corrupt, repository-invalid, or Atlas-changing execution
  output creates no successor and leaves the prior Candidate Revision current;
- a Carrier published before an interrupted Control append is a bounded
  collectible orphan, while Control is never permitted to select unpublished or
  unavailable Carrier bytes;
- compiler failure after valid semantics preserves the exact failure and does
  not blame the Agent;
- failed or unsupported Check preserves the sealed Candidate and exact Receipt
  facts;
- capability failure prevents provider start when still before the effect
  boundary;
- canonical branch or authoritative-worktree movement prevents continuation,
  readmission, or acceptance without deleting a Candidate Carrier; no-ship
  remains available;
- failed Containment or Retirement with possible live capability blocks
  Activity completion, while failed Reclamation after Retirement leaves a
  bounded private maintenance obligation without reopening the Activity;
- an invalid signature prevents transition without rewriting Control;
- a revision or event gap, fork, corruption, unknown kind, or impossible order
  prevents standing and eligibility derivation;
- a schema, trigger, view, ownership, mode, or adjacent-file mismatch prevents
  store operation;
- a mixed observation epoch returns incomplete status rather than fabricated
  stable state; and
- archive failure preserves the exact sealed source or reports an unresolved
  move without manufacturing a second archive.

The runtime MUST NOT repair an integrity failure by editing SQL, selecting a
newest row, dropping an event, regenerating Founder or Agent semantics,
importing an export, changing a digest subject, or deleting inconvenient
Evidence. A diagnostic identifies a stable code, stage, and bounded observed
facts without exposing secrets or physical roots.

A security diagnostic MUST distinguish whether product bytes, Control
integrity, Evidence, authority, external effects, custody, or only observation
were affected.

## Security Conformance

A security conformance claim identifies:

- operating systems, filesystems, and SQLite build;
- exact database schema and invariant enforcement;
- process, sandbox, path-race, and ownership mechanisms;
- Candidate Carrier publication, integrity, materialization, reference, and
  reclamation mechanisms;
- Carrier-derived incremental materialization-enumeration bounds that refuse
  physical residue before allocating an unbounded listing;
- Execution Backend Profile, Image, Cell runner, Engine relationship, exact
  allocation, one-time dispatch, retrieval, Containment, Retirement, and
  Reclamation mechanisms;
- credential and authority-secret isolation;
- provider executable and compatibility ranges;
- network and daemon enforcement;
- supported capability and edit-window profiles;
- resource limits;
- cancellation, Containment, Retirement, Reclamation, and parent-loss
  guarantees;
- Candidate and Check isolation;
- transaction and recovery qualification;
- store sealing and archive qualification;
- sanitized execution-fact disclosure and reclamation qualification; and
- known environmental assumptions.

Unit tests alone are insufficient. A release security profile requires operated
qualification of at least:

1. path escape, symlink and hard-link substitution, foreign ownership, and mode
   failures across repository, Candidate Carrier, materialization, Execution
   Input Set, Output Carrier, Store, and archive;
2. Cell attempts to read Founder authority, Runtime custody, another Delivery,
   canonical Git, Control SQL, the Docker Engine socket, or a Runtime-private
   target mount;
3. Candidate attempts to alter Repository Contract, Control, or any path under
   the authoritative Atlas root;
4. direct SQLite update/delete, schema/trigger/view substitution, invalid
   canonical JSON, digest mismatch, revision/event gap, fork, cross-store
   reference, and unknown kind;
5. adjacent-file substitution, orphan, unreachable descriptor, metadata
   conflict, oversize input, pending-custody crash windows, conflicting retry,
   deterministic new-only rollback, and archive inventory mismatch;
6. governed workspace substitution, extra entry, mutation while reading,
   expired capability, invalid template, abandonment, and Output Manifest
   mismatch;
7. Agent product-network escape, provider control-plane separation, Cell Docker
   socket refusal, and truthful unsupported classification when separation
   cannot be enforced;
8. idempotent repeated allocation, direct Cell absence after Handle retention
   both before and after dispatch consumption, refusal to recreate or dispatch
   the absent allocation, dispatch before/after fault injection, repeated
   dispatch refusal, allocation after creation before return, dispatch after
   start before return, timeout, repeated cancellation, Runtime parent loss,
   missing Cell observation, and complete Containment;
9. malformed and oversized provider events, semantic workspace, JSON payload,
   Check output, and complete store;
10. Check mutation of the sealed Candidate and reviewer write attempts;
11. canonical or authoritative-worktree movement during an admitted Delivery,
    proving that every productive, readmission, and acceptance route refuses,
    no newer Atlas is adopted, exact restoration can resume the same Delivery,
    and no-ship remains available;
12. provider Cell, Check Cell, Candidate Carrier publication and selection,
    admission, acceptance, no-ship, seal, and archive interruption with exact
    replay and no duplicate effect;
13. linked-worktree lock contention, independent-Delivery reconnaissance, and
    mixed-epoch interface refusal;
14. Containment and Runtime-owned Retirement before Activity completion and
    Closure, asynchronous exact Reclamation success and failure, bounded inert
    residue, and refusal of broad Docker or filesystem pruning;
15. Closure as final Journal head, sealed-store immutability, and complete
    off-HEAD archive verification; and
16. fresh v15 operation plus refusal of v14/v9/v5 abandoned research, v13/v8/v4
    and other predecessor or unrecognized coordinates, retained Markdown
    Control, predecessor Process refs, predecessor databases, exports, and mixed
    state.

[Conformance](CONFORMANCE.md) defines claim format and release evidence.

## Non-Goals

Lifecycle does not claim to:

- prove repository knowledge factually correct;
- make generated code secure without applicable Assurances and Checks;
- secure an already compromised operating-system account or kernel;
- turn unrestricted daemon access into least privilege;
- replace dependency, secret, vulnerability, or deployment security systems;
- guarantee provider nonretention beyond the selected provider contract;
- make SQLite itself a semantic identity or authority source;
- expose arbitrary SQL or create a public database compatibility contract;
- retain model reasoning, ordinary edit history, command transcripts, or every
  provider event;
- authorize irreversible external effects outside the selected Process; or
- migrate, adopt, import, or continue a predecessor Delivery generation.

These limits do not weaken the exact boundaries Lifecycle owns.
