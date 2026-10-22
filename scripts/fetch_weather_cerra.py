"""Download the hourly CERRA (5.5 km) weather over each fire from the Open-Meteo archive.

    python scripts/fetch_weather_cerra.py [fire_id ...]   (all built fires by default)

Asks for the CERRA grid point nearest the fire's first ignition, from DAYS_BEFORE days before the
fire started to the day after it ended, in the fire's local time, and saves the answer to
data/cerra-openmeteo/<id>.json.

CERRA is the Copernicus European Regional ReAnalysis (0.05°, about 5.5 km horizontal resolution):
a 5x improvement in linear resolution (25x in area) over ERA5's 25 km grid cell, capturing regional
orography and coastal/mountain transitions much more accurately for Portuguese terrain.
"""

import argparse
import json
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
OUT = ROOT / "data/cerra-openmeteo"
ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"

DAYS_BEFORE = 3
HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
]


def fetch(fire_id: str):
    fire = json.loads((FIRES / fire_id / "fire.json").read_text(encoding="utf-8"))
    start = date.fromisoformat(fire["start"][:10]) - timedelta(days=DAYS_BEFORE)
    end = date.fromisoformat(fire["end"][:10]) + timedelta(days=1)
    query = {
        "latitude": fire["ignition"]["lat"],
        "longitude": fire["ignition"]["lon"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY),
        "models": "cerra",
        "timezone": fire["timeZone"],
        "wind_speed_unit": "kmh",
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(url, headers={"User-Agent": "Atalaia/0.2 (Hack4Guimaraes-CERRA)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{fire_id}.json"
    path.write_text(json.dumps({"request": url, "response": data}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(
        f"{fire_id}: [CERRA 5.5km] {len(data['hourly']['time'])} h, {start} .. {end}, "
        f"cell ({data['latitude']:.4f}, {data['longitude']:.4f}), elevation {data['elevation']:.1f} m -> {path.relative_to(ROOT)}"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text(encoding="utf-8"))]:
        fetch(fire_id)


if __name__ == "__main__":
    main()
