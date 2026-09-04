# Lifecycle Specification

> Status: Draft

## Background

Agentic software development has two different scarcity profiles.
Implementation labor is increasingly abundant, but product judgment,
architectural coherence, trustworthy current context, and independent evidence
remain scarce. A capable model can write a large change quickly while still
working from the wrong interpretation, missing a non-functional obligation,
following stale architecture, or declaring completion after exercising only the
checks it happened to notice.

Repositories normally preserve executable code well. They preserve the meaning
around that code less consistently. Product outcomes may live in issue text,
architecture in diagrams, assurance obligations in policy documents, local
implementation meaning in individual engineers' memory, and project direction
in planning systems. An agent starting a fresh session must reconstruct this
material before it can make a good implementation decision. The reconstruction
cost repeats, and a failure to retrieve one decisive source can be silent.

Putting all available material in one prompt does not solve the problem. It
moves retrieval failure into context dilution, stale copies, conflicting
instructions, truncation, and uninspectable selection. Telling an agent where
specifications live is also insufficient when reading them remains voluntary and
completion is judged by the same agent that performed the work.

Lifecycle addresses this by separating durable product knowledge from
process-local control, compiling a role-specific context projection for each
attempt, confining productive work to a reversible candidate, and withholding
truth transitions until independent evidence satisfies an admitted result.

## Thesis

Lifecycle compiles authoritative project knowledge into bounded agent attempts
whose goals, context, capability, evidence obligations, and truth transitions
are explicit and independently verifiable.

Its invariant is:

> Only admitted behavior can ship.

This Draft selects one coordinated Foundation rc.10 architecture:

<!-- markdownlint-disable MD013 -->

| Coordinate | Selected value |
| --- | --- |
| Product package | `1.0.0` |
| Qualification revision | `lifecycle.foundation.1.0.0-rc.10` |
| Repository contract | `lifecycle.repository.v15` |
| Runtime protocol | `lifecycle.runtime.foundation.v10` |
| Interface protocol | `lifecycle.interface.foundation.v10` |
| Provider adapter | `lifecycle.provider-adapter.v6` |
| Delivery Control Store | `lifecycle.control-record-store.v1` |
| Atlas release | `0.7.0` |
| Atlas specification revision | `429fee62966f4d30e91ec2a15d27ecf353f5d68f` |
| Atlas processor contract revision | `746cbce73c51b28d617b96ca08f18d498ac749c4` |

<!-- markdownlint-enable MD013 -->

These coordinates form one fresh-only hard cut. An rc.10 implementation does
not read, migrate, adopt, import, or continue predecessor Delivery Control,
repository contracts, runtime or interface protocols, or provider adapters.
Unsupported coordinates have no compatibility, migration, recovery, or
publication standing.
The package version does not create compatibility and the Draft coordinate
does not create publication status or a conformance claim.

"Admitted" means more than mentioned in a prompt. One exact Work Boundary has
selected the product meaning, exclusions, obligations, effects, risks,
artifacts, Checks, and acceptance propositions that govern the result. A
founder-authorized transition has activated that exact boundary against an
exact repository state.

"Ship" means more than code exists or tests passed. The exact candidate has been
sealed, required evidence has been produced for that candidate, an independent
review has judged every admitted proposition, and the authorized runtime
transaction has made the result canonical. Release and deployment can remain
separate downstream effects.

## Design Principles

### Knowledge before labor

An agent attempt begins from a compiled knowledge basis, not an ambient
repository search problem. The projection contains the mandatory semantic
closure for the attempt and identifies the exact source, revision, digest,
authority class, and inclusion reason of every item.

### Stable meaning, flexible route

The Work Boundary defines the result and its acceptance conditions. It does not
prescribe an implementation itinerary. Inside an admitted reversible envelope,
the builder can inspect, plan, edit, test, repair, and reorganize its route.

### Strong boundaries, thin interposition

Lifecycle does not need to supervise every ordinary edit. It needs exact
opening and closing boundaries, explicit material-condition handling, and
runtime-enforced capability and truth transitions. Intermediate control is
justified only when it protects a material authority or irreversible-effect
boundary that the active envelope and closing validation cannot contain.

### Agents propose; the runtime records; repositories retain product truth

An Agent summary, provider event, tool trace, or model confidence is an
observation or proposal. It cannot create product meaning, establish Evidence,
perform acceptance, or move canonical state. The runtime records exact Process
facts in one Control Record Store for the Delivery. Only authenticated
transactions can move canonical product bytes in the repository.

Agents therefore author semantics rather than protocol mechanics. During one
Attempt, the assigned Agent develops body-only Markdown in a governed working
document. It can inspect and revise that document across as many internal turns
as the funded invocation permits. Foundation rc.10 exposes no provider-invoked
live semantic validator, and an Execution Cell cannot claim that a provisional
draft is valid. Submission closes the edit window over one exact draft. After
Execution Containment, the runtime retrieves and independently parses those
semantics, renders canonical retained Markdown, and owns every typed payload,
fixed binding, identity, reference, ordering rule, digest, validation, event,
transaction, and storage operation. The provider's terminal message is not a
transport envelope for the complete result.

### Typed records, readable semantics, deterministic mechanics

