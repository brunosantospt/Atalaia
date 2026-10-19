#!/usr/bin/env bash
# Runs one fire with ELMFIRE: request JSON on stdin, result JSON on stdout (see ../CONTRACT.md).
# The adapter is mounted from here, so editing it needs no rebuild; ELMFIRE itself does (setup.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"

exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$here/adapter.py:/engine/adapter.py:ro" "$ELMFIRE_IMAGE" python3 /engine/adapter.py
