"""Download the hourly ERA5 weather over each fire from the Open-Meteo archive.

    scripts/.venv/bin/python scripts/fetch_weather.py [fire_id ...]   (all built fires by default)

Asks for the ERA5 grid point nearest the fire's first ignition, from DAYS_BEFORE days before the
fire started (the dead fuels dry or wet over days) to the day after it ended, in the fire's local
time, and saves the answer, untouched, to data/era5-openmeteo/<id>.json. build_weather.py checks
it and writes the app's copy. No account or key. Open-Meteo brings the temperature from the ERA5
cell down to the ignition's height on its own terrain model (`elevation` in the answer).

ERA5 is ECMWF reanalysis (Copernicus C3S, 0.25°, about 25 km): a smooth regional wind, not the
gusts a ridge makes. Credit "ERA5, Copernicus Climate Change Service, via Open-Meteo".
"""

import argparse
import json
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
OUT = ROOT / "data/era5-openmeteo"
ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"

DAYS_BEFORE = 3
HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation",
          "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]


def fetch(fire_id: str):
    fire = json.loads((FIRES / fire_id / "fire.json").read_text())
    start = date.fromisoformat(fire["start"][:10]) - timedelta(days=DAYS_BEFORE)
    end = date.fromisoformat(fire["end"][:10]) + timedelta(days=1)
    query = {
        "latitude": fire["ignition"]["lat"],
        "longitude": fire["ignition"]["lon"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY),
        "models": "era5",
        "timezone": fire["timeZone"],
        "wind_speed_unit": "kmh",
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(url, headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{fire_id}.json"
    path.write_text(json.dumps({"request": url, "response": data}, ensure_ascii=False, indent=1) + "\n")
    print(f"{fire_id}: {len(data['hourly']['time'])} h, {start} .. {end}, ERA5 cell {data['latitude']}, "
          f"{data['longitude']}, temperature brought to {data['elevation']} m → {path.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        fetch(fire_id)


if __name__ == "__main__":
    main()
