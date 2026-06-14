# Semantic Authority Surfaces

## Purpose

Use this folder for Lifecycle semantic authority surfaces.

A semantic authority surface is a canonical home for one durable form of product
meaning. Semantic authority surfaces preserve what should be true after admission
or knowledge promotion.

Use [contract.md](contract.md) when reading, writing, updating, or checking
semantic authority entries during Lifecycle work.

Use [update-procedure.md](update-procedure.md) when deciding whether Discovery
or Delivery should create, update, defer, or skip semantic authority entries.

## Known Surfaces

The current semantic authority surfaces are:

```text
Context
Intent
Assurance
Blueprint
Description
```

Read the surface pages for the meaning each surface owns:

1. [Context](context.md)
2. [Intent](intent.md)
3. [Assurance](assurance.md)
4. [Blueprint](blueprint.md)
5. [Description](description.md)

## Surface Jobs

Each semantic authority surface owns one form of product meaning:

```text
Context: why this matters.
Intent: what behavior is intended.
Assurance: what must remain true.
Blueprint: how the system is structured.
Description: what local implementation surfaces are responsible for.
```

Together, these surfaces let agents retrieve the smallest sufficient semantic
authority slice before they act. In Delivery, that slice informs product
judgment; it does not admit behavior by itself.

The dependency direction is:

```text
Context -> Intent -> Assurance -> Blueprint -> Description -> implementation
```

Not every change needs every surface. A later surface may refine earlier
meaning, but it may not answer a question owned by an earlier surface. Use
[contract.md](contract.md) for the backpressure check when later work depends
on missing earlier semantic authority.

## Relationship To Lifecycle Roles

Semantic authority is one Lifecycle role. It sits beside target, proof,
observation, and Control records:

```text
semantic authority: admitted product meaning
target: code and deployed executable behavior
proof: evidence and proof status
observation: runtime observations
Control records: durable process state, including active product judgment
```

These roles answer different questions. Semantic authority says what should be
true. Target says what exists or executes. Proof says what was checked.
Observation says what happened after release. Control records say how Lifecycle
controlled work. Product judgment says which behavior the current Delivery is
about to accept after weighing those inputs; it is recorded in Control state,
not as a sixth semantic authority surface.

## Canonical Home Rule

Each kind of durable semantic meaning should have one canonical home.

Current homes:

```text
Business rationale belongs in Context.
Product behavior belongs in Intent.
Tenant isolation obligations belong in Assurance.
System structure belongs in Blueprint.
Local implementation responsibility belongs in Description.
```

Other surfaces point to the canonical home when they need that meaning.

Canonical home means the owning semantic authority surface and storage locator.
It does not require every surface to use a `records/` folder. Description uses
code-adjacent `_*.desc.md` files because local implementation responsibility is
most useful beside the source it describes.

## Agent Path

When a process needs product meaning:

```text
1. Identify the product area, behavior, obligation, interface, or target surface.
2. Retrieve the smallest relevant semantic authority slice.
3. Check entry state, scope, freshness, and related semantic authority.
4. During Delivery, weigh that slice into the active Work Boundary's product
   judgment before Build.
5. Use update-procedure.md when durable product meaning changed.
6. Record semantic authority update obligations in the active Work Boundary when Delivery is active.
```

Use surface pages for owned meaning. Use [contract.md](contract.md) for entry
adequacy, state, retrieval, references, and backpressure. Use
[update-procedure.md](update-procedure.md) for routing updates to the owning
surface.

The compile install workflow generates installed registry entries and entry
templates from [package-manifest.md](package-manifest.md). The manifest owns
surface-specific retrieval keys, target-reference guidance, adequacy checks,
promotion candidates, body-section guidance, and seed examples.
