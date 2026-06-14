# Work Boundary

## Purpose

A Work Boundary bounds one open unit of work.

A Delivery run uses a Work Boundary to turn selected meaning and product
judgment into controlled production change. The Work Boundary states what
behavior is admitted, why that behavior is right to admit now, what is
excluded, which target change surfaces may change, which semantic authority
entries govern the work, which selected discipline constraints apply,
which execution capabilities the agent may use, which semantic authority
entries may need updates, which proof obligations govern landing readiness,
what observation plan is needed, and which Control records must be produced.

A Work Boundary controls work while it is open. It does not become durable
product knowledge after the Delivery run closes. Durable results move into
semantic authority surfaces through semantic authority update or knowledge
promotion.

Active Work Boundaries may live in temporary work storage while work is open.
That storage is not durable product authority.

Closed Work Boundaries are historical Control records. Retain them in the run
commit, then reset current `records/control/` before the next independent
process so the next run does not inherit prior mutable process state.

Every Work Boundary answers the same control question: what product judgment
supports admitting this work, what work is admitted, what is out of scope, which
execution boundary applies, and which proof obligations and failure routes
control landing. The written detail scales with risk, ambiguity, and blast
radius.

## Minimum Contents

A Work Boundary preserves:

```text
record id
record state
tier
source Signal
selected meaning
product judgment
recommendation basis
admission context
admitted scope
semantic authority slice with entry state, when relevant
discipline usage when selected
declared non-changes
allowed and restricted target change surfaces
execution boundary
proof obligations
discipline proof effects, when present
semantic authority update obligations
semantic authority backpressure blocker, when present
Control record requirements
landing readiness rule
```

Each proof obligation should name:

```text
id
claim
source
expected evidence
freshness condition
failure response
```

## Lifecycle

Create a Work Boundary when Framing admits one Delivery run.

Update it when product judgment, admitted scope, target change surfaces,
execution boundary, proof obligations, discipline obligations, semantic
authority update obligations, semantic authority backpressure, observation
plan, or Control record requirements change before landing.

The Work Boundary is active while it controls Build, proof, reconciliation,
landing, release handling, learning, archive decisions, or closure.

It exits active state when Delivery closes or abandons the run and the closure
record records any remaining active, blocked, deferred, superseded, or archived
state.

Validation check:

```text
product judgment is recorded at the depth required by risk and ambiguity
tier, scope, and execution boundary are recorded
claim-shaped proof obligations are recorded
update obligations are recorded
discipline usage is recorded when a selected package shapes admission
any semantic authority backpressure blocker is recorded
recommendation basis is recorded at the depth required by risk and ambiguity
```

Forbidden ownership:

```text
durable product authority after closure
proof status for the final work delta
release or merge handoff state
```

## Work Boundary tiers

Every Work Boundary must declare a tier. Use the smallest tier that preserves
the admissibility invariant.

When a required field does not apply, write `none` or `not applicable` and keep
the field short.

## Product judgment

The Work Boundary is not complete until the agent records the product judgment
it is about to operationalize.

Product judgment is the weighing step between authority and action. It states
what behavior is right to admit now, why this behavior instead of a nearby
alternative, what tradeoff is being chosen, what is excluded, what would
falsify the decision, and what proof follows from it.

Every Work Boundary records a `product_judgment`. The depth scales with risk,
ambiguity, and blast radius.

For compact work, the judgment may be short:

```text
behavior admitted
why this behavior is right now
explicit exclusions
falsifier
proof consequence
```

For standard and expanded work, the judgment should include:

```text
behavior admitted
why this behavior is right now
authority and target facts that materially shaped the decision
tradeoff chosen
explicit exclusions
assumptions and confidence
falsifiers
proof consequences
```

Product judgment is Control state for this Delivery run. It is not product
semantic authority after closure unless the extracted durable meaning is written
through semantic authority update or knowledge promotion into the owning
semantic authority surface.

