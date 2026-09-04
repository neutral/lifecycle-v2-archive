# Lifecycle Processing

> Status: Draft

## Purpose

This document defines deterministic processing shared by Lifecycle publication,
Knowledge, repository observation, Projection, typed runtime values, Control
Record revisions, Process events, validation, and conformance fixtures. It owns
requirement language, source precedence, Markdown and JSON parsing, canonical
JSON, digest subjects, ordering, identifiers, repository paths and epochs,
external retrieval, time, extensions, and processing security.

[Control](CONTROL.md) owns the physical SQLite carrier, common Control-record
lifecycle, Delivery family and relationship registry, event source, sealing,
archiving, inspection, and export. [Delivery](DELIVERY.md) owns the meaning of
the event fold and operation eligibility. This document supplies their common
canonical-value and byte-processing rules.

A conforming implementation MUST produce the same normalized value, logical
digest, order, and standard diagnostics from the same exact publication and
input subjects. Filesystem enumeration, locale, database page layout, provider
behavior, interface formatting, and export presentation MUST NOT affect those
results.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14. Lowercase forms are ordinary prose.

## Specification Status

An **Outline** document can omit required behavior. An implementation MUST NOT
claim a class or profile that depends on an Outline.

A **Draft** document defines the current development contract and can change
before acceptance.

An **Accepted** document defines a stable contract for one immutable
specification revision.

A proposal, issue, pull request, example, runtime implementation, historical
record, or database row is non-normative until its decision is incorporated
into every applicable normative document, schema, fixture, and diagnostic in
one publication set.

## Publication Set and Source Precedence

A Lifecycle publication set consists of the normative Markdown documents, JSON
Schemas, fixture manifests and fixture bytes, and diagnostic catalog published
together at one immutable repository revision.

The canonical Lifecycle specification identifier is exactly `lifecycle`. The
Publication Manifest binds that identifier, one specification revision, one
common document-maturity `status`, and the complete byte inventories. Its
`status` is `outline`, `draft`, or `accepted` and MUST equal the declared
maturity of every inventoried normative document. It is not publication
lifecycle status.

Publication lifecycle status is carried only by a separately authenticated
Publication Statement. Release Notes and the Publication Statement are
release-package sidecars, not members of the manifest they name. Release Notes
bind the already-computed Publication Manifest digest. The Publication
Statement binds the already-computed Release Notes and Manifest digests. This
order prevents a manifest, notes, signature, or statement-digest cycle.

The document that owns a processing area has precedence for that area:

- [Authority](AUTHORITY.md) owns authority classes and authentication;
- [Control](CONTROL.md) owns the Control Record Store and record lifecycle;
- [Knowledge](KNOWLEDGE.md) owns Knowledge kinds, fields, physical locators,
  lifecycle, and Description coverage;
- [Relationships](RELATIONSHIPS.md) owns Knowledge edges and closure;
- [Projection](PROJECTION.md) owns role-specific context compilation;
- [Execution](EXECUTION.md) owns private Backend, Cell, immutable execution
  object, Containment, Retirement, and Reclamation contracts;
- [Agent Attempts](ATTEMPTS.md) owns provider-neutral invocation contracts;
- [Delivery](DELIVERY.md) owns Process meaning, state, transitions, and
  terminal dispositions;
- [Evidence](EVIDENCE.md) owns Checks, Receipts, sealing, review, and Evidence;
- this document owns shared parsing, canonicalization, digesting, ordering,
  path identity, and processing security;
- [Validation](VALIDATION.md) owns profiles, standard result semantics,
  diagnostics, and fixtures; and
- [Conformance](CONFORMANCE.md) owns claims and release gates.

Within one area, normative prose has precedence over a JSON Schema. A conflict
is `lifecycle.specification.conflict`, makes the affected profile incomplete,
and MUST NOT be resolved silently in favor of either carrier.

The conceptual [Specification](../SPEC.md) and
[Glossary](../GLOSSARY.md) explain the integrated model. They do not override a
more specific normative requirement.

## Lifecycle Documents

Every normative Markdown file in a publication set MUST be valid UTF-8 without
a byte-order mark or NUL. Publication processing rejects an unpaired surrogate
exposed by an adapter and a file above the selected publication byte limit.
Normative prose is inventoried by exact bytes and is not a Lifecycle Document
merely because it uses Markdown.

