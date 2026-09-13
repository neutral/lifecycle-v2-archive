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
Director-authenticated choices.

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
Director authority changes admitted or canonical truth
```

A caller can be a human or agent Director, an interface acting for it, or a
policy controller within explicit resource permission. It can decide whether
an eligible operation deserves resources. It cannot make an ineligible operation
eligible, turn a Worker recommendation into authority, or replace exact retained
facts with a display summary. The [operating roles](AUTHORITY.md#operating-roles)
require no additional human approval solely because the Director is an agent.

## No Retained View Record

Foundation rc.17 has no Control family for a post-invocation dossier,
recommendation, current state, or current eligibility. The Attempt View is
compiled on demand from:

- the exact `agent-attempt` revision;
- its optional `agent-work-product` revision;
- its `execution-receipt` revision;
- the exact input Candidate Revision and Carrier, when applicable;
- the builder's optional successor `candidate-revision` and Carrier, when one
  was promoted;
- the active Work Boundary, Material Condition, Candidate Seal, Check Receipts,
  Evidence Packet, and Director Decision selected by the event fold;
- the complete validated Journal head; and
- the installed Delivery reducer and view profile.

Foundation rc.17 selects qualification revision
`lifecycle.foundation.1.0.0-rc.17`, repository contract
`lifecycle.repository.v22`, runtime protocol
`lifecycle.runtime.foundation.v17`, interface protocol
`lifecycle.interface.foundation.v17`, and provider adapter
`lifecycle.provider-adapter.v7`. No unsupported coordinate has view, recovery,
or compatibility standing.

The view introduces no record family, event, Process state, or operation.
Foundation retains fourteen Control record families, twenty-five Journal events,
and the ten public Delivery operations. Delivery is the sole Process.

The view MUST NOT be appended as a record, Journal event, adjacent file,
Director decision input, transaction subject, or Knowledge document. A cache is
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

Foundation rc.17 has no invocation-local validator exchange to expose or
reconstruct. Only the Receipt's bounded final post-Containment submission
diagnostic can appear. It has no draft excerpt, provider path, authoring
transcript, or replacement interpretation.

The view MUST NOT expose an Execution Handle, allocation key, Backend
locator, container identity, physical materialization, credential, private
runner channel, or asynchronous Reclamation state. Those are not facts a caller
needs to judge the Delivery.

### Director semantics and authority

Director Brief content is `director-supplied`. An authenticated admission,
readmission, acceptance, or no-ship choice is `director-authenticated`. The view
can render the exact retained decision subject and rationale, but it cannot
infer a new choice from earlier generic approval or an Agent recommendation.
These classes apply equally to human and agent Directors. A missing Director
decision is an exact responsibility to return to that counterpart, not a claim
that a human must approve. Runtime-supplied next-step presentation MUST preserve
the required decision and authentication without inventing the actor's type.

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
Readiness is not Director acceptance.

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
- `director-tradeoff`;
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

Canonical movement alone neither freezes historical work nor spends an Attempt.
The independent integration operation can construct a new Candidate successor;
its exact contextual assessment may create the runtime-owned Condition variant.
That operation has no provider Attempt. Attempt View MUST keep provider outcomes,
semantic validity, and Candidate advancement separate from integration status.

A technical inconvenience is not automatically material. The installed rule
requires Director judgment and exact current bindings before the runtime can
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

The caller selects fresh Investment after inspecting a coherent Attempt View,
either through a manual resource choice or a retained Work Delegation whose
fixed policy justifies the next allocation from current facts. The runtime
compiles that allocation into the next Agent Attempt. An allocation includes:

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
members of `delivery.continue`, `delivery.integrate`, `delivery.evaluate`,
`delivery.revise`, and `delivery.reaffirm`. Every row supplies the exact current
subjects and consequence. Agent operations supply a prospective Investment
requirement; the final immutable Investment identity is created only when the
new activity starts. Integration instead has no Agent role or Investment;
its typed row sets both to null.

Integration submits only the exact displayed generation. The Runtime selects
the canonical parent and fixed merge rule; the interface supplies no semantic
Markdown, authority material, parent, or strategy. A completed observation is
not a claim that a Candidate successor was selected; the retained Assessment
and current Candidate remain distinct facts.

For a manually requested Agent pass, the Director supplies one complete fresh semantic input.
The runtime finalizes it as a new Director Brief, allocates a fresh Investment,
and creates a fresh Agent Attempt. Earlier interface input, summaries,
recommendations, provider sessions, or drafts are not inherited. Submission
binds the displayed read generation; the runtime refuses staleness and repeats
all live eligibility and subject checks before dispatch.

A delegated builder or reviewer pass uses the original exact standing Director
Brief selected by its Work Delegation. It still receives fresh Runtime context
and Investment. The interface MUST distinguish this recorded standing input
from a new manual request; it MUST NOT populate a new Director Brief with
Runtime-generated directions.

The TUI may send the selected non-authority operation to the canonical CLI. It
does not construct an operation envelope, choose hidden mechanics, authenticate
a Director Decision, or continue recovery. Input remains available after a
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
truthful observation. It MUST NOT renew that invocation. A fresh pass under an
explicit Work Delegation requires settled prior work, current eligibility,
independently useful work and a new reserved allocation; elapsed time or sunk
cost alone cannot justify it.

A caller MAY maintain cumulative ceilings for time, spend, invocations,
provider classes, or risk. The runtime exposes exact per-invocation
measurements. It MUST NOT claim a cumulative total it cannot bind across
restarts and Deliveries.

### Work Delegation

A **Work Delegation** is explicit Director-supplied permission to allocate finite
reversible labor under one exact active Work Boundary and its admission. It
does not admit Product behavior and does not authorize acceptance or no-ship.
Its selected family is `work-delegation`, payload
`lifecycle.work-delegation.v2`. The Runtime retains its exact resource selections;
the public caller still cannot supply a Cell, allocation key, generic executable
or arbitrary Backend. A delegation is not a retained next-operation cursor.

The payload has exactly these members:

| Member | Meaning |
| --- | --- |
| `schema` | The selected Work Delegation payload schema |
| `boundary`, `admission` | Exact Control references to the active Work Boundary and its admitting Director Decision |
| `replaces` | Exact preceding Work Delegation revision, or null for the first |
| `policy` | Exact fixed policy ID and canonical definition digest |
| `allowedOperations` | Nonempty unique codepoint-sorted subset of `delivery.continue`, `delivery.evaluate`, `delivery.integrate` |
| `directions` | Exact original Director Brief references for `continue` and `evaluate`, or null when that operation is absent |
| `agentSelections` | Runtime-resolved exact builder and reviewer resource selections, or null when that Agent operation is absent |
| `ceilings` | Lifetime delegated `operations`, `agentAttempts` and `reservedCellWallTimeMs` maxima |
| `expiresAt` | Canonical UTC expiry, or null; equality with observation time means expired |
| `stopPolicy` | `finish-reserved-operation` |

An Agent selection binds the Provider Descriptor ID/digest, Backend Profile
ID/profile digest/implementation digest, Image ID/digest, supported model and
reasoning setting, positive `wallTimeMs`, and the existing exact Agent Investment
limits. The Director selects resource intent; Runtime resolves the installed
physical selections. A supplied selection does not prove availability or
qualification. Every actual allocation must independently satisfy the owning
execution checks. No selection or reference may silently follow a later revision.

The fixed policy ID is `lifecycle.work-delegation.standard-v1`. Its digest is the
canonical JSON digest of the following exact definition:

```json
{
  "id": "lifecycle.work-delegation.standard-v1",
  "operations": ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
  "accounting": "delivery-lifetime-delegated-reservations-no-refunds",
  "stop": "finish-reserved-operation",
  "authority": "no-mandate-or-terminal-decision",
  "continuation": "fresh-eligible-useful-work-after-settlement",
  "maximumCellWallTimeMs": 86400000,
  "maximumSlots": 4097
}
```

Each operation charge is one; an integration has zero Agent and Cell-wall-time
charges. A Continue has one builder slot. An Evaluate has every potentially
required final Check slot and one reviewer slot. Slots have unique ascending
codepoint IDs; Check slots also have unique selection IDs. The bound permits
the existing 4,096 selected Checks plus one reviewer. Per-Cell wall time is
positive and at most 86,400,000 milliseconds. All counts, limits and sums must
be safe integers. Operations has a positive ceiling; an integrate-only grant
may select zero Agent and wall-time ceilings. An included Agent operation
requires its standing direction, Agent selection and positive Agent/time
ceilings. Absent Agent operations require null associated members.

The slot-count bound does not enlarge the Control event payload. The complete
`activity-started` payload, including all reservation fields, MUST fit its
existing 65,536-byte canonical JSON bound and other Control JSON limits.
Compilation MUST refuse an oversized delegated opening before Activity or
resource allocation with `lifecycle.work-delegation.resource-limit`. It MUST
NOT drop selected Checks, compress away exact resource identity, raise the
Control bound, or silently switch to manual execution. The Director can stop
the delegation and explicitly request the ordinary manual operation when its
existing contract supports the full selected work.

The reservation is `lifecycle.work-delegation-reservation.v1`. It binds its
identity, exact delegation reference, Activity ID, selected operation, decision
basis, closed slots and derived charges. The decision binds the freshly observed
Journal head and exact facts digest with one operation-specific reason:
`develop-candidate` or `correct-in-scope-findings` for Continue,
`integrate-ready-candidate` for Integrate, or `evaluate-integrated-candidate` for
Evaluate. The resource compiler cannot establish eligibility or truth from a
caller-supplied digest; operation and Store owners must establish those joins.
Agent slots bind their role and complete selected resources. Check slots bind
`selectionId`, phase `final`, Definition ID/revision/source digest/semantic
digest, Binding ID/digest, Backend Profile, Image and complete effective
Execution limits. The Check slot's wall time equals its Execution limit.

The Runtime MUST retain the exact reservation in the `activity-started` payload
in the same atomic opening as the Activity and recovery support, before physical
allocation. That opening event is the immutable reservation reference; a
separate reservation event or orphan reservation is not permitted. An ordinary
manual opening has no reservation. Charges are sums of reserved
maxima, not elapsed Delivery duration, model quality, money or token usage.
The full reservation remains charged when some slots do not execute or finish
early; there are no automatic refunds. Duplicate replay cannot charge twice.
Journal-derived totals survive Activity disposal and restart. A replacement's
ceilings apply to all delegated reservations in the Delivery, including earlier
grants; replacement and readmission MUST NOT reset those totals. A replacement
below already charged totals refuses. Manual work outside the delegation is
explicitly separate, not silently included in an all-spending cap. While a
same-Boundary grant is active, productive work MUST use its allowed reserved
delegation route and original standing Brief. A fresh direction or productive
operation outside that grant requires explicit stop or replacement first. The Runtime MUST NOT
silently convert or discard a fresh supplied Brief, or fall back to uncapped
defaults.

At each settled boundary a Runtime caller may compose one of those existing
operations only after fresh observation, useful-work justification and an
atomic reservation. It MUST return for exhausted or expired allowance, a
recorded stop, changed mandate/admission, Material Condition, required source
or capability absence, unsupported selection, a Director tradeoff or authority
choice, no useful bounded course, or acceptance-ready Evidence. Repeating an
unchanged outcome is not useful-work justification. It cannot automatically
revise, reaffirm, readmit, accept or no-ship. A new Runtime process may resume
only through an explicit run or exact recovery request; opening a target or
reloading a browser does not start work or reset accounting.

**Finish this operation, then stop** records a durable request that prevents
another reservation. It permits the already reserved finite operation,
including its remaining Check/reviewer Cells and exact recovery, to settle.
It does not promise immediate cancellation or a cleanup deadline. The Stop and
reservation transaction order determines whether the current operation was
already reserved. A stop is acknowledged only after durable commit; unknown
transport outcomes require observation. The Store owns pending stop custody,
its eventual Journal fact and archive disposition; an interface abort signal
cannot substitute for them. Exhaustion or stop does not abandon containment,
retirement or a retained recovery obligation.

Mandate admission, the standing direction and resource permission have distinct
lifetimes. Director Brief payload v2 records delegation scope for an original
standing Brief; each delegated Attempt links those exact bytes. Readmission
invalidates the old Boundary-bound permission. Acceptance remains an explicit
authenticated Director decision over the exact supported result.

Sunk cost is not a reason to allocate more. Each next allocation must be
justified from current obligations, uncertainty, reversibility, and expected
value.

### Fixed useful-work selection

The selected foreground policy composes the existing Continue, Integrate and
Evaluate operations. It is a disposable interpretation of retained owner facts,
not a second Process, durable cursor or acceptance interpreter. One invocation
holds the existing Delivery writer lock across its finite course. Every next
operation requires a fresh decision and complete reservation after the previous
Activity, its containment and its recoverable file custody have settled.

The following distinctions govern that selection:

- An admitted Candidate without an applicable completed productive result may
  receive its first Continue under the original standing direction.
- A valid builder readiness proposal about the exact retained Candidate
  justifies integration. Readiness can concern unchanged bytes; it does not
  itself establish evaluation or acceptance.
- A newly constructed exact integration result justifies evaluation. Merely
  retaining integration ancestry after another builder change does not.
- A failed integration with exact useful attempted-parent correction facts
  can justify a corrective Continue. A Material Condition instead returns for
  resolution and authenticated readmission.
- Actual valid changed Candidate bytes can justify another Continue even when
  the provider failed or no valid Work Product was submitted. They cannot
  substitute for a readiness proposal, independent review or Evidence.
- Invalid submission syntax can justify one bounded corrective pass over the
  same Candidate content and governing basis. A repeated invalid or unchanged
  corrective result returns to the Director. New event IDs, timestamps or grant
  revisions alone do not demonstrate progress.
- A complete evaluated result with concrete in-scope rejected obligations or
  failed Checks can justify correction. Unresolved execution or proof returns
  for observation. Acceptance-ready Evidence and a no-ship recommendation both
  return for the distinct authenticated Director decision.

The policy MUST NOT select another operation merely because the justified one
was not delegated. Exhausted or unavailable resources stop fresh allocation;
they do not erase retained progress or reopen an existing execution. A lost or
substituted operation return ends the foreground invocation even when a later
observation proves that the Activity settled. An explicit new run reassesses
those retained facts; it does not redispatch the completed Activity. Restart,
resource restoration and browser reload do not create a fresh grant or reset
its lifetime charges.

These are bounded productive courses with supplied prerequisites. They do not
claim unconditional liveness, guaranteed software correctness, or completion
while required resources, context or Director choices remain unavailable.

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

### Integrate

`delivery.integrate` selects an exact canonical parent and attempts to construct
the result that could be published there. Its request has a read generation,
not Agent semantics or Investment. A conflict supplies correction context and
preserves the current Candidate. A constructed result can require governing-
context resolution and readmission before evaluation. This assessment connects
independent Candidate work to the current publication basis without leasing the
canonical branch for the Delivery's lifetime.

### Evaluate

`delivery.evaluate` is appropriate only when the current Candidate has exact
integration provenance and the Runtime can seal that revision and perform
required independent proof. An Agent proposal of
readiness is useful input but not eligibility.

A failed evaluation can return the same Candidate to correction. Only a
promoted Candidate successor invalidates the prior Seal and Candidate-bound
Evidence under Delivery; a failed Cell with no successor does not.

### Resolve the mandate

Revision or reaffirmation is appropriate only for a current frozen Material
Condition. Revision changes complete mandate semantics; reaffirmation preserves
them while retaining Director rationale and any permitted changed basis or
Projection selection. Both create an exact successor Work Boundary, whose
complete envelope includes more than its mandate. Productive work resumes
only after distinct authenticated readmission.

### Stop Investment or no-ship

A caller MAY stop allocating resources at any review point. Stopping
Investment is not a terminal Process transition. The view must distinguish an
unfunded but open Delivery from Closure.

When no honest continuation exists, the Director can select an eligible no-ship
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
input. It cannot fabricate a missing Director rationale, authority statement,
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
| `lifecycle.attempt-view.provenance` | Agent semantics are represented as runtime facts or Director authority. |
| `lifecycle.attempt-view.evidence-subject` | Check or review material names another subject. |
| `lifecycle.attempt-view.eligibility` | A displayed or recommended operation is not in the exact reducer result. |
| `lifecycle.attempt-view.progress` | Activity is represented as semantic progress or completion. |
| `lifecycle.attempt-view.authority` | Director-owned input or authentication is inferred, absent, or stale. |
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
  -> integration constructs the exact result over the selected canonical parent
  -> any required governing-context resolution and readmission complete
  -> Runtime seals and evaluates the exact integrated Candidate
  -> reviewer Work Product rejects one proposition with exact Evidence
  -> Attempt View identifies a correctable gap
  -> caller funds one bounded repair Attempt
  -> exact integration provenance is reestablished when required
  -> fresh evaluation establishes Evidence readiness
  -> Director separately authenticates exact acceptance
  -> conditional publication is truthfully observed and Closure retained
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
- accept a Candidate or authenticate Director judgment;
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
