# Discipline package contract

## Purpose

Use this page when writing or reviewing a discipline package.

A discipline package is the operational install unit for reusable
practice judgment. It contains surface content, one or more bindings,
catalog metadata, version and provenance information, and adequacy
expectations.

## Core Rule

A package must be operationally complete.

Do not install bare surface content as discipline. Surface content
without a binding is reference material. It becomes usable discipline
only when a package also supplies at least one binding that tells an agent when
the package applies, which slices to retrieve, what state effects follow, and
what the Control record must preserve.

Do not install a binding without the discipline content it applies.

## Required Package Header

Each package should begin with a small structured header:

```yaml
package_id: ""
name: ""
version: ""
source_type: ""
discipline: ""
scope: ""
status: ""
provenance: ""
surface_id: ""
surface_install_path: ""
retrieval_slices: []
binding_ids: []
```

Field use:

- `package_id`: stable installable discipline package identifier.
- `name`: readable discipline package name.
- `version`: package version used for install and Control records.
- `source_type`: community, vendor, organization, or target-local source.
- `discipline`: named discipline the package governs.
- `scope`: work shapes and risks covered by the package.
- `status`: draft, current, deprecated, or archived.
- `provenance`: source basis for the discipline.
- `surface_id`: stable identifier for the package's reusable judgment.
- `surface_install_path`: installed runtime path for surface content.
- `retrieval_slices`: named slices an agent can retrieve narrowly.
- `binding_ids`: bindings shipped by the package.

## Required Package Sections

Each package should include surface content sections:

- purpose
- applies to
- does not apply to
- discipline concepts
- constraints
- recurring failure modes
- adequate proof
- inadequate proof
- examples
- version notes

Each package should include at least one binding section. Use this heading
shape:

```text
## Binding: <binding name>
```

## Binding Header

Each binding section should begin with a small structured header:

```yaml
id: ""
name: ""
version: ""
status: ""
install_path: ""
discipline_sources: []
selection_triggers: []
non_selection_rules: []
state_effects: []
record_effects:
  section: disciplines_used
conflicts: []
```

The binding `discipline_sources` must reference the package surface content.
A package may also depend on another package when cross-discipline is
needed, but the dependency must be explicit.

## Selection Criteria

Add a discipline package when the practice area satisfies these conditions:

- the practice area captures common production failures or expert constraints
- general agents often miss important constraints
- reusable judgment can be sliced narrowly
- bindings can map the judgment to existing Lifecycle states
- selected slices can explain their effect on product judgment, scope, proof,
  or promotion
- proof obligations can be made concrete
- promotion candidates can stay separate from process state

## Source And Runtime Shape

Author packages for maintainers. Install runtime files for target-agent
retrieval.

The source package can keep surface content and bindings in one readable file.
The compiler installs partial package info, generated surface content, and
generated bindings into separate runtime paths when that makes discovery,
slice retrieval, and audit easier for the target agent.

Installed package info preserves package identity, source location, source
hash, generated output paths, and package-to-runtime mapping. It is not the
full package source and is not a discipline surface.

## Product Meaning Boundary

A discipline package does not own target product meaning.

If a run accepts a durable product-specific rule derived from discipline,
the rule must be promoted into the owning product semantic authority surface.
The generic discipline rule remains in discipline. Any one-run product
judgment shaped by the package remains in the active Work Boundary unless its
durable product meaning is promoted.
