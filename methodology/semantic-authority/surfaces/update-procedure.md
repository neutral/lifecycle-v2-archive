# Semantic Authority Update Procedure

## Purpose

Use this page when Clarity, Delivery, or Discovery discovers product meaning
that may need to enter semantic authority.

The procedure keeps semantic authority storage small. It updates only the
semantic authority surface whose owned meaning changed and only when future
work needs that meaning as authority.

## Update Principle

Update semantic authority when durable product meaning changes or when future
agents need a current entry to work safely.

Do not update semantic authority merely to restate:

```text
a mechanical diff
a temporary plan
a one-run product judgment
a closed process decision
a test result
a runtime observation that has not been interpreted
an agent summary
```

Those belong in target, Control records, proof, observation, archive, or
temporary working notes until admitted or promoted. If product judgment
contains durable learning, promote only the extracted product meaning, not the
Work Boundary's weighing record.

## Procedure

Use this order:

```text
1. Identify the meaning that changed.
2. Choose the owning semantic authority surface.
3. Check whether the chosen surface depends on unsupported earlier authority.
4. Check the current entry state, scope, freshness, and related entries.
5. In Clarity, confirm the active Clarity Boundary admits the Context scope
   before Context edits.
6. In Delivery, confirm the active product judgment supports admitting the
   behavior or learning that requires the update.
7. Record the update obligation in the active Work Boundary when Delivery is active.
8. Update the smallest entry that owns the changed meaning.
9. Mark the obligation satisfied, unnecessary, blocked, deferred, or superseded.
10. Verify that related entries still agree.
```

## Surface Routing

Use Context when the durable change is product rationale, business context,
user need, strategy, or direction.

Use Intent when the durable change is behavior, acceptance meaning, non-goal,
or product promise.

Use Assurance when the durable change is an invariant, safety obligation,
security constraint, performance obligation, data rule, or non-functional
requirement.

Use Blueprint when the durable change is system structure, dependency shape,
state flow, sequence, or architectural boundary.

Use Description when the durable change is local implementation meaning,
module responsibility, sensitive dependency, forbidden responsibility, or
future modification guidance.

Dependency choices are product decisions when they shape behavior, viability,
safety, support, release posture, structure, or long-term maintainability.
Route durable dependency information to the surface that owns the decision:

```text
Context: why this dependency or platform direction fits the product, users,
constraints, alternatives, or release posture
Intent: behavior, capability, or non-goal the dependency exposes to users
Assurance: safety, security, data, performance, license, support, or
operational obligations the dependency creates
Blueprint: integration boundary, dependency direction, state flow, or replacement boundary
Description: local wrapper, module responsibility, sensitive edge, and safe modification guidance
```

The active Work Boundary may include the current dependency decision, product
judgment, and proof inside admitted scope. It does not replace semantic
authority storage when dependency information should govern future work.

## Semantic Authority Dependency Checks

Before updating a surface, check whether the current work depends on meaning
owned by an earlier surface.

Before updating Intent, confirm there is enough Context when behavior depends
on product rationale, target users, direction, scope boundaries, alternatives,
or release posture. If not, update Context first.

Before updating Assurance, confirm there is enough Context and Intent to know
what must remain true, why it matters, where it applies, and what failure
means. If not, update the missing earlier surface first.

Before updating Blueprint, confirm there is enough Context, Intent, and
Assurance to know what behavior, obligations, dependency basis, state flow, or
boundary the structure must preserve. If not, update the missing earlier
surface first.

Before updating Description, confirm there is enough Intent, Assurance, and
Blueprint to know what the implementation surface owns, what it must not own,
what invariants it must preserve, and which dependency or boundary shape it
must respect. If not, update the missing earlier surface first.

Before implementation, confirm the relevant semantic authority slice is deep
enough to know:

```text
what behavior to build
what obligations to preserve
what structure or dependency direction to respect
what local responsibility belongs where
what scope boundaries and non-changes control the work
```

