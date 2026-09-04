# Lifecycle Conformance

> Status: Draft

## Purpose

This document defines Lifecycle conformance classes, exact claim contents,
required validation and operated evidence, interoperability, extension limits,
implementation maturity, publication gates, and prohibited claims.

Conformance is always relative to one immutable Lifecycle specification
revision and its exact selected coordinates. A product version, branch name,
marketing label, or similar-looking document does not identify a conformance
target.

## Claim Principle

A conformance claim is narrow, reproducible, and falsifiable. It identifies:

- exact specification revision and publication-set digest;
- canonical specification identifier, publication version, authenticated
  released Publication Statement digest, and Release Notes digest;
- repository contract, runtime protocol, interface protocol, Provider Adapter,
  Execution Backend Profile and Cell runner, Control Store lifecycle, Agent Work
  Product parser/compiler, Candidate Revision Carrier, event, reducer, seal,
  archive, and input-material coordinates;
- implementation name, version, build identity, and implementation digest;
- claimed class or classes and every supported standard profile;
- supported document, Knowledge, role, provider, capability, evidence, and
  repository subsets;
- standard and implementation-owned resource limits;
- schema and CommonMark engines and whether required formats are asserted;
- external retrieval, private-retention, and credential policies;
- interpreted extensions;
- fixture-result and operated-evidence bundles;
- known deviations and incomplete requirements;
- evidence environment and toolchain; and
- claim digest and issuer.

A machine-readable claim conforms to
[`conformance-claim.schema.json`](../schemas/conformance-claim.schema.json),
schema `urn:lifecycle:schema:conformance-claim:v2`, whose closed class registry
includes `execution-backend`.
Human-readable release notes can summarize the claim but cannot imply a broader
class.

A candidate Publication Statement can support qualification evidence but
cannot satisfy the released-statement fields of a standard conformance claim.
The claim issuer does not become specification publication authority by signing
or digesting a claim.

“Lifecycle compatible,” “supports Lifecycle,” “agentic SDLC,” and “production
ready” are not standard conformance claims.

## Exact Foundation Cut

The Foundation rc.10 conformance target is one fresh-only generation:

- qualification revision `lifecycle.foundation.1.0.0-rc.10`;
- repository contract `lifecycle.repository.v15` and validation profile
  `repository-v7`;
- runtime protocol `lifecycle.runtime.foundation.v10`;
- interface protocol `lifecycle.interface.foundation.v10`;
- Provider Adapter `lifecycle.provider-adapter.v6`;
- first production Execution Backend Profile
  `lifecycle.execution-backend-profile.docker-local.v1` and fixed Cell runner
  `lifecycle.execution-cell-runner.v1`;
- Control Store `lifecycle.control-record-store.v1`;
- Control revision `lifecycle.control-record-revision.v1`;
- Control event `lifecycle.control-record-event.v2`, preserving the closed
  twenty-two event kinds;
- referenced file `lifecycle.control-record-file.v1`;
- Store seal `lifecycle.control-record-store-seal.v1` and archive
  `lifecycle.control-record-store-archive.v1`;
- Delivery reduction `lifecycle.delivery-reduction.v2`;
- Control lifecycle profile `foundation-delivery-control-lifecycle-v4`,
  preserving the closed twelve record families;
- Agent Work Product parser `lifecycle.agent-work-product-parser.v2` and
  compiler `lifecycle.agent-work-product-compiler.v2`;
- governed Work Product body profiles for reconnaissance, builder, and
  reviewer; and
- `lifecycle.candidate-revision-carrier-manifest.v1`, Execution Backend Profile
  schema v1, `lifecycle.execution-specification.v1`,
  `lifecycle.execution-input-set.v1`, `lifecycle.execution-image.v1`,
  `lifecycle.execution-observation.v1`, and
  `lifecycle.execution-output-manifest.v1`; and
- Agent Attempt payload v3, Execution Receipt payload v3, Candidate Revision
  payload v2, Candidate Seal payload v2, Check Receipt payload v2, Closure
  payload v4, Founder Decision payload v4, Work Boundary payload v4, Capability
  Profile v2, and Provider Descriptor v6.

A claim against this cut covers only fresh repository contract v15 and the
exact coordinates above. Bytes from another generation can be recognized only
far enough to refuse them before Process or authority-bearing work.

Unsupported-generation fixtures or results have no conformance standing and
cannot be relabeled rc.10 evidence.

## Conformance Classes

### Knowledge Authoring Tool

A Knowledge Authoring Tool creates or edits one or more governed Knowledge
kinds. Its claim identifies the supported kinds and whether it supports new
records, revisions, supersession, relationship maintenance, Description
coverage, and Check Definition authoring.

The tool MUST:

- emit `knowledge-structural-v1` valid Lifecycle Documents;
- preserve authored bytes, stable identities, and allowed extensions;
- preserve the distinction between Knowledge v1 source and semantic digests;
- refuse or surface missing required fields and sections;
- not infer currentness or authority from path, recency, or model confidence;
- not make a draft record current without the repository's governed change
  route; and
- validate the complete proposed change set through a conforming Knowledge
  Processor or disclose that final validation remains external.

Model assistance does not relax any requirement. A generated summary without
the exact record contract is not a conforming Knowledge change.

### Knowledge Processor

A Knowledge Processor discovers, parses, validates, indexes, and digests
governed Knowledge.

It MUST support:

- `lifecycle-document-v1`, `knowledge-structural-v1`, and `knowledge-set-v1`;
- all five standard Knowledge kinds;
- the shared strict RFC 8259 JSON-header and CommonMark parser while preserving
  repository-authored Knowledge layout and bytes;
- stable identity, revision, supersession, currentness, relationships, and
  graph constraints;
- current Behavior and Assurance Check requirements;
- Description primary coverage and complete `records/control/` exclusion;
- explicit source requiredness, resolution dispositions, ordered source and
  conflict carriers, and authority conflict detection;
- exact Check selector, Evidence kind, parser, and Binding compatibility;
- repository-selected record, byte, structural, graph, and source limits with
  fail-closed affected stages;
