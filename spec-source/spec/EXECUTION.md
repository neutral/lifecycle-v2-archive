# Lifecycle Execution

> Status: Draft

## Purpose

This document owns the Foundation rc.10 execution mechanism beneath Agent
Attempts and Checks. It defines how the Lifecycle Runtime places one exact
operation into one disposable Execution Cell without making that Cell a public
workflow, a second Process, or a source of product meaning.

The execution boundary is:

```text
exact logical subject + immutable inputs + selected image and profile
  -> Execution Specification
  -> one private Execution Cell
  -> one consumed dispatch authority
  -> terminal observation and containment
  -> exact Output Carrier retrieval and independent validation
  -> Runtime-owned Retirement
  -> asynchronous private Reclamation
```

[Agent Attempts](ATTEMPTS.md) owns provider-neutral Agent semantics, Work
Product compilation, and optional Candidate successor promotion.
[Evidence](EVIDENCE.md) owns Check meaning and Receipts. [Delivery](DELIVERY.md)
owns the sole Process and its public operations. [Security](SECURITY.md) owns
the security model and qualification surface. [Control](CONTROL.md) owns
retained logical records, Journal events, operation support, and archive.

## Requirement Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative only when they appear in uppercase. Their meanings
follow BCP 14.

## Foundation rc.10 Hard Cut

Foundation rc.10 selects exactly:

- qualification revision `lifecycle.foundation.1.0.0-rc.10`;
- repository contract `lifecycle.repository.v15`;
- runtime protocol `lifecycle.runtime.foundation.v10`;
- interface protocol `lifecycle.interface.foundation.v10`; and
- provider adapter `lifecycle.provider-adapter.v6`.

The selected Agent provider boundary is the exact
`codex-exec-standard-v6` Descriptor with Codex compatibility
`>=0.151.0 <0.152.0`. The current production Agent Execution Image binds the
exact Codex tool version `0.151.0`. An Image carrying Codex 0.150.x is
unsupported before allocation or dispatch.

Any repository or retained support object selecting an unsupported coordinate
is invalid input. It has no migration, recovery, compatibility, or mixed-
carrier meaning in rc.10.

This hard cut does not add a Control record family, Journal event, Delivery
state, or public operation. Foundation keeps twelve Control record families,
twenty-two Journal event types, and the nine Delivery operations owned by
[Delivery](DELIVERY.md). Delivery remains the only Process.

## Ownership Rule

Execution objects are private Runtime mechanism. They cannot establish:

- Product, Work Boundary, Candidate, Work Product, Check, Evidence, or Founder
  meaning;
- Process standing, operation eligibility, or authority;
- canonical repository motion;
- provider trust merely because a process returned successfully; or
- cleanup completion merely because a backend reports that a Cell stopped.

The Runtime compiles execution objects from already validated logical
subjects, invokes the selected Backend, independently validates every returned
fact, and retains only the stable facts required by the owning Attempt or Check
Receipt and exact recovery.

The execution host is Journal-blind. It may propose and reconcile one exact
private checkpoint replacement, but only the already-selected Activity owner
can commit that replacement through the Activity kernel. When dispatch is an
owner event boundary, as for an Agent Attempt's `provider-effect-intended`, the
owner commits the existing Journal event and dispatch-authority consumption in
one Store transaction before the host invokes the Backend. The host cannot
append a Cell event, choose an owner event, or independently advance Delivery.

A provider adapter does not own the Backend. It translates one Provider
Descriptor and provider event contract inside an Attempt Cell. A Check runner
does not own the Backend either. Candidate, Attempt, and Check retain their
separate domain meaning even when they use the same execution mechanism.

## Standard Terms

### Execution Backend

An **Execution Backend** is one installed Runtime-private adapter that can
allocate, dispatch, observe, cancel, retrieve, and reclaim disposable Cells
under one selected Profile. Its implementation is not a public protocol and is
not selected by an Agent, Check, repository file, or interface caller.

### Execution Backend Profile

