# Setup verification

## Purpose

Use this page to verify a target repo after Lifecycle setup.

Run these checks from the target codebase root unless a command says otherwise.
When a command uses Lifecycle setup scripts, run it from a Lifecycle checkout
or pass absolute paths.

## Checklist

After setup, verify:

```text
records/ exists and is not ignored by git
records/context/ exists
records/intent/ exists
records/assurance/ exists
records/blueprint/ exists
records/control/ exists
records/control/clarity/boundaries/ exists
records/control/clarity/inventories/ exists
records/control/clarity/reviews/ exists
records/control/clarity/closures/ exists
records/control/discovery/maps/ exists
every records subfolder has overview.md
records/description/ does not exist
.lifecycle/ exists
.lifecycle/ is ignored by git
.lifecycle/methodology/ exists
.lifecycle/disciplines/ exists
.lifecycle/disciplines/catalog.md exists
.lifecycle/disciplines/discipline.lock exists
.lifecycle/disciplines/package-info/ exists
.lifecycle/disciplines/bindings/ exists
.lifecycle/disciplines/surfaces/ exists
.lifecycle/disciplines/cache/ exists
.lifecycle/methodology/start.md exists
.lifecycle/methodology/route.md exists
.lifecycle/methodology/processes/invocation.md exists
.lifecycle/methodology/processes/clarity/process.md exists
.lifecycle/methodology/states/clarity-active.md exists
.lifecycle/methodology/states/work-boundary-active.md exists
.lifecycle/methodology/control-records/overview.md exists
.lifecycle/methodology/control-records/clarity-boundary.md exists
.lifecycle/methodology/control-records/context-review-packet.md exists
.lifecycle/methodology/control-records/plan-map.md exists
.lifecycle/methodology/control-records/work-boundary.md exists
.lifecycle/methodology/control-records/evidence-packet.md exists
.lifecycle/methodology/control-records/landing-packet.md exists
.lifecycle/methodology/control-records/closure-record.md exists
.lifecycle/methodology/local-support/overview.md exists
.lifecycle/methodology/local-support/work-trace.md exists
.lifecycle/methodology/local-support/stop-work-request.md exists
.lifecycle/methodology/local-support/tooling-support.md exists
semantic authority registry exists
.lifecycle/methodology/semantic-authority/update-product-meaning.md exists
.lifecycle/methodology/semantic-authority/templates/<surface>-entry.md files exist
.lifecycle/methodology/checks/before-build.md exists
.lifecycle/methodology/checks/before-proof.md exists
.lifecycle/methodology/checks/before-landing.md exists
.lifecycle/methodology/checks/before-closure.md exists
.lifecycle/methodology/responses/reframe.md exists
semantic authority registry includes retrieval keys and adequacy checks
installed Context template includes Context atlas fields and guidance
records/context/overview.md carries Context atlas concepts while allowing
target-customized wording
.lifecycle/methodology/records/ does not exist
.lifecycle/methodology/authority/ does not exist
.lifecycle/disciplines/packages/ does not exist
.lifecycle/methodology/disciplines/bindings/ does not exist
.lifecycle/methodology/disciplines/surfaces/ does not exist
.lifecycle/methodology.lock exists
.lifecycle/scratch/ exists
.lifecycle/work-traces/ exists
.lifecycle/stop-work-requests/ exists
.lifecycle/tooling/ is absent or ignored local support
when .lifecycle/tooling/ exists, tooling lock and contract registry exist
no product meaning was invented during setup
no process state was invented during setup
no subfolder README.md or index.md files were created
```

For an existing target where a prior process was already committed and a new
process is starting, verify that current `records/control/` contains only
neutral overviews or Control records for the new active process. Prior closed
Control records should be retrievable through git history, not carried as
current process state in HEAD.

## Commands

From a Lifecycle checkout, the verification helper can check a target:

```sh
node setup/verify-installed-methodology.mjs --target /path/to/target
```

From a target codebase root, use an absolute Lifecycle path:

```sh
LIFECYCLE_ROOT=/path/to/lifecycle

node "$LIFECYCLE_ROOT/setup/verify-installed-methodology.mjs" --target "$(pwd)"
```

Check `.lifecycle/` and `records/` Git treatment:

```sh
if git check-ignore -q .lifecycle/; then
  echo ".lifecycle/ is ignored"
else
  echo "ERROR: .lifecycle/ is not ignored"
fi

if git check-ignore -q records/; then
  echo "ERROR: records/ is ignored"
else
  echo "records/ is not ignored"
fi
```

Check required installed methodology and discipline files:

```sh
registry_base=.lifecycle/methodology/semantic-authority
registry="$registry_base/semantic-authority-surface-registry.yaml"

for required in \
  .lifecycle/methodology/start.md \
  .lifecycle/methodology/route.md \
  .lifecycle/methodology/processes/invocation.md \
  .lifecycle/methodology/processes/clarity/process.md \
  .lifecycle/methodology/states/clarity-active.md \
  .lifecycle/methodology/states/work-boundary-active.md \
  .lifecycle/methodology/control-records/overview.md \
  .lifecycle/methodology/control-records/clarity-boundary.md \
  .lifecycle/methodology/control-records/source-inventory.md \
  .lifecycle/methodology/control-records/context-review-packet.md \
  .lifecycle/methodology/control-records/clarity-closure-record.md \
  .lifecycle/methodology/control-records/plan-map.md \
  .lifecycle/methodology/control-records/work-boundary.md \
  .lifecycle/methodology/control-records/evidence-packet.md \
  .lifecycle/methodology/control-records/landing-packet.md \
  .lifecycle/methodology/control-records/closure-record.md \
  .lifecycle/methodology/local-support/overview.md \
  .lifecycle/methodology/local-support/work-trace.md \
  .lifecycle/methodology/local-support/stop-work-request.md \
  .lifecycle/methodology/local-support/tooling-support.md \
  .lifecycle/methodology/disciplines/overview.md \
  .lifecycle/methodology/disciplines/use-discipline.md \
  .lifecycle/methodology/disciplines/package-contract.md \
  .lifecycle/disciplines/catalog.md \
  .lifecycle/disciplines/discipline.lock \
  "$registry" \
  .lifecycle/methodology/semantic-authority/update-product-meaning.md \
  .lifecycle/methodology/semantic-authority/templates/context-entry.md \
  .lifecycle/methodology/semantic-authority/templates/intent-entry.md \
  .lifecycle/methodology/semantic-authority/templates/assurance-entry.md \
  .lifecycle/methodology/semantic-authority/templates/blueprint-entry.md \
  .lifecycle/methodology/semantic-authority/templates/description-entry.md \
  .lifecycle/methodology/checks/before-build.md \
  .lifecycle/methodology/checks/before-proof.md \
  .lifecycle/methodology/checks/before-landing.md \
  .lifecycle/methodology/checks/before-closure.md \
  .lifecycle/methodology/responses/reframe.md \
  .lifecycle/methodology.lock
do
  test -f "$required" || {
    echo "ERROR: missing $required"
    exit 1
  }
done
```

Check the generated semantic authority registry carries product-record
retrieval and adequacy fields:

```sh
rg -n 'retrieval_keys|target_references|adequacy_checks|promotion_candidates' \
  .lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml
```

Check that Context relationship direction and full multi-line adequacy guidance
survived compilation:

```sh
rg -n 'may_reference|child_contexts.*context_relations|individual leaves reviewed|proof receipts, one-run proof results' \
  .lifecycle/methodology/semantic-authority/semantic-authority-surface-registry.yaml \
  .lifecycle/methodology/semantic-authority/templates/context-entry.md
```

Check installed Context atlas guidance:

```sh
rg -n 'context_role|parent_context|child_contexts|context_relations|Context Atlas Fields|Route Review Boundary|Leaf Review Status|relation:target|area overviews|semantic neighborhoods|canonical references|rationale leaves|promotion pressure' \
  .lifecycle/methodology/semantic-authority/templates/context-entry.md \
  records/context/overview.md
```

