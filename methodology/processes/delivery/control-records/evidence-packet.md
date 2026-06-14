# Evidence Packet

## Purpose

Use an Evidence Packet to preserve live proof status for the Delivery run and
final proof status for the final work delta.

The active Work Boundary defines the proof obligations. The Evidence Packet
records the evidence that satisfies those obligations, product judgment
coverage, and the reconciliation state against the final work delta.

## When To Use

Create or update an active Evidence Packet once proof obligations are concrete,
before substantive Build edits. Continue updating it during Evidence and
Reconciliation.

Use it to preserve:

```text
tested commit, version, or local final work delta label
proof obligations covered
checks run
declared non-change evidence
execution boundary compliance
discipline proof obligations and evidence, when present
semantic authority freshness
reconciliation result
open proof gaps and failure responses
```

## Minimum Contents

An Evidence Packet preserves:

```text
record id
record state
owning Delivery run
final work delta pointer
tested commit, version, or local final work delta label
product judgment coverage
proof obligations covered
evidence produced
evidence mapped to proof obligation ids
exact proof commands and runtime names
standing Required Check references, when governing entries bind checks
proof receipt references, when generated tooling support produced receipts
declared non-change evidence
discipline evidence, when selected discipline created obligations
freshness status
stale proof findings, when present
reconciliation result
open proof gaps and failure responses, when present
```

## Tool Observation Use

Proof receipts, stale proof findings, changed-file summaries, and prepared
Evidence material from tooling are tool observations.

An Evidence Packet may cite those observations after the agent interprets what
they prove, what they do not prove, and whether they remain fresh against the
final work delta. A receipt by itself does not satisfy a proof obligation. The
Evidence Packet must map evidence to the obligation and record any proof gap or
freshness failure.

When a governing semantic authority entry binds a Required Check, evidence may
satisfy the matching proof obligation by referencing that standing check with
a fresh passing run. The agent still maps the reference to the obligation id
and interprets coverage: a standing check covers only what its `What Passing
Means` states, and the entry's `What Passing Does Not Prove` limits stay in
force. Run-specific obligations that no standing check covers keep their own
evidence.

A coverage entry satisfied by a standing check needs only the reference: the
owning entry, the registered command, and the result date. Do not duplicate
the check's steps, restate its script, or invent parallel evidence items for
the same claim — the entry's Required Check section already owns what passing
means and does not prove.

Reference receipts by proof command identity plus result and date. A receipt
id is a pointer into ignored tooling support: useful while the file exists,
not a durable field the packet must chase. When re-proving only refreshes
receipts for the same commands with the same coverage, existing coverage
entries remain correct without rewriting; update the date when it matters.
When tooling support is present, `lt prove all` runs every registered proof
command in one invocation and `lt prepare evidence` emits the current
obligation-to-receipt coverage mapping with a paste-ready coverage block, so
assembling the packet is interpretation work, not collection work.

Proof receipt freshness is evaluated against product, semantic authority,
configuration, support, and target artifact inputs. Normal Control-record
updates after proof, such as mapping the receipt into the Evidence Packet or
creating Landing and Closure records, do not by themselves make the proof stale.
If proof obligations change, current proof coverage is still checked against
the active Work Boundary.

## Lifecycle

Create an Evidence Packet when the active Work Boundary has concrete proof
obligations and the run is about to make substantive Build edits.

Update it when proof runs, proof commands, tested version, declared non-change
evidence, product judgment coverage, discipline evidence, freshness
status, reconciliation result, proof gaps, or failure responses change.

The Evidence Packet is active while proof is being assembled or reconciled. It
exits active state when landing readiness passes or a proof gap is recorded and
the owning Delivery state reflects that gap.

While the final work delta is not frozen, use `final_work_delta` to name the
current intended or in-progress delta and record pending proof coverage. After
the work delta is frozen, update the same packet so it points to the final
proof target.

If the Evidence Packet is first created after implementation is complete, treat
that as a cadence failure unless the active Work Boundary explicitly recorded
that no proof was needed before Build. Notify the founder-dev immediately
instead of silently reconstructing proof state.

Validation check:

```text
proof covers the final work delta or records the proof gap and failure response
product judgment, tradeoffs, exclusions, and falsifiers are covered or routed
back to Framing
discipline obligations have evidence or explicit rejection when selected
```

Forbidden ownership:

```text
admitted behavior
release or merge handoff state
durable product authority
```

## Template

```yaml
evidence_packet:
  id: ""
  state: "active"
  owning_delivery_run: ""
  final_work_delta: ""
  tested_commit_version_or_local_delta: ""
  product_judgment_coverage: []
  proof_obligations_covered: []
  evidence: []
  proof_commands: []
  proof_receipts: []
  discipline_evidence: []
  declared_non_change_evidence: []
  freshness_status: ""
  stale_proof_findings: []
  reconciliation_result: ""
  open_proof_gaps_and_failure_responses: []
```

## Expanded Example