An **Execution Backend Profile** is the exact installed contract for one
Backend configuration. It binds:

- backend kind and implementation identity;
- supported platform and isolation mechanism;
- allocation, observation, cancellation, retrieval, and Reclamation
  guarantees;
- image-selection and Input Set transfer rules;
- resource and time limits;
- provider control-plane and Agent product-network policy;
- credential injection and non-disclosure guarantees;
- Output Carrier and Output Manifest limits; and
- the operated qualification claims that the configuration can truthfully
  make.

The profile is separate from a Provider Descriptor. A Provider Descriptor says
how to invoke and observe a provider. The Execution Backend Profile says where
and under what enforcement that invocation or Check runs.

The profile identity is
`lifecycle.execution-backend-profile.docker-local.v1` for the first production
profile and `lifecycle.execution-backend-profile.fault-injection.v1` for the
deterministic test-only profile.

### Execution Specification

An **Execution Specification** is one immutable Runtime-derived instruction for
one Agent Attempt or one Check. Its profile is
`lifecycle.execution-specification.v1`. It binds at least:

- one owning Attempt or Check subject;
- exact Execution Backend Profile and implementation identities;
- one exact Execution Input Set digest;
- one exact Execution Image identity and digest;
- role or Check runner identity;
- command and fixed runner contract;
- capability, network, credential, time, process, storage, output, and event
  limits;
- declared Output Carrier and Output Manifest contracts; and
- terminal observation, Containment, Retirement, and Reclamation policies.

The Specification contains no physical path, Execution Handle, backend coordinate,
container identifier, credential, live token, mutable workspace identity, or
materialization fact. Its digest is a canonical-value digest over the complete
no-digest-member value.

### Execution Input Set

An **Execution Input Set** is the exact immutable logical input to one
Specification. Its profile is `lifecycle.execution-input-set.v1`. It binds the
complete ordered content inventory and every exact logical subject required by
the operation.

For a builder, reviewer, or final Check, the Input Set binds the exact Candidate
Revision, Candidate Revision Carrier manifest, and Carrier artifact needed to
materialize the selected Candidate. Reconnaissance has no Candidate. An
executed baseline Check instead binds `phase: baseline`, the exact Work Boundary
proof subject, one product-base subject naming that Boundary's exact commit and
tree, and one deterministic bounded Git object-closure manifest and artifact
sufficient to materialize that tree. Product-base closure bytes are ordinary
immutable operation input. They are not a Candidate Revision, Candidate
Revision Carrier, Candidate continuity, or a source of Candidate truth.

A Check Specification and its Input Set both bind the same exact `baseline` or
`final` phase, Check Definition, Binding, and proof subject. A baseline
postcondition authorized as `not-run` creates no Specification, Input Set,
Backend allocation, or Cell. The Input Set also binds the exact Projection,
Role Brief or Check input, tool and runner inventory, and every applicable
policy digest.

Every Input Set MUST bind exactly one runner subject whose digest equals
`runnerContractDigest`. An Agent owner MUST bind one or more separate policy
subjects. A Check owner MAY bind zero or more separate policy subjects because
its exact Definition and Binding can own every applicable Check policy; any
separate policy subject that is present remains exact and independently
resolved.

For an Agent owner, `ownerSubjectDigest` MUST equal the singleton exact role
subject digest. For a Check owner, it MUST equal the singleton exact
proof-subject digest. No other Input Set subject can substitute for either
owner binding.

`contentInventoryDigest` is `digestCanonical(entries)` over the complete
strictly path-ordered `entries` array. It is the inventory coordinate of this
generic Execution Input Set. An Agent Attempt's upstream provider-content
inventory remains a distinct subject bound through `inputMaterialDigest`; the
two coordinates are not interchangeable.

A **materialization** is the Backend-created physical realization of an Input
Set inside one Cell. It is reconstructible execution material. A
materialization path, filesystem identity, volume, container layer, or cache is
never part of the Specification or Input Set identity and cannot become
Candidate, Evidence, or Control truth.

