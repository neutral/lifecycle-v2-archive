# Atlas Integration

> Status: Draft

## Purpose

This document defines the exact read-only relationship between Lifecycle
Foundation and the external Atlas project-context system. Atlas owns Atlas
meaning, authored format, processing, validation, Checks, publication profiles,
and consumer semantics. Lifecycle owns only the selection, binding, trust,
projection, failure, and Delivery boundaries by which Foundation consumes one
Atlas.

This document does not copy the Atlas specification, make Atlas a Lifecycle
Knowledge kind, or authorize Lifecycle to maintain Atlas. The exact external
selection below is part of the fresh Foundation contract.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Exact Atlas Selection

Foundation supports exactly this Atlas selection:

<!-- markdownlint-disable MD013 -->

| Coordinate | Selected value |
| --- | --- |
| Atlas release | `0.7.0` |
| Atlas specification revision | `429fee62966f4d30e91ec2a15d27ecf353f5d68f` |
| Authored format | `1` |
| Processor contract revision | `746cbce73c51b28d617b96ca08f18d498ac749c4` |
| Resolved validation profile | `neutral.atlas-validator.resolved` |
| Validation Result schema | `urn:atlas:schema:validation-result:1` |
| Normalized model schema | `urn:atlas:schema:normalized:1` |
| Lifecycle consumer profile | `lifecycle.atlas-consumer.v1` |

<!-- markdownlint-enable MD013 -->

The Atlas specification revision identifies the latest immutable change to the
normative Atlas specification source selected by this Draft. The processor
contract revision identifies the immutable source revision that owns the
selected processor and normalized-output contract. They are deliberately
separate from the ambient Atlas development checkout and from Atlas release
label `0.7.0`.

The Repository Contract MUST carry every selected value exactly. A missing
Atlas, any other release, specification revision, authored format, processor
contract revision, validation profile, output schema, or consumer profile is
unsupported. Foundation MUST refuse it before initialization or Delivery
preparation. It MUST NOT negotiate, migrate, adopt, reinterpret, or provide a
compatibility reader for another Atlas selection. In particular, `format: 1`
alone does not identify this contract because an incompatible predecessor also
used that integer.

The target MUST NOT contain a copied Atlas specification or processor as a
source of authority. The installed Foundation implementation supplies or binds
the selected qualified processor independently of target-authored content.

## Mandatory Target Atlas

Every Foundation target MUST contain one authoritative root Atlas at
`atlas/atlas.md`. The root and every file included in raw Atlas State MUST be a
tracked, non-executable regular blob in the exact bound repository epoch.
Ignored files, untracked files, symbolic links, Gitlinks, submodules, generated
caches, and mutable out-of-epoch bytes cannot supply authoritative Atlas input.

Atlas is not optional. Initialization, target validation, initial preparation,
and compilation of any proposed Work Boundary revision MUST fail closed unless
the selected Atlas can be observed and resolved completely and validly from the
exact repository epoch being compiled. Initial admission and readmission MUST
reproduce the Atlas snapshot already bound by the selected Boundary revision
and MUST prove that the Boundary's exact full repository commit and tree are
still the canonical target branch HEAD. Any canonical movement after Boundary
compilation, including an Atlas-only commit, stales that proposal.

Applied initial admission establishes an active-Delivery branch lease over the
exact physical target and canonical branch selected by the Work Boundary. While
that lease exists, the canonical checkout MUST remain clean and its HEAD MUST
remain the admitted commit. Execution, evaluation, revision, reaffirmation,
readmission, Checks, and Evidence use the historical admitted Atlas snapshot
and also fail closed when the canonical branch or checkout differs. Atlas
maintenance MUST occur on another branch or worktree and MUST NOT land on the
leased branch until Closure and terminal Store disposition complete. Lifecycle
does not create, repair, upgrade, initialize, or otherwise maintain Atlas.

## Raw State And Resolution

Lifecycle keeps physical binding separate from semantic resolution.

**Atlas State** is the ordered exact Git path, mode, object-identity, and digest
set owned by Processing. It proves which repository bytes were observed. It
does not prove Atlas validity or interpret Atlas meaning.

An **Atlas Resolution** conforms to
[`atlas-resolution.schema.json`](../schemas/atlas-resolution.schema.json). It
binds:

