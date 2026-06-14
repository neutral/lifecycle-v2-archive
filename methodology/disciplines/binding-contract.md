# Discipline binding contract

## Purpose

Use this page when writing or reviewing a binding inside a discipline
package.

A discipline binding connects package surface content to Lifecycle states. It
tells an agent when a package applies, which slices to retrieve, what state
effects follow, and what the Control record must preserve.

## Required fields

Each binding should define:

- `id`
- `name`
- `version`
- `status`
- `install_path`
- `discipline_sources`
- `selection_triggers`
- `non_selection_rules`
- `state_effects`
- `record_effects`
- `conflicts`

## State effects

A binding may affect these states:

- Discovery: identify candidate discipline when it affects selection or handoff.
- Work Boundary: admit selected discipline, adopted constraints, rejected
  constraints, conflicts, product judgment effects, and proof effects.
- Build: preserve admitted discipline constraints and route back when new
  material discipline changes product judgment, scope, risk, or proof.
- Proof: require evidence tied to discipline obligations.
- Closure: require discipline usage recording and promotion decisions.

## Thin binding rule

Keep bindings thin.

Substantive discipline facts belong in package surface content. A binding
should route to discipline, not duplicate full discipline content.

## Record effect rule

When a binding selects discipline that shapes the run, the active Control
record must include `disciplines_used`.

Required fields:

- package id
- package version
- discipline id
- discipline version or retrieval timestamp
- selected binding
- selected slice
- selection reason
- used rule, fact, constraint, or decision criterion
- effect on product judgment, including tradeoff, exclusion, falsifier, or proof
  consequence when applicable
- treatment: adopted, rejected, conflicted, or assumed
- effect on Work Boundary, Build, Proof, Closure, or promotion
- evidence that satisfied discipline obligations
- conflicts and their treatment
- promotion candidates

## Conflict rule

A binding must state how conflicts are recognized and routed.

Build must not proceed when a material discipline conflict is unresolved
or the conflict changes product judgment. Route to Work Boundary revision,
explicit rejection, or human decision.
