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

Knowledge record schema v2 defines six governed Knowledge kinds:

- `behavior` — functional product outcomes and externally observable behavior;
- `assurance` — non-functional obligations, invariants, failure limits, and
  operating qualities;
- `blueprint` — structural decisions, boundaries, dependencies, and data flow;
- `description` — code-adjacent implementation responsibility and rationale;
- `check` — falsifiable validation propositions and required evidence shapes;
- `discipline` — optional reusable practice guidance for a class of work.

Behavior, Assurance, Blueprint, Description, and Check Definition are Product
Knowledge. Discipline is governed Knowledge for identity, provenance,
currentness, processing, and exact projection, but it is not Product Knowledge
and carries no product authority. It assists a capable agent; it does not
replace the agent's judgment, require mechanical compliance, or create an
acceptance obligation merely because it is current, registered, or selected.

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
records/disciplines/**/*.md     Discipline
**/_*.desc.md                  Description
```

`records/disciplines/registry.json` is the one tracked Discipline Registry. It
is repository configuration, not a Knowledge record, and is excluded from the
Markdown locator above. It records exact Pack provenance, exact adopted
Discipline records, and lightweight Work Type groupings used for discovery.

The repository contract declares the implementation roots whose source artifacts
require Description coverage and any exact exclusions. A path under
`.git/`, `.lifecycle/`, `records/control/`, or the authoritative Atlas root
MUST NOT be an implementation coverage target.

A record kind MUST match its physical locator. A processor MUST NOT accept a
Behavior under `records/assurance`, a Discipline outside
`records/disciplines`, a generic document relabeled as a Description, or any
Atlas Check as a Lifecycle Check Definition. Atlas Checks
and Lifecycle Check Definitions are different systems, and the complete Atlas
root is outside governed Knowledge and Delivery writes.

Moving a record does not change its stable identity. All references to its
locator MUST be updated in the same governed change.

## Text and Front Matter

A Knowledge record is a Lifecycle Document using the repository-authored
Knowledge profile and `lifecycle.knowledge-record.v2` semantics. It is UTF-8
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

- `schema`, exactly `lifecycle.knowledge-record.v2`;
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
discipline.go.context-cancellation
```

An identifier is stable across path moves and wording changes. A materially new
owner or proposition receives a new identifier rather than reusing an unrelated
historical identity.

### Identity, revision, and occurrence

The enduring Knowledge identity is the record identifier. One exact revision
binds that identifier, revision number, source digest, and semantic digest.
An occurrence identifies that revision within one selected basis, such as the
admitted Knowledge Set or the sealed Candidate Knowledge Set used for review.
These are distinct relationships even when stored source bytes can be shared.

