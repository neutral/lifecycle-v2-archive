# Installation

The Lifecycle Foundation core can be built directly from this repository.

## Requirements

- Git;
- Node.js `24.14.0` or newer; and
- npm.

## Install the source workspace

```sh
git clone https://github.com/neutral/lifecycle.git
cd lifecycle
npm ci
npm run build -w @neutral/lifecycle-protocol
npm run build:self -w @neutral/lifecycle-runtime
npm run lifecycle -- version
```

This installs the locked workspace dependencies, builds the shared protocol
and Runtime, and invokes the canonical CLI from the source tree. Atlas source
and its processor implementation are not vendored into this workspace. Their
publication and Runtime integration are separate prerequisites for target
operation. See [source setup](source-setup.md) for the repository boundary.

Registry installation instructions will be published with the corresponding
npm package and Runtime and Execution Images.
