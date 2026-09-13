# Source setup

## Requirements

- Git;
- Node.js `24.14.0` or newer; and
- npm.

Clone the repository and install its locked dependencies:

```sh
git clone https://github.com/neutral/lifecycle-v2-archive.git
cd lifecycle-v2-archive
npm ci
```

Build the workspace, then inspect the source CLI:

```sh
npm run build
npm run lifecycle -- version
npm run lifecycle -- help
```

The workspace includes the exact Atlas 0.8.0 processor under
[third-party/atlas-reference-validator/](../third-party/atlas-reference-validator/PROVENANCE.json),
with its upstream provenance and license. Foundation rc.17 selects authored
format 1, specification and processor revision
2c7a78540ac30138218b12803f1c045cee8b109a, and consumer contract
lifecycle.atlas-consumer.v2. Another Atlas version is not a compatible
substitute. The [Atlas integration contract](../spec-source/spec/ATLAS.md)
defines processor identity, exact source binding, and validation requirements.

Use a separate repository as a Lifecycle target. Its complete valid Atlas is
maintained independently from the Lifecycle implementation.

Operating a Delivery also requires physically separate private machine custody,
the Docker local-engine backend, an exact Execution Image, and privately
provisioned provider authentication. The source selects Codex `0.153.4` with
descriptor compatibility `>=0.153.4 <0.154.0`. Integration requires Git
`2.45.0` or newer at `/usr/bin/git`. The [Runtime overview](../runtime/overview.md)
describes those execution and target boundaries.
