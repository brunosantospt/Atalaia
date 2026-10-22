#!/usr/bin/env bash
# Compatibility entry point: the unified adapter supports Portuguese fuels, adj, spotting and seed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/../../engines/elmfire/run.sh"
