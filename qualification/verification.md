# Verification boundaries

The selected coordinates are `lifecycle.foundation.1.0.0-rc.17`, repository
contract v22, runtime and interface protocols v17, Provider Adapter v7, and the
exact Atlas 0.8 processor. The Foundation specification remains Draft.

## Bounded source checks

The repository source workflow checks dependency and workspace consistency,
Atlas resolution, specification manifests and schemas, TypeScript compilation,
repository guards, and package tests. These checks exercise local source
behavior and deterministic external seams. Each reported result identifies the
commands performed and their failures or exclusions.

The launcher tests cover CLI target and input mounts, manifest validation,
argument forwarding, setup and doctor, bounded draft transport, exact invocation
identity, heartbeat supervision, and stale invocation cleanup with bounded fake
Docker responses. Those observations do not establish real Docker containment,
installed-image operation, or a successful Delivery with a live provider.

## Operated harnesses

`installed/qualify.mjs` uses `distribution/scripts/pack-qualification-fixture.mjs`
to create a private disposable package, then checks its CLI inventory and
installed launcher through a fake Docker executable. It runs separately from
the default source checks.

`provider/qualify.mjs` exercises the external provider course. Runtime contains
execution-image source and focused Docker-boundary and recovery harnesses.
These require explicit external resources and private inputs. Each observation
must identify the source, image, provider, and other exact subjects exercised.
Harness source alone does not establish results for the selected Codex 0.153.4
image.

## Claims and limits

Local regressions and bounded exploration exercise their declared properties.
A source test cannot substitute for host interruption, actual Cell containment,
credential separation, external effects, or installed-image evidence. Recovery
must reopen the retained exact obligation; unavailable custody cannot authorize
redispatch.

The [conformance specification](../spec-source/spec/CONFORMANCE.md) owns the
separate qualification and authenticated publication requirements. The
[implementation record](../spec-source/IMPLEMENTATION.md) describes implemented
scope and limitations.