A Lifecycle Document is strict UTF-8 Markdown framed by one RFC 8259 JSON
header. The first line is exactly `---`. The next line containing exactly
`---` closes the header. Bytes after that delimiter are the CommonMark body. A
later `---` is ordinary body Markdown and cannot open another header.

The parser MUST reject malformed UTF-8, a byte-order mark, NUL, an unpaired
surrogate exposed by an adapter, and a file beyond the selected profile limit.
The header parser MUST reject:

- duplicate keys, including duplicates hidden by host-object semantics;
- comments or trailing commas;
- more than one JSON value or a non-object top-level value;
- non-finite numbers or integers outside `-(2^53 - 1)` through `2^53 - 1`;
- malformed Unicode;
- trailing non-whitespace bytes in the header region; and
- any value outside the bounded Lifecycle JSON model.

General YAML is not a Lifecycle Document format. JSON avoids implicit dates,
booleans, aliases, duplicate-key variance, and parser-dependent scalar typing.

Repository-authored Knowledge uses `lifecycle.knowledge-record.v1`. It accepts
LF or CRLF, preserves otherwise valid source layout and exact source bytes, and
uses the Knowledge source and semantic digests.

Delivery Control is not retained as a graph of Lifecycle Document files. One
Control Record revision stores typed JSON payload and normalized semantic
Markdown directly in the Control Record Store. Read-only inspection or export
MAY render that revision as a Lifecycle Document, but the rendering is derived
presentation and cannot become runtime input, a second retained authority
carrier, or the revision's logical identity.

Non-Markdown values such as Repository Snapshot, Projection internals, Product
State, Atlas State, Atlas Resolution, normalized Atlas model, Atlas Resource
bindings, validation results, Control revisions and events, store seals, and
archive manifests are strict typed JSON values under their owners. SQLite is
the primary physical Control carrier, not a JSON transport between runtime
functions.

### Header and body authority

A Lifecycle Document header owns values that a validator or processor must
compare as typed data: schema, kind, identity, version, subject and authority
bindings, references, provenance, enums, timestamps, typed dispositions,
normalization results, and body or fragment digests.

The CommonMark body owns explanation, authored claims, rationale, uncertainty,
limitations, and readable presentation. It MAY repeat a header value only when
the profile permits it and the repetition corresponds exactly. A body cannot
override a typed binding, authorize a transition, create a runtime fact, grant
capability, or change eligibility.

The same division applies inside a Control revision: its typed payload and
relationships own operational values, while its semantic Markdown owns
readable meaning. The body cannot override the payload. When runtime logic must
bind one authored passage without taking semantic ownership, the typed value
carries an exact body or fragment digest and provenance rather than a second
prose copy.

The standard provenance classes are `repository-authored`,
`runtime-observed`, `runtime-derived`, `agent-proposed`, `founder-supplied`, and
`founder-authenticated`. Normalization, compilation, storage, or export MUST
NOT relabel one class as another.

### Canonical runtime rendering

Canonical rendering applies only when an owning profile requires a generated
Lifecycle Document or a caller explicitly selects a named canonical Control
export profile. An ordinary human-readable Control inspection is variable
presentation and does not use this canonical byte contract. The renderer:

1. validates the complete normalized header and body value;
2. normalizes body CRLF to LF, rejects every other carriage return, removes all
   terminal LF characters, requires non-whitespace CommonMark, and appends one
   LF;
3. renders the header as two-space-indented JSON with RFC 8785 primitive and
   object-key spelling and already-normalized arrays, followed by one LF;
4. concatenates opening delimiter plus LF, header, closing delimiter plus LF,
   and body; and
5. reparses and revalidates the exact rendered bytes before returning them.

The renderer MUST NOT depend on locale, host insertion order, database row
order, filesystem enumeration, or model formatting. Generated documents use
LF, contain no BOM, and end in one LF.

A generated document MUST NOT contain its own whole-document digest. The
runtime computes that external byte digest after rendering. A Control export
also carries the source Control revision logical digest and exact Journal or
seal coordinate; its rendered byte digest never replaces that source identity.

