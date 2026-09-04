#!/usr/bin/env node

import { parseNamedArguments, run, withExactSourceSnapshot } from "./lib.mjs";

const names = [
  "--architecture",
  "--bun-image",
  "--ca-certificates-version",
  "--docker-cli-image",
  "--git-version",
  "--node-image",
  "--source-revision",
  "--tag",
  "--util-linux-version",
];
const values = parseNamedArguments(process.argv.slice(2), names);
const architecture = values.get("--architecture");
if (architecture !== "amd64" && architecture !== "arm64") {
  throw new TypeError("Runtime Image architecture must be amd64 or arm64");
}
for (const name of ["--bun-image", "--docker-cli-image", "--node-image"]) {
  if (!/@sha256:[a-f0-9]{64}$/u.test(values.get(name))) {
    throw new TypeError(`${name} must select one immutable image digest`);
  }
}
for (const name of ["--ca-certificates-version", "--git-version", "--util-linux-version"]) {
  if (!/^[0-9][A-Za-z0-9.+:~-]{0,159}$/u.test(values.get(name))) {
    throw new TypeError(`${name} must be one exact bounded Debian package version`);
  }
}
if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(values.get("--source-revision"))) {
  throw new TypeError("Runtime Image source revision must be one full lowercase Git object identity");
}
await withExactSourceSnapshot(values.get("--source-revision"), async (sourceRoot) => {
  run("docker", [
    "build",
    "--pull=false",
    "--provenance=false",
    "--sbom=false",
    "--platform", `linux/${architecture}`,
    "--file", "distribution/runtime-image/Dockerfile",
    "--tag", values.get("--tag"),
    "--build-arg", `LIFECYCLE_NODE_IMAGE=${values.get("--node-image")}`,
    "--build-arg", `LIFECYCLE_BUN_IMAGE=${values.get("--bun-image")}`,
    "--build-arg", `LIFECYCLE_DOCKER_CLI_IMAGE=${values.get("--docker-cli-image")}`,
    "--build-arg", `LIFECYCLE_SOURCE_REVISION=${values.get("--source-revision")}`,
    "--build-arg", `LIFECYCLE_UTIL_LINUX_VERSION=${values.get("--util-linux-version")}`,
    "--build-arg", `LIFECYCLE_GIT_VERSION=${values.get("--git-version")}`,
    "--build-arg", `LIFECYCLE_CA_CERTIFICATES_VERSION=${values.get("--ca-certificates-version")}`,
    sourceRoot,
  ], { cwd: sourceRoot, stdio: "inherit" });
});
