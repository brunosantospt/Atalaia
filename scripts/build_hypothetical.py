"""Build the demo's one fire: a hypothetical fire at Monte da Penha (Guimarães), with a wind shift.

    scripts/.venv/bin/python -I scripts/build_hypothetical.py [--grid-km 27] [--wind-mult 1.6] [--dead-1h-pct 3.5] ...

Nothing burned here: the fire is the one the UE render tells (FireRenderer's Penha package,
data/simfire/penha_2024-09-16: ignition and start, 16 Sep 2024 10:00, and the IFS weather), on a
larger 30 m grid than the render's, under the IFS weather of that day with SYNTHETIC tuning to
the September 2024 mega-fires (Paredes, 17 Sep 2024, PT-FireSprd v2, read for its order of
magnitude only): the wind scaled by --wind-mult, a wind shift between 12:00 and 13:00, very dry
dead fuels, Portuguese fuel models and spotting in ELMFIRE. Writes:

    web/public/fires/<id>/grid.json, fuel.*, elevation.f32, slope.u8, aspect.u16, terrain.json
                                               built for --grid-km by build_fuel.py and build_terrain.py
    web/public/fires/<id>/weather.json         hourly, local time, the shift injected
    web/public/fires/<id>/progression.geojson  perimeter and new area per step
    web/public/fires/<id>/fire.json            as build_fires.py, plus `simulated` and `windShift`
    web/public/fires/<id>/osm.json             through fetch_osm.py (once) and build_osm.py
    web/public/fires/index.json                this fire only: the demo shows one

With no observed spread, the steps the story plays are ELMFIRE's (scripts/elmfire_pt in Docker: engines/elmfire plus Portuguese fuels, typical canopy and spotting;
moistures from temperature and humidity less --dry) with nobody on the fire. Only the wind (--wind-mult) is baked into
weather.json and the dry farmland into fuel.json; the canopy, the PT fuel models, the drier fuels and the spotting live
only in this reference, so the web's fast model and the API's re-plans run a tamer fire.
--model fast uses the browser's fast model instead (web/src/fastModel.ts, run by Node through
scripts/fastmodel/free_run.ts), which spreads this fire some 5x faster in its eucalyptus;
--compare records the other model's areas in windShift.compare. Steps are hourly through the 6 h decision window, then at 9 and 12 h, and further
only while the fire stays off the grid's edge, and never past --cap-ha (default 2000 ha): the last step is the
first at or above it, at the minute the reference gets there (fire.json referenceCapHa/referenceCapMin; the
villages and windShift still read the whole run). The ignition is --ign-lat/--ign-lon (Monte da Penha, near the top);
fire.json `engine` holds the reference's settings for the API (api/runs.py). Each perimeter is the cells reached by then, smoothed
a little and joined with the previous one, so they only grow; areas are counted in cells. The same
run under the observed wind gives windShift.noShift.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely import geometry, ops

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "data/simfire/penha_2024-09-16"  # symlink to FireRenderer/data/simfire/penha_2024-09-16: start, ignition, IFS weather
CACHE = ROOT / "data/hypothetical"
OUT = ROOT / "web/public/fires"
FAST = ROOT / "scripts/fastmodel"
ELMFIRE = ROOT / "scripts/elmfire_pt/run.sh"  # engines/elmfire plus fuel_models, spotting and seed (from hindcast/engine)
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts/elmfire_pt"))
import build_grid  # noqa: E402
import fuels as pt_fuels  # noqa: E402

FIRE_ID = "Penha_Guimaraes_hipotetico"
NAME = "Penha, Guimarães (simulado)"
PARISH = "Mesão Frio"  # Nominatim, at the ignition
LAYERS = ("grid.json", "fuel.json", "fuel.u8", "elevation.f32", "slope.u8", "aspect.u16", "terrain.json")
CELL_M = 30
# Canopy by fuel class (eucalyptus, pinhal e folhosas; none elsewhere): typical stand values, not measured
# (no LiDAR canopy here). Cover %, height m, base m, bulk density kg/m3. They let ELMFIRE crown.
CANOPY = {"canopy_cover_pct": (70, 65), "canopy_height_m": (20, 15), "canopy_base_m": (3, 3), "canopy_bulk_kgm3": (0.15, 0.10)}
# ELMFIRE's forecast template for &SPOTTING (as hindcast/run.py), each range at its middle
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

TIME = "%Y-%m-%dT%H:%M"
RUN_MIN = 24 * 60
STEP_HOURS = [0, 1, 2, 3, 4, 5, 6, 9, 12, 18, 24]  # cut at the first one that touches the grid edge
WINDOW_MIN = 360  # the app's decision window (main.ts DECISION_MIN)
IGNITION_R_M = 45  # step 0: a disc around the ignition that holds its cell centre (api/runs.py)
SMOOTH_M = 15  # half a cell: takes the staircase off the cell outlines
SIMPLIFY_M = 15.0  # perimeters are simplified to this (was 4 m): fewer rings and vertices for the browser
PLACE_RADIUS_M = 250  # a village is reached when the fire gets this close (osm.ts)
HOMES_NEAR_M = 100  # homes this close to the front: OSM puts them in non-burnable cells

# The shift: hourly values that replace the observed ones (from °, km/h). 12:00 stays observed
# (89°, 22.7 km/h), so both readers (fastModel.ts, api/fires.py) turn the wind linearly through
# 12:00-13:00, the short way: 114° anticlockwise, through the north-east. A dry nortada sets in and
# holds the afternoon, then eases and veers back to the observed light easterly by 22:00.
SHIFT_FROM, SHIFT_TO = "2024-09-16T12:00", "2024-09-16T13:00"
SHIFTED = {
    "2024-09-16T13:00": (335, 65.0),
    "2024-09-16T14:00": (335, 62.0),
    "2024-09-16T15:00": (338, 56.0),
    "2024-09-16T16:00": (340, 48.0),
    "2024-09-16T17:00": (340, 38.0),
    "2024-09-16T18:00": (345, 28.0),
    "2024-09-16T19:00": (0, 18.0),
    "2024-09-16T20:00": (25, 12.0),
    "2024-09-16T21:00": (55, 8.0),
}
# The tuning: defaults reproduce the shipped fire (see fire.json source and windShift.note).
GRID_KM, CENTRE_E_KM, CENTRE_N_KM = 27.0, 0.0, 0.0
WIND_MULT = 2.0  # the IFS 9 km wind is ~half the gusty wind of the real 15-17 Sep 2024 fires
DRY = 3.0  # points off the Simard equilibrium moisture: dead 1 h of 2-3 % at RH 15-25 %, as 15-17 Sep 2024
DEAD_FLOOR = 2.0
FARMLAND_FUEL = 102  # S&B GR2 for COS 2.1.1.1 (dry fallow and stubble in September); 0 keeps it non-burnable
SEED = 2
CAP_HA = 2000.0  # the reference stops at the first step at or above this area; the web stops simulated runs there too
# Monte da Penha, near the top: 41°25'42.8"N 8°16'17.4"W (the scenario's ignition; the UE package's is ~2 km east)
IGN_LAT, IGN_LON = 41.428556, -8.2715
GUST_FACTOR = 1.4  # gust/mean: the observed afternoon has ~2.0, a steadier flow a little less

PTTM06 = CRS.from_epsg(3763)
TO_WGS84 = Transformer.from_crs(PTTM06, CRS.from_epsg(4326), always_xy=True)
TO_TM06 = Transformer.from_crs(CRS.from_epsg(4326), PTTM06, always_xy=True)
HA = 10_000
MIN_PART_HA = 0.5  # spotting specks under this are not drawn
MIN_EDGE_M = 0.5  # Cesium cannot draw a zero-length ground-polyline segment

SOURCE = {
    "dataset": "Incêndio hipotético na Penha (Guimarães): não aconteceu",
    "data": "Incêndio simulado na Penha, Guimarães ({model_pt}, sem combate), calibrado para a ordem de grandeza do incêndio de Paredes, 17 set 2024 (PT-FireSprd v2, uso interno). Meteorologia de 16/09/2024 (ECMWF IFS 9 km via Open-Meteo) com o vento multiplicado por {wind_mult}, combustíveis muito secos e uma rotação do vento sintética às 12h-13h",
    "cite": "Paisagem: COS2015 v2, DGT (CC BY 4.0), e Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA); meteorologia ECMWF IFS via Open-Meteo (CC BY 4.0)",
    "fire": "hypothetical: the ignition and start of the UE render's Penha fire (FireRenderer scenarios/penha_elmfire); no observed spread exists",
    "weather": "ECMWF IFS analysis of 16 Sep 2024 at the 9 km cell over Penha: temperature and humidity as is; wind and gusts x {wind_mult} (synthetic, tuned); the wind from 13:00 to 21:00 is wholly synthetic",
    "windShift": "synthetic, injected for the demo, not observed: the easterly backs to NNW between 12:00 and 13:00",
    "calibration": "calibrado para a ordem de grandeza do incêndio de Paredes, 17 set 2024 (PT-FireSprd v2, uso interno): áreas por período e velocidades lidas localmente, nenhuma geometria usada nem copiada. Ajustes sintéticos: {tuning}",
    "steps": "simulated, not observed: {model} under that weather (scripts/build_hypothetical.py)",
}


def iso(t):
    return t.strftime(TIME)


def parse(text):
    return datetime.strptime(text, TIME)


# ---------- weather ----------


def scaled_weather(ifs, wind_mult):
    """The IFS series with its wind and gusts scaled by wind_mult. Baked into weather.json: the fast
    model and the API read that file, so ELMFIRE and the web see the same wind."""
    w = json.loads(json.dumps(ifs))
    w["windKmh"] = [round(v * wind_mult, 1) for v in ifs["windKmh"]]
    w["gustKmh"] = [round(v * wind_mult, 1) for v in ifs["gustKmh"]]
    return w


def shifted_weather(observed, wind_mult):
    """The scaled series with the shift's hours replaced by SHIFTED (final values, not scaled)."""
    w = json.loads(json.dumps(observed))
    for t, (deg, kmh) in SHIFTED.items():
        i = w["time"].index(t)
        w["windFromDeg"][i], w["windKmh"][i] = deg, kmh
        w["gustKmh"][i] = round(max(kmh * GUST_FACTOR, observed["gustKmh"][i]), 1)
    w["source"] = {
        **observed["source"],
        "synthetic": f"windKmh and gustKmh are the IFS values x {wind_mult} (tuned to the Sep 2024 mega-fires); windKmh, windFromDeg and gustKmh from {min(SHIFTED)} to {max(SHIFTED)} are invented for the demo (a wind shift); temperature, humidity and precipitation are the IFS analysis",
        "windMult": wind_mult,
    }
    w["utcOffsetH"] = 1.0
    w["notes"] = (
        "Valores instantâneos em cada hora: vento a 10 m, temperatura e humidade relativa a 2 m. A precipitação é a acumulada na hora anterior. "
        "windFromDeg é de onde o vento vem. O vento (velocidade e rajada) é o do IFS multiplicado por " + str(wind_mult) + " e o das 13:00 às 21:00 de 16/09 é sintético (rotação para NNO às 12h-13h); a temperatura e a humidade são as observadas."
    )
    return w


