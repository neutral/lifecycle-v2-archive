# Foundation interface protocol v17

A client needs to know which Delivery it is seeing, what the Runtime observed,
and which exact read a later request relies on. This package supplies the shared
contract for those relationships. The Runtime and canonical CLI use the
same presentation-neutral schemas for `lifecycle.interface.foundation.v17` and
`lifecycle.runtime.foundation.v17`. The CLI uses Runtime-derived state rather
than a separate presentation state model.

Protocol v17 binds the rc.17 qualification, repository v22, and Provider Adapter
v7 literals carried by repository observations, installed version, and Authorization Review. Predecessor values are refused. The local `lifecycle
draft` command does not add a public Runtime operation.

Read this overview before the public barrel,
[`src/foundation.ts`](src/foundation.ts). That barrel is the sole package entry
point. Internal modules separate common vocabulary, requests, installed-version
and CLI-error envelopes, Attempt View, and results. Canonical JSON and SHA-256
validation share one portable implementation that keeps public values independent
of the transport.

## Observation, selection, and generation

An observation contains Runtime-derived repository facts and a nullable
Delivery. The Delivery names its exact identity, Standing, Candidate condition,
Activities, recovery, current subjects, Journal head, Store disposition, latest
Integration Assessment, and eligible operations. Each field answers a different
question. For example, an `active` Delivery can have an admitted Boundary and no
Candidate while recovery remains at `candidate-revision-observed`. A `closed`
Delivery can have an `accepted`, `abandoned`, or `absent` Candidate while separate
`store-disposition` recovery still requires `store-seal` or `store-archive`.
Recovery presence does not itself make every Candidate `terminal-recovery`.

`delivery.inbox` supplies a bounded target-scoped set of exact Delivery rows.
Selecting a row gives the client a Delivery identity; a `delivery-view` then
joins that Delivery's Director-facing sections under one generation. Its
generation digest is an opaque Runtime-derived staleness token. It is not a
self-digest that clients reproduce or a new Process, authority, or execution
state. The token includes the digest or absence of private active-operation
support, allowing watches to notice recovery progress without disclosing the
private support or its physical mechanics.

When a Work Boundary is selected, the generation's repository coordinates
describe its retained basis; before one exists they use repository observation.
Direct repository observation describes the current target.
Canonical work can move while a Delivery develops, so those values need not
match. A client must preserve their different subjects when presenting them.

## Requests that preserve the reviewed basis

`delivery.prepare` accepts complete semantic Markdown without a Delivery ID and
returns the new identity on completion. Every request for one selected Delivery
names its exact `deliveryId`; result/request binding rejects a substituted
Delivery. Inbox and Inbox watch remain target-scoped. Continue, integrate,
evaluate, revise, and reaffirm also carry the expected read generation.

The ten Process operations are prepare, admit, continue, integrate, evaluate,
revise, reaffirm, accept, no-ship, and recover. Next Pass exposes five bounded
rows: continue, integrate, evaluate, revise, and reaffirm. The four Agent
operations preview fresh Investment and semantic input. Integration has null
Agent role and Investment and takes only the expected generation. The Runtime
selects and retains the canonical parent and applies its fixed construction
rule; clients supply no parent, strategy, semantic input, or authority credential.

The separate `delivery.work` resource control has only `set`, `run`, and `stop`
actions. Save and Run bind a reviewed generation; Run and Stop select the exact
retained grant reference. Stop has no generation precondition. The selected
Delivery View v2 exposes the retained grant, pending stop and current policy
conclusion; lifetime charges remain in the Delivery reduction. Agent Investment
is explicitly unavailable when installed choices cannot be observed. The
[Control owner](../spec-source/spec/CONTROL.md#explicit-resource-controls)
defines the semantics. Coordinates-only work results report a bounded summary
and exact Journal heads without flattening every event into one response.

A request is not proof of completion. Operation results retain direct
observation, exact change facts, Control references, diagnostics, and a self
digest. An unsuccessful provider outcome, invalid semantic submission, and
Candidate advancement are separate facts. Where final submission is invalid,
the retained public diagnostic contains only its stable code, stage, and
failure-facts digest. It exposes no semantic draft, workspace, provider output,
or live validation exchange.

## Bounded inspection and currentness

Inbox, status, inspection, diff, watch, and export are reads. Inspection opens a
selected Delivery, Attempt, Decision, or exact Control family and revision;
Candidate diff returns the Runtime-selected subject. Watch returns either a
changed coherent generation or an unchanged timeout. A changed generation gives
a client a reason to read fresh state, not permission to combine sections from
different generations.

The bounded context-inspection union covers Knowledge indexes and records,
Code changed-path pages and file differences, Atlas overview, Points and
Resources, ranged Source retrieval, and Authorization Review. Each
artifact selector binds an exact retained inspection selection and its
originating Journal prefix. Knowledge and Atlas select one proposed-or-active
Work Boundary; Code selects an exact Candidate and, for decision inspection,
its Seal. Their historical Context/Code bases and Source References use v2.
Later checkpoints or subject changes do not silently replace that selection.
Fresh Store custody, prefix integrity and artifact availability remain required.
Authorization Review alone retains the full current Delivery generation.
Runtime-issued Source References are basis-bound values, not paths or
capabilities. A completed result must match its originating selector, limits,
exact subject, and direct observation before the caller uses it. Cursor
compilation remains an internal helper.

Typed semantic sections preserve their provenance without exposing SQL, Git
arguments, private support, or authority material. Authorization Review explains
an exact proposed Director decision; it does not authenticate the decision.
Its fixed consequence sentences are validated contract content and contribute
to exact review identity, even though they are readable prose.

## Useful facts without a second execution interface

Candidate continuity is the logical Candidate Revision and its immutable
Carrier-manifest binding. A disposable materialization is not public identity;
terminal no-ship reports `abandoned`, not physical `disposed`.

Attempt and Check views expose the execution facts needed to understand their
Delivery operation: selected Backend Profile and Image, Specification and Input
Set digests, runner and terminal-observation digests, Output Manifest availability,
Containment, and Runtime-owned Retirement. They do not expose Cells, Handles,
allocation keys, backend coordinates, container details, private paths, or
Reclamation state. Allocation, dispatch, observation, retrieval, Retirement, and
Reclamation remain subordinate Runtime mechanics, not new public operations.

The [Runtime overview](../runtime/overview.md) explains the owners that produce
these values. The [source setup guide](../docs/source-setup.md) explains how to
build and invoke the CLI. Normative operation and read-model meaning stays
in [Delivery](../spec-source/spec/DELIVERY.md); package tests establish schema
and binding behavior, not an operated Delivery or a release claim.
