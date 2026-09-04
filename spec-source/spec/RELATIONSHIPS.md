# Lifecycle Knowledge Relationships

> Status: Draft

## Purpose

This document defines the typed relationships between governed Knowledge
records, their admissible source and target kinds, authority meaning, graph
constraints, projection effects, and conflict behavior.

Relationships make the semantic waist navigable and compilable. They do not
transfer ownership. A target remains governed by its own record kind and
revision.

## Edge Form

Each relationship edge in a Knowledge record contains:

- `type`, one standard relationship type;
- `target`, one stable Knowledge record identifier;
- `required`, a boolean indicating whether unresolved target identity makes the
  source record invalid for current use;
- `scope`, an optional bounded explanation of where the relationship applies;
- `rationale`, an optional concise explanation when the edge is not obvious;
- `x-*`, optional extension fields that do not change standard meaning.

The source is the record containing the edge. The target identifier resolves
through the same exact Knowledge Set.

A required edge from a current record MUST resolve to a current compatible
target. A non-required edge can resolve to current or historical material, but
its absence or historical state MUST be reported in the Knowledge Set and MUST
NOT be used to establish mandatory closure.

Relationship arrays are sets. Repeating the same type and target is invalid.
Ordering has no authority meaning.

## Standard Relationships

### `refines`

The source expresses a more specific form of the target's meaning.

Allowed source and target pairs are:

- Behavior to Behavior;
- Assurance to Assurance;
- Blueprint to Blueprint;
- Check Definition to Check Definition.

A Description does not refine Product Knowledge; it realizes and explains
implementation-local meaning.

`refines` MUST be acyclic among current records. Refinement does not supersede
the target. Both records can remain current when their scopes are compatible.
A more specific record MUST NOT contradict the target inside their overlapping
scope.

### `constrains`

The source Assurance imposes an obligation or limit on the target.

The source MUST be an Assurance. The target can be a Behavior, Blueprint,
Description, or another Assurance.

The target does not absorb the Assurance. A compiler selecting the target MUST
include every current incoming required `constrains` edge applicable to the
selected scope.

### `realizes`

The source supplies a structural or implementation realization of target
meaning.

Allowed source kinds are Blueprint and Description. Allowed targets are
Behavior, Assurance, Blueprint, and Description, subject to these rules:

- a Blueprint can realize Behavior, Assurance, or a more general Blueprint;
- a Description can realize Behavior, Assurance, Blueprint, or a more general
  Description;
- a source MUST NOT claim that realization transfers the target's authority;
- a target can have several realizations when the product intentionally has
  several components or implementations.

`realizes` is evidence of intended alignment, not proof that code conforms.
Description coverage and final evidence establish result reality.

### `verified-by`

The source requires the target Check Definition as evidence support.

The target MUST be a Check Definition. The source can be Behavior, Assurance,
Blueprint, Description, or Check Definition.

A current Behavior and Assurance MUST each have at least one required
`verified-by` edge. A Check Definition can use `verified-by` to require a
supporting Check when its proposition depends on another independently
assessable condition.

`verified-by` MUST be acyclic among Check Definitions. A passing target Check
Receipt does not automatically establish the source record; acceptance still
judges the applicable proposition and limits.

### `depends-on`

The source requires the target's continued structural or implementation-local
contract to remain coherent.

Allowed source and target kinds are Blueprint and Description. A Behavior or
Assurance dependency belongs in product meaning or scope rather than this
technical relationship.

`depends-on` cycles are permitted because real systems can have reciprocal
contracts. A processor MUST identify strongly connected components in the
Knowledge Set. A Projection MUST include the complete component whenever it
includes one member through a required dependency.

### `related-to`

The source and target have useful navigational overlap that does not fit another
standard relationship.

Any governed kind can relate to any other governed kind. `related-to` is
non-authoritative and MUST have `required: false`. It never enters mandatory
closure by itself and MUST NOT substitute for a precise relationship.

### Supersession

Supersession is not a normal relationship edge. It uses the universal
`supersedes` field because it changes currentness and revision identity.
`related-to` or `refines` MUST NOT be used as a weaker replacement for required
supersession.

## Relationship Matrix

| Type | Source | Target | Transfers authority | Mandatory closure effect |
| --- | --- | --- | --- | --- |
| `refines` | Behavior, Assurance, Blueprint, Check | same kind | no | include target; include selected incoming refinements when boundary selects a family |
| `constrains` | Assurance | Behavior, Assurance, Blueprint, Description | no | include source when target is selected and edge is applicable |
| `realizes` | Blueprint, Description | Behavior, Assurance, Blueprint, Description | no | role-dependent; builder/reviewer include applicable realizations |
| `verified-by` | any governed kind | Check | no | include target and compatible bindings |
| `depends-on` | Blueprint, Description | Blueprint, Description | no | include target and complete required dependency component |
| `related-to` | any | any | no | reachable context only |

## Direction and Inverse Indexes

Records store edges in the direction defined above. A conforming Knowledge Set
processor MUST build inverse indexes because mandatory closure often begins at
the target:

