# Runtime Tests

`runtime/tests/` mirrors the implemented owners under `runtime/src/` while
keeping cross-owner package and integration assertions explicit. Every test
file lives in one of these bounded groups:

```text
atlas/        Atlas processing and failure boundaries
attempt/      Provider Adapter, Codex transport, and Agent Execution Cells
candidate/    Candidate Revision Carriers, materialization, sealing, and diff
cli/          command parsing, help, and public CLI behavior
control/      Control records, policies, revisions, and inspection
evidence/     observations, semantic assessment, provenance, and acceptance verification
execution/    backend, host, Input Set, output, Retirement, and Reclamation mechanics
integration/  facade, connected Runtime courses, and cold restart campaigns
knowledge/    Knowledge parsing, sources, relationships, and structure
package/      build-output and package-staging boundaries
process/      reducer, Activity, operation, evaluation, recovery, and bounded Journal exploration
projection/   Projection orientation, execution, and retained Control
repository/   contract, validation, identity, locking, and initialization bindings
support/      shared disposable targets, boundary outputs, restart, and execution mechanics
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
preserve that recursive discovery and keep imports relative to the owning package.

Connected courses start through actual preparation and admission, then execute
the context, semantic finalization, Store, Candidate, integration, Evidence and
terminal owners. External seams supply raw provider output and Check proof
bytes. Cold restart cases terminate a child and reopen retained disk state in a
new child. The integration files identify their exact scenarios and assertions:

- [Knowledge continuity](integration/foundation-connected-knowledge.test.ts)
  and [Attempt output](integration/foundation-connected-attempt-output.test.ts)
  preserve independently valid work across supplied outcomes.
- [Integration correction](integration/foundation-connected-integration-correction.test.ts)
  and [resolution](integration/foundation-connected-resolution.test.ts)
  exercise conflicts, governing-context changes, and readmission.
- [Execution recovery](integration/foundation-connected-execution-recovery.test.ts)
  reopens exact selected custody without redispatch.
- [Canonical publication](integration/foundation-connected-publication.test.ts)
  and [terminal recovery](integration/foundation-connected-terminal-recovery.test.ts)
  exercise exact-parent effects, interruption, and Store disposition.
- [Work Delegation](integration/foundation-connected-work-delegation.test.ts)
  exercises finite permission, Stop custody, and supplied productive courses.

These package tests remain distinct from installed and live qualification.
Finite scenarios with deterministic external responses do not establish
unconditional liveness or behavior for an unexercised provider or image.

After building once, the same discovered tests support three iteration depths:

```sh
npm run test:connected:built
npm run test:connected-bounded:built
npm run test:built -w @neutral/lifecycle-runtime
```

The first runs the productive Candidate and resolution courses.
The second adds canonical publication and the finite execution and terminal
restart campaigns. The full package suite runs each through ordinary recursive
discovery; it does not repeat the focused profiles. A single failing row can be replayed
with Node's `--test-name-pattern` against its exact compiled test file.

`process/exploration/` contains the owner-adjacent deterministic bounded
explorer for one Delivery Journal. Its generic engine and product-free oracle
tests run with the ordinary runtime suite. Its aggregate zero-finding profile
is also exposed as a separate command. It requires deterministic batch, incremental, and
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

The [exploration implementation](process/exploration/) separates scenario
expectations, fixture construction, replay, and finite search. Its assertions
apply only to the declared seeds, command alphabet, and bounds. It does not
establish cross-Delivery concurrency, physical effects, provider operation,
qualification, conformance, or a formal proof. The [conformance contract](../../spec-source/spec/CONFORMANCE.md)
defines the evidence needed for stronger claims.

## Suite scope

The ordinary Runtime suite excludes `foundation-setup-qualification.test.ts`.
The explicit setup-qualification command runs that test separately. Package
regressions and qualification exercise different boundaries; report which
commands, subjects, and assertions were actually exercised.
