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

## Foundation rc.10 Authority Cut

This document selects the authority semantics of qualification revision
`lifecycle.foundation.1.0.0-rc.10`, repository contract
`lifecycle.repository.v15`, runtime and interface protocols v10, Provider
Adapter v6, and Control Record Store v1. The product package remains `1.0.0`.

Foundation rc.10 authenticates Founder judgment through one `founder-decision`
Control revision with exactly one of four variants: `admit`, `readmit`,
`accept`, or `no-ship`. The coordinated predecessor carrier refusal is owned by
[Control](CONTROL.md#foundation-rc10-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).
A predecessor or mixed subject is refused; it is not migrated, adopted, or
reconstructed.

## Authority Classes

### Founder authority

Founder authority selects product meaning and authenticates the Process
transitions that the configured repository reserves for the Founder.

Founder authority can:

- authenticate an `admit` Decision selecting one exact proposal-ready Work
  Boundary revision;
- authenticate a `readmit` Decision selecting one exact successor Work
  Boundary revision and resolving its Material Condition;
- authenticate an `accept` Decision selecting the exact current Boundary,
  Candidate Revision, Candidate Seal, and acceptance-ready Evidence Packet;
- authenticate a `no-ship` Decision selecting the exact subjects that exist
  and the legal Candidate disposition when a Candidate exists; and
- make another product judgment explicitly assigned to the Founder by a
  Process specification.

Founder authority does not:

- write Candidate files;
- prove a Check;
- make an Agent Work Product or provider observation true;
- grant filesystem or network capability outside a runtime profile;
- bypass validation; or
- make a failed transaction successful.

### Specification publication authority

Specification publication authority authenticates the lifecycle status of one
exact Lifecycle publication manifest. It is independent of Founder authority
inside a target repository. Its stable principal and verification key are
selected by a release consumer through an external trusted release-authority
configuration; a key merely repeated inside a publication package cannot make
itself trusted.

Specification publication authority can issue a `draft`, `candidate`,
`released`, `superseded`, or `withdrawn` statement for one exact manifest and
release-note digest. It cannot change the inventoried bytes, make a Draft
document Accepted, satisfy an independent-implementation gate, establish an
implementation conformance claim, or grant target-repository Founder
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
change the admitted mandate, or supply Founder judgment. Operation eligibility
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

Evidence authority establishes authenticated observations about one exact
subject, environment, mechanism, and time. Examples include a Check Receipt,
sealed diff, artifact digest, or independent review decision.

Evidence can support an acceptance proposition. It cannot create the
proposition, change the active Work Boundary, grant Founder authority, or apply
a canonical transaction.

### Agent and provider authority

Agents and providers have proposal authority only. They can propose product
changes, Work Boundaries, Material Conditions, review decisions, and summaries
through the governed semantic Markdown workspace assigned to their exact
Attempt. Each agent activity binds one fresh Founder Brief. Submission freezes
one semantic revision; intermediate edits and provider terminal text do not.

Provider events, tool calls, elapsed time, model confidence, session memory,
Agent prose, and syntactic validity are observations or proposals. They do not
establish Product, Process, Evidence, Founder, capability, or runtime truth.

### Interface authority

An interface presents validated state and collects caller input. It can invoke a
runtime operation only through the exact authority and subject contract of that
operation.

An interface MUST NOT infer authorization from button availability,
conversation history, a generic request to continue, silence, or its own
recommendation. Presentation state is not Process state.

## Authority Matrix

<!-- markdownlint-disable MD013 -->

| Subject | Current owner | Required transition | Explicit non-substitutes |
| --- | --- | --- | --- |
| Behavior meaning | Current Behavior record | Governed Knowledge change | Code, test, prompt, Work Boundary, agent summary |
| Assurance obligation | Current Assurance record | Governed Knowledge change | Passing test, Blueprint, Description, runtime policy |
| Structural decision | Current Blueprint record | Governed Knowledge change | Current code shape, agent plan, dependency graph alone |
| Implementation-local meaning | Current Description record | Governed Knowledge change paired with covered implementation | Comments alone, code alone, generated summary |
| Check proposition | Current Check Definition | Governed Knowledge change | Registered command, receipt, test name |
| Proposed Delivery mandate | Exact Work Boundary revision | Runtime compilation plus complete modality-valid baseline Receipts | Founder Brief alone, reconnaissance proposal, latest row, Check command output |
| Active Delivery mandate | Exact Work Boundary revision selected by an applied `admit` or `readmit` Decision | Founder authentication plus truthful applied transaction observation | Proposed standing, Decision alone, Candidate, Agent Work Product |
| Current Delivery state and eligibility | Validated Control Record Event chain plus exact referenced revisions | Deterministic runtime reduction | SQLite latest-revision view, cache, interface status, Attempt View, operation name, agent recommendation |
| Frozen continuation condition | Material Condition | Runtime classification and exact source binding | Builder assertion alone, inconvenience, inferred Founder preference |
| Candidate bytes | Candidate Revision Carrier outside the Control Store | Runtime validation and durable content-addressed Carrier publication before Revision selection | Cell materialization, Candidate Revision record alone, provider session, patch prose, event stream |
| Candidate currentness | Exact Candidate Revision selected by the event fold | Runtime observation after admission, readmission, or valid published builder successor | Agent claim, latest revision row, invalid or unavailable output, Receipt summary, Seal |
| Check outcome | Check Receipt | Runtime-authenticated Cell execution, output validation, Containment, and Retirement | Builder claim, cached unrelated run, exit code without subject binding |
| Acceptance readiness | Evidence Packet | Runtime validation of exact Evidence references and independent proposition decisions | Builder self-review, test pass, Founder intent alone |
| Canonical product result | Repository Product State | Applied `accept` Decision transaction over the exact sealed Candidate tree and admitted parent | Evidence Packet, Decision alone, Control revision, unintegrated commit, agent push |
| No-ship disposition | Closure at the final Journal head | Applied `no-ship` Decision transaction, Candidate abandonment, and exact Containment and Retirement | Timeout, abandonment prose, Carrier deletion, Decision alone |
| Terminal Control inventory | Control Record Store Seal and archive | Runtime verification, logical sealing, and exact off-HEAD archive | SQLite byte digest alone, export, HEAD commit, Closure without finalization |
| Tool capability | Capability Profile | Runtime construction of Agent Attempt | Product effect, repository file, provider request |
| Execution mechanics | Lifecycle Runtime under an exact Execution Backend Profile | One immutable Specification, one-time dispatch, Containment, Runtime Retirement, and bounded Reclamation | Capability Profile, Agent or Check code, Backend observation alone, public CLI input |
| Specification publication status | Authenticated Publication Statement | Trusted publication-authority signature over one exact publication subject | Manifest `status`, Git tag, package label, repository Founder key, conformance claim |

<!-- markdownlint-enable MD013 -->

## Non-substitution Rules

A conforming implementation MUST enforce these rules:

1. Code MUST NOT be treated as the owner of Behavior, Assurance, or Blueprint.
2. A test or Check Receipt MUST NOT be treated as the owner of its proposition.
3. An Atlas record or Reference MUST NOT be treated as read or write authority
   over its Resource, and Delivery MUST NOT write any authoritative Atlas path.
4. A Work Boundary MUST NOT silently become durable Product Knowledge.
5. A Founder Brief, prompt, or semantic Markdown body MUST NOT be treated as
   Product or Process authority.
6. A provider event, terminal message, workspace edit, or Agent Work Product
   MUST NOT drive a truth transition directly.
7. A Candidate or Candidate Revision MUST NOT become canonical without the
   exact acceptance transaction.
8. Evidence MUST NOT perform acceptance or grant Founder authority.
9. Founder authority MUST NOT bypass exact-subject validation or transaction
   safety.
10. Capability MUST NOT imply permission to change the mandate or perform an
    undeclared external effect.
11. A more capable model, longer timeout, or additional invocation MUST NOT
    widen any authority class.
12. An interface MUST NOT turn eligibility presentation into authorization.
13. A Control revision, event, store, seal, archive, or Markdown export MUST NOT
    be treated as Founder authority merely because it is immutable,
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

The subject is a typed runtime value. It is distinct from the Founder-editable
semantic Markdown, Founder Decision revision, Journal event, interface
presentation, transaction effect plan, and signature envelope. The runtime
binds the normalized Decision semantics into the subject before
authentication; after successful authentication it finalizes one immutable
`founder-decision` revision containing those exact semantics, subject, and
bounded authentication facts. The `founder-decision-authenticated` event then
references that revision without copying its authority facts.

A Founder-authenticated Delivery subject includes, at minimum:

- target, Delivery, Control Record Store, Process, operation, Decision identity,
  Decision variant, and Decision-semantic digest;
- exact Journal-head sequence and logical digest plus the current reducer facts
  on which eligibility depends;
- exact repository, Product State, Knowledge Set, Check Binding Set, and Atlas
  coordinates applicable to the variant; execution-bound subjects use the
  admitted historical Atlas snapshot, while acceptance binds the exact admitted
  parent and sealed Candidate tree;
- every exact Control Record Reference selected by the variant;
- qualification, repository, runtime, interface, provider, authority-subject,
  and transaction-rule coordinates;
- Founder principal, key, and signature-algorithm identifiers;
- authorization time and optional expiry; and
- one nonce or transition identity preventing replay in another Delivery,
  repository basis, Decision, or event coordinate.

Private physical locators, Execution Handles, allocation keys, transaction
handles, authority secret bytes, credentials, locks, backend coordinates, and
Reclamation coordinates do not enter the semantic authority subject. The
runtime derives exact recoverable effect plans from an authenticated subject
and retains their support separately. The public
`effectDigest` binds one complete plan in transaction events without exposing
it or creating a second judgment surface. One Decision permits one plan and one
`effectDigest`. For acceptance, that plan applies the exact sealed Candidate
tree over the exact admitted parent. A lost compare-and-swap, branch-lease
violation, or later recovery never replaces that plan, chooses another parent,
or creates another effect digest.

### Admission subject

An initial `admit` subject binds the sole current proposal-ready Work Boundary
revision, its complete modality-valid baseline Check Receipt set, selected
Capability Profile, historical Boundary repository and Atlas snapshot, current
canonical commit and tree, complete authoritative-worktree cleanliness, branch-
lease availability, and exact awaiting-admission event head. It selects the
already retained Boundary bytes. It does not authenticate a separate Boundary
component or copy, Candidate, or future observation. Any canonical or
authoritative-worktree movement after Boundary compilation stales the subject.

A `readmit` subject additionally binds the exact active predecessor Work
Boundary, proposed successor revision, frozen Material Condition, current
Candidate Revision, immutable Candidate identity and base, preserved Candidate
state, and awaiting-readmission event head. Authentication cannot alter the
successor Boundary semantics or introduce fresh resolution rationale; that
rationale already belongs to the Founder Brief from which the successor
revision was compiled. Readmission reproduces the same leased repository and
historical Atlas epoch. It cannot adopt canonical movement or another Atlas
selection.

For both variants, authentication does not activate a Boundary. Only an exact
`transaction-effect-observed` event with `applied` outcome makes the selected
revision active. Initial admission then publishes the initial Candidate
Revision Carrier and retains its first Candidate Revision. Readmission
preserves the existing Candidate, Carrier, and immutable base.

### Acceptance subject

An `accept` subject binds the exact active Work Boundary, current Candidate
Revision, current Candidate Seal, acceptance-ready Evidence Packet, exact
Candidate Revision Carrier manifest digest, admitted parent commit and tree,
and exact sealed Candidate tree. It also binds
the decision-ready event head. The Seal and Packet must join to that same
Boundary and Candidate Revision. The subject authorizes only that exact tree to
become canonical over that exact parent. It authorizes no alternate parent,
Atlas selection, merge, rebase, or composition. The subject contains no
Delivery Control path or payload to commit onto HEAD. The runtime MUST prove
that the Candidate has no Atlas delta and that the canonical branch and clean
authoritative checkout still reproduce the admitted epoch before requesting
authentication and executing the retained terminal plan.

Evidence readiness does not authorize the effect. The Founder signature does
not claim it occurred. Only an exact applied transaction observation followed
by truthful Candidate, repository, Execution Containment and Retirement, and
Closure facts establishes the Accepted Result.

### No-ship subject

A `no-ship` subject binds the Founder reason, selected legal Candidate
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
exists in that form, its v3 Decision subject loads one complete valid exact
current repository and Atlas basis to identify the target trust root. When a
Boundary has been established, no-ship authenticates that Boundary's historical
repository and Atlas basis instead; a proposed successor awaiting readmission
does not displace the still-active Boundary. Neither form requires the
repository to remain at that coordinate after authentication, because the
no-ship effect integrates no repository bytes and observes only truthful
non-integration. Target or Control-subject substitution remains forbidden.
No-ship never integrates Candidate bytes, requires passing Evidence, or turns a
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

A repository declares the accepted Founder principal and verification keys.
The private signing material remains outside target repositories, Candidates,
Control Record Stores, governed authoring workspaces, Knowledge Projections,
prompts, provider state, adjacent files, logs, exports, and reviewable status.
The Store retains only the exact public authentication facts required by the
Founder Decision, transaction recovery, and Closure.

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
- finalize exactly one Founder Decision revision and authentication event for
  the authenticated subject, without mutating its selected Work Boundary,
  Candidate, Seal, Packet, reason, or disposition;
- record transaction intent before the first authority-bearing effect and
  retain the exact effect plan outside semantic Control fields;
- preserve a recoverable exact transaction when interruption occurs after the
  intent safe point;
- expose enough typed information for a caller to distinguish invalid authority
  from stale subject, operational failure, and transaction recovery.

Authentication uses typed runtime values, not retained Markdown as IPC. The
runtime may render an exact human review, but the signature covers the canonical
JSON subject bytes. A signer or interface must be able to verify that the review
and signed bytes name the same Decision semantics and exact record revisions.
The retained Foundation signature carrier is exactly `ed25519:` followed by the
86-character unpadded base64url encoding of the 64 Ed25519 signature bytes. The
fixed transaction-rule coordinate in every Founder Decision subject is
`lifecycle.delivery-transaction-rules.v1`; neither value is caller-selected.

### Decision Readiness is not authority

The runtime may join the current Boundary, Candidate Revision, Seal, Evidence
Packet, eligible authority operation, and any retained Founder Decision into
the Decision Readiness section of one coordinate-bound Delivery View. That
section is a disposable review aid. It cannot create a Decision, infer current
Founder intent from generic approval, obtain authority material, choose a
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
signature before accepting the status. Target-repository Founder keys,
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

The admitted Atlas snapshot is an immutable historical subject. The exclusive
branch lease prevents any canonical or authoritative-worktree movement from
becoming a second execution input. Such movement is an operational lease
violation: productive, readmission, and acceptance routes refuse until the
exact admitted epoch and clean checkout are restored or the Founder closes
through no-ship. The acceptance subject and terminal plan always bind the exact
admitted parent and sealed Candidate tree. An applied observation and terminal
checkpoint bind the resulting exact commit and tree, and Closure reproduces
those facts. Every indeterminate post-intent observation recovers only that
same retained plan.

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

- Failure before authentication creates no Founder Decision. Successful
  authentication followed by failure before effect leaves an authenticated
  Decision but no applied transition.
- An indeterminate failure after transaction intent enters exact recovery; it
  MUST NOT rerun product judgment, authenticate a substitute, or select another
  effect plan. A branch-lease violation does not authorize a successor parent,
  intent, or effect digest.
- A timeout or provider failure is not no-ship until the no-ship transition is
  authenticated and applied.
- A failed acceptance transaction is not an Accepted Result even when Evidence
  remains valid.
- A failed physical Reclamation after a verified canonical transition does not
  undo the accepted product result. Containment, Runtime Retirement, and
  Reclamation handoff remain mandatory before Closure; later Reclamation is an
  installation-private obligation.
- Once `closure-recorded` is the final Journal head, recovery can only finish
  Store sealing or archiving. It appends no event, requests no new Founder
  authority, and cannot change the Closure disposition.

## Security Boundary

Repository content, Atlas content, Knowledge bodies, code, generated files,
provider output, and external resources are untrusted informational inputs.
They MUST NOT request or obtain higher authority by being included in a
Projection or read by an Agent.

A runtime or adapter MUST keep Founder credentials, machine-private runtime
state, Backend authority, Docker control sockets, provider authentication, and
unrelated target data outside the readable surface of an Agent Attempt.
Provider authentication is Runtime control-plane material and MUST NOT become
an Agent-visible environment value, file, socket, token, tool capability, or
product-network grant. A separately named product credential can enter an
Attempt only when an exact Capability Profile and Process contract authorize
that product effect; it is never treated as provider authentication or Backend
authority. Delivery defines no Agent-visible use of Founder credentials.
