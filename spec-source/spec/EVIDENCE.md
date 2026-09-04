# Lifecycle Evidence

> Status: Draft

## Purpose

This document defines how Lifecycle obtains, authenticates, evaluates, reuses,
and invalidates Evidence for one exact Delivery subject. It owns Check
Definitions and Bindings, temporal proof, Candidate sealing, Check Receipts,
independent review, Evidence Packet ledgers, acceptance readiness, and evidence
failure locality.

Evidence answers a bounded question about one exact subject. It does not create
the requirement, alter the Work Boundary, grant Founder authority, integrate
Candidate bytes, or abandon a Candidate.

[Control](CONTROL.md) owns the common Control Record Store carrier, immutable
revision lifecycle, exact relationships, Journal events, Activity-kernel
mechanics, store sealing, and archive. [Agent Attempts](ATTEMPTS.md) owns
reviewer execution and Agent Work Product submission. [Execution](EXECUTION.md)
owns the subordinate Backend, Cell, Carrier, Containment, Retirement, and
Reclamation contracts.
[Delivery](DELIVERY.md) owns operation eligibility,
correction, transactions, and recovery. [Authority](AUTHORITY.md) owns Founder
authentication. This document owns the evidence meaning of the exact records
those mechanisms retain.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Foundation rc.10 Evidence Cut

Foundation rc.10 retains Delivery Evidence only through these Control families:

- `candidate-seal`;
- `check-receipt`;
- reviewer `agent-work-product` and `execution-receipt`;
- `evidence-packet`;
- the selecting `founder-decision`; and
- terminal `closure`.

Artifact observations, Description coverage, Receipt reuse, invalidation,
reviewer independence, proposition decisions, and obligation states are typed
ledgers inside one Evidence Packet. They are not separate records, files,
schemas, identities, or promotion units.

