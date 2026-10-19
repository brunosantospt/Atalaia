#!/usr/bin/env bash
# P3 gate: SimFire on the same synthetic case as ELMFIRE (flat ground, one fuel, steady wind) must
# burn, and the fire must stretch downwind. It runs twice, wind from the west and from the north, so
# a swapped axis or a wind blowing the wrong way cannot pass. Two more checks cover what the adapter
# changes in SimFire: on a slope with no wind the fire must run uphill, and the adapter's spread loop
# must give the same arrival times as SimFire's own (SIMFIRE_STOCK=1). Needs the image from setup.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

python3 -I - "$here/run.sh" <<'PY'
import json
import math
import os
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


def request(n, wind_kmh, wind_from, duration=60, fuel=102, elevation=0, ignitions=({'x': 0, 'y': 0},)):
    half = n * CELL / 2
    return {
        'grid': {'cols': n, 'rows': n, 'cellsize': CELL, 'xmin': -half, 'ymin': -half, 'srs': 'EPSG:3763'},
        'duration_min': duration,
        'ignitions': list(ignitions),
        'weather': {
            'wind_kmh': wind_kmh, 'wind_from_deg': wind_from,
            'dead_1h_pct': 6, 'dead_10h_pct': 8, 'dead_100h_pct': 10, 'live_herb_pct': 60, 'live_woody_pct': 90,
        },
        'layers': {'fuel': fuel, 'elevation_m': elevation},  # 102 = GR2, low load dry climate grass
    }


def run(label, req, stock=False):
    env = {k: v for k, v in os.environ.items() if k != 'SIMFIRE_STOCK'}
    if stock:
        env['SIMFIRE_STOCK'] = '1'
    done = subprocess.run([RUN], input=json.dumps(req), capture_output=True, text=True, env=env)
    if done.returncode != 0:
        sys.exit(f'run.sh falhou ({label}):\n{done.stderr}')
    return json.loads(done.stdout)


def burned_cells(result):
    return [(r, c) for r, row in enumerate(result['arrival_min']) for c, v in enumerate(row) if v is not None]


def reach(burned, step, centre=C):
    """How far the burned area goes from the ignition in one direction, in cells."""
    dr, dc = step
    return max((r - centre) * dr + (c - centre) * dc for r, c in burned)


failed = []
for name, (wind_from, down, up, flanks) in CASES.items():
    result = run(f'vento de {name}', request(N, 20, wind_from))
    arrival = result['arrival_min']
    burned = burned_cells(result)
    head, back = reach(burned, down), reach(burned, up)
    sides = [reach(burned, f) for f in flanks]
    print(f'vento de {name}: frente {head * CELL} m, trás {back * CELL} m, flancos '
          f'{sides[0] * CELL}/{sides[1] * CELL} m, {result["burned_ha"]} ha, {result["runtime_s"]} s')

    # The same thresholds as ELMFIRE's gate. SimFire's fires are octagons rather than ellipses, but
    # with GR2 they are still long enough. The flanks can differ by a cell: where two burning cells
    # reach the same cell in one step, SimFire keeps the spread from the one it visits last, and it
    # visits them in reading order (north to south, then west to east).
    checks = {
        'a ignição arde no início': arrival[C][C] is not None and arrival[C][C] <= 1,
        'o fogo não chega à borda da grade': max(head, back, *sides) < C,
        'a frente vai a favor do vento': head >= 3 * max(back, 1),
        'o fogo alonga-se na direção do vento': head >= 2 * max(sides),
        'os flancos são simétricos': abs(sides[0] - sides[1]) <= 2,
    }
    failed += [f'vento de {name}: {check}' for check, ok in checks.items() if not ok]

# No wind, and the ground rises 30% to the north. SimFire 2.0.1 on its own sends this fire downhill.
n = 61
slope = [[(n - 1 - r) * CELL * 0.3 for _ in range(n)] for r in range(n)]
result = run('declive', request(n, 0, 0, duration=30, elevation=slope))
burned = burned_cells(result)
uphill, downhill = reach(burned, (-1, 0), n // 2), reach(burned, (1, 0), n // 2)
print(f'declive de 30% para norte, sem vento: sobe {uphill * CELL} m, desce {downhill * CELL} m')
if not uphill >= 3 * max(downhill, 1):
    failed.append('declive: o fogo sobe a encosta')

# Grass to the west, timber understory (165 = TU5) to the east, a strip that does not burn across
# the grass, a hill, wind from the south-west and a second ignition after 10 minutes: the adapter's
# spread loop and SimFire's own must give exactly the same arrival times.
n = 31
fuel = [[91 if r == 12 and 4 <= c <= 20 else 102 if c < 15 else 165 for c in range(n)] for r in range(n)]
hill = [[100 + 4 * (n - r) + 25 * math.exp(-((r - 10) ** 2 + (c - 20) ** 2) / 40) for c in range(n)] for r in range(n)]
req = request(n, 15, 225, duration=40, fuel=fuel, elevation=hill,
              ignitions=({'x': -150, 'y': -150}, {'x': 210, 'y': 270, 't_min': 10}))
fast, stock = run('combustíveis mistos', req), run('combustíveis mistos, SimFire original', req, stock=True)
same = fast['arrival_min'] == stock['arrival_min']
print(f'combustíveis mistos: {len(burned_cells(fast))} células ardidas em {fast["runtime_s"]} s; '
      f'com o ciclo do SimFire, {len(burned_cells(stock))} em {stock["runtime_s"]} s')
if not same:
    failed.append('combustíveis mistos: o ciclo do adapter dá os mesmos tempos que o do SimFire')
if len(burned_cells(fast)) < 50:
    failed.append('combustíveis mistos: o fogo espalha-se')

if failed:
    sys.exit('FALHOU\n' + '\n'.join(failed))
print('OK: SimFire passa o teste sintético')
PY
