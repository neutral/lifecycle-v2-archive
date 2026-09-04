# Foundation Runtime

`runtime/` implements Lifecycle Foundation `1.0.0`. The rc.10 route exposes
runtime protocol `lifecycle.runtime.foundation.v10` through the `lifecycle`
CLI and package-root TypeScript API. It operates fresh repository contract
`lifecycle.repository.v15` and Provider Adapter
`lifecycle.provider-adapter.v6` only.

The Runtime imports the shared [`@neutral/lifecycle-protocol`](../protocol/overview.md)
package and implements its request and result contract. The protocol does not
depend on or execute the Runtime. Presentation clients consume the same
contract and reach effects only through the canonical CLI.

All nine rc.10 Delivery mutation routes are composed through their current
operation owners. Candidate continuity uses Candidate Revision Carriers, and
Agent Attempts and Checks use subordinate Execution Cells. Focused recovery
tests exist; operated Docker, installed-route, and fresh terminal-Delivery
qualification are still being completed. This overview is not a release or
conformance claim.

## Ownership

```text
src/foundation/  current rc.10 source owners
  control/        SQLite Store, Control compilers, inspection, sealing, archive
  knowledge/      Knowledge sources, relationships, coverage, and sets
  projection/     Orientation and role-specific Projection compilation
  execution/      Specifications, Input Sets, Backends, Cells, Retirement,
                  and Reclamation coordination
  attempt/        provider-neutral Attempt and Agent Cell integration
  candidate/      Carrier construction, verification, materialization, sealing
  check/          Check Cell input, output, and observation integration
  evidence/       Evidence physical-observation support
  process/        sole Delivery reducer, Activity kernel, operation owners,
                  eligibility, atomic successor coordination, and recovery
  transaction/    admission and terminal transaction meaning
  repository/     contract v15, authority, observation, and Git transactions
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

The preparation, Candidate-agent, evaluation, admission, and terminal owners
supply route-specific eligibility requirements, immutable semantic plans,
physical effects and observations, and Control compilation.
`process/activity-kernel-v7.ts` supplies their shared durable mechanics.
`runtime-mutation-v7.ts` is the thin public compositor: it binds the request,
lock, Store, and reducer coordinate, then delegates to the selected owner. It
does not reproduce an operation workflow.

The current rc.10 owner shape centralizes transaction progression and
stage-free Activity checkpoints while separating logical Candidate and domain
meaning from physical execution:

```text
candidate/      immutable Candidate Revision Carriers, validation,
                deterministic materialization, sealing, and acceptance import
execution/      private Execution Specifications, Backends, Cells, Handles,
                output retrieval, Retirement, and Reclamation coordination
attempt/        Provider and semantic-authoring meaning over the shared backend
check/          Check and proof meaning over the shared backend
process/        sole Delivery reducer, Activity kernel, operation owners,
                eligibility, recovery, and atomic successor coordination
