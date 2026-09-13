# Foundation Runtime

`runtime/` turns a permitted request into exact observations, retained facts,
and, when authorized, a canonical effect. It implements Lifecycle Foundation
`1.0.0` at qualification revision rc.17, repository contract v22, runtime
protocol v17, and Provider Adapter v7. It supports fresh Foundation targets;
predecessor and mixed state is refused before interpretation or effects.

The [integrated specification](../spec-source/SPEC.md) establishes what must
remain true. This overview explains how the implementation owners cooperate
to make those requirements executable. Start with [getting started](../docs/getting-started.md)
for the Delivery model and [source setup](../docs/source-setup.md) for build
commands and operating prerequisites.

The central distinction is between current state and a justified transition.
The Process reducer derives what is currently true from the Journal. An
operation owner constructs the exact subject, permitted work, and observations
needed for its transition. Evidence interprets support for an evaluated result.
Director custody authenticates the decision, and the canonical transaction owner
establishes what physically applied. The Activity kernel coordinates durable
progress among these owners without deciding their domain meaning.

SQLite, independent Git repositories, Docker Cells, and the fixed provider
runner implement these boundaries. They are selected mechanisms, not substitutes
for the laws or separate user workflows. Their interrupted paths must preserve
the same subjects and allow the promised continuation. The [connected Runtime
tests](tests/overview.md) exercise that composition
with real Git and SQLite and deterministic external responses. Installed,
image/backend, live-provider, and release claims have their own [qualification
boundary](../qualification/verification.md).

## Ownership

```text
src/foundation/  current rc.17 source owners
  control/        SQLite Store, Control compilers, inspection, sealing, archive
  knowledge/      Knowledge sources, relationships, coverage, and sets
  draft/          local form discovery and advisory draft inspection through those owners
  projection/     Orientation and role-specific Projection compilation
  execution/      Specifications, Input Sets, Backends, Cells, Retirement,
                  and Reclamation coordination
  attempt/        provider-neutral Attempt and Agent Cell integration
  candidate/      Carrier construction, verification, materialization, sealing
  check/          Check Cell input, output, and observation integration
  evidence/       semantic assessment, Foundation provenance, exact acceptance verification
  process/        sole Delivery reducer, Activity kernel, operation owners,
                  eligibility, atomic successor coordination, and recovery
  transaction/    admission and terminal transaction meaning
  repository/     contract v22, authority, observation, and Git transactions
  validation/     strict JSON, schemas, canonicalization, and diagnostics
  support/        bounded filesystem mechanics shared by Foundation owners

src/cli.ts        sole CLI dispatcher and public failure rendering
src/cli-help.ts   exact Foundation command and help inventory
src/version.ts    package, protocol, publication, and provider coordinates
bin/              Node selection, authority transport, signals, parent lifetime
tests/            deterministic package-local tests and runtime-seam qualification
```

Within `attempt/`, the Agent Cell adapter binds provider-neutral Attempt meaning
to the fixed Cell runner. Installed profile, policy, image, input, observation,
and output mechanics remain behind `execution/`; callers do not import backend
implementation modules directly.

The preparation, Candidate-agent, integration, evaluation, admission, and
terminal owners supply route-specific eligibility requirements, immutable semantic plans,
physical effects and observations, and Control compilation.
`process/activity-kernel-v7.ts` supplies their shared durable mechanics.
`runtime-mutation-v7.ts` is the thin public compositor: it binds the request,
lock, Store, and reducer coordinate, then delegates to the selected owner. It
does not reproduce an operation workflow.

The owner boundary also limits capability. Ordinary composition asks the
execution, authority, and canonical owners for one exact effect; it does not
receive their general Engine, signing, or Git-write primitive. These are
in-process API restrictions. Stronger physical privilege separation would need
its own enforced and qualified deployment boundary.

Delivery is the only Process. Cells, private support, and Reclamation add no
second set of user operations. Recovery follows either the reducer's exact
Activity coordinate or the post-Closure Store disposition; it does not select
new work from a private backend phase.

## Implementation owners

The source separates domain meaning from shared durable mechanics:

