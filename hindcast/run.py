"""A hindcast run of ELMFIRE on a real fire, with the records evidence.py collects, and its scores.

    hindcast/.venv/bin/python -I hindcast/run.py VieiradoMinho_10082016 --name b \\
        --fuels pt --live-herb 30 --live-woody 70 --spotting --barriers hindcast/fires/VieiradoMinho_10082016/attack_lines.json

Like POST /api/run (api/runs.py) it starts from an observed step (the perimeter of --start-step), splits the run where
a barrier starts to hold (runs.stretches), rasterises barriers with Fire.line and adds the later foci of fire.json as
ignitions. It goes through engines/elmfire/run.sh, with its four ELMFIRE-only request fields (engines/CONTRACT.md),
and adds:

  --fuels pt          the Portuguese fuel models (fuels.py) instead of fuel.json's Scott & Burgan codes
  --scars             the burn perimeters of the fires put out shortly before (evidence.py) are non-burnable
  dead moistures      from each hour's temperature and humidity in weather.json (Simard 1968 equilibrium moisture,
                      as in the US NFDRS; 10 h = 1 h + 1.5 %, 100 h = 1 h + 3 %), runs.dead_moistures as in the API;
                      --dead fixed keeps the 6/8/10 % the API had before
  --live-herb/-woody  live fuel moistures (%); 30/70 for a drought (SGIF's DC and BUI say how dry it was)
  canopy              ELMFIRE's crown fire layers from fires/<id>/canopy.npz when there is one (DGT LiDAR, see README)
  --canopy-fill       the LiDAR is from 2024-25, after the fire: inside the burned area (official and observed
                      perimeters) each cell's canopy becomes its COS class's median outside it and outside the scars,
                      a guess at the canopy before the fire
  --spotting          ELMFIRE's ember model, the middle values of its own forecast template; --seed picks the draw
  --adj, --wind-mult  calibration knobs: ELMFIRE's spread rate adjustment, and a factor on the wind speed
  --weather cerra     CERRA (5.5 km) instead of ERA5, from weather_cerra.json (feature/cerra-wind-engine)
  --topowind          the wind per 30 m cell of scripts/build_wind_field.py (feature/cerra-wind-engine)
  --barriers FILE     barriers in decision.barriers format (attack.py writes one); only path, width_m and from_min
                      are used, through the API's own Scenario model

With --scars and the other defaults (Scott & Burgan, dead moistures from the weather, live 60/90 %, the canopy) the
run has the same inputs as POST /api/run: the package's scars.geojson and canopy files are evidence.geojson's scars and
canopy.npz (scripts/build_scars_canopy.py).

Writes hindcast/fires/<id>/runs/<name>/result.json (options, scores, see common.score, and the machine and image it
ran on: the spotting draws differ between machines) and preview.png (arrival in colour, observed perimeter blue,
official cyan, scars red, barriers white with their start hour; --no-preview leaves it out). The arrival grid itself
goes to data/hindcast/<id>/<name>.npy (minutes after the start, NaN where it did not burn).
"""

import argparse
import json
import math
import platform
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fuels  # noqa: E402
from common import (CACHE, HERE, alert_offset_min, cells, evidence, fire_dir, fires, observed_arrival, official,  # noqa: E402
                    runs, score)

