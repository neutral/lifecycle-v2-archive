# Intent surface

## Purpose

The Intent surface captures admitted product behavior.

Use [contract.md](contract.md) for shared semantic authority entry
state, related semantic authority, update rules, and promotion paths.

It answers:

```text
What should the product do?
What should it not do?
How do we know it works?
```

Intent is strong product behavior authority when current.

## Typical contents

Intent should be organized globally or per feature.

It may include:

- behavior statements
- acceptance checks
- non-goals
- preconditions
- postconditions
- role and permission expectations
- user-visible outcomes
- edge cases

Intent converts vague product meaning into checkable commitments.

## Contract focus

Intent entries should expose:

```text
primary question: what behavior is intended
owned meaning: behavior, non-goals, acceptance checks, role expectations, and
user-visible outcomes
common references: Context rationale, Assurance obligations, Blueprint flow,
Description ownership, and target surfaces
```

Update Intent when admitted behavior, declared non-goals, acceptance checks, or
role expectations become durable product meaning. Keep proof status in Evidence
Packets and one-run product judgment and scope in the Work Boundary.

An acceptance check may be executable: bind it as a Required Check using the
Required Checks section of [contract.md](contract.md). A bound check
demonstrates the admitted behavior against the current target; it does not
admit behavior, and its failure is a breach to route as a new Signal, not a
reason to edit the entry.

## Example

```yaml
intent:
  id: "intent.team-invites.create"
  surface: "intent"
  state: "current"
  scope: ["teams", "invites"]
  current_meaning: "A team admin may create a pending invite for an email address."
  retrieval_keys:
    - "product_area:teams"
    - "behavior:create-team-invite"
    - "role:team-admin"
  target_references:
    - "Team Settings invite action"
  behavior:
    - "A team admin may create a pending invite for an email address."
    - "Invite creation sends an invite email."
  acceptance_checks:
    - "Given a team admin, when they invite an email, then a pending invite exists."
    - "Given a non-admin, when they attempt to invite, then the action is rejected."
  declared_non_goals:
    - "Invite acceptance is not part of this behavior."
    - "Billing seat allocation is not changed by invite creation."
  related_surfaces:
    - "context.teams"
    - "assurance.team-invites.no-seat-allocation-on-create"
    - "description.team-invite-service"
  supersedes: []
  superseded_by: ""
  updated_at: "YYYY-MM-DD"
```