```

That owner shape is implemented. Operation definitions retain their legitimate
domain meaning while repeated physical execution stays behind one private
contract.

No alternate command namespace, target-local runtime, method interpreter,
provider-specific Process, predecessor runtime, or second Control carrier is
part of rc.10.

Delivery remains the only user-visible workflow under rc.10. Execution Cells
add no public workflow, CLI commands, TUI screens, operator retry semantics, or
parallel state machine. They are private mechanics behind eligible Delivery
operations, and `delivery.recover` resumes only the exact reducer-selected
Activity.

## Architecture Decision Route

Runtime implementation decisions are non-normative. Source and tests explain
local mechanics and alternatives; the specification owners in `spec-source/`
retain normative authority.

## Public Runtime Boundary

The selected v10 facade accepts exactly these operations:

```text
repository.initialize  repository.validate
delivery.status        delivery.inbox         delivery.prepare
delivery.admit
delivery.continue      delivery.evaluate      delivery.revise
delivery.reaffirm      delivery.accept        delivery.no-ship
delivery.recover       delivery.inspect       delivery.diff
delivery.watch         delivery.export
```

`delivery.prepare` takes one complete fresh Founder Brief and creates one fresh
Delivery. Every later Delivery request names the exact returned Delivery
identity. A later reconnaissance request creates another Delivery and another
Control Record Store; it does not append another preparation activity to the
first Delivery or inherit its Brief, provider conversation, or hidden state.

The nine Delivery operations are `prepare`, `admit`, `continue`, `evaluate`,
`revise`, `reaffirm`, `accept`, `no-ship`, and `recover`. Admission and
readmission share `delivery.admit`, qualified by the reducer-derived standing.
No-ship is one authenticated operation carrying the exact reason and supported
Candidate disposition. Recovery accepts no replacement judgment or authority;
it resumes only the exact retained obligation.

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
record envelope, or transition. Continue, evaluate, revise, and reaffirm bind
the Runtime-issued read generation against which their fresh input was
authored. Repository and read-only operations have their own closed request
shapes.

Every result contains one coherent repository observation, a nullable Delivery
observation, bounded change facts, new event and record references when
applicable, diagnostics, and a canonical result digest. `inspect` and `export`
provide bounded read-only views. Results never expose authority secret bytes,
credentials, physical custody roots, Execution Handles, container identifiers,
Docker endpoints, materialization paths, Reclamation coordinates, transaction
locators, or another Delivery's Control. The rc.10 protocol may bind only the
stable Backend Profile, Execution Image, Specification, Input Set, Output
Manifest, output disposition, and terminal-observation facts selected by its
normative Receipt and Evidence contracts.

The disposable read-model layer supplies a target-scoped Inbox and one coherent
selected Delivery View. The latter joins reducer, Attempt, Candidate, Evidence,
Decision Readiness, and Control facts under one read generation. `diff` owns
exact bounded Candidate difference; `inspect` owns Control navigation; `watch`
refreshes an Inbox or selected Delivery generation without retaining state.
The runtime, never the TUI, opens SQLite, interprets support, or selects Git
subjects.

The TUI may delegate `delivery.prepare` and currently eligible
`delivery.continue`, `delivery.evaluate`, `delivery.revise`, or
`delivery.reaffirm` through the installed canonical CLI. It owns no Process
engine or state and no authority path. Admission, acceptance, no-ship, and
recovery remain explicit CLI handoffs.

## Control Record Store

Every Delivery owns one runtime-selected, off-HEAD SQLite Control Record Store.
The database is the primary Control carrier. It retains immutable typed record
revisions, readable semantic Markdown, exact relationships, one append-only
Journal event chain, referenced-file descriptors, and at most one terminal
seal. There is no tracked `records/control` tree, protected Process Git ref,
mutable state row, duplicated Markdown document graph, or separate Control
index.

The twelve closed record families are:

```text
Founder Brief          Agent Attempt          Agent Work Product
Execution Receipt      Candidate Revision     Work Boundary
Material Condition     Founder Decision       Candidate Seal
Check Receipt          Evidence Packet        Closure
```

Only Candidate Revision and Work Boundary are successive families. Every other
logical record has one immutable revision. The event fold, not a `current`
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

The closed twenty-two-event Journal is:

```text
delivery-created                 founder-brief-submitted
activity-started                 activity-recovery-recorded
agent-pre-intent-refused         agent-attempt-prepared
provider-effect-intended         provider-effect-observed
agent-work-product-submitted     agent-work-product-abandoned
candidate-revision-observed      execution-receipt-recorded
work-boundary-finalized          material-condition-frozen
candidate-sealed                 check-receipt-recorded
evidence-packet-finalized        founder-decision-authenticated
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

`files/` holds only bounded content-addressed operational bytes selected by an
exact Execution Receipt or Check Receipt. There is no general Control blob
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

An Agent Attempt freezes one role, fresh Founder Brief, exact subject,
Projection, capability, Investment, provider, Role Brief, and authoring
profile. Under the selected rc.10 architecture, the Runtime compiles those
immutable inputs into one exact Execution Specification and Input Set. When a
Candidate is applicable, the Input Set selects its Candidate Revision and
Carrier manifest and digest; the Backend, not the Specification, creates the
disposable materialization.

The Docker Execution Backend allocates one Cell for the complete Attempt. The
fixed cell-side runner grants the assigned agent one governed `semantic.md`
working file and one bounded advisory validator. The agent may revise that
file across as many provider turns as the funded Attempt permits, validate,
correct the same draft, and validate again. Intermediate edits and validation
calls are not Control revisions or Journal events.

The agent authors claims, decisions, rationale, uncertainty, citations, and
proposed effects. It does not construct front matter, SQL, record identities,
fixed bindings, reference digests, ordering, canonical JSON, or transport
envelopes. Provider terminal text is bounded operational output, not the
semantic return carrier.

Either an explicit governed request or the exact final workspace at clean
natural provider completion triggers submission and closes the edit window.
The cell-local validator can return bounded correction while the Agent can
still edit, but it does not submit, retain, or authorize the draft.

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
manufacture a submission trigger. An unreadable workspace or absence of any
valid triggered submission appends `agent-work-product-abandoned` and retains
no Work Product. Provider terminal text never substitutes for the workspace.
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
next choices; it is not a thirteenth retained record.

Codex is the installed standard adapter. Provider-specific execution remains
behind Provider Adapter v6; Work Boundaries, Delivery state, Knowledge, and
Founder authority never depend on provider-session continuity.

## Repository, Candidate, And Authority

Fresh initialization requires a clean canonical Git target with a tracked
regular-file `atlas/atlas.md`. It refuses predecessor and mixed Control before
authority creation, installs repository contract v15 and Product Knowledge
roots, establishes one target-specific Founder authority identity in the
machine home, and records only its public binding in the repository contract.
The hard replacement avoids dual primary carriers and ambiguous recovery
authority; predecessor Control is refused rather than migrated or dual-read.

