# Lifecycle Tooling Usage

## Purpose

Use this folder to operate `lt`, the optional Lifecycle CLI. `lt` mechanically
checks target Lifecycle state — record shape, live cadence, product judgment
presence, scope drift, proof freshness — and reports findings. It never decides
Lifecycle movement.

These pages assume the package-managed install. Everything here works the same
for a human at a terminal and for an agent working a target repo.

## Install

Install into the target repo with its normal package manager:

```sh
npm install --save-dev @neutral/lifecycle-tools
```

The package ships the `lt` binary with its contract bundle included. Invoke it
as the repo's tooling normally runs:

```sh
npm exec lt -- status --target .
```

Direct `lt` invocations in these pages assume the binary is on the path
through the package manager. The Lifecycle install documentation covers
generated tooling support (`.lifecycle/tooling/`) and configuration.

## Pages

- [commands.md](commands.md) — the full command surface, global options, exit
  codes, and check semantics.
- [agent-use.md](agent-use.md) — which command belongs at which Lifecycle
  gate, run identity, proof receipts, and how to read results. Written for
  agents; useful to humans reviewing agent work.
- [inspect.md](inspect.md) — quick human orientation with the inspection
  commands.

## Authority Boundary

Tools produce observations. Findings, receipts, indexes, and prepared material
become durable only when an agent records the interpreted effect in the owning
Control record or semantic authority entry. A passing check is not acceptance;
a failing check is not a verdict — both are inputs to judgment.
