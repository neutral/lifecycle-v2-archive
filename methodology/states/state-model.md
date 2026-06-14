# State Model

## Purpose

Use this page as the human-readable source for generated installed methodology
state pages.

Each state block follows the same field order. The compile install workflow
turns these blocks into one installed page per state under
`.lifecycle/methodology/states/`.

## Page Contract

- You Are Here When
- Read First
- Current Controller
- Allowed Actions
- Produce Or Update
- Transition Check
- Failure Routes
- Stop Condition

## No Active Work

id: no-active-work

Applies when:

- no active, blocked, deferred, landing-ready, or landed Lifecycle Control record requires action

Read first:

- recent founder-dev input
- semantic authority storage only when current product meaning is needed
- `records/control/discovery/plans/` when deciding what work may deserve attention
- current `records/control/` reset state when starting a new independent process

Current controller:

- no Control record controls action yet

Allowed actions:

- create or refresh Clarity state when Context authority itself needs focused work
- create or refresh Discovery state
- ask for a concrete Signal
- begin Delivery only when the founder-dev supplied a concrete Signal
- start a new independent process only after prior Control records are committed or explicitly carried forward

Produce or update:

- Clarity Boundary for Context pressure
- Source Inventory or Context Review Packet when Context review state should persist
- Discovery plan item for unclear work
- Discovery plan map when possible-work state should persist
- selection handoff or Work Boundary when a concrete Signal is ready for Delivery

Transition check:

- the next state is explicit: Clarity active, Discovery active, Signal
  interpreting, or Work Boundary active
- Context work that will survive the response has live Clarity state before
  Context entries change
- when starting a new independent process, current `records/control/` contains only neutral scaffolding or the new process's records
- unclear work that will survive the response has live Discovery plan state before Delivery starts

Failure routes:

- unclear priority -> `states/discovery-active.md`
- Context pressure -> `states/clarity-active.md`
- concrete but underspecified work -> `states/signal-interpreting.md`
- missing product authority -> `semantic-authority/resolve-semantic-authority-backpressure.md`
- prior uncommitted Control records would be lost -> stop and close, commit, ask, or carry them forward before starting a new process

Stop condition:

- stop only after creating or updating a Control record with state, owner, next retrieval pointer, and close condition

## Clarity Active

id: clarity-active

Applies when:

- Context authority itself needs focused work
- Clarity records are active
- founder-dev asks a broad product, rationale, strategy, Context, corpus,
  canonicalization, freshness, or meaning question

Read first:

- `records/control/clarity/boundaries/`
- `records/control/clarity/inventories/`
- `records/control/clarity/reviews/`
- relevant current Context entries
- semantic authority entries referenced by the active Context scope
- recent founder-dev input that frames the Context question

Current controller:

- the active Clarity Boundary controls Context edits
- the active Context Review Packet controls route, content, canonicalization,
  promotion, and retrieval checks against the named Context surface contract
  when those checks are needed

Allowed actions:

- clarify the Context question and review depth
- inventory current Context and source material
- update Context entries inside the active Clarity Boundary
- organize Context atlas routes, areas, clusters, roles, and relations
- review Context content adequacy, freshness, and canonicalization
- record stale, duplicate, conflict, supersession, and deferred treatment
- record promotion pressure toward Intent, Assurance, Blueprint, or Description
- prove retrieval of the smallest sufficient Context slice
- close with recommendations without starting another process

Produce or update:

- Clarity Boundary under `records/control/clarity/boundaries/`
- Source Inventory under `records/control/clarity/inventories/`
- Context Review Packet under `records/control/clarity/reviews/`
- Context entries under `records/context/`
- Clarity Closure Record under `records/control/clarity/closures/`

Transition check:

- active Clarity Boundary exists before Context edits
- source treatment is explicit before source material shapes Context
- route-only work does not mark leaves reviewed without content review
- Context updates stay inside allowed Context mutations
- promotion pressure is recorded without silently updating narrower surfaces
- recommendations do not start Discovery, Delivery, or another Clarity run

Failure routes:

- Context question too broad -> narrow the Clarity Boundary or ask founder-dev
- source treatment unclear -> update Source Inventory before Context edits
- missing earlier Context meaning -> keep Clarity active or block with the
  missing question
- meaning belongs in Intent, Assurance, Blueprint, or Description -> record
  promotion pressure instead of hiding it in Context
- concrete behavior request appears -> stop Clarity or close with a Delivery
  recommendation for founder-dev review
