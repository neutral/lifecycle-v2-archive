# Semantic Authority Surface Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for core semantic
authority surface packages.

The compile install workflow reads this page to generate the installed semantic
authority surface registry, copy surface contracts, and select entry templates.
This manifest also owns surface-specific retrieval keys, target-reference
guidance, adequacy checks, promotion candidates, body-section guidance, and
template seed examples.

## Surfaces

| id | name | storage locator | contract | install path | template |
| --- | --- | --- | --- | --- | --- |
| context | Context | records/context | methodology/semantic-authority/surfaces/context.md | semantic-authority/surfaces/context.md | semantic-authority/templates/context-entry.md |
| intent | Intent | records/intent | methodology/semantic-authority/surfaces/intent.md | semantic-authority/surfaces/intent.md | semantic-authority/templates/intent-entry.md |
| assurance | Assurance | records/assurance | methodology/semantic-authority/surfaces/assurance.md | semantic-authority/surfaces/assurance.md | semantic-authority/templates/assurance-entry.md |
| blueprint | Blueprint | records/blueprint | methodology/semantic-authority/surfaces/blueprint.md | semantic-authority/surfaces/blueprint.md | semantic-authority/templates/blueprint-entry.md |
| description | Description | **/_*.desc.md | methodology/semantic-authority/surfaces/description.md | semantic-authority/surfaces/description.md | semantic-authority/templates/description-entry.md |

The `storage locator` column compiles to the installed registry field
`storage_locator`. It may name a `records/` folder or a committed file pattern
such as Description's `**/_*.desc.md`.

## Migration Transplant Rule

When material is migrated from an old area into any semantic authority surface,
the target surface decides the final shape. Bring over current meaning, not the
old container. Old folders, page maps, support labels, document types, route
files, and source file boundaries are provenance unless the active Work
Boundary admits them as current target meaning.

Every migration-shaped Delivery should record explicit keep / reshape / drop
product judgment in the active Work Boundary before landing:

- keep content that has current value and a clear owning surface
- reshape content that is useful but must fit current target naming, labels,
  chunking, storage, or terminology
- drop source navigation, duplicate history, process state, obsolete support
  items, and old structure that does not fit the target reality
- defer material whose current target owner or meaning is not clear enough

Control records, proof, notes, and archives may keep old names and source paths
as process evidence. Durable semantic authority entries should be readable,
retrievable, and trustworthy without reopening those process records.

## Context

Owns:

- product context
- users
- market
- strategy
- direction

May reference:

- intent
- assurance
- blueprint
- description

Backpressure to:

- none

Updated by:

- founder decision
- discovery
- knowledge promotion

Retrieval keys:

- product area
- user or stakeholder group
- product posture
- market or business constraint
- release posture
- strategic direction
- context corpus
- context area
- context cluster
- context role
- review status
- freshness state
- follow-up surface candidate

Target references:

- none

Adequacy checks:

- names the durable rationale, user, constraint, or direction future work needs
- scopes the meaning tightly enough that unrelated product areas do not inherit it
- states the product decision or interpretation it can govern
- keeps possible work, backlog state, and Delivery progress out of Context
- keeps Clarity source inventories, review checks, retrieval proof, closure
  recommendations, and process history out of Context entries unless durable
  product meaning has been extracted
- points to related Intent, Assurance, Blueprint, or Description entries only when they depend on this Context
- uses downstream `related_surfaces` as scoped retrieval links, not as reverse
  backpressure; later surfaces still cannot answer Context-owned rationale,
  user, strategy, direction, or scope questions
- when broad Context forms an atlas, gives the entry a clear area, cluster,
  role, retrieval route, and freshness or review basis
- when broad Context forms an atlas, mirrors the trusted route in top-level
  `context_area`, `context_cluster`, `context_role`, `parent_context`,
  `child_contexts`, and `context_relations` fields instead of hiding the route
  only in retrieval keys
- treats `state` as product-authority state and atlas `review_status` or
  `freshness` labels as limits on how strongly the entry may govern; a current
  leaf with `freshness:needs-cluster-review` can orient work but should not be
  treated as a reviewed canonical leaf unless the active Clarity Boundary or
  Work Boundary admits that limited use
- preserves stable Context IDs while using paths, folders, and overview files
  only as retrieval, orientation, and maintenance affordances
- separates canonical references from rationale, scenario, history, glossary,
  design, constraint, proof-context, open-question, or implementation-posture
  leaves when those jobs would otherwise blur together
