# Local distribution source tools

The image builders require one clean exact Git revision, explicit
digest-selected base images, exact package versions, and an output tag. They
materialize that commit in a detached temporary snapshot and pass only that
snapshot to Docker. These local builders run separately from default source
checks.

`create-manifest.mjs` constructs a private manifest from explicit image
selections. `verify-distribution.mjs` checks its schema, source structure, and
launcher tests. The fixed template supplies package and protocol coordinates;
actual image identities come from the build selection.

`verify-release-source.mjs` checks that the manifest selects the exact clean
checked-out commit. `pack-distribution.mjs` builds that commit in a detached
temporary snapshot and stages the CLI package with the selected manifest and
digest sidecar. Invoke it through `npm run pack:distribution -- --manifest PATH
--destination DIRECTORY`, with an empty destination outside the source checkout.

`pack-qualification-fixture.mjs` stages the installed harness's private
`0.0.0-qualification` artifact and refuses a publishable identity. This helper
runs separately from default source builds and checks.

The [distribution overview](../overview.md) identifies source owners and
[provenance limits](../provenance/overview.md) describe the image-source boundary.
