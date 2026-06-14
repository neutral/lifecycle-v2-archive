# Discovery

## Purpose

Use Discovery when the next useful work is unclear.

Discovery maintains possible-work state and selects Signals for Delivery. It
does not admit behavior or authorize Build.

Use [../delivery/process.md](../delivery/process.md) when the founder-dev
already provides a concrete Signal.

Discovery Control records are live process state. Plan Items, Plan Maps, and
Selection Handoffs are updated as possible work and selection state changes;
they are not reconstructed at Delivery closure.

## Folder Map

Use [process.md](process.md) for the Discovery state machine, normal path,
state transitions, Control record expectations, failure routing, and completion
conditions.

Use [gates.md](gates.md) to decide whether the active Discovery state may
advance.

Use [control-records/overview.md](control-records/overview.md) for Discovery
Control records:

```text
plan map
plan item
selection handoff
```

Use [../control/overview.md](../control/overview.md) for shared control
mechanics: states, retrieval, contracts, closure, checks, and templates.

Use [../../semantic-authority/surfaces/contract.md](../../semantic-authority/surfaces/contract.md)
when Discovery needs to retrieve semantic authority entries, check entry state,
or use product meaning to shape candidate Signals.

## Process Boundary

Discovery shapes attention and selects work. Delivery admits and realizes
selected work.

The handoff is:

```text
Discovery
-> selected Signal
-> Delivery
```

Discovery can close without starting Delivery. Delivery can start without
Discovery history when the founder-dev provides a concrete Signal.
