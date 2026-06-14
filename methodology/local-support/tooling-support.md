# Tooling Support

## Purpose

Use this page when optional tooling support exists in a target codebase or when
a tool reports that support is missing, stale, or inconsistent.

Tooling support is generated local support. It helps tools inspect, verify,
prove, prepare, and explain mechanical Lifecycle relationships. It is not
product authority, product judgment, process state, proof by itself, or
installed methodology.

## Usage Documentation

Tool usage documentation installs at `.lifecycle/usage/tools/` — the command
surface, the gate-to-command mapping for agents, and the human inspection
guide — under the general `.lifecycle/usage/` operating-docs root. Read it
like installed methodology: read-only local support, refreshed by reinstall.

## Location

Optional generated tooling support lives under:

```text
.lifecycle/tooling/
```

Expected subareas include:

```text
support/                  generated contracts, registries, and check definitions
cache/                    rebuildable indexes
findings/                 current tool findings
receipts/                 proof receipts
prepared-material/        generated draft material for records
config.local.json         optional local tool overrides
tooling.lock.json         generated support version and source contract hashes
```

The exact contents may vary by tooling version. The location and authority
treatment do not vary.

## Authority Rule

Tooling support is derived from Lifecycle source methodology, source-owned
contracts, installed profile data, target records, semantic authority entries,
and local configuration.

A source-owned contract is the checkable form of a Lifecycle rule owned by the
source methodology. It lets tooling check a rule repeatedly without becoming a
second rule source.

Tooling support does not own rules. The owning rule remains in source
methodology and its source-owned contract. Installed tooling support carries a
derived copy for tools to consume.

Tooling support does not preserve product meaning or process state. Durable
state belongs in `records/`.

In the Lifecycle source, source-owned contracts for tool config and tool
observations live beside this page as `tool-config.contract.json` and
`tool-observations.contract.json`. Generated tooling support may copy them into
`.lifecycle/tooling/support/`.

## Agent Use

Use tooling output as input to judgment:

```text
finding -> inspect the owning record, file, or authority surface
proof receipt -> decide whether it satisfies the Evidence Packet obligation
prepared material -> rewrite or incorporate it into the owning durable record
stale support -> refresh generated support or continue manually
stale proof -> refresh proof or record the proof gap
```

The agent still decides whether a finding requires reframe, split, defer,
product judgment revision, proof refresh, reconciliation, landing block,
closure block, or semantic authority update.

## Recording Rule

Do not commit raw tooling support as product records or Control records.

Record the interpreted effect in the owning durable record when tooling output
changes durable state:

```text
basis finding -> Work Boundary recommendation basis or recommendation delta
judgment finding -> Work Boundary product judgment or judgment delta
scope drift finding -> Work Boundary or reconciliation state
stale proof finding -> Evidence Packet proof gap or refreshed proof result
authority tracing finding -> semantic authority update obligation or no-op
landing readiness finding -> Landing Packet or active Control record blocker
closure finding -> closure record or carried-forward state
```

Prepared material remains draft material until the agent authors or revises the
owning durable record.

## Missing Or Stale Support

Missing or stale tooling support blocks only the tool-backed check that depends
on it.

When tooling support is unavailable:

1. Continue with the manual Lifecycle path when the installed methodology and
   records are readable.
2. Use the relevant methodology check manually.
3. Refresh tooling support when the user or workflow asks for tool-assisted
   checks.
4. Record only durable effects, not the raw tooling failure.

## Removal Rule

Generated tooling support should be removable without deleting:

```text
records/
.lifecycle/methodology/
.lifecycle/disciplines/
.lifecycle/scratch/
.lifecycle/work-traces/
.lifecycle/stop-work-requests/
```

Removing tooling support removes derived support and cache material only. It
does not erase product meaning, process state, proof recorded in Evidence
Packets, product judgment recorded in Work Boundaries, or semantic authority
entries.