Foundation rc.10 applies the predecessor Evidence-carrier refusal owned by
[Control](CONTROL.md#foundation-rc10-hard-cut) and
[Evolution](EVOLUTION.md#fresh-only-hard-cut).
An export that resembles a retained Evidence value is presentation only and
cannot be imported as Evidence.

No Evidence record is promoted to repository HEAD. The complete Evidence
history remains in the Delivery Control Record Store, and terminal store
sealing and archive preserve it off HEAD. Acceptance makes only the exact
sealed Candidate tree canonical over the exact admitted parent. Candidate
confinement already proves that tree contains no Atlas delta. Closure remains
the sufficient terminal Control summary.

## Evidence Model

Lifecycle separates five layers:

```text
Knowledge obligation
    -> Check Definition or acceptance proposition
    -> repository Check Binding or review rule
    -> Check Receipt or reviewer judgment
    -> Evidence Packet for one sealed Candidate
```

The layers remain independently identifiable:

- a Check Definition owns a falsifiable proposition;
- a Check Binding selects an executable proof mechanism;
- a Check Receipt authenticates one runtime-observed execution outcome;
- a reviewer Work Product supplies independent agent-proposed judgments; and
- an Evidence Packet validates and derives the complete readiness result.

A command name is not a Check Definition. An exit code is not a Check Receipt.
A builder claim is not Evidence. A reviewer judgment is not a runtime-observed
fact. An Evidence Packet is not Founder acceptance.

An Execution Receipt authenticates one Agent Attempt's execution and submission
boundary. It does not establish a Check proposition merely because the provider
returned naturally, claimed to run a command, or produced Candidate bytes. A
reviewer Execution Receipt can prove that one exact reviewer Work Product came
from one exact read-only Attempt; the Work Product still has
`agent-proposed` authority.

An exact Candidate difference and Decision Readiness section are disposable
runtime read models. They may help a Founder inspect the selected proof subject,
but they are not Check Receipts, independent review, an Evidence Packet,
acceptance readiness, or Founder acceptance. Only the exact retained Evidence
owners below can establish those facts.

The runtime constructs all Evidence Control revisions. It assigns identities,
resolves relationships, compiles typed facts, normalizes semantic Markdown,
orders values, calculates logical digests, validates exact retained bytes, and
appends each revision with its finalization event atomically. Agent prose,
caller JSON, interface state, provider events, and ordinary command output
cannot supply or override an Evidence fact.

The evaluation operation definition owns its immutable semantic plan, Carrier
validation, Check and reviewer Execution Specifications and observations, and
compilation of the resulting Evidence Control. The common
[Activity kernel](CONTROL.md#common-activity-kernel) owns the durable opening,
checkpoint coordination, reducer-checked recovery, completion, and support
Retirement for that evaluation. The reducer is the sole legal Process state
machine. A Backend phase, Check-runner phase, reviewer-adapter phase, operation
checkpoint, or Evidence compiler step is not another persisted workflow
coordinate and cannot make an evaluation milestone legal.

## Evidence Kinds

Standard evidence kinds are:

- `command` — a bounded registered executable mechanism;
- `inspection` — a reviewer or deterministic inspector observes exact facts;
- `artifact` — exact artifact existence, type, bytes, or semantic validity;
- `diff` — an exact relationship between immutable base and Candidate;
- `analysis` — a declared analytic mechanism over exact inputs; and
- `mixed` — several independently identified kinds support one proposition.

Provider events, model reasoning, elapsed time, diff size, conversation history,
cached unrelated output, and agent confidence are not standard evidence kinds.

## Check Definitions

A Check Definition is governed Product Knowledge under
[Knowledge](KNOWLEDGE.md). It owns:

- one falsifiable proposition;
- allowed proof subjects and evidence kinds;
- required Binding identities or classes;
- pass, fail, indeterminate, and not-run semantics;
- freshness and subject-equivalence rules;
- the exact limit of what a pass establishes; and
- falsifiers.

A current Behavior or Assurance requires at least one current Check Definition.
A Check can also support Blueprint and Description obligations.

A Check Definition MUST remain understandable without reading its executable
Binding. It MUST distinguish a product failure from an unavailable mechanism
and state when a seemingly successful Binding is semantically incompatible.

## Check Bindings

A Check Binding is repository configuration, not Delivery Control. It selects
one exact mechanism for one or more Check Definitions and contains:

- stable Binding identity;
- supported Check Definition identities;
- the exact ordered `{kind, selector}` subject set;
- mechanism kind, Candidate-relative or Execution-Image-relative executable,
  arguments, and working-directory relationship;
- capability, environment, network, and credential requests;
- timeout, cancellation, output, and mutation policy;
- result-parser identity, exactly the selected `check-disposition-v2` mapping
  over `pass`, `fail`, `indeterminate`, `not-run`, `unsupported`, and
  `operational-error`;
- implementation digest; and
- declared limitations.

Requested capability or environment values are not proof of enforcement. The
runner separately records requested conditions, conditions it directly
enforced and verified, and Founder-managed host assumptions. A Binding cannot
label requested or ambient behavior as runtime-enforced.

A Binding carries at most 128 explicit environment variable names. The bound
applies to the complete requested name set; a runtime cannot truncate the set
to fit a Receipt. Secret values are bound into the environment identity and
never copied into public semantic Markdown.

The Foundation rc.10 repository Binding carrier supports only `command`.
Inspection, artifact, diff, analysis, and mixed Evidence remain valid semantic
kinds, but a repository Binding for another mechanism requires a later
published carrier. A command Binding MUST NOT claim another mechanism kind.

### Command Bindings

A command Binding contains an executable selector and argument vector as
separate exact values. The selector is resolved relative to the exact Execution
Image or Candidate materialization contract selected by the Binding; it is
never a host-absolute path or ambient `PATH` lookup. It MUST NOT rely on an
ambient shell unless it explicitly selects one inside the exact Image. It
declares:

- the working-directory relationship to the proof subject;
- inherited and explicit environment variable names;
- network, credential, readable-path, and writable-path policy;
- expected exit semantics;
- stdout and stderr bounds;
- timeout and termination policy;
- generated-output treatment; and
- required Containment and output treatment.

The Binding digest covers every value that can change command meaning. The
Execution Specification additionally binds the exact Image, cell-side runner,
Backend Profile, Input Set, and effective limits. A host executable, mutable
image tag, or similarly named command cannot substitute for those identities.

### Future Binding Classes

An inspection Binding identifies the inspector, exact exposed facts,
independence requirement, allowed human or agent judgment, required citations,
and limits on inference.

An artifact Binding distinguishes artifact existence from adequacy and defines
exact path, file-kind, content, schema, coverage, or relationship conditions.

A diff Binding identifies immutable base, exact Candidate, path and file-mode
rules, prohibited changes, and normalization. It includes additions,
modifications, deletions, renames, modes, symlinks, submodules, and other
repository-relevant facts.

An analysis Binding identifies deterministic inputs, algorithm or
implementation digest, assumptions, output contract, and error bounds. Model
analysis remains judgment and cites exact source facts; it cannot be relabeled
as a deterministic runtime observation.

## Binding Compatibility and Selection

A Binding is compatible only when:

- it declares the Check Definition identity;
- its complete selector set equals the Check's required subject set;
- its mechanism supports every required evidence kind;
- capability and environment semantics meet the Check requirements;
- its parser preserves every legal Check disposition;
- mutation policy does not invalidate proof; and
- Binding limitations do not contradict the proposition.

An incompatible Binding is a validation failure. A similarly named command or
successful exit cannot substitute for compatibility.

The Work Boundary owns each exact Check selection. A selection binds:

- a boundary-local Check identity;
- exact Check Definition identity, revision, and digests;
- exact Binding identity and digest;
- temporal modality and purpose;
- covered obligation identities;
- baseline and final requirements;
- environment requirements; and
- any diagnostic-only interpretation.

Selection does not create a proposition absent from the Check Definition. A
Binding change after admission makes affected Evidence stale and can require a
new Work Boundary. The runtime MUST NOT silently adopt a replacement because it
is convenient or currently installed.

An environment requirement is a requested proof precondition, not evidence
that the runtime enforced it. An unknown or unavailable requirement produces
`unsupported`. The Foundation Docker Execution Backend installs no free-text
environment requirement interpreter, so a nonempty free-text requirement is
unsupported.
The exact requirement remains in the Work Boundary; a Receipt records the
bounded effective condition and limitation without copying secret values.

## Temporal Modalities

### Precondition

A precondition must pass against the exact product base before admission and
against the sealed Candidate at final proof. Baseline failure prevents
admission. Final failure is correctable or material according to the active
Work Boundary.

### Repair target

A repair target identifies a known defect that Delivery is admitted to correct.
It MAY fail at baseline, but the baseline Receipt still establishes the exact
failing proposition. It MUST pass at final proof.

An unexpected baseline pass does not manufacture work. Preparation determines
whether the objective is already satisfied, the Check is inadequate, or a
different proposition remains.

### Regression guard

A regression guard protects an existing required property. It must pass at
baseline and final proof. A baseline failure prevents admission unless the
Founder-visible Work Boundary classifies that exact defect as a repair target.

### Postcondition

A postcondition is meaningful only after the Candidate exists. It is
`not-run` at baseline for the exact modality reason and must pass at final
proof.

### Diagnostic

A diagnostic is observed at its declared phase but does not independently gate
admission or acceptance. Its state remains visible and it cannot be the sole
support for a required proposition.

## Exact Proof Subjects

Every Check Receipt has exactly one Control relationship that selects its proof
subject:

- a baseline Receipt has one `checks-boundary` relationship to the exact Work
  Boundary revision and no `checks-seal`; and
- a final Receipt has one `checks-seal` relationship to the exact Candidate
  Seal and no `checks-boundary`.

The selected Work Boundary or Candidate Seal relationship supplies the exact
Control identity, revision, and logical digest. The Check Receipt payload MUST
NOT restate those values. It supplies the proof-request facts not owned by that
relationship: Check selection, Definition and Binding coordinates, phase,
modality, environment, time, runner, and result.

The runtime resolves the related Control revision and derives the complete
proof subject, including target and Delivery identities, repository and
Knowledge basis, Candidate state, Check Definition and Binding digests,
environment identity, and proof-request digest. A caller-supplied subject,
cached display, path, latest-row lookup, provider claim, or similar digest
cannot substitute for this join.

For a final Receipt, that repository and Knowledge basis is the active
Boundary's admitted historical snapshot. Its Atlas State, Resolution,
normalized model, Resource bindings, and source bytes MUST reproduce there and
MUST NOT be replaced by a live Atlas selection. Before execution, the runtime
also proves that the canonical branch still names the exact admitted commit and
that the authoritative target checkout is completely clean. Any movement is a
branch-lease violation and the Check does not run.

Baseline Receipts are retained after truthful execution even when a required
baseline fails. A Work Boundary becomes proposal-ready only when the reducer
resolves that Boundary's exact selections and observes the complete legal
baseline Receipt set. A missing execution is absence, not a manufactured
placeholder Receipt.

A Receipt for another Boundary, Seal, Definition, Binding, environment, or
request is not reusable unless the declared reuse rules prove exact
equivalence.

## Proof Environment

Final proof operates outside builder write authority. The environment MUST:

- materialize the exact sealed Candidate Revision Carrier read-only in one
  fresh Check Cell;
- keep canonical Git state, Control, Founder authority material, and unrelated
  target locators out of runtime-supplied Check input;
- prevent Candidate mutation;
- isolate or deterministically identify caches and temporary state;
- bind the exact Backend Profile, Image, cell-side runner, Input Set, network,
  product-credential classes, locale, clock assumptions, and relevant toolchain
  versions;
- withhold Docker control sockets, target mounts, Backend credentials, and
  general Runtime-private roots;
- establish Execution Containment before retrieving output or classifying a
  semantic disposition;
- bound output and generated files; and
- retire the exact execution and durably hand any remaining allocation to
  Reclamation before retaining the Receipt.

The Check Receipt distinguishes conditions the runtime directly enforced from
Backend or Founder-managed host assumptions. General host filesystem access,
transitive tool behavior, network isolation, and daemon isolation MUST NOT be
claimed as enforced merely because Docker or a disposable Cell was used. A
required condition the selected Backend Profile cannot establish produces
`unsupported`, not a limited `pass`.

The fixed cell-side runner protects its exact environment contract from Binding
replacement. Other explicit Binding values remain requested conditions: the
Receipt records their public names and binds secret values into environment
identity without disclosing them or treating them as general isolation.

A Binding requiring a mutable environment can write only outside the read-only
Candidate materialization into bounded Output Carrier paths. The runtime
revalidates the sealed Carrier and materialized subject after Containment.
Observed mutation or an output path outside the policy makes the Receipt
`operational-error` and invalidates the evaluation coordinate.

## Candidate Seal

Sealing selects the exact current Candidate Revision for evaluation. The
Revision and Carrier are already immutable, so sealing requires no mutable
worktree freeze. It does not create another Candidate, accept product bytes, or
change Candidate identity. Working and sealed are conditions of the same
reversible noncanonical Candidate.

Before retaining a Seal, the runtime:

1. obtains the operation lock and proves no unresolved Candidate successor
   publication can advance currentness;
2. resolves the exact active Work Boundary and Candidate Revision;
3. opens the exact Carrier manifest and complete Git object closure and verifies
   their content-addressed identity and reachability;
4. deterministically materializes and reobserves the complete Candidate tree,
   diff, paths, modes, and repository features and verifies that observation
   equals the selected Candidate Revision;
5. verifies that no ignored or untracked product input remains outside the
   Candidate Revision;
6. verifies Control Store bytes are excluded from Candidate and Product State;
7. reproduces Candidate, Product State, Knowledge Set, diff, path inventory,
   artifact-set, and Description-coverage digests owned by that Revision; and
8. establishes the exact read-only evaluation Input Set from the Carrier.

The `candidate-seal` revision has exactly one `seals` relationship to the
Candidate Revision and one `governed-by` relationship to the active Work
Boundary. Its typed payload owns only Seal-specific facts:

- the selected Seal profile;
- Carrier integrity, reconstruction, and evaluation-subject dispositions;
- Candidate reobservation and exact-match dispositions;
- untracked-product and Control-exclusion dispositions;
- sealer implementation identity and digest; and
- bounded limitations.

Candidate tree, diff, product-state, Knowledge-set, and artifact facts remain
owned by the related Candidate Revision and are not copied into the Seal. The
Seal semantic Markdown presents the runtime observation and limitations; it
cannot supply a fact or acceptance judgment.

The `candidate-sealed` event finalizes the Seal. Its payload contains only the
event-owned activity coordination needed by Delivery. It MUST NOT repeat the
Candidate identity, Work Boundary identity, Seal disposition, state digest, or
readiness. The reducer resolves those facts from the exact Seal revision and
relationships.

Any later Candidate Revision or active Work Boundary change makes the prior
Seal noncurrent and makes its dependent final Evidence unusable. The historical
Seal remains immutable. Returning from failed evaluation makes the same
Candidate working again; another evaluation produces a new Seal unless the
runtime proves the exact same current Candidate Revision under the same active
Boundary remains selected.

## Check Receipt

A Check Receipt is one immutable `runtime-observed` Control revision. Its typed
payload owns exactly the operational proof facts needed to validate and reduce
the result:

- Check Receipt payload profile;
- boundary-local Check selection identity;
- exact Check Definition identity, revision, source digest, and semantic
  digest;
- exact Binding identity, digest, and implementation digest;
- phase, exactly `baseline` or `final`, and the selected modality;
- proof-request digest;
- exact Execution Specification, Input Set, Backend Profile, Image, cell-side
  runner, and terminal Observation identities and digests when a Cell was
  allocated;
- Output Carrier availability, exact byte length and digest, and exact Output
  Manifest digest only when complete output was retrieved;
- start and finish times;
- environment identity and the requested, runtime-enforced, and
  Founder-managed condition sets;
- disposition, exactly `pass`, `fail`, `indeterminate`, `not-run`,
  `unsupported`, or `operational-error`;
- normalized bounded result facts;
- a public reason code plus either the exact `baseline-postcondition` or
  upstream-condition authorization for `not-run`, or the typed stage, code,
  and facts digest for `operational-error`; semantic dispositions carry none
  of those failure fields;
- exit, signal, timeout, parser, and terminal facts when applicable;
- referenced raw-material descriptors by content digest, byte count, media
  type, purpose, and availability, without a physical locator;
- subject-integrity, Execution Containment, and Runtime Retirement facts;
- runner and parser implementation identities and digests; and
- inherited and observed limitations.

The related Work Boundary or Seal owns the exact proof subject. The Check
Definition owns proposition semantics. The Binding owns requested mechanism
configuration. The Receipt references and authenticates those inputs; it does
not copy their complete values.

Raw stdout and stderr identity is calculated over exact captured bytes before
decoding. Bounded retained bytes use the adjacent-file contract in
[Control](CONTROL.md#adjacent-referenced-files). A Receipt never embeds raw
bytes, credentials, secret environment values, or physical paths.

A semantic `pass`, `fail`, or `indeterminate` requires Execution Containment,
Runtime Retirement, protected runner environment values, and an unchanged
proof subject. A process signal, timeout outside declared semantic mapping,
Containment failure, subject mutation, invalid Output Manifest, or parser
failure produces `operational-error`. Pending physical Reclamation does not
change a valid semantic disposition.

Every allocated Cell MUST be contained and retired before its Receipt is
retained, including an `unsupported` or `operational-error` result. A `not-run`
or `unsupported` result established before allocation uses `not-required`
Containment and Retirement facts and cannot carry execution digests. The
Receipt never exposes the private Handle, allocation key, container identifier,
daemon endpoint, materialization path, or Reclamation coordinate.

Output availability is explicit. `retrieved` requires the exact Carrier byte
length and digest plus the exact Manifest digest, and those values must equal
the terminal Observation. `not-produced` or `unavailable` carries no invented
Carrier or Manifest digest and cannot be represented by empty output. Partial
retrieval is `unavailable`; completely retrieved but invalid output remains
`retrieved` and causes the applicable `operational-error`. A Receipt never
implies that output existed merely because a Cell was allocated or reached a
terminal outcome.

`operational-error` means the mechanism did not establish the proposition.
`unsupported` means required capability, condition, or adapter support was
unavailable. Neither is a product `fail` unless the Check Definition owns that
meaning. Both block a required pass. `indeterminate` cannot be coerced to pass.
`not-run` is legal only when modality and phase permit it or an exact upstream
condition prevented execution.

The typed `notRunAuthorization` preserves that distinction. A baseline
postcondition derives the fixed `baseline-postcondition` authorization from
the selected phase and modality. Any other `not-run` outcome names one exact
upstream-condition identity and digest observed by the runtime. Generic result
text, an absent process, or a caller-selected disposition cannot substitute for
that authorization. `unsupported` carries a public reason code but no not-run
authorization. `operational-error` carries a public reason code and one typed
failure stage, code, and facts digest; no other disposition may carry those
failure facts.

The runtime authenticates the Receipt by controlling or verifying exact request
construction, Binding resolution, proof-subject materialization, capability,
environment construction, one-time dispatch, terminal observation,
Containment, Output Manifest and raw-byte validation, parser, post-execution
subject identity, Retirement, payload compilation, and retention. A builder can
run the same command for feedback, but its output is not a Check Receipt.

A third-party evidence system MAY issue an equivalent outcome only through a
pinned adapter that verifies the same exact subject, mechanism, authority,
freshness, output, Containment, and Retirement contract. A URL, badge, or caller
assertion alone is not a Receipt.

The `check-receipt-recorded` event finalizes the Receipt. The event payload MUST
NOT carry phase, Check identity, proof-subject digest, disposition, result, or
freshness. The reducer resolves the exact Receipt revision, its subject
relationship, and its typed payload.

## Fuzz and Property Checks

A fuzz or property Check states the property, not only the tool. Where
applicable it identifies:

- exact input boundary and harness subject;
- admissible input domain;
- safety, liveness, resource, or semantic property;
- oracle or failure signal;
- seed, corpus, dictionary, and minimization semantics;
- minimum campaign requirement;
- sanitizer, runtime, platform, and resource limits;
- crash and timeout treatment;
- reproducibility Evidence; and
- the limits of one passing campaign.

A zero exit without the required campaign is not a passing Receipt. The exact
result parser and post-execution validation establish the required campaign
facts, and the reviewer judges whether the harness reaches the admitted
boundary.

## Artifact and Description Evidence

For every required artifact, final Evidence establishes:

- exact path and file kind;
- required existence or absence;
- changed or byte-identical disposition;
- content digest;
- applicable schema and semantic validation;
- governing Description, where applicable;
- linked obligation identities; and
- prohibited or unexpected sibling changes.

`mustChange: true` requires a final base-to-Candidate content or metadata
difference. Touching and restoring a file does not satisfy it.
`mustChange: false` does not universally prohibit change; the Work Boundary
must own any required change relationship.

Description coverage evaluates the Candidate tree, not only the admitted
Knowledge Set. It identifies the one current primary Description and selector
for each governed implementation artifact and reports:

- missing or ambiguous coverage;
- a deleted Description whose implementation remains;
- implementation outside governed roots;
- a new or widened exclusion;
- changed implementation with byte-identical Description; and
- changed Description with byte-identical implementation.

The last two are review facts, not automatic failures. The artifact and
coverage facts are entries in the Evidence Packet ledgers, not separate Control
records.

## Independent Review

Independent review judges every acceptance proposition against the exact sealed
Candidate and authenticated Evidence.

### Independence profile

The standard profile requires:

- one fresh Agent Attempt with role `reviewer`;
- no Candidate write capability;
- no Founder secret or transition authority;
- no builder provider-session continuation, hidden transcript, or private
  reasoning;
- the exact reviewer Projection compiled from the active Work Boundary,
  Candidate Revision, Candidate Seal, Check Receipts, and authority basis;
- builder summary presented only as a labeled claim;
- the complete proposition and Evidence identities; and
- one governed judgment entry for every proposition.

The reviewer MAY use the same provider or model family as the builder. A
stronger independence policy can require a different provider, model,
implementation, or human reviewer and must be selected by the Work Boundary or
repository policy. Provider difference alone does not establish independence
when hidden state or write surfaces are shared.

The reviewer `agent-work-product` has exactly one `result-of` relationship to
its reviewer Agent Attempt. The successful reviewer `execution-receipt` has one
`observes-attempt` relationship to the same Attempt and one
`observes-work-product` relationship to that Work Product. The Packet validator
also verifies that the Attempt's exact role subject binds its related active
Work Boundary, Candidate Revision, and Candidate Seal under
[Agent Attempts](ATTEMPTS.md).

The reviewer Work Product payload owns agent-proposed judgment semantics:

- one unique entry for every boundary proposition;
- disposition, exactly `accepted`, `rejected`, `indeterminate`, or legal
  `not-applicable`;
- exact citation-registry identifiers and inspected subject identifiers;
- rationale-fragment and uncertainty-fragment digests into the submitted
  semantic Markdown;
- discovered mandate excess or missing obligation;
- exactly one typed Material Condition proposal when the complete review has a
  material finding; and
- an overall readable summary that cannot override individual entries.

It MUST NOT contain an aggregate acceptance, completeness, or readiness bit.
The runtime validates coverage and citations but does not relabel the judgments
as runtime-observed. Material or unknown uncertainty cannot compile as an
accepted judgment.

`accepted` means the reviewer judges that exact Evidence supports one exact
proposition within declared limits. `rejected` identifies contradicting or
insufficient facts. `indeterminate` identifies missing, conflicting, stale, or
insufficient Evidence. `not-applicable` is legal only when the proposition
defines the exact condition and the reviewer cites it.

The runtime validates exactly one judgment per proposition, no unknown or
duplicate proposition, exact citations, legal dispositions, all effects and
risks, every required obligation, visible uncertainty, and absence of an
aggregate contradiction. A reviewer cannot waive a Check, rewrite the Work
Boundary, create a successor obligation, repair the Candidate, or convert a
missing requirement into an optional opportunity.

When admitted and sealed bases expose different bytes for one Knowledge
identity, the unqualified identity is ambiguous. The reviewer cites the exact
basis-qualified Projection item and source digest. A runtime can retain an
unqualified alias only when it resolves to one exact digest in that Projection.

## Evidence Packet

An Evidence Packet is one immutable `runtime-derived` Control revision for one
complete evaluation. It has exactly these relationships:

- one `governed-by` to the active Work Boundary;
- one `evaluates` to the exact Candidate Revision;
- one `uses-seal` to the Candidate Seal;
- one `uses-check` to every Check Receipt named by any Packet ledger;
- one `uses-review` to the reviewer Work Product; and
- one `uses-review-receipt` to its Execution Receipt.

The runtime resolves every relationship in the same Control Record Store and
validates the complete join. The Seal must select the related Candidate Revision
and Boundary. Every final Receipt must check that Seal. Every baseline Receipt
must check that Boundary. The reviewer Work Product and Execution Receipt must
join through the same reviewer Attempt and exact evaluation subject.

The Work Boundary owns the repository and Knowledge authority basis admitted
for the mandate. The Candidate Revision owns the immutable Candidate base and
derived result state. Those bases can differ, including after readmission. The
Packet validator traverses and preserves both exact identities; it MUST NOT
collapse them or require their Product State or Knowledge Set digests to match.
Every Atlas-dependent input in the Seal, final Checks, reviewer Projection, and
Packet resolves from the active Boundary's historical admitted Atlas snapshot.
A canonical or authoritative-worktree change during the lease is an operational
violation that blocks active routes. It does not silently replace the historical
Atlas dependency or create a different Evidence subject; exact restoration or
no-ship is required.

The Packet payload owns:

- the selected Evidence Packet profile and validator rule set;
- evaluation time;
- one artifact ledger;
- one Description-coverage ledger;
- one Receipt-use and freshness ledger;
- one Evidence-invalidation ledger;
- one reviewer-independence ledger;
- one proposition-decision ledger;
- one obligation-state ledger;
- unresolved diagnostics and uncertainty;
- validator implementation identities and digests; and
- readiness, exactly `acceptance-ready`, `correctable`,
  `revision-required`, or `no-ship-recommended`.

The Packet semantic Markdown explains the derived disposition and unresolved
uncertainty. It does not restate the complete ledgers and cannot change
readiness.

Every Packet ledger is a bounded typed collection with one stable local item
identity, explicit provenance, deterministic order, and exact citations. A
ledger cites a Check Receipt or reviewer Work Product by its record identity;
that identity MUST resolve to exactly one corresponding Packet relationship.
The relationship supplies revision and logical digest, so the ledger MUST NOT
repeat them. Boundary-local obligation, proposition, artifact, and Check
identities resolve only through the exact related Work Boundary and Candidate
Revision.

### Artifact ledger

The artifact ledger records required and unexpected artifacts, exact paths,
file kinds, existence or absence, base-to-Candidate disposition, content or
manifest digests, schema and semantic validation, owning obligations,
limitations, and `satisfied`, `failed`, `indeterminate`, or `not-applicable`
state.

### Description-coverage ledger

The Description-coverage ledger records each governed implementation subject,
its exact primary Description and selector, missing or ambiguous ownership,
changed-side relationships, exclusion changes, owning obligations, and state.

### Receipt-use and freshness ledger

The Receipt ledger contains one entry for every selected Check and phase. It
names the related Check Receipt when present, its use as `executed`, `reused`,
or `excluded`, its derived freshness and subject-equivalence disposition, its
age and applicable maximum age when temporal reuse applies, and the exact
reason.

A reused Receipt must match the Check Definition and Binding coordinates,
subject facts, environment class, implementation policy, freshness contract,
and unaffected dependency set. Candidate or Product State equivalence requires
the Check's declared validator-proven equivalence. A baseline Receipt is not a
final Receipt unless the Check Definition and Work Boundary explicitly permit
unchanged-subject reuse and the Packet proves it.

Temporal reuse calculates nonnegative age from the Receipt finish time and
Packet evaluation time. Reuse is invalid when the Receipt finishes after the
evaluation time or its age exceeds the applicable maximum.

### Evidence-invalidation ledger

The invalidation ledger decides whether each related Seal, Receipt, or reviewer
input is current for this Packet. It records the dependency class, current
input identity, exact cause identifiers, `current` or `invalidated` state, and
reason. It does not mutate or annotate an earlier record.

A later Candidate Revision, active Work Boundary, Check Definition, Binding,
admitted Knowledge basis, environment, or reviewer subject invalidates every
dependent item whose declared equivalence is not preserved. Control-only motion
that does not change an Evidence dependency does not invalidate product
Evidence. A canonical branch or authoritative-worktree lease violation blocks
productive operations; it does not silently replace an Evidence dependency or
create a new subject. A provider restart alone does not invalidate a runtime-
authenticated Receipt.

Historical Seal and Packet currentness is independently derived from the event
fold. The current Packet does not need a relationship to every historical
Packet merely to restate that they are noncurrent.

### Reviewer-independence ledger

The independence ledger records each selected independence rule, the exact
Attempt, Work Product, Receipt, capability, Projection, provider-session, and
subject facts used to evaluate it, and `satisfied`, `failed`, or
`indeterminate` state. Exact Control coordinates come from Packet relationship
closure rather than caller assertions.

### Proposition-decision ledger

The proposition ledger contains one entry for every Work Boundary proposition.
It preserves the reviewer's disposition, exact Work Product fragment digest,
citations, inspected subjects, limitations, uncertainty, and
`agent-proposed` provenance. It separately records the runtime-derived
validation result. Compilation into a runtime-derived Packet does not turn a
reviewer judgment into a runtime observation.

### Obligation-state ledger

The obligation ledger contains one entry for every Work Boundary obligation.
Allowed states are:

- `satisfied`;
- `failed`;
- `indeterminate`;
- `missing`;
- `not-applicable` only when explicitly conditional or diagnostic;
- `stale`; and
- `unsupported`.

Each entry cites its source obligation, applicable Check selections, Receipts,
proposition decisions, artifact or diff facts, and exact reason. Every required
obligation must be `satisfied` for acceptance readiness. A score, majority, or
several lower-risk passes cannot offset one unsatisfied required obligation.

### Packet finalization and Process reduction

The runtime derives every ledger and readiness value from exact retained
records, the active Boundary's admitted historical repository snapshot, and the
exact Candidate observation, validates the complete Packet, then atomically
finalizes it with `evidence-packet-finalized`.

That event payload contains only event-owned activity coordination. It MUST NOT
repeat readiness, Seal or Candidate digest, Check outcome, proposition result,
or obligation state. The Delivery reducer resolves the exact Packet revision
and relationships, reads its typed readiness, and rejects any mismatch with the
current Process subjects.

A Packet is immutable. Any changed bound fact requires a new applicable Seal,
Receipt, review, or Packet. No caller, agent, interface, or event can patch a
ledger or restate readiness after finalization.

## Acceptance Readiness

The Packet is `acceptance-ready` only when:

- its complete structure and relationship closure validate;
- its Boundary, Candidate Revision, and Seal are exact and current;
- the complete required baseline and final Check sets are present;
- every baseline disposition is legal for its modality;
- every required final Check passes or has valid exact reuse;
- every required obligation is `satisfied`;
- every proposition is `accepted` or legally `not-applicable`;
- no stale, unsupported, missing, failed, or indeterminate required Evidence
  remains;
- reviewer independence is satisfied;
- no mandate excess or unresolved Material Condition remains;
- Candidate and repository observations still match the evaluation subject;
  and
- every selected schema, validator, runner, and rule-set revision is supported.

`correctable` means the exact failures can be repaired under the active Work
Boundary. `revision-required` means honest correction would change product
meaning, exclusions, effects, risk, architecture, Assurance, capability, or a
Founder-owned tradeoff. `no-ship-recommended` means the runtime can derive no
legal acceptance or correction route from the retained facts. It remains a
recommendation, never a no-ship decision.

A non-ready Packet remains useful correction or disposition information, but
it MUST NOT be presented as an acceptance subject.

## Correctable Evidence Failure

Evidence failure stays local when the active Work Boundary already authorizes
the repair. Examples include:

- a final Check failure;
- a missing required test artifact;
- an inadequate fuzz harness;
- Description coverage failure;
- a rejected proposition caused by an implementation defect;
- a prohibited Candidate path that can be removed; or
- a stale Receipt that can be rerun under existing capability.

Delivery returns exact failed obligations and findings through a later builder
Projection. It preserves the same Candidate and every unaffected exact Evidence
input. One failed evaluation does not create another development object.

A failure is material when correction would exceed the admitted mandate. The
reviewer supplies the typed condition semantics, and the runtime freezes a
Material Condition only after validating the exact retained review, Receipt,
Seal, Candidate, Boundary, admitted references, and installed rule. Delivery
then follows
revise/reaffirm/readmit or no-ship. A reviewer recommendation cannot freeze that
condition by itself.

## Founder Decision and Terminal Disposition

Evidence readiness is not canonical Product State. Acceptance requires a fresh
`founder-decision` with the `accept` variant and exact relationships selecting
the current Candidate Revision, Candidate Seal, and acceptance-ready Evidence
Packet. The runtime constructs the canonical authority subject from those
resolved revisions. The Founder authenticates that subject; authentication
does not claim the transaction completed. The subject authorizes the exact
sealed Candidate tree over the exact admitted parent; it authorizes no alternate
parent, Atlas selection, merge, rebase, or composition.

The exact terminal relationship matrix is:

<!-- markdownlint-disable MD013 -->

| Variant and current subject | Founder Decision relationships | Closure relationships |
| --- | --- | --- |
| `accept`; active Boundary, Candidate, current Seal, ready Packet | one `selects-boundary`, one `selects-candidate`, one `selects-seal`, one `selects-evidence`; no `resolves` | one `closes-with`, one `governed-by`, one `accepts-candidate`, one `accepts-evidence`; no `abandons-candidate` |
| `no-ship`; no current proposed or active Boundary and no Candidate | no selection or resolution relationship | one `closes-with`; no Boundary, Candidate, or Evidence relationship |
| `no-ship`; current proposed Boundary awaiting admission, no Candidate | one `selects-boundary`; no Candidate, Seal, Evidence, or resolution relationship | one `closes-with` and one `governed-by`; no Candidate or Evidence relationship |
| `no-ship`; active Boundary and Candidate | one `selects-boundary` and one `selects-candidate`; no Seal, Evidence, or resolution relationship | one `closes-with`, one `governed-by`, and one `abandons-candidate`; no acceptance relationship |

<!-- markdownlint-enable MD013 -->

The no-Boundary form is legal only when reduction selects no current proposed
or active Boundary and proves that no Candidate was initialized. When a
proposed or active Boundary is current, both the Decision and Closure MUST bind
that exact revision. When a Candidate exists, the no-ship Decision and Closure
MUST bind that exact current Candidate Revision and the Decision payload MUST
select its legal disposition. A caller cannot choose the sparser variant.

The acceptance transaction revalidates the exact join immediately before
canonical motion. It proves that the Candidate has no Atlas delta, the
canonical branch still names the exact admitted parent, and the authoritative
checkout is completely clean. It then applies the exact sealed Candidate tree
over that parent. Its terminal `closure` has `closes-with`, `governed-by`,
`accepts-candidate`, and `accepts-evidence` relationships under
[Control](CONTROL.md#relationship-registry) and separately binds the Candidate
tree, digest, Product State, and Knowledge Set digests; the exact admitted
parent; and the accepted commit, tree, and generic canonical result digest.
Candidate identities remain the Evidence subject. Transaction observation, not
Packet readiness or Founder intent alone, establishes the accepted result.

Any canonical or authoritative-worktree movement makes acceptance
`not-applied`. The same Decision, transaction plan, intent, and effect digest
cannot be reinterpreted against a newer parent. Recovery may only recognize or
complete the same exact retained effect; no-ship remains available.

A no-ship Founder Decision does not require a passing Packet and cannot turn
failed Evidence into passing Evidence. Its exact relationship set depends on
the latest subject Delivery actually established:

- after preparation ended without a Work Boundary, it selects no Boundary,
  Candidate, Seal, or Packet;
- while one proposal awaits admission, it selects that Work Boundary but no
  Candidate, Seal, or Packet; and
- after admission, it selects the active Work Boundary and current Candidate,
  but it does not require a Seal or Packet.

Candidate disposition is required only when a Candidate exists. The matching
no-ship Closure always has `closes-with`; it has `governed-by` when a Work
Boundary exists and `abandons-candidate` when a Candidate exists. It never has
`accepts-candidate` or `accepts-evidence`. No-ship does not integrate Candidate
bytes or claim that its Carrier was physically erased.

Terminal Closure makes Process standing `closed`. Successful Control Store
sealing and archive verification complete the separate physical disposition;
until then the closed Process exposes exact Store-disposition recovery without
changing its terminal Candidate condition. Historical Evidence remains
inspectable in the sealed archive; neither acceptance nor no-ship promotes it
onto HEAD.

After authentication, the runtime retains transaction-effect intent and then a
truthful applied, not-applied, or indeterminate effect observation. Only an
applied terminal effect followed by complete Execution Containment, Runtime
Retirement, and Reclamation-handoff facts can compile Closure. Completed
Reclamation is not required. `closure-recorded` atomically finalizes that
record, completes the terminal activity, and is the final Journal head. No
later `activity-completed` event is legal. A not-applied or indeterminate effect
requires exact transaction recovery and cannot produce Closure or permit Store
sealing.

## Evidence Storage and Disclosure

The Control Record Store retains complete typed Evidence facts and readable
semantic Markdown. Bounded larger operational bytes, such as raw Check output,
may sit beside the database only through the content-addressed adjacent-file
contract. There is no separate Evidence-component directory or blob service.

Evidence MUST NOT retain provider transcripts, model reasoning, credentials,
secret environment values, authority material, Candidate materialization
paths, Handles, backend coordinates, mutable URLs, or physical runtime paths. A
retained raw-material descriptor states digest,
media type, byte count, purpose, availability, and disclosure limit. It never
grants authority merely because matching bytes exist.

When a proposition requires durable inspectable content, the Binding produces
a bounded normalized proof artifact and the Receipt records its exact
descriptor. Redaction cannot remove a fact needed to support the proposition.
If safe required material cannot be retained, the result is indeterminate or a
different Binding is required.

Runtime inspection and Markdown export can render the exact Evidence records
and ledgers. An export is not a retained duplicate, runtime input, import
format, or semantic identity.

## Evidence Diagnostics

Evidence reserves these standard diagnostic families:

- `lifecycle.evidence.binding.*`;
- `lifecycle.evidence.subject.*`;
- `lifecycle.evidence.environment.*`;
- `lifecycle.evidence.receipt.*`;
- `lifecycle.evidence.seal.*`;
- `lifecycle.evidence.artifact.*`;
- `lifecycle.evidence.description.*`;
- `lifecycle.evidence.review.*`;
- `lifecycle.evidence.obligation.*`;
- `lifecycle.evidence.packet.*`;
- `lifecycle.evidence.reuse.*`;
- `lifecycle.evidence.invalidation.*`; and
- `lifecycle.evidence.storage.*`.

[Validation](VALIDATION.md) publishes the required diagnostics and fixture
coverage. A diagnostic reports the exact failed subject and owner. It MUST NOT
repair an Evidence fact, choose a fallback Binding, reinterpret an agent claim,
or manufacture readiness.
