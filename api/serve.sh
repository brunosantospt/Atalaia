#!/usr/bin/env bash
# Runs the API on http://127.0.0.1:5181, where the web dev server sends /api. Needs setup.sh once.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/.venv/bin/uvicorn" app:app --app-dir "$here" --host 127.0.0.1 --port "${PORT:-5181}"