- next useful work selection is the real question -> close with a Discovery
  recommendation for founder-dev review

Stop condition:

- stop with Clarity Boundary, Source Inventory, Context Review Packet, Context
  entries, and Closure Record current for the review depth, or with the active
  Clarity record blocked/deferred and the next decision named

## Discovery Active

id: discovery-active

Applies when:

- the next useful work is unclear or Discovery records are active

Read first:

- `records/control/discovery/maps/`
- `records/control/discovery/plans/`
- `.lifecycle/disciplines/catalog.md` when candidate work may touch installed discipline
- relevant semantic authority entries
- recent founder-dev input
- prior selection handoffs when they affect current selection

Current controller:

- the active Discovery plan item or plan map controls action

Allowed actions:

- refresh possible Signals
- identify candidate discipline packages and bindings when material to selection or handoff
- compare candidates
- update blockers and dependencies
- select one Signal for Delivery
- defer, reject, or close work

Produce or update:

- plan items under `records/control/discovery/plans/`
- plan map under `records/control/discovery/maps/` when item state, attention order, dependency grouping, or selection changes
- selection handoff under `records/control/discovery/selections/` when Delivery should consume a Signal
- candidate discipline references when they affect selection or handoff

Transition check:

- candidate state, source basis, selection status, blockers, and Delivery handoff target are explicit
- selected plan items are represented in the plan map when a map exists or multiple items are tracked
- selection handoff exists before Delivery relies on Discovery context

Failure routes:

- ambiguous product meaning -> `semantic-authority/retrieve-product-meaning.md`
- sparse semantic authority -> `semantic-authority/resolve-semantic-authority-backpressure.md`
- missing live Plan Item, Plan Map, or Selection Handoff after Delivery began -> stop and notify founder-dev of Lifecycle cadence failure
- selected work -> `states/signal-interpreting.md`
- no useful work -> `responses/close.md`

Stop condition:

- stop with each active plan item carrying state, reason attention remains, next retrieval pointer, and close condition
- stop only after plan map and selection handoff state are current, or after explicitly recording why they are not needed

## Signal Interpreting

id: signal-interpreting

Applies when:

- a concrete Signal exists, but Delivery has not yet weighed exact meaning into
  product judgment, admitted scope, execution boundary, proof obligations, and
  non-changes

Read first:

- selected Signal
- selection handoff when present
- `.lifecycle/disciplines/catalog.md` when discipline may materially constrain interpretation
- admission context from the Signal source
- relevant semantic authority entries
- current, stale, or conflicting semantic authority that may affect interpretation
- target facts needed to interpret the request
- existing proof and runtime observations when current behavior or release risk affects interpretation

Current controller:

- the selected Signal controls interpretation until selected meaning is admitted
  into an active Work Boundary

Allowed actions:

- classify the Signal source and candidate meaning
- select candidate discipline packages and bindings that materially affect interpretation
- clarify meaning
- identify the owning semantic authority surface
- identify ambiguity, missing authority, or target facts that block admission
- draft the product judgment that will admit behavior, tradeoffs, explicit
  exclusions, falsifiers, and proof consequences
- ask the smallest founder-dev decision question that can resolve interpretation
- split, reframe, defer, or abandon work
- draft a Work Boundary
- record the recommendation basis before recommending scope

Produce or update:

- Work Boundary under `records/control/delivery/work-boundaries/` when the Signal is ready for admission

Transition check:

- selected meaning, source basis, target facts, discipline sources, candidate
  discipline, known questions, draft product judgment, recommendation
  basis, and Delivery path are explicit

Failure routes:

- prompt treated as requirement without interpretation -> stay in this state
- product judgment cannot yet name admitted behavior, tradeoff, exclusions, or
  falsifiers -> stay in this state
- too broad -> `responses/split.md`
- wrong target or wrong meaning -> `responses/reframe.md`
- missing product authority -> `semantic-authority/resolve-semantic-authority-backpressure.md`
- insufficient founder decision -> `responses/ask.md`

Stop condition:

- stop with the Signal preserved in a Control record and the next required decision named

## Work Boundary Active

id: work-boundary-active

Applies when:

- Delivery has a selected Signal and must admit, revise, or validate the active Work Boundary before target work continues

Read first:

- active Work Boundary
- product judgment in the active Work Boundary
- recommendation basis in the active Work Boundary
- selected Signal or handoff
- selected discipline packages, bindings, and slices under `.lifecycle/disciplines/` when discipline applies
- relevant semantic authority entries
- target facts needed for boundaries
- prior proof when present