- states local graph relations such as parent, child, canonical_for,
  rationale_for, depends_on, tension_with, supersedes, or
  promotion_candidate_for as `relation:target` strings when those relations are
  needed for retrieval
- when many Context entries form a corpus, provides enough corpus, cluster,
  role, review, and freshness labels for future agents to retrieve and maintain
  the set without treating it as a flat archive
- distinguishes route review from content adequacy review; moving an entry,
  making an area overview current, or marking a route current does not mark
  individual leaves reviewed unless their owned meaning was actually checked
- keeps proof-context, delivery-readiness, and operational-readiness Context
  to durable product posture only; proof receipts, one-run proof results,
  active proof obligations, Delivery progress, and closure state stay in proof
  or Control records
- for imported material, removes source-container identity from target Context
  ids, filenames, labels, headings, and retrieval vocabulary unless that
  container is current product meaning
- does not keep one target Context entry per source file by default; route,
  index, or overview source pages are consolidated unless they own current
  product meaning

Promotion candidates:

- founder decision that changes product direction or product posture
- runtime learning that changes who the product serves or why the problem matters
- release learning that changes product constraints, viability, or strategic timing
- repeated Clarity, Discovery, or Delivery learning that should guide future
  selection, Context maintenance, or admission

Body shapes:

Use one of these body shapes when the YAML header is not enough:

### Product Posture

- Product Posture
- Applies To
- Decisions Governed
- Scope Boundaries
- Related Authority

### User Or Stakeholder Context

- User Or Stakeholder
- Need Or Constraint
- Product Interpretation
- Decisions Governed
- Declared Non-Goals

### Strategic Constraint

- Constraint
- Rationale
- Applies To
- Decisions Governed
- Staleness Trigger

### Corpus Or Knowledge Base Organization

- Organization Rule
- Atlas Scope
- Product Areas
- Area Overview Routes
- Source-Container Erasure
- Re-Chunking Rule
- Label System
- Cluster Map
- Atlas Metadata Fields
- Semantic Neighborhoods
- Reader Routes
- Canonical References
- Rationale Leaves
- Graph Relations
- Authority Limits
- Route Review Boundary
- Leaf Review Status
- Promotion Pressure
- Chunking Rules
- Freshness Model
- Staleness Trigger

### Area Or Cluster Overview

- Area Or Cluster
- Purpose
- Canonical Entries
- Semantic Neighborhoods
- Reader Routes
- Atlas Metadata Fields
- Freshness And Review Policy
- Authority Limits
- Route Review Boundary
- Leaf Review Status
- Promotion Pressure

### Canonical Context Reference

- Canonical Meaning
- Applies To
- Decisions Governed
- Supporting Rationale Leaves
- Tensions Or Supersession
- Promotion Pressure

### Rationale Or Scenario Leaf

- Supporting Rationale Or Scenario
- Canonical Context
- Applies To
- Limits
- Staleness Trigger

Minimal seed example:

~~~yaml
id: "context.todo-cli.local-first"
surface: "context"
state: "current"
scope: "local todo CLI for one user"
context_area: "todo-cli"
context_cluster: "product-posture"
context_role: "canonical-reference"
parent_context: ""
child_contexts: []
context_relations: []
current_meaning: "The product is a local-first command-line todo tracker for a single user who needs fast capture and review without account setup or network dependency."
retrieval_keys:
  - "product_area:todo-cli"
  - "context_area:todo-cli"
  - "context_cluster:product-posture"
  - "context_role:canonical-reference"
  - "posture:local-first"
  - "audience:single-user"
target_references: []
related_surfaces:
  - "intent.todo-cli.capture-list-complete"
supersedes: []
superseded_by: ""
updated_at: "YYYY-MM-DD"
~~~

## Intent

Owns:

- admitted product behavior
- non-goals
- acceptance checks
- user-visible outcomes

May reference:

- context
- assurance
- blueprint
- description

Backpressure to:

- context

Updated by:

- admission
- knowledge promotion

Retrieval keys:

- product area
- behavior
- user-visible outcome
- role or actor
- non-goal
- acceptance check

Target references:

- command, route, screen, API, or workflow surface that expresses the behavior
- target surface when the behavior depends on one implementation boundary

Adequacy checks:

- states the intended behavior in terms a future agent can build or refuse
- names relevant non-goals and scope boundaries
- gives acceptance checks or observable outcomes, not proof status
- when an acceptance check is executable, binds it as a Required Check with a
  stable proof obligation id, a registered check command, an environment
  requirement, and a `last_held` date and result; receipt ids stay out of the
  entry
