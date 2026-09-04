# Manifests

This folder owns the implementation schemas for the canonical Distribution
Manifest and its private build selection, plus the fixed source template. A
release manifest is generated outside the tracked source package after both
multi-platform images exist. It is then validated, embedded in the staged npm
artifact, and accompanied by a digest sidecar checked by the launcher.

Published-image inspection retains each OCI platform-manifest digest in the
private build selection. The public manifest projects the immutable index
digest and each selected platform's Docker configuration digest because those
are the acquisition and installed identities that `setup` and `doctor` can
re-observe without contacting a registry.

Generated release manifests are not committed here. The fixed template names
the selected package, GHCR repositories, Foundation coordinates, and private
invocation protocol without pretending that image digests already exist.
