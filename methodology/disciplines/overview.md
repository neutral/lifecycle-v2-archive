# Discipline

## Purpose

Use this folder for source methodology that lets a target agent discover,
select, apply, prove, and record discipline during Lifecycle work.

Discipline is reusable practice judgment that can constrain Lifecycle work
when selected. It supplies framework constraints, standards, organization
policy, production failure modes, and proof expectations without becoming target
product meaning by default.

During Delivery, selected discipline informs product judgment. It can
change what behavior is acceptable, which tradeoff is chosen, what must be
excluded, and what proof follows. It does not decide product behavior by itself.

Discipline is installed as operationally complete packages. A package
contains reusable surface content and one or more bindings. Surface content
without a binding is reference material, not usable discipline.

## Runtime model

Installed discipline lives beside installed methodology:

```text
.lifecycle/
  methodology/
    disciplines/
  disciplines/
    catalog.md
    package-info/
    bindings/
    surfaces/
    cache/
    discipline.lock
```

Use `.lifecycle/methodology/disciplines/` for process guidance. Use
`.lifecycle/disciplines/` for installed package info, generated runtime
material, and runtime discovery.

## Authority boundary

Discipline can constrain a run. Product semantic authority owns target
product meaning.

Use this placement rule:

```text
discipline material -> .lifecycle/disciplines/
used discipline effect -> records/control/<active Control record>
accepted Context, Intent, Assurance, or Blueprint meaning -> records/<owning semantic authority surface>/
accepted Description meaning -> code-adjacent **/_*.desc.md files
```

When discipline shapes a pass, the active Control record must record the
used discipline material and its effect on product judgment, scope,
constraints, proof, or promotion. A pointer to ignored local files is not
enough.

## Source files

Use these pages together:

- `catalog.md`: how target agents use the installed catalog.
- `package-contract.md`: how complete discipline packages are written.
- `surface-contract.md`: how package surface content is written.
- `binding-contract.md`: how package bindings apply surface content to states.
- `use-discipline.md`: end-to-end runtime procedure.
- `checks/usage-adequacy.md`: adequacy check for selected discipline packages.

## Implementation rule

Do not add discipline-specific process branches when a discipline package can
express the need.

The stable Lifecycle process owns state movement, product judgment, admission,
proof, closure, Control records, and product meaning promotion. Discipline
supplies reusable practice judgment through package selection, bindings,
retrieved slices, and recorded state effects.