# ---------- models ----------


def fast_run(folder, weather, start, ignition, g):
    """The browser's fast model, free run: arrival minute per cell, inf where it does not get."""
    with tempfile.TemporaryDirectory() as tmp:
        wpath, out = Path(tmp) / "weather.json", Path(tmp) / "arrival.f32"
        wpath.write_text(json.dumps(weather))
        args = [str(folder), str(wpath), iso(start), str(ignition["lon"]), str(ignition["lat"]), str(RUN_MIN), str(out)]
        subprocess.run(["node", "--import", str(FAST / "register.mjs"), str(FAST / "free_run.ts"), *args], check=True, cwd=ROOT)
        return np.fromfile(out, dtype="<f4").reshape(g["rows"], g["cols"]).astype(float)


def emc_pct(temp_c, rh):
    """Equilibrium moisture of fine dead fuel (%), Simard (1968) as NFDRS uses it, as the UE run."""
    t = temp_c * 9 / 5 + 32
    if rh < 10:
        return 0.03229 + 0.281073 * rh - 0.000578 * rh * t
    if rh < 50:
        return 2.22749 + 0.160107 * rh - 0.01478 * t
    return 21.0606 + 0.005565 * rh**2 - 0.00035 * rh * t - 0.483199 * rh


def elmfire_run(weather, start, ignition, g, folder, opts):
    """ELMFIRE through scripts/elmfire_pt (Docker), typical canopy; Portuguese fuel models, spotting; dead 1 h
    moisture from the hourly temperature and humidity less opts.dry points (floor opts.dead_floor), live
    30/70 %. Cached by request in data/hypothetical/."""
    rows, cols = g["rows"], g["cols"]
    legend = json.loads((folder / "fuel.json").read_text())["legend"]
    codes = pt_fuels.codes(legend, opts.shrub) if opts.fuels == "pt" else np.array([e["scottBurgan"] for e in legend], dtype=np.int16)
    read = lambda name, dt: np.fromfile(folder / name, dtype=dt).reshape(rows, cols)  # noqa: E731
    if opts.farmland_fuel:  # temporary crops (COS 2.1.1.1) as dry stubble and fallow after the harvest
        codes = np.where([e["cos"] == "2.1.1.1" for e in legend], opts.farmland_fuel, codes).astype(np.int16)
    minutes = np.arange(0, RUN_MIN + 1, 30)
    hours = np.array([(parse(t) - start).total_seconds() / 60 for t in weather["time"]])
    temp, rh = np.interp(minutes, hours, weather["tempC"]), np.interp(minutes, hours, weather["rhPct"])
    speed = np.interp(minutes, hours, weather["windKmh"])
    wfrom = np.degrees(np.interp(minutes, hours, np.unwrap(np.radians(weather["windFromDeg"])))) % 360
    moments = []
    for t, tc, h, s, d in zip(minutes, temp, rh, speed, wfrom):
        m1 = max(opts.dead_floor, emc_pct(tc, h) - opts.dry)
        moments.append({
            "t_min": float(t), "wind_kmh": round(float(s), 2), "wind_from_deg": round(float(d), 1),
            "dead_1h_pct": round(m1, 1), "dead_10h_pct": round(m1 + 1.5, 1), "dead_100h_pct": round(m1 + 3.0, 1),
            "live_herb_pct": opts.live_herb, "live_woody_pct": opts.live_woody,
        })
    x, y = TO_TM06.transform(ignition["lon"], ignition["lat"])
    request = {
        "grid": {k: g[k] for k in ("cols", "rows", "cellsize", "xmin", "ymin", "srs")},
        "duration_min": RUN_MIN,
        # a plus of five cells (inside step 0's disc): a single cell often fizzles out in ELMFIRE with spotting on
        "ignitions": [{"x": x + dx, "y": y + dy, "t_min": 0} for dx, dy in ((0, 0), (30, 0), (-30, 0), (0, 30), (0, -30))],
        "weather": moments,
        "layers": {
            "fuel": codes[read("fuel.u8", "u1")].tolist(),
            "elevation_m": np.round(read("elevation.f32", "<f4"), 1).tolist(),
            "slope_deg": read("slope.u8", "u1").tolist(),
            "aspect_deg": read("aspect.u16", "<u2").tolist(),
        },
    }
    if opts.canopy:
        cls = np.array([e["class"] for e in legend])[read("fuel.u8", "u1")]
        for layer, (euc, forest) in CANOPY.items():
            request["layers"][layer] = np.select([cls == 3, cls == 4], [euc, forest], 0).tolist()
    if opts.adj != 1.0:
        request["layers"]["adj"] = opts.adj
    if opts.fuels == "pt":
        request["fuel_models"] = pt_fuels.elmfire_rows()
    if opts.spotting:
        request.update(spotting=SPOTTING, seed=opts.seed)
    body = json.dumps(request, separators=(",", ":"))
    key = hashlib.sha256(body.encode() + ELMFIRE.with_name("adapter.py").read_bytes()
                         + (ROOT / "engines/elmfire/adapter.py").read_bytes()).hexdigest()[:16]
    cached = CACHE / f"{FIRE_ID}_elmfire_{key}.npy"
    if not cached.exists():
        done = subprocess.run([str(ELMFIRE)], input=body, capture_output=True, text=True)
        if done.returncode:
            sys.stderr.write(done.stderr[-4000:])
            raise SystemExit(f"ELMFIRE failed ({done.returncode})")
        CACHE.mkdir(parents=True, exist_ok=True)
        np.save(cached, np.array(json.loads(done.stdout)["arrival_min"], dtype=float))
    return np.nan_to_num(np.load(cached), nan=np.inf)