- standard Validation Results and diagnostics; and
- deterministic Knowledge Set digest reproduction.

Using one parser family does not make Knowledge canonical runtime-generated
Control. A semantic-search index can assist discovery; it cannot replace exact
graph, source, or digest processing.

### Lifecycle Document Processor

A Lifecycle Document Processor parses, references, and digests the
repository-authored Knowledge Markdown protocol.

It MUST support `lifecycle-document-v1` and:

- strict UTF-8 and exact delimiter framing;
- one bounded RFC 8259 JSON object with duplicate-key refusal;
- profile-owned CommonMark titles, ordered sections, anchors, fragments, and
  header/body non-conflict;
- exact provenance classes and typed Document References;
- exact body and fragment digest reproduction;
- exact source and semantic digest reproduction; and
- repository-authored Knowledge byte preservation.

A processor cannot claim this class by parsing generic YAML front matter,
accepting duplicate keys, reserializing authored Knowledge, or validating only
the header schema. Control Record revisions use the Store contract and are not
Lifecycle Documents under this class.

### Repository Validator

A Repository Validator adds exact target and Git semantics to a Knowledge and
Lifecycle Document Processor.

It MUST support `repository-v7` and:

- repository contract v15 and exact target identity;
- exact initialization and validation of `records/behavior` as the sole
  Behavior Knowledge root, without a `records/intent` alias or migration path;
- canonical commit, tree, and Git object-format binding;
- exact installed schema, standard profile, runtime, provider, interface,
  Control Store, event v2, reduction v2, Work Product compiler, Candidate
  Carrier, Execution Backend Profile, Cell runner, Atlas integration, extension,
  and source-policy selection;
- Product State, Atlas State, Atlas Resolution, normalized Atlas model,
  Knowledge Set, and Repository Snapshot reproduction at one coherent epoch;
- exact mandatory Atlas selection and complete valid resolution through a
  conforming Atlas Integration Processor;
- untracked, ignored, symbolic, executable, submodule, Gitlink, and prohibited-
  authority rejection;
- governed implementation roots and Description exemptions;
- Check Binding and Capability Profile registries;
- complete refusal of repository-visible Delivery Control, runtime custody,
  active-store, archive, Candidate, authority, or recovery carriers; and
- exact fresh repository-v15 environment bounds.

A validator MUST reject every predecessor contract and mixed carrier generation
before Process or authority-bearing work. It cannot claim `repository-v7`
when it silently supplies a selection, validates Knowledge from another tree,
or treats live authoritative worktree bytes as the canonical subject.

### Atlas Integration Processor

An Atlas Integration Processor implements Lifecycle's exact read-only consumer
seam without becoming an Atlas authoring tool or generic multi-version adapter.

It MUST:

- support only the release, immutable specification revision, authored format,
  processor contract revision, resolved profile, output schemas, and consumer
  profile selected by [Atlas Integration](ATLAS.md);
- read authoritative Atlas and repository-local Resource bytes from the exact
  bound Git epoch rather than a mutable worktree;
- identify its exact installed file manifest and reproduce the implementation,
  external-result, normalized-model, Resource-binding, and Atlas Resolution
  digests;
- reject unsupported selection before semantic use, including an incompatible
  Atlas that happens to declare `format: 1`;
- expose normalized output only for a complete valid resolved external result;
- preserve every Map, Area, Point anchor/context, state, relation note, Content,
  Reference, Resource, Check, publication-profile, and provenance distinction
  required by the selected Atlas consumer contract;
- stop at nested Atlas boundaries;
- keep Atlas Checks separate from Lifecycle Check Definitions and Receipts;
- grant no read authority from an Atlas edge or publication profile; and
- provide no Atlas write operation or Candidate mutation path.

Conformance requires the selected Atlas fixture matrix and read-only consumer
interoperability evidence at the exact processor contract revision plus
Lifecycle fixtures for unsupported selection, missing and invalid Atlas,
incomplete processing, invalid normalized output, nested boundaries, Resource
bindings, prohibited Candidate mutation, admitted historical-snapshot
reproduction, proposal staleness after any canonical movement, exclusive active
branch leasing, refusal after canonical or authoritative-worktree movement,
no-ship availability under violation, and exact sealed-Candidate acceptance
over the admitted parent. Passing Lifecycle JSON Schema alone does not establish
this class. Foundation rc.10 currently makes no released claim for this class
until those operated gates exist for the exact implementation.

Atlas write-boundary evidence also spans the Agent Work Product compiler and
Delivery Runtime. It MUST prove that `local-read` and `local-write` Effect
targets are compared after portable lexical normalization and refused when the
resulting scope equals, enters, or contains the authoritative Atlas root. The
evidence MUST include `.`, dot components, lexical `..`, repeated separators,
backslash separators, the exact root, a descendant, a safe sibling, and a
non-local opaque-text control. A structural Work Boundary payload alone is not
evidence for this requirement: `Effect.target` is intentionally plain text and
the payload does not contain the Repository Contract's Atlas root needed for
the cross-subject comparison.

### Projection Compiler

A Projection Compiler creates and validates Orientation and Execution
Projections.

A conforming compiler MUST support:

- `orientation-projection-v1` and `execution-projection-v1`;
- reconnaissance, builder, and reviewer roles;
- exact Projection Request, compiler, profile, and pair-derived Projection
  identities and digests;
- Orientation over one exact loaded epoch with a complete valid Atlas
  Resolution, while preserving truthful partial or invalid Knowledge
  observations;
- Execution only from a complete valid Repository Snapshot and Knowledge Set;
- deterministic mandatory fixed-point closure, inverse edges, Description
  additions, Check Binding closure, source provenance, and attention core;
- semantic Atlas selection by exact normalized identity with anchor/context,
  Map, Area, relation, Resource, Check, publication, and provenance
  distinctions preserved;
- exact mounted bytes or inline UTF-8 bytes and reachable-context handles;
- deterministic omission evidence and zero mandatory omission;
- all seven profile bounds and exact item and byte count reproduction;
- complete Candidate Seal and sealed observation for reviewer;
- unique mounted reachable-item citation registry without authority promotion;
- cache identity and revalidation; and
- reproducible Projection digests.

