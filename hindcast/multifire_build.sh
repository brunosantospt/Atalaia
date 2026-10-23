#!/usr/bin/env bash
# Builds the fire packages (web/public/fires/<id>/) and the hindcast evidence of PT-FireSprd fires, end to end:
# progression, grid, terrain, ERA5 weather, COS 2015 fuel, ICNF/FIRMS evidence, scars (and empty canopy without LiDAR).
#
#   hindcast/multifire_build.sh Guarda_23082017 Oleiros_25072020 ...
#
# Needs data/pt-firesprd-v2/extracted (the Zenodo zip), data/cos2015v2-dgt/extracted/COS2015v2-S1.gpkg, scripts/.venv
# and hindcast/.venv. DEM tiles and ERA5 are fetched (no account). Fires of 2015-2021 only: PT-FireSprd v2's 2022-2024
# fires may only be used after the v2 paper is published.
set -euo pipefail
cd "$(dirname "$0")/.."
SPY="${SPY:-scripts/.venv/bin/python}"
HPY="${HPY:-hindcast/.venv/bin/python}"
$SPY scripts/build_fires.py "$@"
$SPY scripts/build_grid.py --allow-corner-error "$@"
$SPY -I scripts/fetch_dem.py "$@"
$SPY -I scripts/build_terrain.py "$@"
$SPY scripts/fetch_weather.py "$@"
$SPY scripts/build_weather.py "$@"
$SPY scripts/build_fuel.py "$@"
for f in "$@"; do $HPY -I hindcast/evidence.py "$f"; done
$SPY -I scripts/build_scars_canopy.py "$@"