- the exact Repository Contract Atlas selection;
- the exact Atlas State digest;
- the ordered exact repository-local Resource bindings and their aggregate
  digest;
- the selected processor implementation identity and digest;
- the external Atlas Validation Result digest when one was produced;
- the normalized-model digest only for a complete valid resolved result;
- explicit `complete` and `valid` states; and
- its own canonical digest.

The processor MUST read the exact blobs named by Atlas State and any authorized
repository-local Resource inputs from the same bound Git tree. It MUST NOT read
authoritative Atlas meaning from the live worktree after that epoch is bound.
Each registered repository-local Resource outside the Atlas root MUST receive
one exact binding with Resource id, URI, disposition, and, when resolved, path,
mode, object identity, and digest in the owning observation. Resource ids MUST
NOT repeat. External-local and network Resource
retrieval remains denied unless a separately authorized Lifecycle retrieval
profile permits an exact source; the Atlas reference itself grants no access.
Resource bindings sort by Resource id, URI, and resolved path in Unicode
code-point order. `resourceBindingsDigest` covers that complete ordered array;
the Atlas Resolution digest covers every field except its own `digest`.

Lifecycle carriers outside the Atlas Resolution name that same aggregate
`atlasResourceBindingsDigest`. It MUST equal the Resolution's
`resourceBindingsDigest` exactly. Snapshot, Work Boundary, authenticated
repository subject, Evidence observation, and transaction binding carry it
directly rather than treating the enclosing Resolution digest as a substitute.

The processor MUST invoke the selected resolved profile with the selected
immutable Atlas specification revision, validate the returned Validation Result
and normalized model against the selected external schemas, and bind their
exact canonical digests. The processor implementation identity and digest are
runtime-selected implementation facts. `implementationDigest` is the canonical
digest of the exact installed processor file manifest or package inventory
selected for execution, excluding dependency caches, logs, temporary support,
and mutable runtime state; it is not an ambiguous digest of whichever
executable path was found first. These facts do not replace the selected Atlas
specification and processor contract revisions.

Foundation fixes the following limits for this Atlas consumer profile. A
conforming implementation MUST apply the same limit to the processor Worker
output and to the strict-JSON input that parses that output.

<!-- markdownlint-disable MD013 -->

| Processing subject | Count or depth | Per-item bytes | Aggregate or result bytes | Elapsed time |
| --- | --- | --- | --- | --- |
| installed processor inventory | 1,024 filesystem entries; depth 16 | 16 MiB per file | 64 MiB | 15,000 ms |
| processor Worker and strict-JSON result | — | — | one shared 64 MiB maximum | Worker: 15,000 ms |
| Atlas Resource binding | 16,384 registered Resources | 64 MiB per unique resolved blob | 256 MiB across unique resolved blobs | 15,000 ms |

<!-- markdownlint-enable MD013 -->

Installed-processor inventory uses two phases: metadata traversal MUST establish
the entry-count, depth, per-file, and aggregate-byte bounds before any file
payload is opened. Resource binding MUST establish the registered Resource
count and Resource-id uniqueness before any Resource blob is read. One Git
object identity is read and hashed at most once even when several Resource
registrations resolve to it; the per-blob and aggregate limits therefore count
unique resolved objects, not references.

An installed-processor inventory bound, identity mismatch, or inventory change
yields `lifecycle.atlas.processor-unavailable`. A processor Worker time or
output-size crossing, or a Resource count, aggregate-byte, or elapsed-time
crossing, yields `lifecycle.atlas.processing-incomplete`. Duplicate Resource
ids and malformed strict JSON yield `lifecycle.atlas.result-invalid`. No such
failure can expose a partial normalized model, raw processor path, raw Resource
path, source bytes, or caught processor message.

An Atlas Resolution is usable by Delivery only when it is complete and valid
and contains a schema-valid normalized model. An invalid, incomplete,
unsupported, malformed, or mismatched result MUST contain no normalized-model
digest and MUST NOT produce a partial normalized model for Lifecycle use. Raw
Atlas State and bounded diagnostics MAY still be reported for orientation and
repair outside Delivery.

