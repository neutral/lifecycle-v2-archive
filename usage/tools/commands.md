# Command Reference

## Purpose

Use this page for the implemented `lt` command surface.

## Commands

```text
lt status --target .
lt doctor --target .

lt inspect product --target .
lt inspect active --target .
lt inspect authority --target . [--surface <surface-id>]
lt inspect record <record-id> --target .
lt inspect run <run-id> --target .
lt inspect finding <finding-id> --target .
lt inspect receipt <receipt-id> --target .
lt inspect index --target .

lt verify --target . [--all] [--group <group-id>] [--check <check-id>]
lt verify control --target . --run <run-id>
lt verify clarity --target . --run <run-id>
lt verify judgment --target . --run <run-id>
lt verify basis --target . --run <run-id>
lt verify scope --target . --run <run-id>
lt verify proof --target . --run <run-id>
lt verify bindings --target .
lt verify authority --target . [--surface <surface-id>] [--since <ref>]
lt verify disciplines --target . --run <run-id>
lt verify evidence --target . --run <run-id>
lt verify landing --target . --run <run-id>
lt verify closure --target . --run <run-id>
lt verify setup --target .
lt verify drift --target .
lt verify support --target .
lt verify config --target .
lt verify list --target .
lt verify show <check-id> --target .

lt prove list --target .
lt prove run <proof-command-id> --target . --run <run-id>
lt prove all --target . --run <run-id>
lt prove receipts --target . --run <run-id>
lt prove receipt <receipt-id> --target .
lt prove freshness --target . --run <run-id>

lt prepare evidence --target . --run <run-id>
lt prepare landing --target . --run <run-id>
lt prepare closure --target . --run <run-id>

lt explain finding <finding-id> --target .
lt explain check <check-id> --target .
lt explain record <record-id> --target .
lt explain receipt <receipt-id> --target .
lt explain surface <surface-id> --target .

lt support status --target .
lt support refresh --target .
lt support remove --target .
lt support lock --target .
lt support index --target .

lt config show --target .
lt config validate --target .
lt config init --target . --write
```

## Global Options

```text
--target <path>       target repository root
--run <id>           Clarity, Discovery, or Delivery run id
--surface <id>       semantic authority surface id
--check <id>         one check id
--group <id>         check group id
--since <ref>        git reference for changed-file scope
--profile <name>     installed Lifecycle profile
--json               same as --format json
--format <name>      text, json, markdown
--detail <level>     compact, normal, full
--fail-on <level>    blocker, warning, none
--no-cache           ignore cached indexes
--refresh            refresh support before running
--config <path>      additional config file
--output <path>      write command output to a file
--write              explicitly allow supported writes
```

Default output is human-readable text. Agent workflows should use `--json` for
stable schemas.

## Exit Codes

```text
0 success; no findings at or above fail threshold
1 findings at or above fail threshold
2 stale or missing tooling support for requested command
3 invalid configuration or invalid invocation
4 proof command failed
5 internal tool error
```

Warnings can exit `0` unless the caller sets `--fail-on warning`.

## Check Semantics

`lt verify control` also blocks detectable live-cadence failures. If
substantive changed files exist without an active Work Boundary, it reports
`control.live-work-boundary-required`. If substantive changed files exist for
an active run without an active Evidence Packet, it reports
`control.live-evidence-required`. These findings mean the agent should stop
normal work and notify the founder-dev instead of reconstructing Control
records at the end.

For Context-only Clarity work, `lt verify control` allows substantive
`records/context/` changes under an active Clarity Boundary and active Context
Review Packet. If Context changes exist without those live records, it reports
`control.live-clarity-boundary-required` or
`control.live-context-review-required`.

After a Clarity run is closed, Clarity verification owns the finished Context
state. If Context changed files remain and closed Clarity run records are
present, `lt verify control` reports `control.closed-clarity-run-present` as
an informational pointer to run `lt verify clarity --run <run-id>` instead of
requiring a new active Clarity Boundary for the already-closed run.

