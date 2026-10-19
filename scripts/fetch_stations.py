"""Download fire stations around Guimarães from OpenStreetMap.

    scripts/.venv/bin/python scripts/fetch_stations.py

Asks Overpass for every `amenity=fire_station` (node, way or relation) in Portugal
within RADIUS_KM of Monte da Penha and saves the raw answer, untouched, to
data/osm-fire-stations/raw.json. build_stations.py cleans it up.

The circle reaches well into Galicia; the country is filtered here, against the
OSM boundary, rather than guessed later from names.

OSM data is ODbL: credit "© contribuidores do OpenStreetMap" wherever it is shown.
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/osm-fire-stations/raw.json"
ENDPOINT = "https://overpass-api.de/api/interpreter"

PENHA = (41.4256, -8.2683)  # lat, lon
RADIUS_KM = 100

# `out center` gives ways and relations a single point, so every element has a position.
QUERY = f"""
[out:json][timeout:180];
area["ISO3166-1"="PT"][admin_level=2]->.pt;
nwr["amenity"="fire_station"](area.pt)(around:{RADIUS_KM * 1000},{PENHA[0]},{PENHA[1]});
out center tags;
"""


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    request = urllib.request.Request(ENDPOINT, data=body, headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.load(response)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")

    kinds = {}
    for e in data["elements"]:
        kinds[e["type"]] = kinds.get(e["type"], 0) + 1
    print(f"{len(data['elements'])} elements {kinds}, OSM as of {data['osm3s']['timestamp_osm_base']}")
    print(f"→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
