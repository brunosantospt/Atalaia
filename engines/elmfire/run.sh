#!/usr/bin/env bash
# Runs one fire with ELMFIRE: request JSON on stdin, result JSON on stdout (see ../CONTRACT.md).
# The adapter is mounted from here, so editing it needs no rebuild; ELMFIRE itself does (setup.sh).
# So is ELMFIRE's standard fuel model table, which the adapter only reads for a request's fuel_models.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"

mounts=(-v "$here/adapter.py:/engine/adapter.py:ro")
table=${ELMFIRE_FUEL_TABLE:-$here/vendor/elmfire/build/source/fuel_models.csv}  # env: a table kept elsewhere
if [ -f "$table" ]; then
  mounts+=(-v "$table:/engine/fuel_models.csv:ro")
fi
exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp "${mounts[@]}" "$ELMFIRE_IMAGE" python3 /engine/adapter.py
