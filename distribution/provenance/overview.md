# Source and image provenance

Local image builders use a detached snapshot of an explicitly selected clean
Git revision and exact dependency selections. A successful build or matching
inventory does not establish release provenance, qualification, or conformance.

The Atlas processor's exact upstream selection and license are recorded under
[`third-party/atlas-reference-validator/`](../../third-party/atlas-reference-validator/PROVENANCE.json).
The Execution Image source selects Codex `0.153.4`. Its exact package
integrities and executable inventories are in
[`package-lock.json`](../../runtime/execution-image/package-lock.json),
[`tool-inventory.linux-amd64.json`](../../runtime/execution-image/tool-inventory.linux-amd64.json),
and [`tool-inventory.linux-arm64.json`](../../runtime/execution-image/tool-inventory.linux-arm64.json).

The source records upstream tag object
`042fb41b7c813ac7999105e886b2b7aa715b5081`, peeled to source commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, for Codex `rust-v0.153.4`.
That recorded relationship does not establish reproduction of the selected
binary from source. Complete image license and binary-source provenance work
remains unverified. Tool inventories identify bytes; they are not whole-image
license inventories.

[Qualification verification](../../qualification/verification.md) describes the
separate source, installed-package, image, and provider evidence boundaries.