Current controller:

- the active Work Boundary controls Delivery action

Allowed actions:

- state, revise, or validate product judgment before Build
- admit selected meaning and scope into the active Work Boundary
- select discipline packages whose bindings materially apply
- retrieve the smallest useful discipline slice
- adopt or reject discipline constraints
- record discipline conflicts and proof effects
- tighten boundaries
- record or revise the recommendation basis
- state assumptions, confidence, falsifiers, and intentionally undecided items
- state judgment deltas when the product judgment changes
- state recommendation deltas when the recommendation changes
- choose the smallest sufficient Work Boundary tier
- map allowed and restricted target change surfaces
- define the execution boundary
- list proof obligations
- list semantic authority update obligations
- define Control record requirements
- define an observation plan when release or runtime risk exists
- declare non-changes
- split, reframe, defer, abandon, or move to Build

Produce or update:

- active Work Boundary
- `disciplines_used` or planned discipline usage when a selected package shapes admission
- supporting Control records only when the Work Boundary requires them

Transition check:

- run `checks/before-build.md`
- the Work Boundary includes product judgment, tier, source Signal, selected
  meaning, recommendation basis, admitted scope, target change surfaces,
  execution boundary, proof obligations, discipline usage when selected,
  semantic authority update obligations, Control record requirements, and
  landing readiness rule

Failure routes:

- product judgment missing, under-specified, unsupported by repo state, or
  falsified -> stay until the judgment is explicit or route to ask, reframe,
  split, defer, or abandon
- selected tier no longer fits -> stop and frame a new Work Boundary with a fitting tier
- scope expansion -> split, reframe, defer, abandon, or admit a new Work Boundary
- scope outside admitted intent -> `responses/reframe.md` or `responses/split.md`
- material discipline conflict -> resolve, reject with reason, revise the Work Boundary, or ask before Build
- sensitive area, migration, irreversible work, permissions, roles, billing, authentication, or data isolation concern -> use a tier and proof path that fits the risk
- sparse semantic authority -> `semantic-authority/resolve-semantic-authority-backpressure.md`
- risk or proof uncertainty -> stay until obligations are explicit
- proof obligation unclear -> stay until the claim, expected evidence, freshness condition, and failure response are explicit
- recommendation basis missing or unsupported -> stay until repo facts, assumptions, confidence, and recommendation are explicit
- strategy-shaped recommendation without role or surface inventory -> stay until the inventory is complete enough for the work's risk and ambiguity
- product judgment changed without a judgment delta -> stay until old judgment,
  new evidence, changed premise or tradeoff, new judgment, and unchanged
  tradeoffs are recorded
- recommendation changed without a recommendation delta -> stay until old recommendation, new evidence, changed premise or tradeoff, new recommendation, and unchanged tradeoffs are recorded

Stop condition:

- stop with the Work Boundary state, product judgment, recommendation basis,
  admitted scope, execution boundary, discipline usage when selected,
  proof obligations, update obligations, and next state explicit

## Build Active

id: build-active

Applies when:

- admitted product judgment and scope in the active Work Boundary permit target
  work and proof has not yet frozen the final work delta

Read first:

- active Work Boundary
- admitted product judgment
- admitted discipline constraints and bindings when present
- target files inside allowed surfaces
- relevant semantic authority entries
- bound Required Checks of in-slice entries, as the no-pre-existing-breach baseline
- Description entries for local implementation responsibility, sensitive edges, and nearby behavior
- existing evidence when proof obligations affect implementation

Current controller:

- the active Work Boundary controls allowed target changes

Allowed actions:

- change target code inside admitted scope
- use only tools, environments, credentials, external systems, and runtime operations admitted by the execution boundary
- record discoveries that affect scope, surfaces, execution, proof, or semantic authority
- record discoveries that affect or falsify product judgment
- record discoveries that introduce or change material discipline
- update the Work Boundary when obligations change
- update Description entries when implementation-local meaning changes and admission allows the update
- update target-specific ignore rules for generated local artifacts
- remove work that exceeds scope
- route changed meaning to admission

Produce or update:

- target changes
- actual touched surfaces and execution actions used
- generated local artifacts that are ignored or removed
- recorded discoveries and their routing
- Work Boundary updates when proof obligations, discipline obligations, execution boundary, semantic authority obligations, or target change surfaces change
- Work Boundary updates when product judgment changes or is falsified

Transition check:

- before proof, verify the target delta stays inside admitted scope and has no restricted surface changes
- admitted product judgment still matches the target delta
- selected discipline constraints are preserved or routed back to Work Boundary
- actual touched surfaces are known
- declared non-changes can be checked
- execution actions used are known
- no new unadmitted behavior remains in the diff

Failure routes:

- product judgment missing, contradicted, or falsified -> `states/work-boundary-active.md`
- scope drift -> `states/work-boundary-active.md`
- new material discipline, changed authority classification, or authority conflict -> `states/work-boundary-active.md`
- restricted surface changes -> `responses/reframe.md` or remove the change
- required discovered work outside scope -> create a child Work Boundary or frame a new higher-tier Work Boundary
- optional discovered work outside scope -> defer and record as a declared non-change or Discovery plan item
- outside execution boundary -> stop and raise the decision
- contradiction with semantic authority -> resolve authority backpressure or return to admission
- semantic authority changes -> `semantic-authority/update-product-meaning.md` only after the semantic authority update path or knowledge promotion allows the update

Stop condition:

- stop with the active Work Boundary still active and the current target delta described well enough for the next invocation to resume

## Proof Active

id: proof-active

Applies when:

- the final work delta is ready for proof or proof is incomplete, stale, or failing

Read first:

- active Work Boundary
- admitted product judgment and proof consequences
- final work delta
- Evidence Packet
- proof obligations
- bound Required Checks of touched entries and their last_held lines
- discipline proof obligations when present
- declared non-changes
- authority source versions and freshness conditions
- execution boundary actions used
- restricted target change surfaces
- target commands needed to prove the claims

Current controller:

- the Evidence Packet controls proof status
- the Work Boundary still controls what claims must be proven

Allowed actions:

- run exact proof commands
- re-run the bound Required Checks of touched entries and refresh their
  last_held lines
- reference standing Required Checks as evidence for the proof obligations
  they cover, interpreting what passing does and does not prove
- check that evidence covers the admitted product judgment, tradeoffs,
  exclusions, falsifiers, and proof consequences
- compare the actual diff to the active Work Boundary
- check semantic authority freshness
- check execution boundary compliance
- record failures
- fix defects inside the active Work Boundary
- update proof obligations when admitted scope changes
- return to `states/work-boundary-active.md` when proof reveals scope drift

Produce or update:

- Evidence Packet under `records/control/delivery/evidence/` with final work
  delta pointer, tested commit or local delta label, product judgment coverage,
  commands, outputs, discipline evidence when applicable, declared
  non-change evidence, reconciliation result, proof gaps, and freshness state

Transition check:

- run `checks/before-proof.md`
- proof covers the final work delta and remains current against it
- proof covers the admitted product judgment's proof consequences or records an
  explicit gap and failure response
- proof satisfies discipline obligations or records explicit rejection
- actual work matches the active Work Boundary
- required Control records are present or explicitly not applicable
- observation plan is ready when release or runtime risk needs it

Failure routes:

- stale proof -> stay in this state
- Required Check breach outside this run's admitted scope -> the entry stays current, landing is blocked for the entry's scope, and the breach becomes a new Signal
- product judgment mismatch or violated explicit exclusion -> `states/work-boundary-active.md`
- scope mismatch -> `states/work-boundary-active.md`
- semantic authority freshness gap -> `semantic-authority/resolve-semantic-authority-backpressure.md` or refresh evidence
- execution boundary mismatch -> `states/work-boundary-active.md`
- forbidden or unadmitted work -> remove the work or reframe before proof can pass
- founder-dev decision needed -> `responses/ask.md`
- implementation defects inside scope -> `states/build-active.md`

Stop condition:

- stop with proof status, exact commands, failures, and next proof action in the Evidence Packet

## Landing Ready

id: landing-ready

Applies when:

- the final work delta has current proof and needs landing, handoff, or explicit non-landing

Read first:

- Work Boundary
- admitted product judgment
- Evidence Packet
- Landing Packet
- final work delta
- release exposure obligations

Current controller:

- the Landing Packet controls landing handoff

Allowed actions:

- prepare landing
- verify handoff
- mark work abandoned
- identify release exposure
- return to proof when evidence is stale

Produce or update:

- Landing Packet under `records/control/delivery/landings/`

Transition check:

- run `checks/before-landing.md`
- the Landing Packet points to current evidence, product judgment coverage, and
  merge, release, or abandonment handoff
- release exposure decisions are admitted by the execution boundary

Failure routes:

- stale proof -> `states/proof-active.md`
- product judgment coverage missing or contradicted -> `states/proof-active.md`
- delta mismatch -> `states/work-boundary-active.md`
- release exposure that affects runtime handling -> `states/landed.md` after landing