Search, embeddings, or a model can suggest reconnaissance retrieval or Work
Boundary roots. Undocumented ranking, provider session state, or generated
summaries cannot determine mandatory membership.

### Agent Work Product Parser and Compiler

This class implements the deterministic boundary between Agent-authored
semantics and runtime-authenticated mechanics.

It MUST support the exact rc.10 Agent Work Product parser and compiler profiles,
all three exact role body profiles, and:

- exact governed `semantic.md` workspace observation, body-only UTF-8/LF
  normalization, title, supported-section, local-anchor, typed metadata,
  omission, disposition, and semantic-combination parsing under the Attempt-
  selected role profile;
- normalized bounded ephemeral typed parser output that has no retained or
  provider-authored carrier;
- fixed Attempt, invocation, Process, role, subject, boundary, Projection,
  Candidate, provider, and provenance binding injection;
- exact reference resolution and deterministic global identities;
- profile-owned scalar normalization, duplicate handling, and set ordering;
- for reconnaissance Boundary semantics, portable lexical Atlas-scope
  comparison for `local-read` and `local-write` Effect targets, bidirectional
  exclusion of scopes at, below, or containing Atlas, exact retention of the
  authored target, and opaque treatment of non-local Effect targets;
- one deterministic canonical body rendering from the normalized typed value,
  including exact section, metadata, item, anchor, omission, and blank-line
  order;
- workspace-raw, observed-submission, and parser provenance separated from
  retained canonical body-fragment bindings;
- exact Agent Work Product payload, semantic Markdown, relationships, body and
  fragment bindings, and logical revision digest; and
- separate workspace, parser, compiler, and retained Work Product provenance.

Malformed Agent semantics MUST yield `invalid-submission` and no Agent Work
Product. Valid parser output followed by an unavailable fixed binding,
unstable identity, invalid payload, body-binding mismatch, or Control revision
invariant failure MUST yield `runtime-failure`. A claim fails if the compiler repairs
invalid semantics, blames the Agent for its own invariant failure, or invents a
claim, decision, uncertainty, citation, or proposed effect.

Structural payload fixtures prove only the retained Work Product shape.
Conformance additionally requires the same installed parser/compiler to
operate valid and invalid governed submissions for every claimed role under
fixed Attempt inputs. Provider terminal output and an independently retained
parser intermediate are not substitutes.

The class MUST prove that semantically equivalent valid drafts with permitted
ordering, omission, token-spelling, or blank-line differences compile to the
same canonical body and typed payload. It MUST also prove that reparsing its own
canonical rendering reproduces the same normalized typed value.

### Provider Adapter

A Provider Adapter translates one provider-neutral Agent Attempt to one
provider invocation inside an exact Runtime-selected Execution Cell, grants the
exact governed workspace capability, and reports bounded direct provider
observations to the Cell runner.

Its claim identifies the provider and compatibility range, executable or
service identity, roles, models, Capability Profiles, network and credential
handling, interruption behavior, mounted-content guarantees, workspace
semantics, submission, and observation bounds.

The Foundation `codex-exec-standard-v6` claim identifies compatibility range
`>=0.151.0 <0.152.0` and the current exact production Image tool version
`0.151.0`. Its operated evidence MUST exercise that exact Image and executable
identity and MUST prove that Codex 0.150.x is refused before provider dispatch.
Another 0.151.x Image cannot inherit that evidence merely because it satisfies
the Descriptor range.

A conforming adapter MUST:

- validate the rc.10 Agent Attempt payload v3 and bind one Provider Descriptor
  v6
  and one caller-fixed Investment Allocation before dispatch;
- preserve every mandatory instruction, semantic template, and mounted input;
- expose no provider-invoked semantic-validator command, callback, endpoint,
  token, or live validity response;
- prove capability materialization is a subset of the registered profile and
  refuse unsupported capability before productive work;
- keep Provider and Founder credentials separate and private;
- separate provider control-plane network and authentication from Agent product
  capability or refuse the Attempt as `unsupported` before dispatch;
- operate only the Cell-created governed semantic workspace and report its exact
  submitted, abandoned, or invalid disposition;
- leave semantic validity to independent Runtime parsing and compilation of the
  exact post-Containment Output Carrier;
- preserve exact observed workspace byte count and digest without embedding
  the bytes in public output;
- label provider events as transient non-Control observations;
- not depend on hidden session state for Process continuation;
- supply the observations required for an Execution Receipt in every
  terminal class; and
- never receive the Docker Engine socket, a Runtime-private target mount,
  Founder authority, Control SQL, or canonical Git write capability.

An adapter can claim an explicit role subset. The Foundation target requires
operated support for every role claimed by a Complete Lifecycle System. Adapter
conformance does not imply Delivery Runtime conformance.

### Execution Backend

An Execution Backend is a private runtime mechanism that allocates and operates
one disposable Cell for one Agent Attempt or Check. It does not add a public
operation, retained record family, Journal event, Process, or Founder-facing
workflow.

Its claim identifies the exact Backend Profile, implementation and Engine
compatibility, Execution Image and runner, supported Specification and Input Set
contracts, transport, limits, Containment evidence, and Reclamation mechanism.

A conforming Backend MUST:

- implement exact `allocate(specification, allocationKey)`, `dispatch`,
  `observe`, `cancel`, `retrieve`, and `reclaim` behavior under
  [Execution](EXECUTION.md);
- make repeated allocation for one exact Specification and allocation key
  identify the same Cell and opaque Handle or fail without creating a second
  productive allocation;
- consume no dispatch request more than once and permit recovery after uncertain
  dispatch only through observation, cancellation, retrieval, and exact
  Reclamation, never another dispatch;
- materialize only the immutable bounded Input Set and return output only
  through one bounded Output Carrier and complete Output Manifest;
- prove Cell Containment across natural return, timeout, cancellation, runner
  failure, Runtime parent loss, and missing terminal response;
