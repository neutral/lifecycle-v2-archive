# Entry Adequacy Check

## Check

Continue only when a product entry has:

```text
stable identity
owning semantic authority surface
state
scope
current meaning
retrieval keys or target references when future agents need cheap retrieval
related semantic authority entries when another surface constrains the meaning
supersession fields when replacing earlier meaning
updated date or freshness basis
```

Then confirm the entry can govern future work without reopening the Clarity,
Delivery, or Discovery run that created it.

Use the generated template for the owning surface and check:

```text
the entry answers only the question owned by that semantic authority surface
the scope is narrow enough that unrelated work does not inherit the meaning
the state says whether the entry can govern current work
the current meaning is not product judgment, a proof note, process summary, or runtime log
retrieval keys are finding aids, not hidden authority
target references name implementation surfaces only when they are part of owned meaning
related surfaces point in the direction the surface contract allows
downstream related surfaces on Context are retrieval links, not replacement
answers for Context-owned rationale, user, strategy, direction, or scope
meaning
the entry does not depend on product judgment, Clarity Boundaries, Source
Inventories, Context Review Packets, Work Boundaries, Evidence Packets,
Landing Packets, closure records, Discovery records,
old source-material paths, proof logs, runtime notes, or agent summaries as
current product authority
for migrated material, the entry uses target-native identity, labels, chunking,
and terminology, and any old source structure that remains is explicitly
admitted as current meaning rather than accidental carryover
stale, superseded, deprecated, or archived entries do not govern as current
the surface-specific adequacy checks in the template pass
the Markdown body uses only the smallest relevant body shape from the template
and does not include unused placeholder sections
```

## Surface Fit

Reject or move the entry when it carries meaning owned by another surface:

```text
Context: rationale, users, market, strategy, direction
Intent: behavior, non-goals, acceptance checks, user-visible outcomes
Assurance: invariant, obligation, constraint, required check
Blueprint: structure, sequence, state, dependency shape
Description: local implementation responsibility and safe modification guidance
```

## Failure Route

If an entry lacks the fields needed to govern future work, keep it candidate or
provisional until the missing fields are resolved.

If the entry contains product judgment, process state, proof status, runtime
observations, or temporary reasoning, move that material to the owning Control
record, proof, observation, archive, or scratch location before treating the
entry as adequate. Promote only the durable meaning extracted from product
judgment.

If a migrated entry still depends on old source paths, page hierarchy, support
labels, document types, route/index files, or file boundaries to be understood,
either reshape it into the target model, admit the old structure as current
meaning in the active Clarity Boundary or Work Boundary, or keep the entry
provisional until the source-shaped carryover is resolved.

If a Context entry belongs to a broad corpus, also confirm it has an atlas role:

```text
its product area or cluster is findable
an overview or route explains how future agents reach it when the corpus is broad
top-level context_area, context_cluster, context_role, parent_context,
child_contexts, and context_relations mirror the trusted route when the corpus
is broad
canonical references are separated from rationale, history, glossary, scenario,
design, proof-context, open-question, or implementation-posture leaves
local graph relations are stated when needed for retrieval or conflict handling
freshness or review status is visible when the entry could go stale
state, review_status, and freshness agree well enough for the intended use, or
the active Clarity Boundary or Work Boundary records the limited way the entry
may be used
promotion pressure is named when the Context is really pointing at future
Intent, Assurance, Blueprint, or Description work
proof-context, delivery-readiness, and operational-readiness Context entries
preserve only durable product posture, not proof receipts, one-run proof
results, active proof obligations, Delivery progress, or closure state
Clarity source inventories, route checks, content adequacy checks, retrieval
proof, closure recommendations, and process history remain in Clarity Control
records unless durable product meaning was extracted into Context
```

If the current pass only changes the atlas route, check route adequacy
separately from leaf content adequacy. Folder movement, area-overview updates,
or route freshness can make the route current without making every moved leaf
reviewed. Leave leaf `review_status` and `freshness` unchanged unless the
leaf's owned meaning, stale assumptions, duplicate content, contradictions,
and promotion pressure were actually reviewed.

A `state: current` broad-Context leaf with `review_status:unreviewed` or
`freshness:needs-cluster-review` is not automatically a reviewed canonical
source. It can orient work or supply candidate meaning, but future agents
should prefer reviewed area overviews and canonical references for governing
meaning, or record the limited reliance in the active Clarity Boundary or Work
Boundary.

If these checks fail, keep the entry candidate or provisional, update the area
overview or corpus organization entry, split the entry by role, or record
semantic authority backpressure.
