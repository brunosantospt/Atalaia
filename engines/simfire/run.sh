#!/usr/bin/env bash
# Runs one fire with SimFire: request JSON on stdin, result JSON on stdout (see ../CONTRACT.md).
# The adapter is mounted from here, so editing it needs no rebuild; SimFire itself does (setup.sh).
# SIMFIRE_STOCK=1 runs SimFire's own spread loop instead of the adapter's faster copy of it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -e SIMFIRE_STOCK \
  -v "$here/adapter.py:/engine/adapter.py:ro" "$SIMFIRE_IMAGE" python3 /engine/adapter.py
