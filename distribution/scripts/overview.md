# Scripts

These scripts implement the local distribution artifact pipeline. Image
builders require one clean exact source revision and explicit digest-selected
base images and package versions. They clone the selected immutable commit into
a fresh detached temporary source snapshot, and Docker receives only that
snapshot as build context. Published-image inspection derives platform and
configuration identities from GHCR rather than accepting manual digest
transcription. Manifest verification, release-source verification, and package
staging remain separate gates.

The image builders disable implicit provenance and SBOM attestations. The
current published-image inspector accepts exactly two runnable platform
manifests; a release publisher must preserve `--provenance=false --sbom=false`
until attestation identities are added deliberately.

No script in this folder publishes to npm or GHCR. `pack-distribution.mjs`
creates a release-shaped tarball only from a clean exact source.
`pack-qualification-fixture.mjs` creates a private, visibly non-release package
for installed-path testing from an in-progress checkout.