- references Context only when rationale or direction affects the behavior
- references Assurance, Blueprint, or Description entries when they constrain implementation

Promotion candidates:

- admitted behavior that was not previously in semantic authority storage
- founder decision that changes a behavior, non-goal, role expectation, or acceptance check
- runtime learning that changes the intended user-visible outcome
- reconciliation learning that clarifies the behavior future work must preserve

Body shapes:

Use one of these body shapes when the YAML header is not enough:

### Behavior Promise

- Behavior
- Acceptance Meaning
- Observable Outcomes
- Scope Boundaries
- Declared Non-Goals

### Non-Goal Or Refusal

- Non-Goal
- Applies To
- Refusal Meaning
- Related Behavior
- Staleness Trigger

### Role Or Actor Expectation

- Role Or Actor
- Expected Capability
- Limits
- Acceptance Checks
- Related Constraints

### Required Check

- Check Obligation
- Applies When
- Bound Proof Obligation
- Check Command
- Environment Requirement
- What Passing Means
- What Passing Does Not Prove
- Last Held
- Failure Response

Minimal seed example:

~~~yaml
id: "intent.todo-cli.capture-list-complete"
surface: "intent"
state: "current"
scope: "local todo CLI core commands"
current_meaning: "A user can add a todo, list stored todos, and mark a todo complete. Completed todos remain available after the command exits."
retrieval_keys:
  - "product_area:todo-cli"
  - "behavior:add-todo"
  - "behavior:list-todos"
  - "behavior:complete-todo"
target_references:
  - "cli:add"
  - "cli:list"
  - "cli:complete"
related_surfaces:
  - "context.todo-cli.local-first"
  - "description.todo-cli.storage"
supersedes: []
superseded_by: ""
updated_at: "YYYY-MM-DD"
~~~

## Assurance

Owns:

- obligations
- invariants
- constraints
- required checks

May reference:

- context
- intent
- blueprint
- description

Backpressure to:

- context
- intent

Updated by:

- admission
- knowledge promotion

Retrieval keys:

- product area
- invariant
- obligation
- risk class
- protected data or resource
- required check

Target references:

- code path, test surface, monitor, or runtime boundary that must preserve the obligation
- target surface when the obligation applies only to a specific implementation area

Adequacy checks:

- states what must remain true and where the obligation applies
- explains why the obligation matters or what failure means
- names checks or proof expectations without storing one-run proof status
- when a required check is executable, binds it as a Required Check with a
  stable proof obligation id, a registered check command, an environment
  requirement, and a `last_held` date and result; receipt ids stay out of the
  entry
- references Intent when the obligation preserves behavior
- references Blueprint or Description when structure or local responsibility controls the obligation

Promotion candidates:

- incident, proof, or runtime learning that reveals a durable invariant
- founder decision that changes risk tolerance, data treatment, or operational obligation
- reconciliation learning that creates a required check for future work
- release learning that changes rollback, monitoring, support, or compliance constraints

Body shapes:

Use one of these body shapes when the YAML header is not enough:

### Invariant

- What Must Remain True
- Scope
- Required Checks
- Failure Meaning
- Declared Non-Goals

### Operational Obligation

- Obligation
- Required Visibility Or Support Shape
- Assurance Checks
- Failure Meaning
- Declared Non-Goals

### Risk Or Data Constraint

- Protected Resource Or Risk
- Allowed Handling
- Forbidden Handling
- Required Checks
- Failure Meaning

### Required Check

- Check Obligation
- Applies When
- Bound Proof Obligation
- Check Command
- Environment Requirement
- What Passing Means
- What Passing Does Not Prove
- Last Held
- Failure Response

Minimal seed example:

~~~yaml
id: "assurance.todo-cli.completed-state-persists"
surface: "assurance"
state: "current"
scope: "local todo CLI completed-state persistence"
current_meaning: "A todo marked complete must remain complete after the command exits and later reads the stored todo list."
retrieval_keys:
  - "product_area:todo-cli"
  - "invariant:completed-state-persists"
  - "required_check:complete-then-read"
target_references:
  - "src/storage"
  - "test:storage persistence"
related_surfaces:
  - "intent.todo-cli.capture-list-complete"
supersedes: []
superseded_by: ""
updated_at: "YYYY-MM-DD"
~~~

## Blueprint

