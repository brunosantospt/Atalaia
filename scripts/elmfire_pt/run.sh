#!/usr/bin/env bash
# ELMFIRE as engines/elmfire/run.sh runs it (same image, same request and result, engines/CONTRACT.md), with
# hindcast/engine/adapter.py on top of engines/elmfire/adapter.py for four optional request fields: fuel_models,
# layers.adj, spotting and seed. A request without them gives the same result as engines/elmfire/run.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
eng=$(cd "$here/../../engines/elmfire" && pwd)
. "$eng/env.sh"

exec docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$eng/adapter.py:/engine/atalaia_adapter.py:ro" \
  -v "${ELMFIRE_FUEL_TABLE:-$eng/vendor/elmfire/build/source/fuel_models.csv}:/engine/fuel_models_default.csv:ro" \
  -v "$here/adapter.py:/engine/adapter.py:ro" \
  "$ELMFIRE_IMAGE" python3 /engine/adapter.py