Every retained Control revision has a typed operational payload and readable
semantic Markdown body. The payload owns values used by validation, reduction,
eligibility, and transactions; the body owns explanation, claims, rationale,
uncertainty, and limitations. A body cannot override its payload. The Control
Record Store retains both directly and computes a logical revision digest over
their canonical value and provenance. For an Agent Work Product, the retained
body is deterministically rendered from the parsed typed value; the Receipt
separately binds the observed draft bytes. Markdown export can render that same
revision as a strict Lifecycle Document for inspection without becoming a
second authority carrier.

### Continuity lives in artifacts, not sessions

Provider memory and a physical workspace are useful working state but are not
Process continuity. The reducer-selected Candidate Revision and its exact
Candidate Revision Carrier, active Work Boundary revision, compiled Knowledge
Projection, Evidence, immutable Control revisions, and append-only event
sequence in the Control Record Store preserve continuity across fresh
sessions, provider changes, timeouts, Cell loss, and process replacement. A
Candidate materialization is reconstructible execution support, never the sole
copy or currentness owner. Current Process standing,
activities, recovery obligations, Candidate condition, current subjects, and
eligible operations exist only as the ephemeral Delivery view returned by
reducing those events. They are not mutable state rows or alternate continuity
owners. The dimensions remain orthogonal: an admitted Boundary governs as soon
as its admission effect is observed applied even while initial Candidate
observation is pending; absence of a Candidate remains `absent` despite another
recovery obligation; and post-Closure Store recovery does not replace the
terminal Candidate disposition. Likewise, every unresolved Activity head is
recoverable. When no stronger Material Condition, acceptance-ready Evidence,
or sealed-evaluation projection applies, a Candidate-touching Activity remains
`in-progress` at its durable pre-effect or pre-seal preparation stage and
becomes `terminal-recovery` only after advancing beyond that stage. Provider
streams and ordinary edits are not Process events.

### Completion is an obligation ledger

"Done" is evaluated against enumerated obligations. Every required Behavior,
Assurance, Blueprint constraint, Description coverage requirement, artifact,
Check, effect, risk, exclusion, and acceptance proposition has an explicit
status. Missing, unresolved, unsupported, and failed obligations remain visible
and cannot be collapsed into a generic success summary.

### Model capability does not change authority

A more intelligent model can receive broader judgment work and a less capable
model can receive narrower implementation work. Neither model class changes the
active product meaning, granted capability, required evidence, or authority
needed for a truth transition.

## Conceptual Model

### Project Knowledge

Project Knowledge is durable, repository-addressable material that can govern or
explain future work.

Lifecycle recognizes these governed knowledge kinds:

- **Behavior** owns functional product outcomes and externally observable
  behavior.
- **Assurance** owns non-functional obligations, invariants, failure limits,
  risk constraints, and operating qualities.
- **Blueprint** owns structural, dependency, boundary, data-flow, and technical
  decision meaning.
- **Description** owns code-adjacent implementation responsibility and explains
  the behavior and rationale embodied by one governed implementation unit.
- **Check Definition** owns a falsifiable validation proposition and the
  evidence shape that can support it.

Implementation artifacts remain executable reality rather than knowledge
records. They are covered by Descriptions and related to the knowledge that they
realize. Tests and commands are evidence mechanisms; their existence does not
make them the owner of the requirement they exercise.

Atlas is the mandatory external project-context system selected by
[Atlas Integration](spec/ATLAS.md). Lifecycle binds its exact tracked bytes,
requires one complete valid resolved model under the selected Atlas contract,
and consumes that model read-only without absorbing Atlas ownership or Check
semantics. An Atlas Content or Reference edge can make a Resource navigable. It
cannot grant read or write authority, change the Resource owner's meaning, or
make the edge itself Product Knowledge.

Admission freezes that resolved Atlas as context for the selected Work
Boundary. Execution, Checks, and Evidence reproduce it from the admitted
historical Git snapshot. Applied initial admission also establishes the
active-Delivery branch lease: the canonical checkout remains clean and its HEAD
remains the exact admitted commit until Closure and terminal Store disposition
complete. Any intervening commit or worktree change, including Atlas
maintenance, violates that operating basis
and prevents further active work or acceptance. Readmission may change the
mandate but cannot adopt a new repository or Atlas epoch within the same
Delivery. Atlas maintenance occurs on another branch or worktree and lands
only after Closure and terminal Store disposition complete; a future Delivery
selects it through fresh preparation and initial admission.

Founder acceptance authorizes the exact sealed Candidate result over the exact
admitted parent. Acceptance is the sole authorized branch movement under the
lease and uses one atomic compare-and-swap without merge, rebase, current-Atlas
sampling, Atlas composition, or an Atlas-only retry exception. No-ship writes
no product bytes and may close the Delivery despite later branch movement.

Product, Control, Atlas, and external source material remain separate carriers.
Product consists of the governed meaning and repository reality that can
become canonical. Control coordinates one Process and preserves its
disposition. Atlas maps context among direct Resources while external sources
retain their exact owners. Compilation can connect these planes through typed
references, but cannot silently promote Atlas or source material into Product,
Process Control into Knowledge, or any carrier into authority.

### Knowledge Set

