# Discipline catalog

## Purpose

Use this page to understand how a target agent should use
`.lifecycle/disciplines/catalog.md`.

The installed catalog is the discovery index for installed discipline
packages. It helps an agent find candidate bindings without reading every
generated surface.

## Catalog job

The catalog answers:

```text
What discipline is installed?
Which packages exist?
Which package info files describe selected package provenance?
Which bindings exist?
Which disciplines and work shapes do they cover?
Which triggers make each binding material?
Which discipline versions are available?
Where should the agent read next?
```

The catalog is not the discipline corpus. It should stay small enough to
read during Discovery or Work Boundary preparation.

## Use procedure

1. Read the catalog when the work may touch an area with installed discipline.
2. Match the Signal, file paths, target facts, and known risk against package
   binding trigger summaries.
3. Select only packages whose bindings materially apply to the current work.
4. Read the selected binding before reading the generated surface content.
5. Retrieve only the discipline slices named by the binding.
6. Admit the selected package, selected binding, adopted constraints, rejected
   constraints, conflicts, effects on product judgment, and proof effects in
   the Work Boundary before Build.
7. Record discipline usage in the active Control record when selected
   discipline shaped the pass.

## Material selection

Discipline is material when it can change at least one of these:

- Work Boundary scope
- product judgment, including accepted tradeoff, exclusions, or falsifiers
- accepted or rejected constraints
- Build guardrails
- Proof obligations
- escalation or reframe routing
- closure conditions
- promotion candidates

Do not select discipline because it is broadly related to the target repo.

## Multiple Disciplines

Multiple bindings may apply when the work crosses disciplines.

Keep each selected package and binding separate in the Work Boundary and Control
record. Do not merge form accessibility, authentication security, database
migration, framework routing, or organization policy into one vague note.

## Missing Discipline

If the work clearly belongs to a risky area but no installed discipline
applies, record the gap as an assumption or blocker in the active Control
record. Escalate when the missing discipline affects product meaning,
product judgment, security, irreversibility, runtime operations, or proof
adequacy.