The Repository Snapshot binds the exact Atlas basis through
`atlasStateDigest`, `atlasResolutionDigest`,
`atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`. Every Work
Boundary, Projection, authenticated repository subject, Evidence observation,
and transaction context that consumes one Atlas snapshot MUST bind those same
four identities from one coherent repository epoch. Acceptance binds and
reproduces that same admitted repository epoch and exact Atlas snapshot; it has
no second current-Atlas input or Atlas-composition identity.

## Admitted Atlas Snapshot

A proposed Work Boundary binds one complete valid Atlas snapshot from its exact
repository commit and tree. When admission selects that Boundary, those raw,
resolved, normalized, and Resource-binding identities become the admitted Atlas
snapshot for that Boundary revision.

The admitted snapshot is immutable context, not a subscription to canonical
Atlas. Builder and reviewer Projections, Agent Attempts, Candidate sealing,
baseline or final Checks that depend on the active Boundary, and Evidence
compilation MUST reopen the Boundary's exact historical Git objects and
reproduce that snapshot. They MUST NOT read replacement meaning from the live
worktree or a different canonical Atlas, or refresh an active Projection
implicitly.

Every active nonterminal operation MUST establish that the selected canonical
branch is still checked out, its worktree is clean across all authoritative
roots, and its HEAD commit and tree exactly equal the admitted repository
basis. This is one full-tree guard; Atlas and non-Atlas paths receive no
different concurrency treatment. Revise and reaffirm can change the mandate,
but they MUST use the same admitted repository and Atlas snapshot. Readmission
MUST NOT adopt a newer Atlas or repository epoch within the same Delivery.

Changing Atlas for future work is a separate Founder-directed operation on an
unleased branch or worktree. It can land on the target branch only after the
active Delivery reaches Closure. A later Delivery then selects it through
fresh preparation and initial admission.

## Consumer Semantics

Lifecycle consumes only the complete normalized model defined by the selected
Atlas contract. It MUST preserve:

- Atlas and Map identities, Map questions, and Map provenance;
- Map-qualified Area identities, questions, and explained memberships;
- exact Atlas-wide Point identity, the one anchor, primary Map, and every
  selected context record with its containing Map and source path;
- posture and lifecycle as independent authored values;
- Content, typed References, registered Resources, and their provenance;
- authored directional relations and notes plus only the direct reverse index
  supplied by the normalized model;
- Atlas Checks as policy records distinct from mapped context; and
- publication profiles as exact non-expanding selections distinct from local
  read authority.

Lifecycle MUST NOT merge or alias distinct Point ids by similarity, infer
identity from filenames outside resolved processing, erase anchor/context
provenance, infer reciprocal or transitive relations, treat absence of a
relation as evidence of no impact, recreate a Layer or Depth primitive, or
interpret filesystem proximity as semantic ownership.

A nested `atlas.md` starts an independent Atlas boundary. Parent resolution
stops at that boundary under the selected Atlas processor contract. Raw State
MAY include the descendant bytes conservatively for complete byte identity,
but Lifecycle MUST NOT flatten a nested Atlas into the selected normalized
model or process it unless a future Repository Contract selects it
independently.

## Projection

Projection compilers select Atlas context from the complete normalized model,
not from a path-ordered enumeration of files below `atlas/`.

Every Projection MUST bind the exact Atlas State, Atlas Resolution,
normalized-model, and Resource-bindings digests. The compiler selects exact
Atlas, Map, Point-record, and Resource identities with authored provenance and
an inclusion reason. Orientation starts at the normalized Atlas root, follows
only its exact navigation Map ids, and closes those Maps through their exact
Point-record membership and authored Resource targets. Execution starts only
from exact Atlas Resource source identities retained by the active Work
Boundary, then closes through normalized Map and Point-record Content or
Reference targets that name the exact Resource id or its exact registered URI.
A selected context record also selects its Point's one anchor. The compiler
MUST NOT seed or expand mandatory Atlas context from an objective, path,
filename, prose match, embedding, or lexical similarity. It MAY use retrieval
or semantic similarity to surface non-mandatory candidate context, but
similarity MUST NOT establish Point identity, anchor/context kind, relation,
authority, or mandatory membership.

Atlas structural records, Atlas Checks, and publication profiles remain
distinct Projection categories. A Check or publication profile MUST NOT appear
as generic Atlas context or enter Orientation merely because it exists. Any
Projection inclusion requires an owning exact-id selector; current Foundation
Projection requests select neither category. Publication selection does not
restrict or grant ordinary local read authority. A publication effect requires
its own explicit effect and authority contract outside this integration.