A Knowledge Set is the complete validated view of governed knowledge at one
repository state. It includes current records, their stable identities, typed
relationships, implementation coverage, source digests, and detected conflicts.

A Knowledge Set is not one large generated document. It is an indexed graph over
exact repository-native sources. The graph can be queried and projected while
the original owners remain independently reviewable.

### Semantic Thin Waist

The Semantic Thin Waist is the set of stable identities, relationship types,
authority classes, and falsifiable obligations that connect broad project
context to implementation.

```text
Atlas and source context
        |
        | resolved context and typed sources inform
        v
Behavior | Assurance | Blueprint | Description | Check Definition
        |
        | stable identity, typed relationship, exact revision
        v
implementation artifacts and evidence mechanisms
```

The waist is deliberately smaller than the complete prose around the project.
It retains enough structure to compile context, detect missing ownership, and
bind evidence without attempting to reduce every product or architectural
judgment to a rigid ontology.

### Process

A Process governs one class of truth transition. It defines:

- the subject that can be admitted;
- the authority needed to activate it;
- the reversible work object;
- the evidence and judgment needed at closure;
- exceptional correction and revision relationships;
- terminal dispositions; and
- information closure.

Delivery is the first and currently sole Process. It governs one bounded
product result from objective through accepted canonical change or truthful
no-ship.

The v10 public operation boundary identifies the target, exact Delivery when one
already exists, operation, and bounded semantic input. A fresh
`delivery.prepare` creates a fresh Delivery and its sole preparation activity;
it does not inherit another Brief, Boundary, TUI transcript, provider
conversation, or hidden Process state. A later reconnaissance request creates
another Delivery and Control Record Store rather than appending another
preparation activity.
Authority packages, observation times, machine configuration, expected
reductions, digests, and runtime mechanics are never public semantic input.
Several Deliveries can exist for one target, including parallel fresh
reconnaissance. Each owns a separate Control Record Store and Candidate. Exact
Candidate writes and canonical transactions remain subject to their runtime
concurrency classes.

One disposable runtime read-model layer makes those independent Deliveries
inspectable without becoming another Process or continuity carrier. Its
target-scoped Delivery Inbox enumerates exact Store identities, and its selected
Delivery View joins reducer state, current subjects, Attempt interpretation,
Decision Readiness, exact Candidate difference, and bounded Control inspection
under one disclosed read coordinate. The views are derived, non-retained, and
incapable of creating authority or operation eligibility. The TUI can execute
only reducer-eligible non-authority operations through the canonical CLI;
Founder-authenticated operations remain explicit authority handoffs.

### Delivery Control Record Store

Every Delivery has one runtime-owned, off-HEAD SQLite Control Record Store as
its primary Control carrier. It retains exactly twelve standard record
families:

- Founder Brief;
- Agent Attempt;
- Agent Work Product;
- Execution Receipt;
- Candidate Revision;
- Work Boundary;
- Material Condition;
- Founder Decision;
- Candidate Seal;
- Check Receipt;
- Evidence Packet; and
- Closure.

The same store retains one closed twenty-two-kind append-only event chain.
Record revisions own typed facts, readable semantic Markdown, relationships,
and logical identity. Events own only the lifecycle occurrence and Process
consequence that caused a referenced revision to affect reduction. The runtime
operates internally on typed values and events; retained Markdown is not
transient IPC between runtime functions. No mutable current-state row,
independently retained post-Attempt dossier, protected Git route,
repository-visible retained Control carrier, or component-promotion route
participates in rc.10.

The Delivery reducer is the sole legal Process state machine. Every mutation
is composed through an operation definition that owns its eligibility
requirements, immutable semantic plan, Execution Specification where physical
execution is required, result validation, and operation-specific Control
compilation. One common Activity kernel owns durable opening, atomic checkpoint
and Journal coordination, exact recovery, completion, and support disposal.
The subordinate Execution Backend owns only Cell mechanics. Neither operation
support, a Backend, nor an owner-specific adapter retains a second workflow-stage
DSL.

Only Candidate Revision and Work Boundary have successive revisions. Every
other family is single-revision under a fresh record identity. The event fold,
not the latest row, derives current subjects, standing, activities, recovery,
Candidate condition, and operation eligibility. Product Knowledge stays in its
repository owners. Candidate product bytes stay in immutable Candidate Revision
Carriers selected by Control but physically owned outside the Store; neither
Knowledge nor Carrier bytes are stored as Control in SQLite.

### Work Boundary

A Work Boundary is one immutable revision carrying Delivery's proposed or
active mandate and final comparison basis. Reconnaissance produces a Founder
Brief, Agent Attempt, submitted Agent Work Product, truthful Execution Receipt,
and exact proposal semantics. The runtime compiles those inputs into one
complete Work Boundary revision, then runs the baseline Checks against that
exact revision. Before admission, the complete modality-valid Receipt set and
successful preparation make that revision proposed. A Founder-authenticated
`admit` or `readmit` Decision selects the exact same revision; an observed
successful transaction makes it active. For initial admission this active
standing precedes the required Candidate observation and exposes only exact
recovery until that observation is durable. Admission does not copy the
mandate into another record.

