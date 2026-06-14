# Signal phase

## Purpose

Understand weak input without turning it directly into production behavior.

Inputs:

```text
founder prompt
Discovery-selected Signal
bug report
incident
market/user feedback
runtime observation
support issue
analytics anomaly
existing backlog item
Required Check breach: a bound check on a current entry turned red
```

A Required Check breach is already interpreted by its owning entry: the entry
states what passing means, so the red check claims the target violates
admitted meaning or the meaning itself changed. The Signal work is deciding
which of those two it is; the entry is not edited to make the check pass.

Agent may:

```text
classify the source
gather relevant context
inspect current semantic authority and target facts
retrieve relevant semantic authority entries
check semantic authority entry state and supersession
generate candidate meanings
identify ambiguity
propose a default for review
identify repo facts that the Work Boundary recommendation must preserve
identify facts that may shape product judgment, tradeoffs, exclusions, or
falsifiers
ask a small direction question
```

Agent must not:

```text
treat the prompt as a requirement by itself
treat stale semantic authority as current through knowledge promotion
invent product policy
start changing production behavior before a Work Boundary exists
skip product judgment by treating source intent as accepted behavior
use a summary as authority
assume code behavior is desired behavior
let the conversation framing override repo state
```

Output:

```text
candidate meanings for review
repo facts and known unknowns needed for the Work Boundary recommendation basis
repo facts and known unknowns needed for product judgment
deferred/rejected/no-action outcome
small founder choice question
candidate meaning ready for Framing after admission
```

Exit to Framing only when selected meaning is clear enough to weigh into
product judgment and define scope, execution boundary, proof obligations, and
semantic authority treatment.

Example:

```text
Signal:
"This dashboard feels dead."

Candidate meanings:
1. Empty state problem: users do not know what to do next.
2. Activity problem: the dashboard lacks recent movement or feedback.
3. Visual hierarchy problem: important things are present but feel inert.

Question:
Which direction is closer?
```

---

## Admission context

Admission context is gathered inside the Signal phase.

Admission context is the typed source bundle used to interpret the Signal. It
may include discipline sources, evidence sources, executable facts,
interpretation inputs, gaps, and conflicts. The bundle itself is not authority.
Each source keeps its own authority treatment.

When Discovery selected the Signal, the Signal phase may use the selection
handoff, plan item, or plan map as admission context. Those records inform
interpretation. They do not admit behavior or replace the Work Boundary.

Admission context does not equal product judgment. It supplies the facts and
authority the agent will weigh during Framing.

The agent should ask:

```text
What already exists?
What is current?
What is stale?
What conflicts?
What does the code actually do?
What does the product say it should do?
What decisions were already made?
What proof exists?
Which semantic authority entries govern this area?
Which entries are current, provisional, stale, or superseded?
Which target facts, proof, observation, or Control records affect interpretation?
What behavior might be accepted, and what nearby behavior should remain excluded?
What evidence would falsify that acceptance?
```

The Signal phase should produce enough context to avoid bad interpretations and
to let Framing state product judgment without guesswork.

Example:

```text
Signal:
"Add teams."

Admission context needed:
- Is there already an org/workspace model?
- Does billing depend on seats?
- Does auth support invitations?
- Are roles already defined?
- Is "team" a product object, permission group, or UI grouping?
- Are there current Intent entries or Assurances for tenant isolation?
- Are there Description files for team, auth, billing, and role change surfaces?
```

Retrieval priority:

```text
1. Stable IDs, scope, or related semantic authority for the likely product area.
2. Relevant Intent and Assurances.
3. Local Description files for likely change surfaces.
4. Blueprint if system structure is involved.
5. Context if product meaning or business context is ambiguous.
6. Existing proof and Runtime observations if current behavior or release risk
   matters.
```

---