- selecting a Behavior requires incoming Assurances that `constrain` it;
- selecting a Behavior or Assurance can require incoming Blueprints and
  Descriptions that `realize` it for builder or reviewer roles;
- selecting an implementation path requires the Description that covers it and
  the records that Description realizes or depends on.

An inverse index is derived data. It MUST identify the exact source record and
edge digest. It cannot create an edge absent from source authority.

## Scope

A relationship can include `scope` to limit its applicability. Scope is concise
plain text in format version 1, not an executable predicate.

A current required edge whose applicability materially depends on ambiguous
scope is a projection condition. The compiler MUST NOT silently include or
exclude it based on model judgment. Reconnaissance can resolve the ambiguity by
selecting a narrower Work Boundary or proposing a governed Knowledge change.

Future versions can add machine-evaluable scope only through a new format
version. An `x-` extension MUST NOT change whether a standard edge is required.

## Graph Constraints

A complete Knowledge Set MUST satisfy:

1. every required edge resolves to one current compatible target;
2. no standard edge targets its source unless the type explicitly permits it;
3. `refines`, Check-to-Check `verified-by`, and supersession are acyclic;
4. every required `depends-on` strongly connected component is internally
   complete;
5. a current record does not depend authoritatively on a draft, superseded, or
   retired target;
6. no edge changes another kind's ownership;
7. a relationship source and target digest are part of the Knowledge Set
   digest; and
8. path moves do not change edges because edges use stable identifiers.

A processor reports unusually large dependency components as warnings because
they can indicate an unhelpfully broad semantic waist. Repository-bound node,
edge, and per-node degree limits are hard resource bounds: crossing one makes
the relationship stage incomplete rather than authorizing a partial graph.

## Closure Rules

Projection begins from exact roots declared by the Work Boundary, affected
artifacts, and role. It then applies a fixed-point traversal.

The universal mandatory closure includes:

- every selected root;
- every required outgoing `refines` target;
- every applicable required incoming `constrains` source;
- every required outgoing `verified-by` Check;
- every required outgoing `depends-on` target and complete dependency component;
- every current supersession fact needed to prove the selected revision is
  current; and
- every compatible Check Binding required by an included Check Definition.

Role additions are:

- **reconnaissance** includes incoming current refinements, constraints, known
  realizations, exact normalized Atlas Point-record and Resource provenance,
  and related records needed to make product judgment;
- **builder** includes applicable incoming realizations, Description coverage for
  affected implementation, implementation locators, and Check execution
  guidance;
- **reviewer** includes the builder closure plus the exact sealed diff, affected
  coverage, receipts, and every record touched by an acceptance proposition;
- **acceptance support** includes the minimum exact authority and Evidence
  closure needed to explain the subject without changing it.

`related-to` records enter only the reachable-context index unless an explicit
Work Boundary root or another mandatory edge requires them.

Traversal MUST be deterministic and independent of filesystem enumeration,
record insertion order, provider behavior, or model ranking. Projection defines
the exact ordering and bounds.

## Conflict Rules

Relationship validity is not semantic agreement. A complete processor MUST also
surface material conflicts detectable from structured facts or explicit
conflict declarations.

Every record has the universal `conflicts` field defined by
[Knowledge](KNOWLEDGE.md). Only Assurance and Blueprint can declare a nonempty
array. Each declaration binds one same-kind target and two exact structured
facts, and the target MUST carry its exact reciprocal mirror. A processor
rejects malformed, fact-missing, wrong-kind, unavailable-target, and unilateral
declarations. One valid reciprocal pair produces one ordered conflict result.

A compiler MUST detect and report at least:

- two current revisions of one identity;
- incompatible Description primary coverage;
- a required relationship to a non-current target;
- a Behavior inclusion that another selected Behavior excludes by exact
  identifier or declared scope;
- a reciprocal Assurance `assurance-limit` pair over exact `limits` facts;
- a reciprocal Blueprint `blueprint-constraint` pair over exact `constraints`
  facts; and
- a Check Definition whose required binding cannot provide its declared
  evidence kind or freshness.

When prose appears conflicting but structured data cannot establish the fact,
the compiler can report `indeterminate-authority-conflict` with both exact
sources. It MUST NOT manufacture a universal conflict declaration or ask the
projection model to resolve the conflict silently. No `x-conflicts-with`
extension has standard meaning.

## Change Impact

A Knowledge change processor MUST compute incoming and outgoing impact before a
current record changes or is superseded.

The impact set includes:

- records with required edges to the changed identity;
- Work Boundaries or active attempts bound to the changed revision;
- Description coverage and governed implementation roots affected by the
  change;
- Check Definitions and Bindings reachable through `verified-by`;
- exact normalized Atlas Point records or Resources that cite the changed
  record, reported only as a separate-maintenance impact and never as a
  Delivery write; and
- cached Knowledge Sets and Projections containing the prior digests.

The impact result is advisory for planning but exact for invalidation. A cache or
active subject whose bound digest changed MUST NOT be reused as current.
