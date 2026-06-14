# Retrieve Product Meaning

## Purpose

Use this operation to load only the product meaning needed for the current
state. During Delivery, retrieval informs product judgment; it does not replace
the agent's obligation to state the judgment in the active Work Boundary.
During Clarity, retrieval informs Context review and update choices; it does
not replace the agent's obligation to keep the active Clarity Boundary and
Context Review Packet current.

## Procedure

1. Identify the decision the current state must make.
2. Open `semantic-authority/semantic-authority-surface-registry.yaml`.
3. Select the semantic authority surfaces whose `owns` and `retrieval_keys`
   match the decision.
4. Search each selected surface storage locator by stable ID, scope,
   `retrieval_keys`, and `target_references`.
5. Read the smallest entry set that can answer the current question.
6. Check entry state, scope, `updated_at`, freshness or review labels,
   `supersedes`, and `superseded_by`.
7. Follow `related_surfaces` only when the current decision depends on that
   other surface's owned meaning.
8. Follow `target_references` only when the implementation surface is part of
   the product meaning being used.
9. Stop retrieval when the active state can answer its controlling question. In
   Work Boundary active state, that means the agent can state or revise product
   judgment without guessing from chat or broad history.

Use the installed registry field `storage_locator` to find each selected
surface. For a `records/` folder, search that folder. For a file pattern,
search matching files. Description currently uses `_*.desc.md` files beside
relevant source files instead of `records/description/`.

When the selected surface is Context and the corpus is broad, retrieve through
the atlas route before reading topic leaves:

```text
1. Read records/context/overview.md only for neutral folder purpose.
2. Find the current corpus, area, or cluster overview by stable ID, scope, or
   retrieval keys such as context_area, context_cluster, and context_role.
3. Use that overview to identify the semantic neighborhood for the current
   decision.
4. Read canonical Context references before rationale, history, glossary,
   scenario, design, proof-context, or open-question leaves.
5. Follow local graph relations only when they narrow the semantic authority
   slice or expose a contradiction, freshness issue, review-status limit, or
   promotion pressure.
6. Stop before the corpus becomes broad history reading.
```

File paths and folders help navigation, but they do not replace entry state,
scope, current meaning, supersession, or related authority. If retrieval still
requires scanning most of `records/context/`, update the Context atlas route or
record semantic authority backpressure instead of relying on broad history.

## Cheap Retrieval Rules

Start with current or admitted entries whose scope matches the work. Add
provisional entries only when their stated limits cover the current decision.
For broad Context, treat `review_status` and `freshness` labels as authority
limits. A current leaf marked unreviewed or needs-cluster-review can orient the
work, but do not treat it as a reviewed canonical source unless the active
Clarity Boundary or Work Boundary admits that limited reliance.

Do not read the whole product history to compensate for missing identity,
scope, or state. When retrieval requires broad history reading, fix the product
entry that should have carried the stable ID, retrieval keys, target
references, supersession, or scope.

Use stale, superseded, deprecated, or archived entries only to understand why
current authority changed. They do not govern the current work unless the
active state explicitly asks for history or audit context.

## Conflict Handling

Treat the semantic authority slice as blocked when:

```text
two current entries govern the same scope differently
a current entry depends on a stale or missing related entry
a broad Context entry is current but its review_status or freshness label
limits the authority needed for this decision
a target reference points at an implementation surface that no longer exists
the only matching entry is candidate, stale, superseded, deprecated, or archived
the needed meaning is present only in a Control record, proof note, runtime
observation, or scratch note
```

When a conflict appears, stop broad retrieval and use
[resolve-semantic-authority-backpressure.md](resolve-semantic-authority-backpressure.md).

## Output

Record the retrieved authority source names, paths, and freshness in the active
Control record when Clarity, Delivery, or Discovery depends on them. Include the
entry state and any provisional, stale, or conflict notes that affect the next
move. When Clarity is active, record how the retrieved slice affects review,
canonicalization, promotion pressure, or retrieval proof. When Delivery is
framing work, also record how the retrieved slice materially supports, limits,
or falsifies the product judgment.

## Failure Route

If the needed meaning is missing, stale, contradictory, or owned by no installed
surface, use
[resolve-semantic-authority-backpressure.md](resolve-semantic-authority-backpressure.md).
