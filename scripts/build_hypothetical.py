"""Build the demo's one fire: a hypothetical fire at Monte da Penha (Guimarães), with a wind shift.

    scripts/.venv/bin/python -I scripts/build_hypothetical.py [--elmfire]

Nothing burned here: the fire is the one the UE render tells (FireRenderer's Penha package,
data/simfire/penha_2024-09-16: same 30 m grid, ignition and start, 16 Sep 2024 10:00), under the
real IFS weather of that day with ONE synthetic change: between 12:00 and 13:00 the easterly backs
to a strong north-north-westerly, so the head that climbed north swings to the south-east, onto
Fareja and Bacelos. Writes:

    web/public/fires/<id>/grid.json, fuel.*, elevation.f32, slope.u8, aspect.u16, terrain.json
                                               copied from the package
    web/public/fires/<id>/weather.json         hourly, local time, the shift injected
    web/public/fires/<id>/progression.geojson  perimeter and new area per step
    web/public/fires/<id>/fire.json            as build_fires.py, plus `simulated` and `windShift`
    web/public/fires/<id>/osm.json             through fetch_osm.py (once) and build_osm.py
    web/public/fires/index.json                this fire only: the demo shows one

With no observed spread, the steps the story plays are ELMFIRE's (engines/elmfire in Docker, as
the API runs it: no canopy, moistures from temperature and humidity) with nobody on the fire.
--model fast uses the browser's fast model instead (web/src/fastModel.ts, run by Node through
scripts/fastmodel/free_run.ts), which spreads this fire some 5x faster in its eucalyptus;
--compare records the other model's areas in windShift.compare. Steps are hourly through the 6 h decision window, then at 9 and 12 h, and further
only while the fire stays off the grid's edge. Each perimeter is the cells reached by then, smoothed
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
PACKAGE = ROOT / "data/simfire/penha_2024-09-16"  # symlink to FireRenderer/data/simfire/penha_2024-09-16
CACHE = ROOT / "data/hypothetical"
OUT = ROOT / "web/public/fires"
FAST = ROOT / "scripts/fastmodel"
ELMFIRE = ROOT / "engines/elmfire/run.sh"

FIRE_ID = "Penha_Guimaraes_hipotetico"
NAME = "Penha, Guimarães (simulado)"
PARISH = "Mesão Frio"  # Nominatim, at the ignition
LAYERS = ("grid.json", "fuel.json", "fuel.u8", "elevation.f32", "slope.u8", "aspect.u16", "terrain.json")

TIME = "%Y-%m-%dT%H:%M"
RUN_MIN = 24 * 60
STEP_HOURS = [0, 1, 2, 3, 4, 5, 6, 9, 12, 18, 24]  # cut at the first one that touches the grid edge
WINDOW_MIN = 360  # the app's decision window (main.ts DECISION_MIN)
IGNITION_R_M = 45  # step 0: a disc around the ignition that holds its cell centre (api/runs.py)
SMOOTH_M = 15  # half a cell: takes the staircase off the cell outlines
SIMPLIFY_M = 4.0
PLACE_RADIUS_M = 250  # a village is reached when the fire gets this close (osm.ts)
HOMES_NEAR_M = 100  # homes this close to the front: OSM puts them in non-burnable cells

# The shift: hourly values that replace the observed ones (from °, km/h). 12:00 stays observed
# (89°, 22.7 km/h), so both readers (fastModel.ts, api/fires.py) turn the wind linearly through
# 12:00-13:00, the short way: 114° anticlockwise, through the north-east. A dry nortada sets in and
# holds the afternoon, then eases and veers back to the observed light easterly by 22:00.
SHIFT_FROM, SHIFT_TO = "2024-09-16T12:00", "2024-09-16T13:00"
SHIFTED = {
    "2024-09-16T13:00": (335, 36.0),
    "2024-09-16T14:00": (335, 38.0),
    "2024-09-16T15:00": (338, 36.0),
    "2024-09-16T16:00": (340, 32.0),
    "2024-09-16T17:00": (340, 27.0),
    "2024-09-16T18:00": (345, 20.0),
    "2024-09-16T19:00": (0, 13.0),
    "2024-09-16T20:00": (25, 10.0),
    "2024-09-16T21:00": (55, 8.0),
}
GUST_FACTOR = 1.75  # gust/mean: the observed afternoon has ~2.0, a steadier flow a little less

PTTM06 = CRS.from_epsg(3763)
TO_WGS84 = Transformer.from_crs(PTTM06, CRS.from_epsg(4326), always_xy=True)
TO_TM06 = Transformer.from_crs(CRS.from_epsg(4326), PTTM06, always_xy=True)
HA = 10_000

SOURCE = {
    "dataset": "Incêndio hipotético na Penha (Guimarães): não aconteceu",
    "data": "Incêndio simulado na Penha, Guimarães ({model_pt}, sem combate), com a meteorologia real de 16/09/2024 (ECMWF IFS 9 km via Open-Meteo) e uma rotação do vento sintética às 12h-13h",
    "cite": "Paisagem: COS2015 v2 e MDT LiDAR 2 m, DGT (CC BY 4.0); meteorologia ECMWF IFS via Open-Meteo (CC BY 4.0)",
    "fire": "hypothetical: the ignition and start of the UE render's Penha fire (FireRenderer scenarios/penha_elmfire); no observed spread exists",
    "weather": "real ECMWF IFS analysis of 16 Sep 2024 at the 9 km cell over Penha, except the wind from 13:00 to 21:00, which is synthetic",
    "windShift": "synthetic, injected for the demo, not observed: the easterly backs to NNW and strengthens between 12:00 and 13:00",
    "steps": "simulated, not observed: {model} under that weather (scripts/build_hypothetical.py)",
}


def iso(t):
    return t.strftime(TIME)


def parse(text):
    return datetime.strptime(text, TIME)


# ---------- weather ----------


def shifted_weather(observed):
    w = json.loads(json.dumps(observed))
    for t, (deg, kmh) in SHIFTED.items():
        i = w["time"].index(t)
        w["windFromDeg"][i], w["windKmh"][i] = deg, kmh
        w["gustKmh"][i] = round(max(kmh * GUST_FACTOR, observed["gustKmh"][i]), 1)
    w["source"] = {
        **observed["source"],
        "synthetic": f"windKmh, windFromDeg and gustKmh from {min(SHIFTED)} to {max(SHIFTED)} are invented for the demo (a wind shift); everything else is the IFS analysis",
    }
    w["utcOffsetH"] = 1.0
    w["notes"] = (
        "Valores instantâneos em cada hora: vento a 10 m, temperatura e humidade relativa a 2 m. A precipitação é a acumulada na hora anterior. "
        "windFromDeg é de onde o vento vem. O vento das 13:00 às 21:00 de 16/09 é sintético (rotação para NNO às 12h-13h), o resto é o observado."
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


def elmfire_run(weather, start, ignition, g):
    """ELMFIRE through engines/elmfire (Docker), no canopy, as the API runs it; moistures from the
    hourly temperature and humidity, live 30/70 %, as the UE run. Cached by request in data/hypothetical/."""
    rows, cols = g["rows"], g["cols"]
    legend = json.loads((PACKAGE / "fuel.json").read_text())["legend"]
    codes = np.array([e["scottBurgan"] for e in legend], dtype=np.int16)
    read = lambda name, dt: np.fromfile(PACKAGE / name, dtype=dt).reshape(rows, cols)  # noqa: E731
    minutes = np.arange(0, RUN_MIN + 1, 30)
    hours = np.array([(parse(t) - start).total_seconds() / 60 for t in weather["time"]])
    temp, rh = np.interp(minutes, hours, weather["tempC"]), np.interp(minutes, hours, weather["rhPct"])
    speed = np.interp(minutes, hours, weather["windKmh"])
    wfrom = np.degrees(np.interp(minutes, hours, np.unwrap(np.radians(weather["windFromDeg"])))) % 360
    moments = []
    for t, tc, h, s, d in zip(minutes, temp, rh, speed, wfrom):
        m1 = max(2.0, emc_pct(tc, h))
        moments.append({
            "t_min": float(t), "wind_kmh": round(float(s), 2), "wind_from_deg": round(float(d), 1),
            "dead_1h_pct": round(m1, 1), "dead_10h_pct": round(m1 + 1.5, 1), "dead_100h_pct": round(m1 + 3.0, 1),
            "live_herb_pct": 30.0, "live_woody_pct": 70.0,
        })
    x, y = TO_TM06.transform(ignition["lon"], ignition["lat"])
    request = {
        "grid": {k: g[k] for k in ("cols", "rows", "cellsize", "xmin", "ymin", "srs")},
        "duration_min": RUN_MIN,
        "ignitions": [{"x": x, "y": y, "t_min": 0}],
        "weather": moments,
        "layers": {
            "fuel": codes[read("fuel.u8", "u1")].tolist(),
            "elevation_m": np.round(read("elevation.f32", "<f4"), 1).tolist(),
            "slope_deg": read("slope.u8", "u1").tolist(),
            "aspect_deg": read("aspect.u16", "<u2").tolist(),
        },
    }
    body = json.dumps(request, separators=(",", ":"))
    key = hashlib.sha256(body.encode() + ELMFIRE.with_name("adapter.py").read_bytes()).hexdigest()[:16]
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


def to_geojson(shape):
    m = geometry.mapping(reproject(shape, TO_WGS84))  # simplified before the union, so steps nest
    return {"type": m["type"], "coordinates": rounded(m["coordinates"])}


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
    "elmfire": "ELMFIRE 2025.0717 (engines/elmfire), no suppression, no canopy",
    "fast": "web/src/fastModel.ts, free run, no suppression",
}

MODEL_PT = {"elmfire": "ELMFIRE", "fast": "modelo rápido do Atalaia"}


def build(model, compare):
    folder = OUT / FIRE_ID
    folder.mkdir(parents=True, exist_ok=True)
    for name in LAYERS:
        shutil.copyfile(PACKAGE / name, folder / name)
    package = json.loads((PACKAGE / "fire.json").read_text())
    g = json.loads((PACKAGE / "grid.json").read_text())
    rows, cols, cs = g["rows"], g["cols"], g["cellsize"]
    cell_ha = cs * cs / HA
    start = parse(package["start"])
    ign = {"lon": package["ignition"]["lon"], "lat": package["ignition"]["lat"]}
    ign_xy = TO_TM06.transform(ign["lon"], ign["lat"])

    observed = json.loads((PACKAGE / "weather.json").read_text())
    weather = shifted_weather(observed)
    if parse(weather["time"][-1]) < start + timedelta(minutes=RUN_MIN):
        raise SystemExit("weather.json ends before the run does")
    (folder / "weather.json").write_text(json.dumps(weather, ensure_ascii=False, separators=(",", ":")) + "\n")

    runs = {"elmfire": elmfire_run, "fast": lambda w, *a: fast_run(folder, w, *a)}
    arrival, baseline = (runs[model](w, start, ign, g) for w in (weather, observed))
    exposure = Exposure(build_osm(folder), g)

    # The steps, up to the last one whose perimeter stays off the grid's edge.
    edge = np.concatenate([arrival[0], arrival[-1], arrival[:, 0], arrival[:, -1]])
    edge_min = float(edge.min())
    step_hours = [h for h in STEP_HOURS if h * 60 < edge_min]
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
            mask = (arrival <= h * 60) | prev_mask
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
    until = step_hours[-1] * 60
    hit, hit_base = exposure.villages(arrival, until), exposure.villages(baseline, until)
    villages = sorted(
        ({"name": n, "kind": p["kind"], "lon": p["lon"], "lat": p["lat"], "minutes": m, "noShiftMinutes": hit_base.get(n, (None, None))[1]}
         for n, (p, m) in hit.items()),
        key=lambda v: v["minutes"],
    )
    first = [v["name"] for v in villages if v["noShiftMinutes"] is None or v["noShiftMinutes"] > v["minutes"]][:2]
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
        "noShift": {"within6h": summary(baseline, WINDOW_MIN), f"areaHa{step_hours[-1]}h": summary(baseline, until)["areaHa"]},
        "note": "synthetic: injected for the demo, not observed. Hourly weather, so the wind turns linearly from the first hour of the window to the second (fastModel.ts, api/fires.py). No village is reached within the 6 h window, with or without the shift: what changes is where the head goes.",
        "alert": (
            f"Mudança brusca de vento: de {compass(weather['windFromDeg'][i_from])} a {weather['windKmh'][i_from]:.0f} km/h para "
            f"{compass(weather['windFromDeg'][i_to])} a {weather['windKmh'][i_to]:.0f} km/h. A cabeça do incêndio roda de "
            f"{compass(head_before)} para {compass(head_after)}" + (f", em direção a {' e '.join(first)}." if first else ".")
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
        "simulation": {"model": MODELS[model], "runMin": RUN_MIN, "gridEdgeMin": round(edge_min) if edge_min <= RUN_MIN else None},
        "ignition": ign,
        "ignitions": [{"time": iso(start), "hours": 0.0, "chain": 1, "areaHa": steps[0]["areaHa"], **ign}],
        "bbox": bbox(prev_shape),
        "areaHa": {"timed": steps[-1]["areaHa"], "untimed": 0.0, "total": steps[-1]["areaHa"]},
        "steps": steps,
        "periods": periods,
        "windShift": wind_shift,
        "source": {k: v.replace("{model}", MODELS[model]).replace("{model_pt}", MODEL_PT[model]) for k, v in SOURCE.items()},
    }
    (folder / "progression.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    (folder / "fire.json").write_text(json.dumps(fire, ensure_ascii=False, indent=2) + "\n")
    index = [{"id": FIRE_ID, "name": NAME, "start": fire["start"], "areaHa": fire["areaHa"]["total"], **ign}]
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    report(fire, folder)


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
    args = parser.parse_args()
    build(args.model, args.compare)
