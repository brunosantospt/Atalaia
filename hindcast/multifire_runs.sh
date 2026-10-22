#!/usr/bin/env bash
# The multi-fire test: every configuration on every fire, free (step 0 to the last step, run.py) and step by step
# (restart at each observed step, forecast to the next one, steps.py), N jobs at a time. Logs in
# data/hindcast/_logs/; results in hindcast/fires/<id>/runs/mf_<cfg>/ and hindcast/fires/<id>/steps/<cfg>.json.
#
#   hindcast/multifire_runs.sh free|steps [config ...]       (CONFIGS and FIRES from the environment otherwise)
set -uo pipefail
cd "$(dirname "$0")/.."
PY="${HPY:-hindcast/.venv/bin/python}"
MODE=${1:?free or steps}; shift
LOG=data/hindcast/_logs; mkdir -p $LOG
FIRES=${FIRES:-"VieiradoMinho_10082016 CabeceirasdeBasto_06092016 VilaNovadeCerveira_08082015 SeverdoVouga_09082016 Guarda_23082017 Oleiros_25072020 CastroMarim_16082021 ViladeRei_20072019 Monchique_03082018"}
declare -A CFG=(
  [K0]="--fuels sb --dead fixed --no-canopy"                                     # the API until 21/10/2026
  [K3]="--fuels sb --scars"                                                      # the API since 22/10/2026
  [K3s]="--fuels sb --scars --spotting --seed 1"                                 # K3 + spotting
  [K4]="--fuels pt --scars"                                                      # K3 + Portuguese fuels
  [K6]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 1"   # Vieira's best data configuration
  [K5]="--fuels pt --scars --live-herb 30 --live-woody 70"                       # K4 + drought live moisture, no spotting
  [K6d]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --spotting-dynamic --seed 1"   # K5 + spotting whose
                                                     # ignition probability follows the fine fuel moisture (Schroeder 1969)
  [K3m]="--fuels sb --scars --canopy-source meta"                                # K3 with the open canopy map
  [K5m]="--fuels pt --scars --live-herb 30 --live-woody 70 --canopy-source meta"
  [K6m]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 1 --canopy-source meta"
)
CONFIGS=${*:-${CONFIGS:-K0 K3 K3s K4 K6}}
N=${N:-4}   # ELMFIRE jobs at a time (Monchique's grid alone takes ~2 GB; 30 GB machine shared with others)
for c in $CONFIGS; do for f in $FIRES; do
  while [ "$(jobs -rp | wc -l)" -ge "$N" ]; do sleep 2; done
  if [ "$MODE" = free ]; then
    [ -f hindcast/fires/$f/runs/mf_$c/result.json ] && continue   # done already (an interrupted batch resumes)
    # Monchique 2018 lasted 128 h: its free run stops at 48 h (ELMFIRE keeps a weather band per half hour per cell,
    # ~7 GB over 128 h on its million cells)
    dur=""; [ "$f" = Monchique_03082018 ] && dur="--duration-min 2880"
    ( $PY -I hindcast/run.py $f --name mf_$c ${CFG[$c]} $dur > $LOG/free_${c}_$f.log 2>&1; echo "free $c $f $(date +%H:%M:%S) $(tail -c 160 $LOG/free_${c}_$f.log | tr '\n' ' ')" ) &
  else
    [ -f hindcast/fires/$f/steps/$c.json ] && continue
    ( $PY -I hindcast/steps.py $f --name $c -- ${CFG[$c]} > $LOG/steps_${c}_$f.log 2>&1; echo "steps $c $f $(date +%H:%M:%S)" ) &
  fi
done; done
wait
echo "ALLDONE $MODE"
