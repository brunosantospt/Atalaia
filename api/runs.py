"""A scenario (docs/contracts.md) run by an engine: from an observed step of a fire, for a while, with
a decision. This turns it into engine requests (engines/CONTRACT.md), runs them and sums up the
result. Results are cached by a key that covers everything they depend on."""

import hashlib
import json
import math
import os
from datetime import timedelta
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

import fuels
from engines import Engine
from fires import NONBURNABLE, ROOT, Fire, format_time, parse_time

API = Path(__file__).resolve().parent
CACHE = Path(os.environ.get('ATALAIA_CACHE', ROOT / 'data/cache'))
MAX_DURATION_MIN = 48 * 60
WEATHER_EVERY_MIN = 30  # weather.json is hourly; every half hour keeps each hour when a step starts at :30
# ELMFIRE's ember model with the middle values of its own forecast template, as hindcast/run.py runs it
# (hindcast-registos branch).
SPOTTING = {'ENABLE_SPOTTING': True, 'ENABLE_SURFACE_FIRE_SPOTTING': True, 'USE_SUPERSEDED_SPOTTING': True,
            'CRITICAL_SPOTTING_FIRELINE_INTENSITY(:)': 1000.0, 'SPOTTING_DISTRIBUTION_TYPE': 'LOGNORMAL',
            'SURFACE_FIRE_SPOTTING_PERCENT(:)': 0.1,
            'MEAN_SPOTTING_DIST_MIN': 10.0, 'MEAN_SPOTTING_DIST_MAX': 10.0,
            'NORMALIZED_SPOTTING_DIST_VARIANCE_MIN': 425.0, 'NORMALIZED_SPOTTING_DIST_VARIANCE_MAX': 425.0,
            'SPOT_WS_EXP_LO': 0.55, 'SPOT_WS_EXP_HI': 0.55, 'SPOT_FLIN_EXP_LO': 0.3, 'SPOT_FLIN_EXP_HI': 0.3,
            'NEMBERS_MIN': 1, 'NEMBERS_MAX_LO': 1, 'NEMBERS_MAX_HI': 1,
            'GLOBAL_SURFACE_FIRE_SPOTTING_PERCENT_MIN': 0.065, 'GLOBAL_SURFACE_FIRE_SPOTTING_PERCENT_MAX': 0.065,
            'CROWN_FIRE_SPOTTING_PERCENT_MIN': 0.65, 'CROWN_FIRE_SPOTTING_PERCENT_MAX': 0.65,
            'PIGN_MIN': 55.0, 'PIGN_MAX': 55.0}


class ScenarioError(ValueError):
    pass


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Moisture(Strict):
    """Fuel moistures in %, the same over the grid and the run. Provisional until they are estimated
    from the weather."""
    dead_1h_pct: float = Field(6, gt=0, le=60)
    dead_10h_pct: float = Field(8, gt=0, le=60)
    dead_100h_pct: float = Field(10, gt=0, le=60)
    live_herb_pct: float = Field(60, ge=30, le=300)
    live_woody_pct: float = Field(90, ge=30, le=300)


class WeatherMoisture(Strict):
    """Moistures that follow the weather, as the reference of a built fire has them (fire.json `engine`):
    dead 1 h is the Simard equilibrium moisture of the hour's temperature and humidity less `dry` points
    (floor `floor_pct`), 10 h and 100 h a little above it; live fuels are constant."""
    dry: float = Field(ge=0, le=20)
    floor_pct: float = Field(gt=0, le=60)
    live_herb_pct: float = Field(ge=30, le=300)
    live_woody_pct: float = Field(ge=30, le=300)


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
    # Left out, a fire's own `engine` block in fire.json decides (the reference's settings); a fire without
    # one gets the plain defaults below. Explicit values always win.
    moisture: Moisture | None = None
    weather_moisture: WeatherMoisture | None = None
    decision: Decision = Decision()
    # ELMFIRE only (hindcast-registos): Scott & Burgan (sb) or the Portuguese models of Fernandes et al.
    # 2009 (pt) for the COS classes that have one; ELMFIRE's ember model, and the seed it draws from.
    fuels: Literal['sb', 'pt'] | None = None
    spotting: bool | None = None
    seed: int | None = Field(None, ge=1)
    wind_shift: bool = True  # false: the fire's forecast without the synthetic wind shift (weather_noshift.json); ignored where it has none
    canopy: bool | None = None  # typical canopy in the forest classes (fuels.canopy_layers), so it can crown