- support Runtime-owned Retirement without retaining a productive reuse path;
- reclaim only the exact allocation identified by the Runtime obligation, with
  no discovery-based or broad Docker, filesystem, Carrier, or cross-Delivery
  prune;
- expose only sanitized stable Profile, Image, Specification, Input Set, Output
  Manifest, terminal-observation, Containment, and Retirement facts; and
- keep Engine endpoints, Cell identities, Handles, allocation keys, credentials,
  private environment values, paths, and Reclamation coordinates out of public
  Control and views; and
- leave Delivery as the sole public workflow: no Cell, job, container, Backend,
  Retirement, or Reclamation command, operation, state, stage, selectable
  identity, recovery choice, or interface screen can accompany the Backend.

The first production claim uses
`lifecycle.execution-backend-profile.docker-local.v1`. It MUST prove that Cells
receive neither the Docker socket nor a Runtime-private target mount.
`lifecycle.execution-backend-profile.fault-injection.v1` may exercise recovery
in tests, but is test-only and
cannot satisfy this class, a production operated row, or a Complete Lifecycle
System claim.

### Agent Attempt Host

An Agent Attempt Host freezes Attempts, constructs immutable Execution Input
Sets, invokes a conforming Execution Backend and Provider Adapter, invokes the
bound Work Product parser and compiler, validates output independently, and
produces Receipts.

It MUST:

- construct exact role and subject contracts and revalidate inside the closed
  retained gate at the last pre-Attempt and pre-dispatch boundary;
- keep Capability, Investment, provider, semantic return, compiler, and result
  contracts separate;
- prove exact Candidate Carrier or Check subject, Projection, Role Brief,
  semantic template, and complete Input Set before Attempt construction;
- compile the exact Backend Profile, Specification, Image, runner, capability,
  provider-control-plane separation, and idempotent allocation key;
- on successful revalidation, commit the Agent Attempt, durable dispatch intent,
  and exact operation-support replacement atomically before Backend dispatch;
  on refusal, retain neither Attempt nor intent and durably abandon the
  activity;
- reconcile retained intent only from the exact Handle, Backend observation,
  Output Carrier, Output Manifest, Candidate Carrier, Containment, and Retirement
  facts, without redispatch or replacement allocation;
- after Containment reports complete output for a started provider,
  independently validate and durably retain the exact valid or invalid
  fixed-runner terminal outcome before strict whole-Carrier validation;
  preserve valid provider facts across unrelated deterministic authoring
  refusal without treating them as Work Product, Candidate, Check, or Evidence
  validity, and permit Retirement and Reclamation handoff when the entire
  Carrier is authoritatively unavailable;
- retain raw provider and Check bytes only through bounded referenced-file
  descriptors when their owner requires retention;
- run the exact parser and compiler bound by the Attempt both for live
  correction and independently over retrieved final output after Containment;
- independently validate and durably publish a complete Candidate Revision
  Carrier before atomically selecting a promoted successor;
- preserve a valid Candidate successor across cancellation, malformed semantic
  return, compiler failure, and provider failure, while leaving the prior
  Candidate current for `not-produced`, `unavailable`, or `invalid` output;
- keep runtime observations separate from agent claims;
- produce one immutable Execution Receipt for every terminal invocation class;
- retain the funded operation and only `delivery.recover` through every missing
  Work Product, optional Candidate successor, Receipt, Boundary, Containment,
  Retirement, or activity-finalization milestone;
- recover an indeterminate canonical transaction by numbered append-only
  observations bound to the exact prior observation, and remove its package
  only after a determinate result;
- support fresh-session artifact-based continuation; and
- prove Containment, record Runtime-owned Retirement, hand exact Reclamation to
  private installation maintenance, and retire Activity support without deleting
  Control revisions or events.

Provider portability requires operated evidence for a second independent
adapter. An opaque resume token is not artifact-based continuity.

### Control Store and Delivery Reducer

A Control Store and Delivery Reducer implementation retains Process continuity
as immutable record revisions and bounded events in one primary Store and
derives state without a mutable current-state authority record.

It MUST support the Foundation Control lifecycle profile, Control Store,
revision, event, referenced-file, seal, archive, operation-support, and Delivery
reduction coordinates, and:

- exact event-value validation and target, Delivery, sequence, predecessor,
  kind, time, actor, optional revision subject, and closed payload binding;
- append and support mutation in one exact immediate SQLite transaction;
- fail-closed gap, fork, duplicate, digest-chain, cross-scope, unknown-kind,
  illegal-order, and unavailable-reference handling;
- intent-before-effect and observation-after-effect for provider and canonical
  transaction effects;
- exact operation-support generation/digest continuity and no-redispatch
  recovery;
- complete twelve-family and twenty-two-event registry enforcement under event
  profile v2 and Delivery reduction v2;
- Candidate Carrier publication-before-selection and optional-successor
  nullability without treating private Backend support as an event source;
- pure deterministic replay over the complete validated sequence and exact
  referenced record revisions;
- exact orthogonal state generation, including active Boundary governance
  before initial Candidate observation, Candidate absence precedence,
  terminal Candidate disposition through Store recovery, active subjects,
  recovery subject, and eligible-operation derivation; and
- byte-identical reduction with or without every cache.

A Store or reducer MUST NOT merge forks, renumber events, infer missing
milestones, consume provider callbacks as events, choose a latest revision,
accept exported Markdown, or accept a stored Process State projection as input
truth.

### Evidence Engine

An Evidence Engine seals Candidates, executes or authenticates Check Bindings,
issues Receipts, compiles reviewer subjects, validates independent review, and
builds Evidence Packets.

It MUST support the current Check Receipt, Candidate Seal, and Evidence Packet
payloads in their exact Control revisions, exact subject and
environment binding, temporal modalities, final-subject non-mutation, required
artifact and Description coverage, Receipt reuse and invalidation, reviewer
independence, complete proposition decisions and citations, the non-weighted
obligation ledger, and acceptance-readiness derivation. Artifact, Description,
reuse, invalidation, independence, review, and obligation facts remain Packet
ledgers rather than separate retained families.

