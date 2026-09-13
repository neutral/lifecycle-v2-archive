# Lifecycle CLI launcher

This package implements the rc.17 `lifecycle` container launcher. It
selects exact Runtime and Execution Images through a private Distribution
Manifest and starts the canonical CLI in a foreground Runtime container.

The launcher requires Node.js 24.14.0 or newer and a local Linux-container
Docker Engine on macOS or Linux. A runnable installation requires the exact
manifest and its selected images. The source template contains the package
and protocol coordinates; manifest construction adds actual image digests.
The repository's source-build guide describes direct canonical CLI inspection.

`lifecycle setup --model <model-id> --reasoning <reasoning-id>` explicitly
acquires the manifest-selected images and stores private choices. Package
installation has no postinstall effect. `lifecycle doctor` checks those local
identities; it does not establish a runnable provider session or a Delivery
result. Provider authentication is separately provisioned at the private
Lifecycle machine home's `codex-exec-home/auth.json`.

A normal CLI invocation starts one foreground Runtime container over an
independent target repository. Linked Git worktrees and alternate object stores
are refused. The launcher forwards arguments and signals, reconciles only its
exact stale invocations, and contains the Runtime after launcher loss.
An uncertain Runtime effect requires the Runtime's retained recovery course;
repeating the command is not evidence that it is safe to redispatch.

The `lifecycle draft` branch starts only the selected Runtime Image with bounded
read-only file snapshots. It needs no target, installation configuration,
provider authentication, Director secret, or Docker socket mount. Its result is
advisory about the selected bytes and does not authorize or publish work.

`LIFECYCLE_MACHINE_HOME` selects private installation state; otherwise the
launcher uses `$XDG_STATE_HOME/lifecycle` or `$HOME/.local/state/lifecycle`.
Execution Cells never receive the canonical target repository, Docker socket,
Director secret, or Runtime-private state.

For source package assembly, select a canonical Distribution Manifest that
binds the current clean source commit and actual Runtime and Execution Images.
Run these commands from the source workspace root, using an empty package
output directory outside the checkout:

```sh
node distribution/scripts/verify-distribution.mjs --manifest /absolute/path/manifest.json
node distribution/scripts/verify-release-source.mjs --manifest /absolute/path/manifest.json
npm run pack:distribution -- --manifest /absolute/path/manifest.json --destination /absolute/path/package-output
```

The packer builds the selected commit in a detached temporary snapshot and
embeds the exact manifest and digest sidecar in the CLI package.

The Foundation specification is Draft. Source and launcher tests do not
establish installed-image operation, provider qualification, or conformance.
