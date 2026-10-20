#!/usr/bin/env bash
# Creates api/.venv with the API's dependencies. PYTHON picks the interpreter (python3 by default).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
"${PYTHON:-python3}" -m venv "$here/.venv"
"$here/.venv/bin/pip" install --quiet --upgrade pip
"$here/.venv/bin/pip" install --quiet -r "$here/requirements.txt"
echo "Pronto: api/.venv. Corre a API com api/serve.sh"