Owns:

- structure
- sequence
- state
- dependency shape

May reference:

- context
- intent
- assurance
- description

Backpressure to:

- intent
- assurance

Updated by:

- admission
- knowledge promotion

Retrieval keys:

- product area
- component
- interface
- dependency direction
- state transition
- sequence or flow

Target references:

- module, service, storage boundary, route, job, integration, or package that participates in the structure
- target surface when the structural boundary depends on one implementation area

Adequacy checks:

- states the structure, sequence, state, dependency direction, or interface boundary
- explains which later work must preserve the boundary
- references Intent and Assurance when behavior or obligations drive the structure
- keeps local module responsibility in Description unless it changes the shared structure
- makes stale or superseded structure visible before future Build work depends on it

Promotion candidates:

- implementation or reconciliation learning that clarifies durable structure
- dependency decision that future work must preserve or revisit deliberately
- runtime learning that changes state flow, integration boundaries, or operational topology
- founder decision that changes platform direction or cross-component responsibility

Body shapes:

Use one of these body shapes when the YAML header is not enough:

### Structure Boundary

- Structure
- Participants
- Dependency Direction
- Preserved Boundary
- Related Authority

### State Or Sequence Flow

- State Or Sequence
- Entry Conditions
- Transitions
- Terminal Or Handoff States
- Required Preservation

### Dependency Shape

- Dependency
- Direction
- Allowed Responsibility
- Forbidden Responsibility
- Replacement Or Extension Boundary

Minimal seed example:

~~~yaml
id: "blueprint.todo-cli.storage-boundary"
surface: "blueprint"
state: "current"
scope: "local todo CLI command-to-storage boundary"
current_meaning: "CLI command handling depends on a storage boundary for todo persistence. Storage owns read and write mechanics; command handling owns parsing and output flow."
retrieval_keys:
  - "product_area:todo-cli"
  - "component:storage"
  - "dependency_direction:commands-to-storage"
target_references:
  - "src/commands"
  - "src/storage"
related_surfaces:
  - "intent.todo-cli.capture-list-complete"
  - "assurance.todo-cli.completed-state-persists"
supersedes: []
superseded_by: ""
updated_at: "YYYY-MM-DD"
~~~

## Description

Owns:

- local implementation responsibility
- module responsibility
- safe modification guidance
- sensitive edges

May reference:

- context
- intent
- assurance
- blueprint

Backpressure to:

- blueprint
- assurance

Updated by:

- admission
- knowledge promotion

Retrieval keys:

- target surface
- module or file path
- responsibility
- invariant
- dependency or extension point
- sensitive edge

Target references:

- colocated `_*.desc.md` path and the file, module, class, function, command,
  route, job, package, or configuration surface described by the entry

Adequacy checks:

- names the target surface and the responsibility it owns
- states responsibilities that are forbidden or belong elsewhere
- names local invariants, dependencies, extension points, or sensitive edges
- references Intent, Assurance, or Blueprint entries that govern the local surface
- gives safe modification guidance without paraphrasing code or storing proof status

Promotion candidates:

- Build or reconciliation learning that changes durable local responsibility
- runtime learning that reveals a sensitive edge or local invariant
- dependency or wrapper decision that future edits must preserve
- founder or maintainer decision that changes ownership of an implementation surface

Body shapes:

Use one of these body shapes when the YAML header is not enough:

### Local Responsibility

- Owned Responsibility
- Forbidden Responsibility
- Local Invariants
- Related Authority
- Safe Modification Guidance

### Sensitive Edge

- Sensitive Edge
- Why It Matters
- Required Handling
- Forbidden Handling
- Checks Or Review Triggers

### Extension Or Dependency Point

- Extension Point Or Dependency
- Allowed Use
- Replacement Boundary
- Related Structure
- Safe Modification Guidance

Minimal seed example:

~~~yaml
id: "description.todo-cli.storage"
surface: "description"
state: "current"
scope: "todo CLI storage module"
current_meaning: "The storage module owns reading and writing local todo items, including completed state. It does not own command parsing, output formatting, or product behavior decisions."
retrieval_keys:
  - "target:src/storage"
  - "responsibility:todo-persistence"
  - "invariant:completed-state-persists"
target_references:
  - "src/storage/_storage.desc.md"
  - "src/storage"
related_surfaces:
  - "intent.todo-cli.capture-list-complete"
supersedes: []
superseded_by: ""
updated_at: "YYYY-MM-DD"
~~~
