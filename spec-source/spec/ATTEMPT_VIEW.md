# Lifecycle Attempt View and Investment Control

> Status: Draft

## Purpose

This document defines the reducer-derived Attempt View and the rules by which a
caller decides whether to invest in more Agent labor. It makes continuation
explicit without turning elapsed time, provider events, Candidate motion, or
Agent confidence into Process truth.

The Attempt View is a disposable dossier, not a Control record family:

```text
validated Control Store + exact Journal head
  -> Delivery event fold
  -> exact Attempt-family revisions and current subjects
  -> reducer-derived Attempt View
  -> caller selects one eligible next operation or stops Investment
  -> runtime revalidates the live operation subject
```

[Agent Attempts](ATTEMPTS.md) owns invocation, workspace, Work Product,
Candidate successor promotion, and Receipt behavior.
[Execution](EXECUTION.md) owns private Cell execution, Containment, Retirement,
and Reclamation. [Control](CONTROL.md) owns retained
revisions, events, logical digests, and inspection. [Delivery](DELIVERY.md) owns
Process standing, eligible transitions, and recovery. [Evidence](EVIDENCE.md)
owns Checks, review, and Evidence readiness. [Authority](AUTHORITY.md) owns
Founder-authenticated choices.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Core Rule

```text
provider activity is observation
Candidate state is reversible proposal state
Agent Work Product is agent-proposed semantics
runtime observation establishes operational facts
the event fold establishes standing and eligibility
caller judgment allocates resources
Founder authority changes admitted or canonical truth
```

A caller can be a founder-dev, an outer Agent, an interface, or a policy
controller. It can decide whether an eligible operation deserves resources. It
cannot make an ineligible operation eligible, turn a recommendation into
authority, or replace exact retained facts with a display summary.

## No Retained View Record

Foundation rc.10 has no Control family for a post-invocation dossier,
recommendation, current state, or current eligibility. The Attempt View is
compiled on demand from:

- the exact `agent-attempt` revision;
- its optional `agent-work-product` revision;
- its `execution-receipt` revision;
- the exact input Candidate Revision and Carrier, when applicable;
- the builder's optional successor `candidate-revision` and Carrier, when one
  was promoted;
- the active Work Boundary, Material Condition, Candidate Seal, Check Receipts,
  Evidence Packet, and Founder Decision selected by the event fold;
- the complete validated Journal head; and
- the installed Delivery reducer and view profile.

Foundation rc.10 selects qualification revision
`lifecycle.foundation.1.0.0-rc.10`, repository contract
`lifecycle.repository.v15`, runtime protocol
`lifecycle.runtime.foundation.v10`, interface protocol
`lifecycle.interface.foundation.v10`, and provider adapter
`lifecycle.provider-adapter.v6`. No unsupported coordinate has view, recovery,
or compatibility standing.

The view introduces no record family, event, Process state, or operation.
Foundation retains twelve Control record families, twenty-two Journal events,
and the nine public Delivery operations. Delivery is the sole Process.

The view MUST NOT be appended as a record, Journal event, adjacent file,
Founder decision input, transaction subject, or Knowledge document. A cache is
replaceable interface state. Deleting every cache MUST leave compilation,
eligibility, and recovery unchanged.

