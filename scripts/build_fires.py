"""Build one PT-FireSprd fire for the web app.

    scripts/.venv/bin/python scripts/build_fires.py VieiradoMinho_10082016

Reads the fire's L1 progression polygons, its L3 burn periods and its row of the
metadata sheet from data/pt-firesprd-v2/extracted, and writes:

    web/public/fires/<id>/progression.geojson  perimeter and new area per step, WGS84
    web/public/fires/<id>/fire.json            names, ignitions, steps, bbox, L3 periods
    web/public/fires/index.json                one entry per built fire, for the picker

L1 polygons are disjoint pieces, not perimeters: `z` is an ignition, `p` what burned
up to its `date_hour`, and `a` (or a `p` with an uncertain time) burned at an unknown
time. Geometry is handled in PT-TM06 (EPSG:3763) so areas come out in metres.
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import shapefile  # pyshp
import shapely
import xlrd
from pyproj import CRS, Transformer
from shapely import geometry, ops

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/pt-firesprd-v2/extracted"
OUT = ROOT / "web/public/fires"

PTTM06 = CRS.from_epsg(3763)
TO_WGS84 = Transformer.from_crs(PTTM06, CRS.from_epsg(4326), always_xy=True)
HA = 10_000
MIN_PART_HA = 0.05  # slivers left by differencing neighbouring polygons
SIMPLIFY_M = 2.0  # well under the satellite pixel; keeps the files small

SOURCE_NOTE = {
    "dataset": "PT-FireSprd (Portuguese Large Wildfire Spread database)",
    "cite": "Benali et al. 2023, Earth System Science Data, doi:10.5194/essd-15-3791-2023",
    "data": "PT-FireSprd v2.0, Zenodo record 16279793, CC BY 4.0",
    "times": "date_hour as published; the metadata does not state a time zone, local time (Europe/Lisbon) is assumed",
}


def parse_time(value: str):
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M")
    except ValueError:  # "na", "uncertain"
        return None


def dbf(record, name: str):
    """A dBase field: the format cuts names at 10 characters (burn_period → burn_perio)."""
    return record[name[:10]]


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M") if t else None


def ha(g):
    return round(g.area / HA, 1)


def clean(g):
    """Valid, without slivers, always a MultiPolygon."""
    g = shapely.make_valid(g)
    parts = [p for p in getattr(g, "geoms", [g]) if isinstance(p, geometry.Polygon) and p.area >= MIN_PART_HA * HA]
    return geometry.MultiPolygon(parts)


def reproject(g, transformer):
    return shapely.transform(g, lambda xy: np.column_stack(transformer.transform(xy[:, 0], xy[:, 1])))


def lonlat(point):
    lon, lat = TO_WGS84.transform(point.x, point.y)
    return {"lon": round(lon, 6), "lat": round(lat, 6)}


def bbox(g):
    w, s, e, n = reproject(g, TO_WGS84).bounds
    return [round(w, 6), round(s, 6), round(e, 6), round(n, 6)]


def rounded(coords, nd=6):
    if isinstance(coords[0], (int, float)):
        return [round(c, nd) for c in coords]
    return [rounded(c, nd) for c in coords]


def to_geojson(g):
    m = geometry.mapping(reproject(g.simplify(SIMPLIFY_M, preserve_topology=True), TO_WGS84))
    return {"type": m["type"], "coordinates": rounded(m["coordinates"])}


# ---------- reading ----------


def read_l1(fire_id: str):
    folder = SOURCE / "L1_FireProgressions" / fire_id[-4:] / fire_id
    shp = next(folder.glob("*.shp"), None)
    if shp is None:
        raise SystemExit(f"no L1 shapefile in {folder}")
    to_tm06 = Transformer.from_crs(CRS.from_wkt(shp.with_suffix(".prj").read_text()), PTTM06, always_xy=True)
    pieces = []
    with shapefile.Reader(str(shp)) as sf:
        # By index, through the .shx offsets: some L1 files (Cabeceiras) have stray bytes
        # between records, which breaks pyshp's sequential iterShapeRecords().
        for i in range(len(sf)):
            if sf.shape(i).shapeType == shapefile.NULL:  # an empty record (Vila de Rei 2019 has one)
                continue
            r = sf.record(i).as_dict()
            pieces.append(
                {
                    "kind": r["type"],
                    "time": parse_time(r["date_hour"]),
                    "chain": r["zp_link"],
                    "period": dbf(r, "burn_period"),
                    "geom": shapely.make_valid(reproject(geometry.shape(sf.shape(i).__geo_interface__), to_tm06)),
                }
            )
    return pieces


def read_l3(fire_id: str):
    def num(v, nd=1):
        return None if v is None or v < 0 else round(v, nd)

    shp = SOURCE / "L3_Simplied_FireBehavior/PT-FireProg_v2.0_L3.shp"
    with shapefile.Reader(str(shp)) as sf:
        rows = [r.as_dict() for r in sf.iterRecords() if r["fname"] == fire_id]
    return [
        {
            "period": dbf(r, "burn_period"),
            "start": iso(parse_time(r["sdate"])),
            "end": iso(parse_time(r["edate"])),
            "durationH": num(r["duration"]),
            "areaHa": num(r["area"]),
            "growthHaPerH": num(dbf(r, "growth_rate")),
            "rosMPerH": num(r["ros"], 0),
            "maxRosMPerH": num(r["max_ros"], 0),
            "spreadTowardDeg": num(r["spdir"], 0),
            "intensityKWPerM": num(r["fli"], 0),
        }
        for r in sorted(rows, key=lambda r: dbf(r, "burn_period"))
    ]


def read_metadata(fire_id: str):
    sheet = xlrd.open_workbook(str(SOURCE / "PT-FireSprd_Metadata_ZENODO.xls")).sheet_by_index(0)
    head = [str(c.value).strip() for c in sheet.row(0)]
    for q in range(1, sheet.nrows):
        row = dict(zip(head, (c.value for c in sheet.row(q))))
        if row["Fire Name"] == fire_id:
            return row
    raise SystemExit(f"{fire_id} is not in the metadata sheet")


# ---------- building ----------


def build_steps(pieces):
    """One step per distinct time: the perimeter so far and what it added."""
    timed = [p for p in pieces if p["time"]]
    steps = []
    burned = geometry.MultiPolygon()
    for t in sorted({p["time"] for p in timed}):
        now = [p for p in timed if p["time"] == t]
        perimeter = clean(ops.unary_union([burned, *(p["geom"] for p in now)]))
        added = clean(perimeter.difference(burned))
        periods = [p["period"] for p in now if p["kind"] == "p"]
        steps.append({"time": t, "perimeter": perimeter, "added": added, "period": max(periods) if periods else None})
        burned = perimeter
    untimed = clean(ops.unary_union([p["geom"] for p in pieces if not p["time"]]).difference(burned))
    return steps, untimed


def build(fire_id: str):
    pieces = read_l1(fire_id)
    meta = read_metadata(fire_id)
    periods = read_l3(fire_id)
    steps, untimed = build_steps(pieces)
    if not steps:
        raise SystemExit(f"{fire_id} has no timed polygons")

    start = steps[0]["time"]
    last = steps[-1]["perimeter"]
    total = clean(ops.unary_union([last, untimed]))
    ignitions = sorted((p for p in pieces if p["kind"] == "z" and p["time"]), key=lambda p: p["time"])
    hours = lambda t: round((t - start).total_seconds() / 3600, 2)  # noqa: E731

    features = []
    step_meta = []
    for k, s in enumerate(steps):
        props = {"step": k, "time": iso(s["time"]), "hours": hours(s["time"])}
        features.append({"type": "Feature", "properties": {"kind": "perimeter", **props, "areaHa": ha(s["perimeter"])}, "geometry": to_geojson(s["perimeter"])})
        features.append({"type": "Feature", "properties": {"kind": "increment", **props, "areaHa": ha(s["added"])}, "geometry": to_geojson(s["added"])})
        step_meta.append(
            {
                **props,
                "areaHa": ha(s["perimeter"]),
                "addedHa": ha(s["added"]),
                "period": s["period"],
                # Where the fire went in this step: the centre of the new area.
                "center": lonlat(s["added"].centroid),
                "bbox": bbox(s["perimeter"]),
            }
        )
    if not untimed.is_empty:
        features.append({"type": "Feature", "properties": {"kind": "untimed", "areaHa": ha(untimed)}, "geometry": to_geojson(untimed)})

    fire = {
        "id": fire_id,
        "name": meta["Municipality"],
        "parish": meta["Civil Parish"],
        "incidentId": str(int(meta["Incident ID"])) if meta["Incident ID"] else None,
        "timeZone": "Europe/Lisbon",
        "start": iso(start),
        "end": iso(steps[-1]["time"]),
        "ignition": lonlat(ignitions[0]["geom"].centroid) if ignitions else step_meta[0]["center"],
        "ignitions": [
            {"time": iso(p["time"]), "hours": hours(p["time"]), "chain": p["chain"], "areaHa": ha(p["geom"]), **lonlat(p["geom"].centroid)}
            for p in ignitions
        ],
        "bbox": bbox(total),
        "areaHa": {"timed": ha(last), "untimed": ha(untimed), "total": ha(total)},
        "steps": step_meta,
        "periods": periods,
        "source": SOURCE_NOTE,
    }

    folder = OUT / fire_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "progression.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    (folder / "fire.json").write_text(json.dumps(fire, ensure_ascii=False, indent=2) + "\n")
    update_index(fire)
    report(fire, folder)


def update_index(fire):
    path = OUT / "index.json"
    entries = json.loads(path.read_text()) if path.exists() else []
    entries = [e for e in entries if e["id"] != fire["id"]]
    entries.append(
        {"id": fire["id"], "name": fire["name"], "start": fire["start"], "areaHa": fire["areaHa"]["total"], **fire["ignition"]}
    )
    path.write_text(json.dumps(sorted(entries, key=lambda e: e["start"]), ensure_ascii=False, indent=2) + "\n")


def report(fire, folder):
    print(f"{fire['id']} · {fire['name']} ({fire['parish']}) · {fire['start']} → {fire['end']}")
    for s in fire["steps"]:
        print(f"  step {s['step']}  {s['time']}  T+{s['hours']:>5}h  +{s['addedHa']:>7} ha  = {s['areaHa']:>7} ha  period {s['period']}")
    for i in fire["ignitions"]:
        print(f"  ignition {i['time']}  chain {i['chain']}  {i['areaHa']} ha  ({i['lat']}, {i['lon']})")
    a = fire["areaHa"]
    print(f"  timed {a['timed']} ha + untimed {a['untimed']} ha = {a['total']} ha")
    for p in fire["periods"]:
        print(f"  L3 period {p['period']}: {p['areaHa']} ha, ROS {p['rosMPerH']} m/h toward {p['spreadTowardDeg']}°")
    for f in sorted(folder.iterdir()):
        print(f"  {f.relative_to(ROOT)}  {f.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("fire_ids", nargs="+", help="PT-FireSprd fire name, e.g. VieiradoMinho_10082016")
    for fire_id in parser.parse_args().fire_ids:
        build(fire_id)
