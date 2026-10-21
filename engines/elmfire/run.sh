#!/usr/bin/env bash
# Runs one fire with ELMFIRE: request JSON on stdin, result JSON on stdout (see ../CONTRACT.md).
# The adapter is mounted from here, so editing it needs no rebuild; ELMFIRE itself does (setup.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"

# ELMFIRE's fuel model table, for requests that add models to it (fuel_models); vendor/ is from setup.sh.
table=$here/vendor/elmfire/build/source/fuel_models.csv
mounts=(-v "$here/adapter.py:/engine/adapter.py:ro")
[ -f "$table" ] && mounts+=(-v "$table:/engine/fuel_models_default.csv:ro")

exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp "${mounts[@]}" "$ELMFIRE_IMAGE" python3 /engine/adapter.py
