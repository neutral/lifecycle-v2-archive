# Description surface

## Purpose

The Description surface captures implementation-local meaning.

Use [contract.md](contract.md) for shared semantic authority entry
state, related semantic authority, update rules, and promotion paths.

It answers:

```text
What is this module or file supposed to do?
What responsibilities does it own?
What responsibilities are forbidden?
What invariants must it preserve?
How should future agents safely modify it?
```

Description files are implementation-local authority when current and aligned
with higher-level semantic authority.

## Storage and naming

Description files live beside the source files they describe. Do not store
Description authority under `records/description/`.

Use a leading `_` and the suffix `.desc.md`:

```text
src/team/invites/service.ts
src/team/invites/_service.ts.desc.md
```

When one Description file describes exactly one source file, keep the source
file name and extension before `.desc.md`.

When one Description file describes a group of files, use a short group name
that starts with `_` and ends with `.desc.md`:

```text
src/team/invites/_invite-service.desc.md
```

The file must name the described source surface in `target_references` or in a
clear `Source Surface` section so agents can tell whether the Description is
one-to-one with a source file or owns a group.

## Typical contents

Description files should not paraphrase code line by line.

They should capture what code alone does not make obvious:

- purpose
- responsibilities
- non-responsibilities
- invariants
- dependencies
- extension points
- sensitive edges
- linked Intent and Assurance IDs

Description files are most valuable for:

- high-entropy modules
- legacy code
- sensitive areas
- generated-code boundaries
- integration-heavy services
- modules with complex invariants

They are less valuable for tiny obvious files.

The Description surface gives agents local context without forcing them to load
distant semantic authority on every edit.

## Contract focus

Description entries should expose:

```text
primary question: what this implementation surface owns
owned meaning: local responsibility, non-responsibility, invariants,
dependencies, extension points, and sensitive edges
common references: Intent, Assurance, Blueprint, and target files
```

Update Description when implementation-local meaning changes. Do not update it
to restate mechanical diffs or to justify unadmitted behavior.

## Example

```yaml
description:
  id: "description.team-invite-service"
  surface: "description"
  state: "current"
  scope: "src/team/invites/service.ts"
  current_meaning: "The Team Invite Service creates and manages pending team invites. It does not own invite acceptance, membership activation, billing seat allocation, or role hierarchy definition."
  retrieval_keys:
    - "target:src/team/invites/service.ts"
    - "responsibility:pending-invite-creation"
    - "sensitive_edge:billing-seat-allocation"
  target_references:
    - "src/team/invites/_service.ts.desc.md"
    - "src/team/invites/service.ts"
  owns:
    - "pending invite creation"
    - "duplicate pending invite handling"
    - "invite-created email dispatch trigger"
  does_not_own:
    - "invite acceptance"
    - "membership activation"
    - "billing seat allocation"
    - "role hierarchy definition"
  invariants:
    - "All invite lookups are tenant-scoped."
    - "Duplicate pending invite creation follows current Intent."
  related_surfaces:
    - "intent.team-invites.create"
    - "assurance.team-invites.no-seat-allocation-on-create"
  supersedes: []
  superseded_by: ""
  updated_at: "YYYY-MM-DD"
```
