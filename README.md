# Lifecycle

Lifecycle is an operating method for solo founder-devs who build with agents.
It gives a repository durable memory of what behavior was accepted, why, and
what proves it — so agents can do heavy work across many sessions without chat
history, plausible code, or test output quietly becoming product truth.

The core invariant is:

```text
Only admitted behavior can ship.
```

Agents are good at producing code. The risk is upstream and downstream of the
code: thin intent turns into durable behavior before enough meaning, boundaries,
and proof exist; and after the session ends, nothing remembers what was actually
accepted. Lifecycle is a control layer for exactly that gap. It is file-native
and harness-agnostic — it works with any agent that reads files, and with you.

## Why This Exists

Agent-built software fails by silent promotion: an artifact starts speaking
with authority it never earned.

```text
A prompt is not a requirement.
A plan is not permission.
A test is not acceptance.
Code is not intent.
```

In practice the collapses recur as failure modes, all of which Lifecycle is
designed to block:

- A prompt gets treated as a requirement, and interpretation ships unexamined.
- Scope expands silently mid-build, beyond what anyone agreed to.
- Tests pass, so the change ships — but passing tests never showed the
  *behavior* was wanted, only that the code runs.
- An agent's summary of its own work becomes the de facto spec.
- Runtime observations get promoted straight into "how the product works".
- The next session re-derives product meaning from code and guesses differently.

## How It Works

Lifecycle keeps five roles in separate artifacts, and controls every promotion
between them:

```text
semantic authority   admitted product meaning (records/)
target               code and deployed behavior
proof                evidence bound to what was admitted
observation          runtime findings, not yet truth
Control records      live process state, including the judgment that admitted work
```

A Delivery run moves one concrete Signal through an explicit chain:

```text
Signal -> product judgment -> admission (Work Boundary) -> bounded Build
-> frozen delta -> Evidence -> reconciliation -> landing -> learning -> closure
```

Before an agent may build, the Work Boundary must record the product judgment
it is operationalizing: what behavior is accepted, why now, what tradeoff, what
is excluded, what would falsify the decision, and what proof follows. Proof is
then checked against that judgment — not just against the code. Control depth
scales with risk: a typo fix uses a compact boundary; an auth change earns a
tighter tier, stronger proof, and explicit exclusions.

Two further processes support Delivery: Discovery maintains plans and selects
the next Signal when priorities are unclear, and Clarity maintains the Context
layer when product meaning itself needs focused work.

## What It Looks Like

After install, a target repo carries committed records and gitignored support:

```text
records/                 committed: durable product meaning + process state
  context/  intent/  assurance/  blueprint/
  control/
.lifecycle/              gitignored: installed methodology, disciplines, scratch
```

A real small change leaves a trail like this. From the worked examples — a bug
where completed todos vanish on reload — the Work Boundary reads roughly:

```text
selected meaning: completed todos remain stored and visible after reload
product judgment: accept persistence repair because current behavior contradicts
  admitted todo completion meaning; exclude storage migration and new commands;
  falsifier is evidence that completion was intentionally session-only
declared non-changes: no storage format migration, no new commands
proof obligations: completed todo persists after reload; add/list still works
```

Build happens inside that boundary; an Evidence Packet binds proof to those
obligations; reconciliation checks the actual diff against the admitted scope;
a closure record ends the run. A cold agent — or you, in three weeks — can read
the trail and know what was accepted and why.
[methodology/examples.md](methodology/examples.md) walks this and five other
cases end to end.

Optional and installed only if wanted: the `lt` CLI
([usage/tools/](usage/tools/overview.md)) mechanically checks record shape,
live cadence, judgment presence, scope drift, proof freshness, and the
Required Check bindings that give entries executable teeth.

## What Lifecycle Is Not

- Not a demand for exhaustive upfront specs — you can stay loose at the start;
  rigor concentrates at acceptance.
- Not uniform ceremony — record depth is proportional to risk, ambiguity, and
  blast radius.
- Not a replacement for judgment — it forces judgment to be stated, not made
  for you.
- Not an agent, harness, or IDE — it is files and method; bring any agent.
- Not a promise that every recorded meaning stays true forever — freshness and
  reconciliation are part of the method.

## Try It

Reading path (about 15 minutes):
[the methodology entry](methodology/methodology.md), then
[the worked examples](methodology/examples.md), then
[the first run after install](setup/first-run.md).

Install into a target repo (requires Node):
[setup/install-procedure.md](setup/install-procedure.md), then
[setup/first-run.md](setup/first-run.md). For a disposable trial, compile into
sample output instead:

```sh
node setup/compile-install-helper.mjs \
  --profile setup/install-profiles/core.md \
  --target sample-target \
  --clean \
  --reset-records
```

Install the `lt` CLI in the target repo, then generate its support and check
the install:

```sh
npm install --save-dev @neutral/lifecycle-tools
lt support refresh --target .
lt status --target .
```

Full command surface and gate mapping: [usage/tools/](usage/tools/overview.md).

The installed agent path in a target repo is:

```text
start.md -> route.md -> states/<active-state>.md
-> control-records/<record-contract>.md
-> semantic authority, disciplines, checks, or responses as the state page calls them
```

## This Repository

This repo is the published source distribution; target codebases are where
Lifecycle runs — no repository runs Lifecycle on itself, including this one.
Source methodology compiles into installed methodology:

```text
methodology/ source pages and manifests
-> setup compile install workflow
-> .lifecycle/methodology/ + .lifecycle/disciplines/ + .lifecycle/usage/ in the target
```

```text
methodology/    source methodology and record contracts
setup/          install procedure, compile workflow, target layout, verification
usage/          operating docs that travel with installs (usage/tools/ covers
                the lt CLI, published to npm as @neutral/lifecycle-tools)
```

Public pull requests are not accepted at this time — see
[CONTRIBUTING.md](CONTRIBUTING.md). Agents working with this repository should
start at [AGENTS.md](AGENTS.md).
