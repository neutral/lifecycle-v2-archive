# Source setup

## Requirements

- Git;
- Node.js `24.14.0` or newer; and
- npm.

Clone the repository and install its locked dependencies:

```sh
git clone https://github.com/neutral/lifecycle.git
cd lifecycle
npm ci
```

Build the shared protocol and runtime, then print the source CLI version:

```sh
npm run build -w @neutral/lifecycle-protocol
npm run build:self -w @neutral/lifecycle-runtime
npm run lifecycle -- version
```

Use a separate repository as a Lifecycle target. Atlas source and its processor
implementation are not vendored into this checkout; their publication and
Runtime integration have separate owners.
