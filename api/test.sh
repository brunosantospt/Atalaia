#!/usr/bin/env bash
# P5 gate: the API on both fires. It checks what the API reads from each fire's folder (perimeters,
# weather, lines drawn on the map), the engine requests it builds for a scenario, the scenarios it
# turns down, and runs on every engine that is ready: from the observed perimeter, read back from the
# cache, held by a ring of fire break, and with the ring only from a later minute. It keeps its cache
# in a temporary folder, so data/cache/ is left alone. Needs setup.sh, and Docker for the runs.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

"$here/.venv/bin/python" -I - "$here" <<'PY'
import json
import os
import sys
import tempfile
import warnings

sys.path.insert(0, sys.argv[1])
cache = tempfile.TemporaryDirectory(prefix='atalaia-cache-')
os.environ['ATALAIA_CACHE'] = cache.name

import numpy as np
import shapely
from pyproj import Transformer

warnings.filterwarnings('ignore', message='.*httpx')  # Starlette's TestClient wants a newer httpx
from fastapi.testclient import TestClient

import fires
import runs
from app import app

client = TestClient(app)
VIEIRA, CABECEIRAS = 'VieiradoMinho_10082016', 'CabeceirasdeBasto_06092016'
failed = []


def check(label, checks):
    global failed
    failed += [f'{label}: {name}' for name, ok in checks.items() if not ok]


def arc(a, b):
    """The short turn from direction a to b, in degrees, -180 to 180."""
    return (b - a + 180) % 360 - 180


def joined(cells):
    """Whether the cells make one piece, going only through shared edges."""
    todo = [tuple(np.argwhere(cells)[0])]
    seen = set(todo)
    while todo:
        r, c = todo.pop()
        for n in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= n[0] < cells.shape[0] and 0 <= n[1] < cells.shape[1] and cells[n] and n not in seen:
                seen.add(n)
                todo.append(n)
    return len(seen) == cells.sum()


def observed(fire, step):
    """The perimeter observed at a step, in the grid's metres."""
    features = json.loads((fire.folder / 'progression.geojson').read_text())['features']
    found = [f for f in features if f['properties'].get('kind') == 'perimeter' and f['properties']['step'] == step]
    return fire.project(shapely.from_geojson(json.dumps(found[0]['geometry'])))


def to_lonlat(fire, xy):
    back = Transformer.from_crs(fire.grid['srs'], 'EPSG:4326', always_xy=True)
    return [list(back.transform(x, y)) for x, y in xy]


def cell_lonlat(fire, row, col):
    """The centre of a cell, which can be off the grid."""
    x = fire.grid['xmin'] + (col + 0.5) * fire.cellsize
    y = fire.grid['ymin'] + (fire.rows - row - 0.5) * fire.cellsize
    return to_lonlat(fire, [(x, y)])[0]


def arrival(result):
    return np.array(result['arrival_min'], dtype=float)  # null becomes NaN


# What the API reads from each fire's folder.
listed = client.get('/api/fires').json()
check('GET /api/fires', {
    'os 2 incêndios': [f['id'] for f in listed] == [VIEIRA, CABECEIRAS],
    '4 passos em cada': all(len(f['steps']) == 4 for f in listed),
    'focos: 1 em Vieira, 3 em Cabeceiras': [len(f['ignitions']) for f in listed] == [1, 3],
})

