#!/usr/bin/env bash
# Reproduces every run of the results table in hindcast/README.md for one fire (Vieira do Minho by default): the naive
# references, the steps, then the grids (grid.png, grid_wind.png) and the Markdown table.
#
#   SEEDS=10 JOBS=2 hindcast/ladder.sh [fire_id]
#
# Runs with spotting use seeds 1 to SEEDS (10 by default; the seed 1 runs carry no suffix, the others _seed<s>), JOBS
# seeds at a time (1 by default; the seeds' runs are independent of each other). Each job is one ELMFIRE container
# of up to about 1.7 GiB: JOBS times that has to fit in Docker's memory, with whatever else is running there, or the
# containers are killed (exit 137). Only the seed 1 runs write preview.png and attack_lines_*.png.
# The wind runs (6w, 6c, 6cw) need scripts/build_wind_field.py and web/public/fires/<id>/weather_cerra.json (from
# feature/cerra-wind-engine, both in this branch), the canopy test (5f, 6f, 8f) needs fires/<id>/canopy.npz
# (canopy.py); without them they are skipped. Needs hindcast/setup.sh, engines/elmfire/setup.sh and the downloads of
# evidence.py (fetched on the first run). Overwrites the runs it makes.
# With 10 seeds, about 10 min for Vieira (JOBS=2) and 15 min for Cabeceiras without canopy (JOBS=1) on an Apple
# M-series laptop.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
py="${PY:-$here/.venv/bin/python} -I"
fire=${1:-VieiradoMinho_10082016}
SEEDS=${SEEDS:-10}
JOBS=${JOBS:-1}
d=hindcast/fires/$fire
run() { $py hindcast/run.py "$fire" "$@"; }

$py hindcast/evidence.py "$fire"
$py hindcast/attack.py "$fire"                       # lines v1: timed on the observed fire
$py hindcast/baseline.py "$fire"                     # b: the naive references
best="--fuels pt --scars --live-herb 30 --live-woody 70"
wind=0
[ -f scripts/build_wind_field.py ] && [ -f "web/public/fires/$fire/weather_cerra.json" ] && wind=1
canopy=0
[ -f "$d/canopy.npz" ] && canopy=1

run --name 0_api --fuels sb --dead fixed --no-canopy  # step 0: the same inputs as POST /api/run
run --name 1a_humidade_emc --fuels sb --no-canopy      # step 1
run --name 1_emc_copas --fuels sb                      # step 2 (canopy only if fires/<id>/canopy.npz exists)
run --name 2_cicatrizes --fuels sb --scars             # step 3
run --name 3_combustiveis_pt --fuels pt --scars        # step 4
run --name 4_seca $best                                # step 5
if [ "$canopy" = 1 ]; then
  run --name 4f_seca_copas_antes $best --canopy-fill   # step 5f: canopy inside the burned area as outside it
fi

seed() {  # the runs with spotting, for seed $1
  local s=$1 sfx="" np=""
  if [ "$s" != 1 ]; then sfx="_seed$s"; np="--no-preview"; fi
  run --name "5_projecoes$sfx" $best --spotting --seed "$s" $np                                     # step 6
  run --name "6_linhas$sfx" $best --spotting --seed "$s" --barriers "$d/attack_lines.json" $np       # step 7
  $py hindcast/attack.py "$fire" --timing run --run "5_projecoes$sfx" $np                           # lines v2
  run --name "7_linhas_v2$sfx" $best --spotting --seed "$s" --barriers "$d/attack_lines_5_projecoes$sfx.json" $np  # step 8
  if [ "$wind" = 1 ]; then
    run --name "5w_topowind$sfx" $best --spotting --seed "$s" --topowind $np                          # step 6w
    run --name "5c_cerra$sfx" $best --spotting --seed "$s" --weather cerra $np                        # step 6c
    run --name "5cw_cerra_topowind$sfx" $best --spotting --seed "$s" --weather cerra --topowind $np   # step 6cw
  fi
  if [ "$canopy" = 1 ]; then
    run --name "5f_copas_antes$sfx" $best --spotting --seed "$s" --canopy-fill $np                    # step 6f
    $py hindcast/attack.py "$fire" --timing run --run "5f_copas_antes$sfx" $np
    run --name "7f_linhas_v2_copas_antes$sfx" $best --spotting --seed "$s" --canopy-fill \
      --barriers "$d/attack_lines_5f_copas_antes$sfx.json" $np                                        # step 8f
  fi
}
pids="" failed=0
for s in $(seq 1 "$SEEDS"); do
  seed "$s" &
  pids="$pids $!"
  if [ "$(echo $pids | wc -w)" -ge "$JOBS" ]; then
    for p in $pids; do wait "$p" || failed=1; done   # the whole batch, so that none is left running
    pids=""
    [ "$failed" = 0 ] || exit 1
  fi
done
for p in $pids; do wait "$p" || failed=1; done
[ "$failed" = 0 ] || exit 1
run --name x_adj1.5 $best --spotting --adj 1.5         # x1: calibration, not kept
run --name x_vento_x2 $best --spotting --wind-mult 2   # x2: calibration, not kept

# rows: 2 h, each observed step, and halfway between the first two steps
hours=$($py - "$fire" <<'PY'
import json, sys
s = [x["hours"] for x in json.load(open(f"web/public/fires/{sys.argv[1]}/fire.json"))["steps"]][1:]
print(" ".join(f"{h:g}" for h in sorted({2.0, *s, round((s[0] + s[1]) / 2)})))
PY
)
cols=("b_vento=b · ellipse downwind\n(observed area,\nno model)" "0_api=0 · Atalaia API\n(S&B fuels, fixed\nmoisture, no canopy)"
      "1a_humidade_emc=1 · + hourly dead\nfuel moisture" "1_emc_copas=2 · + LiDAR canopy" "2_cicatrizes=3 · + scars of\nearlier fires"
      "3_combustiveis_pt=4 · + Portuguese\nfuel models" "4_seca=5 · + drought live\nmoisture" "5_projecoes=6 · + spotting")
[ "$wind" = 1 ] && cols+=("5w_topowind=6w · + TopoWind\n(ERA5)" "5c_cerra=6c · CERRA instead\nof ERA5")
[ "$canopy" = 1 ] && cols+=("5f_copas_antes=6f · canopy before\nthe fire (guess)")
cols+=("6_linhas=7 · + attack lines v1\n(observed timing)" "7_linhas_v2=8 · + attack lines v2\n(model timing)")
$py hindcast/grid.py "$fire" --hours $hours --title "$fire · ELMFIRE · stochastic runs: seed 1" --runs "${cols[@]}"
if [ "$wind" = 1 ]; then
  wcols=()
  for r in 5_projecoes:ERA5 5w_topowind:"ERA5 + TopoWind" 5c_cerra:CERRA 5cw_cerra_topowind:"CERRA + TopoWind"; do
    n=${r%%:*}; l=${r#*:}
    for s in $(seq 1 $((SEEDS < 3 ? SEEDS : 3))); do
      wcols+=("$n$([ "$s" = 1 ] || echo "_seed$s")=$l\nseed $s")
    done
  done
  $py hindcast/grid.py "$fire" --hours $hours --out "$d/grid_wind.png" \
    --title "Wind sources without attack lines · step 6 setup (PT fuels, scars, drought, spotting)" --runs "${wcols[@]}"
fi
$py hindcast/table.py "$fire"
