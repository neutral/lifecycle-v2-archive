# Semantic authority surface contract

## Purpose

Use this page when reading, writing, updating, or checking semantic authority
entries.

Use [overview.md](overview.md) for the semantic authority surface set.

Use [update-procedure.md](update-procedure.md) when deciding whether to create,
update, defer, or skip semantic authority entries during Lifecycle work.

Use [../../processes/control/overview.md](../../processes/control/overview.md) for
Control records. Control records preserve process state; semantic authority
entries preserve durable product meaning.

Product judgment belongs to the active Work Boundary, not to a semantic
authority entry. Semantic authority entries inform the judgment and may later
receive durable learning extracted from it through knowledge promotion.

## Agent path

When a process needs product meaning, use this path:

```text
1. Identify the product area, behavior, obligation, interface, or target surface.
2. Retrieve the smallest relevant semantic authority slice through entries,
   stable IDs, scope, and related semantic authority.
3. Confirm entry state, scope, freshness, and supersession.
4. Follow related semantic authority and target-surface references when they
   affect the current work.
5. In Clarity, use the retrieved authority to route, review, canonicalize, and
   prove Context retrieval.
6. In Delivery, weigh the retrieved authority into product judgment before
   Build.
7. Record required semantic authority updates in the active Clarity Boundary,
   Context Review Packet, or Work Boundary according to the active process.
8. Update entries only through the semantic authority update path, knowledge
   promotion, or bounded Clarity review.
```

The goal is small current authority plus the few related-entry and
target-surface references needed for the current Clarity, Discovery, or
Delivery run.

## Entry minimum

Each semantic authority entry should make these fields easy to find:

```text
id
surface
state
scope
current meaning
retrieval keys
target references, when they are part of owned meaning
related semantic authority IDs
supersedes and superseded by
updated date or freshness basis
```

Compact entries may combine fields when the meaning is obvious. They should not
omit state, scope, supersession, or related entries that future work needs for
safe retrieval.

The YAML header is the shared entry contract. Keep it standard for every entry
on a surface. Use the Markdown body below the header for the smallest
surface-specific sections needed to make the entry usable as future authority.
Generated templates may offer common body shapes, but those shapes do not
change the required header fields or create separate sub-surfaces.

## Product Entry Provenance Boundary

Semantic authority entries preserve durable product meaning. They do not depend
on product judgment, Work Boundaries, Evidence Packets, Landing Packets,
closure records, Discovery records, old source-material paths, proof logs,
runtime notes, or agent summaries as current product authority.

Keep those materials in their owning Control records, proof records,
observation records, archive decisions, hardening notes, or source-material
workspace. They may explain how the entry was created, but future work should
not need to reopen them to use a current and scoped semantic authority entry.

When a semantic authority entry depends on other durable product truth, name
the related semantic authority entries in `related_surfaces`. Use
`target_references` only for owned implementation surfaces. Do not use a
`source_basis` field in semantic authority entries.

Retrieval keys are finding aids. They do not create authority beyond the entry's
state, scope, current meaning, and owning semantic authority surface.

Context may reference Intent, Assurance, Blueprint, and Description entries as
scoped retrieval links when those later entries depend on the Context or must
be considered with it. This does not reverse semantic authority backpressure:
later surfaces still cannot answer missing Context-owned rationale, user,
strategy, direction, alternatives, or scope meaning.

Target references name implementation surfaces only when those surfaces are
part of the entry's owned meaning. They are not proof registries and they do
not make target behavior authoritative by themselves.

## Surface storage

Each semantic authority surface has one storage locator in the installed
registry. The registry field is named `storage_locator`. It may be a
`records/` folder or a code-adjacent file pattern.

Context, Intent, Assurance, and Blueprint use `records/` folders. Description
uses code-adjacent `_*.desc.md` files. This changes retrieval and write
placement only; it does not change Description's authority role, entry
minimum, state model, backpressure, or promotion path.

The storage locator gives a surface its home; it does not require the surface
to be physically flat. Context may use product-area folders, area overviews,
cluster overviews, and topic leaves under `records/context/` when a broad
corpus needs visible product neighborhoods. Stable entry IDs remain semantic
identity. Paths and folders are retrieval, orientation, and maintenance
affordances unless a current entry admits that organization as product meaning.

## Tool Tracing Boundary

Semantic authority entries should be traceable without making tools authority
admission actors.

Stable entry id, surface, state, scope, retrieval keys, target references,
related semantic authority, and supersession let tools identify likely affected
semantic authority surfaces. Tool traces are observations. They do not discover
product meaning, admit product meaning, or prove target behavior.

When a tool trace matters, record the interpreted effect in the active Work
Boundary, Evidence Packet, knowledge promotion decision, archive decision, or
owning semantic authority entry through the normal update procedure. Use
likely-affected language until the agent has interpreted the relationship.

## Entry Adequacy Standard

