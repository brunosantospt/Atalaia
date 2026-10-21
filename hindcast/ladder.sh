#!/usr/bin/env bash
# Reproduces every run of the results table in hindcast/README.md for one fire (Vieira do Minho by default), then the
# grids (grid.png, grid_wind.png) and the Markdown table. About 15 min for Vieira (Docker, ELMFIRE image).
#
#   hindcast/ladder.sh [fire_id]
#
# The wind runs (6w, 6c, 6cw) need scripts/build_wind_field.py and web/public/fires/<id>/weather_cerra.json from
# the feature/cerra-wind-engine branch; without them they are skipped. Runs with spotting use seeds 1, 2 and 3 (the
# seed 1 runs carry no suffix). Needs hindcast/setup.sh, engines/elmfire/setup.sh and the downloads of evidence.py
# (fetched on the first run). Overwrites the runs it makes.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
py="${PY:-$here/.venv/bin/python} -I"
fire=${1:-VieiradoMinho_10082016}
d=hindcast/fires/$fire
run() { $py hindcast/run.py "$fire" "$@"; }

$py hindcast/evidence.py "$fire"
$py hindcast/attack.py "$fire"                       # lines v1: timed on the observed fire
best="--fuels pt --scars --live-herb 30 --live-woody 70"
wind=0
[ -f scripts/build_wind_field.py ] && [ -f "web/public/fires/$fire/weather_cerra.json" ] && wind=1

run --name 0_api --fuels sb --dead fixed --no-canopy  # step 0: the same inputs as POST /api/run
run --name 1a_humidade_emc --fuels sb --no-canopy      # step 1
run --name 1_emc_copas --fuels sb                      # step 2 (canopy only if fires/<id>/canopy.npz exists)
run --name 2_cicatrizes --fuels sb --scars             # step 3
run --name 3_combustiveis_pt --fuels pt --scars        # step 4
run --name 4_seca $best                                # step 5
for s in 1 2 3; do
  sfx=$([ "$s" = 1 ] && echo "" || echo "_seed$s")
  run --name "5_projecoes$sfx" $best --spotting --seed "$s"                                      # step 6
  run --name "6_linhas$sfx" $best --spotting --seed "$s" --barriers "$d/attack_lines.json"        # step 7
  $py hindcast/attack.py "$fire" --timing run --run "5_projecoes$sfx"                            # lines v2
  run --name "7_linhas_v2$sfx" $best --spotting --seed "$s" --barriers "$d/attack_lines_5_projecoes$sfx.json"  # step 8
  if [ "$wind" = 1 ]; then
    run --name "5w_topowind$sfx" $best --spotting --seed "$s" --topowind                           # step 6w
    run --name "5c_cerra$sfx" $best --spotting --seed "$s" --weather cerra                         # step 6c
    run --name "5cw_cerra_topowind$sfx" $best --spotting --seed "$s" --weather cerra --topowind    # step 6cw
  fi
done
run --name x_adj1.5 $best --spotting --adj 1.5         # x1: calibration, not kept
run --name x_vento_x2 $best --spotting --wind-mult 2   # x2: calibration, not kept

# rows: 2 h, each observed step, and halfway between the first two steps
hours=$($py - "$fire" <<'PY'
import json, sys
s = [x["hours"] for x in json.load(open(f"web/public/fires/{sys.argv[1]}/fire.json"))["steps"]][1:]
print(" ".join(f"{h:g}" for h in sorted({2.0, *s, round((s[0] + s[1]) / 2)})))
PY
)
cols=("0_api=0 · Atalaia API\n(S&B fuels, fixed\nmoisture, no canopy)" "1a_humidade_emc=1 · + hourly dead\nfuel moisture"
      "1_emc_copas=2 · + LiDAR canopy" "2_cicatrizes=3 · + scars of\nearlier fires" "3_combustiveis_pt=4 · + Portuguese\nfuel models"
      "4_seca=5 · + drought live\nmoisture" "5_projecoes=6 · + spotting")
[ "$wind" = 1 ] && cols+=("5w_topowind=6w · + TopoWind\n(ERA5)" "5c_cerra=6c · CERRA instead\nof ERA5")
cols+=("6_linhas=7 · + attack lines v1\n(observed timing)" "7_linhas_v2=8 · + attack lines v2\n(model timing)")
$py hindcast/grid.py "$fire" --hours $hours --title "$fire · ELMFIRE · stochastic runs: seed 1" --runs "${cols[@]}"
if [ "$wind" = 1 ]; then
  wcols=()
  for r in 5_projecoes:ERA5 5w_topowind:"ERA5 + TopoWind" 5c_cerra:CERRA 5cw_cerra_topowind:"CERRA + TopoWind"; do
    n=${r%%:*}; l=${r#*:}
    wcols+=("$n=$l\nseed 1" "${n}_seed2=$l\nseed 2" "${n}_seed3=$l\nseed 3")
  done
  $py hindcast/grid.py "$fire" --hours $hours --out "$d/grid_wind.png" \
    --title "Wind sources without attack lines · step 6 setup (PT fuels, scars, drought, spotting)" --runs "${wcols[@]}"
fi
$py hindcast/table.py "$fire"