ENGINE = HERE.parent / "engines" / "elmfire" / "run.sh"
FIXED_DEAD = {"dead_1h_pct": 6.0, "dead_10h_pct": 8.0, "dead_100h_pct": 10.0}   # --dead fixed: the API's old ones
# ELMFIRE's forecast template (vendor/elmfire/runs/forecasts/templates/default), each range at its middle
SPOTTING = {"ENABLE_SPOTTING": True, "ENABLE_SURFACE_FIRE_SPOTTING": True, "USE_SUPERSEDED_SPOTTING": True,
            "CRITICAL_SPOTTING_FIRELINE_INTENSITY(:)": 1000.0, "SPOTTING_DISTRIBUTION_TYPE": "LOGNORMAL",
            "SURFACE_FIRE_SPOTTING_PERCENT(:)": 0.1,
            "MEAN_SPOTTING_DIST_MIN": 10.0, "MEAN_SPOTTING_DIST_MAX": 10.0,
            "NORMALIZED_SPOTTING_DIST_VARIANCE_MIN": 425.0, "NORMALIZED_SPOTTING_DIST_VARIANCE_MAX": 425.0,
            "SPOT_WS_EXP_LO": 0.55, "SPOT_WS_EXP_HI": 0.55, "SPOT_FLIN_EXP_LO": 0.3, "SPOT_FLIN_EXP_HI": 0.3,
            "NEMBERS_MIN": 1, "NEMBERS_MAX_LO": 1, "NEMBERS_MAX_HI": 1,
            "GLOBAL_SURFACE_FIRE_SPOTTING_PERCENT_MIN": 0.065, "GLOBAL_SURFACE_FIRE_SPOTTING_PERCENT_MAX": 0.065,
            "CROWN_FIRE_SPOTTING_PERCENT_MIN": 0.65, "CROWN_FIRE_SPOTTING_PERCENT_MAX": 0.65,
            "PIGN_MIN": 55.0, "PIGN_MAX": 55.0}


def topowind():
    """calculate_micro_wind of scripts/build_wind_field.py (feature/cerra-wind-engine): the 30 m terrain wind."""
    sys.path.insert(0, str(HERE.parent / "scripts"))
    try:
        from build_wind_field import calculate_micro_wind
    except ImportError:
        raise SystemExit("--topowind precisa de scripts/build_wind_field.py (ramo feature/cerra-wind-engine)") from None
    return calculate_micro_wind


WET_1H_PCT = 60.0   # wetted fine fuel: above every model's dead moisture of extinction (12-45 %)


