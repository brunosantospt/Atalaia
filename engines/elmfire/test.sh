#!/usr/bin/env bash
# P3 gate: ELMFIRE on a synthetic case (flat ground, one fuel, steady wind) must burn, and the fire
# must stretch downwind. It runs twice, wind from the west and from the north, so a swapped axis or
# a wind blowing the wrong way cannot pass. Needs the image from setup.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

python3 -I - "$here/run.sh" <<'PY'
import json
import subprocess
import sys

RUN = sys.argv[1]
CELL, N = 30, 201  # metres; an odd count puts the ignition in the centre cell
C = N // 2
# Where each wind blows the fire, and the two flanks, as (row, col) steps: row 0 is the north edge.
CASES = {
    'oeste': (270, (0, 1), (0, -1), [(-1, 0), (1, 0)]),
    'norte': (0, (1, 0), (-1, 0), [(0, -1), (0, 1)]),
}


def request(wind_from):
    half = N * CELL / 2
    return {
        'grid': {'cols': N, 'rows': N, 'cellsize': CELL, 'xmin': -half, 'ymin': -half, 'srs': 'EPSG:3763'},
        'duration_min': 60,
        'ignitions': [{'x': 0, 'y': 0}],
        'weather': {
            'wind_kmh': 20, 'wind_from_deg': wind_from,
            'dead_1h_pct': 6, 'dead_10h_pct': 8, 'dead_100h_pct': 10, 'live_herb_pct': 60, 'live_woody_pct': 90,
        },
        'layers': {'fuel': 102},  # GR2, low load dry climate grass
    }


def reach(burned, step):
    """How far the burned area goes from the ignition in one direction, in cells."""
    dr, dc = step
    return max((r - C) * dr + (c - C) * dc for r, c in burned)


failed = []
for name, (wind_from, down, up, flanks) in CASES.items():
    run = subprocess.run([RUN], input=json.dumps(request(wind_from)), capture_output=True, text=True)
    if run.returncode != 0:
        sys.exit(f'run.sh falhou (vento de {name}):\n{run.stderr}')
    result = json.loads(run.stdout)
    arrival = result['arrival_min']
    burned = [(r, c) for r, row in enumerate(arrival) for c, v in enumerate(row) if v is not None]
    head, back = reach(burned, down), reach(burned, up)
    sides = [reach(burned, f) for f in flanks]
    print(f'vento de {name}: frente {head * CELL} m, trás {back * CELL} m, flancos '
          f'{sides[0] * CELL}/{sides[1] * CELL} m, {result["burned_ha"]} ha, {result["runtime_s"]} s')

    checks = {
        'a ignição arde no início': arrival[C][C] is not None and arrival[C][C] <= 1,
        'o fogo não chega à borda da grade': max(head, back, *sides) < C,
        'a frente vai a favor do vento': head >= 3 * max(back, 1),
        'o fogo alonga-se na direção do vento': head >= 2 * max(sides),
        'os flancos são simétricos': abs(sides[0] - sides[1]) <= 2,
    }
    failed += [f'vento de {name}: {check}' for check, ok in checks.items() if not ok]

if failed:
    sys.exit('FALHOU\n' + '\n'.join(failed))
print('OK: ELMFIRE passa o teste sintético')
PY