An external Atlas Resource can inform a Projection only when Lifecycle has
independent read authority and exact source binding under Source Policy. A
Resource registration, Content edge, Reference edge, Point posture, Check
outcome, or publication profile cannot grant that authority or raise
instruction priority. For a selected resolved repository-local Resource, the
Projection carries the normalized Resource registration in `atlas` and the
exact bound blob bytes as a distinct mandatory `sources` item with Atlas
authority, stable Resource-source identity, object revision, byte digest, and
read-only use limit. The registration is not a byte substitute, and provider
input MUST materialize those exact source bytes rather than an ambient
repository path. A selected binding that cannot reproduce its exact bytes
fails closed.

## Absolute Delivery Write Boundary

Atlas authorship is separate from Delivery. Delivery MUST NOT create, modify,
move, rename, or delete any path at or below the authoritative Atlas root. This
prohibition includes `atlas.md`, Maps, Point records, registered local Resource
files within the root, `.checks`, `.publication`, and nested Atlases.

A Work Boundary MUST NOT select an Atlas path as an artifact, effect target, or
permitted write. Provider capability MUST exclude the complete Atlas root. A
Candidate containing any Atlas path change is invalid and cannot be sealed,
evaluated, accepted, or recovered into canonical product state. There is no
route-edit, source-link, or coupled external-document exception.