Each operated Check uses one fresh Cell through a conforming Execution Backend,
binds the exact immutable proof input, proves Containment and Retirement, and
keeps Backend-private coordinates out of the Check Receipt. Physical
Reclamation may follow asynchronously and cannot strengthen or weaken the Check
outcome.

An engine that merely runs commands and records exit codes is not conforming.

### Delivery Runtime

A Delivery Runtime implements the Process, authority boundaries, transactions,
recovery, and information closure in [Delivery](DELIVERY.md).

It MUST support:

- the current Work Boundary, Founder Decision, Candidate Revision, Closure,
  Store event, reduction, seal, and archive contracts;
- one Work Boundary revision whose proposal-ready and active standings derive
  from exact baseline Receipts and an observed Founder-authenticated effect;
- active Boundary standing immediately after the applied initial-admission
  observation, with Candidate condition `absent` and recovery-only eligibility
  until the initialization Candidate observation is durable;
- exact reconnaissance Work Product and runtime compilation without Agent-
  authored repository bases, baseline facts, identities, ordering, or digests;
- complete Control Store event and reducer integration;
- immutable retained Control revisions with exact typed payload, semantic
  Markdown, relationships, and logical digests;
- reducer-selected Candidate Revision lineage, immutable Candidate Revision
  Carriers, disposable materializations, and publication-before-selection;
- private one-Cell-per-Attempt-or-Check execution through a conforming Execution
  Backend, with provider-control-plane separation and no Cell Docker socket or
  Runtime-private target mount;
- independent Work Product and Candidate-successor classification;
- caller-funded builder continuation and local correction;
- distinct `in-progress` Candidate projection at recoverable `started` and
  `prepared` pre-effect Activity heads when no stronger current Candidate
  projection applies, followed by `terminal-recovery` only after the Activity
  advances beyond preparation;
- frozen Material Conditions and distinct revision, reaffirmation, and
  readmission;
- runtime-owned evaluation and Evidence Engine integration;
- exact Founder admission, acceptance, and no-ship authority;
- recoverable intent/observation transactions;
- accepted and no-ship Closure sufficient for terminal status after synchronous
  Containment and Runtime-owned Retirement, with closed standing and terminal
  Candidate condition preserved through Store-seal and archive recovery; and
- immutable terminal Reclamation handoff or obligation-set facts in Closure,
  with complete bounded private maintenance accounting and without making
  physical absence a Closure precondition.

The runtime MUST ensure an Agent cannot admit, review, accept, close, authorize,
derive state, or move its own result by provider output alone.

### Runtime Facade and Interface Adapter

A Runtime Facade exposes the same Process and validation semantics without
interface-specific hidden transitions. It MUST implement runtime protocol v10,
preserve typed diagnostics and recovery facts, expose reducer-derived eligible
operations, bind every write to exact inputs and authority, keep private paths
and secrets private, and refresh from retained truth after each operation.
Its public Delivery request binds exact target, Delivery where required,
operation, and operation-owned input. It accepts bounded semantic Markdown only
for prepare, continue, evaluate, revise, reaffirm, and no-ship; it requires null
input for admit, accept, and recover. It accepts no caller-selected Process
state, record identity, event, digest, time, machine configuration, authority
bytes, or runtime mechanic.

An Interface Adapter MUST implement interface protocol v10, present exact
boundary, obligation, Evidence, Material Condition, provenance, and terminal
facts without inventing stronger state, obtain Founder input explicitly, use
runtime-supplied operation bindings, preserve typed refusal and recovery, and
derive terminal status from canonical Closure. Presentation can summarize, but
the exact underlying subject remains available and prose cannot become
authority. It MAY invoke only runtime-eligible prepare, continue, evaluate,
revise, and reaffirm through the canonical CLI; admission, terminal authority,
and exact recovery remain explicit handoffs.

Neither protocol exposes an Execution Backend, Cell, Handle, allocation,
dispatch, retrieval, Reclamation, Docker, or Candidate-materialization
operation. Public execution facts are sanitized stable Receipt and Attempt View
facts only.

### Conforming Repository

A repository conforms at one exact commit when `repository-v7` is complete and
valid, every current Knowledge and relationship validates, Description and
Check coverage is complete, Product State and raw Atlas State reproduce
exactly, Atlas Resolution is complete and valid under the selected exact Atlas
contract, the normalized model and bound Resources reproduce, no
repository-visible Delivery Control or runtime custody carrier exists, and no
untracked or ignored authority remains.

Repository conformance is commit-specific. It does not claim that every future
Work Boundary is coherent or that the product has no defect.

### Complete Lifecycle System

A Complete Lifecycle System combines, against one exact rc.10 publication, a
Knowledge Processor, Lifecycle Document Processor, Repository Validator,
Projection Compiler, Agent Work Product Parser and Compiler, Provider Adapter
and Agent Attempt Host for all three roles, an Execution Backend, Control Store
and Delivery Reducer,
Evidence Engine, Delivery Runtime, Runtime Facade, and at least one Interface
Adapter.

One codebase can implement several classes. The claim reports each class and
its evidence separately and runs every required scenario through the packaged
release artifact.

## Validation Evidence by Class

<!-- markdownlint-disable MD013 -->

