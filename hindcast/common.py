"""What the hindcast tools share: the fire package (through api/fires.py), where things are kept, the observed
arrival time on the package grid, and the scores of a run."""

import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / 'api'))

import fires  # noqa: E402  (api/fires.py: the package, its grid and layers, Fire.line for barriers)
import runs  # noqa: E402, F401  (re-exported for run.py; api/runs.py: Scenario, Barrier and stretches, the API's barrier rules)

CACHE = ROOT / 'data/hindcast'  # downloads, not versioned
OUT = HERE / 'fires'  # what the tools write per fire, versioned


def fire_dir(fire_id: str) -> Path:
    d = OUT / fire_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def evidence(fire_id: str) -> tuple[dict, list]:
    """evidence.json and the features of evidence.geojson (evidence.py), or nothing if it has not run."""
    d = OUT / fire_id
    if not (d / 'evidence.json').exists():
        return {}, []
    return json.loads((d / 'evidence.json').read_text()), json.loads((d / 'evidence.geojson').read_text())['features']


def official(features: list):
    """The official burn perimeter (ICNF SGIF / GNR), lon/lat, or None."""
    found = [f for f in features if f['properties']['kind'] == 'perimeter']
    return shape(found[0]['geometry']) if found else None


def cells(fire: fires.Fire, geom_lonlat) -> np.ndarray:
    """Cells whose centre is inside a lon/lat shape, as Fire.perimeter counts them."""
    g = fire.project(geom_lonlat)
    shapely.prepare(g)
    return shapely.contains_xy(g, *fire.centres())


def observed_arrival(fire: fires.Fire) -> np.ndarray:
    """Minutes after step 0 at which the observed fire reached each cell (NaN where it did not), interpolated between
    the step perimeters of progression.geojson: inside the ring a step added, t = t_prev + (t_k - t_prev) * d_prev /
    (d_prev + d_next), d_prev the distance to the previous perimeter and d_next to the edge of this one. The same rule
    as FireRenderer's PT-FireSprd scenarios; the perimeters are observed, the times between them are not."""
    t_steps = [s['hours'] * 60 for s in fire.steps]
    per = [fire.perimeter(s['step']) for s in fire.steps]
    arrival = np.full((fire.rows, fire.cols), np.nan)
    arrival[per[0]] = 0.0
    burned = per[0].copy()
    for k in range(1, len(per)):
        ring = per[k] & ~burned
        if not ring.any():
            continue
        d_prev = ndimage.distance_transform_edt(~burned)
        d_next = ndimage.distance_transform_edt(per[k] | burned)
        f = d_prev / np.maximum(d_prev + d_next, 1e-6)
        arrival[ring] = t_steps[k - 1] + (t_steps[k] - t_steps[k - 1]) * f[ring]
        burned |= per[k]
    return arrival


def sorensen(a: np.ndarray, b: np.ndarray) -> float:
    return round(2 * float((a & b).sum()) / max(1, int(a.sum() + b.sum())), 3)


def score(fire: fires.Fire, arrival_min: np.ndarray, features: list, alert_offset_min: float = 0.0) -> dict:
    """The scores of a run (minutes after step 0, NaN where it did not burn):
    - burned area at each observed step and every few hours, against the observed (interpolated) one;
    - footprint Sørensen against the last observed perimeter and against the official one (if evidence ran), and the
      area burned outside the official perimeter;
    - per satellite pass (>= 3 hotspots on this fire, outside earlier fires), the share of hotspots whose pixel
      footprint the run had reached by the pass time + 30 min. Independent of the perimeters, and attack lines placed
      along the final perimeter cannot raise it."""
    cell_ha = fire.cellsize ** 2 / 1e4
    obs = observed_arrival(fire)
    sim = np.nan_to_num(arrival_min, nan=np.inf)
    obs_t = np.nan_to_num(obs, nan=np.inf)
    last = fire.steps[-1]['hours'] * 60
    marks = sorted({*[s['hours'] for s in fire.steps], *range(0, int(math.ceil(np.nanmax(arrival_min) / 60)) + 1, 3)})
    stats = {
        'burned_ha': round(float(np.isfinite(sim).sum()) * cell_ha, 1),
        'by_hour': [{'h': h, 'observed_ha': round(float((obs_t <= h * 60).sum()) * cell_ha),
                     'run_ha': round(float((sim <= h * 60).sum()) * cell_ha)} for h in marks],
        'sorensen_last_step': sorensen(obs_t <= last, sim <= last),
        'sorensen_by_step': [{'step': s['step'], 'h': s['hours'],
                              'sorensen': sorensen(obs_t <= s['hours'] * 60, sim <= s['hours'] * 60)}
                             for s in fire.steps[1:]],
    }
    off = official(features)
    if off is not None:
        m = cells(fire, off)
        burn = np.isfinite(sim)
        stats.update({'official_ha': round(float(m.sum()) * cell_ha, 1), 'sorensen_official': sorensen(m, burn),
                      'outside_official_ha': round(float((burn & ~m).sum()) * cell_ha, 1)})
    passes = {}
    for f in features:
        p = f['properties']
        if p['kind'] != 'hotspot' or not p['this_fire'] or p['in_scar']:
            continue
        x, y = fire.point(*f['geometry']['coordinates'])
        c = (x - fire.grid['xmin']) / fire.cellsize
        r = (fire.grid['ymin'] + fire.rows * fire.cellsize - y) / fire.cellsize
        rad = max(1.0, p['pixel_m'] / 2 / fire.cellsize)
        r0, r1 = int(max(r - rad, 0)), int(min(r + rad + 1, fire.rows))
        c0, c1 = int(max(c - rad, 0)), int(min(c + rad + 1, fire.cols))
        if r0 >= r1 or c0 >= c1:
            continue
        t = p['hours_after_alert'] * 60 + alert_offset_min
        s = passes.setdefault(p['time_utc'][:16], {'time_utc': p['time_utc'], 'h': round(t / 60, 2), 'n': 0, 'hit': 0})
        s['n'] += 1
        s['hit'] += bool((sim[r0:r1, c0:c1] <= t + 30).any())
    pl = [{'time_utc': s['time_utc'], 'h': s['h'], 'n': s['n'], 'reached': round(s['hit'] / s['n'], 2)}
          for s in sorted(passes.values(), key=lambda s: s['time_utc']) if s['n'] >= 3 and s['h'] > 0]
    if pl:
        stats['satellite'] = {'passes': pl, 'mean_reached': round(float(np.mean([x['reached'] for x in pl])), 2)}
    return stats


def alert_offset_min(fire: fires.Fire, ev: dict) -> float:
    """Minutes from step 0 to the SGIF alert (negative when the alert came first, as in Vieira: 09:46 vs 10:00)."""
    if not ev:
        return 0.0
    alert = datetime.fromisoformat(ev['incident']['alert']).replace(tzinfo=None)
    return (alert - fires.parse_time(fire.steps[0]['time'])).total_seconds() / 60
