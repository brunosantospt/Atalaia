#!/usr/bin/env bash
# Creates hindcast/.venv with what the hindcast tools need. PYTHON picks the interpreter (python3 by default).
# ELMFIRE itself runs in the engine's Docker image: engines/elmfire/setup.sh, once.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
"${PYTHON:-python3}" -m venv "$here/.venv"
"$here/.venv/bin/pip" install --quiet --upgrade pip
"$here/.venv/bin/pip" install --quiet -r "$here/requirements.txt"
echo "Pronto: hindcast/.venv. Ver hindcast/README.md"
