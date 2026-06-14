# Lifecycle Core Package Manifest

## Purpose

Use this page as the human-readable compiler manifest for the core installed
methodology substrate.

The compile install workflow reads this page, validates the referenced source
pages, and writes installed methodology. Maintainers should be able to review
this page without reading helper script code.

## Package

| Field | Value |
| --- | --- |
| package type | substrate |
| id | lifecycle-core |
| name | Lifecycle Core |
| version | 0.1.0 |
| source root | methodology |
| state model | states/state-model.md |

## Installed Source Pages

| id | source | install path |
| --- | --- | --- |
| start | start.md | start.md |
| route | route.md | route.md |
| processes-overview | processes/processes.md | processes/processes.md |
| process-invocation | processes/invocation.md | processes/invocation.md |
| process-control-overview | processes/control/overview.md | processes/control/overview.md |
| process-control-placement | processes/control/placement.md | processes/control/placement.md |
| process-control-states | processes/control/states.md | processes/control/states.md |
| process-control-state-mutations | processes/control/state-mutations.md | processes/control/state-mutations.md |
| process-control-retrieval | processes/control/retrieval.md | processes/control/retrieval.md |
| process-control-contracts | processes/control/contracts.md | processes/control/contracts.md |
| process-control-closure | processes/control/closure.md | processes/control/closure.md |
| process-control-checks | processes/control/checks.md | processes/control/checks.md |
| process-control-templates | processes/control/templates.md | processes/control/templates.md |
| states-overview | states/overview.md | states/overview.md |
| states-model | states/state-model.md | states/state-model.md |
| control-records-overview | control-records/overview.md | control-records/overview.md |
| local-support-overview | local-support/overview.md | local-support/overview.md |
| work-trace | local-support/work-trace.md | local-support/work-trace.md |
| stop-work-request | local-support/stop-work-request.md | local-support/stop-work-request.md |
| tooling-support | local-support/tooling-support.md | local-support/tooling-support.md |
| semantic-authority-overview | semantic-authority/overview.md | semantic-authority/overview.md |
| semantic-authority-surfaces-overview | semantic-authority/surfaces/overview.md | semantic-authority/surfaces/overview.md |
| semantic-authority-surfaces-package-manifest | semantic-authority/surfaces/package-manifest.md | semantic-authority/surfaces/package-manifest.md |
| semantic-authority-surface-contract | semantic-authority/surfaces/contract.md | semantic-authority/surfaces/contract.md |
| semantic-authority-surface-update-procedure | semantic-authority/surfaces/update-procedure.md | semantic-authority/surfaces/update-procedure.md |
| checks-overview | checks/overview.md | checks/overview.md |
| responses-overview | responses/overview.md | responses/overview.md |

## Generated Pages

| id | source | install path |
| --- | --- | --- |
| registry | package manifests | registry.md |
| state pages | states/state-model.md | states/<state-id>.md |
| semantic authority registry | semantic authority surface manifest | semantic-authority/semantic-authority-surface-registry.yaml |
| semantic authority entry templates | semantic authority surface manifest | semantic-authority/templates/<surface-id>-entry.md |

## Checks

| id | source | install path |
| --- | --- | --- |
| before-build | checks/before-build.md | checks/before-build.md |
| before-proof | checks/before-proof.md | checks/before-proof.md |
| before-landing | checks/before-landing.md | checks/before-landing.md |
| before-closure | checks/before-closure.md | checks/before-closure.md |
| installed-repo-checks | checks/installed-repo-checks.md | checks/installed-repo-checks.md |

## Tooling Contracts

| id | source | install path |
| --- | --- | --- |
| check-registry | checks/check-registry.contract.json | support/check-registry.contract.json |
| tool-config | local-support/tool-config.contract.json | support/tool-config.contract.json |
| tool-observations | local-support/tool-observations.contract.json | support/tool-observations.contract.json |

## Semantic Authority Operations

| id | source | install path |
| --- | --- | --- |
| retrieve-product-meaning | semantic-authority/retrieve-product-meaning.md | semantic-authority/retrieve-product-meaning.md |
| update-product-meaning | semantic-authority/update-product-meaning.md | semantic-authority/update-product-meaning.md |
| resolve-semantic-authority-backpressure | semantic-authority/resolve-semantic-authority-backpressure.md | semantic-authority/resolve-semantic-authority-backpressure.md |

## Semantic Authority Checks

| id | source | install path |
| --- | --- | --- |
| entry-adequacy | semantic-authority/checks/entry-adequacy.md | semantic-authority/checks/entry-adequacy.md |
| semantic-authority-backpressure | semantic-authority/checks/semantic-authority-backpressure.md | semantic-authority/checks/semantic-authority-backpressure.md |
| update-obligation | semantic-authority/checks/update-obligation.md | semantic-authority/checks/update-obligation.md |

## Responses

| id | source | install path |
| --- | --- | --- |
| ask | responses/ask.md | responses/ask.md |
| reframe | responses/reframe.md | responses/reframe.md |
| split | responses/split.md | responses/split.md |
| defer | responses/defer.md | responses/defer.md |
| abandon | responses/abandon.md | responses/abandon.md |
| promote | responses/promote.md | responses/promote.md |
| archive | responses/archive.md | responses/archive.md |
| close | responses/close.md | responses/close.md |
