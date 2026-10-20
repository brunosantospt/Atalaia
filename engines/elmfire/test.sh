#!/usr/bin/env bash
# P3 gate: ELMFIRE on a synthetic case (flat ground, one fuel, steady wind) must burn, and the fire
# must stretch downwind. It runs twice, wind from the west and from the north, so a swapped axis or
# a wind blowing the wrong way cannot pass. P5 adds weather that changes during the run and a fire
# that starts from an area already burned. Needs the image from setup.sh.
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
NORTH, SOUTH, EAST, WEST = (-1, 0), (1, 0), (0, 1), (0, -1)


def weather(wind_from, **extra):
    return {
        'wind_kmh': 20, 'wind_from_deg': wind_from,
        'dead_1h_pct': 6, 'dead_10h_pct': 8, 'dead_100h_pct': 10, 'live_herb_pct': 60, 'live_woody_pct': 90,
        **extra,
    }


def request(weather, duration=60, ignitions=({'x': 0, 'y': 0},), **extra):
    half = N * CELL / 2
    return {
        'grid': {'cols': N, 'rows': N, 'cellsize': CELL, 'xmin': -half, 'ymin': -half, 'srs': 'EPSG:3763'},
        'duration_min': duration,
        'ignitions': list(ignitions),
        'weather': weather,
        'layers': {'fuel': 102},  # GR2, low load dry climate grass
        **extra,
    }


def run(label, req):
    done = subprocess.run([RUN], input=json.dumps(req), capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f'run.sh falhou ({label}):\n{done.stderr}')
    return json.loads(done.stdout)


def burned_cells(result):
    return [(r, c) for r, row in enumerate(result['arrival_min']) for c, v in enumerate(row) if v is not None]


def reach(burned, step):
    """How far the burned area goes from the centre cell in one direction, in cells."""
    dr, dc = step
    return max((r - C) * dr + (c - C) * dc for r, c in burned)


failed = []
for name, (wind_from, down, up, flanks) in CASES.items():
    result = run(f'vento de {name}', request(weather(wind_from)))
    arrival = result['arrival_min']
    burned = burned_cells(result)
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

# The wind backs from 170° to 190° in the first half hour, across south. Taken the long way round,
# through north, it would blow the fire south for a while.
result = run('vento a rodar por sul', request([weather(170, t_min=0), weather(190, t_min=30)]))
burned = burned_cells(result)
north, south = reach(burned, NORTH), reach(burned, SOUTH)
print(f'vento de 170° a 190°: norte {north * CELL} m, sul {south * CELL} m')
if not north >= 3 * max(south, 1):
    failed.append('vento a rodar por sul: o fogo vai sempre para norte')

# West wind for half an hour, then it turns to north by the hour and holds for half an hour more.
# The fire runs east and then south, which a steady west wind would not do.
result = run('vento muda', request([weather(270, t_min=0), weather(270, t_min=30), weather(0, t_min=60)], duration=90))
burned = burned_cells(result)
north, south, east, west = (reach(burned, d) for d in (NORTH, SOUTH, EAST, WEST))
print(f'vento de oeste e depois de norte: norte {north * CELL} m, sul {south * CELL} m, '
      f'este {east * CELL} m, oeste {west * CELL} m')
if not (south >= 2 * max(north, 1) and east >= 3 * max(west, 1)):
    failed.append('vento muda: o fogo vai para este e depois para sul')

# No ignition: the fire starts from a square of 11 x 11 cells already burned, with a west wind.
square = [[1 if abs(r - C) <= 5 and abs(c - C) <= 5 else 0 for c in range(N)] for r in range(N)]
result = run('área ardida', request(weather(270), duration=30, ignitions=(), burned=square))
arrival = result['arrival_min']
burned = burned_cells(result)
inside = {arrival[r][c] for r in range(C - 5, C + 6) for c in range(C - 5, C + 6)}
outside = [arrival[r][c] for r, c in burned if square[r][c] == 0]
east, west = reach(burned, EAST), reach(burned, WEST)
print(f'área ardida de 11 x 11 células: este {east * CELL} m, oeste {west * CELL} m, {result["burned_ha"]} ha')
checks = {
    'as células ardidas chegam com 0': inside == {0},
    'o fogo sai da área a favor do vento': east >= 5 + 5,
    'o fogo mal recua contra o vento': west <= 5 + 1,
    'só as células ardidas chegam com 0': all(v > 0 for v in outside),
}
failed += [f'área ardida: {check}' for check, ok in checks.items() if not ok]

if failed:
    sys.exit('FALHOU\n' + '\n'.join(failed))
print('OK: ELMFIRE passa o teste sintético')
PY
