# Distribution

This folder owns the source implementation for packaging and starting one exact
Lifecycle distribution. It coordinates existing product owners without taking
over their meaning:

```text
@neutral/lifecycle
  -> TypeScript/Node Runtime Launcher
  -> exact Distribution Manifest
       -> ghcr.io/neutral/lifecycle-runtime
       -> ghcr.io/neutral/lifecycle-execution
```

The npm package is the selected host entry. `lifecycle setup` explicitly
acquires the manifest-selected images and records bounded private launcher
configuration; package installation has no post-install effects. `lifecycle
doctor` reopens and verifies the local selection. All other CLI and TUI
arguments remain subordinate Runtime invocations rather than a second workflow
or protocol.

## Owners

- `package/` owns the pure Node launcher, the current `lifecycle` and
  `lifecycle-tui` bins, its external package README, and focused tests.
- `manifests/` owns the closed manifest, build-selection schemas, and the fixed
  source template. The private build selection records OCI index,
  platform-manifest, and configuration digests. The public package carries only
  the index and selected-platform configuration identities that the installed
  launcher can re-observe, plus its checked manifest digest sidecar.
- `runtime-image/` owns the Runtime Image assembly and the private parent-loss
  supervisor. It packages the existing protocol, Runtime, CLI, TUI, and exact
  executable dependencies; it does not reimplement them.
- `scripts/` owns local image construction, published-image inspection,
  manifest creation, verification, and artifact staging.
- `provenance/` records the distribution release and evidence boundary.
- `installers/` remains reserved until another implemented installation
  mechanism is selected. It is not a second supported route.

The launcher keeps its private support under
`<machine-home>/distribution/`, uses `<machine-home>/codex-exec-home` for the
separately provisioned provider home, and leaves
`<machine-home>/installation/` exclusively to the Runtime's installation
identity owner. Invocation containers are foreground mechanics. A private
heartbeat supervisor contains the Runtime after launcher loss, and a later
launcher retires only exact labeled containers belonging to the same state
root.

## Artifact route

Release inputs must come from one clean checkout whose `HEAD` equals the
selected source revision. Release builders then materialize that immutable
commit in a fresh detached local snapshot and use the snapshot, never the live
checkout, as their source and build context. The staged route is:

1. build both image platforms with `build-runtime-image.mjs` and
   `build-execution-image.mjs`;
2. separately authorize and publish the image indexes to the selected GHCR
   repositories with provenance and SBOM attachment manifests disabled for
   this first exact two-platform index (`--provenance=false --sbom=false`);
3. derive the canonical private build selection with
   `inspect-published-images.mjs` rather than transcribing digests;
4. create and verify the canonical manifest with `create-manifest.mjs`,
   `verify-distribution.mjs`, and `verify-release-source.mjs`;
5. stage the public tarball with `pack-distribution.mjs`; and
6. separately authorize npm publication of those exact bytes.

The repository currently implements steps that build, inspect, verify, and
stage artifacts. It does not contain a publisher, signing operation, release
orchestrator, or GitHub publication workflow, and no source coordinate claims
that npm or GHCR bytes already exist.

The inspector deliberately accepts exactly the two runnable Linux platform
manifests. Attestation manifests are deferred until their identities and
verification policy are represented explicitly; an external publication step
must not add them implicitly.

`pack-distribution.mjs` refuses a dirty or other-revision source. Repository
qualification uses `pack-qualification-fixture.mjs`, which preserves the same
launcher and packaged file inventory but emits a private
`0.0.0-qualification` package and a visibly non-release filename. That fixture
cannot be treated as a release artifact.
