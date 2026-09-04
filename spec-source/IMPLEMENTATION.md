# Lifecycle Foundation implementation record

> Status: Implemented rc.10 hard cut; publication remains separate

## Purpose

This non-normative record states the selected Foundation rc.10 implementation
shape, current source owners, hard-cut boundary, and verification gates.
Normative meaning belongs to [SPEC](SPEC.md) and the owning documents under
[`spec/`](spec/).

Lifecycle remains fresh-only. The implementation does not migrate, adopt,
import, dual-read, dual-write, or continue any predecessor repository,
protocol, Provider Adapter, Delivery record, Journal, transaction, Candidate,
Cell, or provider session.

## Selected coordinate

```text
package                     1.0.0
qualification revision      lifecycle.foundation.1.0.0-rc.10
repository contract         lifecycle.repository.v15
runtime protocol            lifecycle.runtime.foundation.v10
interface protocol          lifecycle.interface.foundation.v10
provider adapter            lifecycle.provider-adapter.v6
Atlas release               0.7.0 (authored format 1)
Atlas specification         429fee62966f4d30e91ec2a15d27ecf353f5d68f
Atlas processor contract    746cbce73c51b28d617b96ca08f18d498ac749c4
Control Store               lifecycle.control-record-store.v1
Control revision            lifecycle.control-record-revision.v1
Control event               lifecycle.control-record-event.v2
Control lifecycle           foundation-delivery-control-lifecycle-v4
Delivery reduction          lifecycle.delivery-reduction.v2
```

No predecessor coordinate has compatibility, recovery, migration, or
publication standing in this source. Fixed invalid inputs may carry only the
minimum discriminator required to prove pre-authority refusal.

No authenticated rc.10 Publication Statement, portable conformance result, or
production qualification exists. Local checks establish only their bounded
assertions.

## Selected implementation shape

Delivery remains the sole Process and user-visible workflow:

```text
prepare -> admit -> continue -> evaluate -> accept | no-ship
```

The implementation adds no public Cell, container, backend, or Reclamation
workflow. The CLI, TUI, runtime protocol, Control family registry, and Delivery
reducer remain Delivery-centered.

Candidate continuity is:

```text
reducer-selected Candidate Revision
  -> digest-bound adjacent Carrier manifest
  -> immutable Git object closure in the Carrier Store
  -> zero or more disposable materializations
```

Agent Attempt and executed Check work moves into one disposable Execution Cell
per Attempt or Check. The Runtime compiles an immutable Specification, Input
Set, Image, and output policy. A private Backend allocates deterministically,
dispatches once, observes, cancels, retrieves, and reclaims. The first
production Backend is the exact local Docker profile. A deterministic
fault-injection Backend is test infrastructure only.

Builder output is provisional. The Runtime establishes Containment, retrieves
and validates the complete output, publishes the validated bytes into
immutable private Runtime custody, publishes a Candidate Revision Carrier, and
only then atomically appends an optional successor Revision. Recovery reopens
the Runtime custody binding rather than the Cell. Invalid, unavailable, or
missing output creates no Revision. Provider outcome, Work Product validity,
and Candidate advancement remain independent.

For a started Agent Attempt with directly observed complete output,
post-Containment processing first validates and durably retains the fixed
runner-owned Provider terminal observation, or one exact invalid-terminal
outcome, as a private owner fact. Strict whole-Carrier validation follows in a
separate checkpoint step. An unrelated invalid authoring member therefore
cannot erase exact provider completion facts, but it still creates no semantic
output, Work Product, or Candidate successor. Authoritative total output loss
retains no invented Provider fact and does not block Retirement or Reclamation
handoff.

Activity completion and Closure require Execution Containment and Runtime-owned
Retirement. Physical Reclamation is installation-private and asynchronous.
Closure may bind only the immutable Reclamation handoff set at its terminal
boundary; later ledger progress cannot rewrite Process truth.

## Implemented state

The sole source route now:

1. retains each Candidate Revision as a Control identity, stores its selected
   exact Carrier manifest and immutable Git object closure, and reconstructs
   disposable materializations from that Carrier;
2. compiles private Execution Specifications and Input Sets, durably allocates
   and dispatches once, and owns output validation, Retirement, and the exact
   Reclamation ledger;
3. executes every Agent Attempt and executed Check through the selected Docker
   Execution Backend, with a deterministic fault-injection Backend confined to
   tests;
4. publishes valid builder output before atomically selecting an optional
   successor Candidate Revision;
5. uses Candidate Revision Carriers for initialization, revision, readmission,
   sealing, difference, acceptance, no-ship, archive retention, and recovery;
6. keeps Execution Handles, daemon coordinates, credentials, materialization
   paths, and Reclamation state private beneath Delivery; and
7. exposes repository v15, runtime and interface protocol v10, Provider Adapter
   v6, the canonical CLI, and the thin TUI as one fresh-only Foundation route.

Mandatory post-Containment semantic validation remains independent of the
provider. No Cell or provider result can establish its own semantic validity.

## Required runtime owners

The implementation uses these internal owners:

```text
runtime/src/foundation/candidate/
  Carrier manifest and Store
  object-closure validation and publication
  deterministic materialization and acceptance import

runtime/src/foundation/execution/
  contract and exact codecs
  durable coordinator and private operation support
  Runtime Retirement and Reclamation ledger
  deterministic fault-injection Backend
  Docker Backend and fixed cell-side runner

runtime/src/util/
  fixed cell-side execution and Agent operation entrypoints
```

Attempt, Check, Candidate, Evidence, and transaction owners keep domain meaning
and call these mechanisms. The Delivery reducer remains the sole legal Process
state machine. No shared mechanism may introduce a stage DSL, alternate
eligibility source, or generic state machine beside it.

## Selected verification architecture

This section records implementation status and order only. Verification
practice and planning do not become Foundation meaning.

The first implemented layer is the owner-adjacent Delivery reducer exploration
package under `runtime/tests/process/exploration/`. It contains the generic
bounded engine, independent oracle and derived executable property clauses,
mechanical reducer fixture, small phase-local scenario families,
mutation-sensitivity tests, aggregate registered-identity observation, optional diagnostic
survey, and required zero-finding gate. The fixture compares batch,
incremental, and midpoint-fork replay outcomes and checks the Journal coordinate
at every incremental prefix. Refusals are exact full diagnostic codes. The
aggregate gate observes all registered one-Journal event-kind, startable-operation,
event-producing recovery-coordinate, Standing, and Candidate-condition identities.
This is identity occurrence, not transition coverage; the per-scenario seeds,
commands, and depths bound the behavioral claim. Engine, oracle, mutation, and
aggregate tests run in the ordinary runtime suite; CI also names the aggregate
gate explicitly.

The original Candidate-absence defect, applied-admission Standing ambiguity,
unreachable `in-progress` projection exposed by broadened aggregate identity
observation, and
unclassified refusal residual are resolved. Historical bounded coordinates do
not become accepted baselines.

Implementation proceeds in this order:

1. retain owner-local focused tests and run or extend the required bounded gate
   on every applicable Delivery reducer change;
2. add generated value or history campaigns only for an exact owned domain;
3. pilot the selected broad TLA+ role for shared Delivery and durable-effect
   behavior, without selecting a toolchain before exercise;
4. admit Alloy only for a narrow relational question that earns a separate
   model; and
5. connect stable independent models to runtime mapping and exact-artifact
   qualification before making any product-level or proof claim.

The following carriers are deliberately deferred:

- `tests/formal/verification-catalogue.json`, stable derived verification
  identities, schemas, and bounded profiles;
- `tests/formal/action-evidence-map.json`, `toolchain-lock.json`, `profiles/`,
  `schemas/`, and `check.mjs` when maintained consumers justify them;
- `tests/formal/tla/lifecycle-kernel/` and its pinned TLC runner;
- `tests/formal/alloy/exact-bindings/`, only after a successful narrow pilot;
- runtime-to-model trace projection and reviewed refinement mapping;
- operated repository, Control Store, and execution fault rows under
  `qualification/`; and