Agent Work Product canonical body rendering is a distinct selected Control
profile. The Agent edits body-only Markdown rather than a Lifecycle Document.
The parser accepts the harmless layout and ordering variation declared by its
v2 role grammar, emits one normalized typed semantic value, and the runtime
renders the retained body from that value. For two valid drafts with the same
typed meaning, the renderer produces byte-identical section order, metadata
order, local-item order, anchors, token spelling, omitted-empty policy, and
blank-line layout. It then reparses the exact rendered body and requires the
same typed semantic value before Control revision construction.

The editable draft bytes and retained canonical body bytes are different
subjects. The Execution Receipt's semantic-submission digest binds normalized
observed draft bytes. The Agent Work Product body and fragment digests bind
runtime-rendered bytes. Neither digest substitutes for the other, and the
compiler MUST NOT preserve a draft spelling merely because it is valid.

### CommonMark bodies and profiles

Lifecycle Document bodies use CommonMark 0.31.2. A processor derives a heading
label by concatenating parsed textual inline descendants in source order,
decoding character and entity references, treating inline code as text,
retaining image descriptions, and ignoring raw HTML tags while preserving
their parsed textual descendants. It trims leading and trailing Unicode
whitespace and otherwise compares labels exactly and case-sensitively.

Each profile defines its sole required level-one title, required or optional
level-two sections, their accepted and rendered ordering rules, whether other
sections are legal, and every addressable fragment. The level-one title is the
first body line and occurs exactly once. Required level-two sections occur
exactly once. A Knowledge or Lifecycle Document profile can require source
order. Agent Work Product v2 accepts its supported sections in any source order
and the runtime renderer assigns canonical retained order. A lower-level
heading, raw HTML heading, or visually similar Unicode text cannot satisfy a
required section.

Knowledge body profiles are owned by [Knowledge](KNOWLEDGE.md). Controlled
Agent semantic-body profiles are owned by [Agent Attempts](ATTEMPTS.md). The
Control family owner defines semantic-body requirements used before retention;
inspection export MAY add a presentation title and typed header without
changing the stored Markdown.

### Anchors, fragments, and typed references

An addressable fragment begins at an ATX or Setext heading whose parsed label
ends with one ASCII space and `{#<anchor>}`. The displayed label is the trimmed
text before the suffix. An anchor matches
`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`, is case-sensitive, and occurs at most once in
one body.

Fragment bytes begin at the first byte of the anchored heading source line and
end before the next parsed heading of equal or higher level, or at the end of
the normalized body. A fragment digest is SHA-256 over those exact bytes. A
body digest is SHA-256 over the complete normalized body bytes. Knowledge
fragment addressing operates over its LF-normalized semantic body while its
source digest separately binds exact authored bytes.

A Knowledge Document reference has exact kind, stable identity, and external
whole-document digest. A fragment reference adds anchor and fragment digest. A
Control Record reference has exact record kind, identity, positive revision,
and logical revision digest. These reference classes are not interchangeable.
A path, title, excerpt, latest-row query, or export digest cannot substitute
for either.

A processor resolves a Knowledge Document or fragment reference against exact
retained bytes, validates the target kind and identity from its header,
recomputes the complete document and optional fragment digests, and fails on
absence, ambiguity, or mismatch. It resolves a Control Record reference only
against the exact revision in the bound Control Record Store, recomputes that
revision's logical digest, and likewise fails closed. Similar presentation
bytes or a caller-built typed value cannot satisfy either reference.

Identifiers, anchors, path segments, references, JSON keys, and digest strings
are case-sensitive. A processor MUST NOT fold case or Unicode normalization.

## JSON Processing

Every non-Markdown logical Lifecycle value is one RFC 8259 JSON value. It is
valid UTF-8 without BOM or NUL, contains no duplicate keys, uses valid Unicode,
and satisfies the same finite-number and safe-integer bounds as a Lifecycle
Document header.

An implementation rejects trailing non-whitespace bytes and multiple values.
It MUST NOT repair malformed input before validation. Runtime functions MAY
operate on typed in-memory values without serializing and reparsing them except
where an exact retention or external protocol boundary requires validation of
canonical bytes.

## JSON Schema

Lifecycle schemas use JSON Schema Draft 2020-12. A conforming processor MUST:

- register every schema under its stable `$id`;
- resolve all `$ref` values inside one exact publication set;
- support every vocabulary used by that set;
- assert formats where normative prose requires it, including URI references
  and RFC 3339 times;
- reject unknown standard fields where the schema closes the object;
- preserve allowed extension values when rewriting an object; and
- report an unsupported vocabulary or unresolved schema as incomplete, never
  as a pass.

Passing JSON Schema is not complete validation. Currentness, supersession,
relationship compatibility, Knowledge closure, Description coverage,
repository binding, Projection closure, Control relationship resolution,
event reduction, evidence subject identity, transaction safety, Execution
Containment, Runtime Retirement, and Reclamation handoff require semantic
processing.

Every Validation Result identifies the schema processor, dialect,
format-assertion package, and digest of the complete installed schema set. A
repository-bound validator also reports the exact profiles and interpreted
extensions selected by the repository contract.

## Canonical JSON

Canonical-value digests use the JSON Canonicalization Scheme in RFC 8785 over
values already restricted to the Lifecycle JSON model.

Before canonicalization, a processor MUST:

- validate the complete object and every prerequisite semantic constraint;
- remove exactly the fields named by the applicable digest-subject rule;
- preserve arrays whose order is semantic;
- sort arrays declared as sets by their owning key; and
- reject unsupported numbers, malformed Unicode, duplicate identities, and an
  extension that changes standard meaning.

RFC 8785 property ordering and number serialization are authoritative. Locale
collation, source key order, pretty JSON, SQLite row order, or a host language's
unspecified serialization cannot substitute. Canonical bytes contain no BOM or
terminal newline.

## Digests

A standard digest is exactly:

```text
sha256:<64 lowercase hexadecimal digits>
```

A **byte digest** is SHA-256 over exact bytes. A **canonical-value digest** is
SHA-256 over RFC 8785 canonical JSON bytes.

### Lifecycle Document digest subjects

The external document digest is the byte digest of complete exact rendered or
source bytes under the owning profile. Body and fragment digests cover the
exact normalized body ranges defined above. A document never contains its own
external digest.

For Knowledge, `sourceDigest` covers the exact complete source file and
`semanticDigest` follows [Knowledge](KNOWLEDGE.md). A generated Control export
has an external presentation digest only if a caller requests it; the source
revision logical digest remains authoritative.

### Publication release digest subjects

Publication carriers use this acyclic order:

1. compute every inventoried file byte digest;
2. compute `publicationDigest` from the Publication Manifest with only that
   top-level field removed;
3. create Release Notes naming the Manifest digest and compute the notes digest
   with only their top-level digest removed;
4. create the Publication Statement subject naming both digests;
5. compute the subject digest without removing a subject field;
6. sign the exact canonical subject bytes with the selected Ed25519 key; and
7. compute the complete statement digest with only its top-level digest
   removed after signature and authority envelope exist.

The signature verifies over the same subject bytes used for `subjectDigest`.
It never signs a text rendering, statement digest, or reconstructed subset.
A Publication Statement that changes publication lifecycle status names the
exact preceding statement through `previousStatementDigest`. A later statement
does not rewrite the earlier Manifest, Release Notes, or Statement.

### Knowledge digest subjects

For one Knowledge file, `sourceDigest` covers complete exact UTF-8 source bytes,
including delimiters and original line endings. `semanticDigest` is the
canonical-value digest of exactly:

```json
{
  "body": "<body bytes after the closing delimiter, with CRLF normalized to LF>",
  "frontMatter": { "<complete validated header object>": "..." }
}
```

The body preserves every other code point and terminal newline. The subject
excludes source-layout-only differences but includes every header field and
body byte that can change meaning, authority, relationships, status, or body
interpretation. [Knowledge](KNOWLEDGE.md) owns the same subject.

Knowledge Set, relationship, Projection, Repository Snapshot, Product State,
and Atlas digest fields use their exact owning schema subjects. In particular,
`atlasStateDigest`, `atlasResolutionDigest`, `atlasNormalizedModelDigest`, and
`atlasResourceBindingsDigest` are four distinct subjects; no one field can
attest to bytes or values owned by another.

### Control logical digest subjects

A Control Record revision logical digest covers canonical JSON containing its
schema, Process identity, record identity and kind, revision, producer,
semantic author, semantic authority, creation time, normalized semantic
Markdown, complete typed payload, and ordered relationships. It omits only the
logical digest being calculated.

