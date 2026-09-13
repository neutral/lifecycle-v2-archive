# Lifecycle Authority

> Status: Draft

## Purpose

This document defines the authority classes that coexist in Lifecycle, the
subjects each class can move, the authentication required for authority-bearing
transitions, and the non-substitution rules that prevent one kind of Evidence,
capability, or agent output from impersonating another.

Authority is the right to establish or move one class of truth. Lifecycle does
not use one global authority order. Each class has a distinct owner, subject,
and transition mechanism. Authority is non-transitive: possessing one class
does not imply another.

## Division of Responsibility

Lifecycle work is organized as a Director–Worker pair. The Director owns
direction and authority-bearing choices for the work. The Worker gathers
supporting information and performs the delegated intellectual and reversible
implementation work. Either role can be held by a human or an agent.
The runtime owns the integrity of the relationship between decisions, actions,
observations, and durable state.

The [architectural laws](../SPEC.md#architectural-laws) preserve authority,
exact subjects, bounded delegation, and faithful durable facts across that
division. Each class below identifies its own permitted transitions. A typed
record can establish that an Agent submitted an exact claim or a reviewer made
an exact judgment; its construction cannot establish the claimed proposition
as an independent observation.

## Operating Roles

The pair is relative to one objective and assignment. **Director** identifies
who supplies direction, decides the choices reserved at that work level, and
assesses the returned result. **Worker** identifies who gathers and checks the
information needed to proceed, performs the authorized work, and returns useful
results, supporting evidence, and unresolved decisions to that Director.
Workers are usually agents and can also be humans. For example, a human Worker
can gather requirements or prepare a design document for an agent Director.
The Director remains responsible for selecting and supplying the complete
Director Brief; supporting material does not become direction by itself.

The same actor can be a Worker at one level and a Director at another. Each
assignment MUST preserve its governing mandate, capability, resource limits,
and independent-review obligations. Acting as a Director for subordinate work
MUST NOT expand the authority delegated to that actor at the containing level.
An actor's human or agent identity does not establish its role or authority.
The configured principal and exact authenticated subject establish authority
for the designated Delivery transition.

A Director or Worker SHOULD proceed with useful work already authorized within
its assignment. An implementation MUST NOT require additional human approval
solely because the Director is an agent. A choice outside the assignment or an
unresolved prerequisite returns to the responsible Director. A Director can
ask its Worker to gather missing information or prepare supporting material.
A decision beyond the Director's assigned authority returns to the responsible
Director of the containing assignment, when one exists. Otherwise that decision
remains unavailable until the required authority is explicitly established.
Required authentication remains exact;
silence, a role label, model confidence, or an earlier general approval cannot
substitute for it.

Every dispatched Agent Attempt runs as a Worker. Its Role Brief MUST identify
that role, its exact reconnaissance, builder, or reviewer assignment, and its
counterpart as the Director who supplied the bound Director Brief. It MUST
succinctly direct the Worker to gather and check the supporting material needed
for its assignment, complete authorized work, and return the result and any
unresolved decision through the supplied semantic template. This guidance
MUST NOT grant a new source, capability, authority credential, or operation.
[Projection](PROJECTION.md#role-brief-and-semantic-template-compilation) owns
its exact compilation and [Agent Attempts](ATTEMPTS.md#provider-input) owns its
dispatch. Human participation in the pair does not replace a selected provider
execution or independent Evidence mechanism.

## Foundation rc.17 Authority Cut

This document selects the authority semantics of qualification revision
`lifecycle.foundation.1.0.0-rc.17`, repository contract
`lifecycle.repository.v22`, runtime and interface protocols v17, Provider
Adapter v7, and Control Record Store v2. The product package remains `1.0.0`.

Foundation rc.17 authenticates Director judgment through one `director-decision`
Control revision with exactly one of four variants: `admit`, `readmit`,
`accept`, or `no-ship`. The coordinated predecessor carrier refusal is owned by
[Control](CONTROL.md#foundation-rc17-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).
A predecessor or mixed subject is refused; it is not migrated, adopted, or
reconstructed.

## Authority Classes

### Director authority

Director authority selects product meaning and authenticates the Process
transitions that the configured repository reserves for the Director.

Director authority can:

- authenticate an `admit` Decision selecting one exact proposal-ready Work
  Boundary revision;
- authenticate a `readmit` Decision selecting one exact successor Work
  Boundary revision and resolving its Material Condition;
- authenticate an `accept` Decision selecting the exact current Boundary,
  Candidate Revision, Candidate Seal, and acceptance-ready Evidence Packet;
- authenticate a `no-ship` Decision selecting the exact subjects that exist
  and the legal Candidate disposition when a Candidate exists; and
- make another product judgment explicitly assigned to the Director by a
  Process specification.

Director authority does not:

- write Candidate files;
- prove a Check;
- make an Agent Work Product or provider observation true;
- grant filesystem or network capability outside a runtime profile;
- bypass validation; or
- make a failed transaction successful.

### Specification publication authority

Specification publication authority authenticates the lifecycle status of one
exact Lifecycle publication manifest. It is independent of Director authority
inside a target repository. Its stable principal and verification key are
selected by a release consumer through an external trusted release-authority
configuration; a key merely repeated inside a publication package cannot make
itself trusted.

Specification publication authority can issue a `draft`, `candidate`,
`released`, `superseded`, or `withdrawn` statement for one exact manifest and
release-note digest. It cannot change the inventoried bytes, make a Draft
document Accepted, satisfy an independent-implementation gate, establish an
implementation conformance claim, or grant target-repository Director
authority. A later status uses a new statement and preserves the prior
statement digest.

### Product Knowledge authority

Product Knowledge authority belongs to the current governed record that owns a
specific Behavior, Assurance, Blueprint, Description, or Check Definition.

A current record can govern future work only when its identity, revision,
status, source bytes, and relationships validate under the active specification
revision. A Work Boundary selects that authority for one Delivery. It does not
become the long-term owner of the selected meaning.

No single Knowledge kind globally overrides every other kind. Their scopes are
different:

- Behavior owns functional outcome;
- Assurance owns non-functional obligation and failure limit;
- Blueprint owns structural decision and constraint;
- Description owns implementation-local responsibility and rationale; and
- Check Definition owns a falsifiable validation proposition.

Discipline is governed Knowledge but not Product Knowledge. Its Pack publisher
owns the guidance text and gains no target Product Knowledge, Director, Process,
Evidence, or runtime authority. Adoption and Boundary selection make exact
guidance available to an Agent; they do not turn a recommendation into a
requirement.

A conflict between applicable current owners is an unresolved authority defect.
A compiler or agent MUST NOT resolve it by convenience, path order, prompt
position, model confidence, or implementation state.

### Atlas authority

Atlas owns its Maps, Areas, Point identities and records, Resources, Content,
typed References, relations, authoring Checks, publication profiles,
processing, and validation semantics under the exact external selection in
[Atlas Integration](ATLAS.md).

Lifecycle can bind raw Atlas State and exact Resource inputs, establish one
complete valid Atlas Resolution, and project selected normalized Atlas context.
An Atlas record or edge does not own the Resource it references, grant read or
write authority, establish product currentness, or resolve a conflict between
governed Knowledge records. Delivery has no Atlas authorship authority and MUST
NOT mutate the authoritative Atlas root under any Work Boundary or Candidate.

### Process authority

A Process owns the meaning and legal consequences of its Control revisions and
events. Delivery owns Work Boundary proposal and active standing, Candidate
continuity, Evidence binding, correction, readmission, acceptance readiness,
terminal disposition, and information closure.

Process authority does not own durable product meaning. A closed Work Boundary,
Evidence Packet, or Closure cannot replace a Behavior, Assurance, Blueprint,
Description, Check Definition, Atlas source, or implementation artifact.

The append-only event chain in one per-Delivery Control Record Store is the
sole retained Process event source. Each event has a positive contiguous
sequence, exact predecessor digest, and optional exact Control Record Revision
subject. Current standing, activities, Candidate condition, recovery,
subjects, and eligible operations exist only in the ephemeral Delivery State
View produced by reducing the complete validated chain with those exact
revisions. A database latest-revision view, cache, interface status, Attempt
View, prior response, or remembered operation cannot substitute for that fold.

A runtime-frozen Material Condition is Process truth that one exact fact blocks
honest productive continuation. A record revision, Journal event, derived view,
store seal, or archive does not by itself perform an authority-bearing effect,
change the admitted mandate, or supply Director judgment. Operation eligibility
is not authorization, and preserving a proposed fact does not make it Product
Knowledge.

### Runtime authority

A conforming runtime owns deterministic validation, exact subject binding,
capability enforcement, Candidate Carrier publication and confinement, Backend
selection, Check execution, Execution Containment and Retirement, transaction
recovery, canonical motion, and Reclamation handoff.

The runtime is also the sole physical producer of Delivery Control. It owns the
SQLite schema, typed payload construction, relationships, identities, logical
digests, event appends, reducer, adjacent-file custody, store seal, and archive.
It operates internally on typed values and events. Semantic Markdown retained
in a revision is durable readable meaning, not runtime IPC or SQL input.

Runtime authority is procedural. The runtime can reject an invalid or stale
subject and can apply an already authorized exact transition. It cannot invent
product meaning, approve a tradeoff, waive an obligation, or treat a provider
claim as Evidence.

Procedural responsibility does not grant every Runtime component the same
physical capability. [Security](SECURITY.md#consequential-capability-ownership)
assigns execution, Director authority custody, and canonical transition to
narrow existing owners. An operation request is not authority and does not
transfer Engine access, signing capability, or canonical Git write access.
Control and Carrier ownership remain distinct from those capabilities.

### Capability authority

A Capability Profile defines what one Agent Attempt can read, write, execute,
contact, or affect. Capability is an execution permission, not product or
Process authority.

Lifecycle Backend authority is separate. It permits the trusted Runtime to
allocate, dispatch, observe, cancel, retrieve, and reclaim Cells, but it is
never granted to an Agent, Check command, Capability Profile, repository file,
or provider response.

A product effect describes behavior the accepted product may later produce. It
MUST NOT expand the builder's capability. A tool's technical ability likewise
MUST NOT be treated as permission to exercise an undeclared external effect.

### Evidence authority

Evidence preserves the provenance of observations and independent judgments
about an exact subject. A Check Receipt records the observed outcome under its
bound mechanism, environment, and time; a sealed difference and artifact digest
identify observed product facts. A reviewer decision instead remains
Agent-proposed judgment, with exact citations and uncertainty. Retaining or
verifying that judgment does not turn it into an authenticated observation.

The Evidence owner interprets what those different contributions support.
Authenticating their provenance and assessing their sufficiency answer
different questions; neither supplies the Director's authorization.

Evidence can support an acceptance proposition. It cannot create the
proposition, change the active Work Boundary, grant Director authority, or apply
a canonical transaction.

The [Evidence verifier](EVIDENCE.md#evidence-verifier) interprets that support
under the selected normative rules independently of Delivery assembly. Its
verified interpretation is distinct from reducer-derived currentness, Director
authentication, and transaction validation. A retained observation can support
historical interpretation without proving fresh physical reality.

### Agent and provider authority

Workers inside Agent Attempts and their provider processes have proposal
authority only. They can propose product changes, Work Boundaries, Material
Conditions, review decisions, and summaries through the governed semantic
Markdown workspace assigned to their exact Attempt. An agent acting separately
as Director exercises only its configured, scoped authority through the same
authenticated transitions as a human Director. Its Worker execution cannot
authenticate itself or acquire Director credentials. A manually requested Agent
activity binds one fresh Director Brief.
A delegated activity instead binds the exact original Director-supplied standing
Brief selected by its Work Delegation. Submission freezes one semantic revision;
intermediate edits and provider terminal text do not.

Provider events, tool calls, elapsed time, model confidence, session memory,
Agent prose, and syntactic validity are observations or proposals. They do not
establish Product, Process, Evidence, Director, capability, or runtime truth.

### Resource delegation

A **Work Delegation** retains an explicit Director-supplied allowance for bounded
reversible labor under one exact admitted Work Boundary. It is resource intent,
not an authenticated mandate or terminal decision. Creating, replacing or
stopping that allowance does not require the authority-secret handoff used for
admission and acceptance. The Runtime MUST retain caller provenance and MUST
NOT infer an allowance from silence, a recommendation, earlier spending, or
interface state.

The delegation can fund only its selected existing `continue`, `integrate` and
`evaluate` operations when Runtime-derived eligibility permits them. It cannot
widen the mandate, change its Checks or Knowledge, excuse a Material Condition,
authenticate readmission, accept Product, or choose no-ship. A stronger model or
remaining allowance does not change those restrictions. The Director separately
admits the complete mandate and accepts the exact supported result.
[Investment Allocation](ATTEMPT_VIEW.md#work-delegation) owns the finite allowance,
standing input, accounting and stop contract.

### Interface authority

An interface presents validated state and collects caller input. It can invoke a
runtime operation only through the exact authority and subject contract of that
operation.

An interface MUST NOT infer authorization from button availability,
conversation history, a generic request to continue, silence, or its own
recommendation. Presentation state is not Process state.

An interface may request the exact read-only Authorization Review
defined below and may request one invocation-private challenge for that same
review. Neither action authenticates a Director Decision or reserves the
reviewed transition. An interface never receives the Director secret, signs a
subject, or converts possession of a challenge into authority.

## Authority Matrix

<!-- markdownlint-disable MD013 -->

| Subject | Current owner | Required transition | Explicit non-substitutes |
| --- | --- | --- | --- |
| Behavior meaning | Current Behavior record | Governed Knowledge change | Code, test, prompt, Work Boundary, agent summary |
| Assurance obligation | Current Assurance record | Governed Knowledge change | Passing test, Blueprint, Description, runtime policy |
| Structural decision | Current Blueprint record | Governed Knowledge change | Current code shape, agent plan, dependency graph alone |
| Implementation-local meaning | Current Description record | Governed Knowledge change paired with covered implementation | Comments alone, code alone, generated summary |
| Check proposition | Current Check Definition | Governed Knowledge change | Registered command, receipt, test name |
| Proposed Delivery mandate | Exact Work Boundary revision | Runtime compilation plus complete modality-valid baseline Receipts | Director Brief alone, reconnaissance proposal, latest row, Check command output |
| Active Delivery mandate | Exact Work Boundary revision selected by an applied `admit` or `readmit` Decision | Director authentication plus truthful applied transaction observation | Proposed standing, Decision alone, Candidate, Agent Work Product |
| Current Delivery state and eligibility | Validated Control Record Event chain plus exact referenced revisions | Deterministic runtime reduction | SQLite latest-revision view, cache, interface status, Attempt View, operation name, agent recommendation |
| Frozen continuation condition | Material Condition | Runtime classification and exact source binding | Builder assertion alone, inconvenience, inferred Director preference |
| Candidate bytes | Candidate Revision Carrier outside the Control Store | Runtime validation and durable content-addressed Carrier publication before Revision selection | Cell materialization, Candidate Revision record alone, provider session, patch prose, event stream |
| Candidate currentness | Exact Candidate Revision selected by the event fold | Runtime observation after admission, readmission, or valid published builder successor | Agent claim, latest revision row, invalid or unavailable output, Receipt summary, Seal |
| Check outcome | Check Receipt | Runtime-authenticated Cell execution, output validation, Containment, and Retirement | Builder claim, cached unrelated run, exit code without subject binding |
| Acceptance readiness | Evidence Packet under the Evidence verifier's rules | Independent verification of exact Evidence support plus reducer-established currentness | Successful Delivery assembly, Packet readiness field alone, builder self-review, test pass, Director intent alone |
| Canonical product result | Repository Product State | Applied `accept` Decision transaction over the exact sealed Candidate tree and integration parent | Evidence Packet, Decision alone, Control revision, unintegrated commit, agent push |
| No-ship disposition | Closure at the final Journal head | Applied `no-ship` Decision transaction, Candidate abandonment, and exact Containment and Retirement | Timeout, abandonment prose, Carrier deletion, Decision alone |
| Terminal Control inventory | Control Record Store Seal and archive | Runtime verification, logical sealing, and exact off-HEAD archive | SQLite byte digest alone, export, HEAD commit, Closure without finalization |
| Tool capability | Capability Profile | Runtime construction of Agent Attempt | Product effect, repository file, provider request |
| Execution mechanics | Lifecycle Runtime under an exact Execution Backend Profile | One immutable Specification, one-time dispatch, Containment, Runtime Retirement, and bounded Reclamation | Capability Profile, Agent or Check code, Backend observation alone, public CLI input |
| Specification publication status | Authenticated Publication Statement | Trusted publication-authority signature over one exact publication subject | Manifest `status`, Git tag, package label, repository Director key, conformance claim |

<!-- markdownlint-enable MD013 -->

## Non-substitution Rules

A conforming implementation MUST enforce these rules:

1. Code MUST NOT be treated as the owner of Behavior, Assurance, or Blueprint.
2. A test or Check Receipt MUST NOT be treated as the owner of its proposition.
3. An Atlas record or Reference MUST NOT be treated as read or write authority
   over its Resource, and Delivery MUST NOT write any authoritative Atlas path.
4. A Work Boundary MUST NOT silently become durable Product Knowledge.
5. A Director Brief, prompt, or semantic Markdown body MUST NOT be treated as
   Product or Process authority.
6. A provider event, terminal message, workspace edit, or Agent Work Product
   MUST NOT drive a truth transition directly.
7. A Candidate or Candidate Revision MUST NOT become canonical without the
   exact acceptance transaction.
8. Evidence MUST NOT perform acceptance or grant Director authority.
9. Director authority MUST NOT bypass exact-subject validation or transaction
   safety.
10. Capability MUST NOT imply permission to change the mandate or perform an
    undeclared external effect.
11. A more capable model, longer timeout, or additional invocation MUST NOT
    widen any authority class.
12. An interface MUST NOT turn eligibility presentation into authorization.
13. A Control revision, event, store, seal, archive, or Markdown export MUST NOT
    be treated as Director authority merely because it is immutable,
    content-addressed, runtime-produced, or retained.
14. Machine-private provider bytes, event streams, paths, credentials, locks,
    caches, transaction or Execution Handles, allocation keys, Candidate
    materialization paths, or Reclamation coordinates MUST NOT become
    authority-bearing semantic fields or canonical Product State.
15. Store access, SQL access, an editor capability, or runtime execution
    capability MUST NOT imply semantic authorship or transition authority.

## Authority-bearing Subjects

Every authority-bearing transition MUST bind one exact subject. The runtime
constructs that subject as strict canonical JSON under the selected authority-
subject profile. It includes every fact whose change would make the
authorization stale and binds Delivery Control through exact Control Record
References: kind, record identity, positive revision, and logical revision
digest in the one Delivery Store. It never identifies Control through an
exported document, path, SQLite row identifier, latest revision, or database
byte digest.

The subject is a typed runtime value. It is distinct from the Director-editable
semantic Markdown, Director Decision revision, Journal event, interface
presentation, transaction effect plan, and signature envelope. The runtime
binds the normalized Decision semantics into the subject before
authentication; after successful authentication it finalizes one immutable
`director-decision` revision containing those exact semantics, subject, and
bounded authentication facts. The `director-decision-authenticated` event then
references that revision without copying its authority facts.

A Director-authenticated Delivery subject includes, at minimum:

- target, Delivery, Control Record Store, Process, operation, Decision identity,
  Decision variant, and Decision-semantic digest;
- exact Journal-head sequence and logical digest plus the current reducer facts
  on which eligibility depends;
- exact repository, Product State, Knowledge Set, Check Binding Set, and Atlas
  coordinates applicable to the variant; execution-bound subjects use the
  admitted historical Atlas snapshot, while acceptance binds the exact
  integration parent and sealed Candidate tree;
- every exact Control Record Reference selected by the variant;
- qualification, repository, runtime, interface, provider, authority-subject,
  and transaction-rule coordinates;
- Director principal, key, and signature-algorithm identifiers;
- authorization time and optional expiry; and
- one nonce or transition identity preventing replay in another Delivery,
  repository basis, Decision, or event coordinate.

Private physical locators, Handles, allocation keys, credentials, locks, and
Reclamation coordinates remain outside semantic authority. The Runtime derives
one exact retained plan from a validated authenticated subject. One Decision
permits one effect digest. Acceptance applies the sealed integrated Candidate
over its selected integration parent. Parent movement can finish that effect
as not applied; it MUST NOT rewrite the Decision or plan. A later eligible
integration and fresh Decision are distinct authority-bearing subjects.

### Admission subject

An initial `admit` subject binds the sole proposal-ready Boundary, its complete
modality-valid baseline Receipt set, capability, exact retained repository and
Atlas Snapshot, target identity, and awaiting-admission Journal coordinate.
It authenticates the retained proposal bytes, even if live canonical HEAD moved
or its checkout became dirty after preparation. Admission has no canonical
product effect. It does not select a future Candidate or authorize integration.

A `readmit` subject additionally binds the exact active predecessor Boundary,
proposed successor, frozen Condition, continuing Candidate identity, its current
immutable application base and bytes, and awaiting-readmission coordinate.
The successor's resolution rationale already belongs to its retained Brief.
The runtime context-change or exact reviewer applicability resolution route
can select its exact retained parent P
as the successor's governing Snapshot. Authentication cannot choose another P,
change Candidate bytes, or silently merge the Candidate.

For both variants, authentication does not activate a Boundary. Only an exact
`transaction-effect-observed` event with `applied` outcome makes the selected
revision active. Initial admission then publishes the initial Candidate
Revision Carrier and retains its first Candidate Revision. Readmission
preserves the existing Candidate, Carrier, and immutable base.

### Acceptance subject

An `accept` subject binds the exact active Work Boundary, current Candidate
Revision, current Candidate Seal, acceptance-ready Evidence Packet, exact
Candidate Revision Carrier manifest digest, integration parent commit and tree,
and exact sealed Candidate tree. It also binds
the decision-ready event head. The Seal and Packet must join to that same
Boundary and Candidate Revision. The subject authorizes only that exact tree to
become canonical over that exact parent. It authorizes no alternate parent,
Atlas selection, merge, rebase, or composition. The subject contains no
Delivery Control path or payload to commit onto HEAD. The runtime MUST prove
that the Candidate has no Atlas delta relative to its selected integration
parent. Before a new canonical effect, the transaction owner MUST freshly
observe that the canonical branch and clean authoritative checkout reproduce
that exact parent. The admitted epoch remains the governing Work Boundary
basis unless an authenticated readmission selected a successor.

Evidence readiness does not authorize the effect. The Director signature does
not claim it occurred. Only an exact applied transaction observation followed
by truthful Candidate, repository, Execution Containment and Retirement, and
Closure facts establishes the Accepted Result.

Before requesting authentication, the runtime MUST require the Evidence
verifier's interpretation of the exact retained acceptance justification. This
historical verification does not replace the transaction owner's fresh physical
observation and Evidence verification before a new effect. Authentication does
not certify an assembler's assertion or weaken either check.

### No-ship subject

A `no-ship` subject binds the Director reason, selected legal Candidate
disposition when applicable, exact event head, and every subject already
established by the Delivery:

<!-- markdownlint-disable MD013 -->

| Reducer subject | Required Decision relationships and authority bindings |
| --- | --- |
| unsuccessful preparation with no Work Boundary and no Candidate | no Boundary, Candidate, Seal, or Evidence reference |
| proposal awaiting initial admission | exact proposed Work Boundary; no Candidate, Seal, or Evidence reference |
| admitted Delivery, including boundary resolution or awaiting readmission | exact active Work Boundary and current Candidate Revision; no Seal or Evidence requirement |

<!-- markdownlint-enable MD013 -->

The runtime derives the applicable row; a caller cannot choose a sparser
subject. Early no-ship may omit both Boundary and Candidate only when the event
fold proves neither ever existed. Because no historical Boundary trust subject
exists in that form, its v4 Decision subject loads one complete valid exact
current repository and Atlas basis to identify the target trust root. When a
Boundary has been established, no-ship authenticates that Boundary's historical
repository and Atlas basis instead; a proposed successor awaiting readmission
does not displace the still-active Boundary. Neither form requires the
repository to remain at that coordinate after authentication, because the
no-ship effect publishes no repository bytes and observes only truthful
non-publication. Target or Control-subject substitution remains forbidden.
No-ship never publishes Candidate bytes, requires passing Evidence, or turns a
failure into a no-ship fact before the authenticated transaction is observed
applied. When a Candidate exists, its sole supported disposition is `abandon`;
that authority ends advancement and acceptance without claiming Carrier
erasure.

The signature MUST cover the canonical JSON subject bytes. A runtime MUST
validate the complete subject and every referenced revision before it performs
any effect. An interface MUST NOT sign or request a signature over semantic
Markdown alone, an exported rendering, redacted view, summary, event, cached
state, SQLite file, or reconstructed approximation.

## Authentication

A repository declares the accepted Director principal and verification keys.
The principal can represent a human or an agent; authentication validates the
same identity, exact subject, and authority contract in either case.
The private signing material remains outside target repositories, Candidates,
Control Record Stores, governed authoring workspaces, Knowledge Projections,
prompts, provider state, adjacent files, logs, exports, and reviewable status.
The Store retains only the exact public authentication facts required by the
Director Decision, transaction recovery, and Closure.

### Authorization Review

Before authentication, the runtime compiles one deterministic Authorization Review conforming to
[`authorization-review.schema.json`](../schemas/authorization-review.schema.json).
It is a read-only value under one exact Delivery generation, not a Director
Decision, authority subject, signature request, retained Control revision,
Journal event, operation reservation, or proof that any effect occurred.

The review binds:

- target, Store, Process, eligible public authority operation, and derived
  Decision variant;
- the exact normalized operation-owned semantic Markdown and its UTF-8 digest;
- the exact Journal head and reducer-facts digest;
- the exact historical repository, Product State, Knowledge, Check Binding,
  and Atlas basis applicable to the Decision;
- the canonically ordered role-bearing Control selections required by that
  variant;
- qualification, repository, Provider Adapter, authority-subject, and
  transaction-rule coordinates;
- the configured public Director principal, key, and algorithm identities;
- the required Candidate disposition; and
- one `authorizationReviewDigest` over the complete review body excluding only
  that self-digest field.

The review carries at most 4,100 selected Control bindings. This admits the
maximum 4,096 baseline Check Receipts plus the Work Boundary and, for
readmission, the predecessor Boundary, Material Condition, and retained
Candidate. The bound therefore cannot refuse a legal maximum-size Director
Decision subject.

`delivery.admit` review derives `admit` or `readmit` from reducer standing.
`delivery.accept` review derives `accept`. `delivery.no-ship` review derives
`no-ship` and requires the exact normalized no-ship semantic input. Admit and
accept accept no semantic review input. An early no-ship can have no Boundary
or later Control selection only when reduction proves those subjects do not
exist. The review result and its enclosing Delivery generation MUST name the
same Store, Process, Journal sequence, and Journal digest.

Activity identity, Director Decision identity, authorization time, expiry,
subject nonce, challenge, signature, authority secret, final signed-subject
digest, and transaction effect plan are deliberately absent. During actual
authentication the runtime rederives the exact review under the operation lock,
projects that unchanged semantic core into the existing
`lifecycle.director-decision-subject.v4`, adds only those operation-instance and
authentication mechanics, and signs the complete final subject. The review
digest MUST NOT be presented as the Director Decision subject digest.

### Invocation-private challenge handoff

A web or other local presentation client may use one generic external handoff:

```text
lifecycle authorize CHALLENGE --authority-secret-file FILE
```

This command does not add a Delivery mutation, authorization record, public
Runtime operation, Process stage, or compatibility route. Direct canonical CLI
admit, accept, and no-ship commands remain valid peers. Initialization remains
direct and does not require a live presentation invocation.

The challenge has exactly the shell-safe form
`lcw1.<lowercase-uuid>.<43-character-unpadded-base64url-nonce>`. The nonce is
32 independently random bytes and the complete token is at most 96 ASCII bytes.
It contains no target, Delivery, operation, generation, subject, path, semantic
input, authority identity, or secret. The target-pinned runtime retains only a
SHA-256 digest of the token with the exact local session, invocation, operation,
normalized semantic input and digest, expected Delivery generation,
Authorization Review digest, public authority identity, creation time, and
expiry. The raw token may remain only in the one pending session slot needed to
return an unchanged pending challenge.

One session has at most one pending challenge. Requesting the same unchanged
review returns that challenge; requesting another valid review first makes the
old challenge permanently stale. A challenge expires exactly five minutes
after creation. One invocation retains at most 32 pending records and terminal
tombstones; exhaustion refuses a new issue instead of discarding replay state
or growing without bound. Externally distinguishable states are `pending`,
`consumed`, `expired`, `stale`, and `refused`.

Consumption first resolves the exact live invocation, validates the owner-
private regular authority file, and streams no more than the selected secret
byte limit to a fixed helper over standard input. The secret MUST NOT enter
arguments, environment, mounts, browser HTTP, repository files, Control,
provider input, logs, diagnostics, or output. The helper forwards only those
bounded bytes through an invocation-private local channel to the already-
running target-pinned runtime. It is not another service, authority owner, or
semantic compiler.

The runtime atomically claims the challenge before authentication, rederives
the exact Authorization Review under the authority operation lock, compares
every retained binding, authenticates the complete final subject, and then
executes the existing authority-bearing operation. Wrong invocation, malformed
token, expiry, replay, concurrent second consumption, changed generation,
changed review, changed operation or semantic input, changed public authority,
wrong secret, or failed authentication cannot restore `pending` and cannot
invoke the operation. Loss of the presentation invocation invalidates every
unused challenge. After durable authority intent, ordinary exact Delivery
recovery—not challenge state—owns interruption.

Challenge state is invocation-private volatile support. It is not Control,
Journal, Process state, Evidence, Director authority, a recovery carrier, or a
published JSON schema. Browser completion is inferred only from a refreshed
Runtime result; `consumed` alone does not claim that the transaction completed.

The private channel distinguishes refusal before its operation handler starts
from failure to observe a submitted authorization result. A channel refusal
MUST establish that this request did not enter the handler. A callback exception,
invalid or misbound returned result, interrupted response, or lost connection
after submission may have begun MUST NOT establish that the operation was
refused or left Product and Control unchanged. A channel MUST NOT append a
refusal frame after beginning a result response.

An invocation that cannot return the handler's exact result may return the
closed private frame with exactly `kind`, `invocationId`, and `code`:
`kind` is `invocation-private-authorization-observation-unavailable`,
`invocationId` is the exact selected lowercase UUID, and `code` is
`authorization-result-unavailable`. The existing bounded response carrier
applies. No exception text, caller-supplied error code, challenge, authority
material, physical path, result digest, or inferred operation outcome belongs
in this frame.

The canonical CLI maps that frame, and locally detected response loss after
submission may have begun, to `runtime.authorization-result-unavailable`.
Its error carrier requires both `repositoryChanged` and
`operationalStateChanged` to be `null`, `retryable` to be `false`, empty
`recoveryActions`, no `diagnostics`, and exactly these `observedFacts`:
the selected `invocationId` and
`authorizationSubmission: "may-have-started"`. Only this diagnostic permits
null change flags; ordinary diagnostic booleans keep their meaning. Null means
unobserved, not unchanged. This diagnostic authorizes neither resubmission nor
recovery and does not add a Delivery standing or operation-result status.
The caller returns to an exact Runtime read to distinguish work in progress,
a retained recovery obligation, a conclusive refusal, or completed Closure.
No-effect classification MUST require explicit false change flags.

A conforming runtime MUST:

- construct, present, and digest the complete exact subject before requesting
  authority;
- reject an unsupported principal, key, signature algorithm, or subject schema;
- reject a signature whose subject bytes differ;
- reject expired or replayed authorization where the transition defines those
  constraints;
- revalidate the Store, Journal head, every selected Control Record Revision,
  repository, Candidate, Process, selected coordinates, and transaction
  preconditions after authentication and immediately before intent and effect;
- for admission, reproduce the every-and-only baseline Receipt selection from
  the signed Boundary and historical Journal basis rather than accepting a
  caller-supplied or latest-row approximation;
- finalize exactly one Director Decision revision and authentication event for
  the authenticated subject, without mutating its selected Work Boundary,
  Candidate, Seal, Packet, reason, or disposition;
- record transaction intent before the first authority-bearing effect and
  retain the exact effect plan outside semantic Control fields;
- preserve a recoverable exact transaction when interruption occurs after the
  intent safe point;
- expose enough typed information for a caller to distinguish invalid authority
  from stale subject, operational failure, and transaction recovery.

Authentication uses typed runtime values, not retained Markdown as IPC. The
runtime may render an exact readable review, but the signature covers the canonical
JSON subject bytes. A signer or interface must be able to verify that the review
and signed bytes name the same Decision semantics and exact record revisions.
The authority implementation MUST expose authentication for that supported
Decision subject, rather than a general signing or secret-retrieval operation
to ordinary Runtime composition. It verifies the configured identity and
subject contract before authenticating. Its result proves authentication of
those exact bytes; the transaction owner still establishes eligibility,
currentness, and application through the existing effect and recovery rules.

The selected invocation-private credential is opaque and bound to exactly one
purpose: authority initialization or Director Decision authentication. Once
consumed for that purpose it cannot be used again; ending intake custody
discards any unused credential. The credential exposes no secret accessor or
general signer and does not itself authenticate a Decision. It is absent from
public requests, retained Control, and recovery subjects.

Missing, forged, consumed, discarded, or wrong-purpose credentials refuse with
`lifecycle.authority.credential`. An invalid private execution context,
including a legacy raw-secret field or authority material supplied to a
non-authority read, productive operation, or recovery, refuses with
`lifecycle.authority.context` before owner dispatch. These diagnostics identify
the failed custody contract without disclosing private credential facts.

The retained Foundation signature carrier is exactly `ed25519:` followed by the
86-character unpadded base64url encoding of the 64 Ed25519 signature bytes. The
fixed transaction-rule coordinate in every Director Decision subject is
`lifecycle.delivery-transaction-rules.v1`; neither value is caller-selected.

### Decision Readiness is not authority

The runtime may join the current Boundary, Candidate Revision, Seal, Evidence
Packet, eligible authority operation, and any retained Director Decision into
the Decision Readiness section of one coordinate-bound Delivery View. That
section is a disposable review aid. It cannot create a Decision, infer current
Director intent from generic approval, obtain authority material, choose a
signature subject, or prove an effect occurred. The complete runtime-constructed
subject remains the only reviewable authentication basis, and authority-bearing
operations remain explicit canonical-CLI handoffs from the TUI.

### Publication authentication

A Publication Statement conforms to
[`publication-statement.schema.json`](../schemas/publication-statement.schema.json).
Its exact signed subject binds the statement identity, canonical specification
identifier `lifecycle`, publication version, specification revision, immutable
source revision, Publication Manifest digest, lifecycle status, prior-statement
digest, Release Notes locator and digest, issue time, and status reason. The
`subjectDigest` is derived from those exact canonical subject bytes, and the
Ed25519 signature covers the same bytes.

The authentication envelope identifies the publication principal and key but
does not embed or establish the trust root. A verifier MUST select the expected
principal, key identity, and Ed25519 public key independently; verify their
exact equality with the envelope; reproduce the subject digest; and verify the
signature before accepting the status. Target-repository Director keys,
provider credentials, a Git commit signature, and a conformance-claim issuer
are non-substitutes unless the external release-authority policy explicitly
selects that same key for this distinct purpose.

## Currentness and Staleness

Authority is valid only for the exact current subject it names.

A change to any of these facts invalidates reuse unless the applicable Process
explicitly defines a compatible relationship:

- selected Knowledge record revision or source digest;
- exact Work Boundary identity, revision, or logical digest;
- Candidate identity, base, current Revision, or state digest;
- Journal head or an eligibility-relevant reducer subject before transaction
  intent;
- repository epoch or Product State basis applicable to that subject;
- Check Binding, Check Receipt, Seal, or required Evidence set;
- capability profile;
- effect or risk declaration;
- acceptance proposition set;
- principal or verification key; or
- selected qualification, repository, runtime, interface, provider, authority,
  or transaction-rule coordinate.

Before intent, any change to the authority subject requires a new
authentication. After intent, the transaction's own expected event motion does
not invalidate its retained authority; exact recovery of an indeterminate
effect resumes only the same Decision and effect plan. Provider restart,
interface restart, or elapsed time without expiry does not by itself change the
subject. A fresh Agent Attempt changes no already applied authority, but it
cannot reuse an unconsumed authorization when its event head or selected facts
differ.

The admitted Atlas Snapshot is immutable historical context. Canonical movement
does not invalidate authority over that retained proposal or govern active work
implicitly. Explicit integration constructs an exact successor against P and
requires context-change readmission when necessary. Acceptance authority binds
the current integrated result and P, independently of an older W(B). Applied
observation and Closure bind the actual accepted commit. Indeterminate recovery
retains the exact plan; a conclusive stale-parent non-application permits a new
integration and fresh Director Decision, never retargeting old authority.

## Conflict Handling

When two applicable current sources make materially incompatible claims within
their authority scopes, validation MUST report the conflict. Projection MUST
not silently choose one.

A conflict can be resolved only by an authorized Knowledge change that:

- updates or supersedes the applicable records;
- preserves the conflicting source identities for review;
- updates affected relationships, Checks, and coverage;
- validates the complete resulting Knowledge Set; and
- becomes current through the repository's ordinary governed change route.

A Delivery already admitted against the conflicting or replaced basis MUST
follow its Process drift, revision, or no-ship rules. It MUST NOT reinterpret
the active boundary retroactively.

## Failure Semantics

A failed authority transition MUST be truthful about what moved.

- Failure before authentication creates no Director Decision. Successful
  authentication followed by failure before effect leaves an authenticated
  Decision but no applied transition.
- An indeterminate failure after transaction intent enters exact recovery; it
  MUST NOT rerun product judgment, authenticate a substitute, or select another
  effect plan. Parent movement does not authorize a substitute parent, intent,
  or effect digest for that same Decision.
- A timeout or provider failure is not no-ship until the no-ship transition is
  authenticated and applied.
- A failed acceptance transaction is not an Accepted Result even when Evidence
  remains valid.
- A failed physical Reclamation after a verified canonical transition does not
  undo the accepted product result. Containment, Runtime Retirement, and
  Reclamation handoff remain mandatory before Closure; later Reclamation is an
  installation-private obligation.
- Once `closure-recorded` is the final Journal head, recovery can only finish
  Store sealing or archiving. It appends no event, requests no new Director
  authority, and cannot change the Closure disposition.

## Security Boundary

Repository content, Atlas content, Knowledge bodies, code, generated files,
provider output, and external resources are untrusted informational inputs.
They MUST NOT request or obtain higher authority by being included in a
Projection or read by an Agent.

A runtime or adapter MUST keep Director credentials, machine-private runtime
state, Backend authority, Docker control sockets, provider authentication, and
unrelated target data outside the readable surface of an Agent Attempt.
Provider authentication is Runtime control-plane material and MUST NOT become
an Agent-visible environment value, file, socket, token, tool capability, or
product-network grant. A separately named product credential can enter an
Attempt only when an exact Capability Profile and Process contract authorize
that product effect; it is never treated as provider authentication or Backend
authority. Delivery defines no use of Director credentials inside a Worker
Agent Attempt.