The primitive Candidate materializer realizes the exact Carrier root tree as
ordinary regular and executable files beneath one pinned empty root. It does
not synthesize a commit or create a `.git` directory. When an owning Attempt or
Check requires Git history or Git CLI behavior, its Input Set MUST bind that
immutable repository context separately. The Cell runner MAY compose a
disposable Git view from the exact admitted history input and Candidate tree,
but a derived repository, index, commit, branch, or cache is mechanism only. It
cannot become Candidate identity, lineage, continuity, output subject, or
Receipt truth.

Materialization verification MUST enumerate physical entries incrementally and
MUST refuse once the enumeration exceeds a bound derived from the complete
declared Carrier paths. It MUST NOT first allocate an unbounded directory
listing. Every observed directory and file remains subject to exact type, mode,
ownership, link, path, and byte validation. An interrupted partial staging tree
is disposable and MUST NOT become a recovery carrier or Candidate standing.

### Execution Image

An **Execution Image** is the exact immutable executable environment selected
for one Specification. Its profile is `lifecycle.execution-image.v1`. Its
identity binds the immutable image content digest, platform, fixed runner
contract, and installed tool inventory needed by the owning operation. A
mutable tag, local image name, latest label, or successful pull cannot replace
that identity.

For the current Foundation Agent path, the tool inventory identifies Codex
`0.151.0` and the Runtime verifies that version against the exact
`codex-exec-standard-v6` range `>=0.151.0 <0.152.0`. Range satisfaction alone
does not select an Image. A different 0.151.x tool requires its own immutable
Image identity, executable digest, inventory digest, and operated evidence
before it can replace the current selection.

### Cell-side runner contract

The fixed runner contract is `lifecycle.execution-cell-runner.v1`. Its exact
identity and digest are selected by the Backend Profile and Execution Image and
bound again by the Specification. The digest covers the runner executable and
support-file inventory, protocol revision, materialization rules, provider or
Check launch contract, event and stream bounds, Output Carrier layout, and
Manifest-finalization rule.

The runner validates the Specification and Input Set digests before productive
start, constructs only the fixed Cell paths, starts the one selected provider
or Check entrypoint, keeps provider control-plane credentials out of Agent tool
processes and output, captures bounded terminal facts, closes every selected
output byte, and writes the Output Manifest last. It cannot allocate another
Cell, choose an Image or capability, promote output, decide Containment or
Retirement, or emit a public Process transition.

### Execution Cell and Handle

An **Execution Cell** is one disposable physical allocation created for one
exact Specification. Foundation allocates one Cell per Agent Attempt or executed
Check, not one Cell per provider message or provider turn. A Check classified
`not-run` or `unsupported` before allocation creates no Cell. Multiple tool
turns inside one Agent Attempt use the same Cell and never become separate
Lifecycle operations.

An **Execution Handle** is an opaque Runtime-private capability returned
by the Backend. It can address only the exact Cell created for one
Specification and allocation key. The Handle, backend locator, container
identifier, daemon reference, and transport details never enter Control,
Receipts, public protocols, logs, diagnostics, CLI output, or interface views.

### Execution Output Carrier and Manifest

An **Execution Output Carrier** is the bounded provisional output retrieved
from a contained Cell. It can contain Candidate output, a semantic workspace,
Check proof output, and bounded operational artifacts under the exact owning
contract. It has no standing merely because it exists or was returned by the
Backend.

An **Execution Output Manifest** is the complete exact inventory of that
Carrier under profile `lifecycle.execution-output-manifest.v1`. The fixed Cell
runner writes it only after every declared output file is closed and stable.
The manifest binds normalized relative path, entry kind, byte length, digest,
mode class, complete entry count, aggregate bytes, Specification digest, Input
Set digest, and Image digest. Unknown, missing, duplicate, aliased, special,
undeclared-mode, oversized, unstable, or post-manifest entries make the Carrier
invalid. Candidate output may preserve a declared repository-valid regular or
executable Git mode; a manifest cannot invent another mode class.