A Control event logical digest covers canonical JSON containing its schema,
store and Process identities, sequence, event identity and kind, occurrence
time, actor, nullable exact record-revision subject, typed payload, and nullable
predecessor-event digest. It omits only the event digest being calculated.

The Control logical-inventory digest covers the canonical JSON bytes of exactly:

```json
{
  "schema": "lifecycle.control-record-store-logical-inventory.v1",
  "store": {
    "schema": "lifecycle.control-record-store.v1",
    "storeId": "<store identity>",
    "targetId": "<target identity>",
    "processKind": "delivery",
    "processId": "<Delivery identity>",
    "createdAt": "<store creation time>"
  },
  "events": [
    {
      "sequence": 1,
      "eventId": "<event identity>",
      "eventKind": "<event kind>",
      "digest": "sha256:<event logical digest>"
    }
  ],
  "revisions": [
    {
      "recordId": "<record identity>",
      "recordKind": "<record kind>",
      "revision": 1,
      "digest": "sha256:<revision logical digest>"
    }
  ],
  "files": [
    {
      "digest": "sha256:<exact file digest>",
      "byteLength": 0,
      "mediaType": "<media type>",
      "purpose": "<retention purpose>"
    }
  ]
}
```

Events are ordered by sequence. Revisions are ordered by record identity then
revision. Files are ordered by digest. Each ordering key is unique. The file
entry is the exact inventory projection shown above; descriptor schema and
creation time do not enter this digest. Live operation support, its payload-free
disposal tombstones, and pending file custody do not enter this subject at all.
The store seal binds the resulting value. [Control](CONTROL.md) owns sealing.

The SQLite file byte digest is archive retrieval integrity only. It does not
identify a revision, event, standing, Delivery result, or logical inventory.
Each adjacent content-addressed file uses a byte digest over its exact original
bytes before media decoding or normalization.

### Self-digesting JSON carriers

Where an owning schema defines a top-level self-digest, its subject is the
complete validated logical object with only that exact top-level field removed.
Nested digests, signatures, and referenced identities remain. A processor MUST
NOT recursively remove same-named fields, blank values, hash pretty JSON, or
include the digest being calculated.

## Ordering

Arrays are ordered only in one of three ways:

- semantic sequences preserve their declared order;
- closed enum sequences use the owning explicit order; or
- set-like arrays use ascending Unicode scalar-value order over their declared
  complete key.

Object key order has no semantic meaning and follows RFC 8785 only for
canonical bytes. Filesystem, SQL, Git enumeration, map insertion, provider
output, and caller order MUST NOT choose a set order.

Standard set keys include:

- Knowledge records, sources, obligations, artifacts, propositions, and other
  identity-bearing sets: exact identity;
- relationships: source identity, relationship type, target identity;
- Control relationships: relation, target kind, target identity, target
  revision, target digest;
- Control logical inventory: the keys fixed by [Control](CONTROL.md);
- repository and Candidate entries: normalized path;
- diagnostics: locator, position, code, message, and canonical facts under the
  Validation profile; and
- Receipts: phase order, Check identity, Binding identity, Receipt identity.

Relationship paths, transaction steps, event chains, revision histories, and
other declared sequences retain semantic order and MUST NOT be sorted.

Two members with the same complete set-ordering key are invalid. Input order
cannot break a tie. Unicode scalar-value order is not locale collation or a
host language's UTF-16 code-unit order. RFC 8785 retains its own object-key
ordering rule.

## Control Event Processing

The `journal_events` relation in one Control Record Store is the sole retained
Delivery event source. It is not a Markdown journal, Git ref, transcript,
checkpoint file, or thirteenth Control record family.

The first event has sequence `1` and null predecessor. Each later event is the
prior sequence plus one and binds the exact prior event logical digest. All
events bind one store and Process. Event identities are unique and occurrence
time cannot move backwards. A gap, fork, duplicate sequence, changed subject,
unavailable revision, kind mismatch, or digest mismatch is corruption; replay
fails instead of selecting a branch or inferring a milestone.