## Recommendation basis

The recommendation basis explains why the product judgment and recommended
boundary follow from current repo state.

Conversation frames are Signals. Repo state controls recommendations. The
agent may use conversation to form hypotheses, but code, tests, contracts,
docs, current records, installed methodology, and relevant semantic authority
control the recommendation.

Every Work Boundary records a `recommendation_basis`. The depth scales with
risk, ambiguity, and blast radius.

For compact work, the basis may be short:

```text
what was inspected
assumption
confidence
why the recommended Work Boundary fits
```

For model, terminology, architecture, process, tooling, migration, or other
broad work, the basis must include:

```text
repo-wide usage or affected-surface inventory
definitions versus uses
distinct roles found
owning files and contracts
affected tests, setup, and tooling
known unknowns
assumptions
confidence level
evidence that would falsify the recommendation
what is intentionally not decided
```

For strategy-shaped work, the basis must also state the intended agent outcome
before proposing implementation scope:

```text
what agent behavior improves
what human review burden decreases
what failure is prevented
what must not be collapsed
what acceptance test proves the change helped
```

For migration-shaped work, product judgment and the basis must state the
intended target reality before proposing movement or implementation scope.
Migration means transplanting useful content into the current target model, not
keeping the old model alive inside the target.

Record the migration judgment explicitly:

```text
source material inspected
target reality and owning surfaces
content to keep because it remains useful
content to reshape because the target model owns it differently
source structure, labels, routes, support records, or file boundaries to drop
items admitted as old-structure exceptions because they are current target meaning
target-native naming, labels, chunking, storage, and retrieval shape
source provenance boundary for Control records, notes, and archives
cleanup proof that old structure is absent from durable target authority unless admitted
```

For content, documentation, methodology, semantic authority, or knowledge
migrations, old source naming may be useful in the Work Boundary, Evidence
Packet, hardening note, archive, or source inventory. It is not durable product
authority after closure. If old source structure remains in the target, the
Work Boundary should either admit it as current target meaning or treat it as a
cleanup failure before landing.

When the agent changes recommendation, the Work Boundary records the
recommendation delta:

```text
old recommendation
new evidence
premise changed or tradeoff clarified
new recommendation
unchanged tradeoffs
```

A tradeoff update may leave the recommendation unchanged. A falsified premise
may change the recommendation. The Work Boundary must state which happened.

### Tier 1: Compact Work Boundary

Use a Compact Work Boundary for operational work whose meaning is already
admitted and low risk.

Examples:

```text
typo fix
broken link
formatting correction
obvious bug fix that restores admitted behavior
test fix that does not change behavior
refactor inside admitted behavior
semantic authority freshness update that does not change meaning
```

Required written contents:

```text
tier
source Signal
selected meaning or existing admitted meaning
product judgment
recommendation basis
admitted scope
declared non-changes, when relevant
allowed target change surfaces
execution boundary
proof obligations
semantic authority update obligations, when relevant
semantic authority backpressure blocker, when present
Control record requirements
landing readiness rule
```

Conditional contents:

```text
admission context, when the governing source is not obvious
semantic authority slice, when retrieval matters
discipline usage, when a selected package shapes admission
restricted change surfaces, when nearby or plausibly affected
observation plan, when runtime risk exists; otherwise marked unnecessary
```

Do not use a Compact Work Boundary for new behavior, changed product promise,
changed policy, changed UX meaning or taste, sensitive areas, ambiguous
copy, irreversible work, or externally visible release decisions.

### Tier 2: Standard Work Boundary

Use a Standard Work Boundary for normal product or code changes where behavior,
meaning, target change surfaces, or semantic authority obligations must be made
explicit.

A Standard Work Boundary must include:

