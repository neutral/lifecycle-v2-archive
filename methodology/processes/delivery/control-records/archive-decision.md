# Archive Decision

## Purpose

Use an archive decision when material remains useful history but should not
become current product authority.

Archive decisions keep closed Delivery material retrievable without letting it
enter active context by default.

## When To Use

Create an archive decision when Delivery leaves behind:

```text
useful notes that should not govern future work
rejected learning
superseded process state
closed product judgment that should remain history only
runtime material that did not become product authority
historical rationale needed for audit
```

## Minimum Contents

An archive decision preserves:

```text
record id
record state
material archived
source record pointers
reason it is not current product authority
retrieval condition
supersession pointer, when relevant
```

## Lifecycle

Create an archive decision when material should remain history only.

Update it when source material, archive reason, retrieval condition, or
supersession pointer changes before closure.

The archive decision exits active state when the closure record records the
archive pointer and no current work depends on the archived material.

Validation check:

```text
the reason the material is not product authority is explicit
```

Forbidden ownership:

```text
current product authority
current product judgment
active process state
proof status
```

## Template

```yaml
archive_decision:
  id: ""
  state: "archived"
  material_archived: ""
  source_records: []
  reason_not_product_authority: ""
  retrieval_condition: ""
  supersession_pointer: ""
```

## Retrieval Boundary

Archived material is off by default. Read it only for audit, supersession,
historical investigation, or an explicit current pointer.