An event can atomically finalize one new revision, refer to an existing exact
revision, or have no record subject. A finalization event and revision are one
SQLite transaction. The revision owns its complete typed fact and semantic
Markdown. The event owns only the closed occurrence, Process consequence, and
continuation fields declared for its kind. It MUST NOT duplicate any
record-owned decision, readiness, outcome, subject binding, relationship, or
other typed fact, whether alone or as a nearly complete payload. The reducer
loads those facts only from the exact referenced revision.

The pure Delivery reducer consumes the complete validated event chain and
resolves every event subject against the exact immutable Control revision in
the same store. It derives standing, active activities, recovery obligations,
Candidate condition, current subjects, and eligible operations. It MUST NOT
accept a caller-built state snapshot, latest-row status, exported Markdown, or
detached equivalent reduction as Process truth.

That reducer is the sole legal Process state machine. The common
[Activity kernel](CONTROL.md#common-activity-kernel) validates every durable
activity boundary against its exact reduction and registered recovery
coordinate. An operation-support checkpoint, operation-definition plan,
adapter phase, cached projection, or persisted workflow-stage DSL MUST NOT
select, supplement, or override legal event order.

An effect intent becomes durable before an external provider or canonical
transaction effect. Until a truthful determinate observation exists, replay
derives only recovery of that exact effect. Recovery can append the missing
observation or deterministic finalization boundary, but cannot resample the
effect identity, redispatch completed work, regenerate authored semantics,
infer absence as failure, or create a replacement activity.

Working-document edits, commands, test output, provider event streams, model
messages, reasoning, parser microsteps, SQL statements, and export rendering
are not Process events. The compact event vocabulary and legal order are owned
by [Delivery](DELIVERY.md); common append, digest, integrity, sealing, and
archive rules are owned by [Control](CONTROL.md).

## Identifiers

Stable identities are independent of physical paths and presentation. A path
move does not change a Knowledge identity. A database row identifier does not
change a Control record identity. A processor compares identifiers by exact
Unicode scalar-value sequence and never uses case folding, normalization
folding, basename matching, display title, or latest revision as a substitute.

Opaque runtime identities are correlation values, not authorization. Each
owning record defines uniqueness scope.

## Repository Paths

A normalized repository-relative path:

- uses `/` separators;
- is non-empty and does not begin with `/`;
- contains no NUL, backslash, empty segment, `.`, or `..` segment;
- contains no URI query or fragment syntax;
- preserves exact Unicode and case;
- stays within the selected path-byte limit; and
- identifies one path in the bound Git tree or Candidate where required.

Encoded separators and percent-encoded repository paths are invalid. URI
references and repository paths are different types.

A physical adapter resolves links before containment. Knowledge, governed
implementation, Product State, Candidate product paths, authoritative Atlas,
Control Store files, and governed authoring workspaces MUST satisfy their exact
owners' regular-file and containment policies. No symlink, Gitlink, submodule,
special file, or path alias can acquire authority by visibility.

On a case-insensitive or normalization-insensitive filesystem, a processor
verifies exact tree and path identity. Folded-only access is invalid.

## Git and Repository Epochs

A complete repository observation binds one exact commit, tree, object format,
repository contract, Product State, Knowledge Set, and the Atlas identities
`atlasStateDigest`, `atlasResolutionDigest`,
`atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`.

A processor distinguishes:

- canonical tracked source at the bound commit;
- Candidate source derived from its immutable base;
- runtime-custodied Control and operational support outside Product State;
- untracked or ignored live-worktree material; and
- authorized external source.

Only the applicable bound class can satisfy a normative source requirement.
Live visibility does not make a file authoritative. Control Store roots and
archives are excluded from HEAD, Product State, Candidate observation, and
canonical transaction inputs.

Facts from different repository epochs remain explicitly mixed or fail with
`lifecycle.repository.epoch-mixed`. They cannot be presented as one coherent
stronger observation. Git object identifiers use the repository's configured
object format exactly.

## Product State

The repository contract declares Product State roots and exclusions. Product
State includes governed Knowledge, bound Atlas inputs, governed implementation,
the repository contract, and other declared product sources. Delivery Control,
the Control Record Store, archives, and runtime operational support are
excluded.

A Product State conforms to
[`product-state.schema.json`](../schemas/product-state.schema.json). Entries use
ascending normalized-path scalar-value order and contain exact path, Git mode,
object identity, and role. The digest covers the ordered entries array, not the
carrier object.

When declared roots overlap, roles use this precedence:
`repository-contract`, `atlas`, `knowledge`, `governed-implementation`, then
`declared-product`. Every authoritative path occurs exactly once. A producer
MUST NOT emit two roles for one path or let filesystem enumeration choose the
winning role.

Repository contract, Atlas, and Knowledge entries are non-executable regular
blobs. Governed implementation and declared product blobs may use only the
allowed regular-file modes. Symlinks, Gitlinks, submodules, case aliases,
untracked authority, ignored authority, and a Candidate containing Control
Store material are invalid.

An extension cannot remove a standard Product State source from exact identity
and validation. The owning Process defines how path partitions participate in
operation conservation. Delivery treats the admitted Atlas partition as
historical context, prohibits every Candidate Atlas delta, and uses one full-
tree branch lease. Acceptance applies the exact sealed Candidate tree over the
exact admitted parent; Atlas has no separate terminal preservation rule.

## Atlas State

Atlas State conforms to
[`atlas-state.schema.json`](../schemas/atlas-state.schema.json). It contains
every tracked path under the repository-contract Atlas root as ordered exact
path, mode, and object-identity entries. Each entry is a non-executable blob,
the fixed entrypoint exists, and the entries equal the Atlas projection of
Product State. Its digest covers the ordered entries array.

Atlas State binds Git bytes only. It does not parse Atlas meaning, establish
format validity, evaluate Atlas Checks, or transfer Atlas ownership.

## Atlas Resolution

Atlas Resolution conforms to
[`atlas-resolution.schema.json`](../schemas/atlas-resolution.schema.json) and
the complete contract in [Atlas Integration](ATLAS.md). Its digest subject
contains the exact selected Atlas coordinates, Atlas State digest, processor
implementation identity and exact installed file-manifest digest, ordered
repository-local Resource bindings and their aggregate digest, external Atlas
Validation Result digest, normalized-model digest or null, and complete and
valid states.

Every downstream Lifecycle repository-basis carrier exposes the aggregate
Resource-binding identity as `atlasResourceBindingsDigest`. That field MUST
equal the selected Atlas Resolution's `resourceBindingsDigest`; embedding the
aggregate inside the Resolution does not remove the direct binding.

The selected processor reads the exact Atlas State blobs from the materialized
bound tree. It applies the exact resolved Atlas profile and immutable
specification revision selected by the Repository Contract. A complete valid
external result supplies one schema-valid normalized model. Lifecycle then
binds every registered repository-local Resource object from the same bound
tree. Every invalid, incomplete, unsupported, or mismatched result supplies no
normalized model or Resource-binding aggregate to Lifecycle.

Lifecycle's repository processor binds the exact external result and
normalized value; it does not copy Atlas semantic fields into a second
Lifecycle model. Atlas Checks remain external authoring policy and are not run
as Lifecycle Check Definitions or Receipts.

## Repository Snapshot

A Repository Snapshot conforms to
[`repository-snapshot.schema.json`](../schemas/repository-snapshot.schema.json)
and composes one exact observation epoch. Its digest subject contains target
identity, commit, tree, object format, repository-contract digest, Product
State digest, Knowledge Set digest, and the four direct Atlas fields
`atlasStateDigest`, `atlasResolutionDigest`,
`atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`.

The processor loads contract, Product State, Atlas State, authorized Atlas
Resource bytes, and Knowledge bytes from one bound tree, resolves Atlas and
validates Knowledge against that basis, and only then binds the Atlas
Resolution, normalized Atlas model, exact Resource-bindings aggregate, and
Knowledge Set into the final Snapshot. It rereads the attached canonical ref
after repository observation and again immediately before final Snapshot
binding. Ref movement at either boundary or a basis mismatch fails rather than
combining epochs.

After a Work Boundary admits that Snapshot, execution processors reopen the
same commit and tree as historical Git objects. Before each active operation,
the epoch-coherence guard also requires the canonical branch to name that exact
commit and tree and the authoritative target checkout to be completely clean.
A later repository or Atlas snapshot is a distinct coherent epoch and can
participate only in a fresh Delivery after Closure; it cannot be mixed into an
active Execution Projection, Check, Evidence observation, readmission, or
terminal transaction.

## External References and Retrieval

A URI reference is syntax, not authority. Structural validation can classify a
reference without retrieving it.

External-local and network retrieval are denied by default. Retrieval requires
both explicit caller read authority and an enabled profile that states allowed
schemes, roots or hosts, redirects, DNS and proxy policy, timeouts and byte
limits, media and decompression limits, credentials, cache and freshness, and
immutable revision or digest requirements.

Retrieved bytes remain untrusted information. They cannot grant tools, change
instruction priority or a Work Boundary, waive proof, or authorize an effect.

Every source declaration states requiredness. Resolution emits the declaration,
exact facts when available, and one disposition: `resolved`,
`retrieval-denied`, `missing`, `unreadable`, `digest-mismatch`,
`revision-mismatch`, or `role-mismatch`. Requiredness is never inferred.

An unresolved required current source is
`lifecycle.knowledge.source-unresolved`, makes source processing incomplete,
and cannot be replaced by provider memory, a search snippet, or a live unbound
file. Optional or historical absence remains an explicit warning disposition
in the Knowledge Set manifest.

## Time

Standard times are RFC 3339 UTC ending in `Z` with at least whole-second
precision. One logical profile uses consistent fractional precision.

Time records observation, authentication, expiry, and retention. It cannot
establish Knowledge currentness, resolve an authority conflict, order events
whose sequence disagrees, rank sources, or prove progress.

## Extensions

An extension property begins with `x-`, then uses lowercase ASCII letters,
digits, and hyphens, beginning and ending with a letter or digit.

An extension MUST NOT change a standard field, remove validation, grant
authority or capability, change mandatory Projection membership, weaken an
Evidence subject, add a Delivery Control family or SQL behavior, or make an
incompatible Process transition appear compatible.

A processor that rewrites a value preserves unknown allowed extensions and
their exact JSON-compatible values. An interpreting implementation discloses
each extension in its conformance claim. Interoperable behavior changes require
a new standard coordinate rather than a hidden extension.

The Foundation repository and Control profiles select no interpreted
extensions.

## Processing Security

Repository content, Knowledge bodies, Atlas, external resources, governed
working documents, agent semantics, provider observations, Check output,
adjacent files, exports, database bytes, and fixtures are untrusted inputs.

They MUST NOT:

- raise instruction priority;
- grant filesystem, network, credential, tool, daemon, SQL, or external-effect
  capability;
- request or receive Founder secret bytes;
- authorize a canonical transition;
- change the active Work Boundary or Projection;
- waive an obligation, Check, or proposition;
- convert Agent prose into a runtime fact; or
- cause code execution outside an exact Check Binding or Attempt capability.

The controlled-semantic parser reads only the exact governed body-only Markdown
under the Attempt-selected template. It rejects front matter, transport
wrappers, authored mechanics, unresolved handles, and invalid role semantics.
The Agent Work Product compiler can retain only parsed semantic values; it
supplies fixed bindings, identities, references, canonical semantic rendering,
order, digests, record envelope, and event from runtime-owned inputs.

Foundation rc.10 exposes no invocation-local semantic-validation request,
callback, endpoint, or response to the provider or Execution Cell. Final
Control compilation parses and validates only the exact runtime-observed
semantic output after provider Containment; provisional output and provider
prose cannot establish validity.

An invalid submission creates no Agent Work Product. Bounded provider output or
the raw working-file observation MAY be retained only as an explicitly typed
adjacent file or Receipt fact under policy. A compiler failure after valid
parsed semantics is a runtime invariant failure, not Agent nonconformance.

Parsers and validators publish bounds for bytes, object depth, arrays, graph
size, relationship depth, paths, diagnostics, retrieval, decompression,
provider output, SQL values, adjacent files, and processing time. Exceeding a
required bound returns a standard error or incomplete result; mandatory
authority, Evidence, or diagnostics cannot be silently truncated into a pass.

The repository contract owns Knowledge and repository limits. The Control and
Execution profiles own revision, event, relationship, authoring, Carrier,
Input Set, Output Carrier, adjacent-file, and archive limits. Processors check
count and byte bounds before unbounded work and report only bounded observed
facts without exposing credentials, authority secrets, transaction or
Execution Handles, allocation keys, provider authentication, or physical
runtime roots.
