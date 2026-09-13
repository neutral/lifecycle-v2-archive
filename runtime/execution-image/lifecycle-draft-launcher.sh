#!/bin/sh
# The ordinary supported Runtime executable; custody stays outside the Cell.
exec /usr/local/bin/node /opt/lifecycle-runtime/package/bin/lifecycle.mjs "$@"