| Class | Minimum standard profiles |
| --- | --- |
| Knowledge Authoring Tool | produced files pass `knowledge-structural-v1`; complete change-set validation can remain external |
| Knowledge Processor | `lifecycle-document-v1`, `knowledge-structural-v1`, `knowledge-set-v1` |
| Lifecycle Document Processor | `lifecycle-document-v1` over every claimed Knowledge profile |
| Repository Validator | Knowledge and document profiles plus `repository-v7` and fresh/predecessor/mixed-state fixtures |
| Projection Compiler | repository profiles plus both Projection profiles |
| Agent Work Product Parser and Compiler | exact rc.10 parser/compiler plus payload and operated valid/invalid submissions for all three roles |
| Provider Adapter | Provider Descriptor v6, Agent Attempt payload v3, governed Cell workspace, provider-control-plane separation, absence of a live semantic-validator surface, and bounded observation evidence for claimed roles |
| Execution Backend | Backend Profile, Specification, Input Set, Image, runner, idempotent allocation, one-time dispatch, terminal observation, retrieval, Containment, Retirement support, exact Reclamation, and private-fact evidence |
| Agent Attempt Host | Attempt, Work Product, optional Candidate successor, Carrier publication, Receipt v3, post-Containment semantic validation, canonical rendering, invalid-submission, compiler-failure, interruption, Containment, Retirement, and recovery evidence |
| Control Store and Delivery Reducer | Foundation lifecycle profile, Store/revision/event/file/seal/archive/reduction fixtures, replay, corruption, support CAS, and recovery evidence |
| Evidence Engine | current Check Receipt, Candidate Seal, reviewer Work Product/Receipt, and Evidence Packet payloads plus operated proof |
| Delivery Runtime | single Work Boundary topology, Founder Decisions, Store reduction, transactions, Closure, seal, and archive |
| Runtime Facade | runtime protocol v10 and coherent read-generation fixtures |
| Interface Adapter | interface protocol v10 presentation, non-authority execution, authority-handoff, typed-error, and recovery fixtures |
| Conforming Repository | one complete valid `repository-v7` result at an exact commit |
| Complete Lifecycle System | every applicable current profile and operated scenario |

<!-- markdownlint-enable MD013 -->

A claim package contains the exact Validation Result bundle and its digest.
Summary counts alone are insufficient.

## Required Operated Scenarios

A Complete Lifecycle System claim requires operated evidence, not only schema
or synthetic structural validation. The standard scenario set includes:

For the current Codex Provider Adapter row, every applicable Agent scenario
below uses the exact `0.151.0` production Image selection, preserves fixed-runner
authentication outside the Agent tool environment, and includes pre-dispatch
refusal of one 0.150.x Image.

1. **Healthy acceptance** — prepare one fresh Delivery, retain its Brief,
   reconnaissance Attempt, Work Product, Receipt, single Work Boundary revision,
   and exact baseline; authenticate admission, publish the initial Candidate
   Revision Carrier, perform builder and Check work in fresh Docker Cells,
   promote one successor only after complete Carrier publication, seal, prove,
   independently review, accept, append Closure after Containment and Retirement
   as the final event, bind any immutable terminal Reclamation handoff, seal the
   Store, verify its archive, and continue asynchronous Reclamation privately.
   Interrupt once after the applied initial-admission observation and before
   Candidate observation; require `active` standing, `absent` Candidate
   condition, and only `delivery.recover`. Interrupt once after Closure before
   sealing and once after sealing before archive; require unchanged closed
   standing, terminal Candidate condition, Closure, completed Activities, and
   Journal head while the exact Store-disposition recovery changes.
2. **Semantic authoring and compiler separation** — operate one valid governed
   submission for each standard role; prove that the Role Brief, Input Set,
   provider environment, and Cell expose no live semantic-validator surface or
   provisional validity claim; compile semantically equivalent draft layouts to
   byte-identical canonical Work Products; preserve Candidate and direct
   observations after malformed final semantics while producing no Work
   Product; separately inject a parser or compiler invariant failure after
   valid parsed semantics and classify it as runtime failure without blaming
   the Agent or repairing input.
3. **Control Store logical contract** — reproduce every current payload,
   semantic-body binding, relationship, record logical digest, event digest,
   referenced file, reduction, logical inventory, seal, and archive binding;
   reject payload substitution, duplicated record facts in an event, and an
   exported view presented as retained Control.
4. **Provider and Cell recovery** — interrupt before and after Backend
   allocation, durable dispatch consumption, dispatch, observation,
   cancellation, terminal-observation retention, whole-Carrier retrieval, Work
   Product compilation, Candidate Carrier publication, successor selection,
   Receipt, Containment, Retirement, and activity finalization; recover only
   the exact retained intent, Handle, support generation, and direct
   observations; pair a valid retained Provider terminal observation with
   invalid unrelated authoring bytes and prove one dispatch, no semantic or
   Candidate successor, exact Receipt and Retirement facts, and no terminal
   resampling; finalize exact pre-dispatch absence after Handle retention as no
   effect without recreating or dispatching a Cell; dispatch exactly zero or
   one time as authorized; and never infer `not-started` from missing support
   or a missing Cell after dispatch consumption.
5. **Store corruption and concurrency** — refuse a missing event, wrong
   predecessor digest, duplicate sequence, fork, unknown kind, cross-Delivery
   revision, illegal event order, invalid relationship, one-sided
   support/event postcondition, and competing append without choosing, merging,
   or renumbering a branch.
6. **Known-red repair** — admit a baseline failure allowed by modality, preserve
   an unrelated passing guard, repair the Candidate, and prove exact final
   Evidence, freshness, invalidation, and reviewer independence.
7. **Interrupted Candidate output** — terminate a builder after useful
   provisional work and prove both legal outcomes: retrieve, validate, publish,
   and promote complete output despite provider failure; or classify missing,
   incomplete, corrupt, repository-invalid, or Atlas-changing output without a
   successor while the predecessor Revision remains current. Continue through a
   fresh Cell without provider-session or materialization dependence.
8. **Failed preparation** — retain truthful Attempt and Receipt facts for
   reconnaissance or baseline failure, derive no Work Boundary when compilation
   prerequisites fail, expose no stale Investment reuse, and close or retry only
   through an eligible fresh operation.
9. **Material Condition and boundary resolution** — combine Agent-proposed
   condition semantics with the exact Candidate Revision and Receipt, freeze one
   Condition, preserve Candidate through failed resolution, compile one
   successor Work Boundary revision from a fresh Brief and Work Product, run
   its exact baseline, and authenticate distinct readmission.
10. **Canonical branch lease, violation, and restoration** — advance
    Control-only state, prove any post-compilation canonical or authoritative-
    worktree movement stales initial admission, admit at most one Delivery for
    one physical target and branch, and require the exact admitted commit, tree,
    and clean checkout for every productive, evaluation, revision, readmission,
    and acceptance route. Prove that movement after admission is an operational
    lease violation rather than a Material Condition, no newer Atlas is adopted,
    exact restoration resumes the same historical context, no-ship remains
    available without restoration, and acceptance imports only the exact sealed
    Candidate Carrier over the exact admitted parent without merge, rebase,
    composition, or alternate-parent retry.