A changed mandate produces a later immutable revision of the same Work
Boundary identity. It references the active predecessor and frozen Material
Condition. A reaffirmed mandate can reproduce the prior semantics only through
a new exact revision that records the fresh basis and resolution rationale.
Historical revisions remain addressable. Proposed, active, superseded, and
unselected are reducer-derived standings rather than stored status fields.

One Work Boundary revision selects one coherent product result and binds:

- the founder objective and selected meaning;
- included and excluded outcomes;
- exact knowledge identities and revisions;
- obligations and falsifiers;
- product effects and risks;
- required artifacts and Description coverage;
- required Check Definitions and execution bindings;
- acceptance propositions;
- the Capability Profile;
- repository, specification, Knowledge Set, and the exact Atlas basis carried
  by `atlasStateDigest`, `atlasResolutionDigest`,
  `atlasNormalizedModelDigest`, and `atlasResourceBindingsDigest`; and
- the exact baseline Checks whose later Receipts determine proposal readiness;
  and
- the exact final Checks whose Receipts evaluate one sealed Candidate.

A Work Boundary records a result, not an itinerary. It cannot be inferred
retroactively from an implementation, provider return, or Process state.
Founder admission authority resides in the separate exact Decision and applied
transaction event rather than being copied into the Boundary.

The runtime finalizes a Boundary before running its required baseline Checks so
each Check Receipt can point backward to the exact revision it checked. The
Boundary becomes proposal-ready only when the event fold finds the complete
modality-valid Receipt set. Preconditions and regression guards pass, repair
targets can retain their expected baseline failure, and postconditions can
retain their required baseline `not-run`; a generic all-pass rule cannot replace
those declared temporal meanings.

### Knowledge Projection

A Knowledge Projection is a deterministic, immutable compilation of the exact
knowledge required by one role for one Work Boundary at one repository state.

The projection contains:

- a compact mandatory core that remains in working attention;
- the complete supporting semantic closure;
- provenance and inclusion reasons;
- detected conflicts and unresolved references;
- a reachable-context index for bounded on-demand retrieval; and
- an omission manifest that proves nothing required was silently truncated.

Different roles receive different projections from the same authority basis.
Reconnaissance needs context for product judgment. A builder needs the exact
mandate, affected semantic owners, implementation coverage, and verification
obligations. A reviewer needs the same authority basis plus the sealed result
and evidence. Presentation can differ; selected meaning and source identity
cannot.

An Agent can cite one exact unambiguous mounted reachable item through the
Agent Work Product `projection` citation kind. That citation remains
agent-proposed claim support: it does not promote reachable repository reality
into Knowledge, source context, Candidate material, Evidence, boundary
authority, or Work Boundary selection.

### Agent Attempt

An Agent Attempt is one provider-neutral execution contract. It binds:

- one role;
- one fresh Founder Brief finalized for that exact agent activity;
- one active Work Boundary for an execution role, or one exact Orientation
  subject for reconnaissance before a boundary exists;
- one Knowledge Projection;
- one exact Candidate Revision and Carrier or another read-only Input Set,
  according to role;
- one capability profile;
- one Execution Backend Profile and exact Execution Image;
- one caller-funded Investment;
- one exact Role Brief and governed semantic-body template;
- one controlled authoring, parser, Work Product Compiler, and cell-runner
  profile; and
- one provider adapter and enforcement contract.

The runtime compiles the Attempt into one exact Execution Specification. A
subordinate Backend allocates one disposable Cell for that complete Attempt and
materializes its exact Input Set. The provider receives the contract through an
adapter such as `codex exec` inside that Cell. The adapter can change without
changing product or Process semantics when its exact contract remains
compatible.

The Agent edits only the semantic Markdown body in its governed workspace. It
can make several revisions during the invocation, use tools, inspect the
Candidate, and correct the same draft before submission. Intermediate edits
are not Control revisions or Journal events. The submitted body contains only
agent-proposed semantics and Attempt-local handles. It does not reproduce
Attempt, invocation, role, subject, repository, identity, ordering, digest,
front matter, SQL, or transport mechanics.

Foundation rc.10 includes no provider-visible semantic-validator command,
private validator endpoint, or live validity response. The Cell runner may
materialize the governed draft and collect it, but it cannot validate the draft
on the provider's behalf or present a provisional validation result as Runtime
truth.

At submission or terminal observation after Execution Containment, the runtime
retrieves the complete bounded Output Carrier and independently validates its
Manifest and bytes. It reads the exact workspace without following links,
normalizes equivalent line endings, and parses the body
under the Attempt-selected profile, and rejects malformed syntax, unresolved
references, or invalid semantic combinations as an `invalid-result`. After a
valid parse, the deterministic Agent Work Product Compiler:

- injects the fixed Attempt, invocation, role, subject, Projection, and
  authority-class bindings;
- resolves exact Knowledge, source, Candidate, Evidence, boundary, and
  mounted-Projection references;
- assigns global identities to return-local objects;
- normalizes and orders every set-like value;
- renders one canonical semantic Markdown body from the parsed value;
- retains one immutable Work Product revision with typed normalized semantics
  and that exact runtime-canonical readable Markdown body; and
- computes its logical revision, body, and fragment digests.

