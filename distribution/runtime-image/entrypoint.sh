#!/bin/sh
set -eu

exec node /opt/lifecycle-distribution/runtime-supervisor.mjs "$@"