# ---------- geometry ----------


def cells_shape(mask, g):
    """The cells of a mask as one shape in PT-TM06: a box per run of cells along each row."""
    boxes = []
    cs, top = g["cellsize"], g["ymin"] + g["rows"] * g["cellsize"]
    for r in np.flatnonzero(mask.any(axis=1)):
        row = np.concatenate([[0], mask[r].astype(np.int8), [0]])
        edges = np.flatnonzero(np.diff(row))
        for c0, c1 in zip(edges[::2], edges[1::2]):
            boxes.append(geometry.box(g["xmin"] + c0 * cs, top - (r + 1) * cs, g["xmin"] + c1 * cs, top - r * cs))
    return shapely.union_all(boxes)


def clean(shape):
    shape = shapely.make_valid(shape)
    parts = [p for p in getattr(shape, "geoms", [shape]) if isinstance(p, geometry.Polygon) and p.area >= 0.05 * HA]
    return geometry.MultiPolygon(parts)


def reproject(shape, transformer):
    return shapely.transform(shape, lambda xy: np.column_stack(transformer.transform(xy[:, 0], xy[:, 1])))


def lonlat(x, y):
    lon, lat = TO_WGS84.transform(x, y)
    return {"lon": round(lon, 6), "lat": round(lat, 6)}