An invariant failure after valid runtime-normalized parser output is a
`runtime-failure`, not agent fault and not an `invalid-result`. The Receipt
keeps provider observation, workspace observation, parser, compiler, and
retained revision provenance distinct. A final invalid submission retains only
its diagnostic code, stage, and failure-facts digest; it does not retain draft
excerpts or an authoring transcript. Provider terminal text is bounded
operational output, not a second semantic return. Raw provider bytes and event
streams can be retained only as explicitly typed, bounded adjacent files and
are never implicitly promoted into Control semantics or Evidence.

An Attempt ends naturally, by timeout, cancellation, provider failure, explicit
submission, or an observed terminal without a valid submission. A fresh
Attempt can continue valid Candidate work only from the reducer-selected
Candidate Revision and Carrier, the same current Process subjects, and a fresh
Investment. Provider session history, a prior Cell, and a materialization are
never required for correct continuation.

### Execution Backend and Cell

Execution is a private subordinate mechanism, not another Process or public
workflow. The runtime selects one exact Execution Backend Profile and compiles
one immutable Execution Specification and Input Set for each Agent Attempt or
Check execution. The Backend allocates one disposable Execution Cell and
returns one opaque private Execution Handle. A materialization is created by
the Backend from the immutable inputs and does not enter the Specification's
logical identity.

The private contract is:

```text
allocate(specification, allocationKey)
  -> dispatch(handle)
  -> observe(handle) | cancel(handle)
  -> retrieve(handle)
  -> reclaim(handle)
```

Allocation is idempotent only for the same separately generated private
allocation key and Specification. Dispatch authority is durably consumed once
before the Backend is called. An uncertain dispatch can be observed, contained,
retrieved, and retired, but never dispatched again. Authoritative proof that
the exact retained Handle's Cell is absent before dispatch consumption, with
complete direct no-process, no-writer, no-credential, no-channel, immutable
output, and no-output facts, permits no-effect Retirement without recreating or
dispatching that allocation. The exact Cell being absent after dispatch
consumption produces terminal unavailable output, not evidence that execution
never started. Ambiguous identity or liveness remains recovery-required and
cannot be normalized into absence or Containment.

Containment proves that the Cell has no continuing process or writer in its
granted boundary. Retirement is the runtime-owned durable decision that
Lifecycle will never dispatch or productively reuse the Handle and that output
disposition and Reclamation ownership are final. Reclamation proves later
physical absence of the exact backend allocation. Activity completion and
Closure require Containment and Retirement, not completed Reclamation.

The first production selection is the Docker Execution Backend with one exact
local-engine profile. A Cell receives no Docker control socket, target-repository
mount, Founder authority, or general runtime-private filesystem root. Provider
control-plane authentication and network are separate from Agent product
capability; a profile that cannot keep credentials out of the Agent tool
environment and prevent service connectivity from becoming general Agent
egress is unsupported. The deterministic fault-injection Backend is test
infrastructure only and is never a production fallback.

Execution Cells remain behind existing Delivery operations and
`delivery.recover`. There is no Cell, container, Backend, materialization,
Retirement, or Reclamation operation in the CLI, TUI, runtime protocol, or
Delivery reducer. Public views and Receipts may expose only stable sanitized
digests and effective limits, never Handles, container identifiers, daemon
endpoints, credentials, private paths, or Reclamation coordinates.

### Execution Receipt and derived Process feedback

Every terminal Agent Attempt produces one truthful immutable Execution Receipt,
including incomplete reconnaissance. The Receipt references its exact Attempt,
optional submitted Work Product, exact input Candidate Revision where
applicable, and optional promoted successor Candidate Revision. It binds the
stable Backend Profile, Execution Image, Specification, Input Set, Output
Carrier and Manifest dispositions, provider and workspace observations,
parser/compiler disposition, Containment, and Retirement. It does not repeat
the complete Attempt configuration, embed raw provider bytes, or expose a
private Handle or Reclamation coordinate.

For a builder, Cell output remains provisional after provider termination. The
runtime first establishes Containment, retrieves and validates the complete
output independently, publishes its immutable Candidate Revision Carrier, and
only then atomically retains the successor Candidate Revision and event. A
valid unchanged output may reuse the input Carrier. A missing, incomplete,
corrupt, repository-invalid, Atlas-changing, or otherwise rejected output
creates no successor. The input Revision remains current because the Candidate
never advanced; this is not rollback or predecessor substitution.

Provider outcome, Work Product validity, and Candidate advancement are
independent. A timeout, cancellation, provider failure, or invalid semantic
submission may still yield a complete valid successor after Containment. A
valid Work Product cannot promote invalid physical output. A reviewer observes
the exact already sealed input Revision without creating a successor; any
mutation invalidates that evaluation coordinate. Provider prose and Cell claims
never supply Candidate facts.

Attempt status, conclusions, obligation views, Material Condition status,
Evidence currentness, and eligible operations form a reducer-generated Attempt
View over the Attempt, Work Product, Receipt, Candidate Revision, and current
event head. The Attempt View is not an independently retained record family.
Every new invocation remains independently funded. Failure, timeout, or context
exhaustion ends only that invocation unless a durable effect needs exact
recovery or the admitted mandate itself can no longer govern the Candidate.

### Candidate

