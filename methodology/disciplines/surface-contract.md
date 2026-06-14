# Discipline surface content contract

## Purpose

Use this page when writing or reviewing surface content inside a discipline
package.

A discipline content section is the reusable practice judgment
inside a package. It supplies constraints, distinctions, failure modes, proof
expectations, product judgment inputs, and adequacy examples for the package's
practice area.

## Required header

Each package should declare surface content in the package header:

```yaml
surface_id: ""
scope: ""
surface_install_path: ""
retrieval_slices: []
```

Field use:

- `scope`: work shapes and risks covered by the surface.
- `surface_id`: stable discipline content identifier.
- `surface_install_path`: installed runtime path for surface content.
- `retrieval_slices`: named slices an agent can retrieve narrowly.

## Required sections

Write these sections as package surface content:

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

## Content rule

State discipline judgment directly.

Do not write a Lifecycle process page in surface content. Lifecycle mechanics
belong in methodology. State-specific application belongs in package bindings.

## Selection criteria

Add package surface content when the practice area satisfies these conditions:

- the practice area captures common production failures or expert constraints
- general agents often miss important constraints
- reusable judgment can be sliced narrowly
- package bindings can map the judgment to existing Lifecycle states
- selected slices can shape product judgment without replacing it
- proof obligations can be made concrete
- promotion candidates can stay separate from process state

## Retrieval rule

Surface content should be sliceable. Each retrieval slice should be small
enough to use in a Work Boundary and complete enough to prevent agent guesswork.

Broad essays are not adequate package surface content for runtime use.

## Product meaning boundary

Discipline surface content does not own target product meaning.

If a run accepts a durable product-specific rule derived from discipline,
the rule must be promoted into the owning product semantic authority surface.
The generic discipline rule remains in discipline. One-run product judgment
stays in the active Work Boundary unless its durable meaning is promoted.
