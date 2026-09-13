# Lifecycle

Lifecycle keeps agent-driven software change coherent from intent to
acceptance. It provides semantic continuity across replaceable agents,
sessions, workspaces, and execution environments by preserving the
relationships among meaning, reversible work, Evidence, authority, and
canonical change.

Its invariant is:

> only admitted behavior can ship

This repository contains the Lifecycle Foundation `1.0.0` specification,
protocol, runtime, canonical command-line interface, distribution source, and
qualification harnesses. The selected Foundation revision is rc.17.

## Build from source

Lifecycle requires Git, Node.js `24.14.0` or newer, and npm.

```sh
git clone https://github.com/neutral/lifecycle-v2-archive.git lifecycle
cd lifecycle
npm ci
npm run build
npm run lifecycle -- version
```

See [installation](docs/installation.md) for the source setup and
[getting started](docs/getting-started.md) for the Delivery model.

## Repository map

- [`spec-source/`](spec-source/README.md) — Foundation specification, schemas,
  fixtures, and implementation record.
- [`protocol/`](protocol/overview.md) — shared public requests, results, read
  models, digests, and validation contracts.
- [`runtime/`](runtime/overview.md) — Foundation runtime, canonical CLI,
  repository contract, Delivery Process, Evidence, authority, and recovery.
- [`distribution/`](distribution/overview.md) — npm launcher and Runtime and
  Execution Image assembly source.
- [`qualification/`](qualification/overview.md) — installed-package and
  operated provider-boundary harnesses.
- [`docs/`](docs/overview.md) — installation and usage guidance.
- [`third-party/atlas-reference-validator/`](third-party/atlas-reference-validator/PROVENANCE.json)
  — the exact Atlas 0.8 processor dependency and its provenance.

## License

Lifecycle's first-party source is offered under your choice of
[Creative Commons Zero v1.0 Universal](LICENSE.CC0-1.0) or the
[Zero-Clause BSD license](LICENSE.0BSD), expressed as
`CC0-1.0 OR 0BSD`. See [LICENSE](LICENSE) for the selector.

Questions and focused feedback are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md).
