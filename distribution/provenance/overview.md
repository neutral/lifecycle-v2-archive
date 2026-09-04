# Provenance

Distribution provenance binds a clean exact Git revision to both inspected OCI
indexes, the generated Distribution Manifest, and the final npm tarball digest.
Image and public-package construction consumes a fresh detached snapshot of
that immutable commit rather than reopening mutable source paths after the
clean-source decision. The local scripts emit those identities but do not
publish, sign, or create a release claim. Authenticated publication evidence
belongs to a later, separately authorized release operation and must not be
inferred from local build or qualification success.

## Third-Party Publication Gate

The Execution Image redistributes third-party executable bytes. Its exact tool
inventory proves which retained files were selected; it is not a license
inventory or a legal-compliance statement. No Execution Image release may be
published, and no coordinated npm release may be completed, until a release
review supplies the required license, notice, and source material to recipients
and binds that material to the exact image subject.

The current bounded source review established these coordinates and minimum
questions for that release review:

- OpenAI Codex `0.151.0` corresponds to `openai/codex` tag
  `rust-v0.151.0`, commit
  `78c290807ce710180111df227df3b7a4fe845452`. The Apache-2.0 `LICENSE`
  has SHA-256
  `d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc`,
  and the upstream `NOTICE` has SHA-256
  `9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915`.
  The release review must preserve the license and applicable NOTICE
  attribution; npm package metadata alone is not that carrier.
- The bundled ripgrep is upstream `15.2.0`, commit
  `e89fff89ac9af12e8d4ce9d5fd07beb408ca730f`. Codex selects the official
  `x86_64-unknown-linux-musl` archive with SHA-256
  `33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c`
  and the `aarch64-unknown-linux-gnu` archive with SHA-256
  `a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d`.
  If Lifecycle selects ripgrep's MIT terms, the exact `LICENSE-MIT` carrier,
  SHA-256
  `0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f`,
  and its copyright and permission notice must accompany the copy.
- The bundled bubblewrap corresponds to upstream `v0.11.2`, commit
  `1b80120ef26a28e065e67f89bfef873f13bdd317`. Its `COPYING` carrier,
  SHA-256
  `b7993225104d90ddd8024fd838faf300bea5e83d91203eab98e29512acebd69c`,
  contains the GNU Library General Public License version 2. The release review
  must determine and satisfy the applicable notice, corresponding-source, and
  relinking obligations for the exact shipped binary.
- The bundled zsh identifies upstream commit
  `77045ef899e53b9598bebc5a41db93a548a40ca6` plus OpenAI's
  `codex-rs/shell-escalation/patches/zsh-exec-wrapper.patch` from the Codex
  commit above; that patch has SHA-256
  `696b7d923b8071554d00e811afb9a08fcad4baada796f7314d12ecd72d06152c`.
  The upstream `LICENCE` carrier has SHA-256
  `d06fdf3ef9b1ec69d6b9e170b0a9516fbad3523261ff1668bde3bfea6e0ef5f5`;
  its copyright, permission, and warranty text must accompany copies. The zsh
  bytes in the selected npm platform packages do not match the separate OpenAI
  release assets at the same nominal build, so those assets must not be cited
  as the binary provenance.

This review does not establish that the required carriers must occupy a
particular path inside an OCI filesystem. They may instead be delivered by an
immutable companion mechanism that every image recipient receives. The current
source implements neither route, so publication remains blocked; this document
does not claim that either future route is legally sufficient.

These four retained tools are only the known bounded subset. Before
publication, produce and review a per-platform whole-image dependency and
license inventory for both the Execution Image and Runtime Image, including
base layers, operating-system dependency closures, language-runtime and package
dependencies, and bundled native components. Bind the reviewed result to the
exact OCI platform-manifest, configuration, and index digests. The Runtime
Image's Node, Bun, Docker CLI, Git, and their transitive dependencies are not
covered by the Execution Image tool inventory.
