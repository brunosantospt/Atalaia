#!/usr/bin/env bash
# Fetches ELMFIRE at the pinned release into vendor/ and builds the Docker image that runs it.
# Needs Docker running. Safe to re-run: the source is only fetched once.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"

docker info >/dev/null 2>&1 || { echo "Docker não está a correr." >&2; exit 1; }

src=$here/vendor/elmfire
if [ ! -d "$src/.git" ]; then
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ELMFIRE_TAG" "$ELMFIRE_REPO" "$src"
fi
commit=$(git -C "$src" rev-parse HEAD)
if [ "$commit" != "$ELMFIRE_COMMIT" ]; then
  echo "vendor/elmfire está em $commit, esperado $ELMFIRE_COMMIT ($ELMFIRE_TAG)." >&2
  exit 1
fi

docker build --build-arg ELMFIRE_TAG="$ELMFIRE_TAG" -t "$ELMFIRE_IMAGE" "$here"
echo "Pronto: $ELMFIRE_IMAGE"