Semantic authority entries are operating authority for future work. They are not
closure annotations.

An entry is adequate only when a future agent can use it to make the next
product or implementation decision without reopening the Delivery run that
created it.

Before treating an entry as `current`, confirm it answers:

```text
What product or implementation meaning does this entry own?
What decisions may it govern?
What does it explicitly not govern?
What checks, constraints, or edge cases matter for future work?
What target surfaces or related semantic authority entries must be considered?
What would make the entry stale or insufficient?
```

If the generated template offers body shapes, choose the closest one and delete
irrelevant sections. Do not fill unused body sections with placeholder text, and
do not move process evidence into the body to make a shape look complete.

Do not satisfy a semantic authority update obligation with a thin summary,
record title, proof note, or statement that only says the work happened. The
entry must preserve durable meaning that can guide future interpretation,
change, proof, or refusal.

## Required Checks

An entry may bind executable Required Checks: committed commands that
demonstrate the entry's owned meaning against the current target. Intent
entries bind checks that demonstrate admitted behavior. Assurance entries bind
checks that would catch a violation of what must remain true.

A Required Check does not admit behavior. It makes admitted behavior
observable. A passing check never establishes that the checked behavior is
wanted, current, complete, or correctly scoped. Admission stays with the
active Work Boundary, and prose keeps the meaning checks cannot carry.

Each Required Check binds:

```text
a stable proof obligation id
a committed check command, registered as a proof command in the shared tool
configuration (lifecycle.tools.json) when tool support is present
an environment requirement: what must be running or available for the check
to execute
a last_held line: the date and result of the most recent run that held
```

The entry's Required Check section, the committed check script, and the proof
command registry must agree. When they disagree, the binding is broken and the
check makes no claim until the binding is repaired.

Keep proof receipt ids out of entries. Receipt freshness hashes entry content,
so an embedded receipt id stales itself on every entry update. `last_held`
carries date and result only; receipts stay in their owning tooling support
and Evidence Packets.

Check failure is a breach, not demotion. The entry stays current, landing is
blocked for the entry's scope, and the breach becomes a new Signal. Do not
demote the entry or edit its meaning to make a failing check pass: either the
target violates admitted meaning or the meaning itself changed, and each is
its own run.

A `last_held` older than relevant target change makes no claim about the
current target. Re-run the check before relying on it as current proof
support.

Scope limits, taste, posture, and exclusions that resist executable form stay
prose beside the checks, in `What Passing Does Not Prove` or the owning body
sections. Falsifiers that can be exercised should be: prove a check can fail
before trusting that it passes.

## Semantic Authority Backpressure

Semantic authority surfaces decompose product meaning until the path to
implementation is clear enough to build and prove.

Use this dependency direction:

```text
Context -> Intent -> Assurance -> Blueprint -> Description -> implementation
```

The sequence is not a requirement to create every surface for every change. It
is a check against unsupported assumptions. A later surface may refine earlier
meaning, but it may not answer a question owned by an earlier surface.
Earlier surfaces may reference later surfaces for scoped retrieval and
dependency awareness when a future agent must consider the connected authority
slice; those links do not move ownership of the earlier meaning.

Stop the current semantic authority transition when:

```text
Intent work needs product rationale, user, direction, or scope meaning missing
from Context.
Assurance work needs behavior, rationale, risk tolerance, or scope meaning
missing from Context or Intent.
Blueprint work needs behavior, obligation, dependency basis, state meaning, or
boundary meaning missing from Context, Intent, or Assurance.
Description work needs behavior, obligation, structure, ownership, or boundary
meaning missing from Intent, Assurance, or Blueprint.
Implementation work needs behavior, obligation, structure, or local
responsibility meaning missing from the relevant semantic authority slice.
```

Common signs of backpressure:

```text
The agent writes product rationale into a later surface, code, or tests.
The agent chooses a dependency without rationale, obligations, or boundary.
The agent defines risk tolerance in tests, implementation, or Description.
The agent assigns module responsibility before the structural boundary is clear.
The agent expands behavior because product direction is vague.
The agent relies on obvious user value that no Context entry supports.
The agent cannot write a proof obligation without inventing expected behavior.
The agent cannot state a declared non-change because scope boundaries are missing.
```

When backpressure appears, stop the current transition. Name the missing
meaning, name the owning earlier semantic authority surface, update or create
the smallest earlier entry needed, then re-run the original authority check. Do
not compensate by burying the missing meaning in a later surface or in
implementation.

## Entry states

Use semantic authority entry state to decide whether an entry may govern work:

```text
candidate: proposed meaning; not authority.
admitted: accepted into the surface but may need currentness check.
current: may govern when scoped.
provisional: may guide work inside stated limits.
stale: useful for interpretation, not safe as current authority.
superseded: replaced by another entry.
deprecated: being phased out under stated conditions.
archived: history only.
```

