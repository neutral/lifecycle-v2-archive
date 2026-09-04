# Operated Qualification

`qualification/` owns repository-operated harnesses that cross a packaged,
installed, external-process, or multi-package product boundary. It is distinct
from the normative qualification package under
[`../spec-source/`](../spec-source/README.md). A successful harness run is
implementation evidence for its exact source revision and environment; it
cannot authenticate publication or create a conformance claim.

The current layout is:

```text
installed/  assembles, inventories, offline-installs, and exercises the sole public npm launcher
provider/   operates one terminal Delivery across real Agent and Check Execution Cells
support/    creates disposable target fixtures shared only by these harnesses
```

Run the installed-distribution row from the repository root:

```sh
npm run qualify:foundation-installed
```

That row proves the `@neutral/lifecycle@1.0.0` package and Runtime Launcher
boundary against one exact synthetic Distribution Manifest. It inventories
the sole tarball, performs a cold-cache offline install, proves that npm
installation has no lifecycle effects, and exercises explicit setup, doctor,
CLI, and TUI transport through a qualification-owned fake Docker executable
and Unix socket. It verifies exact digest acquisition requests, image
observation checks, owner-private configuration, bounded Runtime mounts and
environment, argument forwarding, terminal status, signals, and the absence of
implicit pulls.

The installed row does not contact GHCR, a Docker daemon, or a provider. It
does not run either image or initialize this repository as a Lifecycle target.
A passing row therefore is package and launcher evidence, not Runtime Image,
Execution Image, Execution Cell, provider, publication, or conformance
evidence. Those operated boundaries remain separate.

The live row is separate:

```sh
npm run qualify:foundation-provider
```

It requires one exact, already-built Agent Execution Image, the complete
Docker Execution Backend installation selection, and separately provisioned
fixed-runner provider authentication described in the
[`verification guide`](verification.md#real-docker-agent-cell). The harness
must fail closed when that environment is incomplete. It never substitutes
another execution route and never reports a skipped row as passed.

Execution Cells are subordinate mechanics. The live harness drives one fresh
Delivery through `prepare`, `admit`, `continue`, `evaluate`, and `accept`. Its
five Cells perform reconnaissance, a baseline Check, one productive builder
Attempt, a final Check, and independent review. The row verifies the exact
Candidate successor, Evidence, canonical Git result, Closure, archived Control
Store reads, and five Reclamation obligations through the runtime read surface
and private installed owners. Public evidence may bind immutable Backend Profile,
Image, runner, Input Set, output, terminal-observation, containment, and
retirement digests. It must not expose Docker container, network, volume,
credential, machine, or private-custody coordinates.

The harness drains only the five obligations created by its own Delivery and
proves their final Reclaimed standing. That bounded harness step is not a
Runtime scheduler, configurable capacity policy, or public Reclamation
workflow. Deterministic owner tests continue to prove interrupted and delayed
Reclamation behavior separately.

Package-local deterministic, integration, recovery, parent-loss, and fault
tests remain with their implementation owner. Promote a row here only when it
operates a real product boundary and its assertions establish that exact
evidence subject. Support fixtures are non-authoritative and disposable; they
are not examples, target templates, or copies of normative fixtures.

Credentials, authority material, Docker configuration, package caches,
installed prefixes, target repositories, Control Stores, Candidate Revision
Carriers, execution inputs and outputs, and run transcripts remain temporary
and untracked. The harnesses remove only custody they allocate themselves.

## Deferred qualification expansion

The formal-verification architecture identifies future operated rows without
claiming that those rows exist:

```text
repository/  real Git lease, drift, compare-and-swap, and parent-loss scenarios
control/     real SQLite, Store seal, archive, and interruption scenarios
execution/   real allocation, dispatch, observation, recovery, and retirement scenarios
formal/      exact release-evidence orchestration only if a formal result is required
```

Do not create one of these directories merely to reserve its name. A
repository, Control, or execution row moves here only when it operates an exact
built artifact across the named product boundary, fails closed when its
selected environment is unavailable, and reports its exact subject, fault
schedule, observations, limitations, and reproduction coordinates. A formal
row is admitted only when an exact model, configuration, pinned toolchain, and
release-evidence contract exist; any claim about product behavior additionally
requires a separately reviewed runtime mapping and the applicable exact-artifact
operated row.

Package-local reducer exploration remains with the Runtime implementation.
A model-checker result validates only its selected model and configuration
unless the mapping and operated evidence connect it to product behavior.
