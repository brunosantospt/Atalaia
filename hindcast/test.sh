#!/usr/bin/env bash
# The hindcast tools end to end on Vieira do Minho, from the cached downloads (data/hindcast/evidence; the first run
# fetches them): records, attack lines, then 5 h of ELMFIRE without spotting (deterministic) with the lines, and split
# at the same minutes without them (dummy lines off the grid). Checks that the files are there, that the API's own
# models take the lines, and that the lines never add a burned cell. (Against an unsplit run they can: every stretch
# restarts from the burned cells, which moves the front to their edges, about +1 % of area in 5 h.)
# Needs hindcast/setup.sh, Docker and engines/elmfire/setup.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
py="$here/.venv/bin/python -I"
fire=VieiradoMinho_10082016
$py hindcast/evidence.py $fire > /dev/null
$py hindcast/attack.py $fire > /dev/null
common="$fire --duration-min 300 --fuels pt --scars --live-herb 30 --live-woody 70"
split=$(mktemp)
trap 'rm -f "$split"' EXIT
$py - "$fire" "$split" <<'PY'
import json, sys
lines = json.load(open(f"hindcast/fires/{sys.argv[1]}/attack_lines.json"))["barriers"]
json.dump({"barriers": [{"path": [[-9.5, 40.0], [-9.49, 40.0]], "width_m": 0, "from_min": t}
                        for t in sorted({b["from_min"] for b in lines})]}, open(sys.argv[2], "w"))
PY
$py hindcast/run.py $common --name test_free --barriers "$split" > /dev/null
$py hindcast/run.py $common --name test_lines --barriers hindcast/fires/$fire/attack_lines.json > /dev/null
$py - "$fire" <<'PY'
import json, sys
import numpy as np
from pathlib import Path
fire = sys.argv[1]
d = Path("hindcast/fires") / fire
ev = json.loads((d / "evidence.json").read_text())
assert ev["incident"]["ncco"] == "2016030060428" and ev["incident"]["alert"].startswith("2016-08-10T09:46"), ev["incident"]
lines = json.loads((d / "attack_lines.json").read_text())["barriers"]
sys.path.insert(0, "api")
import runs
runs.Scenario(fire=fire, duration_min=300, decision={"barriers": [{k: b[k] for k in ("path", "width_m", "from_min")} for b in lines]})
free, held = (np.load(f"data/hindcast/{fire}/test_{n}.npy") for n in ("free", "lines"))
assert (np.isfinite(held) & ~np.isfinite(free)).sum() == 0, "uma célula arde só com as linhas"
r = json.loads((d / "runs/test_lines/result.json").read_text())
assert r["stretches"] > 1 and r["stats"]["satellite"]["passes"], r
print(f"ok: {len(lines)} linhas; 5 h sem projeções: {np.isfinite(free).sum() * 0.09:.0f} ha sem linhas, "
      f"{np.isfinite(held).sum() * 0.09:.0f} ha com linhas ({r['stretches']} troços)")
PY
rm -rf "hindcast/fires/$fire/runs/test_free" "hindcast/fires/$fire/runs/test_lines"