A human-readable export of the view is a derived inspection representation
under [Control](CONTROL.md#inspection-and-export). It cannot be imported,
referenced as a retained fact, or used to restore Process state.

## View Coordinate and Freshness

Every rendered Attempt View identifies the exact:

- Control Store and Delivery identities;
- Journal head sequence and logical digest;
- Agent Attempt identity, revision, and logical digest;
- installed reducer and view-profile coordinates;
- current Work Boundary and Candidate references when applicable; and
- active activity and recovery obligation when one exists.

Those values are a display coordinate, not a self-digested record identity. A
view is stale as soon as its Journal head, referenced revision, repository
epoch, Candidate successor disposition, or installed reducer selection changes.

An interface MUST show one coherent coordinate. It MUST NOT combine an old
obligation ledger, a newer Candidate summary, and current eligible operations
into an apparently stronger view. Refresh either replaces the complete display
coordinate or clearly leaves the earlier one visible as stale.

When an Attempt View is presented inside the selected Delivery View, both bind
the same runtime read generation. An interface does not independently join an
Attempt response, status response, Decision response, or Candidate difference
from another generation.

Before acting on any displayed operation, the runtime reopens the current
store, replays the Journal, verifies referenced revisions, observes required
live repository and Candidate facts, and resolves the operation's exact inputs.
The view is never a capability or transition permit.

## View Sections

One complete Attempt View contains bounded projections of:

### Attempt contract

- role and selected Delivery operation;
- exact subject, Work Boundary, Projection, and input Candidate Revision and
  Carrier binding;
- Provider Descriptor and installed adapter coordinate;
- Capability Profile plus stable Execution Backend Profile, Image,
  Specification, and Input Set identities and digests;
- caller-funded Investment and hard limits; and
- Role Brief, semantic template, parser, and Work Product Compiler profiles.

### Provider execution

- whether the provider effect was intended and observed;
- `completed`, `failed`, or `not-started` effect observation;
- normalized terminal reason, stage, first trigger, exit or signal, and timing;
- whether productive capability existed;
- cancellation, force, Cell Containment, Runtime-parent-loss, and Retirement
  facts;
- workspace submission, abandonment, or invalidity; and
- input-material, Input Set, Specification, Image, Output Manifest,
  workspace-byte, parse-result, and compiler provenance digests plus the
  optional final submission diagnostic; and
- exact Delivery recovery requirement when Containment, retrieval, promotion,
  or Retirement remains incomplete.

These execution facts are subordinate provenance for the selected Attempt.
Presentation MUST lead with Delivery standing, the Attempt or Check outcome,
Candidate consequence, Evidence consequence, and reducer-derived next action.
It MUST NOT promote a Cell condition, Backend phase, or Retirement detail into
the primary status, navigation model, or action vocabulary.

The provider-effect fields form one causal tuple. Observation requires prior
intent; the effect digest exists exactly when intent exists; and the outcome
exists exactly when observation exists. A retained Execution Receipt or its
public execution facts therefore requires one intended and observed effect,
the exact Specification digest, and one terminal outcome. Receipt-derived
provider, productive-execution, execution, Containment, and Retirement facts
MUST be absent until that exact Receipt is retained.

### Agent semantics

- exact Agent Work Product reference when one exists;
- semantic-body profile, body digest, and ordered fragment bindings;
- semantic disposition, summary, uncertainty, claims, citations, limitations,
  proposed effects, and role-specific proposal; and
- the final parser or compiler diagnostic code, stage, and facts digest when no
  valid Work Product exists.

### Candidate transition

- exact input Candidate Revision and Carrier for a builder;
- `promoted`, `not-produced`, `unavailable`, or `invalid` successor
  disposition;
- optional exact successor Candidate Revision and Carrier only for `promoted`;
- unchanged or changed content facts and bounded path findings when promoted;
  and
- Seal and Evidence invalidation caused by an actual promoted successor.

### Process and proof

- current Delivery standing and exact current subjects;
- obligation ledger and Check or review state;
- Material Condition standing;
- Evidence readiness and blockers;
- complete ordered eligible-operation identities; and
- active operation or exact recovery continuation.

The view can summarize large collections, but it MUST preserve every blocking
identity and make the exact underlying revision inspectable through the runtime.
It cannot replace a complete collection with a scalar progress score.

## Provenance Lanes

Every value remains in one of the standard provenance lanes defined by its
retained owner.

### Runtime-observed facts

Examples include:

- provider effect, terminal, timing, Containment, and Retirement facts;
- workspace byte observation and submission disposition;
- input Candidate Revision and Carrier, optional successor disposition, and
  changed paths when a successor was promoted;
- Check Receipt outcomes; and
- canonical branch, authoritative-worktree, or capability mismatch.

An observation establishes what the runtime directly proved. It does not by
itself establish semantic progress, Evidence readiness, or acceptance.

### Runtime-derived conclusions

Examples include:

- current Work Boundary and Candidate subjects;
- whether a Candidate Revision invalidates a Seal;
- obligation and Evidence standing;
- a Process-frozen Material Condition;
- recovery location; and
- eligible operations.

The installed rule and exact retained inputs own each conclusion. An Agent
summary cannot replace a deterministic conclusion.

### Agent-proposed semantics

The view renders Agent semantics only from the exact Agent Work Product. This
includes claimed completed work, remaining gaps, technical approach,
uncertainty, cited support, a possible Material Condition, reviewer judgment,
and proposed next route.

The view MUST keep those claims visibly distinct from runtime observations and
derived conclusions. If no Work Product exists, it MUST NOT recreate claims
from provider messages, event streams, Candidate diffs, stdout, stderr, or
error text.

Foundation rc.10 has no invocation-local validator exchange to expose or
reconstruct. Only the Receipt's bounded final post-Containment submission
diagnostic can appear. It has no draft excerpt, provider path, authoring
transcript, or replacement interpretation.

The view MUST NOT expose an Execution Handle, allocation key, Backend
locator, container identity, physical materialization, credential, private
runner channel, or asynchronous Reclamation state. Those are not facts a caller
needs to judge the Delivery.

### Founder semantics and authority

Founder Brief content is `founder-supplied`. An authenticated admission,
readmission, acceptance, or no-ship choice is `founder-authenticated`. The view
can render the exact retained decision subject and rationale, but it cannot
infer a new choice from earlier generic approval or an Agent recommendation.

## Invocation Interpretation

Provider effect, semantic submission, Candidate successor promotion,
Containment, and Retirement are separate facts.

A completed provider effect can have:

- a valid Agent Work Product;
- an invalid semantic submission;
- an explicitly abandoned workspace; or
- no submission under the Attempt's terminal policy.

For a builder, provider outcome does not determine Candidate outcome. A valid
Work Product can coexist with no successor. A missing Work Product can coexist
with a promoted successor. Timeout, cancellation, or provider failure can
coexist with a promoted successor when exact output survived Containment,
retrieval, validation, and Carrier publication. Provider success can coexist
with `not-produced`, `unavailable`, or `invalid` output. Incomplete Retirement
can coexist with an already observed provider outcome but blocks Activity
completion.

The view derives every branch from the Execution Receipt and exact related
records. It MUST NOT derive the branch from an exception, provider-specific
label, missing file, exit code alone, or interface history.

The view reports model, duration, tool count, output bytes, and cost only as
Investment observations. Those values are not progress, quality, or truth.

## Candidate Continuity

For a builder, the view joins the exact input Candidate Revision and Carrier to
one exact successor disposition. Only `promoted` has a successor Candidate
Revision. `not-produced`, `unavailable`, and `invalid` have a null successor and
create no Candidate Revision.

When no successor is promoted, the input Revision remains current because
there was no Candidate advance. The view states that fact directly; it does
not call the input a fallback, synthesize an unchanged terminal revision,
invent an empty digest, or expose an invalid or unavailable Candidate Revision.

A promoted successor binds its exact immutable Carrier and reports
`contentDisposition` as `changed` or `unchanged`. An unchanged promoted
successor can reuse the exact input Carrier while recording the builder Attempt
as its origin. Only an actual successor can invalidate a prior Seal or
Candidate-bound Evidence.

For reconnaissance before admission, Candidate is not applicable. During
boundary resolution, the current Candidate can appear as a reducer-derived
Process subject even though reconnaissance has no Candidate write capability.
For review, the view binds the exact sealed Candidate Revision and reports any
subject-integrity failure without creating a productive successor.

Candidate continuity is Carrier-based. Normal `delivery.continue` creates a
fresh Agent Attempt and fresh Cell from the reducer-selected current Revision
and exact immutable Carrier. Provider session memory, chat history, a prior
Cell, a workspace draft, a physical materialization, or a view cache is not
continuity.

## Obligation Ledger

The view projects every active Work Boundary obligation into one deterministic
ledger. Each entry identifies:

- stable obligation identity and source;
- category and governing Knowledge;
- required Evidence kind;
- current runtime-derived standing;
- related Agent claim when one exists;
- blocking consequence; and
- next establishment route.

Standard standings are:

- `not-evaluated`;
- `artifact-absent`;
- `artifact-present-uninspected`;
- `check-not-run`;
- `check-passed`;
- `check-failed`;
- `check-incomplete`;
- `review-pending`;
- `review-accepted`;
- `review-rejected`;
- `conflict`;
- `material-condition`;
- `satisfied-for-current-phase`; and
- `inapplicable-by-boundary`.

A proposition is not satisfied merely because a builder claims completion or a
related file changed. A derived `satisfied-for-current-phase` standing must name
the exact rule and retained fact that established it.

The view MAY show counts by category and standing. Counts are navigation, not a
completion score. It MUST retain every blocking obligation identity. It MUST
NOT calculate one percentage that hides a mandatory failure, unknown risk, or
authority requirement.

## Evidence View

For each selected Check, the view reports:

- Check Definition and Binding identities;
- temporal modality and exact proof subject;
- baseline and final Check Receipt references;
- pass, fail, incomplete, not-run, unsupported, or invalid disposition;
- environment and mutation findings;
- limitations; and
- whether fresh execution is required.

A provider statement that it ran a command is not a Check Receipt. A receipt
for another Candidate, Work Boundary, Seal, environment, or time cannot support
the current proposition.

For independent review, the view reports every proposition decision,
limitation, missing obligation, independence fact, and citation from the exact
reviewer Work Product and Evidence compilation. It cannot fill a missing review
value from caller input or builder prose.

Evidence readiness is runtime-derived from the exact Candidate Seal, required
Check Receipts, reviewer Work Product and Receipt, and proposition coverage.
Readiness is not Founder acceptance.

## Material Conditions

A builder or reviewer Work Product can propose a Material Condition. Review
requires exactly one proposal when its complete findings are material. The
Runtime freezes a distinct `material-condition` revision only after joining the
exact Work Product to:

- its Agent Attempt;
- its Execution Receipt;
- the exact current Candidate Revision: the builder successor when promoted,
  otherwise the unchanged builder input, or the reviewer-sealed input as
  applicable;
- the active Work Boundary; and
- the exact reducer coordinate.

The Agent proposal and runtime-frozen fact use the same `conditionClass` field
and exact closed vocabulary:

- `meaning-ambiguity`;
- `mandate-falsifier`;
- `scope-change`;
- `effect-change`;
- `risk-change`;
- `architecture-conflict`;
- `assurance-conflict`;
- `founder-tradeoff`;
- `missing-authority`;
- `missing-required-source`;
- `required-capability-unavailable`;
- `projection-closure-exceeded`; and
- `no-honest-route`.

There is no translation table and no catch-all Material Condition class. The
runtime rejects any other class. It verifies the exact Agent Attempt, Work
Product body fragment, Execution Receipt, current Candidate Revision, active
Work Boundary, admitted mandate and Knowledge references, and installed rule
coordinates. It then binds an exact observed-facts digest and freezes the
Process route. The Agent statement remains visibly agent-proposed source
semantics; prose alone does not establish the Process fact.

A builder Material Condition does not require a Candidate successor. When the
successor disposition is `not-produced`, `unavailable`, or `invalid`, the
frozen fact joins the exact input Revision that remained current plus the exact
no-successor Receipt facts. The Runtime does not manufacture a Candidate
Revision merely to give the condition a subject.

Canonical branch or authoritative-worktree movement during an admitted
Delivery is a lease violation, not a Material Condition class. The runtime
refuses productive and readmission operations until exact restoration or
no-ship.

A technical inconvenience is not automatically material. The installed rule
requires Founder judgment and exact current bindings before the runtime can
freeze productive work.

When a frozen condition is current, `delivery.continue` MUST NOT appear as
eligible. `delivery.revise`, `delivery.reaffirm`, readmission, or no-ship remain
distinct governed operations. Local correction is not a substitute for mandate
resolution.

## Process Standing, Eligibility, and Recovery

The view derives Process standing and eligible operations by replaying the
complete validated Journal and exact referenced revisions. The latest row,
latest record revision, interface tab, provider state, or cached label cannot
override that fold.

The view carries only complete ordered operation identities plus the exact
current subjects needed to explain them. It does not manufacture an input
envelope, authority subject, expected transition, capability grant, Execution
Specification, or Cell operation. The Runtime resolves those values when the
caller invokes a Delivery operation.

Eligibility is descriptive. Invocation must revalidate repository, Candidate,
lock, capability, authority, transaction, and current Journal facts. A stale
view cannot fund a stale subject.

If an Activity has an unresolved provider, Cell Containment, output retrieval,
Candidate promotion, Retirement, transaction, or finalization boundary, the
view exposes:

- exact activity and operation identities;
- recovery kind;
- last durable event;
- exact effect digest when applicable;
- next legal milestone; and
- only `delivery.recover` as the continuation operation.

Recovery resumes that exact retained activity. It does not create another
Agent Attempt, redispatch a provider after effect intent, allocate a replacement
Cell, choose another Candidate, or infer effect absence from missing support.
It exposes no Handle, allocation key, Backend locator, container command, or
manual Cell remedy. Only `delivery.recover` exists at the public boundary.

Asynchronous Reclamation is installation health, not Delivery recovery. It does
not appear in the Attempt View, block an otherwise complete view, or become an
eligible operation.

## Investment Allocation

The caller makes one fresh Investment decision after inspecting a coherent
Attempt View. The runtime compiles the selected allocation into the next Agent
Attempt. An allocation includes:

- selected eligible operation;
- runtime-resolved role;
- provider adapter and supported model;
- reasoning setting;
- wall-time allocation;
- optional per-invocation resource limits;
- caller policy identity and cumulative observation when maintained; and
- bounded rationale classification.

The allocation is fixed before dispatch. It grants resources, not Product or
Process meaning.

The caller does not select an Execution Backend, Profile, Image, Cell, Handle,
allocation key, Retirement action, or Reclamation policy. The Runtime selects
the installed qualified execution mechanism compatible with the exact
Capability Profile, provider, Check, and operation. Unsupported execution is a
truthful refusal, not permission to fall back to native host execution or a
test Backend.

### Next Pass presentation

Next Pass is an interface composer over one current Delivery View, not a
retained plan or runtime operation. It may offer only the currently eligible
members of `delivery.continue`, `delivery.evaluate`, `delivery.revise`, and
`delivery.reaffirm`. The view supplies the exact current subjects and a
prospective Investment requirement; the final immutable Investment identity is
created only when the new activity starts.

The Founder supplies one complete fresh semantic input for the selected pass.
The runtime finalizes it as a new Founder Brief, allocates a fresh Investment,
and creates a fresh Agent Attempt. Earlier interface input, summaries,
recommendations, provider sessions, or drafts are not inherited. Submission
binds the displayed read generation; the runtime refuses staleness and repeats
all live eligibility and subject checks before dispatch.

The TUI may send the selected non-authority operation to the canonical CLI. It
does not construct an operation envelope, choose hidden mechanics, authenticate
a Founder Decision, or continue recovery. Input remains available after a
refusal and is cleared only after one coherent successor view is established.

### Rationale classifications

A caller MAY classify its rationale as:

- `initial-probe`;
- `continue-known-local-gap`;
- `repair-failed-obligation`;
- `complete-proof-preparation`;
- `clarify-material-uncertainty`;
- `higher-capability-escalation`;
- `lower-cost-routine-implementation`;
- `independent-review`;
- `other-explicit`.

The classification supports later economics. It cannot override eligibility,
capability, Work Boundary, or Evidence requirements.

### Wall time and cumulative policy

Wall time is a caller-funded observation boundary, not a completion estimate.
Reaching it stops that invocation and returns control after containment and
truthful observation. It MUST NOT automatically renew provider work.

A caller MAY maintain cumulative ceilings for time, spend, invocations,
provider classes, or risk. The runtime exposes exact per-invocation
measurements. It MUST NOT claim a cumulative total it cannot bind across
restarts and Deliveries.

Sunk cost is not a reason to allocate more. Each next allocation must be
justified from current obligations, uncertainty, reversibility, and expected
value.

## Model Allocation

Lifecycle does not define one universal model hierarchy. A caller selects a
model supported by the provider adapter and allowed by policy.

The general allocation principle is:

```text
ambiguity, product judgment, boundary resolution, and independent review
  -> higher-capability reasoning

bounded implementation, local repair, deterministic artifact production,
and known Check correction
  -> cost-effective implementation reasoning
```

A lower-cost model does not receive weaker acceptance. It receives a coherent
Work Boundary, complete mandatory Projection, explicit obligations, and the
same deterministic Evidence gates. A higher-capability model does not receive
broader authority.

Escalation can be justified by repeated failure on one obligation without
Candidate improvement, architectural interaction, likely Material Condition,
conflicting Knowledge, high-consequence independent review, or caller policy.
Event count, token count, elapsed time alone, or model self-assessment is not
sufficient.

Routine correction can move to a lower-cost model when exact failure evidence
and remaining obligations make the route deterministic. The new model still
receives a fresh Agent Attempt, fresh Cell, and exact current Candidate Revision
Carrier.

## Continue, Correct, Evaluate, Resolve, or Stop

### Continue Candidate work

Continue when the Work Boundary remains coherent, the current Candidate
Revision and complete Carrier are available, no frozen Material Condition
exists, currentness is valid, the required capability and qualified Execution
Profile exist, and `delivery.continue` is eligible. The new Attempt is
independently funded.

### Correct the same Candidate

Correction is another `delivery.continue` focused on an artifact, Check,
review, or result-fitness gap inside the admitted mandate. A premature Agent
completion claim does not require boundary revision.

### Evaluate

`delivery.evaluate` is appropriate only when the runtime can seal the exact
current Candidate and perform required independent proof. An Agent proposal of
readiness is useful input but not eligibility.

A failed evaluation can return the same Candidate to correction. Only a
promoted Candidate successor invalidates the prior Seal and Candidate-bound
Evidence under Delivery; a failed Cell with no successor does not.

### Resolve the mandate

Revision or reaffirmation is appropriate only for a current frozen Material
Condition. Revision changes the complete Work Boundary semantics.
Reaffirmation preserves them while retaining Founder rationale for the
condition. Productive work resumes only after distinct authenticated
readmission.

### Stop Investment or no-ship

A caller MAY stop allocating resources at any review point. Stopping
Investment is not a terminal Process transition. The view must distinguish an
unfunded but open Delivery from Closure.

When no honest continuation exists, the Founder can select an eligible no-ship
operation. A caller or Agent cannot infer that terminal disposition.

## Recommendations

An interface or outer Agent MAY derive one advisory recommendation from the
same exact Attempt View. It must identify:

- the complete view coordinate;
- one eligible operation or `stop-investment`;
- rationale and uncertainty;
- expected obligation route;
- proposed model and Investment; and
- explicit nonauthority.

The recommendation is not retained Control and cannot become an operation
input. It cannot fabricate a missing Founder rationale, authority statement,
Candidate fact, or required capability. If the view is incomplete or stale,
the recommendation must say so and cannot be presented as the standard next
action.

## Concurrency and Disclosure

Several callers can inspect the same immutable coordinate. Only the operation
lock and Delivery contract decide whether an effect can start. Two displays,
recommendations, or funding intentions do not create two legal productive
owners of one Candidate.

The view can expose repository-relative product paths and exact Control
identities needed for judgment. It MUST omit:

- physical repository, Candidate materialization, Cell, workspace, checkpoint,
  or transaction paths;
- authority secret bytes and signing handles;
- provider credentials and hidden provider state;
- environment secret values;
- process, Cell, allocation, Retirement, and Reclamation handles or locators;
- raw event payloads or adjacent-file bytes without explicit read capability;
  and
- another target's or Delivery's facts.

Omission must preserve enough public identity to invoke the exact eligible
operation through the runtime. A caller is never asked to copy an omitted
physical value into an authority-bearing request.

## Failure and Incomplete Views

View compilation fails closed when the store, Journal, referenced revision,
logical digest, relationship, reducer order, or current subject is invalid. It
does not choose the newest row, longest event chain, most recent interface
cache, or strongest-looking conclusion.

When bounded source material is unavailable but the store remains valid, the
view can be explicitly incomplete. It MUST retain every known blocking fact and
at least one stable diagnostic. It MUST NOT truncate a required obligation,
Evidence item, eligible operation, or recovery fact and still claim a complete
view.

Standard diagnostics use the `lifecycle.attempt-view.` namespace. At minimum:

<!-- markdownlint-disable MD013 -->

| Code | Condition |
| --- | --- |
| `lifecycle.attempt-view.binding` | Attempt, Receipt, Work Product, input Candidate, optional successor, boundary, or Process subjects do not join exactly. |
| `lifecycle.attempt-view.stale` | The displayed coordinate is no longer current. |
| `lifecycle.attempt-view.obligation-missing` | An active-boundary obligation is absent from the ledger. |
| `lifecycle.attempt-view.provenance` | Agent semantics are represented as runtime facts or Founder authority. |
| `lifecycle.attempt-view.evidence-subject` | Check or review material names another subject. |
| `lifecycle.attempt-view.eligibility` | A displayed or recommended operation is not in the exact reducer result. |
| `lifecycle.attempt-view.progress` | Activity is represented as semantic progress or completion. |
| `lifecycle.attempt-view.authority` | Founder-owned input or authentication is inferred, absent, or stale. |
| `lifecycle.attempt-view.disclosure` | The view exposes access-restricted operational or secret material. |
| `lifecycle.attempt-view.incomplete` | A limit, race, or unavailable source prevents complete derivation. |

<!-- markdownlint-enable MD013 -->

A view diagnostic changes no retained revision or event. Exact recovery or a
new valid event coordinate is required before a stronger conclusion appears.

## Example Decision Sequence

```text
admitted Work Boundary and initialized Candidate
  -> caller funds one bounded builder Attempt
  -> Runtime materializes the exact input Revision Carrier in one Cell
  -> provider times out after producing useful provisional output
  -> Runtime contains the Cell, retrieves and validates the output
  -> atomic promotion publishes an exact successor Revision Carrier
  -> Receipt records timeout, no Work Product, promoted successor, and Retirement
  -> Attempt View shows the successor and final Check obligations still open
  -> caller funds a fresh correction Attempt from that successor Carrier
  -> Agent submits a Work Product proposing readiness
  -> Runtime seals and evaluates the exact Candidate
  -> reviewer Work Product rejects one proposition with exact Evidence
  -> Attempt View identifies a correctable gap
  -> caller funds one bounded repair Attempt
  -> fresh evaluation establishes Evidence readiness
  -> Founder separately authenticates exact acceptance
```

No step renews work automatically. No model chooses its own authority. No
semantic claim replaces Candidate promotion, the obligation ledger, Evidence,
or the event fold.

## Non-Goals

The Attempt View does not:

- create a mutable Process-state record;
- retain another summary beside exact Attempt-family revisions;
- predict completion time or compute a universal productivity score;
- prove that a model read or understood context;
- prescribe the builder's internal itinerary;
- replace Work Boundary revision or Material Condition handling;
- accept a Candidate or authenticate Founder judgment;
- use provider sessions, Cells, materializations, or workspace drafts as
  continuity;
- expose Cell allocation, dispatch, observation, cancellation, retrieval,
  Retirement, Reclamation, or retry as a public workflow, CLI command, TUI
  screen, operator choice, or parallel state machine;
- infer progress from edits, commands, event volume, or elapsed time; or
- weaken Evidence or recovery for interface convenience.

Its purpose is narrower: expose one truthful, bounded, reproducible review
subject from which the next resource decision can be made without losing the
active Work Boundary, Candidate, obligations, Evidence, or authority boundary.
