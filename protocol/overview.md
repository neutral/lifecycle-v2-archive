# Foundation interface protocol v10

The top-level `protocol/` package is the shared, presentation-neutral
Foundation contract imported independently by the runtime and its clients. It
owns the strict, compact public Foundation v10 contract:
`lifecycle.interface.foundation.v10`, `lifecycle.runtime.foundation.v10`, the
matching facade, observation, and result schemas.

`src/foundation.ts` is the sole public barrel. Its internal modules separate
the common protocol and Control vocabulary, requests, installed-version and
CLI-error envelopes, Attempt View, and results. Internal helpers do not create
additional package exports or public entry points. Canonical JSON and SHA-256
validation use the same browser-and-Node implementation, so a browser client
can validate the exact public contract without a Node compatibility shim or a
second web-specific DTO protocol.

An observation contains runtime-derived repository facts and a nullable
Delivery. A Delivery exposes its exact identity, standing, Candidate condition,
activities, recovery, subject references, Journal head summary, Store
disposition, and eligible operations. It contains no Role Result, Assessment,
or Markdown Process Journal carrier.

Those fields are orthogonal. A valid public state can be `active` with an
admitted Boundary, no Candidate, and activity recovery at
`candidate-revision-observed`. A valid terminal state remains `closed` with
Candidate condition `accepted`, `abandoned`, or `absent` while a separate
`store-disposition` recovery points to `store-seal` or `store-archive`.
An existing Candidate can likewise be `in-progress` while a `started` or
`prepared` Activity exposes its exact pre-effect recovery coordinate; recovery
presence alone does not relabel that work `terminal-recovery`.

`delivery.inbox` returns a bounded target-scoped aggregate whose rows each bind
one exact Store, Delivery, reduction, disposition, and read generation. One
selected `delivery-view` joins all current founder-facing sections under one
generation. `delivery.prepare` accepts semantic Markdown without a Delivery ID
and, on completion, returns the newly created Delivery identity. Every status
and later Delivery request carries an exact `deliveryId`; result/request
binding rejects substitution. Non-authority semantic mutations additionally
bind the expected read generation. The mutation vocabulary remains prepare,
admit, continue, evaluate, revise, reaffirm, accept, no-ship, and recover.
Inbox, status, inspection, diff, watch, and export are reads.

Inspection exposes selected Delivery, Attempt, Decision, and exact Control
family and revision queries. Diff exposes the runtime-selected exact Candidate
difference. Watch returns a changed coherent generation or an
unchanged timeout. Typed semantic sections preserve their provenance and expose
no SQL, Git arguments, support payloads, or authority material. Inspection and
export are bounded result values. Other operation results retain
the direct observation, exact change facts, Control references, diagnostics,
and a self digest.

The Delivery generation digest is an opaque Runtime-derived staleness token,
not a self-digest that clients can reproduce and not a Process, authority, or
execution state. It binds the disclosed generation subject plus the digest or
absence of private active-operation support, so watch and optimistic staleness
checks observe private recovery progress without revealing its generation,
payload digest, bytes, coordinate, or physical mechanics.

An invalid final Agent submission can expose one retained diagnostic containing
only stable code, stage, and failure-facts digest. The public protocol does not
expose the semantic draft, physical workspace, provider output, or any live
validation command, callback, endpoint, token, or response; Foundation rc.10
defines no invocation-local validation exchange.

Execution Cells remain subordinate Runtime mechanics. Public Attempt and Check
views may expose only stable identities and outcome facts needed to explain the
Delivery: the selected Backend Profile and immutable Image, Specification and
Input Set digests, runner and terminal-observation digests, Output Manifest
availability and digest, Containment, and Runtime-owned Retirement. They do not
expose a Cell, Handle, allocation key, Backend coordinate, container or Docker
detail, private path, Reclamation state, or a second execution workflow.

Candidate continuity is the current logical Candidate Revision plus its
immutable Carrier-manifest binding. Candidate materializations are not public
identity, and terminal no-ship state is `abandoned`, not physical `disposed`.
The public operation vocabulary remains the nine Delivery mutations; Cell
allocation, dispatch, observation, retrieval, retirement, and reclamation are
never public operations or interface-selected transitions.