for fire_id in (VIEIRA, CABECEIRAS):
    fire = fires.Fire(fire_id)
    cell_ha = fire.cellsize**2 / 1e4

    # Each observed perimeter, cut to the grid's cells, has about the area PT-FireSprd gives it.
    areas = [round(float(fire.perimeter(s['step']).sum()) * cell_ha, 1) for s in fire.steps]
    print(f'{fire_id}: perímetros {areas} ha, observados {[s["areaHa"] for s in fire.steps]} ha')
    check(f'{fire_id} perímetros', {
        f'passo {s["step"]} com a área observada': abs(a - s['areaHa']) <= max(0.02 * s['areaHa'], 0.5)
        for a, s in zip(areas, fire.steps)
    })

    # The wind every half hour for the first 10 hours: the hours of weather.json as they are, and
    # halfway in between, with the direction halfway along the short turn.
    w = json.loads((fire.folder / 'weather.json').read_text())
    start = fires.parse_time(fire.steps[0]['time'])
    first = w['time'].index(fire.steps[0]['time'])
    got = fire.weather(start, [30 * k for k in range(21)])
    errors = []
    for k, g in enumerate(got):
        a = first + k // 2
        if k % 2 == 0:
            speed, direction = w['windKmh'][a], w['windFromDeg'][a]
        else:
            speed = (w['windKmh'][a] + w['windKmh'][a + 1]) / 2
            direction = w['windFromDeg'][a] + arc(w['windFromDeg'][a], w['windFromDeg'][a + 1]) / 2
        errors.append((abs(g['wind_kmh'] - speed), abs(arc(g['wind_from_deg'], direction))))
    try:
        fire.weather(start, [0, 7 * 24 * 60])
        outside = False
    except ValueError:
        outside = True
    check(f'{fire_id} meteo', {
        'a velocidade de hora a hora e a meio': max(e[0] for e in errors) <= 0.01,
        'a direção de hora a hora e a meio, pelo lado mais curto': max(e[1] for e in errors) <= 0.1,
        'recusa minutos fora da meteo': outside,
    })

    # A slanted line on the map: every cell it touches, joined edge to edge, with or without width.
    path = [cell_lonlat(fire, 40, 40), cell_lonlat(fire, fire.rows - 60, fire.cols - 40)]
    thin, wide = fire.line(path, 0), fire.line(path, 100)
    edge = fire.line([cell_lonlat(fire, 20, -30), cell_lonlat(fire, 20, 30)], 0)  # a line from off the grid
    xmax = fire.grid['xmin'] + fire.cols * fire.cellsize
    off = fire.line(to_lonlat(fire, [(xmax + 1000, 0), (xmax + 2000, 100)]), 50)
    print(f'{fire_id}: linha com {int(thin.sum())} células, {int(wide.sum())} com 100 m de largura')
    check(f'{fire_id} linhas', {
        'a linha toca células': thin.sum() > 0,
        'a linha é uma peça só': joined(thin),
        'com 100 m também': joined(wide),
        'com 100 m tem mais células e inclui as da linha': wide.sum() > 2 * thin.sum() and (wide >= thin).all(),
        'a linha que vem de fora da grade fica dentro dela': edge.sum() > 0 and joined(edge),
        'uma linha fora da grade não toca nada': off.sum() == 0,
    })