Check installed Clarity guidance:

```sh
rg -n 'Clarity Boundary|Context Contract|Context Review Packet|surface_contract|does not automatically start Discovery or Delivery|recommendations' \
  .lifecycle/methodology/processes/clarity/process.md \
  .lifecycle/methodology/states/clarity-active.md \
  .lifecycle/methodology/control-records/clarity-boundary.md \
  .lifecycle/methodology/control-records/context-review-packet.md \
  .lifecycle/methodology/control-records/clarity-closure-record.md
```

The verification helper checks the installed Context overview by concept
groups, not by one exact generated sentence, so target projects can customize
the overview prose while retaining product-area atlas routes, area overviews,
canonical/rationale distinctions, semantic neighborhoods, and promotion
pressure guidance.

Check that installed Delivery pages preserve product judgment before action and
through proof, landing, and closure:

```sh
rg -n 'product_judgment|Product judgment|supports admitting' \
  .lifecycle/methodology/control-records/work-boundary.md

rg -n 'product_judgment_coverage' \
  .lifecycle/methodology/control-records/evidence-packet.md \
  .lifecycle/methodology/control-records/landing-packet.md

rg -n 'product_judgment_outcome' \
  .lifecycle/methodology/control-records/closure-record.md

rg -n 'product judgment is present|recommendation basis supports the product judgment' \
  .lifecycle/methodology/checks/before-build.md
```

Check installed discipline discovery and recording guidance:

```sh
rg -n 'Installed Discipline Packages|Use this installed catalog' \
  .lifecycle/disciplines/catalog.md

rg -n 'Installed Package Info|Generated Bindings|discipline root' \
  .lifecycle/disciplines/discipline.lock

rg -n 'disciplines_used|selected package|retrieved slice|proof' \
  .lifecycle/methodology/disciplines/checks/usage-adequacy.md
```

When a profile selects discipline packages, verify the package info,
generated surface content, and generated bindings listed in
`.lifecycle/disciplines/catalog.md`.

Check that installed Control record contracts are not under the old generic
`records/` folder:

```sh
test ! -e .lifecycle/methodology/records || {
  echo "ERROR: .lifecycle/methodology/records should be control-records/"
  exit 1
}
```

Check that installed semantic authority did not use the old generic
`authority/` folder:

```sh
test ! -e .lifecycle/methodology/authority || {
  echo "ERROR: .lifecycle/methodology/authority should be semantic-authority/"
  exit 1
}
```

Check that installed discipline does not copy full package source into a
runtime `packages/` folder:

```sh
test ! -e .lifecycle/disciplines/packages || {
  echo "ERROR: .lifecycle/disciplines/packages should be package-info/"
  exit 1
}
```

Check record overview files:

```sh
find records -type d ! -exec test -f '{}/overview.md' ';' -print
```

The command should print nothing. Any output is a folder that still needs an
`overview.md`.

Check wrong overview file names:

```sh
find records '(' -name README.md -o -name index.md ')' -print
```

The command should print nothing. Any output is a subfolder overview file using
the wrong name.

When optional tooling support exists, check that it stays under local support:

```sh
if test -e .lifecycle/tooling; then
  git check-ignore -q .lifecycle/tooling || {
    echo "ERROR: .lifecycle/tooling should be ignored local support"
    exit 1
  }
fi
```

When optional tooling support exists, check that generated support has a lock
and contract registry:

```sh
if test -e .lifecycle/tooling; then
  test -f .lifecycle/tooling/support/contract-registry.json
  test -f .lifecycle/tooling/tooling.lock.json
fi
```

Check that tooling support did not create durable records by itself:

```sh
find records -type f ! -name overview.md -print
```

For a fresh setup, the command should print nothing. For an existing target,
every printed file should be an intentional product record or Control record,
not generated tooling support.
