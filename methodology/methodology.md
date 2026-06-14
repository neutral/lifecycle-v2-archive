# Lifecycle Methodology

## Purpose

Use this folder for the operational methodology behind Lifecycle.

Lifecycle applies a controlled transformation model to solo founder-dev
agentic software development. It repeatedly selects useful Signals and turns
selected Signals into bounded production change through product judgment,
active admission, and current proof. The control depth scales with risk,
ambiguity, and blast radius.

The methodology has these primary source areas:

```text
states/                       state model for installed methodology
control-records/              installed Control record contract overview
local-support/                work trace, stop-work, and tooling support
processes/                    source process and Control record methodology
semantic-authority/           operations, checks, surfaces, and templates
disciplines/             discipline package methodology and checks
checks/                       installed operational checks
responses/                    installed response procedures
```

Use [package-manifest.md](package-manifest.md) for the core package manifest read
by setup.

Use [states/state-model.md](states/state-model.md) for the state source that
setup turns into installed state pages.

Use [semantic-authority/surfaces/overview.md](semantic-authority/surfaces/overview.md)
when the agent needs current semantic authority: product context, intended
behavior, obligations, structure, and local responsibility.

Use [semantic-authority/surfaces/contract.md](semantic-authority/surfaces/contract.md)
when the agent needs to retrieve, write, update, or check semantic authority
entries.

Use [processes/processes.md](processes/processes.md) when the agent needs to run
Lifecycle work: Clarity, Discovery, Delivery, process-local Control records,
and shared process control mechanics.

Use [local-support/overview.md](local-support/overview.md) when a run needs work
trace support, must respond to an external stop-work request, or must interpret
optional tooling support.

Use [examples.md](examples.md) to calibrate compact end-to-end Lifecycle work
without adding unnecessary ceremony.

Use [checks/overview.md](checks/overview.md) to find operational checks used in
installed methodology.

## Core Invariant

```text
Only admitted behavior can ship.
```

Production behavior must be weighed into product judgment before admission,
governed by an active Work Boundary while work is in progress, supported by
current proof, and reconciled against the actual work delta before durable
knowledge enters the semantic authority surfaces.

## Operating Path

Source methodology remains organized for maintainers. Installed methodology is
organized for target-codebase agents.

The installed agent path is:

```text
start.md
-> route.md
-> states/<active-state>.md
-> control-records/<record-contract>.md
-> local support, semantic authority, discipline, checks, or responses
   when the state page calls them
```

The source-to-installed relationship is:

```text
methodology/ source pages and manifests
-> setup compile install workflow
-> .lifecycle/methodology/ installed methodology
```

## Lifecycle Roles

Semantic authority surfaces preserve admitted durable product meaning. During
Clarity, Discovery, and Delivery, the agent reads the relevant semantic
authority slice before acting. In Clarity, the agent maintains Context as its
own semantic layer and closes with recommendations rather than starting another
process. In Delivery, semantic authority informs product judgment; it does not
replace the agent's obligation to state which behavior it is about to accept.
The agent should use entry state, scope, stable identity, and related semantic
authority to keep retrieval small. It writes back only admitted knowledge after
reconciliation, knowledge promotion, or a bounded Clarity review.

Code and deployed executable behavior are the target. Evidence is proof.
Runtime observations are observation. Control records preserve process state.

Lifecycle keeps these roles distinct:

```text
semantic authority: admitted product meaning
target: code and deployed executable behavior
proof: evidence
observation: runtime observations
Control records: durable process state, including active product judgment
```