| Responsibility | Source owner | Normative contract |
| --- | --- | --- |
| Control records, revision integrity, sealing, and Store disposition | [Control](src/foundation/control/) | [Control](../spec-source/spec/CONTROL.md) |
| Delivery state and operation coordination | [Reducer](src/foundation/process/delivery-reducer.ts) and [Activity kernel](src/foundation/process/activity-kernel-v7.ts) | [Delivery](../spec-source/spec/DELIVERY.md) |
| Candidate Revision Carriers and integration | [Candidate](src/foundation/candidate/) | [Delivery](../spec-source/spec/DELIVERY.md) |
| Execution Cells, custody, and backend mechanics | [Execution](src/foundation/execution/) | [Execution](../spec-source/spec/EXECUTION.md) |
| Agent semantic output and provider integration | [Attempts](src/foundation/attempt/) | [Attempts](../spec-source/spec/ATTEMPTS.md) |
| Exact admission and terminal effects | [Transactions](src/foundation/transaction/) | [Authority](../spec-source/spec/AUTHORITY.md) |
| Coherent current and historical inspection | [Read models](src/foundation/read-model/) | [Delivery](../spec-source/spec/DELIVERY.md) |
| Command parsing and public output | [CLI dispatcher](src/cli.ts) and [help](src/cli-help.ts) | [Public Runtime boundary](#public-runtime-boundary) |

These implementation owners enforce the selected contracts. The specification
retains normative authority; a source mechanism does not redefine product meaning.

## Public Runtime Boundary

`lifecycle draft` is local authoring assistance outside the target operation
facade. `forms` renders installed formats; `knowledge WORKSPACE PATH...` reads
the explicit local record set, including untracked and unstaged authoring, and
reports exact source and semantic digests plus local revision lineage.
`semantic WORKSPACE PATH --basis ABSOLUTE_FILE` checks supplied Markdown against
the exact supplied immutable authoring basis. These commands dispatch before
target configuration or Store/backend custody. They do not observe a live
Delivery, change files, or turn a local result into authority.

The report names the bytes, parsing basis, checked scope, exclusions, and next
correction. Knowledge inspection requires every local revision in the selected
chains and excludes repository-wide closure. Runtime independently validates
the final collected Candidate and semantic submission. The same supported
Runtime package is available in the Execution Image; its presence does not
supply target mounts, backend sockets, or Director custody. Installed-image and
provider operation remain separate qualification claims.

The selected v17 facade accepts exactly these operations:

```text
repository.initialize  repository.validate
delivery.status        delivery.inbox         delivery.prepare
delivery.admit
delivery.continue      delivery.integrate     delivery.evaluate
delivery.revise
delivery.reaffirm      delivery.accept        delivery.no-ship
delivery.recover       delivery.inspect       delivery.diff
delivery.watch         delivery.export
```

`delivery.prepare` takes one complete fresh Director Brief and creates one fresh
Delivery. Every later request for that Delivery names its exact returned
identity; Inbox and Inbox watch remain target-scoped. Another `prepare`
request creates another Delivery and another
Control Record Store; it does not append another preparation activity to the
first Delivery or inherit its Brief, provider conversation, or hidden state.

The ten Delivery operations are `prepare`, `admit`, `continue`, `integrate`, `evaluate`,
`revise`, `reaffirm`, `accept`, `no-ship`, and `recover`. Admission and
readmission share `delivery.admit`, qualified by the reducer-derived standing.
No-ship is one authenticated operation carrying the exact reason and supported
Candidate disposition. Recovery accepts no replacement judgment or authority;
it resumes only the exact retained obligation.

`delivery.integrate` observes and retains an exact current canonical parent,
merges the continuing Candidate in an independent repository, and retains the
Integration Assessment. A clean validated result advances the same Candidate;
a governing-context change freezes that result for readmission. Conflict or
invalidity preserves the source Candidate. Recovery reopens the retained parent
and merge rule. Canonical publication later compares and swaps only the exact
accepted parent and result.

Each non-recovery route opens or continues its activity through the common
Activity kernel. `delivery.recover` first selects the sole reducer-derived
activity or post-Closure Store-disposition obligation, then calls the owner of
that exact coordinate. Store seal and archive are a physical disposition branch
outside operation definitions and the Activity kernel; they append no event
after Closure. The dispatcher never selects an operation from support payload
state or a newest-looking record.

Delivery mutation requests carry `schema`, `target`, `operation`, and the
operation's bounded input. Every existing-Delivery mutation additionally
carries its exact `deliveryId`; `delivery.prepare` does not. The Runtime derives
repository and Process subjects, activity identity, provider configuration,
Investment, authority subjects, transactions, times, ordering, digests, and
storage mechanics. Callers do not submit a reducer state, database path, event,
record envelope, or transition. Continue, integrate, evaluate, revise, and
reaffirm bind the Runtime-issued read generation against which their input or
integration selection was reviewed. Repository and read-only operations have
their own closed request shapes.

Every result contains one coherent repository observation, a nullable Delivery
observation, bounded change facts, new event and record references when
applicable, diagnostics, and a canonical result digest. `inspect` and `export`
provide bounded read-only views. Results never expose authority secret bytes,
credentials, physical custody roots, Execution Handles, container identifiers,
Docker endpoints, materialization paths, Reclamation coordinates, transaction
locators, or another Delivery's Control. The rc.17 protocol may bind only the
stable Backend Profile, Execution Image, Specification, Input Set, Output
Manifest, output disposition, and terminal-observation facts selected by its
normative Receipt and Evidence contracts.

The disposable read-model layer supplies a target-scoped Inbox and one coherent
selected Delivery View. The latter joins reducer, Attempt, Candidate, Evidence,
Decision Readiness, and Control facts under one read generation. `diff` owns
exact bounded Candidate difference; `inspect` owns bounded Control, context,
source, and authorization-review reads; `watch`
refreshes an Inbox or selected Delivery generation without retaining state.
The Runtime opens SQLite, interprets retained support, and selects exact Git
subjects. The canonical CLI exposes the complete operation route; authority
commands retain their explicit authenticated subject and secret-file boundary.

## Control Record Store

Every Delivery owns one runtime-selected, off-HEAD SQLite Control Record Store.
The database is the primary Control carrier. It retains immutable typed record
revisions, readable semantic Markdown, exact relationships, one append-only
Journal event chain, referenced-file descriptors, and at most one terminal
seal. There is no tracked `records/control` tree, protected Process Git ref,
mutable state row, duplicated Markdown document graph, or separate Control
index.

The fourteen closed record families are:

```text
Director Brief          Agent Attempt          Agent Work Product
Execution Receipt      Candidate Revision     Work Boundary
Material Condition     Director Decision       Candidate Seal
Check Receipt          Evidence Packet        Closure
Integration Assessment Work Delegation
```

Only Candidate Revision, Work Boundary, and Work Delegation are successive
families. Every other logical record has one immutable revision. The event fold, not a `current`
field or maximum row number, derives current subjects, Delivery standing,
activities, recovery, Candidate condition, and eligible operations.

The Delivery reducer is the sole legal state machine. One common Activity
kernel owns atomic activity opening, immutable plan retention, Journal and
support compare-and-swap coordination, bounded recovery, completion, and
support disposal after exact result finalization and durable Retirement
handoff. Operation definitions own route meaning, Execution Specification and
result compilation, and direct observation. A subordinate Backend performs
physical execution only. Support may retain a bounded opaque Handle and
continuation facts, but no persisted workflow-stage DSL, backend phase, Cell
state, or dispatcher branch can override reducer state.

The closed twenty-five-event Journal is:

```text
delivery-created                 director-brief-submitted
work-delegation-set              work-delegation-stopped
activity-started                 activity-recovery-recorded
agent-pre-intent-refused         agent-attempt-prepared
provider-effect-intended         provider-effect-observed
agent-work-product-submitted     agent-work-product-abandoned
candidate-revision-observed      integration-assessed
execution-receipt-recorded
work-boundary-finalized          material-condition-frozen
candidate-sealed                 check-receipt-recorded
evidence-packet-finalized        director-decision-authenticated
transaction-effect-intended      transaction-effect-observed
activity-completed               closure-recorded
```

Each event has a contiguous sequence and exact predecessor digest. Events own
the lifecycle occurrence and Process consequence;
`transaction-effect-observed` also owns its bounded operation-typed direct
observation facts and runtime-derived facts digest. Referenced revisions own
the durable semantic subjects and their typed payloads. The Journal records
durable operation, provider-boundary, Candidate, Evidence, transaction,
terminal-execution, and Closure milestones; it is not a transcript of edits,
commands, tests, provider events, or model reasoning.

Runtime components operate on validated typed values and events. Within one
record revision, the payload owns operational identities, bindings, enums,
facts, and reducer inputs; the Markdown owns readable semantics. Both live in
the same immutable database revision and one logical digest binds them.
Markdown export is a derived inspection representation, never runtime IPC or a
second retained authority carrier.

The active pre-archive Store root contains only:

```text
control-record-store.sqlite
files/
drafts/
```

`files/` holds bounded content-addressed operational bytes selected by an exact
Execution Receipt or Check Receipt, and the canonical Carrier manifest selected
by each Candidate Revision. There is no general Control blob
service and no free-standing file-retention operation. `drafts/` holds governed
working values and deterministic pending-file carriers only while their exact
window is open; it must be empty before sealing. Candidate Revision Carriers
live in a separate bounded runtime physical owner and are selected by digest;
their Git object closures are not Control files or Store archive members.

The archive driver writes and syncs `archive-manifest.json` into that complete
sealed root, then atomically moves the tree to its distinct off-HEAD archive
location. The archived `drafts/` directory remains present and empty. The
manifest binds retrieval bytes; it is not part of the pre-archive Store tree,
logical Control identity, or Journal.

## Governed Agent Authoring

An Agent Attempt freezes one role, fresh Director Brief, exact subject,
Projection, capability, Investment, provider, Role Brief, and authoring
profile. Under the selected rc.17 architecture, the Runtime compiles those
immutable inputs into one exact Execution Specification and Input Set. When a
Candidate is applicable, the Input Set selects its Candidate Revision and
Carrier manifest and digest; the Backend, not the Specification, creates the
disposable materialization.

The Docker Execution Backend allocates one Cell for the complete Attempt. The
fixed Cell-side runner gives the assigned Agent one governed `semantic.md`
working file. The Agent can inspect and revise that draft across the provider
turns permitted by its Investment. `lifecycle draft semantic` can inspect the
local file against the exact supplied immutable basis without a host callback,
currentness observation, or retained verdict. Runtime independently validates
the collected final file after Containment. Intermediate edits are provisional
work, not Control revisions or Journal events.

The agent authors claims, decisions, rationale, uncertainty, citations, and
proposed effects. It does not construct front matter, SQL, record identities,
fixed bindings, reference digests, ordering, canonical JSON, or transport
envelopes. Provider terminal text is bounded operational output, not the
semantic return carrier.

Either an explicit governed request or the exact final workspace at clean
natural provider completion triggers submission and closes the edit window.
That trigger requests Runtime interpretation; it does not establish that the
submission is valid, supported, or authorized.

After Execution Containment, the Runtime retrieves the exact Output Carrier,
validates its Output Manifest and bytes, parses body-only Markdown, resolves
Attempt-local handles, and compiles one typed Agent Work Product. It assigns
global identities, injects frozen bindings, orders set-like values, renders
canonical semantic Markdown, validates the complete payload, and appends the
Work Product revision with `agent-work-product-submitted`. Equivalent valid
drafts therefore retain byte-identical bodies. The observed draft digest
remains separate Receipt provenance and need not equal the retained body
digest.

Timeout, cancellation, containment failure, and provider failure do not
manufacture a submission trigger. Once containment and output observation
conclusively establish an unreadable workspace or absence of any valid triggered
submission, the Runtime appends `agent-work-product-abandoned` and retains no
Work Product. Unresolved physical observation remains recovery work. Provider
terminal text never substitutes for the workspace.
Malformed agent semantics and a runtime compiler invariant failure remain
different facts.

Work Product disposition and Candidate advancement are independent. A timeout,
provider failure, or invalid semantic draft does not automatically invalidate
a complete Candidate output recovered after containment. Conversely, valid
semantics cannot create a Candidate successor from missing, incomplete,
corrupt, repository-invalid, or Atlas-changing physical output.

The Execution Receipt truthfully records stable provider, Execution Backend
Profile, Execution Image, Execution Specification, Execution Input Set,
Execution Output Manifest and disposition, parser, compiler, Candidate
transition, Containment, Retirement, and selected bounded raw-material facts.
Reclamation remains private installation maintenance. A
reducer-generated Attempt View supplies conclusions, obligation standing, and
next choices from retained facts; it adds no record family or authority.

Codex is the installed standard adapter. Provider-specific execution remains
behind Provider Adapter v7; Work Boundaries, Delivery state, Knowledge, and
Director authority never depend on provider-session continuity.

## Repository, Candidate, And Authority

Fresh initialization requires a clean canonical Git target with a tracked
regular-file `atlas/atlas.md`. It refuses predecessor and mixed Control before
authority creation, installs repository contract v22 and Product Knowledge
roots, establishes one target-specific Director authority identity in the
machine home, and records only its public binding in the repository contract.
The hard replacement avoids dual primary carriers and ambiguous recovery
authority; predecessor Control is refused rather than migrated or dual-read.

The target also contains `records/disciplines/registry.json` and exact adopted
Discipline records. Work Types route discovery to useful guidance; the admitted
selection binds exact records for builder and reviewer context. The Knowledge
owner validates Pack provenance and current copies, while Candidate observation
refuses changes anywhere under this maintenance-only root. The read-only
repository helper `scripts/validate-discipline-pack.mjs` validates external Pack
inventories using the current Knowledge parser before manual target adoption.

The target contains no Lifecycle source, Control Store, `records/control`,
`.lifecycle/runtime`, provider materialization, Candidate allocation, authority
secret, or transaction continuation. Runtime-private installation state remains
physically disjoint from the target and owns Control Stores, immutable
Candidate Revision Carriers, disposable materializations, private Cell support,
authority, exact recovery coordinates, and the Retirement/Reclamation ledger.
Callers select none of those by path.

Authority-bearing operations receive the Director secret through the CLI's
owner-private file boundary. The Runtime constructs and authenticates the exact
Director Decision subject. Repository prose, agent output, interface state, or a
database digest cannot substitute for that authentication.

Each Delivery serializes its mutations under its own operation lock while
other Deliveries continue independently. Short canonical observation and
publication operations serialize under the target's physical Git directory;
publication also compares the exact selected parent. Target, retained-history,
integration, and Agent repositories are independent. Linked worktrees and
shared consumed mutable Git administration are refused.

The integration implementation requires Git `2.45.0` or newer at
`/usr/bin/git` for its fixed tree-input merge and strategy options. It refuses
an unsupported version before retaining integration intent and binds the exact
executable and merge selections into the retained plan.

## Delivery, Evidence, And Closure

After an admission effect is directly observed applied, the same exact Work
Boundary revision becomes active. The Runtime then publishes the initial
Candidate Revision Carrier from the immutable admitted product base and the
Delivery reducer selects the corresponding initial Candidate Revision. Between
the two durable observations the reduction is active, Candidate-absent, and
recover-only. Every productive Attempt receives the exact current retained revision and
Carrier through its immutable Input Set and works only in a disposable
materialization.

After a builder Cell is contained, the Runtime retrieves and independently
validates provisional output. It publishes a durable Candidate Revision Carrier
before atomically retaining any successor Candidate Revision in Control.
Missing or rejected output creates no successor and leaves the predecessor
current. An unchanged valid result may reuse the predecessor Carrier when the
owning Process rule requires a distinct logical revision. The Execution Receipt
records the exact input Candidate and the terminal transition outcome.

Integration first constructs the proposed result against one retained current
canonical parent. It compares that parent's governing context with the admitted
basis and independently observes the proposed result's repository validity.
A usable result advances the
same Candidate; changed governing context freezes a Material Condition for
resolution and readmission. An integration conflict preserves the source
Candidate and retains exact attempted-parent material for a useful correction.

Evaluation seals that exact integrated Candidate Revision and Carrier, executes
each required Check in a fresh Cell, and invokes an independent read-only
reviewer. Check Receipts keep requested conditions, Runtime enforcement,
Execution Backend Profile and Execution Image, Execution Input Set, output and
terminal observations, modality, and disposition separate. The Evidence Packet
binds the exact Boundary, Candidate Revision, Seal, Receipts, reviewer Work
Product, reviewer Receipt, and complete Runtime-derived ledgers. Evidence
supports judgment; it does not accept.

The Evidence assessment interprets requirements, observations, and independent
judgments. Its Foundation adapter verifies trusted provenance and recomputes the
retained Packet. Acceptance verification then compares the current Boundary,
Candidate, Seal, Packet, parent, and Director subject. This effect-free owner
neither authenticates the Director nor observes a Git effect. The transaction
owner authenticates the decision at opening, obtains exact acceptance
verification during publication preparation, and rechecks mutable physical
prerequisites at publication.

Acceptance imports only the exact sealed Carrier and conditionally applies its
result over the assessed parent. It performs no new merge or parent selection.
No-ship applies no Candidate bytes and records the supported terminal Candidate
disposition. Both routes record effect intent before action and direct effect
observation afterward. An applied terminal effect supports its exact Candidate
disposition and one sufficient Closure.

Closure requires every productive Cell to have reached Execution Containment,
every result to have its truthful final disposition, every Cell to have
Runtime-owned Retirement, and every remaining materialization or backend
resource to have a durable Reclamation handoff. It does not require backend
allocations or unreferenced Carriers to be physically absent. Reclamation is
bounded asynchronous installation maintenance and cannot redispatch work,
advance Candidate state, or change Closure.

`closure-recorded` is the final Journal event and atomically completes the
terminal activity. After Closure, the Runtime verifies every retained file,
verifies that governed drafts are empty, seals the logical Store inventory, closes the
database, writes the retrieval manifest, and atomically archives the complete
Delivery Store off HEAD. Interruption after Closure is recovered only by
finishing that exact seal or archive through the Store-disposition driver,
outside the Activity kernel and operation definitions; no later event is
appended. Closed standing and Candidate condition `accepted`, `abandoned`, or
`absent` remain unchanged while that physical recovery overlay advances.

Store seal and archive preserve Delivery Control and remain distinct from
Execution Reclamation. Neither creates a second user-visible workflow.

## Productive continuation and interrupted work

The same retained Candidate can support several Attempts. The required next
course depends on which relationship failed, rather than on a generic success
flag:

- **Draft Knowledge or unsuccessful provider output.** A valid Draft successor
  can survive retention while the prior Current revision still governs. A later
  Attempt can promote it under the exact local revision and digest rules. A
  failed provider outcome can likewise retain independently valid useful
  Candidate output. Neither fact manufactures a valid semantic Work Product.
- **Integration conflict.** The correction Attempt receives the exact attempted
  parent as read-only context while continuing the source Candidate. That
  context supplies neither governing Knowledge nor new capability. A later
  integration constructs a new exact result, which must then be evaluated.
- **Mandatory context too large.** A conclusive refusal in admitted work freezes
  its exact Material Condition. Bounded resolution context exposes the cause
  and frozen Candidate. Where permitted, an explicitly selected larger
  registered profile survives proposal finalization and authenticated
  readmission. The Runtime cannot satisfy the limit by dropping mandatory
  material. Failure before a first admitted Boundary instead requires a fresh
  preparation with feasible inputs.
- **Execution interrupted.** Recovery reopens the original Specification,
  provider/backend/image selection, input, and retained Handle. A changed default
  applies only to future work. Unavailable exact custody must be restored;
  recovery does not substitute a replacement or dispatch the provider again.
- **Canonical parent moved.** A conclusive not-applied refusal settles the
  failed acceptance Activity. New integration, evaluation, and Director
  acceptance establish a new exact publication subject. The old Evidence can
  remain historically valid without supporting application over the new parent.
- **Terminal result uncertain.** Lost return values do not prove that a Git
  effect failed. Recovery reconciles the retained intent as applied,
  not-applied, or still indeterminate. It neither retargets the effect nor
  creates another decision. An applied effect proceeds through its terminal
  obligations to Closure and Store disposition. A conclusive not-applied
  effect settles the failed Activity and returns to the permitted work; an
  indeterminate effect remains recovery work.

The [Runtime test overview](tests/overview.md) describes the executable
connected courses and their evidence boundaries. Each scenario states its finite
variants, restart points, and assertions. These scenarios supply external responses; they
cannot establish unconditional completion when custody, resources, or Director
decisions remain unavailable. No-ship is successful termination when the
Director intentionally selects it, not evidence that a feasible productive
course completed.

## Build And Check

```sh
npm run check -w @neutral/lifecycle-runtime
npm run build -w @neutral/lifecycle-runtime
npm run test -w @neutral/lifecycle-runtime
```

Build regenerates the Foundation schema carrier from the exact specification
publication and compiles TypeScript into `dist/`. Package-local tests and the
repository-operated rows under [`../qualification/`](../qualification/overview.md)
describe reference coverage for Store integrity and replay, governed authoring, provider
containment, single-use dispatch, lost-Cell observation, Candidate Revision Carrier
publication and successor crash windows, invalid-output continuity, Check
Cells, Retirement handoff, asynchronous Reclamation, Evidence, authority,
canonical transactions, sealing, archive, recovery, parent loss, and
fresh-generation refusal.

Inspect packaged bytes separately. `dist/`, caches, provider homes, Candidate
Carriers and materializations, Cell support, Control Stores, authority material,
and Runtime-private recovery or Reclamation state are never committed.

## Source status and verification

The implementation selects qualification coordinate
`lifecycle.foundation.1.0.0-rc.17` and Draft specification status. Source checks
and regressions establish their stated assertions. Installed operation, image
and provider qualification, authenticated publication, independent implementation
evidence, and conformance require their own exact subjects and evidence.