A builder Specification carries Candidate-write capability and declares
exactly one optional `candidate-output` root. The root's `required` member MUST
be `false` because a terminal failure can truthfully produce only terminal
observations and no Candidate output. When any Candidate entry is present, the
root denotes the directory boundary of the complete successor repository tree;
it is not itself a carried file. Every `candidate-output` Manifest entry MUST
therefore begin with the exact `<declared-root>/` prefix, and an entry whose
path equals the root is invalid.
The Runtime strips that prefix exactly once and revalidates the resulting
nonempty normalized repository path. The complete closed set of those mapped
entries is the successor tree, including unchanged files. It is never a patch,
changed-path inventory, deletion list, or delta against the input Revision.

The Runtime retrieves the Carrier only after Containment and independently
validates the complete Manifest, every byte, and every owning semantic
contract. Backend success or a runner-written digest is not validation.

When the direct contained observation reports complete output for a started
Agent Attempt, the Runtime first performs one bounded, non-dispatching
retrieval that opens only the exact declared runner-owned Provider
terminal-observation member. It independently validates that member's bytes
and complete Attempt, Specification, Image, runner, Provider, adapter, and
executable bindings, then durably retains either the resulting opaque private
owner fact or one exact invalid-terminal outcome before strict whole-Carrier
validation. That result grants no Work Product, Candidate, Check, Evidence,
Process, or dispatch standing and does not make any other Carrier member valid.
A deterministic refusal of unrelated authoring or Candidate bytes MUST NOT
erase a retained valid Provider terminal fact. Missing, malformed, or
substituted terminal bytes MUST NOT be inferred from a Backend state, provider
message, or another Carrier member.

If post-Containment retrieval instead establishes authoritative Carrier
unavailability before the terminal member can be observed, the Runtime retains
the ordinary unavailable-output fact without fabricating Provider completion.
Containment, Retirement, and Reclamation handoff still complete; the Agent
Activity cannot produce its Receipt until the required provider fact exists.

The Runtime derives one private final output result distinct from the Backend
Observation:

- `valid` requires complete exact retrieval, successful validation, and
  durable publication of the validated bytes under one immutable,
  content-addressed, locator-free Runtime custody binding;
- `invalid` requires complete exact retrieval followed by one deterministic
  validation refusal;
- `unavailable` records authoritative missing, partial, or irrecoverably lost
  Carrier retrieval; and
- `not-applicable` records a terminal Backend disposition for which no output
  was produced or retrieval was required.

An ambiguous transport result, Backend interruption without authoritative loss
facts, or Runtime staging failure produces no final output result. It remains
an exact recovery obligation. The Runtime MUST NOT normalize partial retrieval
to `invalid`, normalize a transient staging failure to `unavailable`, or infer
any final result from exception text.

Publication of a valid output binding precedes retention of the valid result.
The retained operation support binds the complete closed custody value and its
digest. If the support write is interrupted after publication, an exact retry
reuses the same content-addressed binding and a later bounded collector may
remove an unreferenced orphan. Once the valid result is retained, recovery
MUST reopen the Runtime binding and MUST NOT depend on another Backend
retrieval or continued Cell availability.

### Execution Observation

An **Execution Observation** is one bounded Backend fact under profile
`lifecycle.execution-observation.v1`. Its canonical self-digesting value binds:

- the exact Specification digest, Backend Profile identity, Profile digest,
  Backend implementation digest, Image digest, and Input Set digest;
- observation time and one monotonic observation sequence;
- allocation standing: `absent`, `allocated`, `ambiguous`, or `unavailable`;
- dispatch standing: `not-observed`, `accepted`, `start-observed`,
  `terminal-observed`, or `ambiguous`;
- process standing: `not-observed`, `not-started`, `running`, `terminal`, or
  `ambiguous`;
- a terminal object only for `terminal`, with exact finish time, normalized
  reason, exit, signal, and runner disposition;
- direct Containment inputs for the root process, descendants, writers,
  credentials, provider channel, and output mutability;