def bbox(shape):
    w, s, e, n = reproject(shape, TO_WGS84).bounds
    return [round(w, 6), round(s, 6), round(e, 6), round(n, 6)]


def rounded(coords, nd=6):
    if isinstance(coords[0], (int, float)):
        return [round(c, nd) for c in coords]
    return [rounded(c, nd) for c in coords]


def dedupe_ring(ring):
    """A closed lon/lat ring without consecutive vertices closer than MIN_EDGE_M; None under 3 distinct."""
    def near(p, q):
        return np.hypot((q[0] - p[0]) * 111_320 * np.cos(np.radians(p[1])), (q[1] - p[1]) * 110_540) < MIN_EDGE_M
    out = []
    for p in ring[:-1]:
        if not out or not near(out[-1], p):
            out.append(p)
    while len(out) > 1 and near(out[-1], out[0]):
        out.pop()
    return out + [out[0]] if len(out) >= 3 else None


def to_geojson(shape):
    # Parts under MIN_PART_HA go (in PT-TM06, where the area is in metres); simplified before the union, so steps nest.
    parts = [p for p in getattr(shape, "geoms", [shape]) if p.area >= MIN_PART_HA * HA]
    polys = []
    for part in parts:
        rings = [dedupe_ring(r) for r in geometry.mapping(reproject(part, TO_WGS84))["coordinates"]]
        if rings[0]:
            polys.append([r for r in rings if r])
    return {"type": "MultiPolygon", "coordinates": rounded(polys)}


def bearing(a, b):
    return round(float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360))


def centres(g):
    xs = g["xmin"] + (np.arange(g["cols"]) + 0.5) * g["cellsize"]
    ys = g["ymin"] + (g["rows"] - np.arange(g["rows"]) - 0.5) * g["cellsize"]
    return np.meshgrid(xs, ys)


def dilate(mask, cells):
    out = mask.copy()
    for dr in range(-cells, cells + 1):
        for dc in range(-cells, cells + 1):
            if dr * dr + dc * dc <= cells * cells:
                out |= np.roll(np.roll(mask, dr, axis=0), dc, axis=1)
    return out


def head(arrival, g, ign_xy, t0, t1):
    """Where the head went from minute t0 to t1: the bearing from what had burned at t0 (the
    ignition at 0) to the cell reached by t1 that is furthest from it."""
    xs, ys = centres(g)
    before = cells_shape(arrival <= t0, g) if t0 > 0 else geometry.Point(ign_xy)
    new = (arrival <= t1) & ~(arrival <= t0)
    pts = shapely.points(xs[new], ys[new])
    j = int(np.argmax(shapely.distance(before, pts)))
    foot = ops.nearest_points(before, pts[j])[0]
    return bearing((foot.x, foot.y), (pts[j].x, pts[j].y))


# ---------- the build ----------


