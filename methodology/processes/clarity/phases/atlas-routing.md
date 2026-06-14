# Atlas Routing

## Purpose

Use Atlas Routing to make broad Context retrievable.

The route should express current target product neighborhoods, not old source
containers.

## Actions

Do these when the boundary admits route work:

```text
inventory existing Context IDs, areas, clusters, roles, review labels, and
freshness labels
choose product areas and clusters
move entries by current target product neighborhoods, not source containers
create neutral folder overview.md files when folders are created
create or update current Context area and cluster overview entries
set context_area, context_cluster, context_role, parent_context,
child_contexts, and context_relations
preserve stable Context IDs exactly once
leave leaf review labels unchanged unless leaf content is reviewed
record later cluster-review, supersession, or promotion pressure explicitly
```

Use folders to express current target product neighborhoods when that improves
retrieval:

```text
records/context/<product-area>/<cluster>/<entry>.md
```

Stable entry IDs remain semantic identity. Moving an entry to a better path
does not change its meaning by itself. Changing the entry's current meaning,
scope, state, supersession, or governing route does.

Create or update a current Context area overview when:

```text
a product area has enough Context that future agents need a route
a cluster has a freshness or review policy of its own
canonical references and rationale leaves need to be distinguished
old source structure is being removed and target-native routes need to replace
it
promotion pressure needs to be visible across later runs
```

Route currentness is scoped. A corpus organization entry or area overview can
be current for folders, metadata, reader routes, and area boundaries while its
topic leaves remain unreviewed. Do not convert `review_status:unreviewed` to
reviewed, narrowed, deprecated, or superseded during a route-only pass.

When a full-corpus pass reorganizes many entries, state the boundary plainly in
the corpus organization entry, area overviews, Clarity Boundary, and Context
Review Packet:

```text
route reviewed: folders, area overviews, metadata, and reader routes
content not reviewed: individual leaves still need cluster adequacy review
```

## Exit

Exit when a future agent can navigate from records/context/overview.md to the
smallest relevant Context slice.