- output disposition, exact Manifest digest and Carrier byte length when
  available;
- bounded resource and limit-breach facts; and
- the Observation digest.

The Observation contains no Handle, allocation key, backend coordinate,
container identifier, endpoint, credential, private path, Retirement decision,
or Reclamation coordinate. Before dispatch authority is consumed, direct
same-binding proof that a retained Handle's allocation is absent, no process or
writer exists, no credential or provider channel was granted, output mutation
is impossible, and no output was produced establishes inert no-effect
Containment. It permits final no-output disposition and Retirement of that
Handle, but never allocation recreation or dispatch. `absent` does not
establish `not-started` after dispatch authority is consumed. `ambiguous`,
`unavailable`, or incomplete facts cannot establish Containment and remain
recovery-required. The Runtime, not the Backend, decides whether a sequence of
exact observations establishes terminal outcome and Containment.

## Private Backend Contract

The Backend exposes exactly these conceptual methods to the Runtime:

```text
allocate(specification, allocationKey) -> handle
dispatch(handle)                       -> dispatch observation
observe(handle)                        -> current observation
cancel(handle)                         -> cancellation observation
retrieve(handle)                       -> output carrier
reclaim(handle)                        -> reclamation observation
```

These names define responsibilities, not a public network API or language ABI.
Every method binds the exact installed Backend, Profile, Specification, and
allocation identity. Returned values are untrusted observations until the
Runtime validates their exact shape and bindings.

### Deterministic allocation

Before `allocate`, the Runtime durably retains one unpredictable private
`allocationKey` bound to the exact Specification digest and selected Profile.
The key is not the Execution Handle and grants no dispatch authority.

`allocate(specification, allocationKey)` is deterministic and idempotent:

- the first successful call creates at most one Cell for the exact pair;
- a retry after a lost response returns the same exact Cell and Handle binding;
- before any Handle is retained, authoritative proof that no keyed Cell exists
  can permit creation of that one Cell under the same retained key;
- an existing Cell for another Specification, more than one possible Cell,
  key reuse, or an ambiguous backend observation fails closed; and
- the Runtime never chooses the newest or most plausible Cell.

Allocation alone cannot start productive execution. The allocation key and
Handle remain Runtime-private operation support and are removed from active
support only after Retirement no longer needs them. Once the exact Handle has
been durably retained, direct proof that its Cell is absent ends that physical
allocation. The Runtime MUST NOT recreate or substitute a Cell under the key,
replace the Handle, or dispatch a replacement inside the same Attempt or Check.
If dispatch authority remains unconsumed, complete direct absence facts permit
no-effect finalization and Retirement. Otherwise the absence remains subject to
the post-dispatch recovery rule below.

### One-time dispatch

Dispatch is the one-time external-effect boundary. Before calling
`dispatch(handle)`, the Runtime durably consumes the exact dispatch authority
and records the owning effect-intent milestone under its Activity transaction.

After that consumption, the Runtime MUST NOT call `dispatch` again for that
Specification, allocation key, Handle, Attempt, or Check. A lost dispatch
response, Runtime crash, backend restart, missing Handle, or ambiguous process
state permits only exact observation, cancellation, retrieval when safe,
Retirement, or recovery-required refusal. It never permits redispatch.

If the Runtime is interrupted after durable authority consumption but before
Backend method entry, only a direct observation of the same exact allocated
Cell as `not-observed`, `not-started`, and completely contained can establish
that no Backend effect began. That fact permits final output disposition and
Retirement, but it does not restore dispatch authority. A missing response,
absent Cell, elapsed time, or inferred lack of output cannot substitute for
that complete direct observation.

### Observation and cancellation

`observe` returns normalized bounded facts about allocation, start, liveness,
terminal state, exit, signal, limits, timing, and runner disposition. It cannot
declare semantic submission, Candidate validity, Check outcome, Evidence, or
Process standing.

