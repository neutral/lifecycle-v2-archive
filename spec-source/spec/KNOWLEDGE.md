# Lifecycle Knowledge

> Status: Draft

## Purpose

This document defines Lifecycle's governed Knowledge records, their physical
form, stable identity, lifecycle, source binding, kind-specific semantics,
implementation coverage, and Knowledge Set construction.

The format creates a small machine-readable semantic waist around detailed
human- and agent-readable material. It does not attempt to encode every product
or architecture judgment as a rigid ontology.

## Governed Kinds

Lifecycle format version 1 defines five Knowledge record kinds:

- `behavior` — functional product outcomes and externally observable behavior;
- `assurance` — non-functional obligations, invariants, failure limits, and
  operating qualities;
- `blueprint` — structural decisions, boundaries, dependencies, and data flow;
- `description` — code-adjacent implementation responsibility and rationale;
- `check` — falsifiable validation propositions and required evidence shapes.

Behavior and Assurance are separate first-class Knowledge kinds with their own
fixed repository roots. Neither is classified beneath an Intent record kind or
parent authority surface. The word "intent" remains ordinary language for
purpose, direction, or a planned effect; it is not a standard Knowledge kind.
Atlas is the mandatory external read-only context system selected by
[Atlas Integration](ATLAS.md) and is not a Lifecycle Knowledge record.
Implementation artifacts and Check Bindings are repository reality and
configuration, not Knowledge records.

## Repository Locations

A target repository stores current and historical Knowledge records at these
locators:

```text
records/behavior/**/*.md       Behavior
records/assurance/**/*.md      Assurance
records/blueprint/**/*.md      Blueprint
records/checks/**/*.md         Check Definition
**/_*.desc.md                  Description
```

The repository contract declares the implementation roots whose source artifacts
require Description coverage and any exact exclusions. A path under
`.git/`, `.lifecycle/`, `records/control/`, or the authoritative Atlas root
MUST NOT be an implementation coverage target.

A record kind MUST match its physical locator. A processor MUST NOT accept a
Behavior under `records/assurance`, a generic document relabeled as a
Description, or any Atlas Check as a Lifecycle Check Definition. Atlas Checks
and Lifecycle Check Definitions are different systems, and the complete Atlas
root is outside governed Knowledge and Delivery writes.

Moving a record does not change its stable identity. All references to its
locator MUST be updated in the same governed change.

## Text and Front Matter

