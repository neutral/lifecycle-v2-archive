# Lifecycle Agent Attempts

> Status: Draft

## Purpose

This document defines the Foundation rc.17 provider-neutral Agent Attempt
contract. It separates Process authority, projected context, caller-funded
Investment, capability, disposable execution, Agent-authored semantics,
Candidate successor promotion, and deterministic Process continuation.

An adapter can operate `codex exec` or another provider without moving product
or Process authority into that provider. The stable execution waist is:

```text
runtime-finalized Agent Attempt + exact Execution Specification
  -> governed body-only Markdown workspace
  -> one disposable Attempt Cell
  -> provider tool turns and provisional product work
  -> terminal containment and exact Output Carrier retrieval
  -> Agent Work Product submission or truthful abandonment
  -> optional atomic Candidate successor promotion when the role is builder
  -> Runtime-owned Execution Retirement
  -> Execution Receipt
  -> reducer-derived Attempt View
```

[Control](CONTROL.md) owns the SQLite carrier, common record lifecycle,
common Activity kernel, private operation-support checkpoints, immutable
revision mechanics, relationships, events, adjacent files, sealing, and
archive.
[Projection](PROJECTION.md) owns
role context. [Delivery](DELIVERY.md) owns Process transitions and recovery.
[Attempt View](ATTEMPT_VIEW.md) owns post-Attempt review and Investment choices.
[Execution](EXECUTION.md) owns the private Execution Backend, Profile,
Specification, Input Set, Image, Cell, Handle, Output Carrier, Output Manifest,
Containment, Retirement, and Reclamation contracts.
[Security](SECURITY.md) owns physical containment, secrets, and operated
qualification.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Foundation rc.17 Cut

Foundation rc.17 selects:

- qualification revision `lifecycle.foundation.1.0.0-rc.17`;
- repository contract `lifecycle.repository.v22`;
- runtime protocol `lifecycle.runtime.foundation.v17`;
- interface protocol `lifecycle.interface.foundation.v17`; and
- provider adapter coordinate `lifecycle.provider-adapter.v7`.