If the answer is no, stop the current transition. When Delivery is active,
record the missing meaning as a `semantic_authority_backpressure` blocker in
the active Work Boundary. If the run will create or update semantic authority to
resolve the blocker, also record the owning semantic authority surface update
obligation. Continue only after the owning earlier semantic authority surface
is current enough for the work at hand.

## Knowledge Promotion Routing

Knowledge promotion turns interpreted learning into durable product meaning.
It does not move source artifacts into semantic authority storage.

Use this routing:

```text
runtime observation -> interpreted learning candidate
proof result -> learning candidate only when it changes future product meaning
founder decision -> semantic authority update or knowledge promotion source material
product judgment -> source material only when durable meaning is extracted
closed Control record -> source material, not product authority
agent summary -> source material only after review
```

Promote when the learning changes what future work should assume, preserve,
build, refuse, or inspect. Reject or archive when the learning is only a
mechanical diff, proof status, one-run product judgment, process history,
temporary rationale, or raw runtime fact.

The promoted semantic authority entry should contain the interpreted durable
meaning. It should not carry a `source_basis` field or depend on the source
material, Work Boundary, proof record, observation, or promotion decision as
current product authority. Those materials remain retrievable in their owning
records.

When promoted, update exactly one owning semantic authority surface first:

```text
Context for durable users, rationale, direction, constraints, or product posture
Intent for durable behavior, non-goals, roles, or acceptance meaning
Assurance for durable invariants, obligations, risk constraints, or required checks
Blueprint for durable structure, state flow, dependency direction, or interface boundaries
Description for durable local responsibility, sensitive edges, dependencies, or safe modification guidance
```

Then update related entries only when their owned meaning also changed. A
related entry does not need an update merely because another entry points to
it.

If promoted learning needs meaning from an earlier surface, record
semantic authority backpressure instead of burying that missing meaning in the
later entry.

## Source-Material Migration

Use this section when a run is moving meaning from an old area into the current
product, methodology, documentation, or semantic authority model.

Migration is a semantic transplant. The target reality decides what survives.
Do not treat the old source folder, file map, page hierarchy, labels, document
types, routes, taxonomies, or support records as the target shape by default.
They are source provenance unless the active Work Boundary admits them as
current meaning in the target model.

For Delivery migrations, product judgment is the weighing step that decides
what source content enters the target reality. It should name the target-native
behavior, meaning, organization, exclusions, and proof consequences before
semantic authority entries are written.

For each source cluster, decide:

```text
keep: the content still carries current meaning and has a clear target owner
reshape: the content is useful but must be renamed, merged, split, relabeled,
or moved to the surface that owns it now
drop: the content is source navigation, process state, duplicate history,
obsolete structure, or unsupported old taxonomy
defer: the content may matter, but the target owner or current meaning is not
clear enough to admit
```

Prefer migrating content, not containers. Useful content should arrive in the
new reality with target-native identity:

```text
current ids and filenames
current retrieval keys and labels
current chunking or module boundaries
current semantic authority surface
current body shape and terminology
current proof and freshness obligations
```

Old names, source paths, original page boundaries, coverage maps, and source
classification can remain in Control records, Evidence Packets, migration
inventories, hardening notes, or archives. They should not be required to read,
retrieve, or trust the final target authority.

Before landing a migration, reconcile old-structure residue:

```text
What source structure remains in durable target authority?
Was each remaining old-structure item admitted as current target meaning?
Do target entries work without reopening Control records or source material?
Did route/index/support pages become target-native organization, merge into
owned entries, or get dropped?
Did labels and doc types become current retrieval or authority vocabulary, or
were they removed?
Are deferred items recorded with an owner and retrieval condition?
```

If the migration cannot answer these questions, keep the run open, narrow the
scope, or record semantic authority backpressure. Do not close by leaving the
old reality embedded in the new authority surface.

## Context Update Routing

Use this section to decide whether a Context change belongs inside the active
process or needs a Clarity run.

