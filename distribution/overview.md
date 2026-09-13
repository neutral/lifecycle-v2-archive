# Distribution

Distribution supplies the rc.17 CLI launcher and container assembly source.
The Node package exposes `lifecycle` and selects the Runtime and
Execution Images through an exact Distribution Manifest.

The launcher implements explicit `setup` image acquisition, read-only `doctor`
inspection, foreground Runtime launch, and parent-loss supervision. Runtime
semantics belong to `runtime/` and `spec-source/`. The separate read-only
`lifecycle draft` branch mounts only its explicit bounded file selections and
needs no target or provider custody.

A target invocation requires an independent target repository, an exact local
Docker Engine, the selected images, and separately provisioned provider
credentials. It maps Runtime-owned state and Docker capability into the trusted
Runtime container. Execution Cells receive neither the Docker socket nor
canonical target storage. Launcher cleanup does not decide a Delivery outcome.

## Source owners

- `package/` contains the Node CLI launcher and its focused tests.
- `manifests/` contains the private selection schemas and coordinate template.
- `runtime-image/` assembles protocol, Runtime, the pinned Atlas processor, Git,
  Node, and Docker CLI with the invocation supervisor.
- `scripts/` contains exact-source local image builders, manifest construction
  and verification, exact-source package staging, and private fixture staging
  for the installed harness.
- `provenance/` records the source and image provenance limits.

## Local construction

The [scripts](scripts/overview.md) build from a clean, explicitly selected Git
revision in an isolated temporary snapshot. Base images and package versions
remain explicit inputs. Generated manifests bind actual image identities.

`create-manifest.mjs` assembles those identities; `verify-distribution.mjs` and
`verify-release-source.mjs` check the manifest and exact clean source selection.
`npm run pack:distribution` stages the launcher package from that selection.
The scripts guide documents their explicit inputs and external output paths.

The [package README](package/README.md) describes launcher prerequisites and
operation. [Qualification](../qualification/overview.md) distinguishes source
tests, installed-package transport, and actual image and provider behavior.
The Foundation specification remains Draft; those boundaries support separate
claims.
