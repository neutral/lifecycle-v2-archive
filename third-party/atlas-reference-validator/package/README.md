# Atlas reference validator

This package is the reference implementation of the Atlas 0.8.0 structural and resolved profiles. It validates strict text and JSON front matter, structural discovery, anchor/context Point groups, substantive Markdown blocks, explained Area memberships, and unique routing questions. It does not score prose length. Resolved validation covers registered Resources, relation notes, supersession, Checks, publication selections, local path safety, and deterministic normalized output.

A complete valid resolved result establishes format validity only. Atlas-local Check compliance and semantic, evidence, usefulness, or product claims remain separate contracts.

Install the workspace from the repository root:

```sh
corepack pnpm@11.22.0 --dir apps install --frozen-lockfile
```

Validate an Atlas:

```sh
corepack pnpm@11.22.0 --dir apps exec atlas-validate "/absolute/path/to/project/atlas" \
  --profile neutral.atlas-validator.resolved \
  --json
```

Validate the fixture matrix:

```sh
corepack pnpm@11.22.0 --dir apps exec atlas-validate \
  --fixtures ../spec-source/examples/manifest.json
```

The CLI reports specification revision `0.8.0` by default. Use `--specification-revision` to record a more specific immutable revision when required.

The CLI exits with `0` for a complete valid result or matching fixture matrix, `1` for a complete invalid result or fixture mismatch, and `2` for invalid usage or an incomplete result. JSON output conforms to the versioned schemas packaged in `schemas/`.