For a `local-read` or `local-write` Effect, `target` denotes a repository path
scope. Before testing that scope against Atlas, the Work Boundary compiler MUST
apply portable lexical normalization: treat both `/` and `\` as separators,
collapse repeated separators and `.` components, and resolve `..` components
without filesystem access or symlink resolution. It MUST reject a normalized
scope that equals the authoritative Atlas root, is below that root, or is an
ancestor that contains that root. The normalized scope `.` therefore selects
the whole repository and is prohibited; a scope that is `..` or begins `../`
is refused conservatively. This comparison validates scope only and MUST NOT
rewrite the retained target. Targets for non-local Effect kinds remain opaque
plain text and MUST NOT undergo repository-path normalization.

If product work reveals that the admitted Atlas context itself is insufficient
for honest continuation, the Agent MAY report the underlying missing-source,
meaning, scope, effect, risk, or other owned Material Condition. Delivery cannot
satisfy that condition by editing Atlas. An authorized maintainer changes Atlas
separately on another branch or worktree. The active Delivery cannot adopt that
change; it either completes under its admitted context or closes no-ship. A
future Delivery can select the changed Atlas only after it lands following
Closure and terminal Store disposition.

### Canonical branch freeze and acceptance

The active-Delivery branch lease prohibits every canonical target change while
the Delivery is active, regardless of whether the changed path is inside
Atlas. Lifecycle derives the lease from the applied initial Work Boundary and
active Control state; it is not a new record family. At most one admitted,
unclosed Delivery within one installed Lifecycle machine custody may hold the
lease for one target and canonical branch. Prepared proposals hold no lease,
and any branch motion before their admission makes their exact repository basis
stale. The lease does not physically prevent another installation or manual
actor from moving Git; active-operation guards detect and refuse that movement.

Acceptance is the sole authorized canonical branch motion during the lease.
Its transaction MUST:

1. prove that the Candidate has no change at or below the authoritative Atlas
   root relative to its immutable base;
2. prove that the canonical checkout is clean and that its HEAD commit and tree
   exactly equal the admitted Candidate base;
3. reproduce the admitted Atlas snapshot from that immutable base;
4. construct the accepted tree from the exact sealed Candidate without merge,
   rebase, current-Atlas sampling, or tree composition;
5. apply that exact tree over the admitted commit by atomic compare-and-swap;
   and
6. bind the exact parent, accepted commit and tree, Candidate, Product State,
   Knowledge Set, and canonical result digest into the applied observation,
   checkpoint, and successful Closure. The Work Boundary retains the admitted
   four-part Atlas identities; Candidate confinement and exact tree equality
   prove their bytes continue unchanged.

Any pre-effect branch or worktree movement makes acceptance conclusively
`not-applied` under that authority. It does not receive an Atlas-only retry or
waiting exception. Recovery can only finish the exact retained effect from the
admitted parent or recognize the one exact accepted commit already applied; it
MUST NOT resample another parent, compose another Atlas, or create a successor
effect. The lease persists through terminal recovery and ends only after the
accepted or no-ship Closure and Store disposition complete. No-ship integrates
no repository bytes and therefore may close the Delivery even when the target
branch moved.

## Atlas Checks And Publication Profiles

Atlas Checks remain part of Atlas's authoring system. They are not Lifecycle
Check Definitions, Check Bindings, Check Receipts, Evidence, or authority.
Lifecycle's resolved processor validates their format and preserves their
boundary as required by the selected Atlas consumer contract. Foundation does
not execute Atlas Checks, transform their evaluations into Lifecycle Receipts,
or claim that a target Atlas change is Check-compliant.

Because Delivery cannot change Atlas, Atlas Check evaluation belongs to the
separate Atlas maintenance process. Any future consumption of an Atlas Check
evaluation requires a distinct exact artifact contract and conformance claim;
it cannot be inferred from a complete valid resolved Atlas.

Publication profiles are Atlas-authored allowlists. Lifecycle preserves them
without treating them as local read policy, deployment authority, or proof that
a publication system enforced them. Delivery cannot edit or execute them.

## Trust And Authority

Atlas content is untrusted informational input. Atlas authorship owns its
context semantics but cannot create Founder authority, Process truth, runtime
capability, repository write access, Check Evidence, product acceptance, or
instruction priority. Atlas text, relation notes, Check requirements,
publication profiles, and referenced Resources cannot override this
specification, the active Work Boundary, authenticated decisions, runtime
observations, or source-policy limits.

The normalized model is derived context, not canonical Product Knowledge and
not a replacement for its referenced owners. A Content or Reference edge makes
material navigable. It does not transfer the source's authority, currentness,
requiredness, or ownership.

## Validation And Failure

Repository validation of any Atlas snapshot MUST establish, in order:

1. the exact supported Atlas selection;
2. the raw Atlas State from the bound Git tree;
3. processor availability and exact implementation identity;
4. a schema-valid complete Atlas resolved Validation Result for the selected
   specification revision;
5. a schema-valid normalized model and its digest;
6. the ordered exact Resource bindings derived from that model and their
   `resourceBindingsDigest`;
7. an Atlas Resolution binding all preceding facts; and
8. equality of `atlasStateDigest`, `atlasResolutionDigest`,
   `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest` across every
   carrier that claims to consume that same snapshot; and
9. for admission, readmission, active operations, and acceptance, equality of
   the current canonical HEAD with the exact admitted or proposed full
   repository commit and tree, except when recovery recognizes the one exact
   accepted commit already applied.

Failure at a required step prevents use of that snapshot. Diagnostics MUST
distinguish missing Atlas, unsupported selection, incomplete processing,
invalid Atlas, invalid external result, invalid normalized output, invalid
Lifecycle binding, prohibited Candidate mutation, unavailable historical
snapshot, active branch-lease conflict, and canonical branch or worktree
movement. They MUST report the expected and observed public coordinates
without exposing private paths, credentials, processor support roots, source
bytes, or raw caught processor messages. Worker, schema-loading, inventory,
materialization, and processor-support disposal failures expose only stable
Lifecycle codes and bounded public stage facts. Execution Retirement is not an
Atlas-processing phase.

An execution operation whose admitted historical snapshot cannot be reopened
or reproduced fails before provider intent with a binding or integrity
diagnostic. Any current canonical HEAD or authoritative-worktree mismatch also
fails before provider intent as violation of the active branch lease, not as a
Material Condition. Preparation may retry from a fresh current observation
before admission. Once active, the Delivery cannot refresh its repository or
Atlas basis; acceptance and no-ship follow the terminal rules above.

## Evolution

The Atlas selection is an independent Foundation coordinate. Any change to the
selected Atlas release, immutable specification revision, authored format,
processor contract revision, resolved profile, result schema, normalized-model
schema, or Lifecycle consumer rules requires explicit Lifecycle evolution
review, updated fixtures, implementation qualification, and a fresh-only hard
cut of every affected Lifecycle carrier.

A newer Atlas version does not match by format integer, compatible-looking
fields, normalized-shape similarity, or processor tolerance. Foundation
supports only the exact selection stated here until a later Lifecycle
publication replaces it.