`cancel` is monotonic containment action, not a second dispatch or a requested
provider conclusion. A retry applies to the same Cell. The Runtime observes
until it proves the complete Cell process boundary terminal or reports exact
recovery-required state. A timeout or parent loss cannot be normalized into
`not-started`.

### Retrieval and reclamation

`retrieve` is permitted only after the Runtime proves Execution Containment.
It returns either the exact bounded Output Carrier for independent validation
or one typed authoritative missing, partial, or lost result. A transient
Backend failure remains retryable recovery and is not a terminal result. A
partial or missing Carrier is an exact unavailable disposition, not permission
to reopen the Cell or dispatch replacement work inside the same Attempt or
Check.

`reclaim` is permitted only after Runtime-owned Retirement. It removes
quarantined physical execution material and reports direct absence or an exact
remaining obligation. It cannot change any Receipt, Candidate Revision,
Evidence fact, Process state, or terminal decision.

## Containment, Retirement, and Reclamation

The three terminal concepts are intentionally distinct.

**Execution Containment** proves synchronously that the Cell can no longer
execute, mutate output, use injected credentials, reach an allowed provider
channel, or produce another backend effect. Terminal process exit alone is
insufficient when descendants, helpers, mounts, or live capabilities can
remain.

**Execution Retirement** is the synchronous Runtime-owned transition that:

1. binds the final direct Backend observation;
2. proves Containment;
3. retrieves and independently validates any available Output Carrier;
4. revokes every Cell capability and credential;
5. removes the Cell from every active Runtime namespace;
6. makes the allocation and dispatch authority permanently non-reusable; and
7. durably records the exact terminal and outstanding Reclamation facts.

Retirement, not physical deletion, is the completion precondition for the
owning Attempt or Check. A Backend cannot self-certify Retirement merely by
removing its container.

**Execution Reclamation** is the asynchronous Runtime-private removal of
already retired physical material. It runs from one bounded durable obligation
ledger, is idempotent, validates the exact retired identity before action, and
reports `reclaimed`, `remaining`, or `integrity-refusal`. A failed deletion
leaves inert, non-dispatchable material and a visible operational obligation;
it does not reopen the Delivery Activity or prevent truthful Closure.

Current Reclamation state does not enter the Journal, a Control record, a
Receipt, an Attempt View, Delivery standing, eligible operations, or an
authority subject. Closure may bind the immutable fact that Retirement handed
one exact obligation set to the private ledger; later ledger progress never
rewrites Closure.
The first production profile MUST enforce one implementation-fixed private
ceiling on outstanding non-reclaimed obligations and MUST refuse a new
allocation with an ordinary Runtime-availability diagnostic when that ceiling
is reached. It retries exact obligations with bounded backoff and refuses
unsafe identity substitution. Configurable age, byte, capacity, or operator
policy is outside rc.10. The Runtime MUST NOT claim secure erasure merely from
filesystem unlink or container removal.

## Candidate Boundary

A Candidate Revision is immutable logical proposal state. Its Candidate
Revision Carrier consists of the exact content-addressed Git object closure and
manifest that can deterministically materialize that revision. The manifest is
retained as a digest-bound adjacent Control file with fixed media type
`application/vnd.lifecycle.candidate-revision-carrier-manifest+json`; the Git
object closure lives only in the Carrier Store while one live or retained
archived Store references it. The Carrier, not a live working directory, is the
durable physical representation of Candidate truth.

A builder Specification consumes one exact input Candidate Revision and
Carrier. The Backend materializes them into the Cell. The Cell cannot mutate
the input Revision or Carrier. It produces only a provisional Output Carrier.

The builder's one optional `candidate-output` root, when populated, contains
one complete successor repository tree under the exact path mapping defined by
the Output Manifest contract. Candidate compilation consumes that closed
mapped tree as a whole. It MUST NOT apply the output as edits over the
predecessor, infer an omitted path from the input Revision, or interpret an
omitted root as an empty successor. An omitted root is no Candidate output and
creates no successor.