11. **Lower-cost omission defense** — catch an omitted required property or
    fuzz obligation through validation, proof, the Packet ledger, or independent
    review before acceptance.
12. **Knowledge conflict before labor** — block complete Execution Projection
    and productive dispatch without allowing a model to choose conflicting
    authority.
13. **Acceptance and no-ship recovery** — interrupt each terminal transaction
    after durable intent and recover the exact Founder Decision and effect
    subject without rerunning judgment or proof; prove applied acceptance binds
    the actual parent and canonical result in checkpoint and Closure through the
    exact final immutable acceptance-observation facts and matching canonical
    result digest, refuse generic, missing, unavailable-Carrier, or mismatched
    facts, and prove no-ship abandons rather than synchronously destroys its
    Candidate Carrier and remains applied across later repository movement.
14. **Capability refusal and containment** — reject unsupported capability and
    inseparable provider control-plane access before productive work, prove no
    Cell receives a Docker socket or Runtime-private target mount, contain every
    productive writer on every terminal path, record Runtime-owned Retirement,
    and expose no machine paths, Handles, Cell identities, workspace bytes,
    provider events, Engine endpoints, Reclamation coordinates, or credentials.
15. **Terminal information closure** — prove accepted and no-ship Closure each
    remain sufficient as the final event after complete Containment and
    Retirement, with no live operation support, one reproducible Store seal, one
    verified read-only archive, and an immutable terminal Reclamation handoff or
    obligation-set digest whose private obligations may remain pending without
    making the Delivery uncloseable. Prove mutable Reclamation progress never
    enters Control or a public view.
16. **Transactional fresh initialization** — inject initialization and rollback
    faults, restore exact pre-invocation repository and machine-custody state,
    and create exactly one repository-v15 contract and its exact Behavior,
    Assurance, Blueprint, and Check roots on clean retry.
17. **Fresh-only boundary** — accept a fresh v15 target and reject every
    unsupported or mixed-generation carrier before Process, provider, Backend,
    or authority-bearing work, exposing no alternate-generation operation
    lane.
18. **Local operation domain** — prove linked worktrees sharing one physical Git
    common directory serialize guarded canonical work while an independent
    repository can operate concurrently, without exposing physical lock
    locators.
19. **Coordinate-bound read models** — enumerate several active and archived
    Deliveries without silent omission, render one selected Delivery View from
    one generation, expose typed semantic provenance, page exact Control, and
    refuse corrupt, duplicate, cross-head, or stale joins.
20. **Next Pass and authority boundary** — submit fresh complete input for each
    eligible continue, evaluate, revise, and reaffirm course through the
    canonical CLI, preserve it on refusal, allocate a new Investment, and keep
    admission, acceptance, no-ship, and recovery as non-executing handoffs.
21. **Difference and watch** — derive one exact bounded difference from the
    immutable base and Candidate Revision Carriers, disclose binary and
    truncation facts, refuse unavailable exact Carriers, and prove changed,
    unchanged-timeout, cancellation, missed-wakeup,
    support-only progress, repository-drift, seal, and archive refresh without
    retaining a view or event.
22. **Atlas write-boundary scopes** — compile reconnaissance Effects containing
    `.`, dot components, lexical `..`, repeated separators, backslash
    separators, the exact Atlas root, and one descendant; refuse every
    `local-read` or `local-write` spelling whose normalized scope enters or
    contains Atlas before retaining a Work Boundary, while one safe sibling
    scope succeeds and an otherwise identical non-local target remains opaque.
23. **Candidate Carrier publication matrix** — inject faults before and after
    Output Manifest completion, output retrieval, Carrier object writes,
    manifest synchronization, Carrier reopen, pending promotion, and atomic
    successor append. Prove that selected Carrier bytes are always complete and
    available, pre-selection orphans are bounded and collectible, unchanged
    promotion may reuse the predecessor Carrier, and `not-produced`,
    `unavailable`, or `invalid` creates no successor.
24. **Docker Backend matrix** — operate
    `lifecycle.execution-backend-profile.docker-local.v1` across repeated allocation,
    allocation conflict, faults before and after dispatch, lost dispatch
    response, allocation after creation before return, dispatch after start
    before return, natural return, timeout, repeated
    cancellation, Runtime parent loss, missing container, output-copy
    interruption, malformed Manifest, and Containment refusal. Prove one-time
    dispatch and sanitized public facts. Run the same fault schedule through
    `lifecycle.execution-backend-profile.fault-injection.v1` only as test
    evidence, never as the production operated row.
25. **Retirement and Reclamation matrix** — prove Retirement is synchronous,
    Runtime-owned, Handle-exact, and permanently nonredispatchable; then prove
    successful, interrupted, repeated, and failed Reclamation, bounded inert
    residue, exact restart recovery, and refusal of discovery-based or broad
    Docker, filesystem, Carrier, and cross-Delivery pruning.

Each scenario records exact repository, Store, event head, Boundary,
Projection, Attempt, governed submission, parser, compiler, Work Product,
Candidate Revision, Receipt, Evidence, authority, transaction, Closure, seal,
archive, sanitized execution, Retirement, and terminal Reclamation handoff
identities as applicable. Private qualification evidence separately binds
mutable Reclamation observations without placing them in public Control. At
least one claimed provider, production Execution Backend, platform, and
filesystem combination runs the complete healthy and fault paths in the actual
release artifact.

## Claim Package

A standard claim package SHOULD contain:

```text
conformance-claim.json
publication-manifest.json
publication-statement.json
release-notes.json
implementation-manifest.json
validation-results/
fixture-results/
operated-scenarios/
limits.json
security-boundary.md
known-deviations.md
artifact-digests.json
```

The machine-readable claim binds every included artifact by digest. Mutable
links are not claim evidence. The included Publication Statement MUST be
`released`, verify against an independently selected publication-authority
trust root, and bind the exact Manifest and Release Notes included by the
package.