The normative `codex-exec-standard-v7` Provider Descriptor selects
`openai-codex-cli` compatibility range `>=0.153.4 <0.154.0`. The current
Agent Execution Image selects the exact tool version `0.153.4`.
The compatible range describes the adapter contract; it does not authorize a
mutable image, an ambient executable, or another 0.153.x image that has not
been independently identified and qualified. Versions outside this range,
including Codex `0.151.0`, MUST be refused before provider dispatch. This
selection does not substitute resources for an Attempt already frozen under
different exact inputs; see [Provider Evolution](EVOLUTION.md#provider-evolution).

Unsupported or mixed-generation Attempt carriers have no standing, migration,
recovery, or compatibility meaning.

Every dispatched Agent Attempt acts as the Worker in the
[Director–Worker pair](AUTHORITY.md#operating-roles). Foundation rc.17 has
exactly three Worker assignments, selected by the existing `role` field:

- `reconnaissance`;
- `builder`; and
- `reviewer`.

These are execution assignments within the Worker role. The Director can be a
human or an agent and supplies the bound Director Brief. A human can contribute
as a Worker at another work level; this Agent Attempt contract still dispatches
the selected software provider through its exact Execution Backend and does not
define a human-provider execution route.

The Agent edits one governed body-only Markdown workspace over any number of
provider turns allowed by the Attempt. It can inspect and correct the same
draft before finishing. The selected local draft assistance profile can inspect
that draft against an exact immutable basis without establishing submission
validity, authority, or currentness. Provider
terminal text is not the semantic submission. After Execution Containment, the
runtime independently retrieves, observes, validates, and compiles a valid
final submission into one
`agent-work-product` Control revision and records provider execution in a
distinct `execution-receipt` revision.

There is no agent-authored envelope, front matter, fixed binding, identity,
ordering, digest, or transport object. There is no additional retained
post-Attempt summary family. Current interpretation is derived from the event
fold and exact retained revisions.

The hard-cut compatibility and refusal rules are owned by
[Control](CONTROL.md). A predecessor provider, execution, or whole-document
contract cannot be interpreted as a Foundation rc.17 Attempt.

The Attempt adapter does not define an additional Control record family,
Journal event, Delivery state, or public operation. Foundation retains fourteen
Control record families,
twenty-five Journal event types, and the ten public Delivery operations.
Delivery is the sole Process. An Execution Cell is private Runtime mechanism,
not a Cell workflow, public job, operator retry surface, or parallel state
machine.

## Authority Rule

An Agent owns useful labor and semantic proposals inside one exact Attempt. It
does not own:

- admission, readmission, acceptance, or no-ship;
- Work Boundary expansion or reinterpretation;
- Candidate identity, Revision Carrier, successor creation, or promotion;
- capability, Investment, or provider selection;
- Execution Backend, Profile, Image, allocation, dispatch, Retirement, or
  Reclamation selection;
- Process state or operation eligibility;
- Check facts, Evidence readiness, or reviewer independence;
- canonical repository motion; or
- runtime identities, references, ordering, digests, serialization, SQL, or
  retention.

The runtime physically produces every retained Attempt-family revision. The
Agent is semantic author only for its Agent Work Product. That Work Product has
`agent-proposed` authority until an owning runtime observer, Evidence compiler,
or Director-authenticated decision establishes a different fact under its own
contract.

## Agent Attempt Record

The Agent Attempt is one immutable, single-revision `agent-attempt` Control
record finalized before provider effect intent. Its producer and semantic
author are the runtime, and its record-level authority is `runtime-derived`.
It contains no future provider observation, Work Product, Candidate Revision,
or Receipt.

The typed Attempt payload binds at least:

- exact target, Delivery, activity, Attempt, invocation, and role identities;
- selected Delivery operation and pre-dispatch reducer coordinate;
- exact repository observation and Projection;
- the exact activity Director Brief plus the active Work Boundary, Candidate
  Revision, Candidate Seal, or other role subjects required by that role;
- selected Capability Profile, Execution Backend Profile, Execution Image,
  and exact Execution Input Set digest;
- caller-funded Investment and hard limits;
- Provider Descriptor, its selected executable-identity class, the exact
  installed executable identity resolved before intent, and adapter-v7
  compatibility;
- exact Role Brief, semantic-body template, parser, and Work Product Compiler
  profiles;
- governed workspace template and submission policy;
- input inventory and citation registry digests;
- cancellation, Cell containment, parent-loss, Retirement, and recovery
  policy; and
- allowed adjacent-file purposes and byte limits.

The relationship set is governed by the closed registry in
[Control](CONTROL.md#relationship-registry). The runtime derives every
relationship from validated subjects; a caller or Agent cannot supply an
opaque digest as a substitute.

The full resolved effective execution selection is private retained operation
support under [Execution](EXECUTION.md#retained-execution-selection), established
before allocation. Recovery reuses it through observation and Retirement even
when installed defaults change. Public identity bindings do not substitute for
retaining the exact selected resource description and policy bodies.

The Runtime first compiles the exact immutable Input Set and prearms one Cell
with `allocate(specification, allocationKey)` under
[Execution](EXECUTION.md#deterministic-allocation). Allocation cannot start
productive work. The Runtime then revalidates the exact Process head,
operation, Projection, subject, Candidate Revision and Carrier, capability,
provider installation, Investment, and applicable repository epoch at the last
pre-Attempt and pre-intent boundary. Reconnaissance uses the exact current epoch
selected for a proposed Boundary. Builder and reviewer execution retain the
active Boundary's historical admitted epoch and Atlas snapshot. Integrated
Candidate context additionally binds the exact retained application parent,
and reviewer context preserves its separate Knowledge occurrence. Canonical
movement does not replace those subjects or prevent historical work. The
Runtime does not resolve a live Atlas for those operations.

Success finalizes the Attempt, `agent-attempt-prepared`, provider effect
intent, permanent dispatch-authority consumption, and the exact
operation-support replacement in one ordered atomic Store batch. Only then may
the Runtime call `dispatch` once. Changed input retains no Attempt or effect
intent, retires the unused Cell, records `agent-pre-intent-refused`, and
completes the activity as `abandoned`. The provider effect plan binds the same
installed executable and Image identities. Direct terminal observation MUST
reproduce them; a null or different identity is not an eligible semantic
submission even when the provider otherwise returns cleanly.

## Standard Roles

The following standard `role` values select a Worker assignment and its exact
capability and return contract. They do not change the Director counterpart or
authorize the Worker to take over that Director's reserved decisions.

### Reconnaissance

Reconnaissance performs read-only product judgment support. It operates for:

- initial `delivery.prepare` before a Candidate exists;
- `delivery.revise` after one frozen Material Condition; or
- `delivery.reaffirm` after one frozen Material Condition.

An initial preparation Attempt binds one complete fresh Director Brief and the
current Orientation Projection. The Director supplies complete direction for
that preparation; the Worker gathers and checks supporting information within
its projected sources and capability. The runtime MUST NOT silently add a prior
Brief, agent
summary, Work Product, interface transcript, provider conversation, or cached
prompt. Earlier successful proposals remain Process history and currentness is
reducer-derived, but they are not implicit input to the fresh Attempt.
Interruption, abandonment, or invalid semantics cannot displace the prior
reducer-selected proposal. Only a newly finalized Work Boundary revision can
become the next admission subject.

A boundary-resolution Attempt binds one fresh boundary-resolution Director
Brief, the exact active Work Boundary, frozen Material Condition, current
Candidate Revision, selected resolution operation, and current Orientation
Projection. The runtime derives that subject; the Agent cannot select a
different condition or boundary.

Reconnaissance can submit:

- complete Work Boundary semantics supported by exact citations;
- a preparation condition identifying missing, conflicting, or inaccessible
  material;
- a recommendation to narrow or split the objective; or
- a truthful no-product explanation.

The Work Product remains proposal material. The runtime independently compiles
the exact Work Boundary revision, repository basis, baseline Check Receipts,
bindings, and completeness facts. Reconnaissance cannot admit its proposal,
write product files, create Candidate state, change Atlas, create Knowledge,
grant capability, or manufacture future proof.

No Agent role can mutate the authoritative Atlas root. The provider-visible
Atlas projection is read-only semantic context from one complete valid Atlas
Resolution. Every Attempt write policy MUST exclude the entire root regardless
of role, Work Product claim, cited Resource, or Candidate path request.
For an admitted Boundary, that Resolution and every bound Resource byte come
from its exact historical repository snapshot, not the current canonical Atlas
or live worktree.

### Builder

The builder performs productive reversible work on the exact current Candidate
under the exact active Work Boundary. It can inspect, plan, edit, run local
tools, correct earlier work, and revise its semantic body throughout the
provider-active window.

One builder Attempt does not need to complete the Candidate. Its Work Product
can truthfully communicate:

- useful progress and remaining work;
- a proposal that the Candidate is ready to seal and evaluate;
- a possible Material Condition;
- inability under the current capability or available knowledge; or
- no useful semantic product.

Those are Agent proposals. Candidate readiness, changed files, obligations,
Check outcomes, Evidence readiness, and a Process-frozen Material Condition are
runtime-observed or runtime-derived facts under their owning contracts.

Every builder invocation is independently funded and observed. Timeout,
cancellation, provider failure, invalid submission, context exhaustion, or a
failed local command does not itself create a new governance phase, destroy the
input Candidate Revision, or determine whether output can be promoted. After
Containment, the Runtime retrieves and independently validates any exact Output
Carrier. A successor Candidate Revision is created only through the atomic
promotion rule in [Candidate Successor Promotion](#candidate-successor-promotion).
When no successor is promoted, the predecessor remains current because no
Candidate advance occurred. There is no invalid or unavailable Candidate
Revision standing in for lost physical work.

### Reviewer

The reviewer is read-only and independent of productive builder execution. It
receives the exact Candidate Seal, sealed Candidate Revision, active Work
Boundary, required Check Receipts, evaluation propositions, and reviewer
Projection.

Its Work Product also supplies the exact mandate and original-baseline
applicability judgments defined by [Evidence](EVIDENCE.md#integration-applicability-review).
The Attempt and Projection bind the exact integration parent/result; the Agent
does not author replacement subject coordinates. Every required baseline Receipt
is covered exactly once and retains its original observation subject.

Its Work Product supplies one judgment for every proposition, exact supporting
citations, limitations, missing-obligation findings, uncertainty, and any
mandate excess. When those semantics establish that correction would exceed
the admitted mandate, it also supplies one typed Material Condition proposal
using the shared closed class vocabulary. It MUST NOT supply an aggregate
acceptance, completeness bit, Evidence readiness, Process freeze, or Director
decision. The runtime derives proposition coverage, independence, any
Process-frozen Material Condition, Evidence readiness, and the Evidence Packet.

The reviewer receives no Candidate write capability. It cannot repair the
Candidate, rerun productive implementation, waive a proposition, alter a
Check Receipt, or perform acceptance. Any observed mutation of its sealed
subject is an integrity failure that invalidates the evaluation coordinate.

## Exact Subject and Projection Binding

Every Attempt binds one runtime-derived exact subject. A public caller supplies
semantic input and selectable policy choices only where the owning operation
permits them. It does not restate repository, Work Boundary, Candidate, Seal,
Evidence, Projection, or reducer facts.

Every role binds the exact Director Brief selected for its activity: a fresh
activity-scoped Brief for a manual request, or the original delegation-scoped
standing Brief for an explicitly delegated builder or reviewer pass. Director
Brief payload v2 distinguishes those scopes; Runtime-composed context MUST NOT
be recorded as newly Director-authored input. In addition:

- reconnaissance binds the initial preparation subject or one exact
  boundary-resolution subject and an Orientation Projection. Initial
  preparation has no Candidate input; boundary resolution receives the exact
  frozen Candidate and its Carrier/Git context as read-only input under
  [Execution](EXECUTION.md#execution-input-set), with no Candidate write or
  export capability;
- builder binds the active Work Boundary, exact current Candidate Revision,
  immutable Candidate base, repository epoch, and Execution Projection; and
- reviewer binds the active Work Boundary, exact Candidate Revision and Seal,
  current evaluation material, and reviewer Execution Projection.

Those bindings are retained as exact Control relationships. A reviewer Agent
Attempt has one `uses-seal` relationship to the current Candidate Seal in
addition to `uses-boundary` and `uses-candidate`; an opaque role-subject digest
cannot substitute for that independently resolvable join. Non-reviewer
Attempts forbid `uses-seal`.

The runtime derives those bindings from the validated store, repository
observer, Candidate observer, and Projection compiler. It reopens exact
referents and verifies their logical digests before dispatch. A cached display,
caller-supplied digest, path, provider statement, or latest-row query is not a
subject binding.

The Attempt citation registry is the sole semantic citation namespace. Each
entry binds an exact identifier, kind, subject digest, locator class, and
authority class selected from the frozen Projection or role subject. An Agent
uses only the local identifier. The Work Product Compiler resolves the full
reference and preserves its original authority.

A reachable Projection item is citable only when it is exact, available, and
mounted under the Attempt input contract. Citation does not make repository
reality into Knowledge, Evidence, Candidate state, or Work Boundary authority.

### Semantic Evidence-set digest

Builder and reviewer Attempt subjects bind the exact Evidence material supplied
by their Execution Projection. `evidenceSetDigest` is the canonical-value
digest of this exact no-digest-member subject:

```json
{
  "schema": "lifecycle.attempt-evidence-set.v3",
  "items": [
    {
      "id": "<evidence identity>",
      "kind": "check-receipt | agent-work-product",
      "authorityClass": "runtime-observed | agent-proposed",
      "digest": "sha256:...",
      "subjectDigest": "sha256:..."
    }
  ]
}
```

Items are exactly the Projection sources whose semantic class is `evidence`,
ordered by `id`. Identities are unique. `digest` is the exact logical revision
digest of the selected Control record. An Agent Work Product has
`agent-proposed` authority and `subjectDigest` binds its exact `result-of`
Attempt subject. A Check Receipt has `runtime-observed` authority and
`subjectDigest` binds its exact proof subject.

For an Agent Work Product, `subjectDigest` is the canonical-value digest of its
exact no-digest-member `agent-attempt` target containing `kind`, `id`,
`revision`, and logical `digest`. For a Check Receipt, it is the same
canonical-value digest shape over the exact Work Boundary or Candidate Seal
selected by `checks-boundary` or `checks-seal`. A null, lineage-only, display,
or caller-restated subject cannot enter the Evidence set.

The Projection compiler derives every item from a validated retained revision
and exact relationship. It MUST NOT accept raw bytes plus caller-authored kind,
authority, digest, or subject. Empty Evidence uses the same subject with an
empty `items` array, not null or a caller-selected digest.

### Reviewer proposition-set digest

A reviewer Attempt additionally binds `propositionSetDigest`, the
canonical-value digest of exactly:

```json
{
  "schema": "lifecycle.proposition-set.v3",
  "propositions": [
    {
      "id": "<proposition identity>",
      "claim": "<claim>",
      "evidenceKinds": [],
      "evidenceIds": [],
      "obligationIds": [],
      "effectIds": [],
      "riskIds": [],
      "path": null,
      "checkId": null,
      "allowNotApplicable": false,
      "notApplicableCondition": null
    }
  ]
}
```

`propositions` are the complete admitted Work Boundary propositions ordered by
`id`. Within each proposition, `evidenceKinds`, `evidenceIds`, `obligationIds`,
`effectIds`, and `riskIds` are sorted unique arrays under their owning identity
grammar. Optional `path`, `checkId`, and `notApplicableCondition` values are
copied exactly from the active boundary. The runtime MUST NOT accept an opaque
caller proposition-set digest or let the reviewer omit a proposition.

### Citation-registry digest

`citationRegistryDigest` is the canonical-value digest of one
`lifecycle.attempt-citation-registry.v3` object containing the complete
`items` array exposed to the Agent. Each item has exactly `id`, `kind`,
`digest`, `locator`, `authorityClass`, and `knowledgeIdentity`. Items are
ordered by `id`, and identities are unique across Knowledge, source,
Projection, Candidate, Evidence, and boundary entries. `knowledgeIdentity` is
the enduring record identifier for a Knowledge entry and null for every other
kind; it does not select a revision or supply citation authority.

A Knowledge entry's `id` selects the basis-qualified Projection occurrence and
its `digest` is the exact source digest. An unqualified record-identity alias
is permitted only when all occurrences select one exact source digest.
Different admitted and Candidate source bytes require qualified citations.
The compact private semantic-validation basis retains each citation's `id`,
`kind`, and `knowledgeIdentity` under its exact registry digest. A Claim's
optional Knowledge identities require supporting citations whose frozen facts
map to those enduring identities. Claim identity selection cannot replace the
citation that identifies the exact occurrence and bytes.

The Work Product Compiler copies kind, digest, locator, and authority from that
registry. It orders resolved Work Product citations by their compiler-assigned
global identity. Agent source order, an Agent-authored locator, or a similarly
named item cannot select or disambiguate a citation.

When Boundary finalization selects a Knowledge fact, its supporting retained
Knowledge citation must identify that fact's exact source bytes. The selected
fact supplies the enduring record identity and revision. A basis-qualified
citation handle is not that enduring identity, and the semantic digest cannot
replace the source digest in this comparison. The earlier compiler binding to
the frozen registry remains required.

## Capability Profile

Capability is explicit and independent of product meaning, model strength, or
provider convenience. A repository-registered Capability Profile declares the
ceiling for:

- provisional Candidate-output and temporary writes inside the Cell;
- repository toolchain and subprocess use;
- Agent product-network mode;
- Agent-visible credentials; and
- declared external effects.

The Attempt binds that profile independently from its Execution Backend
Profile. The Runtime proves every Cell grant is a subset of both profiles.
Provisional Candidate-output and temporary writes cannot change from denied to
allowed; subprocess and Agent product-network modes cannot widen; and external
effects must be members of the declared set. The Agent receives no daemon
endpoint, Execution Handle, allocation key, physical Runtime root, canonical target
mount, or Runtime credential.

Provider control-plane access and authentication are separate Runtime
infrastructure. A profile that allows the fixed runner to reach Codex or
another provider does not thereby grant the Agent general egress or expose the
provider credential in its tool environment. The Execution Backend Profile
MUST enforce that separation or report the Attempt unsupported before dispatch.

A builder SHOULD receive broad reversible capability inside a narrow admitted
Candidate-output boundary. Canonical Git state, Control, Runtime custody,
Director authority material, other Deliveries, and undeclared effects remain
outside its write grants. Reconnaissance and reviewer roles receive no
Candidate write capability.

An adapter MUST NOT weaken a profile because the provider lacks a matching
control. The Runtime reports an unsupported capability before provider effect
intent or a truthful `not-started` observation after an interrupted preparation
boundary.

## Investment

Investment is one caller-owned resource decision compiled into the Agent
Attempt. It can select:

- provider and supported model or model class;
- reasoning effort or equivalent setting;
- invocation wall time;
- optional token, event, output, tool-call, process, and storage limits;
- cost and accounting labels; and
- a bounded rationale classification.

Output limits cover the complete retained Output, including a Candidate export
when the operation produces one. Semantic-only work and Candidate-producing
work may therefore receive different bounded allocations. A larger Projection
profile is not an Output allocation. The selected Backend must realize the
retained limits; recovery cannot replace them with current defaults.

Investment is nonauthoritative. A stronger model, longer time, larger context,
or higher spend cannot widen the Work Boundary, change the Projection, grant
capability, excuse a Material Condition, waive Evidence, establish progress, or
perform a Process transition.

Every invocation receives a fresh Investment. The caller MUST NOT renew a
running invocation solely because resources have already been spent. A later
invocation can use a different provider or model while binding the same current
Candidate and Work Boundary.

### Delegated Investment

An explicit [Work Delegation](ATTEMPT_VIEW.md#work-delegation) can select finite
resources for several useful passes under one exact admission. Its resource
body is Director-supplied and nonauthoritative. The Runtime compiles the selected
provider, model and per-invocation limits with its exact installed Backend and
Image selection. A retained delegation or Investment MUST NOT follow changed
installation defaults. Selecting different resources requires a fresh explicit
delegation revision; recovery keeps its retained selection.

Each delegated Activity MUST reserve its complete conservative resource charge
atomically with opening and recovery support, before any execution allocation.
The reservation includes every possible Check Cell and the reviewer Cell for an
evaluation, including Checks that run before the reviewer Attempt is prepared.
Its immutable slots bind the exact Agent selection or the selected Check use,
Definition revision and source/semantic digests, Binding, Backend, Image and
effective limits. A Check Definition is Knowledge, not a Control reference.
The exact Check selection ID distinguishes separately selected uses.

Every allocated Agent or Check execution MUST bind its owning reservation and
one exact slot. One slot cannot fund another independently dispatched execution.
Exact recovery neither charges twice nor allocates a replacement slot. A skipped
or authorized non-executed Check retains its truthful disposition; conservative
charging does not establish that its Cell ran. The Journal retains all charges
after Activity support is disposed, across restarts, delegation replacement and
readmission. The selected profile charges full reservations without automatic
refunds; observed usage is separate.

Delegated builder and reviewer Attempts MUST retain the original exact standing
Director Brief reference selected by the delegation. A fresh Runtime Role Brief
and context supply current governing subjects and correction findings with
Runtime provenance. The Runtime MUST NOT manufacture a new Director Brief from
that composition or treat an Agent recommendation as Director input. Manual
passes continue to use fresh Director-supplied input. Delegation never removes
the requirement for a fresh immutable Investment, input compilation, exact
pre-effect checks, containment and retirement for each Attempt.

## Provider Input

Before dispatch, the Runtime compiles one bounded provider input from exact
validated sources as part of the immutable Execution Input Set. The Backend
materializes that Input Set and initializes one governed semantic workspace
inside the Cell. The read-only provider input contains only:

- the runtime-authored body-only Role Brief, including a quoted rendering of
  the exact normalized Director Brief as bounded direction for this invocation
  and the concise [operating roles](AUTHORITY.md#operating-roles) guidance;
- one exact file for every projected Tier-2 source and every allowed mounted
  Tier-3 source; and
- one compact immutable semantic authoring basis under the selected local draft
  assistance profile.

The Role Brief MUST identify the current actor as Worker, name its exact
`reconnaissance`, `builder`, or `reviewer` assignment, and identify its counterpart
as the Director who supplied the bound Director Brief. It MUST preserve the
Director's ownership of that direction while instructing the Worker to gather
the support needed to proceed, complete authorized work, and return useful
results and unresolved decisions. Its guidance MUST NOT add a human approval
step, infer a broader assignment, or disclose authority credentials.

The complete Projection, attention core, role subject, Attempt, Director Brief
identity and Control envelope, runtime identities, capabilities, and digest
coordinates remain typed runtime values. The sole bounded JSON exception is
the compact semantic authoring basis defined below; it exposes only selected
profile, digest, citation-identity, and proposition-identity facts, not full
Control values, source locators, authority, or a live Runtime connection. Only the
normalized semantic body of the exact activity Director Brief is rendered as
readable direction. The selected role template initializes the separate
governed `semantic.md` workspace and is not duplicated as a read-only input
file.

The provider input and workspace are temporary Cell output, not retained
Control and not IPC among Runtime functions. The Attempt payload binds the
logical inventory and exact Role Brief, template, Projection, subject,
Capability Profile, and Execution Input Set coordinates. Provider-visible
files MUST contain no Control front matter, authority secret, unrelated target
data, ambient provider history, Runtime recovery state, or writable canonical
path. Runtime identity and digest fields are prohibited except the exact compact
authoring-basis fields defined by the selected profile.

### Content inventory and input-material digest

The standard provider-visible package layout is:

```text
role-brief.md                          exact readable Role Brief
semantic-basis.json                    exact compact immutable authoring basis
sources/<ordinal>-<semantic-handle>.* exact projected source bytes
```

The governed writable `semantic.md` file is outside this read-only package and
is not a content-inventory entry. The content inventory contains every and only
provider-visible read-only file. Each entry has exactly `path`, `byteLength`,
and `digest`. Paths are unique normalized relative paths and are ordered
lexically by `path`. No entry can be a symlink, submodule, executable file,
special file, path alias, or directory standing in for a file. Provider input
contains no Runtime-owned runnable script; projected source content cannot
become runnable by placement or file mode.

`contentInventoryDigest` is the canonical-value digest of this exact
no-digest-member subject:

```json
{
  "schema": "lifecycle.agent-input-content-inventory.v8",
  "entries": [
    {
      "path": "<normalized relative path>",
      "byteLength": 0,
      "digest": "sha256:..."
    }
  ]
}
```

Every entry digest is SHA-256 over the exact file bytes. `byteLength` is the
exact byte count. The runtime derives both values after the file is closed and
stable; a caller cannot supply them.

`inputMaterialDigest` is the canonical-value digest of exactly:

```json
{
  "schema": "lifecycle.agent-input-material.v8",
  "layoutProfileId": "lifecycle.agent-provider-input.standard-v8",
  "projectionDigest": "sha256:...",
  "roleSubjectDigest": "sha256:...",
  "directorDirectionDigest": "sha256:...",
  "roleBriefDigest": "sha256:...",
  "semanticTemplateDigest": "sha256:...",
  "validationBasisDigest": "sha256:...",
  "contentInventoryDigest": "sha256:...",
  "rootTokenSetDigest": "sha256:..."
}
```

The Projection, role subject, normalized Director direction, Role Brief,
semantic template, compact validation basis, and inventory are complete before the Agent Attempt
revision exists. The Role Brief MUST NOT contain an Attempt or
invocation identity, a Control Record Revision reference, an operational
digest, or derived protocol mechanics. It MAY quote the normalized semantic
body of the exact activity Director Brief. That quotation cannot create or
widen a Work Boundary, capability, eligible operation, or authority fact.

### Execution Input Set and materialization

The Input Set owned by [Execution](EXECUTION.md#execution-input-set) binds
`inputMaterialDigest`, the complete provider-visible content inventory, the
exact role subject, the selected Capability Profile, and every immutable input
needed by the Attempt. For builder and reviewer roles it also binds the exact
input Candidate Revision and Candidate Revision Carrier manifest and digest.
It contains no physical materialization identity.

The Backend materializes that immutable Input Set inside one Attempt Cell.
Projection material remains read-only and outside provisional Candidate
output. A builder receives a writable output realization derived from the
input Candidate Carrier. Reconnaissance and review receive no Candidate write
capability. The governed semantic workspace is the sole provider-writable
semantic-authoring surface.

The Runtime orders construction so no digest subject contains itself:

```text
Projection + subject + Role Brief + semantic template
  -> content inventory + input-material digest
  -> Execution Input Set
  -> Agent Attempt revision
  -> Execution Specification + deterministic Cell allocation
  -> one-time dispatch
  -> Execution Output Manifest + Output Carrier after Containment
  -> optional Work Product + optional Candidate successor
  -> Execution Retirement + Execution Receipt
```

A physical volume, archive, directory, container layer, or cache is
reconstructible execution material. It cannot become an Attempt input digest,
Candidate identity, retained Control fact, or Process continuity source.

## Governed Semantic Workspace

The logical workspace contract is defined by
[Control](CONTROL.md#governed-working-values-and-authoring-workspace). Its
physical realization is one declared Output Carrier member inside the Attempt
Cell. This section defines the Agent behavior and provider boundary.

The Runtime creates one exact body-only Markdown template and grants its
`semantic.md` working file to the assigned Agent for the `provider-active`
window. The Agent can edit that same body over multiple tool calls, inspect its
work, and revise earlier claims before submission.
Intermediate file states are not Control revisions or Journal events.

The body contains only role semantics: disposition, summary, uncertainty,
claims, citations, limitations, proposed effects, and the role-specific
proposal. It MUST NOT contain:

- front matter, an envelope, or a Control header;
- Attempt, invocation, Process, role, repository, Work Boundary, Candidate,
  Projection, provider, or authority bindings supplied by the runtime;
- global identities, logical digests, byte counts, fragment digests, or
  canonical ordering claims;
- SQL, record revisions, relationship arrays, event values, or transport
  mechanics;
- runtime observations, operation eligibility, Evidence authority, or
  transaction facts; or
- a self-assessment that purports to accept its own Candidate.

Return-local anchors can relate claims, citations, decisions, conditions, and
effects inside the body. They have no standing outside that submission until
the runtime resolves them and assigns exact identities.

The installed template begins with one role title and presents these level-two
sections. A submitted draft can reorder the supported sections. It omits an
unused optional section rather than retaining a placeholder or absence marker.

<!-- markdownlint-disable MD013 -->

| Role | Sole title | Ordered sections |
| --- | --- | --- |
| reconnaissance | `Reconnaissance Work Product` | `Outcome`, `Claims`, `Citations`, `Limitations`, `Proposal` |
| builder | `Builder Work Product` | `Outcome`, `Claims`, `Citations`, `Limitations`, `Proposal` |
| reviewer | `Reviewer Work Product` | `Outcome`, `Claims`, `Citations`, `Limitations`, `Review` |

<!-- markdownlint-enable MD013 -->

`Outcome` combines disposition, uncertainty, an optional no-product reason,
and the bounded summary. Reconnaissance derives disposition from its Proposal
kind; builder and reviewer supply it explicitly. `Claims`, `Citations`, and
`Limitations` may be omitted when empty. Metadata order, harmless blank-line
layout, and supported section order are not semantic. A token-shaped metadata
value may be written bare or as one sole code span. Empty placeholder text and
the predecessor `None.` marker are invalid rather than semantic values.

The reconnaissance Work Boundary proposal can contain zero or more repeatable
`Selected work type` metadata values. Each value names one exact Work Type in
the projected Discipline Registry. `Selected Knowledge` remains the sole list
that selects Knowledge and can include exact Discipline identities. A Work
Type neither expands that list nor makes every grouped Discipline record
required, and direct Discipline selection without a Work Type is valid. The v4
parser retains the Work Type identities separately so the Work Boundary
compiler can preserve this lightweight discovery context.

Each semantic Citation contains one Attempt-local subject identifier and one
or more local Claim handles. The Agent does not supply citation kind, locator,
digest, authority, global identity, or order. Reviewer `Review` contains
proposition judgments, overall uncertainty, mandate excess, limitations, and
missing obligations; it has no aggregate completeness or acceptance field.

A complete or partial reviewer body includes exactly one
`### Mandate Applicability: <local-handle>` block with `Disposition`, one or
more `Citation` handles, and a nonempty rationale. It includes one
`### Baseline Applicability: <local-handle>` block per required original
baseline Receipt, with the same fields and an exact `Receipt` identity.
Disposition values and the every-and-only Receipt requirement are owned by
[Evidence](EVIDENCE.md#integration-applicability-review). The parser injects
anchors, normalizes block order, and binds each fragment digest as for other
review judgments. `requires-readmission` mandate applicability or
`insufficient` baseline applicability requires the corresponding proposed
Material Condition; indeterminate applicability cannot establish readiness.

For every compiled reviewer judgment, the runtime resolves its cited local
handles and derives both the exact global Citation identities and the sorted
unique inspected subject identities from the frozen citation registry. The
Agent does not repeat either runtime identity set in Markdown.

Submission closes the edit window. The selected Attempt policy can recognize
either an explicit governed submission request or the exact final workspace at
a clean natural provider completion. Timeout, cancellation, containment,
provider failure, or an unreadable workspace MUST NOT silently submit a draft.
When no valid submission exists, the runtime records
`agent-work-product-abandoned` against the exact Attempt.

Provider stdout, stderr, event text, chat messages, and terminal summaries are
operational observations. They cannot replace, complete, or repair the
workspace body. A provider adapter MUST NOT ask the Agent to repeat the body in
its terminal message.

### Local draft assistance

Provider Adapter v7 selects `lifecycle.local-draft-assistance.v1`. Its supported
Lifecycle executable MAY be present in the Execution Image and on an operator's
host. Software availability grants no Store, canonical repository, Backend,
credential, network, edit, or Director authority capability.

The profile provides three read-only local observations through `lifecycle
draft`: discovery of installed authoring forms, Knowledge source parsing and
local revision-chain inspection, and semantic draft inspection. Every file
selection MUST be explicit, bounded, and observed as stable regular bytes
without following descendant links. The command MUST NOT discover a target,
scan for credentials, open a Control Store, resolve current operation eligibility,
invoke a Backend or provider, or mutate the selected files. Knowledge inspection
MUST use the existing Knowledge parsing, canonicalization, digest, and local
revision owners under the explicitly supplied workspace's public repository
parsing policy. It MUST state that selected-file inspection is not complete
Knowledge Set validity, relationship closure, or Candidate validity.

The semantic route MUST use the Attempt-selected parser and shared semantic
compiler against `lifecycle.agent-work-product-validation-basis.v1`. Runtime
constructs this exact compact basis from the role, installed body/template,
parser and compiler identities and digests, complete frozen citation registry,
and exact reviewer proposition set. It contains only role/profile coordinates,
registry and proposition-set digests, sorted unique citation identities and kinds
with their enduring Knowledge identity or null, sorted unique proposition
identities, and its canonical self-digest. It contains no source locator,
repository path, full retained subject, credential, callback, or capability.
At most 16,384 citation facts and 4,096 proposition identities are permitted.
The canonical UTF-8 basis is bounded at 8 MiB; the semantic draft retains its
existing 1 MiB parser bound. Missing, malformed, substituted, or mismatched
basis/profile input MUST fail closed without inventing missing facts.

The provider input v8 inventory includes exactly one read-only
`semantic-basis.json`. Its bytes participate in the content inventory, and its
self-digest participates as `validationBasisDigest` in the input-material
subject. In the Execution Input Set it is one non-executable `application/json`
`operation-input` member bound to the exact role-subject digest. Before dispatch,
Runtime MUST regenerate the basis from the retained invocation inputs and
require exact equality. The selected runner exposes only this named member,
the Role Brief, and projected sources in the read-only provider input root;
other operation inputs remain private. The Role Brief advertises the installed
local command and this exact basis path.

A local semantic observation binds the exact source-byte digest, successfully
validated basis digest, and checked scope. It may report a safe diagnostic code,
phase, bounded line, typed local handle, subject identity, and up to 32 matching
citation handles already present in that basis. It MUST NOT echo authored prose,
source excerpts, private locators, provider messages, or credentials. Correction
advice explains the selected grammar or existing semantic rule; it MUST NOT
rewrite the draft, invent a supported claim, or substitute a semantic judgment.
A successful result means only `valid-for-checked-scope` against the supplied
bytes and basis. On the host, the command does not authenticate a caller-supplied
basis or establish its currentness. In the Cell, immutable Input Set custody
supplies the exact basis; the local observation still grants no authority.

The Agent may inspect, correct, and re-inspect the same draft within the funded
invocation. These observations are not Control revisions, Journal events,
Evidence, continuation state, or submission triggers. The profile exposes no
host validator endpoint, callback, token, socket, or live Store service.
After Containment, Runtime MUST independently retrieve the exact Output Carrier,
reopen its final workspace, and run the frozen parser/compiler basis again.
No local success, transcript, or Cell validity claim can replace that operation.
An invalid final draft creates no Work Product and receives only the bounded
durable submission diagnostic below. Correction after the Attempt closes still
requires a fresh reducer-eligible Attempt.

## Semantic Parsing and Work Product Compilation

The Agent authors meaning in a mutable workspace; downstream Runtime owners
need one stable, typed interpretation with exact references. Parsing closes
that language boundary. Compilation then supplies the bindings and canonical
representation that the Agent does not own. Keeping these steps distinct lets
Runtime reject malformed submission without blaming the Agent for a later
compiler invariant failure, and retain semantic equivalence without pretending
that different submitted byte layouts were identical.

After Execution Containment and a valid submission trigger, the Runtime reads
the exact workspace member from the independently validated Output Carrier. It
strictly decodes and parses the body, then applies the Attempt-selected role
profile. The Runtime never reopens a live Cell path or accepts a Cell claim as
semantic validity.

The parser MUST:

1. enforce the exact UTF-8, Markdown, byte, heading, and omission rules;
2. select role and profile only from the frozen Attempt;
3. validate permitted dispositions and role-specific combinations;
4. resolve every return-local handle and reject missing, duplicate, ambiguous,
   cross-role, or cyclic handles;
5. parse typed semantic proposals without changing their authority; and
6. emit one bounded normalized runtime value independent of semantically
   irrelevant section order, metadata order, blank-line layout, and sole-code-
   span token spelling.

### Workspace-byte and parse-result digests

Provider Adapter v7 separates four byte and value subjects that a terminal
output contract previously risked conflating:

- `workspaceRawDigest` is SHA-256 over the exact bounded `semantic.md` bytes
  observed in the exact retrieved Output Carrier before decoding;
- `semanticMarkdownDigest` is SHA-256 over the decoded normalized submission
  bytes observed before the role parser accepts or rejects them;
- `parseResultDigest` is a canonical-value digest over the exact normalized
  parser value and its fixed parse context; and
- the retained Work Product body digest is SHA-256 over the runtime-rendered
  canonical semantic Markdown and need not equal `semanticMarkdownDigest`.

The first two are byte digests, not canonical-JSON digests. An existing
zero-byte workspace is exact available input with the SHA-256 digest of zero
bytes; it is still invalid semantic Markdown. Missing, unbound, replaced,
oversized, or unstable workspace input is `unavailable` with null byte length
and digests. Malformed UTF-8 retains exact raw availability, length, and
`workspaceRawDigest`, but has null `semanticMarkdownDigest` and
`parseResultDigest`.

When UTF-8 decoding and line-ending normalization succeed,
`semanticMarkdownDigest` is present even if the role parser later rejects the
body. It establishes observed submission provenance, not retained body bytes.
`parseResultDigest` is present only for a valid complete parse. It is the
digest of this exact no-digest-member subject:

```json
{
  "schema": "lifecycle.agent-work-product-parse-result.v6",
  "attempt": {
    "id": "<attempt identity>",
    "revision": 1,
    "digest": "sha256:..."
  },
  "role": "reconnaissance | builder | reviewer",
  "templateDigest": "sha256:...",
  "workspaceRawDigest": "sha256:...",
  "semanticMarkdownDigest": "sha256:...",
  "normalized": {}
}
```

`normalized` is the complete role-profile parser value. JSON object keys are
canonicalized by the shared processing rules. Ordered narrative arrays preserve
template occurrence order. Arrays declared set-like by the role profile are
sorted by their declared local key, with exact duplicates collapsed only where
the profile allows and conflicting duplicates rejected.

An invalid parse has null `parseResultDigest` and one bounded
`failureFactsDigest` over an installed-profile failure subject. A diagnostic
contains only stable code, stage, and facts digest. It cannot contain semantic
body text, provider messages, physical paths, credentials, or a replacement
interpretation.

Provider stdout, stderr, and terminal text are separate operational byte
subjects. If retained, `rawProviderOutputDigest` is SHA-256 over those exact
bytes and equals the adjacent-file descriptor digest. It is never
`workspaceRawDigest`, never parser input, and never Work Product semantics.

The Work Product Compiler consumes only that normalized value and exact
retained Attempt inputs. It:

1. injects fixed Attempt, activity, role, subject, Projection, Work Boundary,
   Candidate, provider, and authority bindings;
2. resolves every Knowledge, source, Projection, Candidate, Evidence, and
   boundary citation against the frozen registry;
3. assigns deterministic global identities to local semantic objects;
4. normalizes paths and scalar sets, rejects conflicts, and orders set-like
   values under the selected profile;
5. renders one canonical semantic Markdown body under the selected v4 body
   profile, with exact section, metadata, item, anchor, and blank-line order;
6. derives only mechanics and exact facts owned by the compiler; and
7. submits one immutable `agent-work-product` revision and its finalization
   event through the Control Store.

The installed parser profile is exactly
`lifecycle.agent-work-product-parser.v4` and the installed compiler profile is
exactly `lifecycle.agent-work-product-compiler.v4`. The Attempt binds both
profile identities and digests plus the role-specific template identity and
digest. A similarly shaped body parsed under another profile is not an
Agent Work Product for that Attempt.

`fixedBindingSubjectDigest` is the canonical-value digest of exactly:

```json
{
  "schema": "lifecycle.agent-work-product-fixed-bindings.v6",
  "processId": "<Delivery identity>",
  "activityId": "<activity identity>",
  "attempt": {
    "id": "<attempt identity>",
    "revision": 1,
    "digest": "sha256:..."
  },
  "invocationId": "<invocation identity>",
  "role": "reconnaissance | builder | reviewer",
  "roleSubjectDigest": "sha256:...",
  "projectionDigest": "sha256:...",
  "boundary": {
    "id": "<Work Boundary identity>",
    "revision": 1,
    "digest": "sha256:..."
  },
  "candidate": {
    "id": "<Candidate identity>",
    "revision": 1,
    "digest": "sha256:..."
  },
  "evidenceSetDigest": null,
  "propositionSetDigest": null,
  "citationRegistryDigest": "sha256:...",
  "templateDigest": "sha256:...",
  "parserProfileDigest": "sha256:...",
  "compilerProfileDigest": "sha256:..."
}
```

`boundary` and `candidate` are null or exact typed record references under the
role subject. `evidenceSetDigest` is non-null for builder and reviewer.
`propositionSetDigest` is non-null only for reviewer. The other values are
always non-null. The compiler recomputes the subject from the Attempt and
retained referents; it does not accept the digest from its caller.

The retained Work Product keeps one runtime-rendered canonical readable
Markdown body and one typed semantic payload in the same database revision. It
has exactly one
`result-of` relationship to its Agent Attempt. It does not copy the Attempt,
Candidate, Receipt, or provider output.

The typed payload is the complete normalized semantic value needed by later
runtime owners. It retains the bounded summary, uncertainty, complete Claims,
resolved Citations, Limitations, exact no-product reason, and the complete
role-specific proposal or judgment. Reconnaissance retains every normalized
Work Boundary semantic object and resolved local relationship. Builder retains
its progress, evaluation, inability, Material Condition, remaining-obligation,
and proposed-effect semantics. Reviewer retains one normalized judgment for
every frozen proposition, its supporting Citations and Limitations, mandate
excess, missing obligations, and the sole typed Material Condition proposal
required by a material review finding. Each compiler-addressable semantic
object has one compiler-assigned identity and exact source-fragment digest.

A builder or reviewer Material Condition proposal uses the exact
`conditionClass` field and closed class vocabulary owned by
[ATTEMPT_VIEW.md](ATTEMPT_VIEW.md#material-conditions).
It does not use a provider-facing category, alias, catch-all class, or value
that a later compiler must reinterpret. The Agent still proposes the statement,
references, and class; the runtime separately verifies the exact retained joins
and installed freeze rule before creating a Process fact.

A downstream Boundary, Material Condition, Evidence, recovery, inspection, or
interface compiler MUST consume this validated typed payload. It MUST NOT
reparse the retained Markdown to recover a typed field, scrape an export, or
reinterpret prose opportunistically. Reopening the body to recompute its exact
body and fragment bindings is integrity validation, not semantic IPC or a
second compilation path.

The typed payload retains this runtime-derived semantic-body binding:

```json
{
  "profileId": "lifecycle.agent-work-product-body.<role>.v4",
  "digest": "sha256:...",
  "fragments": [
    {
      "id": "<compiler-assigned semantic object identity>",
      "kind": "<fragment kind>",
      "anchor": "<exact local Markdown heading anchor>",
      "digest": "sha256:..."
    }
  ]
}
```

`<role>` is exactly `reconnaissance`, `builder`, or `reviewer` and equals the
Attempt-selected body profile. The body `digest` is SHA-256 over the complete
runtime-rendered canonical semantic Markdown bytes. It does not equal the
Receipt's `semanticMarkdownDigest` unless the submitted draft already had the
exact canonical bytes.
Fragment `kind` is exactly `claim`, `citation`, `limitation`, `condition`,
`decision`, `effect`, `proposal`, or `review`.

Each fragment is the exact normalized Markdown byte slice beginning at one
anchored level-three semantic-object heading and ending immediately before the
next heading of level three or less, or end of body. The slice ends in exactly
one LF. Fragment `id` and `kind` come from the compiler's resolved semantic
object; `anchor` reproduces the exact unique local anchor; and `digest` is
SHA-256 over that exact slice. Entries are ordered by `id`; identities and
anchors are unique. Every compiler-addressable semantic object occurs exactly
once and no unparsed body range can manufacture a fragment.

The binding is deterministic protocol mechanics. The Agent does not author it,
and it is not an adjacent Markdown copy. Because it lives in the typed payload,
the Work Product logical revision digest binds the body profile, complete body
digest, and every fragment digest together with the retained Markdown.

The compiler cannot invent a missing claim, decision, limitation, uncertainty,
citation, or proposed effect. A semantically invalid submission creates no Work
Product and produces a bounded invalid-submission diagnostic. Failure of the
runtime compiler after a valid normalized value is `runtime-failure`; it MUST
NOT be attributed to the Agent or repaired by changing Agent semantics.

The Execution Receipt keeps `workspaceRawDigest`, `semanticMarkdownDigest`,
`parseResultDigest`, `fixedBindingSubjectDigest`, compiler disposition, the
retained submission diagnostic, and the optional Work Product logical and body
digests separate. Passing parser and compiler gates proves provenance from this
Attempt and workspace. It does not prove a product proposition or accept the
Candidate.

### Compiler-owned array ordering

Every set-like array has one owner and one exact order:

- content-inventory and Execution Output Manifest entries by normalized `path`;
- Evidence items, propositions, and citation-registry items by `id`;
- proposition identity arrays by scalar identity;
- normalized Work Product claims, citations, conditions, decisions, effects,
  risks, obligations, findings, and proposed references by their
  compiler-assigned global identity;
- diagnostics by code, stage, and facts digest; and
- Control relationships under the common Control relationship order.

An Agent can author narrative and local source order where the role template
declares it meaningful. It cannot declare canonical set order. The compiler
collapses only exact duplicates permitted by the owning profile, rejects a
conflicting duplicate, and never uses SQLite row order, filesystem enumeration,
object insertion order, or provider event order as canonical order.

## Provider Adapter v7

A conforming `lifecycle.provider-adapter.v7` adapter MUST:

- resolve and verify its exact Provider Descriptor and installation identity;
- consume only the exact Provider Input and Capability Profile selected by the
  Execution Specification;
- give the assigned Agent the governed semantic workspace and submission
  instructions;
- support multiple provider tool turns without treating messages as retained
  semantic state;
- request productive start only through the fixed Cell runner after the Runtime
  has durably consumed dispatch authority;
- stream provider events only as transient observation;
- translate provider-specific cancellation and observations into the fixed
  runner contract without owning Cell Containment;
- normalize provider start, completion, failure, exit, signal, timing, model,
  session, and resource facts;
- retain raw operational bytes only through allowed bounded adjacent-file
  descriptors;
- keep provider control-plane authentication outside the Agent tool environment
  and every output carrier; and
- expose no Execution Handle, allocation key, Backend coordinate, physical Runtime
  path, credential, or Reclamation mechanism.

An adapter MUST report incompatible provider or unsupported capability before
productive work. It MUST NOT silently use ambient network, shared credentials,
a broader sandbox, another model, a different workspace, or a terminal-output
fallback.

The Backend and fixed runner own allocation, dispatch, process containment,
retrieval, Retirement, and Reclamation. The adapter cannot create another Cell,
redispatch an Attempt, or treat a provider resume token as continuity.

`codex exec` is the first expected provider integration. Its provider service
channel is Runtime infrastructure, not general Agent network capability. It
has no special product, Process, Evidence, or Director authority.

The Foundation `codex-exec-standard-v7` claim is limited to the exact selected
compatibility range `>=0.153.4 <0.154.0`; the selected Image for
this revision contains Codex `0.153.4`. The Runtime MUST compare the Image tool
inventory version to the Descriptor before allocating an Attempt Cell and MUST
classify Codex 0.150.x or any other incompatible version as unsupported before
dispatch.

## Provider Events and Operational Material

Provider events can help a caller observe tool calls, messages, resource use,
Candidate motion, and provider health while the Attempt runs. They are not
Control Record Events and MUST NOT:

- establish semantic progress, completion, or failure;
- provide a missing Work Product field;
- become a Check Receipt or Evidence;
- authorize continuation or another operation;
- select Candidate identity; or
- survive as implicit provider memory.

An interface can display them with clear transient labeling. Silence, event
volume, elapsed time, token count, or diff size is not a Process state.

When bounded raw provider output, Check output, or diagnostic bytes must
survive, the runtime retains them only under the adjacent-file rules in
[Control](CONTROL.md#adjacent-referenced-files). The owning Receipt payload
references the exact content descriptor. No Control body or payload contains a
text or base64 duplicate.

## Candidate Successor Promotion

The Agent does not report Candidate identity, Carrier, digest, or successor.
Every builder Attempt binds one exact input Candidate Revision and Candidate
Revision Carrier. After Execution Containment, the Runtime retrieves and
independently validates the exact Output Carrier before deciding whether a
successor can exist.

The builder successor disposition is exactly one of:

- `promoted`: a complete Output Carrier was retrieved, independently validated,
  published as an exact Candidate Revision Carrier, and atomically finalized
  as the next Candidate Revision;
- `not-produced`: the Runtime proved that no Candidate output was produced;
- `unavailable`: productive work might have occurred, but no complete exact
  Candidate Output Carrier could be retrieved; or
- `invalid`: an exact output was retrieved but failed its complete manifest,
  repository, Atlas, Work Boundary, path, mode, limit, or Candidate validation.

Only `promoted` has a successor Candidate Revision. The other dispositions
require a null successor and create no Candidate Revision. The predecessor
remains current because no Candidate advance occurred; the Runtime does not
substitute it as a fallback, create an empty Candidate, or retain an invalid or
unavailable Candidate Revision.

Promotion is one atomic retained transition. Before finalization, the Runtime
MUST have:

1. directly proved Cell Containment;
2. retrieved the exact complete Output Carrier and Output Manifest;
3. independently validated every output byte and owning Candidate rule;
4. published a complete immutable Candidate Revision Carrier;
5. derived the exact predecessor, successor revision number, changed-subject
   facts, and Carrier binding; and
6. prepared the `candidate-revision-observed` event and the exact
   operation-support replacement.

The Candidate Revision, its exact Carrier publication, its relationships, the
event, and the operation-support replacement become visible together or not at
all. A crash cannot expose a Candidate Revision whose Carrier is absent or a
Candidate selection without its finalized revision. Publication of a Carrier
alone does not select a Candidate. A Carrier can instead be explicitly retained
for Receipt-bound repair under the rules below. A published object referenced
by neither owner remains unreferenced private material eligible for later
Reclamation.

Three owners answer different questions about the same Attempt. Provider
observation says how execution ended. Semantic parsing and compilation say
whether the Agent submitted a valid Work Product. Candidate validation and
retention say whether exact Product output can advance the Candidate. None of
these conclusions supplies the other two.

For example, a timed-out builder can leave no valid Work Product but complete
valid Product bytes. After Containment, retrieval, validation, and Carrier
publication, a promoted successor preserves those bytes for the next Attempt.
The Receipt still records timeout and absent or invalid semantics. Conversely,
a successful provider with a valid Work Product can leave invalid Product
Knowledge: the prior Candidate remains current, and the exact rejected output
may support the repair route below. An Attempt's cost or unsuccessful outcome
therefore does not decide whether its useful work survives.

An unchanged valid output MAY be `promoted`. Its successor reuses the exact
input Carrier, records `contentDisposition: unchanged`, and binds the builder
Attempt as its origin. This is a logical Candidate successor, not a mutable
workspace observation or duplicate Carrier.

Readmission is not an Agent Attempt. It can create one exact
`readmission-rebind` Candidate Revision governed by the successor Work Boundary
while reusing the current exact Carrier. The rebind and its relationships are
atomic. Readmission never observes a live workspace and never creates an
invalid or unavailable Candidate Revision.

Reconnaissance creates no Candidate Revision. A reviewer evaluates the exact
sealed input Candidate Revision and Carrier and receives no write capability.
Its Receipt references that exact input. Any detected subject mutation
invalidates the Seal coordinate and cannot be normalized into a reviewer Work
Product.

Candidate state remains reversible and noncanonical. A Work Product claim of
completion, a zero provider exit, successful output promotion, or unchanged
content is not Evidence or acceptance.

### Rejected Product output and repair

A complete, structurally verified Product tree can fail Candidate rules without
becoming unavailable bytes. Only the Candidate owner's conclusive observation
of the exact Carrier and application base can settle that result as `invalid`.
Its typed rejection binds the manifest digest, tree, application-base commit,
and exact failure-facts digest, with a bounded public explanation. Complete
invalid Knowledge may supply its first structured diagnostic and full
Validation Result digest. An incomplete tree or Knowledge observation, failed
source read, or generic exception cannot establish this rejection. Recovery
retains the exact rejection once observed rather than repeatedly attempting the
same invalid successor.

When that complete rejected Product Carrier is available, the builder Receipt
retains the exact repair selection defined by
[Control](CONTROL.md#builder-repair-output). It creates no Candidate Revision
and gives no authority to malformed or Draft Knowledge. Provider/semantic
output channels, credentials and private execution material are not Product
repair bytes. Unmappable or incomplete output still cannot supply a repair
selection.

The next builder uses that selected material read-only under
[Projection](PROJECTION.md#rejected-product-repair), with the current valid
Candidate as its writable basis. The selection can survive byte-identical
readmission through an unchanged-mandate reaffirmation so a permitted larger
Projection can make repair possible. A new ordinary Candidate successor,
integration result or changed mandate ends that repair selection. Missing exact
selected bytes remain an availability failure; the compiler cannot silently
omit them and pretend the rejected work never existed.

## Execution Receipt

Every terminal Agent Attempt produces one immutable `execution-receipt`
revision, whether or not a Work Product or Candidate successor exists. The
Runtime is producer and semantic author, with `runtime-observed` record
authority.

The Receipt has exactly one `observes-attempt` relationship, zero or one
`observes-work-product` relationship, and zero or one `observes-candidate`
relationship under the Control registry. A builder Receipt payload binds its
exact input Candidate Revision and Carrier plus its optional successor
Candidate Revision and Carrier. Its `observes-candidate` relationship names the
successor only when one was promoted; otherwise it is absent. The input remains
directly and exactly bound by the Receipt payload and the observed Attempt. A
reviewer Receipt references the exact sealed input Revision it observed. A
reconnaissance Receipt has no Candidate relationship or Candidate payload.
For boundary resolution, its observed Attempt and Input Set retain the frozen
Candidate input binding; that input does not become a Candidate observation
or successor output of reconnaissance.

Its typed payload records at least:

- exact provider effect intent and observation correspondence;
- Provider Descriptor, installed adapter-v7 identity, model, Investment,
  Capability Profile, and expected and directly observed executable identities;
- Execution Backend Profile, Execution Image, Execution Specification, and
  Execution Input Set identities and digests;
- `roleBriefDigest`, `contentInventoryDigest`, and `inputMaterialDigest` when
  the corresponding immutable input was available;
- whether productive execution started;
- provider completion class, first trigger, terminal stage, exit or signal,
  and timing;
- normalized Cell Containment, cancellation, force, and Runtime-parent-loss
  facts;
- governed workspace observation and submission disposition;
- `workspaceRawDigest`, `semanticMarkdownDigest`, `parseResultDigest`,
  `fixedBindingSubjectDigest`, parser and Work Product Compiler disposition,
  and the optional retained submission diagnostic;
- exact Work Product disposition and reference when one exists;
- for builder, exact input Candidate Revision and Carrier,
  `candidateSuccessorDisposition`, optional successor Candidate Revision and
  Carrier, `contentDisposition` when promoted, and Output Manifest digest when
  an exact Candidate output was retrieved;
- bounded adjacent-file descriptors;
- synchronous Execution Retirement and any bounded non-secret residual class;
  and
- Runtime implementation and rule coordinates.

The provider effect observation is exactly `completed`, `failed`, or
`not-started`. When dispatch authority was consumed but direct same-Cell facts
prove that either Backend dispatch was never observed or Backend dispatch was
accepted but the provider process remained `not-started`, no output was
produced, and complete no-effect Containment holds, the Runtime compiles the
`not-started` observation without inventing a runner result. A branch in which
the provider process started uses the exact fixed-runner Provider terminal
observation. When the direct contained observation reports complete output,
the Runtime independently validates and durably retains that exact
runner-owned observation before strict whole-Carrier finalization. A
deterministic refusal of unrelated authoring or Candidate bytes cannot erase
the retained observation: the Receipt preserves its exact provider completion
facts even when whole-Carrier output is invalid and therefore unavailable for
semantic or Candidate use. The retained observation does not validate those
other bytes or authorize a Work Product or Candidate successor.

Authoritative total Carrier loss retains no invented Provider observation, but
it cannot block Cell Retirement or Reclamation handoff. A missing, malformed,
or substituted mandatory terminal member is retained as an exact invalid
terminal outcome, likewise permits physical Retirement, and prevents Receipt
compilation until exact provider facts are available. The Receipt can carry a
more precise normalized terminal reason,
including natural completion, invalid submission, timeout, cancellation,
forced termination, provider failure, capability refusal, security stop, or
runtime failure. Its terminal stage is exactly `preflight`, `compatibility`,
`dispatch`, `running`, `result-validation`, or `evaluated`; the no-effect
branch is Runtime-derived from the exact direct Execution Observation, and
every other branch is copied from the closed provider-adapter-v7 observation
rather than inferred from provider text. Exceptions and provider-specific
messages are not terminal classifiers.
An observed executable identity that is null or differs from the exact identity
retained by the Attempt yields `security-stop` and cannot submit a Work Product,
even if the underlying provider process otherwise returned naturally.

A Receipt that reports productive execution MUST report the immutable Role
Brief, content inventory, input material, Input Set, Specification, Image, and
Profile as available and exactly bound. A truthful `not-started` branch can
report an Output Manifest as null when no output was produced. Availability,
byte length, and digest are a joined triple: unavailable material has null
length and digest; available material has its exact nonnegative length and
digest. No empty, placeholder, or caller-supplied digest stands for unavailable
bytes.

Containment and Retirement are separate observations from provider outcome.
Failure of either cannot rewrite an already observed provider completion
class, but uncontained or non-retired capability prevents the Activity from
completing. Asynchronous Reclamation state is not Receipt content and cannot
reopen a completed Attempt.

The Receipt references Work Product semantics and Candidate facts; it does not
reproduce them. It never embeds provider messages, event streams, workspace
bytes, Candidate bytes, credentials, physical paths, Execution Handles, allocation
keys, Backend coordinates, Reclamation state, or recovery packages.

When final semantic parsing or compilation fails, the Receipt retains exactly
one `submissionDiagnostic` with `code`, `stage`, and `factsDigest`. The stage is
`syntax`, `template`, `semantic`, or `compiler`; the digest equals the
workspace failure-facts digest. This durable diagnostic identifies the failure
class without retaining draft excerpts, line text, local handles, physical
locations, provider messages, or suggested replacement semantics. A successful
submission and an unavailable workspace have no retained submission diagnostic.
Local advisory correction responses and authoring transcripts MUST NOT be
copied into the Receipt or treated as durable submission diagnostics.

## Event Order and Attempt Lifecycle

The Control Store Journal retains bounded lifecycle milestones, not a
transcript:

```text
activity-started
  -> (agent-attempt-prepared + provider-effect-intended) atomic
  -> dispatch consumed once
  -> provider active inside one private Cell: tool turns + workspace edits
  -> provider-effect-observed
  -> Execution Containment + Output Carrier retrieval and validation
  -> agent-work-product-submitted | agent-work-product-abandoned
  -> candidate-revision-observed        builder only when successor promoted
  -> Execution Retirement
  -> execution-receipt-recorded
  -> activity-completed
```

Before any Attempt or provider intent, refusal follows
`activity-started -> agent-pre-intent-refused -> activity-completed(abandoned)`.

The exact event vocabulary, digest chain, atomic revision finalization, and
idempotence rules are owned by [Control](CONTROL.md#event-source). These are
operational milestones inside Delivery, not additional Delivery states. The
Process can remain ready for Candidate work across several Attempts.

Dispatch consumption, Containment, Retirement, and Reclamation are physical
execution facts, not new Journal event types. The existing
`provider-effect-intended` milestone is the durable one-time dispatch boundary.
The optional `candidate-revision-observed` event is emitted only as part of
atomic successor promotion; no-successor dispositions live in the Receipt.
The Journal therefore remains the same closed set of twenty-five events.

The Attempt View is computed after the exact Receipt and any optional successor
are durable. It is not appended as another record or event.

## Exact Recovery

The Agent operation definition owns the exact immutable Attempt plan, Cell
execution and direct observation, optional Candidate successor promotion, and
compilation of the Agent Work Product, Execution Receipt, and operation-specific
finalization. The common
[Activity kernel](CONTROL.md#common-activity-kernel) owns durable activity
opening, checkpoint compare-and-swap, atomic Journal coordination,
reducer-checked recovery, completion, and support disposal. The reducer is the
sole legal Process state machine; Backend, Cell, provider terminal, Retirement,
and Reclamation phases are physical observations, not another persisted
workflow or recovery DSL.

Before Cell allocation, the Runtime durably retains one unpredictable private
allocation key bound to the exact Execution Specification. A lost allocation
response is recovered only by repeating
`allocate(specification, allocationKey)`. The Backend must return the same
exact Cell or prove authoritative absence before creating that one Cell.
Duplicate or ambiguous allocation is an integrity refusal.

Provider dispatch is the external-effect boundary. The Runtime atomically
records `provider-effect-intended` and permanently consumes dispatch authority
before it can call `dispatch`. Once consumed, absence of an observation is not
evidence that the provider did not start. Recovery MUST NOT redispatch the same
Attempt, allocate a replacement Cell, or use a provider resume command.

At the same atomic Store boundary as the first activity and Decision facts, the
Runtime retains one bounded Runtime-writable operation checkpoint binding the
exact target, Delivery, activity, Attempt inputs, Execution Specification,
allocation key, known Handle binding, prospective start event, and selected
times. At each external-effect boundary, it retains only the closed operational
facts needed to reconcile that exact effect, Containment, output retrieval,
successor promotion, and Retirement. Checkpoints are support resources, not
Control, authority, semantics, or an alternate event source.

That checkpoint is the activity-bound
`lifecycle.control-record-operation-support.v1` row in the same Delivery
Control Record Store. Its compare-and-swap generation and payload digest make
each recovery update exact while keeping it outside the Journal and logical
inventory. The Director may inspect it through a bounded Runtime operation while
it is retained; agents, provider adapters, and interfaces cannot mutate it. The
Runtime removes the row only when the Activity has no remaining recovery
purpose. Support creation and activity opening, Attempt plus intent and
checkpoint replacement, observation and checkpoint replacement, refusal and
checkpoint replacement, and checkpoint disposal and activity completion each
commit atomically with their exact Journal facts.
An exact retry must reproduce both sides; a one-sided retained postcondition is
an integrity refusal. Disposal leaves a payload-free retry tombstone until the
seal transaction removes it. Store sealing requires no live checkpoint and
produces a sealed Store with no operation-support rows.

Recovery follows the event chain and resumes only its exact missing boundary:

- after Activity opening, it can revalidate, deterministically reopen or create
  the one pre-dispatch Cell, and atomically compile the exact selected Attempt
  plus provider intent without resampling identities, inputs, or time, or
  retire the unused Cell and abandon cleanly on refusal;
- after effect intent, it observes or cancels the exact Cell, proves
  Containment, and never dispatches again;
- after Containment, when direct observation reports complete Agent output, it
  first retains the exact valid or invalid fixed-runner Provider terminal
  outcome, then independently validates the complete Output Carrier and
  workspace disposition without resampling that outcome;
- for a builder, it atomically promotes a successor only when complete exact
  output and Carrier publication qualify, otherwise it retains one exact
  no-successor disposition without creating a Candidate Revision;
- it compiles or exactly reproduces the Work Product and Receipt when their
  complete inputs are available; and
- it proves Runtime-owned Retirement before Activity completion and appends
  only the next idempotent event or revision under the retained identities and
  logical digests.

Recovery MUST NOT infer `not-started` from missing support, reconstruct Agent
semantics from provider text or events, manufacture a submission marker, choose
another Candidate, create a revision for invalid or unavailable output,
resample a terminal fact, or use direct SQL. When one exact continuation cannot
be proved, the Activity remains recovery-required and only `delivery.recover`
is eligible.

Execution Reclamation can continue after Activity completion from its separate
private obligation ledger. It cannot be driven by `delivery.recover`, shown as
a public operation, or used to alter the Receipt or successor disposition.

## Continuity and Fresh Invocation

Normal continuation creates a new Agent Attempt. It does not reopen the prior
workspace or require provider conversation, a resume token, hidden memory, or
the prior model.

`delivery.continue` can fund a new builder Attempt when:

- the active Work Boundary remains exact and coherent;
- the current Candidate Revision and complete immutable Revision Carrier are
  available, valid, and bound to its immutable application base;
- the admitted historical repository and Knowledge subjects remain loadable and
  exact, together with the current Candidate's retained application parent;
- no Process-frozen Material Condition blocks productive work;
- required capability is available; and
- the reducer exposes `delivery.continue` for the current event head.

The new Attempt receives the exact current Candidate Revision and Carrier,
mandatory Projection, remaining obligations, and applicable failed Evidence as
one immutable Input Set. The Backend creates a fresh Cell; it does not reopen a
prior workspace or provider session. Provider interruption, context exhaustion,
and failed commands do not by themselves change the mandate. A failed
evaluation can return the same Candidate to correction. A material mandate
problem follows revise or reaffirm and distinct readmission. Canonical movement
alone does not prevent the Attempt. Explicit integration and required context-
change readmission own a new application parent or governing context.

A provider-native resume token, conversation, workspace, or cached session
cannot supply cross-Attempt continuity. Candidate Revision Carriers and Control
events, not provider memory, are the continuity source.

## Failure Locality

A failure invalidates only the layer whose contract failed:

<!-- markdownlint-disable MD013 -->

| Failure | Preserved by default | Invalidated or blocked |
| --- | --- | --- |
| Timeout or cancellation | input Candidate Revision and Carrier, boundary, prior valid Evidence, any independently promotable output | current provider effect and unsubmitted workspace semantics |
| Invalid semantic submission | input Candidate and any independently valid Candidate output | Agent Work Product for that Attempt |
| Work Product Compiler invariant failure | input Candidate, any promoted successor, and valid normalized semantics | compiler operation and Work Product |
| Provider or adapter failure | input Candidate and admitted mandate, any independently promotable output | current provider effect |
| Projection mismatch before dispatch | Delivery and current Candidate Revision Carrier | prepared Attempt dispatch |
| Capability or Backend Profile unavailable | Candidate and mandate | invocation under that profile |
| Output unavailable or invalid | input Candidate, any independently retained Provider terminal facts, and exact failure facts | Work Product, Candidate successor, and semantics that require the refused bytes |
| Candidate Carrier publication failure | input Candidate and validated provisional output | successor finalization until exact recovery |
| Containment or Retirement incomplete | logical input and directly observed provider facts | Activity completion until exact recovery |
| Review rejection | Candidate and unrelated fresh Receipts | acceptance readiness for rejected propositions |
| Candidate change after sealing | Candidate work | prior Seal and Candidate-bound Evidence |

<!-- markdownlint-enable MD013 -->

The Runtime reconstructs physical materialization only from an exact immutable
Candidate Revision Carrier. It MUST NOT reconstruct missing output from
provider prose, invent a Candidate successor because provider execution,
semantic parsing, Work Product compilation, or an unrelated Receipt failed, or
keep a provisional Cell filesystem as the sole Candidate truth.

## Containment, Retirement, Reclamation, and Parent Loss

The Runtime owns the Attempt Cell, provider input, authoring workspace, event
buffers, processes, temporary credentials, caches, checkpoints, Output Carrier,
and adapter state. It arms Containment before productive capability exists and
provides the exact parent-loss behavior bound by the Attempt, Provider
Descriptor, and Execution Backend Profile.

Containment MUST prove the complete Cell unable to execute or mutate output.
Retirement MUST revoke dispatch, provider access, credentials, and active
namespace membership before the Receipt and Activity complete. Parent loss,
unknown support, changed Cell identity, or unproved Containment remains an exact
recovery obligation; it does not permit redispatch or replacement allocation.

Physical Reclamation occurs asynchronously after Retirement under
[Execution](EXECUTION.md#containment-retirement-and-reclamation). It can remove
the already inert Cell, physical materializations, and unselected provisional
output without blocking or reopening Activity completion. It MUST NOT remove
the immutable Carrier selected by a current Candidate Revision or adjacent
files explicitly retained by the Receipt. Those adjacent files remain governed
Delivery Control and archive with the complete Store.

## Non-Goals

An Agent Attempt does not:

- require one provider invocation to finish the Candidate;
- make provider messages or terminal text durable semantics;
- make an Agent author protocol mechanics;
- treat activity, elapsed time, changed paths, or a completion claim as proof;
- turn provider events into a development log;
- merge Work Product, Receipt, Candidate Revision, Evidence, or Director
  authority;
- use provider history as Process continuity;
- expose a Cell workflow, Execution Handle, backend retry, public Reclamation state,
  CLI command, TUI screen, or operator-selected execution transition;
- create invalid or unavailable Candidate Revisions for lost provisional work;
- grant canonical motion or irreversible external effects; or
- weaken Evidence because a cheaper or stronger model performed the work.