A Candidate is Delivery's sole reversible development product-state object.
After the initial admission effect is observed applied, the runtime initializes
it from the selected immutable product base under the admitted Work Boundary,
before the first productive Agent Attempt. It persists across independently
funded builder Attempts, bounded correction, and compatible readmission through
its immutable Candidate Revision lineage and exact Candidate Revision Carriers.
It remains noncanonical until accepted. Disposable materializations and Cells
are physical execution support rather than Candidate continuity.

**Working Candidate** and **Sealed Candidate** describe the same Candidate's
present lifecycle condition. They are not new product objects, record families,
or identities. The Candidate is working while productive attempts or correction
remain possible. Evaluation freezes its exact current state and produces one
immutable Candidate Seal; that Seal identifies the evaluation subject but does
not create another Candidate or make it canonical. If correction resumes, the
prior Seal remains immutable but ceases to describe the Candidate's current
state. A later evaluation produces a new Seal.

Candidate identity includes its immutable base. Every Candidate Revision binds
one exact valid state, predecessor when applicable, logical state digests, and
one immutable content-addressed Carrier sufficient to reconstruct that state.
The event fold selects the current Revision; no row, physical path, or latest
Carrier stores mutable currentness. The initial admission publishes the first
Carrier before selecting its Revision. A readmission successor reuses the exact
current Carrier while changing the governing Boundary. A builder successor is
selected only after output validation and durable Carrier publication.

An Execution Receipt binds the input and optional successor. A Candidate Seal
selects one exact Revision and validates its Carrier for evaluation. Acceptance
imports that sealed Carrier and applies its exact tree over the unchanged
admitted parent through the terminal transaction. Loss or corruption of a
Carrier needed by an active or recoverable Revision is an integrity or
availability failure; the runtime never falls back to a predecessor.

The Candidate can survive a timeout, provider interruption, lost Cell, local
Check failure, malformed Agent return, review rejection, or bounded correction
because continuity does not depend on the provisional materialization. A
canonical Product State change outside the Candidate can invalidate
conservation when it changes the bound basis.

### Check Definition, Binding, and Receipt

Lifecycle separates four concepts that are often collapsed into "tests":

```text
Check Definition -> what must be falsifiable
Check Binding    -> how this repository obtains evidence
Check Receipt    -> what happened for one exact subject and environment
Acceptance       -> whether the evidence supports the admitted proposition
```

A Behavior or Assurance can require one or more Check Definitions. A Blueprint
or Description can also define structural or implementation-local checks.
Bindings select registered commands, inspections, artifacts, diffs, analyses,
or other allowed evidence mechanisms. Receipts bind the mechanism result to an
exact Candidate Revision and environment. Each executed Check receives one
fresh Cell compiled from its exact Binding, Candidate Revision Carrier, Backend
Profile, Execution Image, and bounded Input Set. The Check runner is an
Execution Image role, not a second meaning of Execution Cell and not a host
process fallback.

A Receipt keeps three execution-condition classes distinct: what the admitted
Binding requested, what the runtime directly enforced and verified, and what
the Backend or host merely supplied or left as an explicit assumption. It also
binds the stable Specification, Input Set, Output Manifest, Containment, and
Retirement observations required to reproduce the exact execution claim. The
runtime derives those classes; Backend metadata, Check configuration, or
command output cannot promote one into another. A passing Receipt establishes
the Check proposition only under its recorded conditions and limitations. It is
evidence, not automatic acceptance. Public Check facts never expose the private
Execution Handle, allocation key, backend coordinate, or Reclamation ledger.

### Evidence Packet

An Evidence Packet binds the exact Candidate Revision and Seal, final Check
Receipts, independent reviewer Work Product and Receipt,
proposition-by-proposition decisions, reviewer independence, unresolved
uncertainty, and active Work Boundary. It is immutable acceptance support.
Artifact and Description-coverage observations, Receipt-reuse and invalidation
decisions, reviewer-independence facts, proposition decisions, and obligation
states are normalized ledgers owned by the Packet rather than separate
deterministic Control families. Every ledger entry preserves its original
runtime, Check-host, Agent, or repository provenance.
Its repository basis retains the admitted canonical Product State and Knowledge
Set, while its Seal binding retains the Candidate-derived Product State and
Knowledge Set. Both identities are exact and they are not required to be equal.
The admitted Atlas snapshot remains the context and proof basis for both. Later
canonical movement is prohibited while the active-Delivery branch lease exists;
an observed mismatch blocks the active operation without changing the Packet's
historical subject.

Evidence does not grant authority. It allows an authorized decision to be made
about the exact supported result.

### Closure

Closure records the terminal disposition of a Delivery. Delivery closes as
accepted or no-ship. Closure references the exact Founder Decision and applied
transaction, preserves which Candidate Revision supplied the exact accepted
tree or became abandoned, which Evidence governed acceptance when applicable,
and the exact Containment, Retirement, Candidate, and terminal facts needed to
make Store sealing eligible.

No-ship can close an unsuccessful fresh preparation before any Work Boundary
or Candidate exists. In that case the Decision and Closure truthfully omit both
subjects. If a proposed or active Boundary or Candidate does exist, the
Decision and Closure bind the exact applicable revisions; sparse early closure
cannot erase a subject previously established by the event fold.