After Containment and retrieval, the Runtime independently validates the exact
output against repository, Atlas, Work Boundary, path, mode, size, and
Candidate rules. It then publishes a complete Candidate Revision Carrier and
atomically finalizes the optional successor Candidate Revision. Until that
atomic publication succeeds, no successor exists and the predecessor remains
current because the Process never advanced.

A missing, partial, unstable, invalid, or lost Output Carrier creates no
Candidate Revision. It cannot create an `invalid` or `unavailable` Candidate
Revision, overwrite the predecessor, or be represented by an empty Carrier.
Provider success is not promotion. Provider timeout, cancellation, or failure
does not prevent promotion when the exact output was already produced,
contained, retrieved, independently validated, and published.

An unchanged valid output MAY create a successor revision that reuses the
exact predecessor Carrier while recording the builder Attempt as its origin.
That is a logical successor with unchanged product content, not a physical
copy and not a terminal observation of a mutable workspace.

## Agent and Provider Separation

One Attempt Cell can require a provider control-plane channel so a fixed runner
can invoke an external provider such as Codex. That channel and its provider
authentication are Runtime infrastructure. They are not Agent product-network
capability.

The selected Backend Profile MUST prove all of the following or refuse the
Attempt before dispatch:

- provider credentials are delivered only to the fixed runner or an isolated
  credential broker and never appear in the Agent tool environment;
- provider credentials cannot enter product output, semantic output, tool
  output, provider-visible files, retained raw output, or diagnostics;
- the provider service channel is destination- and protocol-bounded under the
  selected profile;
- allowing that channel does not grant general Agent egress;
- Agent product-network access remains exactly the separately selected
  Capability Profile value; and
- the Cell has no Docker daemon socket, Runtime custody mount, canonical target
  mount, Founder authority material, or credential for another operation.

If the local engine cannot enforce the claimed separation, the profile is
unsupported. Lifecycle does not silently widen Agent network access so a
provider can authenticate.

## First Backends

The first production Backend is the local Docker Engine under exact profile
`lifecycle.execution-backend-profile.docker-local.v1`. It uses one container
per Agent Attempt or Check, immutable image digests, bounded Input Set transfer,
a non-root fixed runner, no privileged mode, no host PID or network namespace,
no Docker socket, no canonical repository mount, and no Runtime-private host
path mounted into the Cell.

Inputs and outputs move through bounded volumes or archive transfer owned by
the Backend contract. The Runtime validates the transferred content; volume or
archive identity is not product truth. A locally present image is insufficient
unless its immutable content digest and installed runner inventory match the
Specification.

The deterministic fault-injection Backend exists only for tests. It can model
lost allocation responses, uncertain dispatch, start-before-response,
Runtime-parent loss, timeout, cancellation races, partial output, manifest
substitution, retrieval failure, Retirement interruption, and Reclamation
failure. It MUST NOT be selected as a production fallback or support a
conformance claim about Docker isolation.

Remote runners, hosted execution, Compose topology, image publication,
registry trust, installer behavior, release signing, and distribution packaging
are outside this rc.10 execution contract. Their later addition cannot change
Candidate, Attempt, Check, Evidence, Delivery, or authority meaning.

## Recovery

Recovery reopens one exact Runtime operation support subject containing the
Specification digest, allocation key, validated Handle binding when known,
dispatch-consumed fact, last direct Backend observation, and Retirement
checkpoint. It never discovers Cells by mutable name, most-recent creation
time, image, target path, or provider session.

Recovery follows these rules:

- before dispatch authority is consumed, the same deterministic allocation can
  be reopened, retired unused, or abandoned under the owning Activity rule;
- after dispatch authority is consumed, recovery can only observe, cancel,
  retrieve, retire, or report ambiguity;
- direct Containment is required before retrieval and Retirement;
- when one complete Agent Carrier requires a runner-owned terminal
  observation, recovery first reopens the retained valid or invalid terminal
  outcome without resampling it; if output is not yet final and no outcome was
  retained, it repeats only the bounded non-dispatching terminal observation
  against the same contained Carrier;
