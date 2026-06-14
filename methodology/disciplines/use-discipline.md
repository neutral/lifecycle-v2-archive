# Use discipline

## Purpose

Use this procedure during target-codebase work when the current Signal or work
shape may be governed by installed discipline.

## Procedure

1. Read `.lifecycle/disciplines/catalog.md` when the Signal, target facts,
   touched files, or risk shape suggests installed discipline may apply.
2. Select only discipline packages whose bindings materially match the
   work.
3. Read the selected binding under `.lifecycle/disciplines/bindings/`.
4. Retrieve the smallest useful generated surface slice under
   `.lifecycle/disciplines/surfaces/`.
5. During Work Boundary, record selected package, selected binding, retrieved
   slices, adopted constraints, rejected constraints, conflicts, assumptions,
   effects on product judgment, and proof effects.
6. During Build, preserve admitted discipline constraints. Return to Work
   Boundary when implementation discovers new material discipline, changes
   product judgment, changes classification, expands scope, or changes proof.
7. During Proof, tie evidence to discipline obligations.
8. During Closure, confirm discipline usage is recorded and decide whether any
   product-specific statement should be promoted.

## Work Boundary requirement

Before Build, the Work Boundary must answer these questions when discipline
is selected:

- Which discipline was selected?
- Which package was selected?
- Which binding selected it?
- Which slice was retrieved?
- Which material rule, fact, constraint, or criterion matters?
- How did it affect product judgment, tradeoffs, exclusions, or falsifiers?
- Which constraints were adopted?
- Which constraints were rejected and why?
- Which proof obligations came from discipline?
- Are any conflicts unresolved?

## Build route-back rule

Return to Work Boundary when Build discovers:

- a new material discipline
- a new selected slice that changes product judgment, tradeoffs, exclusions,
  falsifiers, scope, risk, or proof
- a conflict with product semantic authority
- a conflict with organization discipline
- a migration, security, billing, permission, tenant, runtime, or irreversible
  concern that was not admitted

## Proof rule

Proof must map evidence to discipline obligations.

A passing generic test suite is not enough when selected discipline
required discipline-specific evidence.

## Promotion rule

Discipline can create a promotion candidate. The candidate must be
rewritten as a product-specific accepted statement before entering product
semantic authority.

Do not copy generic discipline rules into semantic authority storage.
Do not copy one-run product judgment into semantic authority storage.
