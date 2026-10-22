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
  # calibrated: a spread factor per fuel class fitted on the OTHER fires' windows (calibrate.py, leave one fire out)
  [K3c]="--fuels sb --scars --adj-class @ADJ_LOFO_K3@"
  [K5c]="--fuels pt --scars --live-herb 30 --live-woody 70 --adj-class @ADJ_LOFO_K5@"
  # the active edge of the start perimeter (run.py --active-edge): only near the satellite hotspots of the last 6 h,
  # or (cheating, the bound) only where the observed fire grew; the rest of the edge is held
  [K5a]="--fuels pt --scars --live-herb 30 --live-woody 70 --active-edge hotspots --active-window-h 6"
  [K5o]="--fuels pt --scars --live-herb 30 --live-woody 70 --active-edge oracle"
  [K3o]="--fuels sb --scars --active-edge oracle"
  # the gusts: effective wind 30 % of the way from the mean to the gusts
  [K3g]="--fuels sb --scars --gust-frac 0.3"
  [K5g]="--fuels pt --scars --live-herb 30 --live-woody 70 --gust-frac 0.3"
  # ensemble members (ensemble.py): the two fuel readings x wind speed, and the wind direction
  [K3m_w08]="--fuels sb --scars --canopy-source meta --wind-mult 0.8"
  [K3m_w125]="--fuels sb --scars --canopy-source meta --wind-mult 1.25"
  [K5m_w08]="--fuels pt --scars --live-herb 30 --live-woody 70 --canopy-source meta --wind-mult 0.8"
  [K5m_w125]="--fuels pt --scars --live-herb 30 --live-woody 70 --canopy-source meta --wind-mult 1.25"
  [K5m_rm15]="--fuels pt --scars --live-herb 30 --live-woody 70 --canopy-source meta --wind-rotate -15"
  [K5m_rp15]="--fuels pt --scars --live-herb 30 --live-woody 70 --canopy-source meta --wind-rotate 15"
  [K6m]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 1 --canopy-source meta"
  # spotting as an ensemble dimension: more seeds of K6, and strong (far, several embers) spotting whose ignition
  # probability follows the fuel moisture (K6x), on the S&B fuels too (K3x)
  [K6s2]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 2"
  [K6s3]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 3"
  [K6s4]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 4"
  [K6s5]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --seed 5"
  [K6x]="--fuels pt --scars --live-herb 30 --live-woody 70 --spotting --spotting-dynamic --spotting-dist-mult 5 --spotting-embers 3 --seed 1"
  [K3x]="--fuels sb --scars --spotting --spotting-dynamic --spotting-dist-mult 5 --spotting-embers 3 --seed 1"
  [K3xs2]="--fuels sb --scars --spotting --spotting-dynamic --spotting-dist-mult 5 --spotting-embers 3 --seed 2"
  [K3xs3]="--fuels sb --scars --spotting --spotting-dynamic --spotting-dist-mult 5 --spotting-embers 3 --seed 3"
)
CONFIGS=${*:-${CONFIGS:-K0 K3 K3s K4 K6}}
N=${N:-4}   # ELMFIRE jobs at a time (Monchique's grid alone takes ~2 GB; 30 GB machine shared with others)
for c in $CONFIGS; do for f in $FIRES; do
  while [ "$(jobs -rp | wc -l)" -ge "$N" ]; do sleep 2; done
  args="${CFG[$c]}"
  if [[ $args == *@ADJ_LOFO_* ]]; then   # this fire's factors, fitted without it (calibrate.py --steps <cfg>)
    tag=$(grep -o "@ADJ_LOFO_[A-Za-z0-9]*@" <<< "$args"); src=${tag#@ADJ_LOFO_}; src=${src%@}
    file=hindcast/fires/$f/adj_lofo_$src.json
    [ -f "$file" ] || { echo "skip $c $f: no $file"; continue; }
    args=${args//$tag/$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['adj_class'])" "$file")}
  fi
  if [ "$MODE" = free ]; then
    [ -f hindcast/fires/$f/runs/mf_$c/result.json ] && continue   # done already (an interrupted batch resumes)
    # Monchique 2018 lasted 128 h: its free run stops at 48 h (ELMFIRE keeps a weather band per half hour per cell,
    # ~7 GB over 128 h on its million cells)
    dur=""; [ "$f" = Monchique_03082018 ] && dur="--duration-min 2880"
    ( $PY -I hindcast/run.py $f --name mf_$c $args $dur > $LOG/free_${c}_$f.log 2>&1; echo "free $c $f $(date +%H:%M:%S) $(tail -c 160 $LOG/free_${c}_$f.log | tr '\n' ' ')" ) &
  else
    [ -f hindcast/fires/$f/steps/$c.json ] && continue
    ( $PY -I hindcast/steps.py $f --name $c -- $args > $LOG/steps_${c}_$f.log 2>&1; echo "steps $c $f $(date +%H:%M:%S)" ) &
  fi
done; done
wait
echo "ALLDONE $MODE"