An entry can govern work when it is admitted, current, scoped, and free of a
newer unresolved contradiction.

## Retrieval

Retrieve entries through the surface's job:

```text
stable ID
scope
owned meaning
entry state
retrieval keys
related semantic authority
target surface, when Description owns local implementation meaning
```

The entry contract stays limited to identity, surface, state, scope, owned
meaning, retrieval keys, target references, related semantic authority,
freshness, supersession, and update ownership.

Use retrieval keys to avoid reading the whole product history. If an agent must
read broad history to find current authority, the relevant entry is probably
missing stable identity, scope, state, retrieval keys, target references, or
supersession.

For broad Context, retrieve through the atlas route before topic leaves:

```text
records/context/overview.md for neutral folder purpose
current corpus, area, or cluster overview for route and freshness policy
canonical Context references that govern posture or direction
rationale, scenario, glossary, design, constraint, proof-context, history, or
open-question leaves only when the current decision needs them
promotion candidates when narrower Intent, Assurance, Blueprint, or Description
authority should govern future work
```

The Context atlas is retrieval support, not a second authority channel. A path
or overview can make retrieval cheap without replacing entry state, scope,
current meaning, and supersession.

When a surface has freshness or review labels in addition to `state`, treat
`state` as product-authority state and those labels as limits on how strongly
the entry may govern. For broad Context, a current leaf with unreviewed or
needs-cluster-review labels may orient a decision, but the active Work Boundary
must record limited reliance before treating it as governing meaning.

## Entry references

Semantic authority entries are not proof, observation, or Control record
registries.

They should carry only references needed to understand and retrieve product
meaning:

```text
semantic authority: related entries in other surfaces
target surfaces: implementation surfaces when they are part of owned meaning
```

Proof, observations, and Control records should point to semantic authority
when they need to name the product meaning they proved, observed, or
process-controlled. Semantic authority entries do not link back to those
artifacts.

## Discovery use

Discovery reads semantic authority to understand product direction and derive
candidate Signals.

Discovery should use:

```text
Context for Direction and rationale
Intent for existing or missing behavior
Assurance for obligations that affect readiness
Blueprint for dependency, sequence, or structure constraints
Description for local ownership and risky surfaces
```

Discovery Control records may point to semantic authority entries. They do not
become semantic authority.

## Delivery use

Delivery reads semantic authority to interpret selected work, state product
judgment, and admit the resulting Work Boundary.

The active Work Boundary should record:

```text
semantic authority slice
entry state or freshness notes when relevant
product judgment
declared behavior and declared non-changes
target change surfaces
execution boundary
proof obligations
semantic authority update obligations
Control record requirements
```

During Build, agents may update Description entries when implementation-local
meaning changes. Other semantic authority updates should follow the active
Work Boundary and the owning semantic authority surface.

During Evidence and Reconciliation, agents compare the actual work delta to the
active product judgment and Work Boundary, then check whether semantic authority
update obligations are satisfied, unnecessary, blocked, or deferred.

## Closure and promotion use

Closure decides what durable product learning survives the Delivery run.

Use this routing:

```text
durable product meaning -> owning semantic authority surface
process state -> Control records
proof status -> Evidence Packet
runtime fact -> observation until interpreted
useful history only -> archive decision
behavior-changing follow-up -> new Signal
```

The knowledge promotion decision should name the target semantic authority
surface, target entry, intended entry state, and source material.

Promoted entries should preserve the interpreted meaning that future work needs.
Rejected or archived source material should remain outside semantic authority
storage with the rejection, archive, or retrieval condition recorded in the
owning process record.

## Checks

Before relying on a semantic authority slice, confirm:

```text
entries are admitted, current, scoped, or explicitly treated as provisional
stale or superseded entries are not used as current authority
related entries across surfaces do not conflict
target-surface references point to relevant implementation surfaces when present
semantic authority update obligations name the owning semantic authority surface
```

Before treating semantic authority updates as adequate, run the semantic
authority backpressure check:

```text
Intent does not carry product rationale, target user, strategy, or release
posture that should live in Context.
Assurance does not invent behavior, product rationale, or risk tolerance
missing from Context or Intent.
Blueprint does not choose product promises, risk obligations, or dependency
rationale missing from Context, Intent, or Assurance.
Description does not define behavior, obligations, architecture, or dependency
direction missing from earlier surfaces.
Implementation does not become the first place durable product meaning appears.
Proof obligations do not invent expected behavior because earlier semantic
authority is too sparse.
Declared non-changes do not depend on unstated scope boundaries.
```

When this check fails, stop the current transition. Update the owning earlier
semantic authority surface before continuing. If Delivery is active, record the
missing meaning, owning semantic authority surface, blocker state, and resume
condition in `semantic_authority_backpressure`.

When a check fails, repair the owning entry, Control record, proof, or active
Work Boundary instead of adding a broad summary.