class Recorder:
    """Stands in for an engine: keeps each request, and answers that what had burned is still burned
    and that each ignition burns its own cell at its minute."""

    def __init__(self):
        self.requests = []

    def run(self, request):
        self.requests.append(request)
        g = request['grid']
        arrival = [[0.0 if b else None for b in row] for row in request['burned']]
        for p in request['ignitions']:
            row = g['rows'] - 1 - int((p['y'] - g['ymin']) // g['cellsize'])
            col = int((p['x'] - g['xmin']) // g['cellsize'])
            arrival[row][col] = p['t_min']
        return {'engine': 'recorder', 'version': '0', 'grid': g, 'arrival_min': arrival, 'burned_ha': 0,
                'runtime_s': 0}


# The requests for Cabeceiras de Basto from step 0 (04:00) for 10 hours, with one line held from the
# start and another from minute 300. The run splits at 300; the second focus, at 13:30 (minute 570),
# goes into the second stretch, at its minute 270.
fire = fires.Fire(CABECEIRAS)
early = [cell_lonlat(fire, 100, 60), cell_lonlat(fire, 100, 160)]
late = [cell_lonlat(fire, 300, 250), cell_lonlat(fire, 380, 400)]
fire, scenario = runs.plan(runs.Scenario(fire=CABECEIRAS, duration_min=600, decision={'barriers': [
    {'path': early}, {'path': late, 'width_m': 60, 'from_min': 300},
]}))
recorder = Recorder()
result = runs.simulate(fire, scenario, recorder)
first, second = recorder.requests if len(recorder.requests) == 2 else (None, None)
fuel, perimeter = fire.layers()['fuel'], fire.perimeter(0)
early_cells, late_cells = fire.line(early, 0), fire.line(late, 60)
foci = [fire.point(p['lon'], p['lat']) for p in fire.meta['ignitions'] if p['hours'] > 0]
got = arrival(result)
at_foci = [got[fire.rows - 1 - int((y - fire.grid['ymin']) // fire.cellsize), int((x - fire.grid['xmin']) // fire.cellsize)]
           for x, y in foci]
check('pedidos de Cabeceiras', {
    '2 troços, partidos no minuto 300': first is not None and [r['duration_min'] for r in (first, second)] == [300, 300],
    'a meteo de 30 em 30 min desde 0 em cada troço': first is not None and all(
        [m['t_min'] for m in r['weather']] == [30 * k for k in range(11)] for r in (first, second)),
    'a meteo do segundo troço começa às 09:00': second is not None and
        {k: second['weather'][0][k] for k in ('wind_kmh', 'wind_from_deg')} ==
        fire.weather(fires.parse_time('2016-09-06T04:00'), [300])[0],
    'as humidades provisórias em cada momento': first is not None and all(
        (m['dead_1h_pct'], m['dead_10h_pct'], m['dead_100h_pct'], m['live_herb_pct'], m['live_woody_pct']) == (6, 8, 10, 60, 90)
        for r in (first, second) for m in r['weather']),
    'o primeiro troço parte do perímetro observado': first is not None and (np.array(first['burned']) == perimeter).all(),
    'a primeira linha logo no primeiro troço': first is not None and
        (np.array(first['layers']['fuel']) == np.where(early_cells, fires.NONBURNABLE, fuel)).all(),
    'a segunda linha só no segundo troço': second is not None and
        (np.array(second['layers']['fuel']) == np.where(early_cells | late_cells, fires.NONBURNABLE, fuel)).all(),
    'o segundo foco no segundo troço, no minuto 270': first is not None and first['ignitions'] == [] and
        [p['t_min'] for p in second['ignitions']] == [270, 270],
    'os focos chegam no minuto 570 do cenário': at_foci == [570, 570],
    'o perímetro chega no minuto 0': (got[perimeter] == 0).all(),
    'marcas de hora a hora e no fim': [s['t_min'] for s in result['steps']] == [*range(0, 600, 60), 600],
    'acaba às 14:00': (result['start'], result['end']) == ('2016-09-06T04:00', '2016-09-06T14:00'),
})

# Scenarios the API turns down before it looks for an engine.
line = [cell_lonlat(fire, 100, 60), cell_lonlat(fire, 100, 160)]
refused = {
    'incêndio que não existe': {'fire': 'Lisboa_01012016'},
    'motor que não existe': {'fire': VIEIRA, 'engine': 'farsite'},
    'passo que não existe': {'fire': VIEIRA, 'start_step': 4},
    'último passo sem duração': {'fire': VIEIRA, 'start_step': 3},
    'mais de 48 horas': {'fire': VIEIRA, 'duration_min': 3000},
    'para lá da meteo': {'fire': VIEIRA, 'start_step': 3, 'duration_min': 2880},
    'faixa que só começa no fim': {'fire': VIEIRA, 'duration_min': 60, 'decision': {'barriers': [{'path': line, 'from_min': 60}]}},
    'faixa com um ponto só': {'fire': VIEIRA, 'decision': {'barriers': [{'path': line[:1]}]}},
    'humidade a zero': {'fire': VIEIRA, 'moisture': {'dead_1h_pct': 0}},
    'campo que não existe': {'fire': VIEIRA, 'wind_kmh': 20},
}
for name, body in refused.items():
    status = client.post('/api/run', json=body).status_code
    if status != 422:
        failed.append(f'POST /api/run recusa {name}: deu {status}')

# Runs on every engine that is ready.
engines = client.get('/api/engines').json()
print('motores: ' + ', '.join(f'{e["id"]} {e["version"]} ({e["state"]})' for e in engines))
check('GET /api/engines', {'ELMFIRE e SimFire': {e['id'] for e in engines} == {'elmfire', 'simfire'}})
ready = [e['id'] for e in engines if e['state'] == 'ready']
if not ready:
    print('Nenhum motor pronto: as corridas ficam por testar')

vieira = fires.Fire(VIEIRA)
perimeter = vieira.perimeter(0)
cell_ha = vieira.cellsize**2 / 1e4
shape = observed(vieira, 0)
distance = shapely.distance(shape, shapely.points(*vieira.centres()))  # from the observed perimeter, in m
RING_M, WIDTH_M = 500, 60
ring = to_lonlat(vieira, shape.buffer(RING_M).exterior.coords)
reach_m = RING_M + WIDTH_M / 2 + vieira.cellsize  # past the ring's outer edge and one cell more

for engine in ready:
    base = {'fire': VIEIRA, 'engine': engine, 'duration_min': 120}
    response = client.post('/api/run', json=base)
    if response.status_code != 200:
        failed.append(f'{engine}: Vieira do Minho deu {response.status_code}: {response.text[:300]}')
        continue
    free = response.json()
    again = client.post('/api/run', json=base).json()
    held = client.post('/api/run', json={**base, 'decision': {'barriers': [{'path': ring, 'width_m': WIDTH_M}]}}).json()
    later = client.post('/api/run', json={**base, 'decision': {'barriers': [
        {'path': ring, 'width_m': WIDTH_M, 'from_min': 60}]}}).json()
    burned = {name: ~np.isnan(arrival(r)) for name, r in (('free', free), ('held', held), ('later', later))}
    furthest = {name: float(distance[b].max()) for name, b in burned.items()}
    areas = {name: [s['burned_ha'] for s in r['steps']] for name, r in (('free', free), ('held', held), ('later', later))}
    print(f'{engine}, Vieira do Minho, 10:00 a 12:00: {areas["free"]} ha, até {furthest["free"]:.0f} m do perímetro, '
          f'{free["runtime_s"]} s')
    print(f'{engine}, com um anel a {RING_M} m: {areas["held"]} ha, até {furthest["held"]:.0f} m; '
          f'o anel só a partir das 11:00: {areas["later"]} ha')
    check(f'{engine} Vieira do Minho', {
        'parte do perímetro observado, que chega no minuto 0': (arrival(free)[perimeter] == 0).all(),
        'o fogo cresce': free['burned_ha'] > perimeter.sum() * cell_ha + 1,
        'as marcas crescem e acabam na área final': areas['free'] == sorted(areas['free']) and areas['free'][-1] == free['burned_ha'],
        'das 10:00 às 12:00': (free['start'], free['end']) == ('2016-08-10T10:00', '2016-08-10T12:00'),
        'o cenário volta com as humidades por omissão': free['scenario']['moisture']['dead_1h_pct'] == 6,
        'vem comprimido': response.headers.get('content-encoding') == 'gzip',
        'a segunda vez vem da cache': (free['cached'], again['cached']) == (False, True) and again['key'] == free['key'],
        'a cache dá o mesmo resultado': again['arrival_min'] == free['arrival_min'],
        'a cache fica na pasta temporária': os.path.exists(os.path.join(cache.name, free['key'] + '.json')),
        'sem o anel o fogo passa dele': furthest['free'] > reach_m,
        'o anel segura o fogo': furthest['held'] <= reach_m,
        'até às 11:00 o anel tardio não muda nada': abs(areas['later'][1] - areas['free'][1]) <= 0.02 * areas['free'][1],
        'o anel tardio fica entre os dois': areas['held'][-1] <= areas['later'][-1] <= 1.02 * areas['free'][-1],
    })

    # The other fire, for an hour from step 1.
    response = client.post('/api/run', json={'fire': CABECEIRAS, 'engine': engine, 'start_step': 1, 'duration_min': 60})
    other = response.json() if response.status_code == 200 else None
    start_ha = fires.Fire(CABECEIRAS).perimeter(1).sum() * cell_ha
    if other:
        print(f'{engine}, Cabeceiras de Basto, 13:30 a 14:30: {start_ha:.1f} -> {other["burned_ha"]} ha, {other["runtime_s"]} s')
    check(f'{engine} Cabeceiras de Basto', {
        f'corre (deu {response.status_code})': other is not None,
        'o fogo cresce': other is not None and other['burned_ha'] > start_ha,
    })

if failed:
    sys.exit('FALHOU\n' + '\n'.join(failed))
print('OK: a API passa o teste' + ('' if ready else ', sem corridas'))
PY