def with_engine_defaults(scenario: Scenario, fire: Fire) -> Scenario:
    """Every setting the request left out, from the fire's `engine` block when the engine is ELMFIRE, else the
    plain defaults. The result is what the cache key covers."""
    block = fire.meta.get('engine', {}) if scenario.engine == 'elmfire' else {}
    update = {
        'fuels': scenario.fuels or block.get('fuels', 'sb'),
        'spotting': block.get('spotting', False) if scenario.spotting is None else scenario.spotting,
        'seed': scenario.seed or block.get('seed', 1),
        'canopy': bool(block.get('canopy')) if scenario.canopy is None else scenario.canopy,
    }
    if scenario.moisture is None and scenario.weather_moisture is None and block.get('deadMoisture'):
        dead = block['deadMoisture']
        update['weather_moisture'] = WeatherMoisture(
            dry=dead['simardDryPoints'], floor_pct=dead['floorPct'],
            live_herb_pct=block['liveHerbPct'], live_woody_pct=block['liveWoodyPct'])
    elif scenario.moisture is None and scenario.weather_moisture is None:
        update['moisture'] = Moisture()
    return scenario.model_copy(update=update)


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
    scenario = with_engine_defaults(scenario, fire)
    if not fire.has_noshift:
        scenario = scenario.model_copy(update={'wind_shift': True})  # nothing to switch off: one key
    if scenario.engine != 'elmfire' and (scenario.fuels != 'sb' or scenario.spotting or scenario.canopy or scenario.weather_moisture):
        raise ScenarioError('fuels, spotting, canopy e weather_moisture: só o ELMFIRE os tem')
    if scenario.engine != 'elmfire' and scenario.moisture is None:
        scenario = scenario.model_copy(update={'moisture': Moisture()})
    for barrier in scenario.decision.barriers:
        if barrier.from_min >= duration:
            raise ScenarioError(f'decision.barriers: from_min {barrier.from_min:g} não é antes do fim ({duration:g} min)')
    scenario = scenario.model_copy(update={'duration_min': float(duration)})
    last = max(times[-1] for _, _, times in stretches(scenario))
    try:
        fire.weather(parse_time(steps[scenario.start_step]['time']), [0, last], weather_file(scenario))
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


def weather_file(scenario: Scenario) -> str:
    return 'weather.json' if scenario.wind_shift else 'weather_noshift.json'


def emc_pct(temp_c: float, rh: float) -> float:
    """Equilibrium moisture of fine dead fuel (%), Simard (1968) as NFDRS uses it (scripts/build_hypothetical.py)."""
    t = temp_c * 9 / 5 + 32
    if rh < 10:
        return 0.03229 + 0.281073 * rh - 0.000578 * rh * t
    if rh < 50:
        return 2.22749 + 0.160107 * rh - 0.01478 * t
    return 21.0606 + 0.005565 * rh**2 - 0.00035 * rh * t - 0.483199 * rh


def moisture(scenario: Scenario, fire: Fire, start, minute: float) -> dict:
    """The fuel moistures of a request's weather entry at `minute` after `start`."""
    wm = scenario.weather_moisture
    if wm is None:
        return scenario.moisture.model_dump()
    temp, rh = (fire.series(start, [minute], name, weather_file(scenario))[0] for name in ('tempC', 'rhPct'))
    m1 = max(wm.floor_pct, emc_pct(temp, rh) - wm.dry)
    return {'dead_1h_pct': round(m1, 1), 'dead_10h_pct': round(m1 + 1.5, 1), 'dead_100h_pct': round(m1 + 3.0, 1),
            'live_herb_pct': wm.live_herb_pct, 'live_woody_pct': wm.live_woody_pct}


def simulate(fire: Fire, scenario: Scenario, engine: Engine) -> dict:
    """Runs the scenario. A barrier that only holds from a later minute splits the run there: the
    next stretch starts from what has burned so far, with the barrier in the fuel."""
    step = fire.steps[scenario.start_step]
    start, duration = parse_time(step['time']), scenario.duration_min
    layers = fire.layers()
    extra = {}
    if scenario.fuels == 'pt':
        legend = json.loads((fire.folder / 'fuel.json').read_text())['legend']
        layers['fuel'] = fuels.codes(legend)[fire.read('fuel.u8', 'u1')]
        extra['fuel_models'] = fuels.elmfire_rows()
    if scenario.canopy:
        legend = json.loads((fire.folder / 'fuel.json').read_text())['legend']
        layers.update(fuels.canopy_layers(legend, fire.read('fuel.u8', 'u1')))
    if scenario.spotting:
        extra.update(spotting=SPOTTING, seed=scenario.seed)
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
        weather = fire.weather(start, times, weather_file(scenario))
        request = {
            'grid': fire.grid,
            'duration_min': t1 - t0,
            'ignitions': [{'x': x, 'y': y, 't_min': t - t0} for x, y, t in ignitions if t0 <= t < t1],
            'burned': burned.astype(np.uint8).tolist(),
            'weather': [{'t_min': t - t0, **w, **moisture(scenario, fire, start, t)} for t, w in zip(times, weather)],
            'layers': {
                'fuel': fuel.tolist(),
                'elevation_m': np.round(layers['elevation_m'], 1).tolist(),
                'slope_deg': layers['slope_deg'].tolist(),
                'aspect_deg': layers['aspect_deg'].tolist(),
                **{k: layers[k].tolist() for k in fuels.CANOPY if k in layers},
            },
            **extra,
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
