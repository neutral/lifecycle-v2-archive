# Runtime Tests

`runtime/tests/` mirrors the implemented owners under `runtime/src/` while
keeping cross-owner package and integration assertions explicit. Every test
file lives in one of these bounded groups:

```text
atlas/        Atlas processing and failure boundaries
attempt/      Provider Adapter, Codex transport, and Agent Execution Cells
candidate/    Candidate Revision Carriers, materialization, sealing, and diff
check/        Check Execution Cells and Check integration
cli/          command parsing, help, and public CLI behavior
control/      Control records, policies, revisions, and inspection
evidence/     physical Evidence observation
execution/    backend, host, Input Set, output, Retirement, and Reclamation mechanics
integration/  facade and multi-owner runtime composition
knowledge/    Knowledge parsing, sources, relationships, and structure
package/      build-output and package-staging boundaries
process/      reducer, Activity, operation, evaluation, recovery, and bounded Journal exploration
projection/   Projection orientation, execution, and retained Control
repository/   contract, validation, identity, locking, and initialization bindings
support/      shared filesystem, byte, cancellation, and configuration mechanics
transaction/  admission and terminal transactions
validation/   strict JSON and Foundation validation
helpers/      test-only fixtures; never product or qualification inputs
```

The setup and parent-loss system rows remain package-local because they import
runtime implementation owners directly. Root workspace commands address their
compiled paths under `integration/` and `attempt/`; this does not promote them
to the cross-package operated evidence owned by
[`../../qualification/`](../../qualification/overview.md).

The runtime runner discovers `*.test.js` recursively after compilation and
runs package staging in its own exclusive batch. Adding another test group must
preserve that recursive discovery, keep imports relative to the owning package,
and update any maintained inventory that names the moved source path.

`process/exploration/` contains the owner-adjacent deterministic bounded
explorer for one Delivery Journal. Its generic engine and product-free oracle
tests run with the ordinary runtime suite. Its aggregate zero-finding profile
is also an explicit CI step. It requires deterministic batch, incremental, and
midpoint-fork replay; exact acceptance/refusal agreement; declared phase,
command, seed-event, generated-event, and recovery coverage; and aggregate
observation of each registered one-Journal event, non-recovery operation,
event-based recovery coordinate, Standing, and Candidate condition. Aggregate
identity observation is not transition coverage: trusted seed prefixes may
supply event identities, and a recovery coordinate may be an observed endpoint.
The exact behavioral claim remains bounded by each scenario's seeds, command
alphabet, and depth. Every gated property has a deliberate killing mutation.
Known findings cannot become a passing baseline.

After building the runtime, run the required gate from the repository root
with:

```sh
npm run build -w @neutral/lifecycle-runtime
npm run test:delivery-exploration:built
```

Set `LIFECYCLE_RUN_DELIVERY_BOUNDED_EXPLORATION_SURVEY=1` on the gate command to
emit the versioned diagnostic projection with exact bounds, coverage, refusal
codes, and shortest findings. Diagnostic output does not weaken the same
zero-finding assertion.

This package-local explorer does not establish cross-Delivery, physical-effect,
qualification, conformance, or proof claims.
