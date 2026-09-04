# Foundation Verification

Run commands in this guide from the Lifecycle source repository root.
Installed-distribution and live Docker checks establish different evidence.
Neither authenticates publication or establishes conformance by itself.

## Current Coordinates

The rc.10 qualification route selects:

```text
qualification revision  lifecycle.foundation.1.0.0-rc.10
repository contract     lifecycle.repository.v15
runtime protocol        lifecycle.runtime.foundation.v10
interface protocol      lifecycle.interface.foundation.v10
provider adapter        lifecycle.provider-adapter.v6
distribution manifest   lifecycle.distribution-manifest.v1
runtime invocation      lifecycle.runtime-invocation.private.v1
public installation     @neutral/lifecycle@1.0.0
Codex compatibility     >=0.151.0 <0.152.0
qualified image tool    0.151.0
```

These are independent coordinates. A package version or a compatible Codex
version does not substitute for the exact Provider Descriptor, Execution
Backend Profile, immutable Execution Image, runner, Input Set, source
revision, and retained evidence selected by one operated row.

## Installed Distribution

```sh
npm run qualify:foundation-installed
```

The installed row assembles exactly one `@neutral/lifecycle@1.0.0` tarball with
one synthetic, canonical Distribution Manifest. It inventories the tarball,
installs it from an initially empty disposable npm cache with offline mode and
npm lifecycle scripts enabled, and proves:

1. the package contains only its README, two launcher bins, compiled launcher
   modules and declarations, exact manifest bytes and digest, and metadata;
2. it contains no npm lifecycle scripts, dependencies, authoring source,
   source maps, internal runtime/protocol/client packages, machine paths, or
   recognizable secret material;
3. packing and installation perform no Docker action and no implicit network
   acquisition;
4. explicit `setup` requests the Runtime and Execution Images from their GHCR
   repositories by the exact manifest index digests, verifies the selected
   platform configuration and required image labels, and writes only
   owner-private installation state;
5. `doctor` verifies the same exact local selections without pulling;
6. normal CLI and TUI invocations use `--pull never`, the exact Runtime Image,
   bounded mounts and environment, and unchanged runtime arguments; and
7. foreground output, exit status, and `SIGTERM` forwarding remain observable.

The Docker executable and Unix socket in this row are qualification-owned
fakes. They return exact synthetic engine and image observations and record the
launcher's requests; they do not contact a Docker daemon or GHCR and never
start a Runtime Image, Execution Image, Execution Cell, or provider. The row
does not initialize this source repository as a Lifecycle target. Its final
result reports this evidence limit explicitly.

## Real Docker Agent Cell

This live row also requires exact Atlas processor material supplied outside
this repository. The processor implementation is not vendored here.

```sh
LIFECYCLE_MACHINE_HOME=/absolute/private/machine-home \
LIFECYCLE_FOUNDATION_PROVIDER_MODEL=<exact-model-id> \
LIFECYCLE_FOUNDATION_PROVIDER_REASONING=high \
LIFECYCLE_DOCKER_PATH=/absolute/path/to/docker \
LIFECYCLE_DOCKER_HOST=unix:///absolute/path/to/docker.sock \
LIFECYCLE_DOCKER_CONFIG=/absolute/private/docker-config \
LIFECYCLE_EXECUTION_IMAGE_ID=<exact-image-id> \
LIFECYCLE_EXECUTION_IMAGE_DIGEST=sha256:<digest> \
LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE=<amd64-or-arm64> \
LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST=sha256:<digest> \
LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST=sha256:<digest> \
LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST=sha256:<digest> \
LIFECYCLE_EXECUTION_CODEX_VERSION=0.151.0 \
LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY=sha256:<digest> \
LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST=sha256:<digest> \
npm run qualify:foundation-provider
```

The machine home must already contain the fixed-runner authentication selected
by the current installation contract. Supplying these values authorizes only
this local qualification run. The harness treats them as private and never
prints their values.

All listed execution values are required as one exact set. The row refuses an
incomplete set, a Codex version other than `0.151.0`, a mutable image
reference, a non-local Docker endpoint, or a dirty/uncommitted source tree.
There is no host Codex executable selection or native-provider fallback;
provider execution occurs only inside the selected Execution Image.

A passing row creates a disposable fresh repository-v15 target and drives the
public v10 Delivery route through `prepare`, `admit`, `continue`, `evaluate`,
and `accept`. It verifies:

- three v3 Agent Attempts—reconnaissance, builder, and reviewer—through
  Provider Adapter v6;
- one passing baseline Check and one passing final Check through the same
  Docker Execution Backend;
- five exact Execution Cells bound to the retained capability grants, Backend
  Profile, Image, Input Sets, runner, observations, output, terminal
  classifications, synchronous containment, and permanent retirement;
- one exact Candidate Revision successor whose only changed path is
  `docs/qualification.md`, with canonical Git acceptance over the admitted
  parent;
- an acceptance-ready Evidence Packet, accepted Closure, archived Control
  Store reopening, and exact reproduction of the decision diff from the
  accepted target's Git objects;
- handoff and final Reclaimed standing for exactly the five Reclamation
  obligations created by that Delivery; and
- no public leakage of credentials, machine roots, or backend resource
  coordinates.

The Agent cell has product network `none`. Provider control is a
destination- and protocol-bounded fixed-runner service channel. The tool
subprocess receives a closed environment and never receives `CODEX_HOME`,
authentication bytes, proxy variables, or Docker authority.

The row proves only its exact source revision, image, Docker engine, provider,
model, platform, roles, target transition, and profiles. It does not prove
another provider or model, no-ship, parent-loss or injected-fault recovery,
publication, portability, or complete conformance.

## Recovery And Reclamation

Deterministic fault tests remain required for dispatch authority, observation,
cancellation, parent loss, output retrieval, containment, retirement, and
reclamation-ledger recovery. The live healthy row proves exact handoff and
Reclamation of its own five retired Cells; it does not replace those fault
tests or introduce a Runtime background drain.

Closure may rely on containment and retirement, not synchronous deletion of
every backend byte. Qualification must distinguish:

```text
containment  no process or writer can continue acting
retirement   the Execution Handle cannot dispatch or be reused
reclamation physical backend bytes are later removed and tracked exactly
```

If reclamation is incomplete, the runtime must retain a truthful bounded
obligation and apply its private allocation ceiling. It must not claim residue
is absent or expose private backend coordinates. The live row requires its
selected machine home to have no unrelated outstanding obligations, invokes
only the existing private exact Reclamation operation, and refuses to report
success until its five obligations are Reclaimed. This is qualification-owned
cleanup, not a scheduler, configurable policy, or public product operation.

## Conformance Boundary

The repository can prepare evidence against rc.10 while the specification
remains Draft. It cannot invent an authenticated Publication Statement, an
immutable final source revision, an independently maintained second
implementation, or an unrun qualification result. Until those exact gates
exist, portable format, Complete Lifecycle System, multi-provider,
cross-platform, production-readiness, publication, and conformance claims
remain prohibited.
