# Context surface

## Purpose

The Context surface captures high-level product knowledge across product, market,
business, and delivery dimensions.

Use [contract.md](contract.md) for shared semantic authority entry
state, related semantic authority, update rules, and promotion paths.

It answers:

```text
Why now?
Why this problem?
For whom?
Against what alternatives?
With what business constraints?
With what risks?
```

## Typical contents

Context entries may include:

- problem framing and outcomes
- product direction
- user and stakeholder needs
- market and competition
- value proposition
- business viability and constraints
- solution concept and UX scope
- dependency, platform, and build-vs-buy rationale when those choices shape
  product direction
- technical feasibility and architecture readiness
- data, security, and compliance readiness
- risk, assumptions, and validation
- delivery and operational readiness

Validation, delivery readiness, and operational readiness belong in Context
only when they express durable product posture, release rationale, user risk,
business constraint, or product interpretation. One-run proof results, proof
receipts, active proof obligations, Delivery progress, landing readiness, and
closure state belong in proof or Control records.

The Context surface carries product context authority when the entry is current.

Good Context entries are slow-moving. They help Discovery select useful
Signals and help Delivery interpret ambiguous Signals.

Context is the semantic authority surface. Clarity is the process that builds,
reviews, and repairs that surface when the Context layer itself needs focused
work. Context records product meaning. Clarity records the operation that
changed or reviewed it. Discovery and Delivery may use current scoped Context,
but they should not casually repair broad Context while also selecting or
building unless their active process explicitly admits that work.

Direction is future-facing Context. It says why future product movement
matters. It is not a task list; Discovery plans record what selection work
remains.

They should not become a dumping ground for every ticket, conversation, or
speculative thought.

## Context Atlas Contract

When Context holds a broad imported or curated corpus, organize it as a Context
atlas rather than a flat archive. This section defines the surface contract for
that atlas. Use Clarity for the process procedure that inventories source
material, reviews routes, changes files, and proves retrieval.

The atlas should expose product areas, semantic neighborhoods, area overviews,
canonical references, rationale leaves, route guidance, graph relations,
freshness, and promotion pressure.

The organization layer can be product Context. Add a current Context entry when
the corpus route, area map, role system, review policy, or freshness policy
should govern future retrieval and maintenance. That entry should help a future
agent choose the right Context entries before scanning every file.

Physical hierarchy may express current target product neighborhoods:

```text
records/context/
  overview.md                    neutral folder purpose
  <area>/
    overview.md                  neutral folder purpose for the area
    <area>-overview.md           current Context route and cluster map
    <cluster>/
      overview.md                neutral folder purpose for the cluster
      <canonical-topic>.md       current canonical Context reference
      <rationale-or-scenario>.md rationale, scenario, glossary, design,
                                  constraint, history, or proof-context leaf
```

Stable entry IDs remain semantic identity. File paths, folder names, and
overview files are retrieval and orientation affordances. Do not rely on a path
as authority unless a current Context entry admits that organization as product
meaning.

Imports must erase source-container identity from target Context unless that
container is itself current product meaning. Do not preserve old source names
in Context ids, filenames, corpus labels, area labels, headings, or retrieval
vocabulary merely because the material came from a wiki, docs folder, issue
tracker, notebook, or methodology repo. Keep source provenance, coverage maps,
and process history in Control evidence or notes.

Source file boundaries are provisional during import. The final Context entry
shape should follow the durable job the entry does now: canonical reference,
rationale leaf, decision history, glossary, actor need, product posture, design
reference, proof context, delivery constraint, market or user context, open
question, or implementation posture. Keep one Context entry per source page
only when the source page boundary is also the current target product meaning.

Role separation matters. Prefer separate Context entries when one broad page is
mixing:

```text
area overview
cluster overview
canonical reference
product posture
rationale leaf
decision history
glossary
scenario
actor need
market or user context
delivery constraint
implementation posture
proof context
design reference
open question
```

`proof context` means durable product rationale about evidence semantics, proof
posture, why evidence matters, or how users and the product interpret proof. It
does not mean proof receipts, one-run proof results, active proof obligations,
or proof freshness status. `delivery constraint`, delivery readiness, and
operational readiness mean durable product or release posture, not Delivery
process progress.

Connect those entries through `related_surfaces` only when another semantic
authority surface must be considered with the Context. Within Context, use
stable IDs in the body when helpful to state local graph relations such as
parent, child, canonical_for, rationale_for, depends_on, tension_with,
supersedes, or promotion_candidate_for. Keep the graph small enough that a
future agent can retrieve the semantic neighborhood without loading the whole
corpus.

Use retrieval keys consistently across the corpus:

- `context_corpus:<name>` for the whole imported or curated knowledge set
- `context_area:<area>` for the current product area a topic belongs to
- `context_cluster:<name>` for the current subject cluster a topic belongs to
- `context_role:<role>` for area overview, cluster overview, canonical
  reference, rationale leaf, glossary, posture anchor, design reference,
  decision history, scenario, actor need, constraint, proof context, open
  question, or topic leaf
- `review_status:<status>` for unreviewed, cluster-reviewed, narrowed, or
  deprecated material
- `freshness:<status>` for needs-cluster-review, current-after-review, stale,
  or superseded material
- `follow_up:<surface>` when broad Context points to future Intent,
  Assurance, Blueprint, or Description work

These keys are not a replacement for the entry's owned meaning. They are the
retrieval and maintenance vocabulary that keeps a corpus usable.