The Context surface contract defines what valid Context entries and broad
Context atlas entries must mean. This update procedure chooses the owning
surface and admissible process. It is not the step-by-step Context maintenance
procedure.

Delivery can update Context when its active Work Boundary admits a product
change that requires Context authority. Keep that update to the smallest
durable rationale, direction, constraint, or product posture the Delivery run
actually changed.

Prefer Clarity when Context maintenance is the work:

```text
broad Context route review
cluster review
canonicalization
freshness or review-label correction
promotion-pressure review
source-material import into Context
retrieval repair for a broad Context corpus
```

When Clarity is active, the active Clarity Boundary admits the Context scope and
allowed mutations. The Context Review Packet records route, content,
canonicalization, promotion, retrieval, relation, and freshness decisions. The
Clarity Closure Record records unresolved gaps and founder-reviewable
recommendations.

All Context updates, regardless of process, must satisfy the Context surface
contract:

```text
current meaning belongs in Context
stable Context ID remains semantic identity
file paths and overview files are retrieval affordances, not authority by themselves
source-container identity is removed unless it is current target product meaning
broad Context uses atlas fields when an atlas is needed
route review remains separate from leaf content review
promotion pressure is recorded without silently updating narrower surfaces
```

Do not create Context hierarchy for its own sake. A small product area with one
or two entries can stay simple. Use Clarity when the absence of hierarchy makes
product meaning expensive to retrieve, hides canonical posture, preserves old
source containers, or blurs Context with Intent, Assurance, Blueprint, or
Description.

## Delivery Timing

Before Build, the active Work Boundary names semantic authority update
obligations and product judgment.

During Build, Description may be updated when implementation-local meaning
changes inside the active Work Boundary.

Before landing readiness, the agent reconciles each semantic authority update
obligation against the actual work delta.

Before closure, every semantic authority update obligation has one outcome:

```text
satisfied
unnecessary
blocked
deferred
superseded
```

Do not close Delivery with an unstated semantic authority update obligation.

## New Product Area

When the work starts a new product area, avoid creating a broad product-record
set before Build.

Use this path:

```text
1. State the product judgment that admits the first behavior set.
2. Admit the selected meaning in the Work Boundary.
3. Mark the semantic authority slice as new or not yet present.
4. Build and prove the final work delta.
5. Create only the entries future work needs.
6. Resolve the Work Boundary update obligations before closure.
```

For small new tools, Intent is usually the first durable entry. Add Assurance
when an invariant must govern future work. Add Description when future agents
need local implementation responsibility. Add Blueprint when dependency
direction, state flow, command flow, or shared service boundaries must govern
future changes. Add Context only when product rationale or direction is needed
for safe future work.

Create Description entries beside the source files they describe. Use the
source file name with a leading `_` and `.desc.md` suffix for one-to-one
Description files, or an appropriate `_name.desc.md` file for a source group.

## Substantial Product Build

When the founder-dev is creating a real product surface rather than a small
isolated feature, create or update Context before Build when product direction
will govern multiple decisions.

Use Context to capture:

```text
target users
primary use cases
product posture
scope boundaries
release posture
future product direction
```

Then use Intent, Assurance, Blueprint, and Description for the admitted
behavior, obligations, structure, and local implementation meaning.

Sparse Context is a signal, not a shortcut. If the current Context cannot guide
the next product or implementation decision, fill the smallest useful Context
slice before Build. Useful Context may be only a few paragraphs, but it should
answer the questions that would otherwise be guessed:

```text
who the work is for
what outcome matters
what scope boundary or non-goal controls the run
what product or release posture applies
what dependency or platform basis matters, when dependencies shape the work
what future direction should remain visible across runs
```

Do not force the whole product into one Delivery if the work naturally spans
multiple releases. Use Discovery plan state to preserve the continuing roadmap.
Delivery should close the current admitted release or change set, while
Discovery can keep future selected, deferred, blocked, or candidate work alive.

Closure should distinguish:

```text
current Delivery complete
product direction still active
future roadmap still active
```