An accepted Closure records Candidate treatment `integrated` because
acceptance applies the exact sealed Candidate tree over the exact admitted
parent. Candidate confinement proves that tree has no Atlas delta. No-ship
records `abandoned` when it permanently ends advancement and acceptance of an
existing Candidate and `not-created` when reduction proves that no Candidate
ever existed. `Abandoned` is a logical terminal disposition, not a claim that
every Carrier byte has already been erased.

Before Closure, every dispatched Attempt or Check selected by the reducer is
contained and retired, and every remaining backend allocation has been durably
handed to the installation-private Reclamation ledger. Completed physical
Reclamation is not a Closure precondition. A Reclamation interruption leaves
only a non-dispatchable, non-reusable allocation and a visible private
obligation; it cannot reopen Process activity, restore Candidate authority, or
block Store sealing. The terminal transaction never substitutes one allocation
or root for another and never treats broad host cleanup as proof about an exact
Cell.

Candidate Revision Carriers are retained content-addressed evidence while a
live or archived Control Store references them. Their reachability and later
policy disposal are distinct from backend Cell Reclamation. A Carrier cannot
be removed merely because its materialization or producing Cell was retired.

Closure is process truth. It does not become Product Knowledge and cannot
replace a Behavior, Assurance, Blueprint, Description, Atlas source, or code.
Once Closure is the event head, the runtime verifies every retained file,
seals the logical Control inventory, closes the SQLite database, writes a
retrieval manifest, and atomically archives the complete Delivery store off
HEAD. The archive is retained by default but can later be exported or disposed
under explicit policy. The SQLite file's byte digest is retrieval integrity,
not semantic identity.

`closure-recorded` is the final Journal event and atomically completes the
terminal activity. If sealing or archiving is interrupted after Closure,
`delivery.recover` resumes only that exact post-Closure boundary. It appends no
new event and cannot change terminal Process truth.

## The Complete Relationship

```text
broad project context
    Atlas, research, decisions, external sources
        |
        | exact resolved Atlas context and typed sources
        v
validated Knowledge Set
    Behavior, Assurance, Blueprint, Description, Check Definition
        |
        | Founder objective + Orientation Projection
        v
Founder Brief + reconnaissance Agent Attempt
        |
        | Agent develops and submits governed semantic Markdown
        v
Agent Work Product + truthful Execution Receipt
        |
        | runtime compiles one complete Boundary, then exact baseline Checks
        v
complete proposed Work Boundary Revision
        |
        | Founder authenticates one exact admit Decision;
        | runtime observes the transaction applied
        v
same Work Boundary Revision becomes active
        |
        | recover-only until initialization observation is durable
        v
Candidate Revision initialized
        |
        | deterministic builder Projection + fresh funded invocation
        v
bounded builder Agent Attempt
        |
        | runtime compiles exact Specification and Input Set;
        | backend allocates and dispatches one private Cell
        v
provisional authoring materialization + submitted semantic body
        |
        | contain; retrieve; independently validate Manifest, bytes, and Git;
        | publish Carrier before one atomic successor event
        v
optional successor Candidate Revision + truthful Execution Receipt
        |
        | reducer-generated Attempt View; Cell is retired and later reclaimed
        v
continue/correct, resolve boundary, evaluate, or no-ship
        |
        | every continuation receives fresh Investment;
        | local defects stay inside the active mandate
        v
Working Candidate
        |
        | seal one exact current Candidate Revision
        v
Candidate Seal
        |
        | final Checks and fresh reviewer each execute in one private Cell
        v
Evidence Packet
        |
        | Founder authenticates accept or no-ship Decision;
        | runtime records intent and truthful transaction observation
        v
exact sealed Candidate result over the unchanged admitted parent,
or truthful no-ship disposition
        |
        | Candidate disposition + exact Containment and Retirement + Closure
        v
sealed and archived Control Record Store off HEAD
        |
        | installation-private bounded Reclamation, outside Process truth
        v
eventual absence of retired backend allocations
```

The Control Record Store's append-only events, pure reducer, exact recovery
facts, and controlled support resources operate beneath this complete route.
They retain lifecycle-significant durability boundaries and derive standing,
activities, current subjects, recovery, Candidate condition, and eligibility.
They are not a Founder-operated stage or a transcript of edits, commands,
tests, intermediate drafts, or model reasoning.

Execution Specifications, Handles, Cells, and the Reclamation ledger operate
below the same route. They implement an eligible Delivery operation; they do not
add an operation, state machine, user-visible stage, or alternate recovery
subject. `delivery.recover` reopens the reducer-selected Activity and privately
reconciles its one exact Handle.

The linear path shows acceptance. No-ship is not gated on an Evidence Packet.
When eligible, one authenticated Founder Decision selects the exact Candidate
disposition and reason. The runtime then performs the recoverable no-ship
transaction, abandons the Candidate without integrating product bytes, retires
every selected execution, records Closure, and archives the same complete
store. Backend Reclamation may finish later without changing that truth.

The arrows through an Agent Attempt preserve distinct provenance planes. The
working file proves only the bytes available at observation. The normalized
semantic value proves only what the strict parser understood. The immutable
Agent Work Product proves what the runtime retained under fixed Attempt
bindings. The Execution Receipt proves observed provider, output, Containment,
and
Retirement facts. A Backend observation proves only the physical fact it is
defined to observe. No plane substitutes for another, and none by itself
establishes Candidate advancement, product Evidence, or Founder authority.

