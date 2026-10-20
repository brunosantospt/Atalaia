"""Download the OpenStreetMap context of one fire: roads, buildings, places and water.

    scripts/.venv/bin/python scripts/fetch_osm.py VieiradoMinho_10082016

Asks Overpass for everything inside the fire's 30 m grid (web/public/fires/<id>/grid.json)
and saves the raw answer, untouched, to data/osm/<id>.json. build_osm.py turns it into
web/public/fires/<id>/osm.json. The public Overpass servers are often at capacity: the
request goes to each mirror in turn, with a growing pause between tries.

OSM data is ODbL: credit "© contribuidores do OpenStreetMap" wherever it is shown.
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
OUT = ROOT / "data/osm"
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
ROADS = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track|path|footway|bridleway|cycleway"
PLACES = "city|town|village|hamlet|isolated_dwelling|locality|neighbourhood"
WATER_POINTS = "fire_hydrant|water_tank|fire_water_pond|suction_point"


def query(bbox):
    s, w, n, e = bbox
    return f"""
[out:json][timeout:180][bbox:{s},{w},{n},{e}];
way["highway"~"^({ROADS})$"]->.roads;
.roads out geom tags;
way["building"]->.buildings;
.buildings out center tags;
nwr["place"~"^({PLACES})$"]->.places;
.places out center tags;
(
  way["natural"="water"];
  way["waterway"~"^(river|stream|canal)$"];
  way["landuse"="reservoir"];
)->.water;
.water out geom tags;
(
  nwr["emergency"~"^({WATER_POINTS})$"];
  nwr["man_made"~"^(water_well|water_tower|reservoir_covered)$"];
)->.points;
.points out center tags;
"""


def grid_bbox(fire_id: str):
    corners = json.loads((FIRES / fire_id / "grid.json").read_text())["wgs84"].values()
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    return (min(lats), min(lons), max(lats), max(lons))


def fetch(text: str):
    body = urllib.parse.urlencode({"data": text}).encode()
    wait = 5
    for attempt in range(8):
        url = MIRRORS[attempt % len(MIRRORS)]
        request = urllib.request.Request(url, data=body, headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"{url}: {error}; waiting {wait} s", file=sys.stderr)
            time.sleep(wait)
            wait = min(wait * 2, 60)
    raise SystemExit("every Overpass mirror refused the query")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    fire_id = sys.argv[1]
    bbox = grid_bbox(fire_id)
    data = fetch(query(bbox))
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{fire_id}.json"
    out.write_text(json.dumps(data, ensure_ascii=False) + "\n")
    kinds = {}
    for e in data["elements"]:
        tag = "highway" if "highway" in e.get("tags", {}) else "building" if "building" in e.get("tags", {}) else "other"
        kinds[tag] = kinds.get(tag, 0) + 1
    print(f"{len(data['elements'])} elements {kinds}, OSM as of {data['osm3s']['timestamp_osm_base']}")
    print(f"→ {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
