"""Turn the raw OpenStreetMap answer of one fire into the web app's context file.

    scripts/.venv/bin/python -I scripts/build_osm.py VieiradoMinho_10082016

Reads data/osm/<id>.json (fetch_osm.py) and writes web/public/fires/<id>/osm.json:

    roads      every highway as a polyline, with its class for the twin: paved, track or path
    buildings  one point per building, flagged residential or not
    places     villages, hamlets and localities with a name
    water      rivers, streams, lakes and reservoirs as polylines (the outline, for areas)

Coordinates are WGS84 rounded to 1e-5 (about 1 m); road and water lines are simplified to
~3 m so the file stays small. The app rasterises all of it onto the fire's 30 m grid itself.
"""

import json
import sys
from pathlib import Path

from shapely import geometry

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/osm"
FIRES = ROOT / "web/public/fires"

SIMPLIFY_DEG = 0.00003  # ~3 m
PAVED = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road",
}
PATH = {"path", "footway", "bridleway", "cycleway"}
UNPAVED = {"unpaved", "dirt", "gravel", "ground", "grass", "sand", "compacted", "fine_gravel", "earth", "mud"}
# building=* values that are not homes; `yes` and the rest count as homes, which in a rural
# parish is usually right (INE's BGRI would say for sure).
NOT_HOMES = {
    "industrial", "commercial", "retail", "warehouse", "office", "church", "chapel", "cathedral", "school",
    "university", "hospital", "barn", "shed", "garage", "garages", "greenhouse", "farm_auxiliary", "ruins",
    "collapsed", "roof", "construction", "transformer_tower", "service", "hut", "stable", "sty", "cowshed",
    "kiosk", "hangar", "public", "civic", "government", "sports_hall", "stadium", "grandstand", "pavilion",
    "bunker", "shrine", "monastery", "toilets", "parking", "carport", "silo", "storage_tank", "water_tower",
}
WATER_KIND = {("natural", "water"): "lake", ("landuse", "reservoir"): "reservoir"}


def road_class(tags):
    hw = tags["highway"]
    if hw in PATH:
        return "path"
    if hw == "track":
        return "track"
    if hw in PAVED:
        return "track" if tags.get("surface") in UNPAVED else "paved"
    return "track"


def line(points):
    coords = [(p["lon"], p["lat"]) for p in points]
    if len(coords) < 2:
        return None
    simplified = geometry.LineString(coords).simplify(SIMPLIFY_DEG, preserve_topology=False)
    return [[round(x, 5), round(y, 5)] for x, y in simplified.coords]


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    fire_id = sys.argv[1]
    data = json.loads((RAW / f"{fire_id}.json").read_text())
    roads, buildings, places, water = [], [], [], []
    for e in data["elements"]:
        tags = e.get("tags", {})
        if "highway" in tags and e["type"] == "way":
            pts = line(e.get("geometry", []))
            if not pts:
                continue
            road = {"id": e["id"], "cls": road_class(tags), "hw": tags["highway"], "pts": pts}
            for key in ("name", "ref"):
                if tags.get(key):
                    road[key] = tags[key]
            roads.append(road)
        elif "building" in tags and "center" in e:
            c = e["center"]
            home = 0 if tags["building"] in NOT_HOMES or tags.get("amenity") == "place_of_worship" else 1
            buildings.append([round(c["lon"], 5), round(c["lat"], 5), home])
        elif "place" in tags and tags.get("name"):
            c = e.get("center") or {"lon": e.get("lon"), "lat": e.get("lat")}
            if c["lon"] is None:
                continue
            places.append({"name": tags["name"], "kind": tags["place"], "lon": round(c["lon"], 5), "lat": round(c["lat"], 5)})
        elif e["type"] == "way" and ("waterway" in tags or "natural" in tags or "landuse" in tags):
            pts = line(e.get("geometry", []))
            if not pts:
                continue
            kind = tags.get("waterway") or WATER_KIND.get(("natural", tags.get("natural"))) or WATER_KIND.get(("landuse", tags.get("landuse")))
            if not kind:
                continue
            item = {"kind": kind, "pts": pts}
            if tags.get("name"):
                item["name"] = tags["name"]
            water.append(item)

    out = {
        "source": {
            "data": "OpenStreetMap via Overpass, ODbL",
            "osm": data["osm3s"]["timestamp_osm_base"],
            "credit": "© contribuidores do OpenStreetMap (ODbL)",
            "note": "Casas = building=* menos os tipos claramente não residenciais; o OSM rural subestima o número real de casas.",
        },
        "roads": roads,
        "buildings": buildings,
        "places": places,
        "water": water,
    }
    path = FIRES / fire_id / "osm.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    homes = sum(b[2] for b in buildings)
    print(
        f"{len(roads)} roads, {len(buildings)} buildings ({homes} homes), {len(places)} places, {len(water)} water lines"
        f" -> {path.relative_to(ROOT)} ({path.stat().st_size // 1024} kB)"
    )


if __name__ == "__main__":
    main()