### Relationship Direction

Context may reference Intent, Assurance, Blueprint, and Description entries
when those entries depend on the Context or must be considered with it for a
scoped decision. These references are retrieval links and dependency-awareness
links. They do not reverse semantic authority backpressure.

Backpressure still moves from later surfaces toward Context when product
rationale, user meaning, strategy, direction, alternatives, or scope boundaries
are missing. Later surfaces may refine, constrain, or implement Context, but
they must not answer a Context-owned question in place of Context.

### Atlas Metadata Fields

When Context is broad enough to need an atlas, mirror the main route labels in
top-level fields as well as retrieval keys:

```yaml
context_area: "<area>"
context_cluster: "<cluster>"
context_role: "<role>"
parent_context: "<id or empty string>"
child_contexts: []
context_relations: []
```

Use these fields for the route a future agent should trust first. Retrieval
keys remain cheap search vocabulary; top-level atlas fields make the route
visible at the entry contract level. Keep stable Context IDs as semantic
identity. A move from one path to another does not change meaning unless the
entry's current meaning, state, route, supersession, or relation fields also
change.

Use `context_relations` for local Context graph facts that should travel with
the entry. Write each relation as a string in `relation:target` form:

```yaml
context_relations:
  - "parent:context.area.overview"
  - "child:context.area.topic"
  - "canonical_for:context.area.cluster"
  - "rationale_for:context.area.canonical"
  - "depends_on:context.other"
  - "tension_with:context.other"
  - "supersedes:context.old"
  - "promotion_candidate_for:assurance"
```

Use Context IDs as targets for intra-Context relations. Use
`promotion_candidate_for:<surface>` only to name pressure toward Intent,
Assurance, Blueprint, or Description. Use `related_surfaces` for cross-surface
semantic authority entries that must be considered now. Keep the graph small
and current. Do not turn every adjacent file into a relation.

### Route Review Versus Content Review

Reviewing the atlas route is not the same as reviewing every leaf's content.
You may make a corpus organization entry, area overview, folder route, or
metadata route current while leaving topic leaves as `review_status:unreviewed`
or `freshness:needs-cluster-review`.

Use route-level freshness only for the route it names:

```text
cluster-reviewed/current-after-review can mean the area route is current
unreviewed/needs-cluster-review can still be true for individual leaves
```

Do not mark a leaf narrowed, reviewed, current, superseded, or deprecated just
because it was moved into a better atlas path. Change leaf review state only
after checking the leaf's owned meaning, stale assumptions, duplicates,
contradictions, and promotion pressure.

Treat `state` as product-authority state and atlas `review_status` or
`freshness` labels as limits on how strongly the entry may govern. A
`state: current` Context entry is admitted product authority for its scope, but
`review_status:unreviewed` or `freshness:needs-cluster-review` means future
agents should use it for orientation or candidate meaning, not as a reviewed
canonical leaf, unless the active Clarity Boundary or Work Boundary explicitly
admits that limited use. Prefer current area overviews and canonical references
when they are cluster-reviewed or current-after-review for the needed route.

Split or add a new Context entry when one entry starts doing several durable
jobs, when an area needs a stable route, or when a cluster needs a freshness or
review policy of its own. Do not use corpus organization to preserve raw source
paths, process history, proof logs, or temporary task state.

A broad Context cluster should make its product area, route overview, canonical
posture, supporting leaves, stale or conflicting material, and promotion
pressure findable without reading the whole corpus.

## Contract focus

Context entries should expose:

```text
primary question: why this matters
owned meaning: product rationale, direction, users, market, strategy, and
business constraints
common references: related Intent, Assurance, Blueprint, and Description
```

Update Context when a durable rationale, direction, constraint, or product
understanding should guide future work. This includes dependency or platform
direction when it reflects product fit, constraints, alternatives, release
posture, or long-term maintainability. Keep possible work, blockers, and
selection state in Discovery Control records.

Use Clarity when the update is primarily about Context adequacy, atlas
structure, canonicalization, freshness, conflicts, or promotion pressure. Use
Delivery update obligations when a Delivery run changes product meaning inside
its admitted Work Boundary. Use knowledge promotion when runtime or completed
work creates durable Context learning after Delivery. This page defines what
the resulting Context entries must mean; the Clarity process defines how a
Context pass is controlled.

## Example

```yaml
context_entry:
  id: "context.teams"
  surface: "context"
  state: "current"
  scope: ["teams"]
  context_area: "teams"
  context_cluster: "collaboration-posture"
  context_role: "canonical-reference"
  parent_context: ""
  child_contexts: []
  context_relations: []
  current_meaning: "Teams let multiple users collaborate under one shared account boundary."
  retrieval_keys:
    - "product_area:teams"
    - "context_area:teams"
    - "context_cluster:collaboration-posture"
    - "context_role:canonical-reference"
    - "audience:team-admins"
  target_references: []
  why_now:
    - "More accounts are inviting coworkers manually outside the product."
  user_needs:
    - "Admins need to add coworkers without sharing credentials."
  business_constraints:
    - "Seat accounting must remain clear before billing automation expands."
  risks:
    - "Permissions and billing changes can create hidden regressions."
  related_surfaces:
    - "intent.team-invites.create"
    - "assurance.team-invites.no-seat-allocation-on-create"
  supersedes: []
  superseded_by: ""
  updated_at: "YYYY-MM-DD"
```