- output is independently revalidated before any Work Product, Candidate
  successor, or Check Receipt is finalized, independently of an already
  retained owner terminal fact;
- a retained valid output is reopened from its exact immutable Runtime custody
  binding and is never retrieved again from the Backend;
- a missing or invalid output remains that exact disposition and is never
  reconstructed from provider prose or redispatched; and
- Reclamation can resume after Activity completion without reopening the
  Activity or changing retained semantics.

Only `delivery.recover` resumes an interrupted user-visible operation. There is
no public Cell recovery operation, container retry, backend retry, or operator
choice of Handle. An interface can report that Delivery recovery is required;
it cannot expose backend mechanics as an alternate route.

## Public and Retained Surface

The Delivery reducer remains the sole user-visible workflow. The CLI and TUI
continue to present `prepare`, `admit` (including the readmission variant),
`continue`, `evaluate`, `revise`, `reaffirm`, `accept`, `no-ship`, and exact
`delivery.recover` eligibility; they do not present an execution lifecycle
alongside it. The
public protocol and clients expose Delivery and its exact Attempt, Check,
Candidate, Receipt, and recovery facts. They expose no:

- Cell, job, container, Backend, Retirement, or Reclamation workflow;
- Execution Handle, allocation key, backend coordinate, daemon endpoint, physical
  path, volume, archive locator, or credential;
- manual redispatch, attach, resume, retry, delete, or garbage-collection
  command;
- operator-selected backend state transition; or
- TUI screen that can compete with the Delivery reducer.

An owning Receipt MAY retain stable sanitized execution facts: selected
Backend Profile and Image identities and digests, Specification and Input Set
digests, normalized effect and terminal observations, bounded resource facts,
Output Manifest digest when available, Containment fact, and Retirement fact.
Those values explain and reproduce the operation without granting access to
private execution custody.

## Qualification

Qualification MUST exercise at least:

1. deterministic allocation after a lost response without a duplicate Cell;
2. refusal of allocation-key reuse, Cell substitution, and ambiguous discovery;
3. dispatch consumed before start and permanent non-redispatch after every
   interruption window;
4. a Cell created before the allocation call returns and a Cell started before
   the dispatch call returns;
5. natural completion, timeout, cancellation, parent loss, descendant escape,
   and repeated containment;
6. provider control-plane authentication without Agent credential access or
   general product-network egress;
7. exact immutable Image selection and refusal of mutable or substituted
   images;
8. Input Set reconstruction and byte-exact materialization, including bounded
   incremental physical enumeration, without physical identity entering
   logical subjects;
9. complete Output Manifest validation, extra entries, links, mode changes,
   mutation races, partial retrieval, and lost output;
10. a valid runner-owned Provider terminal observation beside invalid
    authoring bytes, with exact provider Receipt and Retirement facts, no Work
    Product or Candidate successor, one dispatch, and recovery without
    redispatch or terminal-fact resampling;
11. promotion of valid output after timeout or provider failure and no
    Candidate successor for missing or invalid output;
12. synchronous Retirement with interrupted asynchronous Reclamation; and
13. proof that no Cell operation, Handle, credential, private path, or
    Reclamation state enters Control or a public interface.

The fault-injection Backend establishes deterministic recovery coverage. The
Docker profile additionally requires operated local-engine evidence. Passing
the fault-injection Backend cannot establish production isolation or Docker
conformance.

## Non-Goals

Execution does not:

- create another Process or public workflow;
- make physical materialization or container state product truth;
- make provider success a Candidate, Check, or Evidence fact;
- preserve provider sessions as Delivery continuity;
- require synchronous deletion before an Attempt, Check, or Delivery can
  complete;
- expose backend mechanics for operator repair;
- grant provider control-plane access as Agent product-network capability; or
- define distribution, hosted execution, or software release behavior.

Its purpose is narrower: execute one exact immutable operation in disposable
private custody, synchronously make that custody inert, preserve only validated
logical results, and reclaim the remaining physical material independently.