Closing one Delivery does not mean the founder-dev is done building the
product.

Context can deepen across runs. Each Delivery should add only the Context its
admitted work needs, and later runs should extend it when new direction,
constraints, dependency basis, or release posture becomes relevant.

## Satisfying Update Obligations

A semantic authority update obligation is satisfied only when the target entry
can govern future work.

Do not mark an obligation satisfied merely because a file exists. The entry
must carry the meaning owned by that semantic authority surface at the depth
future agents need.

For Intent, include behavior, non-goals, user-visible outcomes, acceptance
checks, and important edge cases.

For Assurance, include the invariant or obligation, why it matters, where it
applies, what checks preserve it, and what failure means.

For Description, include the target surface, owned responsibilities,
non-responsibilities, local invariants, dependencies or extension points, and
safe modification guidance.

For Context or Blueprint, include the rationale, direction, structure,
sequence, state, dependency, or boundary meaning those surfaces own. Do not
create those surfaces as labels for work that does not need them.

Before closure, read the updated entry as if the next agent has no access to
the Delivery narrative. If the entry cannot guide that agent, the update
obligation is still open.

Also check for semantic authority backpressure before marking an obligation
satisfied. If the updated entry carries meaning owned by an earlier surface,
the obligation is not satisfied. Move the meaning to the owning earlier semantic authority surface
or block the current transition until that surface is updated.

## Required Check Authoring

Author or revise an entry's Required Checks in the same update that changes
the entry's owned meaning. The binding shape and semantics live in the
Required Checks section of [contract.md](contract.md).

When an entry gains or changes a Required Check:

```text
1. Write or update the committed check script the command runs.
2. Register or update the command as a proof command in the shared tool
   configuration when tool support is present.
3. Bind the check in the entry: proof obligation id, check command,
   environment requirement, and last_held.
4. Prove the check can fail: exercise the falsifier or a seeded violation
   before trusting a pass.
5. Run the check and record last_held as date and result.
```

Keep receipt ids out of the entry. When the entry's meaning changes, re-run
its Required Checks before marking the update obligation satisfied; a
`last_held` from before the change makes no claim about the updated meaning.

## Entry State Update

When creating or updating an entry, set the entry state deliberately.

Use `current` when the entry may govern scoped work.

Use `provisional` when the entry may guide work only inside stated limits.

Use `stale` when the entry is useful for interpretation but should not govern
current work.

Use `superseded` when a newer entry replaces the old meaning.

Use `archived` when the entry is history only.

## Reconciliation Questions

Before marking an update obligation satisfied, answer:

```text
Which semantic authority surface owns this meaning?
Which entry was created or updated?
Which product judgment admitted the meaning, when Delivery is active?
What state does the entry now have?
What scope does the entry govern?
Which related entries must agree with it?
Does the target behavior match the entry?
Does proof cover the behavior or obligation when proof is needed?
Can a future agent use the entry without reopening the Control records?
Is this entry relying on meaning that belongs in an earlier surface?
Does the active Work Boundary record the obligation outcome?
```

When Clarity is active, replace the Work Boundary question with:

```text
Does the active Clarity Boundary admit this Context scope?
Does the Context Review Packet record the review and retrieval outcome?
Does the Clarity Closure Record record unresolved gaps and recommendations?
```

## What Not To Do

Do not update semantic authority to justify unadmitted code after the fact.

Do not update semantic authority to hide missing or falsified product judgment.
Return to the active Work Boundary.

Do not put proof status into semantic authority. Proof belongs in Evidence
Packets.

Do not put possible-work state into semantic authority. Possible work belongs
in Discovery Control records.

Do not link semantic authority entries back to every Control record that
informed them. Control records, proof, and observations point to semantic
authority when they need to name the product meaning they controlled, proved,
or observed.

Do not create Context, Intent, Assurance, Blueprint, and Description entries
for every small change. Create only the entries whose owned meaning changed or
whose absence would make future work unsafe.