The system contains two thin waists:

- the **Semantic Thin Waist** connects broad project context to implementation
  through stable, typed, independently owned knowledge; and
- the **Operational Thin Waist** connects that knowledge to one execution
  through the Work Boundary, Knowledge Projection, Agent Attempt, and typed
  Control lifecycle.

Neither waist transfers ownership. The Work Boundary selects meaning but does
not become the long-term owner of that meaning. The projection supplies context
but does not rewrite its sources. The attempt grants capability but not product
or founder authority.

## Intelligence Allocation

Lifecycle supports heterogeneous models by assigning intelligence where its
marginal value is highest.

A high-capability model is appropriate for:

- reconnaissance across ambiguous project context;
- selecting product meaning and tradeoffs;
- identifying the required knowledge closure;
- proposing or revising a Work Boundary;
- interpreting Material Conditions;
- splitting broad objectives into independently valid Deliveries;
- deciding whether another invocation deserves investment; and
- independent review of high-consequence results.

A lower-cost model is appropriate for:

- implementation inside a narrow coherent Work Boundary;
- local code and test repair;
- deterministic transformations;
- repetitive artifact completion; and
- bounded evidence preparation.

The lower-cost model receives denser context and a more explicit obligation
ledger. The runtime, not the model, enforces required artifacts, Check
execution, sealing, proposition coverage, state transitions, and canonical
motion.

Lifecycle SHOULD prefer a narrower boundary and better projection over
continuous high-capability supervision. A live supervisor adds another context,
another interpretation, and another failure surface. It is justified only when
a named material consequence cannot be contained by capability restrictions,
explicit conditions, and closing evidence.

## Trust and Security Boundaries

Project content, Atlas records and Resources, repository files, provider events,
and agent returns are untrusted inputs. They MUST NOT:

- grant tool, filesystem, network, credential, or external-effect authority;
- raise their own instruction priority;
- change the active Work Boundary;
- substitute a new Knowledge Projection;
- waive a Check or acceptance proposition;
- authorize canonical motion; or
- disclose founder authority material.

Capability is granted only by the runtime's exact execution profile. Product
effects describe what the accepted product may later do; they do not grant the
builder permission to perform those effects while implementing it.

The Lifecycle Runtime, not an Agent or Check Cell, owns Backend authority. A
Cell receives neither a Docker control socket nor a target repository mount and
cannot allocate, dispatch, recover, or reclaim another Cell. The Backend is
trusted only for the exact observations its selected profile can establish;
the runtime independently validates retrieved output before it becomes Control,
Candidate, or Evidence truth.

Provider authentication and provider service connectivity are control-plane
support, not product-network capability. An Execution Backend Profile is
unsupported unless it keeps credential bytes outside Agent-visible tools,
product files, output, and logs, and prevents the permitted provider channel
from becoming unreported general Agent egress. Public Control and protocol
carriers retain only stable sanitized digests and effective limits.

## Information Closure

Expanded attempt state is useful while a Process can still act on it. It becomes
operating cost after terminal disposition.

Before terminal sealing, the Process owner selects durable meaning for its proper
carriers:

- accepted product meaning remains in governed Knowledge and code;
- Delivery Control, Evidence, terminal Decision, Closure, and bounded Process
  milestones remain together in the sealed per-Delivery Control Record Store;
- reusable project context remains in Atlas or another source owner;
- adjacent large operational files remain only when referenced by exact digest
  and explicit retention purpose;
- Candidate Revision Carrier manifests remain adjacent Control files and their
  content-addressed Git object closures remain in the Carrier Store while a
  live or retained archived Store references them;
- governed working documents, temporary prompts, provider events, transcripts,
  caches, provider state, private Handles, and redundant snapshots become
  unreachable for productive use before sealing; and
- every retired backend allocation not yet physically absent remains an exact
  installation-private Reclamation obligation rather than a false cleanup
  claim in Closure.

The complete store archives off HEAD as one bounded unit. SQLite page bytes do
not define semantic identity: record revisions, relationships, event chain,
Closure, and the logical terminal inventory do. Export is a generated
inspection representation, not another primary store.

## Specification Scope

This specification defines:

- authority and truth classes;
- governed Knowledge records and relationships;
- deterministic Knowledge Projection;
- provider-neutral Agent Attempts;
- subordinate disposable execution and reconstructible Candidate continuity;
- Delivery Process semantics;
- evidence and independent acceptance;
- validation and conformance; and
- immutable specification publication identity, authenticated lifecycle
  status, and release-note binding; and
- evolution rules for these contracts.

It selects and defines Lifecycle's consumer relationship to one exact external
Atlas contract but does not redefine Atlas format, organization, Checks, or
publication semantics. It does not define product-specific Behavior,
Assurance, Blueprint, Description, or Check content. It does not require one
provider, model, repository host, programming language, build tool, deployment
system, or user interface.

Release, deployment, post-release observation, and portfolio planning can be
specified as later Processes or external systems. They MUST NOT be inferred as
part of Delivery merely because a provider can technically perform them.
