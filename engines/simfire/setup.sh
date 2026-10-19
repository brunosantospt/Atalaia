#!/usr/bin/env bash
# Builds the Docker image that runs SimFire, from PyPI at the pinned versions.
# Needs Docker running. Safe to re-run: Docker reuses the layers it already has.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"

docker info >/dev/null 2>&1 || { echo "Docker não está a correr." >&2; exit 1; }

docker build --build-arg SIMFIRE_VERSION="$SIMFIRE_VERSION" -t "$SIMFIRE_IMAGE" "$here"
echo "Pronto: $SIMFIRE_IMAGE"