Stop condition:

- stop with landing decision, handoff target, landed commit or non-landing reason, and next state explicit

## Landed

id: landed

Applies when:

- Delivery work has landed or been exposed, and release, observation, learning, or closure handling remains

Read first:

- Landing Packet
- release summary when present
- Evidence Packet
- active Work Boundary
- runtime observations

Current controller:

- the Landing Packet controls landed status until release and learning handling are either resolved or routed

Allowed actions:

- classify release exposure
- use only release and runtime actions admitted by the execution boundary and observation plan
- arm monitors when the observation plan requires them
- prepare canary or rollback handling when release risk requires it
- record runtime observations
- create a release summary
- route behavior-changing follow-up as a Signal
- move to closure

Produce or update:

- release summary under `records/control/delivery/releases/` when release or runtime handling matters

Transition check:

- runtime output is classified as Signal, incident input, evidence, learning candidate, archive material, or not applicable
- release summary exists when release exposure matters

Failure routes:

- runtime response, incident handling, rollback, or observation unresolved -> stay in this state
- deploy, rollback, runtime mutation, or external system call outside the execution boundary -> stop and raise the decision
- behavior-changing runtime follow-up -> `states/signal-interpreting.md` as a new Signal
- durable product learning -> `states/release-learning-active.md`
- no learning and no remaining state -> `states/closure-active.md`

Stop condition:

- stop with release exposure, runtime treatment, and next state explicit

## Release Learning Active

id: release-learning-active

Applies when:

- runtime observation, proof, founder decision, or delivery work may create durable product learning, archive material, or a new Signal

Read first:

- release summaries
- Evidence Packets
- Landing Packets
- closed or active product judgment when it may contain durable learning
- candidate learning
- discipline usage records when they create promotion candidates
- semantic authority surface registry

Current controller:

- the knowledge promotion decision or archive decision controls learning treatment

Allowed actions:

- promote durable product meaning
- reject promotion
- archive non-authoritative material
- defer learning
- open a fresh Signal for behavior-changing follow-up

Produce or update:

- knowledge promotion decision under `records/control/delivery/promotions/`
- archive decision under `records/control/delivery/archives/`

Transition check:

- each learning candidate has an outcome and promoted meaning has an owning semantic authority surface
- durable learning from product judgment is rewritten as semantic authority
  meaning before promotion; otherwise it remains closed process state
- discipline promotion candidates are rewritten as product-specific accepted statements before promotion
- runtime observations are not durable product authority unless promoted through the owning semantic authority surface

Failure routes:

- missing owning surface -> `semantic-authority/resolve-semantic-authority-backpressure.md`
- promotion -> `semantic-authority/update-product-meaning.md`
- rejected or archived material -> `responses/archive.md`

Stop condition:

- stop with every candidate promoted, rejected, archived, deferred, or marked as no learning

## Closure Active

id: closure-active

Applies when:

- landing, abandonment, runtime handling, learning, and archive decisions are resolved enough to close the active Lifecycle work

Read first:

- all active Control records for the work
- Work Boundary when Delivery is active
- product judgment outcome in the Work Boundary and closure record
- closure record
- discipline usage records and unresolved authority conflicts
- remaining promotion or archive decisions

Current controller:

- the closure record controls whether state can close

Allowed actions:

- close active records
- mark blocked or deferred state
- preserve retrieval pointers
- archive non-authoritative material
- return to the owning state when work remains unresolved

Produce or update:

- Clarity Closure Record under `records/control/clarity/closures/` when Clarity closes
- closure record under `records/control/delivery/closures/` for Delivery closure
- Discovery records when Discovery state closes or hands off

Transition check:

- run `checks/before-closure.md`
- active Work Boundary is closed when Delivery closes
- product judgment is satisfied, superseded, abandoned, or has durable learning
  extracted through semantic authority update rules
- selected discipline usage is recorded or explicitly not applicable
- records that remain active are named
- closed records are off by default
- next retrieval pointer exists when follow-up remains
- if this closure precedes a new independent process, semantic authority is preserved and current `records/control/` can be reset after commit

Failure routes:

- unresolved proof -> `states/proof-active.md`
- unresolved runtime or learning -> `states/release-learning-active.md`
- missing retrieval pointer -> stay in this state until the owning record is fixed

Stop condition:

- stop only when closed records are off by default and any remaining active, blocked, or deferred work has an explicit next retrieval pointer
