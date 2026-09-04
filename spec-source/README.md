# Lifecycle Specification Source

> Current development source · status: Draft

This directory contains the normative development source for Lifecycle.
Lifecycle is a repository-native operating system for agentic product delivery.
It preserves durable product meaning, compiles the exact knowledge needed for
one bounded agent attempt, confines reversible work, and admits a result only
when independent evidence satisfies the exact active mandate.

The current qualification coordinate under development is
`lifecycle.foundation.1.0.0-rc.10` under canonical specification identifier
`lifecycle`. Its documents remain Draft. Candidate publication status is
established only by a trusted authenticated Publication Statement over the
final immutable manifest and Release Notes; the revision string alone does not
claim that status or released conformance.

The specification is intentionally separate from the Lifecycle Foundation
1.0.0 implementation, which is the sole current product implementation. Source
proximity does not make that implementation normative or conforming. The
Foundation supports fresh projects only and refuses unsupported repository
generations and mixed state before operation. It makes no conformance claim
until an exact implementation claim satisfies a declared conformance class.

## Documents

- [Lifecycle Specification](SPEC.md) defines the thesis, conceptual model, and
  complete system relationship.
- [Lifecycle Glossary](GLOSSARY.md) defines common terms and distinctions.
- [Authority](spec/AUTHORITY.md) defines product, process, runtime, agent, and
  evidence authority.
- [Atlas Integration](spec/ATLAS.md) defines the mandatory exact Atlas
  selection, raw and resolved bindings, read-only consumer contract, and
  fail-closed Delivery boundary.
- [Control Record Store](spec/CONTROL.md) defines the Delivery-scoped Control
  carrier, common record lifecycle, closed family registry, event source, and
  seal and archive boundary.
- [Knowledge](spec/KNOWLEDGE.md) defines governed knowledge records, physical
  form, identity, lifecycle, and implementation coverage.
- [Relationships](spec/RELATIONSHIPS.md) defines typed edges, admissible source
  and target kinds, closure effects, and conflict rules.
- [Processing](spec/PROCESSING.md) defines publication composition, source
  precedence, parsing, canonical JSON, digests, identities, paths, ordering,
  and processing security.
- [Projection](spec/PROJECTION.md) defines exact request carriers, deterministic
  role-specific context compilation, standard bounds, and fail-closed results.
- [Agent Attempts](spec/ATTEMPTS.md) defines the provider-neutral attempt
  contract, capability, investment, result, and continuity boundaries.
- [Execution](spec/EXECUTION.md) defines subordinate Execution Backends,
  immutable inputs, disposable Cells, Candidate Revision Carriers,
  Containment, Retirement, Reclamation, and recovery without creating another
  Process or public workflow.
- [Attempt View](spec/ATTEMPT_VIEW.md) defines the reducer-generated Attempt
  dossier, obligation view, Process eligibility, and caller Investment
  boundary; it is not a retained Control family.
- [Delivery](spec/DELIVERY.md) defines the Delivery process, records, state
  machine, transitions, correction, readmission, acceptance, and no-ship.
- [Evidence](spec/EVIDENCE.md) defines Checks, bindings, receipts, proposition
  coverage, independent review, and acceptance evidence.
- [Security](spec/SECURITY.md) defines trust domains, capability isolation,
  supply-chain verification, recovery, retention, and qualification boundaries.
- [Validation](spec/VALIDATION.md) defines profiles, stages, result objects,
  diagnostics, and fixture requirements.
- [Conformance](spec/CONFORMANCE.md) defines claims, implementation classes,
  interoperability, and release gates.
- [Evolution](spec/EVOLUTION.md) defines publication identity and status,
  Release Notes, version coordinates, compatibility, hard cuts, and evolution
  review.
- [Implementation program](IMPLEMENTATION.md) is non-normative and identifies
  the follow-on runtime, interface, setup, and repository changes required to
  implement this foundation.

Foundation rc.10 is the sole integrated source coordinate. The exact selections
are `lifecycle.repository.v15`, `lifecycle.runtime.foundation.v10`,
`lifecycle.interface.foundation.v10`, `lifecycle.provider-adapter.v6`, and the
mandatory read-only Atlas 0.7.0 selection identified by specification revision
`429fee62966f4d30e91ec2a15d27ecf353f5d68f` and processor contract revision
`746cbce73c51b28d617b96ca08f18d498ac749c4`.
Every Delivery retains its governed Control and sole Process Journal in one
primary event-sourced SQLite Control Record Store. These coordinates do not
interpret or migrate another repository, protocol, adapter, record, bundle, or
Attempt generation.

## Supporting material

- [`schemas/`](schemas/) contains machine-readable schemas for the universal
  record envelopes, exact Product and raw and resolved Atlas state, repository
  snapshots, and compiled runtime inputs.
- [`examples/`](examples/) contains valid examples and invalid conformance
  fixtures with an explicit manifest, including the exact published
  `codex-exec-standard-v6` Provider Descriptor selected by Foundation v15 fresh
  repository fixtures. Any retained predecessor discriminator fixture proves only
  fresh-cut refusal.
- [`publication-manifest.json`](publication-manifest.json) binds the exact
  document, schema, and fixture bytes for this revision. Release Notes and an
  authenticated Publication Statement are external release-package sidecars
  and are deliberately not members of that manifest.
- `npm run refresh:fixture-manifest` derives every fixture subject digest from
  exact bytes, and `npm run refresh:publication-manifest` then inventories the
  three publication classes, assigns their fixed roles, hashes their exact
  bytes, and derives the manifest self-digest. `npm run
  refresh:qualification-manifests` runs that order mechanically. The matching
  `check:fixture-manifest` and `check:publication-manifest` commands prove both
  checked-in manifests are current. None of these commands creates Release
  Notes, authority, or a publication status transition.
- The rc.10 Release Notes will bind the exact final rc.10 manifest. No
  authenticated Publication Statement exists yet. Unsupported-generation
  bytes may appear only as bounded refusal discriminators, never as
  compatibility carriers.

## Normative boundary

A Lifecycle specification set consists of the inventoried Markdown documents,
JSON Schemas, and conformance fixtures published together at one immutable
repository revision. Publication lifecycle status is a separate authenticated
statement over the exact manifest and content-addressed Release Notes.

A document marked **Outline** can omit required behavior and cannot support a
conformance claim. A document marked **Draft** defines the current development
contract but can change before acceptance. A document marked **Accepted**
defines a stable contract for its specification revision.

Normative requirements use the uppercase terms **MUST**, **MUST NOT**,
**REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** as defined by BCP 14.
Lowercase forms are ordinary prose.

Examples, historical notes, implementation behavior, prompts, and historical
Control records do not create requirements absent from the normative documents.
