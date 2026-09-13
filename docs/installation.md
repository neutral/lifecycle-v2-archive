# Installation

The Lifecycle Foundation core can be built directly from this repository.

## Requirements

- Git;
- Node.js `24.14.0` or newer; and
- npm.

## Install the source workspace

Follow [source setup](source-setup.md) to install the locked workspace
dependencies and build the protocol and Runtime. Invoke the canonical CLI
from the source tree:

```sh
npm run lifecycle -- version
npm run lifecycle -- help
```

The source workspace includes the pinned Atlas processor and its provenance.
Target operation additionally requires a complete valid target Atlas and the
Runtime's selected execution environment. These prerequisites are separate from
compiling and inspecting the source CLI.