The target contains no Lifecycle source, Control Store, `records/control`,
`.lifecycle/runtime`, provider materialization, Candidate allocation, authority
secret, or transaction continuation. Runtime-private installation state remains
physically disjoint from the target and owns Control Stores, immutable
Candidate Revision Carriers, disposable materializations, private Cell support,
authority, exact recovery coordinates, and the Retirement/Reclamation ledger.
Callers select none of those by path.

Authority-bearing operations receive the Founder secret through the CLI's
owner-private file boundary. The Runtime constructs and authenticates the exact
Founder Decision subject. Repository prose, agent output, interface state, or a
database digest cannot substitute for that authentication.

Guarded canonical operations serialize under the exact physical Git common
directory. Linked worktrees therefore share a transaction domain. Separate
Deliveries may run reconnaissance concurrently because each owns a distinct
Store and no Candidate, while authority-bearing target mutations remain
serialized.

## Delivery, Evidence, And Closure

After an admission effect is directly observed applied, the same exact Work
Boundary revision becomes active. The Runtime then publishes the initial
Candidate Revision Carrier from the immutable admitted product base and the
Delivery reducer selects the corresponding initial Candidate Revision. Between
the two durable observations the reduction is active, Candidate-absent, and
recover-only. Every productive Attempt receives the initialized revision and
Carrier through its immutable Input Set and works only in a disposable
materialization.

After a builder Cell is contained, the Runtime retrieves and independently
validates provisional output. It publishes a durable Candidate Revision Carrier
before atomically retaining any successor Candidate Revision in Control.
Missing or rejected output creates no successor and leaves the predecessor
current. An unchanged valid result may reuse the predecessor Carrier when the
owning Process rule requires a distinct logical revision. The Execution Receipt
records the exact input Candidate and the terminal transition outcome.

Evaluation seals one exact current Candidate Revision and Carrier, executes
each required Check in a fresh Cell, and invokes an independent read-only
reviewer. Check Receipts keep requested conditions, Runtime enforcement,
Execution Backend Profile and Execution Image, Execution Input Set, output and
terminal observations, modality, and disposition separate. The Evidence Packet
binds the exact Boundary, Candidate Revision, Seal, Receipts, reviewer Work
Product, reviewer Receipt, and complete Runtime-derived ledgers. Evidence
supports judgment; it does not accept.

Acceptance integrates only the exact evidenced Candidate bytes selected by the
Founder-authenticated transaction by importing the sealed Candidate Revision
Carrier and moving the canonical branch from the admitted parent. No-ship
integrates no Candidate bytes and records the Candidate abandoned. Both routes
record effect intent before action, direct effect observation afterward, exact
Candidate disposition, and one sufficient Closure.

Closure requires every productive Cell to have reached Execution Containment,
every result to have its truthful final disposition, every Cell to have
Runtime-owned Retirement, and every remaining materialization or backend
resource to have a durable Reclamation handoff. It does not require backend
allocations or unreferenced Carriers to be physically absent. Reclamation is
bounded asynchronous installation maintenance and cannot redispatch work,
advance Candidate state, or change Closure.

`closure-recorded` is the final Journal event and atomically completes the
terminal activity. After Closure, the Runtime verifies every retained file,
empties governed drafts, seals the logical Store inventory, closes the
database, writes the retrieval manifest, and atomically archives the complete
Delivery Store off HEAD. Interruption after Closure is recovered only by
finishing that exact seal or archive through the Store-disposition driver,
outside the Activity kernel and operation definitions; no later event is
appended. Closed standing and Candidate condition `accepted`, `abandoned`, or
`absent` remain unchanged while that physical recovery overlay advances.

Store seal and archive preserve Delivery Control and remain distinct from
Execution Reclamation. Neither creates a second user-visible workflow.

## Build And Check

```sh
npm run check -w @neutral/lifecycle-runtime
npm run build -w @neutral/lifecycle-runtime
npm run test -w @neutral/lifecycle-runtime
```

Build regenerates the Foundation schema carrier from the exact specification
publication and compiles TypeScript into `dist/`. Package-local tests and the
[`qualification/`](../qualification/overview.md) operated rows must cover
Store integrity and replay, governed authoring, provider
containment, single-use dispatch, lost-Cell observation, Candidate Revision Carrier
publication and successor crash windows, invalid-output continuity, Check
Cells, Retirement handoff, asynchronous Reclamation, Evidence, authority,
canonical transactions, sealing, archive, recovery, parent loss, and
fresh-generation refusal.

Inspect packaged bytes separately. `dist/`, caches, provider homes, Candidate
Carriers and materializations, Cell support, Control Stores, authority material,
and Runtime-private recovery or Reclamation state are never committed.

## Release Boundary

The selected runtime targets qualification revision
`lifecycle.foundation.1.0.0-rc.10`. The documents remain Draft. An authenticated
Publication Statement, independently maintained second implementation, exact
operated qualification, and released-conformance evidence remain separate
requirements. Landed route composition and passing focused checks do not create
any of those claims.
