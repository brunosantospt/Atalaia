"""A scenario (docs/contracts.md) run by an engine: from an observed step of a fire, for a while, with
a decision. This turns it into engine requests (engines/CONTRACT.md), runs them and sums up the
result. Results are cached by a key that covers everything they depend on."""

import hashlib
import json
import math
import os
from datetime import timedelta
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from engines import Engine
from fires import NONBURNABLE, ROOT, Fire, format_time, parse_time

API = Path(__file__).resolve().parent
CACHE = Path(os.environ.get('ATALAIA_CACHE', ROOT / 'data/cache'))
MAX_DURATION_MIN = 48 * 60
WEATHER_EVERY_MIN = 30  # weather.json is hourly; every half hour keeps each hour when a step starts at :30


class ScenarioError(ValueError):
    pass


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Moisture(Strict):
    """Fuel moistures in %. If dynamic is True, hourly dead fuel moisture follows Simard (1968) EMC."""
    dead_1h_pct: float = Field(6, gt=0, le=60)
    dead_10h_pct: float = Field(8, gt=0, le=60)
    dead_100h_pct: float = Field(10, gt=0, le=60)
    live_herb_pct: float = Field(60, ge=30, le=300)
    live_woody_pct: float = Field(90, ge=30, le=300)
    dynamic: bool = Field(False)


class Barrier(Strict):
    """A line where nothing burns from `from_min` on: a fire break, a wetted line, a road held."""
    path: list[tuple[float, float]] = Field(min_length=2)  # [[lon, lat], ...]
    width_m: float = Field(0, ge=0, le=1000)
    from_min: float = Field(0, ge=0)


class Decision(Strict):
    barriers: list[Barrier] = []


class Scenario(Strict):
    fire: str
    engine: str = 'elmfire'
    start_step: int = Field(0, ge=0)
    duration_min: float | None = Field(None, gt=0, le=MAX_DURATION_MIN)
    moisture: Moisture = Moisture()
    decision: Decision = Decision()


def plan(scenario: Scenario) -> tuple[Fire, Scenario]:
    """The fire, and the scenario with every default filled in, which is what the key covers."""
    try:
        fire = Fire(scenario.fire)
    except KeyError:
        raise ScenarioError(f'fire: não há o incêndio {scenario.fire}') from None
    steps = fire.steps
    if scenario.start_step >= len(steps):
        raise ScenarioError(f'start_step: {fire.id} tem os passos 0 a {len(steps) - 1}')
    duration = scenario.duration_min
    if duration is None:
        if scenario.start_step + 1 == len(steps):
            raise ScenarioError(f'duration_min: o passo {scenario.start_step} é o último observado, diz quanto tempo correr')
        duration = (steps[scenario.start_step + 1]['hours'] - steps[scenario.start_step]['hours']) * 60
    for barrier in scenario.decision.barriers:
        if barrier.from_min >= duration:
            raise ScenarioError(f'decision.barriers: from_min {barrier.from_min:g} não é antes do fim ({duration:g} min)')
    scenario = scenario.model_copy(update={'duration_min': float(duration)})
    last = max(times[-1] for _, _, times in stretches(scenario))
    try:
        fire.weather(parse_time(steps[scenario.start_step]['time']), [0, last])
    except ValueError as e:
        raise ScenarioError(f'duration_min: {e}') from None
    return fire, scenario


def stretches(scenario: Scenario) -> list[tuple[float, float, list[float]]]:
    """The run split where a barrier starts to hold: each stretch's first and last minute, and the
    minutes it takes the weather at, every WEATHER_EVERY_MIN from its start to the first one at or
    past its end."""
    cuts = sorted({0.0, *(b.from_min for b in scenario.decision.barriers)}) + [scenario.duration_min]
    return [(t0, t1, [t0 + WEATHER_EVERY_MIN * k for k in range(math.ceil((t1 - t0) / WEATHER_EVERY_MIN) + 1)])
            for t0, t1 in zip(cuts, cuts[1:])]


def code_hash() -> str:
    h = hashlib.sha256()
    for path in sorted(API.glob('*.py')):
        h.update(path.name.encode() + b'\0' + path.read_bytes() + b'\0')
    return h.hexdigest()