```text
tier
source Signal
selected meaning
product judgment
recommendation basis
admission context
semantic authority slice with entry state, when relevant
discipline usage, when a selected package shapes admission
admitted scope
semantic delta
assurances, when applicable
declared non-changes
allowed target change surfaces
restricted change surfaces
execution boundary
unknowns, when present
semantic authority update obligations
semantic authority backpressure blocker, when present
claim-shaped proof obligations
Control record requirements
observation plan, when needed; otherwise marked unnecessary
landing readiness rule
```

### Tier 3: Expanded Work Boundary

Use an Expanded Work Boundary when work is broad, risky, irreversible, touches
sensitive areas, is architectural, is cross-module, is migration-heavy, or is
likely to affect runtime operations.

An Expanded Work Boundary includes the Standard Work Boundary contents plus the
extra controls needed for the risk:

```text
explicit risk classification
review decisions or owner decisions
child Work Boundary plan, when discovered work is expected
expanded execution boundary
deeper proof obligations and evidence methods
observation, canary, rollback, or migration plan
release and learning plan
Delivery closure requirements
```

Choose the tier before admitting the Work Boundary. Tier choice is part of the
admission decision.

Do not silently change the tier of an active Work Boundary. If work proves too
broad, risky, ambiguous, or sensitive for the admitted tier, stop the active
Work Boundary and start fresh with a new Work Boundary whose tier fits the
discovered work.

Failure to size the work correctly is a framing failure. Treat it as new
framing work, not as permission to stretch the active Work Boundary.

Compact Control records may be inline and brief. A Compact Evidence Packet can
be a short proof block with the checked commit, command or manual check, and
freshness status. A Compact Landing Packet can be a short handoff block that
states the work delta, proof reference, and landing decision.

## Compact template

```yaml
work_boundary:
  id: "wb.dashboard-title-typo"
  state: "active"
  tier: "compact"

  source_signal: "Fix typo in empty dashboard title."

  selected_meaning:
    - "Correct spelling in the existing empty dashboard title."

  product_judgment:
    behavior_admitted:
      - "Correct only the misspelled dashboard title text."
    why_now: "The current title has an obvious spelling error and no behavior or copy direction change is intended."
    tradeoff_chosen: "Prefer a narrow correction over opening empty-state UX or tone review."
    explicit_exclusions:
      - "No copy rewrite."
      - "No layout change."
      - "No behavior change."
      - "No semantic authority meaning change."
    assumptions:
      - "The text is not reused elsewhere as a product promise."
    confidence: "high"
    falsifiers:
      - "The target text is reused as a product promise elsewhere."
    proof_consequences:
      - "Diff or render check must show only the spelling correction changed."

  recommendation_basis:
    inspected:
      - "empty dashboard title text"
      - "surrounding empty-state copy"
    definitions_vs_uses: "not applicable"
    distinct_roles_found:
      - "display text only"
    owning_files_and_contracts:
      - "empty dashboard component"
    affected_tests_setup_tooling: "local render or text check only"
    known_unknowns: []
    assumptions:
      - "The spelling correction does not change product promise, tone, layout, or behavior."
    confidence: "high"
    falsifiers:
      - "The target text is reused as a product promise elsewhere."
    intentionally_not_decided:
      - "No empty-state UX or copy direction beyond the spelling correction."
    recommendation:
      - "Use a Compact Work Boundary limited to the typo correction."

  admitted_scope:
    - "Change display text from 'Welcom back' to 'Welcome back'."

  declared_non_changes:
    - "No layout change."
    - "No empty-state behavior change."

  target_change_surfaces:
    - "empty dashboard title text"

  execution_boundary:
    allowed:
      - "local repository inspection"
      - "local file edit"
      - "local render or test check"
    restricted:
      - "production runtime action"
      - "external service call"
      - "credential or secret change"
      - "deployment"
      - "migration"

  proof_obligations:
    - id: "proof.empty-dashboard-title-corrected"
      claim: "The empty dashboard title renders with corrected spelling."
      source: "admitted_scope"
      expected_evidence: "local render or text check"
      freshness_condition: "checked after the final text delta"
      failure_response: "fix the text delta or record the proof gap"

  disciplines_used: []

  semantic_authority_update_obligations:
    context: "none"
    intent: "none"
    assurance: "none"
    blueprint: "none"
    description: "none"

  semantic_authority_backpressure:
    missing_meaning: "none"
    owning_surface: "none"
    blocker_state: "none"
    resume_condition: "none"

  control_record_requirements:
    evidence_packet:
      - "Produce compact Evidence Packet for the final work delta."
    landing_packet:
      - "Assemble compact Landing Packet before release or merge handoff."

  landing_readiness_rule:
    - "Only admitted text changed."
    - "Execution boundary followed."
    - "Proof obligations satisfied."
    - "Proof current against final work delta."
```