- any `qualification/formal/` release-evidence runner, formal conformance
  requirement, or theorem-prover obligation.

Tool versions, artifacts, Java and solver selections, and digests are not
invented before those tools are actually admitted. Generated traces, checker
databases, caches, logs, and routine run results remain untracked; only bounded,
normalized, deliberately retained counterexamples may become repository
fixtures. This implementation program creates no qualification, publication,
conformance, formal-verification, or proof status.

## Current-only boundary

The sole production route requires:

- Candidate continuity through the reducer-selected Revision and its exact
  reconstructible Carrier;
- Agent and executed Check work through the selected Execution Backend;
- Check executable identity from the immutable Execution Image;
- common process containment, output validation, Retirement, and Reclamation
  ownership beneath the domain-specific Agent and Check owners;
- a successor Candidate Revision only for validated complete builder output;
- Closure after Containment and Retirement, with physical Reclamation tracked
  as installation-private maintenance;
- no public Handle, allocation key, container identifier, daemon endpoint,
  materialization path, or Reclamation coordinate; and
- refusal before executable interpretation of any unsupported coordinate or
  retained physical state from another product generation.

Fixed refusal fixtures retain only the minimum unsupported-generation
discriminator bytes needed to prove fresh-cut rejection.

## Verification gates

Every coherent batch runs focused schema, Carrier, execution, Candidate,
Attempt, Check, reducer, Store, transaction, protocol, or client tests. Before
reporting a source revision as locally qualified, run:

```sh
npm ci
npm run check:fixture-manifest
npm run check:publication-manifest
npm run check
npm run build
npm test
npm run qualify:foundation-setup
npm run qualify:foundation-installed
npm run qualify:foundation-provider
git diff --check
```

A complete rc.10 qualification run must establish:

- lost allocation and dispatch responses without duplicate Cell or redispatch,
  including authoritative absence after Handle retention before and after
  dispatch consumption without recreation or substitution;
- allocation-after-create and dispatch-after-start lost-response interruption
  windows;
- timeout, cancellation, parent loss, missing Cell, missing output, malformed
  manifest, and containment failure;
- a valid runner-owned Provider terminal observation beside invalid authoring
  bytes, with one dispatch, separate durable terminal retention, exact Receipt
  and Retirement bindings, no successor, and recovery without redispatch or
  resampling;
- provider control-plane authentication without Agent credential access or
  unreported general product-network egress;
- exact immutable Image and Check executable identity;
- Carrier publication before Control append and recovery between both media;
- builder completion with and without a successor Candidate Revision;
- Check and Attempt Containment plus Runtime Retirement before Receipt and
  Activity completion;
- pending Reclamation without Closure deadlock and without public disclosure;
- exact acceptance import from the sealed Carrier and no-ship abandonment;
- Store seal and archive validation with Carrier reference retention;
- absence of retired modules and backend mechanics from public protocol and
  client surfaces; and
- one real fresh project from preparation through accepted or no-ship Closure.

No unit suite may be relabeled as operated Docker, transaction-recovery,
provider, installation, or release qualification.

## Deferred work

Distribution, Runtime Image publication, image signing, registries, installers,
remote runners, hosted execution, Compose topology, Kubernetes, microVMs,
release/deployment workflows, and software publication remain outside this
implementation goal. Architecture may preserve their constraints, but rc.10
adds no runtime code, public operation, schema, or qualification claim for them.

## Completion boundary

Implementation is complete only when the sole installed route can operate all
nine public Delivery operations, reconstruct every active Candidate from its
exact Carrier, execute every Agent Attempt and every executed Check in the
selected disposable Cell, recover every retained obligation without redispatch
or subject substitution, close and archive the Store without waiting for
physical Reclamation, and pass the complete fresh-target gates.

Publication, signing, tagging, package release, and conformance claims remain
separate authenticated or external actions.
