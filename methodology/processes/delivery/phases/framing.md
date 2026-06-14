# Framing phase

## Purpose

Admit a bounded production change before building it.

The Work Boundary is the Delivery run's active control object.

Framing is human-owned and agent-prepared when the work touches meaning, scope,
policy, taste, sensitive areas, risk tolerance, or shipping authority. The
agent prepares the review by gathering context, drafting candidate meanings,
stating product judgment, identifying risk, defining the execution boundary,
and defining proof obligations. The agent must ground the judgment and
recommendation in repo state before proposing implementation scope.

It answers:

```text
What are we doing?
Why is this interpretation valid?
What behavior is right to admit now?
Why this behavior instead of nearby alternatives?
What tradeoff is being chosen?
What is explicitly excluded even though it is adjacent?
Which Work Boundary tier is sufficient?
What repo facts support this recommendation?
What assumptions and confidence shape this recommendation?
What evidence would falsify this recommendation?
What evidence would falsify this product judgment?
What behavior is added, changed, or removed?
What is explicitly not changing?
Which change surfaces may be touched?
Which change surfaces are restricted?
Which execution capabilities may the agent use?
Which semantic authority entries govern this work?
What state and scope do those entries have?
Which discipline packages and bindings materially apply?
Which discipline constraints are adopted or rejected?
Which semantic authority entries must be updated?
Which claims must be proved before landing?
Which Control records must be produced?
What risks require observation handling?
```

Agent may:

```text
draft the active Work Boundary
choose the smallest sufficient Work Boundary tier
record the recommendation basis
record product judgment before admission
inspect the affected repo surfaces before recommending scope
state assumptions, confidence, known unknowns, and falsifiers
state recommendation deltas when the recommendation changes
state judgment deltas when the product judgment changes
propose scope
map change surfaces
define the execution boundary
list declared non-changes
identify risks
define proof obligations
define Control record requirements
attach relevant semantic authority entries
select material discipline packages and bindings
retrieve the smallest useful discipline slices
admit or reject discipline constraints
record discipline conflicts and proof effects
record entry state, freshness, and conflicts when relevant
raise unresolved decisions
```

Agent must not:

```text
accept semantic, policy, or shipping decisions by itself
activate a Work Boundary without founder approval
expand scope without admission
let product judgment remain implicit inside source inventory or recommendation basis
use a smaller Work Boundary tier to hide risk, ambiguity, or blast radius
silently change the tier of an active Work Boundary
hide unknowns
let conversation framing override repo state
recommend implementation scope before stating the intended agent outcome for
strategy-shaped work
change recommendation without naming the new evidence and changed premise
change product judgment without naming the new evidence, changed premise, and unchanged tradeoffs
bury sensitive areas
invent business policy
use discipline as product meaning without promotion
treat broad domain advice as a selected package
treat an incomplete Work Boundary as authorization to ship
forget execution boundary, semantic authority update obligations, or Control
record requirements
```

---

## Work Boundary model

Use [Work Boundary](../control-records/work-boundary.md) for tiers, contents,
templates, and Delivery closure rules.

Use [Build](build.md) when discovered work may need a child Work Boundary or a
new higher-tier Work Boundary.

---

## Current admission rule

The agent may prepare a Compact Work Boundary for low-risk operational work.
Selected meaning becomes active Work Boundary scope only after founder
approval.

Framing exits to Build only when the active Work Boundary contains:

```text
tier
selected meaning
product judgment
recommendation basis
admitted scope
target change surfaces
execution boundary
proof obligations
discipline usage when selected
semantic authority update obligations
Control record requirements
landing readiness rule
```

When proof obligations exist or the run will need proof before landing, Framing
also creates or updates the run's active Evidence Packet before substantive
Build edits. The packet can record pending proof while the final work delta is
not frozen.

When an entry in the semantic authority slice binds Required Checks, the
matching proof obligations reference those checks instead of inventing new
proof for the same claims, and the semantic authority update obligations
include re-running the checks and refreshing their `last_held` lines when the
work touches the entry's scope. New behavior that should stay demonstrable
across future runs is a candidate for a new bound Required Check, authored
through the surface update procedure.

The product judgment must be sufficient for the Signal's risk and ambiguity. It
must state what behavior is admitted, why that behavior is right now, what
tradeoff is chosen, what is excluded, what would falsify the judgment, and what
proof follows from it.

The recommendation basis must support that judgment with current repo state.
For compact work, it may only need the inspected fact, assumption, confidence,
and recommended Work Boundary. For terminology, model, architecture, process,
tooling, migration, or other broad work, it must include a usage or
affected-surface inventory, definitions versus uses, distinct roles found,
owning files and contracts, affected tests, setup, and tooling, known unknowns,
assumptions, confidence, falsifiers, and what is intentionally not decided.

For migration-shaped work, the product judgment and recommendation basis must
also name the target reality before naming implementation scope. A migration
does not mean preserving the old container in a new location. It means deciding
what source material has current value, which target surface owns that value,
how it should be reshaped to fit the target model, and what old structure
should be dropped before landing. Treat source repositories, source folders,
old file boundaries, labels, routes, taxonomies, and support records as
provenance unless the Work Boundary explicitly admits them as current product
meaning.

The Work Boundary for a content, documentation, methodology, semantic
authority, or knowledge migration should record a migration judgment:

```text
source material inspected
target reality that will own the result
keep / reshape / drop criteria
target-native naming, labels, chunking, and storage shape
source provenance boundary
final cleanup proof for old structure residue
```

Old names and source paths may remain in Control records, Evidence Packets,
hardening notes, or archives as process evidence. They should not remain in
durable target authority merely because they were useful during the migration.

Conversation frames are Signals. Repo state controls product judgment and
recommendations. The agent may use conversation to form hypotheses, but current
code, tests, contracts, docs, records, installed methodology, and semantic
authority control the product judgment and recommendation.

When the work starts a new product area, semantic authority may be absent. In
that case, the Work Boundary should state that the slice is new and name the
semantic authority update obligations that must be resolved before closure.
Do not block Build only to create broad semantic authority entries up front.

Tier sizing happens before admission. If the work later proves too broad,
risky, ambiguous, or sensitive for the admitted tier, stop and frame a new
Work Boundary with a tier that fits the discovered work.

If substantive edits already happened before the active Work Boundary and
Evidence cadence existed, notify the founder-dev immediately. Do not hide the
failure by writing a polished Work Boundary after the fact.

Example:

```text
Signal:
"Fix the typo in the empty dashboard title."

Likely treatment:
Prepare a Compact Work Boundary and proof obligations.
Ask for admission before changing production behavior.
```

---

## When the agent must ask or raise a decision

The agent should ask or raise a decision when:

```text
multiple plausible meanings exist
discipline sources are missing, stale, or conflicting
product judgment is missing, under-specified, or falsified by repo facts
semantic authority entries conflict
discipline conflicts with product semantic authority or admitted scope
the selected meaning touches sensitive areas
the selected tier no longer fits the work
scope expansion is discovered
the work changes product policy
the work changes permissions or roles
the work changes billing, auth, or data isolation
the work needs external service access, credentials, deployment, or other
side-effecting execution
the work requires migration or irreversible behavior
the proof obligation is unclear
the actual diff does not match the active Work Boundary
the required semantic authority home is unclear
```

Founder-facing questions should be small and product-shaped.

Bad:

```text
Please approve transition from SemanticDeltaDrafting to BuildActive.
```

Good:

```text
Duplicate invite behavior is not defined.

Which behavior should we use?

1. Reject duplicate pending invites.
2. Refresh the existing invite and resend email.
3. Reuse the existing invite silently.
```

---