## Discipline usage example

Use this shape when selected discipline changes admission, proof, or
closure.

```yaml
disciplines_used:
  - package_id: "example.database.production-migrations"
    package_version: "0.1.0"
    discipline_id: "example.database.production-migrations"
    discipline_version: "0.1.0"
    binding_id: "example.database.schema-migration-binding"
    binding_version: "0.1.0"
    selected_because: "The work adds a production schema migration."
    retrieved_slice: "migration-classification"
    used_material:
      - statement: "Classify each migration before Build."
        treatment: "adopted"
        effect: "Work Boundary classifies the change as additive column plus backfill."
    proof_effect:
      - "migration execution proof"
      - "application compatibility proof"
    conflicts: []
    promotion_candidates:
      - "product-specific migration compatibility rule, if accepted"
```

## Standard template

```yaml
work_boundary:
  id: "wb.team-invite-create"
  state: "active"
  tier: "standard"

  source_signal: "Add team invites"

  selected_meaning:
    - "Team admins can create pending invites for email addresses."

  product_judgment:
    behavior_admitted:
      - "Team admins can create pending invites for email addresses."
      - "Invite creation sends an email."
    why_now: "The Signal asks for team invites, and current authority supports invite creation as a useful bounded first behavior."
    authority_and_target_facts:
      - "Current Intent supports invite creation."
      - "Assurance requires no billing seat allocation during invite creation."
      - "Description separates invite service responsibility from acceptance and billing."
      - "Likely target surfaces can support pending invite creation without adding acceptance."
    tradeoff_chosen: "Admit invite creation now while leaving acceptance, billing, duplicate policy, and expiration policy out of this Work Boundary."
    explicit_exclusions:
      - "No invite acceptance behavior."
      - "No membership activation."
      - "No billing seat allocation."
      - "No role hierarchy change."
      - "No duplicate invite policy unless separately admitted."
      - "No invite expiration policy unless separately admitted."
    assumptions:
      - "Invite creation can be implemented without acceptance behavior."
      - "Billing seat allocation remains outside this work."
    confidence: "medium"
    falsifiers:
      - "Current product authority requires invite acceptance in the same release."
      - "Implementation requires membership activation, schema, or billing behavior to make invite creation meaningful."
    proof_consequences:
      - "Proof must validate invite creation and email dispatch."
      - "Proof must validate authorization and tenant scoping."
      - "Proof must validate declared non-changes for acceptance, billing, auth provider, and role hierarchy."

  recommendation_basis:
    inspected:
      - "current teams Context and invite Intent"
      - "team invite service Description"
      - "tenant and no-seat-allocation Assurances"
      - "likely target UI, service, email, and test surfaces"
    definitions_vs_uses:
      - "Team invite creation is distinct from invite acceptance."
      - "Pending invite creation is distinct from billing seat allocation."
    distinct_roles_found:
      - "admin invite creation behavior"
      - "authorization guard"
      - "email dispatch"
      - "tenant-scoped lookup"
      - "billing non-change"
    owning_files_and_contracts:
      - "records/context/"
      - "records/intent/"
      - "records/assurance/"
      - "src/team/invites/_service.ts.desc.md"
      - "team invite service and tests"
    affected_tests_setup_tooling:
      - "team invite request tests"
      - "authorization tests"
      - "tenant isolation tests"
      - "email rendering check"
      - "billing non-change check"
    known_unknowns:
      - "Duplicate pending invite behavior."
      - "Invite expiration behavior."
    assumptions:
      - "Invite creation can be implemented without adding invite acceptance."
      - "Billing seat allocation remains outside this work."
    confidence: "medium"
    falsifiers:
      - "Current product authority requires acceptance behavior in the same release."
      - "The implementation requires schema or billing changes."
    intentionally_not_decided:
      - "Duplicate invite policy."
      - "Invite expiration policy."
    intended_agent_outcome:
      agent_behavior_improves: "Agent separates invite creation from acceptance and billing."
      human_review_burden_decreases: "Founder reviews product choices and non-changes instead of broad implementation guesses."
      failure_prevented: "Agent does not silently add acceptance, billing, or role hierarchy behavior."
      must_not_be_collapsed:
        - "invite creation"
        - "invite acceptance"
        - "billing seat allocation"
        - "role hierarchy"
      acceptance_test: "Final delta proves create-invite behavior and declared non-changes separately."
    recommendation:
      - "Use a Standard Work Boundary limited to invite creation, email dispatch, authorization, tenant lookup, and billing non-change proof."
    recommendation_delta: "none; initial recommendation"

  admission_context:
    discipline_sources:
      - "context.teams@current"
      - "intent.team-invites.create@current"
      - "assurance.team-invites.no-seat-allocation-on-create@current"
      - "description.team-invite-service@current"
    interpretation_inputs:
      - "source Signal: Add team invites"
    gaps_or_conflicts:
      - "Duplicate invite policy not defined"
      - "Invite expiration policy not defined"

  disciplines_used: []

  semantic_authority_slice:
    context:
      - id: "context.teams"
        state: "current"
    intent:
      - id: "intent.team-invites.create"
        state: "current"
    assurance:
      - id: "assurance.team-invites.no-seat-allocation-on-create"
        state: "current"
    description:
      - id: "description.team-invite-service"
        state: "current"

  admitted_scope:
    - "Team admins can create pending invites."
    - "Invite creation sends an email."

  semantic_delta:
    added_behavior:
      - "A team admin may create a pending invite for an email address."
    changed_behavior: []
    removed_behavior: []

  assurances:
    - id: "assurance.team-invites.no-seat-allocation-on-create"
      assurance_checks:
        - "Creating an invite does not increase active seat count."
        - "Billing areas are not touched."
    - id: "assurance.team-invites.tenant-scoped-lookup"
      assurance_checks:
        - "Invite lookup cannot cross team/tenant boundary."

  declared_non_changes:
    - "No invite acceptance behavior."
    - "No billing seat allocation."
    - "No auth provider change."
    - "No role hierarchy change."

  target_change_surfaces:
    - "team settings invite UI"
    - "team invite service"
    - "invite-created email template"
    - "team invite tests"

  restricted_change_surfaces:
    - "billing"
    - "auth provider"
    - "role hierarchy"
    - "database schema unless separately admitted"
    - "generated code unless regenerated through an admitted process"

  execution_boundary:
    allowed:
      - "local repository inspection"
      - "local code and test edits inside admitted change surfaces"
      - "local automated tests"
      - "local email template rendering check"
    restricted:
      - "production runtime action"
      - "credential or secret change"
      - "deployment"
      - "database migration unless separately admitted"
      - "sending email through a live provider"

  unknowns:
    - "Whether duplicate pending invites are rejected, refreshed, or reused."
    - "Whether invites expire."

  proof_obligations:
    - id: "proof.team-admin-create-pending-invite"
      claim: "A team admin can create a pending invite."
      source: "semantic_delta.added_behavior"
      expected_evidence: "request-level automated test"
      freshness_condition: "test covers the final work delta"
      failure_response: "repair behavior or return to Framing if behavior changes"
    - id: "proof.non-admin-cannot-create-invite"
      claim: "A non-admin cannot create an invite."
      source: "semantic_delta.added_behavior"
      expected_evidence: "authorization test"
      freshness_condition: "test covers final delta and permission policy"
      failure_response: "repair authorization or stop for a permission decision"
    - id: "proof.invite-lookup-tenant-scoped"
      claim: "Invite lookup is tenant-scoped."
      source: "assurances"
      expected_evidence: "tenant isolation test"
      freshness_condition: "test covers final work delta and current tenant boundary"
      failure_response: "repair tenant scoping or stop for an Assurance update"
    - id: "proof.email-dispatch-idempotent"
      claim: "Email dispatch is idempotent."
      source: "assurances"
      expected_evidence: "retry or duplicate dispatch test"
      freshness_condition: "test covers final work delta and current email path"
      failure_response: "repair dispatch behavior or reframe the obligation"
    - id: "proof.billing-seat-count-unchanged"
      claim: "Billing seat count does not change."
      source: "declared_non_changes"
      expected_evidence: "billing assertion plus billing surface diff check"
      freshness_condition: "checked after all target changes are complete"
      failure_response: "remove billing change, reframe it, or abandon"
    - id: "proof.no-invite-acceptance-route"
      claim: "No invite acceptance route is added."
      source: "declared_non_changes"
      expected_evidence: "route diff check"
      freshness_condition: "checked against the final route delta"
      failure_response: "remove acceptance route, create child Work Boundary, or start fresh"

  semantic_authority_update_obligations:
    context: "none"
    intent:
      - "Update intent.team-invites.create if duplicate invite behavior is selected."
    assurance:
      - "Bind no-seat-allocation and tenant-scope assurances to this behavior."
    blueprint: "none unless acceptance flow is added"
    description:
      - "Update description.team-invite-service if service responsibilities change."

  semantic_authority_backpressure:
    missing_meaning: "none"
    owning_surface: "none"
    blocker_state: "none"
    resume_condition: "none"

  control_record_requirements:
    evidence_packet:
      - "Produce current Evidence Packet for the final work delta."
    landing_packet:
      - "Assemble Landing Packet before release or merge handoff."

  observation_plan:
    - "Monitor invite email delivery failures."

  landing_readiness_rule:
    - "All declared behavior implemented."
    - "No restricted change surface touched unless admitted."
    - "Execution boundary followed."
    - "Declared non-changes verified."
    - "Proof obligations satisfied."
    - "Required semantic authority obligations satisfied or unnecessary."
    - "Required Control records produced."
    - "Proof current against final work delta."
```

## Landing Readiness Support

The Work Boundary does not make itself landing ready. It supplies product
judgment, admitted scope, execution boundary, proof obligations, semantic
authority update obligations, and landing readiness rule that Evidence and
Reconciliation must check.

The Work Boundary must be active before substantive repository edits. When the
Work Boundary creates proof obligations or the run will need proof before
landing, the run also needs a live Evidence Packet before substantive Build
edits. A Work Boundary written only at the end of the run is not a valid
substitute for the active control object.

Use [../gates.md](../gates.md) for the landing readiness transition.

## Delivery closure

Landing readiness is not Delivery closure. A Work Boundary closes after landing or
explicit abandonment, observation handling, and knowledge promotion or archive
decisions are resolved.

Delivery closure requires:

```text
landing or explicit abandonment resolved
product judgment outcome recorded
observation handling addressed when needed
knowledge promotion or archive decisions made
closure record produced
```

After Delivery closure, future agents should rely on current semantic authority
and proof, not on the closed Work Boundary or its product judgment.