def cache_key(fire: Fire, scenario: Scenario, engine: Engine) -> str:
    """Changes with the scenario, the fire's files, the engine's code and this API's code."""
    doc = {
        'scenario': scenario.model_dump(mode='json'),
        'fire': fire.file_hashes(),
        'engine': engine.code_hash(),
        'api': code_hash(),
    }
    return hashlib.sha256(json.dumps(doc, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]


def read_cache(key: str) -> dict | None:
    try:
        return json.loads((CACHE / f'{key}.json').read_text())
    except FileNotFoundError:
        return None


def write_cache(key: str, result: dict):
    """Whole or not at all: written aside, then renamed over."""
    CACHE.mkdir(parents=True, exist_ok=True)
    temp = CACHE / f'.{key}.{os.getpid()}.tmp'
    temp.write_text(json.dumps(result, separators=(',', ':')))
    os.replace(temp, CACHE / f'{key}.json')


def simulate(fire: Fire, scenario: Scenario, engine: Engine) -> dict:
    """Runs the scenario. A barrier that only holds from a later minute splits the run there: the
    next stretch starts from what has burned so far, with the barrier in the fuel."""
    step = fire.steps[scenario.start_step]
    start, duration = parse_time(step['time']), scenario.duration_min
    layers = fire.layers()
    barriers = [(b.from_min, fire.line(b.path, b.width_m)) for b in scenario.decision.barriers]
    # Foci that showed up later on, within the run. Those at the start are inside its perimeter.
    ignitions = []
    for p in fire.meta['ignitions']:
        t = (p['hours'] - step['hours']) * 60
        if 0 < t < duration:
            ignitions.append((*fire.point(p['lon'], p['lat']), t))

    arrival = np.full((fire.rows, fire.cols), np.nan)
    burned = fire.perimeter(scenario.start_step)
    runtime, result = 0.0, None
    for t0, t1, times in stretches(scenario):
        fuel = layers['fuel'].copy()
        for from_min, cells in barriers:
            if from_min <= t0:
                fuel[cells] = NONBURNABLE
        weather = fire.weather(start, times)
        weather_items = []
        for t, w in zip(times, weather):
            item = {
                't_min': t - t0,
                'wind_kmh': w['wind_kmh'],
                'wind_from_deg': w['wind_from_deg'],
                'dead_1h_pct': w['dead_1h_pct'] if scenario.moisture.dynamic else scenario.moisture.dead_1h_pct,
                'dead_10h_pct': w['dead_10h_pct'] if scenario.moisture.dynamic else scenario.moisture.dead_10h_pct,
                'dead_100h_pct': w['dead_100h_pct'] if scenario.moisture.dynamic else scenario.moisture.dead_100h_pct,
                'live_herb_pct': scenario.moisture.live_herb_pct,
                'live_woody_pct': scenario.moisture.live_woody_pct,
            }
            weather_items.append(item)

        request = {
            'grid': fire.grid,
            'duration_min': t1 - t0,
            'ignitions': [{'x': x, 'y': y, 't_min': t - t0} for x, y, t in ignitions if t0 <= t < t1],
            'burned': burned.astype(np.uint8).tolist(),
            'weather': weather_items,
            'layers': {
                'fuel': fuel.tolist(),
                'elevation_m': np.round(layers['elevation_m'], 1).tolist(),
                'slope_deg': layers['slope_deg'].tolist(),
                'aspect_deg': layers['aspect_deg'].tolist(),
                'canopy_cover_pct': np.round(layers['canopy_cover_pct'], 1).tolist(),
                'canopy_height_m': np.round(layers['canopy_height_m'], 1).tolist(),
                'canopy_base_m': np.round(layers['canopy_base_m'], 1).tolist(),
                'canopy_bulk_kgm3': np.round(layers['canopy_bulk_kgm3'], 3).tolist(),
            },
        }
        result = engine.run(request)
        stretch = np.array(result['arrival_min'], dtype=float)  # null becomes NaN
        first = np.isnan(arrival) & ~np.isnan(stretch)
        arrival[first] = stretch[first] + t0
        burned = ~np.isnan(arrival)
        runtime += result['runtime_s']

    cell_ha = fire.cellsize**2 / 1e4
    marks = [0, *range(60, math.ceil(duration), 60), duration]  # every hour, and the end
    return {
        'scenario': scenario.model_dump(mode='json'),
        'engine': result['engine'],
        'version': result['version'],
        'start': step['time'],
        'end': format_time(start + timedelta(minutes=duration)),
        'grid': fire.grid,
        'arrival_min': [[None if math.isnan(v) else v for v in row] for row in np.round(arrival, 1).tolist()],
        'burned_ha': round(float(burned.sum()) * cell_ha, 2),
        'steps': [
            {'t_min': t, 'time': format_time(start + timedelta(minutes=t)),
             'burned_ha': round(float((arrival <= t).sum()) * cell_ha, 2)}
            for t in marks
        ],
        'runtime_s': round(runtime, 2),
    }
