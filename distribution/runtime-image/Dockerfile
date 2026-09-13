# syntax=docker/dockerfile:1

ARG LIFECYCLE_NODE_IMAGE
ARG LIFECYCLE_DOCKER_CLI_IMAGE

FROM ${LIFECYCLE_DOCKER_CLI_IMAGE} AS docker_cli
FROM ${LIFECYCLE_NODE_IMAGE} AS build

COPY distribution/runtime-image/verify-tool-versions.mjs /tmp/verify-tool-versions.mjs
RUN node /tmp/verify-tool-versions.mjs --build \
 && rm /tmp/verify-tool-versions.mjs
WORKDIR /source

COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol/package.json protocol/tsconfig.json ./protocol/
COPY runtime/package.json runtime/tsconfig.json ./runtime/
COPY distribution/package/package.json ./distribution/package/
COPY third-party/atlas-reference-validator/package/package.json ./third-party/atlas-reference-validator/package/
RUN npm ci

COPY spec-source ./spec-source
COPY protocol ./protocol
COPY runtime ./runtime
COPY third-party/atlas-reference-validator/PROVENANCE.json ./third-party/atlas-reference-validator/PROVENANCE.json
COPY third-party/atlas-reference-validator/LICENSE ./third-party/atlas-reference-validator/LICENSE
COPY third-party/atlas-reference-validator/package ./third-party/atlas-reference-validator/package
RUN npm run build --workspace @neutral/lifecycle-protocol \
 && npm run build:self --workspace @neutral/lifecycle-runtime \
 && mkdir -p /release \
 && npm pack --workspace @neutral/lifecycle-protocol --pack-destination /release \
 && npm pack --workspace @neutral/lifecycle-runtime --pack-destination /release \
 && npm install --global --prefix /opt/lifecycle --ignore-scripts /release/*.tgz \
 && test -x /opt/lifecycle/bin/lifecycle

FROM ${LIFECYCLE_NODE_IMAGE} AS runtime

ARG LIFECYCLE_SOURCE_REVISION
ARG LIFECYCLE_QUALIFICATION_REVISION=lifecycle.foundation.1.0.0-rc.17
ARG LIFECYCLE_UTIL_LINUX_VERSION
ARG LIFECYCLE_GIT_VERSION
ARG LIFECYCLE_CA_CERTIFICATES_VERSION

LABEL org.opencontainers.image.source="https://github.com/neutral/lifecycle-v2-archive" \
      org.opencontainers.image.revision=${LIFECYCLE_SOURCE_REVISION} \
      org.opencontainers.image.version="1.0.0" \
      io.lifecycle.runtime-image.qualification-revision=${LIFECYCLE_QUALIFICATION_REVISION} \
      io.lifecycle.runtime-image.runtime-invocation-protocol="lifecycle.runtime-invocation.private.v1"

RUN test -n "${LIFECYCLE_UTIL_LINUX_VERSION}" \
 && test -n "${LIFECYCLE_GIT_VERSION}" \
 && test -n "${LIFECYCLE_CA_CERTIFICATES_VERSION}" \
 && node -e 'const p=/^[0-9][A-Za-z0-9.+:~-]{0,159}$/u; if(process.argv.slice(1).some((v)=>!p.test(v)))process.exit(64)' \
      "${LIFECYCLE_UTIL_LINUX_VERSION}" \
      "${LIFECYCLE_GIT_VERSION}" \
      "${LIFECYCLE_CA_CERTIFICATES_VERSION}" \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      "ca-certificates=${LIFECYCLE_CA_CERTIFICATES_VERSION}" \
      "git=${LIFECYCLE_GIT_VERSION}" \
      "util-linux=${LIFECYCLE_UTIL_LINUX_VERSION}" \
 && rm -rf /var/lib/apt/lists/* \
 && test -x /usr/bin/flock \
 && test -x /usr/bin/git

COPY --from=docker_cli /usr/local/bin/docker /usr/bin/docker
COPY distribution/runtime-image/verify-tool-versions.mjs /tmp/verify-tool-versions.mjs
RUN node /tmp/verify-tool-versions.mjs --runtime \
 && rm /tmp/verify-tool-versions.mjs
COPY --from=build /opt/lifecycle /opt/lifecycle
COPY --chmod=0555 distribution/runtime-image/entrypoint.sh /opt/lifecycle-distribution/entrypoint.sh
COPY --chmod=0444 distribution/runtime-image/runtime-supervisor.mjs /opt/lifecycle-distribution/runtime-supervisor.mjs

ENV PATH="/opt/lifecycle/bin:/usr/local/bin:/usr/bin:/bin"
WORKDIR /opt/lifecycle
USER 65532:65532
ENTRYPOINT ["/opt/lifecycle-distribution/entrypoint.sh"]