class Exposure:
    """Villages and homes the OSM context puts near the fire, as the 6 h report counts them."""

    def __init__(self, osm, g):
        self.g = g
        self.xs, self.ys = centres(g)
        self.homes = np.zeros((g["rows"], g["cols"]), dtype=np.int32)
        for lon, lat, home in osm["buildings"]:
            x, y = TO_TM06.transform(lon, lat)
            c, r = int((x - g["xmin"]) // g["cellsize"]), g["rows"] - 1 - int((y - g["ymin"]) // g["cellsize"])
            if home and 0 <= c < g["cols"] and 0 <= r < g["rows"]:
                self.homes[r, c] += 1
        self.places = []
        for p in osm["places"]:
            x, y = TO_TM06.transform(p["lon"], p["lat"])
            self.places.append((p, np.hypot(self.xs - x, self.ys - y) <= PLACE_RADIUS_M))

    def homes_near(self, arrival, minute):
        return int(self.homes[dilate(arrival <= minute, round(HOMES_NEAR_M / self.g["cellsize"]))].sum())

    def villages(self, arrival, until):
        out = {}
        for p, cells in self.places:
            t = float(arrival[cells].min()) if cells.any() else np.inf
            if t <= until:
                out[p["name"]] = (p, round(t))
        return out


MODELS = {
    "elmfire": "ELMFIRE 2025.0717 (scripts/elmfire_pt: engines/elmfire with Portuguese fuel models, typical canopy and spotting), no suppression",
    "fast": "web/src/fastModel.ts, free run, no suppression",
}

MODEL_PT = {"elmfire": "ELMFIRE", "fast": "modelo rápido do Atalaia"}


def make_grid(ign, grid_km, centre_shift_m):
    """A square grid of grid_km centred on the ignition (moved by centre_shift_m east, north), in the
    keys of build_grid.py."""
    x, y = TO_TM06.transform(ign["lon"], ign["lat"])
    cols = int(round(grid_km * 1000 / CELL_M))
    xmin = np.floor((x + centre_shift_m[0] - cols * CELL_M / 2) / CELL_M) * CELL_M
    ymin = np.floor((y + centre_shift_m[1] - cols * CELL_M / 2) / CELL_M) * CELL_M
    xmax, ymax = xmin + cols * CELL_M, ymin + cols * CELL_M
    corners = {k: build_grid.TO_WGS84.transform(a, b) for k, (a, b) in
               {"sw": (xmin, ymin), "se": (xmax, ymin), "ne": (xmax, ymax), "nw": (xmin, ymax)}.items()}
    # build_grid.py allows a quarter cell; a grid this size bows by ~13 m at 27 km, which only moves the
    # drawing on the globe (web/src/grid.ts says <= 30 m is fine): the engines and the scores stay in PT-TM06.
    err = build_grid.corner_error(corners, xmin, ymin, xmax, ymax)
    if err > CELL_M / 2:
        raise SystemExit(f"the grid is too large for the corner interpolation ({err:.1f} m)")
    return {"cols": cols, "rows": cols, "cellsize": CELL_M, "xmin": float(xmin), "ymin": float(ymin), "srs": "EPSG:3763",
            "wgs84": {k: [round(lon, 7), round(lat, 7)] for k, (lon, lat) in corners.items()}}


def make_layers(folder, g):
    """grid.json, fuel and terrain for the grid, by the usual scripts; skipped when the grid is unchanged."""
    path = folder / "grid.json"
    text = json.dumps(g, indent=2) + "\n"
    if path.exists() and path.read_text() == text and all((folder / n).exists() for n in LAYERS):
        return
    path.write_text(text)
    py = [sys.executable, "-I"]
    subprocess.run([*py, str(ROOT / "scripts/fetch_dem.py"), FIRE_ID], check=True)
    subprocess.run([*py, str(ROOT / "scripts/build_fuel.py"), FIRE_ID], check=True)
    subprocess.run([*py, str(ROOT / "scripts/build_terrain.py"), FIRE_ID], check=True)
    (ROOT / "data/osm" / f"{FIRE_ID}.json").unlink(missing_ok=True)  # the OSM answer is per grid


def farmland_legend(folder, code):
    """Make fuel.json say what the reference burns, so the map, the fast model and the API agree: temporary
    crops (COS 2.1.1.1) as dry fallow, herbaceous class, the given S&B code (0 leaves the legend as built)."""
    path = folder / "fuel.json"
    fuel = json.loads(path.read_text())
    names = {101: "GR1", 102: "GR2", 121: "GS1", 122: "GS2"}
    for e in fuel["legend"]:
        if e["cos"] == "2.1.1.1" and code:
            e.update({"class": 1, "scottBurgan": code, "scottBurganName": names.get(code, f"S&B {code}"),
                      "why": "pousio e restolho secos em setembro de seca, não regados: erva seca (afinação sintética do incêndio hipotético, build_hypothetical.py)"})
    path.write_text(json.dumps(fuel, ensure_ascii=False, indent=2) + "\n")


def build(model, compare, opts):
    folder = OUT / FIRE_ID
    folder.mkdir(parents=True, exist_ok=True)
    package = json.loads((PACKAGE / "fire.json").read_text())
    ign = {"lon": opts.ign_lon, "lat": opts.ign_lat}
    g = make_grid(ign, opts.grid_km, (opts.centre_east_km * 1000, opts.centre_north_km * 1000))
    (OUT / "index.json").write_text("[]\n") if not (OUT / "index.json").exists() else None
    make_layers(folder, g)
    farmland_legend(folder, opts.farmland_fuel)
    rows, cols, cs = g["rows"], g["cols"], g["cellsize"]
    cell_ha = cs * cs / HA
    start = parse(package["start"])
    ign_xy = TO_TM06.transform(ign["lon"], ign["lat"])

    observed = scaled_weather(json.loads((PACKAGE / "weather.json").read_text()), opts.wind_mult)  # no shift
    weather = shifted_weather(observed, opts.wind_mult)
    if parse(weather["time"][-1]) < start + timedelta(minutes=RUN_MIN):
        raise SystemExit("weather.json ends before the run does")
    (folder / "weather.json").write_text(json.dumps(weather, ensure_ascii=False, separators=(",", ":")) + "\n")

    runs = {"elmfire": lambda w, *a: elmfire_run(w, *a, folder, opts), "fast": lambda w, *a: fast_run(folder, w, *a)}
    arrival, baseline = (runs[model](w, start, ign, g) for w in (weather, observed))
    exposure = Exposure(build_osm(folder), g)

    # The steps, up to the last one whose perimeter stays off the grid's edge.
    edge = np.concatenate([arrival[0], arrival[-1], arrival[:, 0], arrival[:, -1]])
    edge_min = float(edge.min())
    full_hours = [h for h in STEP_HOURS if h * 60 < edge_min]
    # The minute the reference first holds CAP_HA (cells counted, whole minute). The steps are the usual ones
    # before it plus one at that minute, so the last step is the first at or above the cap: ~CAP_HA, not
    # whatever the next coarse step (9, 12, 18 h) would give.
    arrived = np.sort(arrival[np.isfinite(arrival)])
    need = int(np.ceil(opts.cap_ha / cell_ha))
    cap_min = int(np.ceil(arrived[need - 1])) if len(arrived) >= need else None
    if cap_min is not None and cap_min > full_hours[-1] * 60:
        cap_min = None
    step_hours = full_hours if cap_min is None else [h for h in full_hours if h * 60 < cap_min] + [cap_min / 60]
    if edge_min <= RUN_MIN:
        print(f"the fire reaches the grid edge at T+{edge_min:.0f} min: steps end at T+{step_hours[-1]} h")

    xs, ys = centres(g)
    disc = geometry.Point(ign_xy).buffer(IGNITION_R_M)
    features, steps, periods = [], [], []
    prev_shape, prev_mask = None, np.zeros((rows, cols), dtype=bool)
    for k, h in enumerate(step_hours):
        t = start + timedelta(hours=h)
        if k == 0:
            shape, mask = clean(disc), shapely.contains_xy(disc, xs, ys)
            area = round(disc.area / HA, 1)
        else:
            mask = (arrival <= h * 60 + 1e-6) | prev_mask
            shape = cells_shape(mask, g).buffer(SMOOTH_M).buffer(-SMOOTH_M)
            shape = clean(shapely.union(shape.simplify(SIMPLIFY_M, preserve_topology=True), prev_shape))
            area = round(mask.sum() * cell_ha, 1)
        added = shape if prev_shape is None else clean(shape.difference(prev_shape))
        added_ha = round(area - (steps[-1]["areaHa"] if steps else 0), 1)
        props = {"step": k, "time": iso(t), "hours": float(h)}
        features.append({"type": "Feature", "properties": {"kind": "perimeter", **props, "areaHa": area}, "geometry": to_geojson(shape)})
        features.append({"type": "Feature", "properties": {"kind": "increment", **props, "areaHa": added_ha}, "geometry": to_geojson(added)})
        new = mask & ~prev_mask
        center = lonlat(float(xs[new].mean()), float(ys[new].mean())) if k and new.any() else lonlat(*ign_xy)
        steps.append({**props, "areaHa": area, "addedHa": added_ha, "period": k or None, "center": center, "bbox": bbox(shape)})
        if k:
            # The head: the new cell furthest from what had burned, its distance over the step's hours.
            dh = h - step_hours[k - 1]
            ros, toward = 0.0, None
            if new.any():
                pts = shapely.points(xs[new], ys[new])
                far = shapely.distance(prev_shape, pts)
                j = int(np.argmax(far))
                foot = ops.nearest_points(prev_shape, pts[j])[0]
                ros, toward = float(far[j]) / dh, bearing((foot.x, foot.y), (float(xs[new][j]), float(ys[new][j])))
            periods.append({
                "period": k, "start": iso(start + timedelta(hours=step_hours[k - 1])), "end": iso(t), "durationH": float(dh),
                "areaHa": added_ha, "growthHaPerH": round(added_ha / dh, 1), "rosMPerH": round(ros), "maxRosMPerH": round(ros),
                "spreadTowardDeg": toward, "intensityKWPerM": None,
            })
        prev_shape, prev_mask = shape, mask

    # ---- the shift, for the alert and the re-plan ----
    i_from, i_to = weather["time"].index(SHIFT_FROM), weather["time"].index(SHIFT_TO)
    m_from, m_to = ((parse(x) - start).total_seconds() / 60 for x in (SHIFT_FROM, SHIFT_TO))
    until = full_hours[-1] * 60  # villages and the no-shift area read the whole run, not just the capped steps
    hit, hit_base = exposure.villages(arrival, until), exposure.villages(baseline, until)
    villages = sorted(
        ({"name": n, "kind": p["kind"], "lon": p["lon"], "lat": p["lat"], "minutes": m, "noShiftMinutes": hit_base.get(n, (None, None))[1]}
         for n, (p, m) in hit.items()),
        key=lambda v: v["minutes"],
    )
    villages_in6 = [v for v in villages if v["minutes"] <= WINDOW_MIN]
    base_in6 = [n for n, (_, m) in hit_base.items() if m <= WINDOW_MIN]
    # the places the shift newly threatens: reached after it, and later or never without it
    first = [v["name"] for v in villages if v["minutes"] > m_to and v["kind"] != "hamlet" and (v["noShiftMinutes"] is None or v["noShiftMinutes"] > v["minutes"])][:3]
    mid = (m_from + m_to) / 2
    head_before, head_after = head(arrival, g, ign_xy, 0, mid), head(arrival, g, ign_xy, mid, WINDOW_MIN)

    def summary(a, minute):
        return {"areaHa": round(float((a <= minute).sum()) * cell_ha, 1), "homesWithin100m": exposure.homes_near(a, minute)}

    wind_shift = {
        "time": iso(start + timedelta(minutes=mid)),
        "minutes": round(mid),
        "window": {"from": SHIFT_FROM, "to": SHIFT_TO, "minutes": [round(m_from), round(m_to)]},
        "fromDeg": [weather["windFromDeg"][i_from], weather["windFromDeg"][i_to]],
        "kmh": [weather["windKmh"][i_from], weather["windKmh"][i_to]],
        "gustKmh": [weather["gustKmh"][i_from], weather["gustKmh"][i_to]],
        "until": max(SHIFTED),
        "headTowardDeg": [head_before, head_after],  # T+0 → shift, shift → T+6 h
        "decisionAxisDeg": periods[0]["spreadTowardDeg"],
        "atShift": summary(arrival, m_from),
        "within6h": summary(arrival, WINDOW_MIN),
        "villages": villages,
        "noShift": {"within6h": summary(baseline, WINDOW_MIN), f"areaHa{full_hours[-1]}h": summary(baseline, until)["areaHa"]},
        "note": f"sintético, afinado: injetado para a demo, não observado. O vento do IFS foi multiplicado por {opts.wind_mult:g} (já incluído no weather.json) e o das {SHIFT_TO[-5:]} às 21:00 é inventado. Sem a mudança, a cabeça segue para {compass(head(baseline, g, ign_xy, 0, WINDOW_MIN))} e só atinge {len(base_in6)} lugares em 6 h; com ela, roda para {compass(head_after)} e atinge {len(villages_in6)}. Meteorologia horária: o vento roda linearmente da primeira hora da janela para a segunda (fastModel.ts, api/fires.py).",
        "alert": (
            f"Mudança brusca de vento: de {compass(weather['windFromDeg'][i_from])} a {weather['windKmh'][i_from]:.0f} km/h para "
            f"{compass(weather['windFromDeg'][i_to])} a {weather['windKmh'][i_to]:.0f} km/h. A cabeça do incêndio roda de "
            f"{compass(head_before)} para {compass(head_after)}" + (f", em direção a {', '.join(first[:-1]) + (' e ' if len(first) > 1 else '') + first[-1]}." if first else ".")
        ),
    }
    if compare:
        other = "fast" if model == "elmfire" else "elmfire"
        elm, elm_base = (runs[other](w, start, ign, g) for w in (weather, observed))
        wind_shift["compare"] = {
            "model": other,
            "note": "the same fire and weather in the other model, areas only",
            "areaHa": {f"{h}h": round(float((elm <= h * 60).sum()) * cell_ha, 1) for h in (3, 6, 12, 24)},
            "noShiftAreaHa": {f"{h}h": round(float((elm_base <= h * 60).sum()) * cell_ha, 1) for h in (3, 6, 12, 24)},
        }

    fire = {
        "id": FIRE_ID,
        "name": NAME,
        "parish": PARISH,
        "incidentId": None,
        "timeZone": "Europe/Lisbon",
        "start": iso(start),
        "end": steps[-1]["time"],
        "simulated": True,
        "simulation": {"model": MODELS[model], "runMin": RUN_MIN, "gridEdgeMin": round(edge_min) if edge_min <= RUN_MIN else None,
                       "tuning": tuning(opts, g)},
        "ignition": ign,
        "ignitions": [{"time": iso(start), "hours": 0.0, "chain": 1, "areaHa": steps[0]["areaHa"], **ign}],
        "bbox": bbox(prev_shape),
        "areaHa": {"timed": steps[-1]["areaHa"], "untimed": 0.0, "total": steps[-1]["areaHa"]},
        "steps": steps,
        "periods": periods,
        "referenceCapHa": opts.cap_ha,
        "referenceCapMin": cap_min,
        "engine": ENGINE_BLOCK(opts),
        "windShift": wind_shift,
        "source": {k: v.replace("{model}", MODELS[model]).replace("{model_pt}", MODEL_PT[model]).replace("{wind_mult}", f"{opts.wind_mult:g}").replace("{tuning}", tuning_pt(opts))
                   for k, v in SOURCE.items()},
    }
    (folder / "progression.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    (folder / "fire.json").write_text(json.dumps(fire, ensure_ascii=False, indent=2) + "\n")
    index = [{"id": FIRE_ID, "name": NAME, "start": fire["start"], "areaHa": fire["areaHa"]["total"], **ign}]
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    report(fire, folder)


def ENGINE_BLOCK(opts):  # noqa: N802
    """What the API's /api/run applies by default to this fire (api/runs.py), the reference's settings."""
    return {"fuels": opts.fuels, "spotting": opts.spotting, "seed": opts.seed, "canopy": "typical" if opts.canopy else None,
            "deadMoisture": {"simardDryPoints": opts.dry, "floorPct": opts.dead_floor}, "liveHerbPct": opts.live_herb, "liveWoodyPct": opts.live_woody}


def tuning(opts, g):
    """The synthetic settings of this build, for fire.json."""
    return {
        "gridKm": opts.grid_km, "cells": [g["cols"], g["rows"]], "windMult": opts.wind_mult, "deadFuelDryPoints": opts.dry, "deadFuelFloorPct": opts.dead_floor,
        "liveHerbPct": opts.live_herb, "liveWoodyPct": opts.live_woody, "fuels": opts.fuels, "farmlandFuel": opts.farmland_fuel or None, "canopy": opts.canopy,
        "adj": opts.adj, "spotting": opts.spotting, "seed": opts.seed, "shiftedKmh": {t[-5:]: v[1] for t, v in SHIFTED.items()},
    }


def tuning_pt(opts):
    return (f"vento do IFS x{opts.wind_mult:g}; humidade do combustível morto fino 1 h reduzida de {opts.dry:g} pontos (mínimo {opts.dead_floor:g} %) e vivo {opts.live_herb:g}/{opts.live_woody:g} %; "
            "modelos de combustível portugueses (Fernandes 2009)" + (f", culturas temporárias como pousio seco (S&B {opts.farmland_fuel})" if opts.farmland_fuel else "")
            + ("; copado típico no eucaliptal e pinhal" if opts.canopy else "") + ("; projeções ligadas" if opts.spotting else "") + f"; grelha de {opts.grid_km:g} km")


def compass(deg):
    names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"]
    return names[round(deg / 22.5) % 16]


def build_osm(folder):
    if not (ROOT / "data/osm" / f"{FIRE_ID}.json").exists():
        subprocess.run([sys.executable, "-I", str(ROOT / "scripts/fetch_osm.py"), FIRE_ID], check=True)
    subprocess.run([sys.executable, "-I", str(ROOT / "scripts/build_osm.py"), FIRE_ID], check=True)
    return json.loads((folder / "osm.json").read_text())


def report(fire, folder):
    print(f"{fire['id']} · {fire['name']} ({fire['parish']}) · {fire['start']} → {fire['end']}")
    for s, p in zip(fire["steps"], [None, *fire["periods"]]):
        head = f"  head {p['rosMPerH']:>4} m/h toward {p['spreadTowardDeg']}°" if p else ""
        print(f"  step {s['step']:>2}  {s['time']}  T+{s['hours']:>4}h  +{s['addedHa']:>6} ha  = {s['areaHa']:>6} ha{head}")
    w = fire["windShift"]
    print(f"  shift {w['window']['from']} → {w['window']['to']}: from {w['fromDeg']}°, {w['kmh']} km/h; head {w['headTowardDeg']}°")
    print(f"  at the shift {w['atShift']}; T+6 h {w['within6h']}, no shift {w['noShift']['within6h']}")
    for v in w["villages"]:
        print(f"  {v['name']}: T+{v['minutes']} min (no shift: {v['noShiftMinutes']})")
    print(f"  alert: {w['alert']}")
    if "compare" in w:
        print(f"  {w['compare']['model']}: {w['compare']['areaHa']}, no shift {w['compare']['noShiftAreaHa']}")
    for f in sorted(folder.iterdir()):
        print(f"  {f.relative_to(ROOT)}  {f.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model", choices=MODELS, default="elmfire", help="the reference spread (default ELMFIRE, Docker)")
    parser.add_argument("--compare", action="store_true", help="also run the other model and record its areas")
    parser.add_argument("--ign-lat", type=float, default=IGN_LAT, help="ignition latitude (WGS84)")
    parser.add_argument("--ign-lon", type=float, default=IGN_LON, help="ignition longitude (WGS84)")
    parser.add_argument("--cap-ha", type=float, default=CAP_HA, help="the reference ends at the first step at or above this area (ha)")
    parser.add_argument("--grid-km", type=float, default=GRID_KM, help="side of the square 30 m grid (cells: km*1000/30, keep under ~1000)")
    parser.add_argument("--centre-east-km", type=float, default=CENTRE_E_KM, help="grid centre east of the ignition")
    parser.add_argument("--centre-north-km", type=float, default=CENTRE_N_KM, help="grid centre north of the ignition")
    parser.add_argument("--wind-mult", type=float, default=WIND_MULT, help="factor on the IFS wind and gusts, baked into weather.json")
    parser.add_argument("--dry", type=float, default=DRY, help="percentage points taken off the dead 1 h equilibrium moisture (ELMFIRE only)")
    parser.add_argument("--dead-floor", type=float, default=DEAD_FLOOR, help="lowest dead 1 h moisture (%%)")
    parser.add_argument("--live-herb", type=float, default=30.0)
    parser.add_argument("--live-woody", type=float, default=70.0)
    parser.add_argument("--fuels", choices=["pt", "sb"], default="pt", help="Portuguese fuel models (Fernandes 2009) or Scott & Burgan")
    parser.add_argument("--shrub", choices=pt_fuels.SHRUBS, default="V-MAa", help="model for COS shrubland with --fuels pt")
    parser.add_argument("--farmland-fuel", type=int, default=FARMLAND_FUEL, help="Scott & Burgan model for temporary crops (COS 2.1.1.1), 0 = non-burnable")
    parser.add_argument("--canopy", action=argparse.BooleanOptionalAction, default=True, help="typical canopy in eucalyptus and pinhal e folhosas, so ELMFIRE can crown")
    parser.add_argument("--adj", type=float, default=1.0, help="ELMFIRE spread rate adjustment factor (1 = none)")
    parser.add_argument("--spotting", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--seed", type=int, default=SEED, help="ELMFIRE's spotting seed: it changes the area by ~20 %%")
    args = parser.parse_args()
    build(args.model, args.compare, args)