`lt verify clarity --run <run-id>` checks the Clarity run as a Context-focused
process. It requires a Clarity Boundary, Source Inventory, and when Context
review is needed, a Context Review Packet tied to the Context surface contract.
It also checks the no-auto-start rule so Clarity can leave recommendations for
founder-dev review without automatically starting Discovery or Delivery.

`lt verify authority --surface context` adds Context-specific mechanical
checks to likely-surface tracing. It checks duplicate Context ids, atlas field
presence where atlas routing is in use, relation shape and resolvable targets,
review and freshness vocabularies, folder `overview.md` coverage, and root
topic files that bypass the atlas route. These findings are structural
observations; the agent still decides the owning semantic-authority update.
`lt verify authority` also reports `authority.backpressure` as a blocker when
an active Work Boundary explicitly records unresolved
`semantic_authority_backpressure`; `none`, `resolved`, and `not applicable`
states do not block.

`lt inspect authority --surface context` returns the normal Context surface
plus a `contextAtlas` summary. The summary groups entries by area, cluster,
and role, and surfaces canonical references, rationale leaves, unreviewed or
stale leaves, promotion candidates, duplicate ids, relation issues, overview
gaps, and root flat topic files. Authority entries are compact by default; add
`--detail full` when raw entry text or parsed YAML is needed.

`lt verify disciplines --run <run-id>` checks selected discipline
usage for the run. It verifies that `disciplines_used` entries name an
installed package, binding, discipline surface, selected slices, used material,
and proof effects; that selected proof effects have matching
`discipline_evidence`; and that closed runs record
`discipline_outcomes`.

`lt verify control` also checks Discovery selection continuity. Active
Selection Handoffs must have live selected Plan Item state, current Plan Map
state when selection state is tracked, and a concrete Delivery handoff target.
Findings use `control.discovery-selection-handoff-live`,
`control.discovery-plan-map-current`, or
`control.discovery-selection-handoff-target`.

`lt verify judgment` checks that the active Work Boundary records substantive
product judgment before Build. It blocks missing, placeholder, or under-shaped
`product_judgment` fields, including missing admitted behavior, why-now,
tradeoff, exclusions, falsifiers, or proof consequences. The command does not
decide whether the product judgment is good; it verifies that the agent has
made the weighing step visible before action.

After a Delivery run is closed, closure verification owns the finished state.
If substantive changed files remain but closed Delivery records are present,
`lt verify control` reports `control.closed-run-present` as an informational
pointer to run closure verification.

`lt verify scope` is an active-run check. When `--run <run-id>` names a closed
Delivery run, or when no run is selected but closed Delivery run records are
present, it reports `scope.closed-run-present` as an informational pointer to
closure verification instead of treating the missing active Work Boundary as a
scope blocker.

`lt verify bindings` audits the Required Check bindings that Intent and
Assurance entries carry. For every Required Check section it verifies that the
bound check command resolves to a registered proof command
(`bindings.command-registered`, blocker), that the bound proof obligation id
appears in that command's covers list (`bindings.obligation-covered`,
warning), that `last_held` carries a date and result without receipt ids
(`bindings.no-receipt-id`, blocker), and that the section binds obligation id,
check command, environment requirement, and last_held
(`bindings.section-complete`, warning). A broken binding makes no claim;
repair the entry, the script, or the registry before treating the check as
current proof support.

`lt prove run` supersedes receipts: when a newer passing receipt for the same
run and proof command covers at least the same obligations, older passed
receipt files are pruned automatically, and superseded receipts stop reporting
as stale. Superseded failed receipts stay on disk and report at info level
under `proof.failed-receipt-superseded` so failure history remains visible
without blocking.

`lt prove all --run <run-id>` runs every registered proof command in one
invocation, writes a receipt per command with the same supersession pruning,
and exits `4` when any command fails. Use it as the proof batch after the
final work delta is frozen instead of invoking `lt prove run` once per
command.

`lt prepare evidence --run <run-id>` emits, alongside the existing draft
material, a Proof Obligation Coverage section mapping each of the run's
obligations to its covering receipt — including whether the covering command
is a standing Required Check bound in an entry — and a paste-ready
`proof_obligations_covered` YAML block whose entries reference commands and
dates rather than receipt ids. The agent interprets and edits the block; the
tool only collects what already happened.