Each Knowledge Set validates its own currentness and supersession rules. Review
MUST preserve both admitted and Candidate occurrences when their closures
select the same identity. Different revisions in those separate bases are a
normal authorized change, not two competing current owners inside one Set.
Byte-identical revisions in both bases likewise retain both contextual roles.
[Projection](PROJECTION.md#reviewer) owns occurrence selection and
[Evidence](EVIDENCE.md#independent-review) owns exact review citation.

For example, an admitted basis can select revision 4 while Candidate work
retains revision 5 as Draft. A second Attempt reopens both; revision 4 still
governs that Candidate Knowledge Set. When the authorized change promotes
revision 5, the prior revision's status and the successor's exact predecessor
digests change coherently in the Candidate. Review can then compare admitted
revision 4 with Candidate revision 5. It does not rewrite the admitted snapshot
or mistake two basis-qualified occurrences for two Current owners in one Set.

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
`supersedes: null`. A later Product Knowledge revision MUST identify its exact
immediate local predecessor by record identifier, revision number, source digest,
and semantic digest. The complete local chain is contiguous and kind-preserving.
A current revision may have a suffix of later Draft revisions. Those proposed
successors do not govern, displace the explicit current owner, or become Work
Boundary roots. Any later non-Draft revision requires the earlier current
revision to relinquish current standing.

Promotion is one complete coherent Knowledge change: update the prior current
record's status, then bind the promoted successor to those exact predecessor
bytes. Update any later Draft predecessor references whose bytes changed.
Source and semantic digests include status; no consumer silently resolves a
stale digest to the earlier admitted bytes. Historical Snapshots preserve their
own exact occurrences independently. Complete valid Draft successors can cross
Attempts without requiring them to become current merely to retain progress.

For Product Knowledge, the prior revision becomes `superseded` in the same
canonical change that makes the replacement `current`. A processor MUST reject:

- two current revisions of one identifier;
- a revision gap;
- a supersession cycle;
- a replacement that names another record kind;
- a prior digest mismatch; or
- a superseded record whose declared replacement is absent from the same
  repository history available to the validator.

An adopted Discipline retains the publisher's current record bytes and positive
revision number. Revision 1 has no predecessor; every later revision retains
a structurally valid `supersedes` reference to the same identity at exactly
revision n-1 with both exact digest fields. That reference is publisher provenance, but target adoption MUST NOT require the publisher's
complete predecessor chain, require revision 1 to be locally present, or rewrite
a previous adopted copy to mark it superseded. The target MUST still reject
duplicate revisions, multiple current records for one Discipline identity, or
a current revision older than another locally present revision, and MUST validate the exact current record against its Registry adoption.
A missing publisher predecessor is not a target revision gap. Its digest is
retained as declared provenance, not independently verified predecessor bytes.

A fresh target can therefore adopt a current publisher revision such as 7, and
a later adoption change can replace it with another validated current revision
without downloading every intervening publisher revision. Prior target
adoptions remain in Git history and retained admitted bases. These rules apply
only to advisory Discipline; Product Knowledge retains its complete exact
local revision and supersession obligations.

Changing only a path still requires a new revision when the record bytes change.
A pure Git rename preserving exact bytes preserves the record revision and
digests.

### Owners

`owners` identifies repository-defined roles or principals responsible for the
record's meaning. Ownership supports review routing and conflict diagnosis. It
does not by itself grant Director transition authority or runtime capability.

At least one owner is required for a current record. Owner identifiers are
stable opaque strings declared by the repository contract or an authorized
owner registry.

Discipline is the one exception to target Product Knowledge owner resolution.
An adopted Discipline record has exactly one `owners` entry equal to the
publisher retained in its Registry Pack entry. Adoption validates that retained
value against the source Pack manifest before the target commit is created.
The publisher owns the guidance text but gains no target Product Knowledge
authority, Director authority, or runtime capability. Exact target adoption
makes the bytes available; it does not relabel their author.

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

Every Discipline source MUST set `required: false`. Discipline sources retain
optional provenance only; neither an adopted but unselected record nor a
selected advisory record can make external or repository source availability a
Knowledge Set completeness condition. `required: true` makes the Discipline
record invalid under `lifecycle.discipline.source-required`; a processor MUST
NOT honor that declaration as a required source. An unavailable Discipline
source remains an ordinary optional-source warning and does not make the source
stage incomplete.

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
Assurance and Blueprint records can use a nonempty array. Discipline conflict
handling uses explicit judgment: Pack authors curate Sets, target
Directors review adopted combinations, and a Worker can report guidance that is
unhelpful or contradictory. Discipline records do not participate in the
Product Knowledge authority-conflict mechanism. Each standard Product
Knowledge conflict declaration has:

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
owners, status, authority, Work Type selection, or projection roots. A
compiler MUST NOT use tags as the sole basis for a mandatory Knowledge Closure
or silently select Discipline from them.

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

## Discipline Records

A Discipline record contains one independently selectable, self-contained
practice that can help an agent perform a recognizable class of work. It is a
light-touch companion to product work, not a substitute for general knowledge
or reasonable judgment.

Its `spec` contains:

- `practice` — the concise reusable practice;
- `appliesWhen` — human-readable signals that the practice may be useful;
- `doesNotApplyWhen` — human-readable limits or counter-signals;
- `guidance` — concrete recommendations the agent can apply with judgment; and
- `verification` — optional ways to notice whether the guidance helped or was
  followed.

Applicability and verification text is advisory. It is not an executable
predicate, Check Definition, Check Binding, Work Boundary obligation, or
Evidence requirement. When a practice must be enforced for product
correctness, its exact requirement belongs in the owning Behavior, Assurance,
Blueprint, Description, Check Definition, or Work Boundary carrier. A
Discipline record can point to useful neighboring records only with
non-required `related-to` relationships. It has no standard dependency or
conflict semantics and its `conflicts` array is empty.

A **Pack Discipline record** is a conforming Discipline record offered in a
Pack outside the target Knowledge locators. It does not affect a target. An
**Adopted Discipline record** is an exact tracked copy under
`records/disciplines/` registered by the target. Adoption makes it available as
target Knowledge while retaining its Pack provenance; it does not turn the
guidance into Product Knowledge.

## Discipline Registry, Packs, Sets, and Work Types

There are three separate selections in the Discipline route. A publisher puts
exact records in a Pack and may group them into Sets. The target adopts exact
record bytes and records their provenance in its Registry. Reconnaissance then
uses the Registry's Work Types to discover a useful subset for one Work
Boundary. Publication, adoption, discovery, and Delivery selection therefore
have different owners; none implicitly performs the next step.

The Discipline Registry conforms to
[`discipline-registry.schema.json`](../schemas/discipline-registry.schema.json).
Its self-digest omits only `digest`. Its Pack entries bind an exact Pack id,
version, publisher, source, immutable revision, and manifest digest. Each adoption binds
one exact current Discipline identity, revision, target path, source and
semantic digests, and Pack id. Every adoption MUST resolve to exactly one
tracked current Discipline record with identical values, and every adopted
record MUST have exactly one adoption entry. Target processing MUST require the
record's sole `owners` value to equal the publisher retained in its Registry
Pack entry. Separate Pack validation and adoption MUST establish that the
retained publisher and manifest digest came from the exact supplied Pack; the
target Knowledge processor does not reopen that Pack.

A **Pack** is an external distribution envelope conforming to
[`discipline-pack.schema.json`](../schemas/discipline-pack.schema.json). It can
be public, such as a Pack in `lifecycle-disciplines`, or internal, such as one
in `txkit-disciplines`. A Pack does not govern a target and is never consulted
during an active Delivery. Its manifest inventories exact Pack Discipline
record bytes and can offer named **Sets**. A Set is a publisher-curated list of
record identities that is useful together; it is selection convenience, not a
new Knowledge object, dependency solver, or compatibility proof. Pack record
inventories use unique normalized Markdown paths under the Pack `records/`
directory and are ordered by record id. Set ids are unique; their outer array
preserves the publisher's presentation sequence. Each Set's record identities
are ordered and unique.

The Pack's `contract.specificationRevision` records its exact authoring
provenance; it is not the runtime's selected compatibility coordinate. An
immutable Pack authored at `lifecycle.foundation.1.0.0-rc.9` can be adopted
without retagging its manifest when its declared Knowledge schema is v2 and
all supplied record bytes validate under the current selected Knowledge v2
semantics and target contract. Adoption MUST NOT reinterpret a v1 record,
convert a former target, relax current validation, or invent a new manifest
digest to conceal the original authoring provenance.

Adoption copies exact selected bytes and updates the Registry in one reviewable
repository change. Future publisher changes never update a target implicitly.
Separately authorized adoption, update, and removal may advance canonical state
while Deliveries remain active. A Delivery adopts those new governing bytes only
through a complete new Boundary, initially or through explicit integration-
context-change resolution and authenticated readmission.

A Delivery MUST NOT write the complete `records/disciplines/` root or Registry.
Boundary artifact/effect selection and Candidate deltas beneath that root are
refused before successor or Seal retention. Validate an integrated Candidate's
delta against its exact application parent; upstream adopted-byte changes are
not Delivery-authored. Recovery reopens exact retained Registry/adoption bytes.
Context replacement requires an exact successor Boundary and readmission.

A **Work Type** is a target-local discovery grouping in the Registry. It gives
a stable id, title, description, and a list of adopted Discipline identities
that may be useful for work such as Go cryptography or Next.js frontend work.
Selecting a Work Type does not select every listed record, and it never makes
them mandatory. A Work Boundary can name zero or more Work Types and selects
the exact useful Discipline records through its ordinary selected-Knowledge
input. Direct selection without a Work Type is valid. Director and Worker common
sense, not tag inference or a constraint engine, resolves whether the proposed
selection is useful.

The Registry's Work Type index is the **work router**. Work Type ids can group
practices by language, domain, and work phase, such as Go design or review,
JavaScript implementation or testing, and cryptography implementation or review.
Those are target-authored discovery choices, not a standard closed taxonomy,
Process operation, role dispatcher, dependency solver, or mandatory checklist.
A named phase does not execute a procedure or expand an Attempt's authority.

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
| Discipline | `Practice`, `Applicability`, `Guidance`, `Verification` |

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
6. validate the Discipline Registry, adopted-record correspondence, retained
   Pack-provenance fields, and optional-only Discipline source declarations
   without reading an external Pack;
7. build the Description coverage index over governed implementation roots;
8. resolve Check Definitions to compatible repository Check Bindings;
9. detect authority conflicts, ambiguous coverage, and unresolved required
   sources; and
10. emit one complete `lifecycle.knowledge-set.v2` result and digest.

The v2 Knowledge Set manifest adds the exact Discipline Registry digest,
adoption bindings, publisher and Pack provenance, and Work Type index to the v1
repository/record graph basis. A v1 manifest cannot be relabeled, extended, or
interpreted as v2.

A fresh repository contains the empty Discipline Registry and can contain zero
governed Knowledge records. When its governed implementation set is also empty,
discovery produces a complete valid empty Knowledge Set and an information
diagnostic. The processor MUST NOT invent a minimum record count. Governed
implementation appearing later creates the normal Description coverage
requirements.

The Knowledge Set digest is SHA-256 over canonical JSON containing:

- specification revision;
- repository commit and tree;
- repository contract digest;
- `atlasStateDigest`, `atlasResolutionDigest`,
  `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`;
- ordered current and historical record identities and digests;
- exact Discipline Registry digest, adopted-record bindings, Work Types, and
  Pack provenance;
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

An affected Atlas record is not part of the Delivery's change set. Delivery
MUST NOT mutate Atlas. A processor may name an exact Atlas identity for separate
Director-directed maintenance. Such maintenance does not replace an active
Boundary's historical selection. Explicit integration can detect changed
governing context and freeze its result for a complete successor Boundary and
readmission in the same Delivery. Acceptance preserves its selected integration
parent's Atlas bytes; they are not silently substituted as mandate context.

A validator MUST report stale relationships, missing coverage, current records
without required Checks, and unresolved conflicts before the change can support
a new Work Boundary.