```yaml
evidence_packet:
  id: "evidence.team-invite-create.abc123"
  state: "landing-ready"
  owning_delivery_run: "team-invite-create"
  tested_commit_version_or_local_delta: "abc123"

  final_work_delta:
    - "Team admins can create pending invites."
    - "Invite creation sends an email."

  authority_source_versions:
    - "context.teams@2026-05-11"
    - "intent.team-invites.create@2026-05-11"
    - "assurance.team-invites.no-seat-allocation-on-create@2026-05-11"
    - "description.team-invite-service@2026-05-11"

  product_judgment_coverage:
    behavior_admitted_checked:
      - "Team admins can create pending invites."
      - "Invite creation sends an email."
    tradeoff_checked:
      - "Invite creation is present without accepting invite acceptance, billing, duplicate policy, or expiration policy."
    exclusions_checked:
      - "No invite acceptance behavior was added."
      - "No membership activation was added."
      - "No billing seat allocation was added."
      - "No role hierarchy change was added."
    falsifiers_checked:
      - "No current product authority required invite acceptance in the same release."
      - "Implementation did not require membership activation, schema, or billing behavior."
    status: "satisfied"

  proof_obligations_covered:
    - proof_obligation_id: "proof.team-admin-create-pending-invite"
      claim: "A team admin can create a pending invite."
      evidence: "admin_can_create_pending_invite passed"
      status: "satisfied"
    - proof_obligation_id: "proof.non-admin-cannot-create-invite"
      claim: "A non-admin cannot create an invite."
      evidence: "non_admin_cannot_create_invite passed"
      status: "satisfied"
    - proof_obligation_id: "proof.invite-lookup-tenant-scoped"
      claim: "Invite lookup is tenant-scoped."
      evidence: "invite_lookup_tenant_scoped passed"
      status: "satisfied"
    - proof_obligation_id: "proof.email-dispatch-idempotent"
      claim: "Email dispatch is idempotent."
      evidence: "email_dispatch_idempotent passed"
      status: "satisfied"
    - proof_obligation_id: "proof.billing-seat-count-unchanged"
      claim: "Billing seat count does not change."
      evidence: "seat_count_unchanged_after_invite_create passed"
      status: "satisfied"
    - proof_obligation_id: "proof.no-invite-acceptance-route"
      claim: "No invite acceptance route is added."
      evidence: "no_invite_acceptance_route_added passed"
      status: "satisfied"

  evidence:
    acceptance:
      - name: "admin_can_create_pending_invite"
        result: "passed"
      - name: "non_admin_cannot_create_invite"
        result: "passed"
    assurance:
      - name: "seat_count_unchanged_after_invite_create"
        result: "passed"
      - name: "invite_lookup_tenant_scoped"
        result: "passed"
      - name: "email_dispatch_idempotent"
        result: "passed"
    non_changes:
      - name: "no_billing_area_changed"
        result: "passed"
      - name: "no_auth_provider_changed"
        result: "passed"
      - name: "no_invite_acceptance_route_added"
        result: "passed"
    semantic_authority_sync:
      - name: "description_team_invite_service_current"
        result: "passed"
      - name: "intent_no_conflict_with_code_delta"
        result: "passed"
    execution_boundary:
      - name: "no_live_email_provider_used"
        result: "passed"
      - name: "no_deployment_or_migration_run"
        result: "passed"
    runtime:
      - name: "invite_email_delivery_monitor_configured"
        result: "passed"

  discipline_evidence: []

  proof_commands:
    - "npm test -- team-invites"

  proof_receipts:
    - receipt_id: "receipt.team-invite-tests.2026-05-11"
      proof_command_id: "test.team-invites"
      covers:
        - "proof.team-admin-create-pending-invite"
        - "proof.non-admin-cannot-create-invite"
        - "proof.invite-lookup-tenant-scoped"
        - "proof.email-dispatch-idempotent"
        - "proof.billing-seat-count-unchanged"
        - "proof.no-invite-acceptance-route"

  freshness_status:
    code_changed_after_tests: false
    semantic_authority_changed_after_tests: false
    policy_changed_after_tests: false
    work_boundary_changed_after_tests: false
    work_delta_changed_after_tests: false

  reconciliation_result:
    proof_obligations_satisfied: true
    added_behavior_covered: true
    changed_behavior_covered: true
    removed_behavior_covered: true
    declared_non_changes_checked: true
    assurances_checked: true
    semantic_authority_update_obligations_checked: true
    discipline_obligations_checked: true
    product_judgment_checked: true

  open_proof_gaps_and_failure_responses: []
```

## Discipline evidence example

Use this shape when selected discipline created proof obligations.

```yaml
discipline_evidence:
  - package_id: "example.database.production-migrations"
    discipline_id: "example.database.production-migrations"
    binding_id: "example.database.schema-migration-binding"
    retrieved_slice: "migration-classification"
    obligation: "Migration execution proof is required."
    evidence: "npm run db:migrate:test completed against migrated test database"
    status: "satisfied"
```

## Landing Role

A Delivery run is not landing ready until the Evidence Packet satisfies the
active Work Boundary's product judgment and proof obligations and remains
current against the final work delta.

If code, semantic authority, policy, or the active Work Boundary changes after
proof is produced, refresh proof or mark the proof gap.

When proof runs before the final landing commit exists, the Evidence Packet may
name the tested local final work delta. The Landing Packet should later record
the landed commit, version, or handoff reference when one exists. If the
Control records land in the same commit as the code, the handoff reference may
say that instead of naming a commit hash that cannot be known before commit
creation.

Use [../phases/evidence-and-reconciliation.md](../phases/evidence-and-reconciliation.md)
for phase behavior.