The package distinguishes unit, integration, fixture, and operated evidence;
simulated and real provider runs; shared implementation cores; unavailable
platforms; unexecuted scenarios; expected nondeterminism; and every known
failure affecting a claimed requirement.

## Publication Status Gates

An authenticated `candidate` statement requires one frozen non-Draft candidate
revision, complete inventories and digests, successful schema, link,
diagnostic, fixture, and `publication-release-v1` checks, immutable Release
Notes covering every normative delta and the rc.10 hard cut, and an independently
trusted publication-authority signature over the exact statement subject.

Candidate status makes the package eligible for qualification only. It is not
Accepted document status, a released specification, implementation conformance,
or production qualification.

An authenticated `released` statement additionally requires every document,
schema, fixture, diagnostic, security row, independent-implementation result,
and operated scenario required by the claimed Accepted scope. A release tool
MUST fail rather than narrow the scope, reuse stale evidence, accept an
untrusted key, or invent a release result.

Every predecessor release directory and any authenticated statement over its
exact bytes is a historical immutable subject. This rc.10 Draft MUST NOT rewrite
one or present its evidence as rc.10 evidence. No rc.10 candidate, released,
portable-conformance, or production-qualified claim exists until its exact
gates are actually satisfied.

## Independent Implementation Gate

Before a portable format or processing class moves from Draft to Accepted, at
least two independently maintained implementations MUST process its required
interoperability fixtures and agree on normalized values, completeness,
validity, required diagnostics and severities, canonical bytes and digests, and
deterministic Evidence or Closure decisions where applicable.

Implementations sharing one parser, renderer, schema layer, graph engine,
semantic parser, Agent Work Product compiler, Store reducer, or validation core
do not count as independent evidence for that shared class. Acceptance can be
scoped, but the scope names every included document, schema, profile, fixture,
and diagnostic.

## Implementation Maturity and Production Readiness

Specification conformance and production readiness are distinct claims. A
conforming implementation can remain experimental because durability,
performance, security review, platform coverage, or operational support is
insufficient.

A production-qualified claim additionally publishes threat-model and security
review, crash and power-loss testing, concurrency and coherent-observation
testing, transaction durability, parser and renderer fuzzing, resource-
exhaustion evidence, backup and retention procedures, platform matrix,
performance limits, redaction behavior, operator recovery guidance, and every
Complete Lifecycle System operated scenario for the exact release artifact.

Lifecycle Foundation 1.0.0 currently implements a changing Draft and makes no
conformance claim. Repository code, fixture presence, passing local checks, or
overlapping field names do not establish conformance.

## Extensions

A claim lists every interpreted `x-` extension, implementation-owned profile,
custom relationship or Evidence kind, provider feature, Capability Profile, and
repository-contract extension.

An extension remains compatible only when an implementation that does not
understand it can preserve it without changing standard behavior. Any extension
that changes document rendering, reference or digest semantics, mandatory
Projection closure, authority, Control Store reduction, Evidence, or
transition behavior requires a new standard version. An implementation MUST
NOT include an extension in an unqualified standard claim.

## Versioning and Fresh-Only Refusal

The specification revision identifies exact publication bytes. Every record,
document, schema, profile, protocol, parser, compiler, journal, and adapter
family carries its own exact version.

An implementation MUST reject an unsupported or hard-cut version and MUST NOT
interpret a new value through an older contract because property names look
similar. For rc.10, declared compatibility is exactly fresh v15 creation and
operation plus deterministic predecessor and mixed-state refusal. There is no
migration, adoption, import, dual reader, dual writer, predecessor recovery, or
compatibility mode.

A current implementation MUST refuse unsupported-generation input by fixed
discriminator before Process, Backend dispatch, or authority-bearing work and
MUST NOT use its records, Stores, Carriers, or execution support as migration
input.

A future migration tool would require a separately published migration
specification defining source preconditions, authority, information loss,
validation, rollback, and recovery. Its possibility does not weaken this cut.

## Revocation and Errata

A conformance claim can be revoked when its evidence is false, incomplete,
stale, or produced by a different artifact. An erratum identifies the affected
revision, requirement, schemas, fixtures, diagnostics, security consequence,
and hard-cut effect. An implementation cannot silently patch normative meaning
while continuing to claim the original exact revision.

## Prohibited Claims

An implementation MUST NOT claim:

- complete Lifecycle conformance from header or JSON Schema validation alone;
- canonical document conformance without byte-identical rendering, exact
  references, body and fragment digests, and external whole-document digests;
- Knowledge conformance while current authority conflicts or Description gaps
  remain;
- Projection conformance when mandatory membership depends on hidden ranking,
  provider memory, or silent summaries;
- Agent Work Product parser conformance when the Agent manufactures fixed
  bindings, global identities, relationships, ordering, digests, a Control
  header, or a runtime wrapper;
- compiler conformance when invalid Agent semantics and runtime invariant
  failures are combined or misattributed;
- Provider Adapter conformance when capability silently broadens, required
  context is omitted, or raw provider material enters retained Control;
- artifact-based continuity when a provider resume token is required;
- Process conformance from a mutable current-state record, incomplete Store
  event chain, inferred event, merged fork, or provider callback;
- Evidence conformance from unbound command exit codes;
- reviewer independence when the reviewer can write or accept the Candidate;
- Delivery conformance when an Agent can authenticate or move canonical state;
- recovery conformance when Candidate, authority, event, or transaction
  subjects are reconstructed or substituted;
- provider portability without an operated second adapter;
- repository conformance while authority is ignored, untracked, or from a
  predecessor generation;
- migration or compatibility support from discriminator-only refusal fixtures;
- Execution Backend conformance from the deterministic fault-injection Backend,
  a mutable Docker tag, Cell-visible Docker authority, a Runtime-private target
  mount, repeated dispatch, or unbounded broad Reclamation;
- production readiness without the required fault, security, durability,
  Containment, Retirement, and Reclamation evidence; or
- Accepted or released status while any required document, schema, fixture,
  diagnostic, operated scenario, or independent implementation gate remains
  unsatisfied.
