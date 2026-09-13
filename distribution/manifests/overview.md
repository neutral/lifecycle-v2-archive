# Private distribution manifests

This folder owns the rc.17 Distribution Manifest and build-selection schemas,
plus the fixed source coordinate template. Manifest construction binds those
coordinates to explicitly selected image identities.

The index digest selects image acquisition. Each platform's configuration digest
identifies the local image inspected by `doctor`. The private build selection
also records the platform-manifest digest. Those identities are distinct and
cannot substitute for one another.

The launcher verifies canonical manifest bytes and their digest sidecar. The
package name, image repositories, Foundation coordinates, and private invocation
protocol are fixed parser selections. A runnable manifest requires actual index
and platform configuration digests; the template does not supply them.