def line_cover(fire, path: list, width_m: float) -> np.ndarray:
    """The share of each cell's area that a line `width_m` wide covers (not every touched cell in full, as Fire.line
    does for barriers): a 10 m wet line over 30 m cells wets a third of each."""
    import shapely
    from shapely.geometry import LineString
    shape = fire.project(LineString(path)).buffer(width_m / 2, cap_style="flat")
    cs = fire.cellsize
    x0, y0, x1, y1 = shape.bounds
    top = fire.grid["ymin"] + fire.rows * cs
    c0, c1 = max(int((x0 - fire.grid["xmin"]) // cs), 0), min(int((x1 - fire.grid["xmin"]) // cs), fire.cols - 1)
    r0, r1 = max(int((top - y1) // cs), 0), min(int((top - y0) // cs), fire.rows - 1)
    cover = np.zeros((fire.rows, fire.cols))
    if c0 > c1 or r0 > r1:
        return cover
    cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    west, north = fire.grid["xmin"] + cols * cs, top - rows * cs
    boxes = shapely.box(west, north - cs, west + cs, north)
    cover[rows, cols] = shapely.area(shapely.intersection(boxes, shape)) / cs ** 2
    return cover


def wet(weather: list[dict], lines: list, tau: float) -> list[dict]:
    """The weather with the wet lines in it: under a line dropped at d, the 1 h dead moisture is
    m + cover x exp(-(t - d) / tau) x (WET - m) from the latest drop on (one grid per half hour while any water is
    left, the plain value otherwise)."""
    if not lines:
        return weather
    out = []
    for w in weather:
        t = w["t_min"]
        effect = 0.0
        for cover, drops in lines:
            done = drops[drops <= t]
            if len(done):
                effect = np.maximum(effect, cover * math.exp(-(t - done.max()) / tau))
        if np.max(effect) < 0.01:
            out.append(w)
            continue
        m = w["dead_1h_pct"]
        out.append({**w, "dead_1h_pct": np.round(m + effect * (WET_1H_PCT - m), 1).tolist()})
    return out


def ignition_probability(weather: list[dict], start) -> float:
    """The chance (%) that an ember landing on fine dead fuel lights it, over a run: Schroeder's (1969) heat of
    ignition as in Rothermel (1983) and BehavePlus, Qig = 144.5 - 0.266 Tf - 0.00058 Tf^2 - Tf M + 18.54 (1 - e^-15.1M)
    + 640 M (cal/g; Tf fuel temperature, degC; M the 1 h moisture, fraction), X = (400 - Qig) / 10,
    P = 0.000048 X^4.3 / 50. The fuel is taken 10 degC above the air in the day (10-19 h, sun on the litter). The mean
    of the run's half hours."""
    ps = []
    for w in weather:
        hour = (start + timedelta(minutes=w["t_min"])).hour
        tf = w.get("temp_c", 25.0) + (10.0 if 10 <= hour <= 19 else 0.0)
        m = w["dead_1h_pct"] / 100
        q = 144.5 - 0.266 * tf - 0.00058 * tf * tf - tf * m + 18.54 * (1 - math.exp(-15.1 * m)) + 640 * m
        x = max(0.0, (400 - q) / 10)
        ps.append(min(1.0, 0.000048 * x ** 4.3 / 50))
    return round(100 * float(np.mean(ps)), 1)


def weather_at(fire: fires.Fire, start, minutes: list[float], args) -> list[dict]:
    """weather.json (or weather_cerra.json with --weather cerra) at `minutes` after `start`: wind and temperature/
    humidity linear between the hours, the direction the short way round (as Fire.weather), and the dead fuel
    moistures from them (runs.dead_moistures, as the API). With --topowind the wind becomes one value per cell (scripts/build_wind_field.py)."""
    name = "weather.json" if args.weather == "era5" else "weather_cerra.json"
    if not (fire.folder / name).exists():
        raise SystemExit(f"falta web/public/fires/{fire.id}/{name} (scripts/build_weather_cerra.py)")
    w = json.loads((fire.folder / name).read_text())
    hours = np.array([(fires.parse_time(t[:16]) - start).total_seconds() / 60 for t in w["time"]])
    if min(minutes) < hours[0] or max(minutes) > hours[-1]:
        raise SystemExit("a corrida sai da meteo do incêndio (weather.json)")
    temp = np.interp(minutes, hours, w["tempC"])
    rh = np.interp(minutes, hours, w["rhPct"])
    speed = np.interp(minutes, hours, w["windKmh"]) * args.wind_mult
    if args.gust_frac:   # part of the way from the mean wind to the gusts (both in the weather and the forecasts)
        gust = np.interp(minutes, hours, w["gustKmh"]) * args.wind_mult
        speed = speed + args.gust_frac * (gust - speed)
    wfrom = (np.degrees(np.interp(minutes, hours, np.unwrap(np.radians(w["windFromDeg"])))) + args.wind_rotate) % 360
    out = []
    for t, tc, h, s, d in zip(minutes, temp, rh, speed, wfrom):
        dead = runs.dead_moistures(tc, h) if args.dead == "emc" else FIXED_DEAD
        out.append({"t_min": float(t), "wind_kmh": round(float(s), 2), "wind_from_deg": round(float(d), 1), **dead,
                    "live_herb_pct": args.live_herb, "live_woody_pct": args.live_woody,
                    "temp_c": round(float(tc), 1)})   # for ignition_probability; not sent to the engine
    if args.topowind:
        micro = topowind()
        layers = fire.layers()
        slope, aspect = layers["slope_deg"].astype(float), layers["aspect_deg"].astype(float)
        for o, m in zip(out, minutes):
            hour = (start + timedelta(minutes=float(m))).hour
            speed, wfrom = micro(o["wind_kmh"], o["wind_from_deg"], hour, slope, aspect)
            o["wind_kmh"], o["wind_from_deg"] = np.round(speed, 2).tolist(), np.round(wfrom, 1).tolist()
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--name", required=True, help="the run's folder name in fires/<id>/runs/")
    p.add_argument("--start-step", type=int, default=0)
    p.add_argument("--duration-min", type=float, help="default: to the last observed step")
    p.add_argument("--fuels", choices=["sb", "pt"], default="sb")
    p.add_argument("--shrub", choices=fuels.SHRUBS, default="V-MAa", help="model for COS shrubland with --fuels pt")
    p.add_argument("--scars", action=argparse.BooleanOptionalAction, default=False)
    p.add_argument("--dead", choices=["emc", "fixed"], default="emc",
                   help="dead moistures from each hour's weather, or fixed at the API's defaults (6/8/10 %%)")
    p.add_argument("--live-herb", type=float, default=60.0)
    p.add_argument("--live-woody", type=float, default=90.0)
    p.add_argument("--canopy", action=argparse.BooleanOptionalAction, default=True,
                   help="use fires/<id>/canopy.npz when there is one")
    p.add_argument("--canopy-fill", action="store_true",
                   help="inside the burned area, the canopy of each COS class's median outside it (before the fire)")
    p.add_argument("--canopy-source", choices=["lidar", "meta"], default="lidar",
                   help="canopy.npz (DGT LiDAR, canopy.py) or canopy_meta.npz (Meta/WRI global map, canopy_open.py)")
    p.add_argument("--spotting", action="store_true")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--weather", choices=["era5", "cerra"], default="era5",
                   help="weather.json (ERA5) or weather_cerra.json (CERRA 5.5 km, scripts/build_weather_cerra.py)")
    p.add_argument("--topowind", action="store_true",
                   help="the wind per 30 m cell from scripts/build_wind_field.py (slope/aspect speed-up, deflection, "
                        "daytime upslope wind)")
    p.add_argument("--adj", type=float, default=1.0)
    p.add_argument("--adj-class", default="", help="spread adjustment per fuel class of fuel.json, times --adj, e.g. "
                   "herb=1.2,shrub=1.6,euc=2.0,forest=1.4 (classes: herb, shrub, euc, forest)")
    p.add_argument("--gust-frac", type=float, default=0.0,
                   help="effective wind = mean + f x (gust - mean), f from 0 (mean wind) to 1 (the gusts)")
    p.add_argument("--wind-rotate", type=float, default=0.0, help="degrees added to the direction the wind comes from")
    p.add_argument("--spotting-dynamic", action="store_true",
                   help="with --spotting: the embers' ignition probability (PIGN) from the run's fine fuel moisture and "
                        "temperature (Schroeder 1969, Rothermel 1983, as BehavePlus), instead of a fixed 55 %%")
    p.add_argument("--spotting-dist-mult", type=float, default=1.0,
                   help="with --spotting: the mean spotting distance times this (eucalyptus bark goes far further than "
                        "ELMFIRE's template, which lands most embers within a few cells)")
    p.add_argument("--spotting-embers", type=int, default=1, help="with --spotting: embers per spotting event (max)")
    p.add_argument("--active-edge", choices=["all", "hotspots", "oracle"], default="all",
                   help="which edge of the start perimeter still burns: all of it (default); only near the satellite "
                        "hotspots of the last --active-window-h hours (what a real-time system knows); or only where the "
                        "fire grew to the next observed step (cheats: the bound of perfect knowledge). The rest of the "
                        "edge is held: non-burnable, as a flank the crews put out")
    p.add_argument("--active-window-h", type=float, default=12.0)
    p.add_argument("--wind-mult", type=float, default=1.0)
    p.add_argument("--barriers", type=Path)
    p.add_argument("--wet-lines", type=Path,
                   help="wet lines (same JSON as --barriers: path, width_m, from_min; optional repeat_min, until_min): "
                        "the water raises the fine dead fuel moisture under the line, by the share of each cell it "
                        "covers, and it dries back with the 1 h fuels' time lag; no cell becomes non-burnable for good")
    p.add_argument("--wet-tau", type=float, default=60.0, help="minutes for a wet line to lose 63 %% of its water "
                   "(the 1 h timelag of fine fuels)")
    p.add_argument("--engine", type=Path, default=ENGINE)
    p.add_argument("--preview", action=argparse.BooleanOptionalAction, default=True, help="write preview.png")
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    ev, feats = evidence(args.fire)
    step = fire.steps[args.start_step]
    duration = args.duration_min or (fire.steps[-1]["hours"] - step["hours"]) * 60
    start = fires.parse_time(step["time"])
    legend = json.loads((fire.folder / "fuel.json").read_text())["legend"]
    idx = fire.read("fuel.u8", "u1")
    layers = fire.layers()
    fuel = (fuels.codes(legend, args.shrub) if args.fuels == "pt" else
            np.array([l["scottBurgan"] for l in legend], np.int16))[idx]
    extra = {}
    if args.fuels == "pt":
        extra["fuel_models"] = fuels.elmfire_rows()
    burnable = np.array([l["scottBurgan"] for l in legend])[idx] > 99
    notes = []
    if args.scars:
        scar = np.zeros_like(burnable)
        for f in feats:
            if f["properties"]["kind"] == "scar":
                scar |= cells(fire, shape(f["geometry"]))
        fuel = np.where(scar & burnable, fires.NONBURNABLE, fuel)
        notes.append(f"cicatrizes: {scar.sum() * fire.cellsize ** 2 / 1e4:.0f} ha")
    base = {"elevation_m": np.round(layers["elevation_m"], 1).tolist(), "slope_deg": layers["slope_deg"].tolist(),
            "aspect_deg": layers["aspect_deg"].tolist()}
    can = fire_dir(args.fire) / ("canopy.npz" if args.canopy_source == "lidar" else "canopy_meta.npz")
    if args.canopy and can.exists():
        c = dict(np.load(can))
        notes.append("copas do LiDAR" if args.canopy_source == "lidar" else "copas do mapa global da Meta/WRI")
        if args.canopy_fill:
            c, ha = canopy_fill(fire, c, idx, feats)
            notes.append(f"copas dentro da área ardida ({ha:.0f} ha): mediana da classe COS fora dela")
        base.update({"canopy_cover_pct": c["cover_pct"].tolist(), "canopy_height_m": (c["height_dm"] / 10).tolist(),
                     "canopy_base_m": (c["base_dm"] / 10).tolist(), "canopy_bulk_kgm3": (c["bulk_cg_m3"] / 100).tolist()})
    elif args.canopy_fill:
        raise SystemExit("--canopy-fill precisa das copas (fires/<id>/canopy.npz, canopy.py)")
    if args.adj_class:
        factor = {"herb": 1, "shrub": 2, "euc": 3, "forest": 4}   # fuel.json classes (build_fuel.py CLASSES)
        per = np.ones(len(legend))
        for item in args.adj_class.split(","):
            key, val = item.split("=")
            per[[i for i, l in enumerate(legend) if l["class"] == factor[key.strip()]]] = float(val)
        adj = np.round(np.clip(args.adj * per[idx], 0.1, 2.2), 3)   # ELMFIRE burns nothing from ~2.5 (README)
        base["adj"] = adj.tolist()
        notes.append(f"ajuste por classe: {args.adj_class}")
    elif args.adj != 1.0:
        base["adj"] = args.adj
    if args.spotting:
        extra.update(spotting=SPOTTING, seed=args.seed)
        if args.spotting_dynamic:
            pign = ignition_probability(weather_at(fire, start, list(np.arange(0, duration + 1, 30)), args), start)
            extra["spotting"] = {**SPOTTING, "PIGN_MIN": pign, "PIGN_MAX": pign}
            notes.append(f"projeções: probabilidade de ignição {pign:.0f} %")
        if args.spotting_dist_mult != 1.0 or args.spotting_embers != 1:
            sp = dict(extra["spotting"])
            for key in ("MEAN_SPOTTING_DIST_MIN", "MEAN_SPOTTING_DIST_MAX"):
                sp[key] = SPOTTING[key] * args.spotting_dist_mult
            sp["NEMBERS_MAX_LO"] = sp["NEMBERS_MAX_HI"] = args.spotting_embers
            extra["spotting"] = sp
            notes.append(f"projeções: distância ×{args.spotting_dist_mult:g}, até {args.spotting_embers} faúlhas")

    # barriers and stretches exactly as the API (api/runs.py)
    lines = json.loads(args.barriers.read_text())["barriers"] if args.barriers else []
    late = [b for b in lines if b.get("from_min", 0) >= duration]
    lines = [b for b in lines if b.get("from_min", 0) < duration]   # the API refuses lines that hold after the end
    if late:
        notes.append(f"{len(late)} linhas começam depois do fim e ficam de fora")
    # validated by the API's own model; a hindcast may run longer than the API's 48 h (Monchique 2018: 128 h)
    scenario = runs.Scenario(fire=args.fire, start_step=args.start_step,
                             duration_min=min(duration, runs.MAX_DURATION_MIN), decision={"barriers": [
                                 {k: b[k] for k in ("path", "width_m", "from_min") if k in b} for b in lines]})
    scenario = scenario.model_copy(update={"duration_min": duration})
    bars = [(b.from_min, fire.line(b.path, b.width_m)) for b in scenario.decision.barriers]
    wet_lines = []
    if args.wet_lines:
        for b in json.loads(args.wet_lines.read_text())["barriers"]:
            cover = line_cover(fire, b["path"], b.get("width_m", 0) or fire.cellsize / 3)
            drops = np.arange(b.get("from_min", 0), b.get("until_min", b.get("from_min", 0)) + 1e-6,
                              b.get("repeat_min") or 1e9)
            wet_lines.append((cover, drops - step["hours"] * 60 if args.start_step else drops))
        notes.append(f"{len(wet_lines)} linhas molhadas (secam com tau {args.wet_tau:g} min)")
    foci = [(*fire.point(q["lon"], q["lat"]), (q["hours"] - step["hours"]) * 60) for q in fire.meta["ignitions"]]
    foci = [f for f in foci if 0 < f[2] < duration]

    arrival = np.full((fire.rows, fire.cols), np.nan)
    burned = fire.perimeter(args.start_step)
    arrival[burned] = 0.0
    held = np.zeros_like(burned)
    if args.active_edge != "all":
        held, how = held_edge(fire, args, burned, ev, feats)
        notes.append(how)
    runtime, wall = 0.0, time.time()
    for t0, t1, times in runs.stretches(scenario):
        f = fuel.copy()
        for from_min, m in bars:
            if from_min <= t0:
                f[m] = fires.NONBURNABLE
        f[held] = fires.NONBURNABLE
        req = {"grid": fire.grid, "duration_min": t1 - t0,
               "ignitions": [{"x": x, "y": y, "t_min": t - t0} for x, y, t in foci if t0 <= t < t1],
               "burned": (burned & ~held).astype(np.uint8).tolist(),
               "weather": [{**{k: v for k, v in w.items() if k != "temp_c"}, "t_min": w["t_min"] - t0}
                           for w in wet(weather_at(fire, start, times, args), wet_lines, args.wet_tau)],
               "layers": {"fuel": f.tolist(), **base}, **extra}
        done = subprocess.run([str(args.engine)], input=json.dumps(req), text=True, capture_output=True)
        if done.returncode != 0:
            oom = " (137: o Docker matou o contentor, em regra por falta de memória)" if done.returncode == 137 else ""
            raise SystemExit(f"ELMFIRE falhou com o código {done.returncode}{oom}:\n{done.stderr[-2000:]}")
        res = json.loads(done.stdout)
        stretch = np.array([[np.nan if v is None else v for v in r] for r in res["arrival_min"]], float)
        new = np.isnan(arrival) & np.isfinite(stretch)
        arrival[new] = stretch[new] + t0
        burned = np.isfinite(arrival)
        runtime += res["runtime_s"]
    if np.isfinite(arrival).sum() <= fire.perimeter(args.start_step).sum():
        notes.append("AVISO: o fogo não saiu do ponto de partida (o ELMFIRE falha assim com espalhamento muito rápido)")

    stats = score(fire, arrival + step["hours"] * 60, feats, alert_offset_min(fire, ev),   # on step 0's clock
                  until_min=step["hours"] * 60 + duration)
    out = fire_dir(args.fire) / "runs" / args.name
    out.mkdir(parents=True, exist_ok=True)
    result = {"fire": args.fire, "name": args.name, "start": step["time"], "duration_min": duration,
              "options": {k: (rel(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
              "engine": f"ELMFIRE {res['version']} (engines/elmfire)", "platform": platform_info(),
              "barriers": len(lines),
              "stretches": len(runs.stretches(scenario)), "runtime_s": round(runtime, 1),
              "wall_s": round(time.time() - wall, 1), "notes": notes, "stats": stats}
    (out / "result.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
    raw = CACHE / args.fire
    raw.mkdir(parents=True, exist_ok=True)
    np.save(raw / f"{args.name}.npy", arrival.astype(np.float32))
    if args.preview:
        preview(out / "preview.png", fire, arrival,
                feats if args.scars else [f for f in feats if f["properties"]["kind"] != "scar"], lines)
    else:
        (out / "preview.png").unlink(missing_ok=True)
    by = {x["h"]: x for x in stats["by_hour"]}
    hs = [s["hours"] for s in fire.steps[1:]]
    sat = stats.get("satellite", {})
    print(f"{args.name}: " + ", ".join(f"{h:g} h {by[h]['run_ha']} ha (obs {by[h]['observed_ha']})" for h in hs if h in by)
          + f" | Sørensen último passo {stats['sorensen_last_step']}, oficial {stats.get('sorensen_official')}, fora "
            f"{stats.get('outside_official_ha')} ha | satélite {sat.get('mean_reached')} | {'; '.join(notes)}")
    return result


def held_edge(fire, args, p0: np.ndarray, ev: dict, feats: list) -> tuple[np.ndarray, str]:
    """The edge cells of the start perimeter that no longer burn (--active-edge), and a note. The edge is every cell of
    p0 with a neighbour outside it (8 around). Active: within reach of a hotspot (VIIRS 375 m, MODIS 1 km: the larger of
    500 m and the pixel, plus a cell) seen in the last --active-window-h hours before the start, outside the scars; or,
    with "oracle", within 2 cells of the observed growth to the next step. With no hotspot in the window the whole edge
    stays active (nothing is known)."""
    edge = p0 & ~ndimage.binary_erosion(p0, structure=np.ones((3, 3), bool))
    active = np.zeros_like(p0)
    if args.active_edge == "oracle":
        if args.start_step + 1 >= len(fire.steps):
            return np.zeros_like(p0), "borda ativa: sem passo seguinte, toda"
        grow = fire.perimeter(args.start_step + 1) & ~p0
        active = edge & ndimage.binary_dilation(grow, iterations=2)
        how = "borda ativa: onde o fogo observado cresceu (oráculo)"
    else:
        t_start = fire.steps[args.start_step]["hours"] * 60
        off = alert_offset_min(fire, ev)
        rows, cols = np.indices(p0.shape)
        n = 0
        for f in feats:
            q = f["properties"]
            if q["kind"] != "hotspot" or q.get("in_scar"):
                continue
            t = q["hours_after_alert"] * 60 + off
            if not t_start - args.active_window_h * 60 <= t <= t_start:
                continue
            x, y = fire.point(*f["geometry"]["coordinates"])
            c = (x - fire.grid["xmin"]) / fire.cellsize
            r = (fire.grid["ymin"] + fire.rows * fire.cellsize - y) / fire.cellsize
            rad = max(500.0, q.get("pixel_m", 375)) / fire.cellsize + 1
            r0, r1 = int(max(r - rad, 0)), int(min(r + rad + 1, fire.rows))
            c0, c1 = int(max(c - rad, 0)), int(min(c + rad + 1, fire.cols))
            if r0 >= r1 or c0 >= c1:
                continue
            near = (rows[r0:r1, c0:c1] - r) ** 2 + (cols[r0:r1, c0:c1] - c) ** 2 <= rad * rad
            active[r0:r1, c0:c1] |= near
            n += 1
        if not (edge & active).any():
            return np.zeros_like(p0), f"borda ativa: sem focos perto do perímetro nas {args.active_window_h:g} h antes, toda"
        active &= edge
        how = f"borda ativa: {n} focos de satélite nas {args.active_window_h:g} h antes"
    held = edge & ~active
    return held, f"{how}; {held.sum() / max(1, edge.sum()):.0%} da borda segura"


def canopy_fill(fire, c: dict, idx: np.ndarray, feats: list) -> tuple[dict, float]:
    """canopy.npz with each cell inside the burned area (the official perimeter and the observed steps) set to the
    median of its COS class over the cells outside it and outside the scars, array by array (base and bulk are a
    class's factor times height and cover, so the medians stay consistent). Also returns the area filled, ha."""
    burned = np.isfinite(observed_arrival(fire))
    off = official(feats)
    if off is not None:
        burned |= cells(fire, off)
    scar = np.zeros_like(burned)
    for f in feats:
        if f["properties"]["kind"] == "scar":
            scar |= cells(fire, shape(f["geometry"]))
    c = {k: v.copy() for k, v in c.items()}
    for i in np.unique(idx[burned]):
        ref = (idx == i) & ~burned & ~scar
        if ref.any():
            for v in c.values():
                v[(idx == i) & burned] = np.median(v[ref])
    return c, float(burned.sum()) * fire.cellsize ** 2 / 1e4


def platform_info() -> dict:
    """The machine and the ELMFIRE image a run ran on: with spotting, the same seed gives the same run on one machine
    but not across machines (Sørensen about ±0.015 apart)."""
    env = HERE.parent / "engines" / "elmfire" / "env.sh"
    image = subprocess.run(["bash", "-c", f'. "{env}" && printf %s "$ELMFIRE_IMAGE"'], capture_output=True,
                           text=True).stdout
    found = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", image],
                           capture_output=True, text=True).stdout.split()
    return {"machine": platform.machine(), "system": f"{platform.system()} {platform.release()}", "image": image,
            "image_id": found[0][:19] if found else None, "image_platform": found[1] if len(found) > 1 else None}


def rel(path: Path) -> str:
    """A path as written in result.json: relative to the repo when it is inside it."""
    try:
        return str(path.resolve().relative_to(HERE.parent))
    except ValueError:
        return str(path)


def preview(path: Path, fire, arrival: np.ndarray, feats: list, lines: list, zoom: int = 2):
    h = np.clip(np.nan_to_num(arrival / 60, nan=-1), -1, 48)
    vis = np.zeros(h.shape + (3,), np.uint8) + 30
    b = h >= 0
    vis[b] = np.stack([255 - h[b] * 6, 200 - h[b] * 7, 40 + h[b] * 2], -1).clip(0, 255).astype(np.uint8)
    obs = np.isfinite(observed_arrival(fire))
    edge = obs & ~(np.roll(obs, 1, 0) & np.roll(obs, -1, 0) & np.roll(obs, 1, 1) & np.roll(obs, -1, 1))
    vis[edge] = (80, 140, 255)
    img = Image.fromarray(vis).resize((fire.cols * zoom, fire.rows * zoom), Image.NEAREST)
    d = ImageDraw.Draw(img, "RGBA")
    top = fire.grid["ymin"] + fire.rows * fire.cellsize

    def px(lon, lat):
        x, y = fire.point(lon, lat)
        return ((x - fire.grid["xmin"]) / fire.cellsize * zoom, (top - y) / fire.cellsize * zoom)

    for f in feats:
        k = f["properties"]["kind"]
        if k in ("scar", "perimeter"):
            g = shape(f["geometry"])
            for poly in getattr(g, "geoms", [g]):
                pts = [px(*c) for c in poly.exterior.coords]
                if k == "scar":
                    d.polygon(pts, fill=(255, 0, 0, 90), outline=(255, 70, 70, 255))
                else:
                    d.line(pts + [pts[0]], fill=(0, 255, 255, 220), width=1)
    for b in lines:
        pts = [px(*q) for q in b["path"]]
        d.line(pts, fill=(255, 255, 255), width=3)
        d.text((pts[0][0] + 3, pts[0][1] - 10), f"{b['from_min'] / 60:.0f}h", fill=(255, 255, 255))
    img.save(path)


if __name__ == "__main__":
    main()
