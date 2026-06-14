# Agent Use

## Purpose

Use this page when an agent operates `lt` during target-repo Lifecycle work.
It maps commands to the moments the installed methodology defines, and records
the operating knowledge that makes runs smooth. Humans reviewing agent work
can read it the same way.

## Which Command At Which Moment

```text
session start, state discovery     lt status            active records, support state
                                   lt inspect active    parsed view of live process state
before Build (Work Boundary gate)  lt verify judgment   product judgment is substantive
                                   lt verify basis      recommendation basis is substantive
                                   lt verify control    live-cadence and record-shape checks
                                   lt verify bindings   Required Check bindings hold before relying on them
during proof                       lt prove all         run the whole registered proof batch in one invocation
                                   lt prove list        configured proof commands
                                   lt prove run <id>    execute one, capture a receipt
                                   lt prove receipts    receipts for the run
                                   lt prove freshness   receipt staleness against current files
                                   lt prepare evidence  obligation coverage mapping plus a paste-ready block
                                   lt verify proof      obligations covered by passing receipts
                                   lt verify evidence   Evidence Packet completeness
before landing                     lt verify scope      changed files against admitted surfaces
                                   lt verify authority  surfaces likely affected by the delta
                                   lt verify landing    Landing Packet readiness
at closure                         lt verify closure    closure record integrity
between runs, anytime              lt verify drift      receipt staleness across closed runs
                                   lt verify bindings   standing Required Checks still bind cleanly
                                   lt doctor            setup, support, and config problems
```

A bare `lt verify` runs a default subject set; drift, evidence, landing,
closure, authority, and clarity subjects must be requested explicitly.

## Run Identity

`--run <id>` must match how the records bind to the run:

- A Work Boundary's run identity derives from its record id, so
  `wb.<run-id>.md` yields `wb.<run-id>` — including the `wb.` prefix.
- Evidence Packets and receipts bind through their `owning_delivery_run`
  field.
- Give every run record an explicit `owning_delivery_run` (or `owning_run`)
  field and use one consistent `--run` value for verify and prove calls. When
  a scope or proof check reports "no active Work Boundary" against a run you
  know is active, the run id binding is the first thing to check —
  `lt inspect active` shows the id the tool derived.

## Proof Receipts

Proof commands are configuration, not convention:

- Shared, committed configuration lives in `lifecycle.tools.json` at the
  target root (`lt config init --target . --write` creates it). Local
  per-machine configuration lives in the ignored tooling support area.
- A local `proof_commands` block fully replaces the shared one — it does not
  merge. Do not define `proof_commands` locally when a committed registry
  exists.
- Generate receipts run-bound: `lt prove run <proof-command-id> --target .
  --run <run-id>`. Receipts generated without `--run` do not cover the run's
  obligations.
- Receipts go stale when any hashed freshness input changes — including
  semantic authority entries. A run that updates authority entries after proof
  re-runs its proof commands before landing; finalize proof-command
  configuration before the proof batch, because registry edits also stale
  receipts.
- Re-proving prunes superseded passed receipts automatically; superseded
  failed receipts stay on disk as info-level history. Hand deletion is only
  needed for receipts a newer receipt does not fully cover.
- When an entry binds a Required Check, run its registered command through
  `lt prove run` like any proof command, then refresh the entry's `last_held`
  line with the date and result. The receipt stays in tooling support; the
  entry carries date and result only.

## Reading Results

- Decide from findings, not from bare exit codes. Use `--json` for stable
  parsing; each finding carries its id, level, observed fact, and suggested
  owning movement.
- Cached findings shown by `lt status` can describe an earlier state; re-run
  the relevant `lt verify` subject before acting on them.
- A finding the agent judges wrong is still recorded: note the interpreted
  effect in the owning record and proceed per the methodology's gates. The
  tool observes; the records decide.

## Boundary

Everything here is observation machinery. Admission, proof sufficiency,
landing, and closure are decided in the records per the installed methodology;
`lt` checks what was recorded, never the other way around.