A Knowledge record is a Lifecycle Document using the repository-authored
Knowledge profile and `lifecycle.knowledge-record.v1` semantics. It is UTF-8
Markdown without a byte-order mark. It MUST begin on its first line with `---`,
contain one RFC 8259 JSON object, close with another line containing exactly
`---`, and contain a nonempty Markdown body after the closing delimiter. The
shared parsing and framing contract is defined by
[Processing](PROCESSING.md#lifecycle-documents).

The front matter uses standard JSON rather than general YAML. A processor MUST
reject duplicate keys, comments, trailing commas, non-finite numbers, unpaired
surrogates, a non-object top-level value, and more than one front-matter
object.

The parsed header MUST conform to
[`knowledge-record.schema.json`](../schemas/knowledge-record.schema.json).
Unknown standard fields are invalid. Extension fields MUST begin with `x-` and
MUST NOT change standard meaning.

The body uses CommonMark 0.31.2. The structured JSON header owns stable
identity, currentness, relationships, concise obligations, and coverage. The
body owns detailed rationale, examples, tradeoffs, failure analysis, diagrams,
and other prose. A body cannot override its header or another record's
authority.

Knowledge is repository-authored source, not runtime-generated Control. Its
source profile accepts LF or CRLF, preserves the author's otherwise valid JSON
layout and body bytes, and does not require the Control inspection/export
renderer. Routing Knowledge through the shared parser therefore does not make
Knowledge into Control, convert Control into Knowledge, or replace the
Knowledge `sourceDigest` and `semanticDigest` rules.

A processor computes:

- `sourceDigest` as the external whole-document SHA-256 over the exact UTF-8
  file bytes; and
- `semanticDigest` as SHA-256 over canonical JSON with exactly the keys `body`
  and `frontMatter`, where `frontMatter` is the complete validated header
  object and `body` begins after the closing delimiter line ending, normalizes
  CRLF to LF, and preserves every other code point and terminal newline.

Both digests use the lowercase form `sha256:<64 hexadecimal digits>`.
`sourceDigest` preserves byte identity. `semanticDigest` allows line-ending
independent semantic comparison. A Projection binds both.

## Universal Record Fields

Every record contains:

- `schema`, exactly `lifecycle.knowledge-record.v1`;
- `kind`, one governed kind;
- `id`, one stable identity;
- `title`, one concise human-readable name;
- `status`, one lifecycle state;
- `revision`, a positive integer;
- `supersedes`, null or the exact prior revision identity;
- `summary`, a concise statement of the record's governed meaning;
- `owners`, one or more repository-defined owner identifiers;
- `sources`, zero or more provenance references;
- `relationships`, typed edges to other Knowledge identities;
- `conflicts`, zero or more exact reciprocal conflict declarations;
- `tags`, zero or more non-authoritative retrieval labels; and
- `spec`, the kind-specific structured value.

### Identifiers

A record identifier has this form:

```text
<kind>.<scope-segment>[.<scope-segment>...].<name-segment>
```

Segments contain lowercase ASCII letters, digits, and hyphens, begin and end
with a letter or digit, and contain no consecutive hyphens. The complete
identifier is at most 160 bytes.

The first segment MUST equal the record kind. Examples:

```text
behavior.parser.accept-valid-json
assurance.parser.bounded-resource-use
blueprint.parser.boundary
check.parser.fuzz-arbitrary-bytes
description.parser-core
```

An identifier is stable across path moves and wording changes. A materially new
owner or proposition receives a new identifier rather than reusing an unrelated
historical identity.

### Status

`status` is one of:

- `draft` — proposed Knowledge that does not govern Delivery;
- `current` — the current owner of its identified meaning;
- `superseded` — replaced by a later revision or identity;
- `retired` — intentionally no longer applicable without a replacement.

Omission is invalid. A consumer MUST NOT infer `current` from repository
location, recency, branch name, or absence of a replacement link.

A Work Boundary can select only `current` records. Historical records remain
addressable for traceability and reconstruction.

### Revision and supersession

Revisions are positive integers scoped to one stable identifier. Revision 1 has
`supersedes: null`. A later revision MUST identify the prior current revision by
record identifier, revision number, source digest, and semantic digest.

The prior revision becomes `superseded` in the same canonical change that makes
the replacement `current`. A processor MUST reject:

- two current revisions of one identifier;
- a revision gap;
- a supersession cycle;
- a replacement that names another record kind;
- a prior digest mismatch; or
- a superseded record whose declared replacement is absent from the same
  repository history available to the validator.

Changing only a path still requires a new revision when the record bytes change.
A pure Git rename preserving exact bytes preserves the record revision and
digests.

### Owners

`owners` identifies repository-defined roles or principals responsible for the
record's meaning. Ownership supports review routing and conflict diagnosis. It
does not by itself grant Founder transition authority or runtime capability.

At least one owner is required for a current record. Owner identifiers are
stable opaque strings declared by the repository contract or an authorized
owner registry.

### Sources

`sources` records provenance that informed the record. Each source contains a
stable source identifier, an explicit `required` boolean, a URI reference or
repository path, an immutable revision or observed digest when available, and a
role such as `decision`, `research`, `policy`, `incident`, `atlas-context`, or
`external-standard`. Requiredness is never inferred from role, locator,
revision, digest, status, or use in prose.

A source is informational input. It does not become a governed Knowledge record
merely because it is cited. An exact Point record or Resource reached from the
complete normalized Atlas can appear as an `atlas-context` source, but it does
not transfer Atlas ownership or grant authority over the referenced material.

A current record SHOULD pin an immutable revision for any external source whose
change could alter the record's meaning. Every source produces one ordered
resolution with the declared fields, resolved locator and object facts when
available, and one disposition: `resolved`, `retrieval-denied`, `missing`,
`unreadable`, `digest-mismatch`, `revision-mismatch`, or `role-mismatch`.

An unavailable required source on a current record makes the source stage and
Knowledge Set incomplete. The same condition on an optional or historical
source is a warning and remains non-authoritative. It does not authorize the
processor to retrieve through a denied channel, invent bytes, or infer
requiredness.

### Conflict declarations

Every record contains `conflicts`, including when the array is empty. Only
Assurance and Blueprint records can use a nonempty array. Each declaration has:

- `type`, exactly `assurance-limit` or `blueprint-constraint`;
- `target`, one current same-kind record identity;
- `localFact`, one exact string present in the source Assurance `limits` or
  Blueprint `constraints`; and
- `targetFact`, one exact string present in the target's corresponding field.

The target MUST contain the exact reciprocal declaration with source and target
identities and facts reversed. A missing fact, wrong kind, unavailable target,
malformed declaration, or unilateral declaration is invalid. One valid
reciprocal pair emits one ordered conflict result and one
`lifecycle.knowledge.authority-conflict` diagnostic. Behavior inclusion and
exclusion conflicts remain derived from their exact structured facts and enter
the same ordered conflict result carrier. No `x-` extension defines standard
conflict meaning.

### Tags

Tags improve retrieval and display. They are not identities, relationships,
owners, status, authority, or projection roots. A compiler MUST NOT use tags as
the sole basis for a mandatory Knowledge Closure.

## Behavior Records

A Behavior record owns one coherent functional product outcome.

Its `spec` contains:

- `outcome` — the externally meaningful result;
- `actors` — the actors or systems that can trigger or observe it;
- `conditions` — relevant preconditions and operating conditions;
- `included` — concrete behavior included by this record;
- `excluded` — concrete behavior intentionally outside it;
- `examples` — representative cases, including edge cases where useful;
- `falsifiers` — observations that would show the stated outcome is wrong or
  materially incomplete.

A current Behavior MUST have at least one `verified-by` relationship to a
current Check Definition. A Behavior can be refined by more specific Behaviors,
constrained by Assurances, and realized by Blueprints and Descriptions.

A Behavior MUST describe product meaning rather than an implementation task.
"Add a parser class" is not a Behavior. "Accept valid version-1 documents and
return a typed syntax tree" can be.

## Assurance Records

An Assurance record owns one coherent non-functional obligation or failure
limit.

Its `spec` contains:

- `obligation` — the required quality, invariant, or limit;
- `scope` — exact systems, data, Behaviors, or operating conditions to which it
  applies;
- `failureModes` — material ways the obligation can fail;
- `limits` — measurable or otherwise assessable boundaries;
- `degradation` — allowed degraded behavior, if any;
- `falsifiers` — observations that would refute satisfaction.

A current Assurance MUST have at least one `verified-by` relationship to a
current Check Definition. The Check can require automated, inspected, analytic,
or mixed evidence. A vague statement with no falsifiable boundary is not a
conforming current Assurance.

Assurance authority remains distinct from Behavior. A product can implement the
functional result and still fail its Assurance obligations.

## Blueprint Records

A Blueprint record owns one structural or technical decision that constrains
implementation.

Its `spec` contains:

- `decision` — the chosen structural relationship;
- `scope` — the part of the system governed by the decision;
- `components` — stable component or boundary identifiers involved;
- `constraints` — required structural properties;
- `interfaces` — material interaction and dependency surfaces;
- `dataFlows` — material information movement, when applicable;
- `tradeoffs` — accepted costs and rejected alternatives;
- `evolution` — compatibility, migration, and replacement constraints.

A current Blueprint MUST be assessable against repository reality. It SHOULD
link one or more Check Definitions when structural conformance can be checked.
It MUST NOT claim authority over a Behavior or Assurance merely because it is
more technically detailed.

## Description Records

A Description record owns the code-adjacent meaning of one implementation unit.
It reduces the cost of reconstructing intent from code while preserving the
separate authority of Behavior, Assurance, and Blueprint.

Its `spec` contains:

- `responsibility` — the implementation unit's primary job;
- `coverage` — exact implementation selectors for which this Description is the
  primary semantic owner;
- `behavior` — observable and internal behavior embodied by the unit;
- `boundaries` — inputs, outputs, side effects, and ownership limits;
- `invariants` — implementation-local truths that must remain intact;
- `dependencies` — material dependencies and why they exist;
- `failure` — failure behavior and recovery expectations;
- `rationale` — non-obvious implementation choices and rejected alternatives.

### Coverage selectors

A coverage selector contains:

- `path`, a normalized repository-relative POSIX path;
- `mode`, either `file` or `tree`;
- `role`, exactly `primary`; and
- `exclude`, an optional array of exact descendant paths when mode is `tree`.

A `file` selector covers exactly one regular file. A `tree` selector covers all
governed regular files under one directory except exact excluded descendants.
Glob patterns, regular expressions, symlink traversal, path aliases, and case
folding are not allowed.

The repository contract declares governed implementation roots and exact
exemptions for generated, vendored, binary, or otherwise non-authored material.
Every governed implementation artifact MUST resolve to exactly one current
primary Description. Zero primary owners is missing semantic coverage. More
than one is ambiguous ownership.

The one-to-one invariant is semantic ownership, not file-count equality. One
Description can cover several files that form one coherent implementation unit.
A large file can be split only by first creating separate exact implementation
artifacts; line ranges are not coverage selectors in format version 1.

A Description change SHOULD accompany a covered implementation change whenever
responsibility, behavior, boundary, invariant, dependency rationale, or failure
semantics change. Mechanical edits that preserve all described meaning can leave
the Description byte-identical, but final review MUST judge that claim.

## Check Definition Records

A Check Definition owns one falsifiable validation proposition. It does not own
the Behavior, Assurance, Blueprint, or Description that requires it.

Its `spec` contains:

- `proposition` — the exact claim the Check can support or refute;
- `subjects` — allowed subject kinds and selectors;
- `evidenceKinds` — allowed kinds such as `command`, `inspection`, `artifact`,
  `diff`, `analysis`, or `mixed`;
- `requiredBindings` — one or more repository binding identifiers or binding
  classes required for a complete evaluation;
- `evaluation` — pass, fail, indeterminate, and not-run semantics;
- `limits` — what a passing result does not establish;
- `freshness` — temporal and subject-binding requirements;
- `falsifiers` — outcomes that refute the proposition.

Every current Check MUST resolve at least one compatible Check Binding in the
repository contract. A binding names the mechanism; it MUST NOT restate or
replace the proposition.

A Check that requires fuzz testing, for example, defines the property, subject,
minimum campaign semantics, failure interpretation, and limits. The binding
selects the repository command and environment. The receipt records one exact
campaign result. Acceptance judges whether that evidence supports the admitted
obligation.

## Body Requirements

Each record body begins with one level-one title matching `title` and contains
these level-two sections:

| Kind | Required sections |
| --- | --- |
| Behavior | `Meaning`, `Boundaries`, `Examples`, `Rationale` |
| Assurance | `Obligation`, `Failure Model`, `Limits`, `Rationale` |
| Blueprint | `Decision`, `Structure`, `Tradeoffs`, `Evolution` |
| Description | `Responsibility`, `Behavior`, `Boundaries`, `Rationale` |
| Check | `Proposition`, `Evaluation`, `Evidence`, `Limits` |

A record MAY add sections. Required sections MUST appear exactly once. The body
must expand the structured value rather than contradict it or substitute links
for the meaning it owns.

## Knowledge Set Construction

A Knowledge Set processor receives an exact repository commit or immutable tree
plus the active repository contract, specification revision, and complete valid
Atlas basis from the same repository observation. That basis consists of
`atlasStateDigest`, `atlasResolutionDigest`, `atlasNormalizedModelDigest`, and
`atlasResourceBindingsDigest`; the Knowledge processor cannot infer one from
another or refresh any of them independently.

It MUST:

1. discover every record at the fixed locators without following symlinks or
   entering nested repositories;
2. validate text, front matter, schema, physical kind, identity, status,
   revision, and body sections;
3. compute source and semantic digests;
4. build the current-record index and historical revision chains;
5. validate all typed relationships;
6. build the Description coverage index over governed implementation roots;
7. resolve Check Definitions to compatible repository Check Bindings;
8. detect authority conflicts, ambiguous coverage, and unresolved required
   sources; and
9. emit one complete Knowledge Set result and digest.

A fresh repository can contain zero governed Knowledge records. When its
governed implementation set is also empty, discovery produces a complete valid
empty Knowledge Set and an information diagnostic. The processor MUST NOT
invent a minimum record count. Governed implementation appearing later creates
the normal Description coverage requirements.

The Knowledge Set digest is SHA-256 over canonical JSON containing:

- specification revision;
- repository commit and tree;
- repository contract digest;
- `atlasStateDigest`, `atlasResolutionDigest`,
  `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`;
- ordered current and historical record identities and digests;
- ordered relationship edges;
- ordered source resolutions and dispositions;
- ordered exact conflict results;
- ordered coverage selectors and exemptions;
- ordered Check Binding identities and digests; and
- validation profile and completeness.

### Bounded processing

The repository contract binds the exact Knowledge limits applied to parsing,
graph construction, and source resolution. The standard foundation ceiling is:

<!-- markdownlint-disable MD013 -->

| Limit | Ceiling |
| --- | ---: |
| records / aggregate record bytes | 65,536 / 268,435,456 |
| one record / front matter bytes | 4,194,304 / 524,288 |
| JSON depth / nodes / object properties / array items | 64 / 65,536 / 4,096 / 4,096 |
| body lines / headings / heading bytes / path bytes | 131,072 / 4,096 / 16,384 / 4,096 |
| graph nodes / edges / node degree | 65,536 / 262,144 / 4,096 |
| sources / sources per record | 262,144 / 128 |
| one source / aggregate source bytes | 4,194,304 / 268,435,456 |

<!-- markdownlint-enable MD013 -->

A contract can select a lower positive value but not exceed a ceiling. The
processor preflights count bounds, stops before exceeding aggregate byte bounds,
marks every affected stage incomplete, and echoes the exact selected limits in
the Validation Result. It MUST NOT continue unbounded work to produce a more
informative failure.

The digest proves correspondence to one processed set. It does not prove that
the product judgments are wise.

## Draft and Historical Records

Draft, superseded, and retired records remain available for history and
reconstruction but are excluded from current authority and mandatory projection
unless a role explicitly requests historical context.

A current record MUST NOT rely on a draft record for a required authoritative
relationship. It MAY cite a draft as informational source material when the
relationship is non-authoritative and the uncertainty is explicit.

## Change Rules

A governed Knowledge change MUST update every affected carrier in one reviewable
change set:

- record front matter and body;
- supersession chain;
- incoming and outgoing relationships;
- affected Description coverage;
- affected Check Definitions or Bindings;
- implementation artifacts whose described or governed meaning changes.

An affected Atlas record is not part of that change set. Delivery MUST NOT
mutate Atlas. A processor MAY report an exact Atlas identity for separately
authorized future Atlas maintenance or future Boundary compilation. Such a
report never classifies an admitted snapshot as stale. Atlas maintenance does
not replace the snapshot already admitted for an active Work Boundary and does
not invalidate its Knowledge Set, Projection, Checks, or Evidence. The active
Delivery continues from the exact historical snapshot. A successor Boundary in
that Delivery MUST retain the same admitted Atlas snapshot; only a future
separate Delivery after Closure can select a newer Atlas through fresh
compilation and initial admission. Acceptance preserves the current canonical
Atlas without treating it as the Delivery's context.

A validator MUST report stale relationships, missing coverage, current records
without required Checks, and unresolved conflicts before the change can support
a new Work Boundary.
