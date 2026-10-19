"""Check the downloaded ERA5 weather and write the hourly series the app and the engines read.

    scripts/.venv/bin/python scripts/build_weather.py [fire_id ...]   (all built fires by default)

Reads data/era5-openmeteo/<id>.json (fetch_weather.py) and writes web/public/fires/<id>/weather.json:
one column per variable, one value per hour, times on the fire's local clock like fire.json. The
answer is downloaded data: it is read as plain JSON and every value is checked against its unit and
a physical range before it is written.
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
RAW = ROOT / "data/era5-openmeteo"

# Output key: (Open-Meteo column, unit, lowest, highest).
COLUMNS = {
    "tempC": ("temperature_2m", "°C", -30, 50),
    "rhPct": ("relative_humidity_2m", "%", 0, 100),
    "precipMm": ("precipitation", "mm", 0, 200),
    "windKmh": ("wind_speed_10m", "km/h", 0, 200),
    "windFromDeg": ("wind_direction_10m", "°", 0, 360),
    "gustKmh": ("wind_gusts_10m", "km/h", 0, 300),
}


def build(fire_id: str):
    fire = json.loads((FIRES / fire_id / "fire.json").read_text())
    raw = json.loads((RAW / f"{fire_id}.json").read_text())["response"]
    hourly, units = raw["hourly"], raw["hourly_units"]
    if raw["timezone"] != fire["timeZone"]:
        raise SystemExit(f"{fire_id}: weather in {raw['timezone']}, fire in {fire['timeZone']}")

    times = hourly["time"]
    if not all(isinstance(t, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:00", t) for t in times):
        raise SystemExit(f"{fire_id}: bad times")
    steps = {(datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() for a, b in zip(times, times[1:])}
    if steps != {3600}:
        raise SystemExit(f"{fire_id}: the series is not one value per hour")
    if not (times[0] <= fire["start"] and fire["end"] <= times[-1]):
        raise SystemExit(f"{fire_id}: the series does not cover the fire")

    columns = {}
    for key, (name, unit, lo, hi) in COLUMNS.items():
        if units.get(name) != unit:
            raise SystemExit(f"{fire_id}: {name} in {units.get(name)!r}, expected {unit}")
        values = hourly[name]
        bad = [v for v in values if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi]
        if bad or len(values) != len(times):
            raise SystemExit(f"{fire_id}: {name} has missing or out of range values {bad[:3]}")
        columns[key] = [round(float(v), 1) for v in values]

    doc = {
        "source": {
            "dataset": "ERA5, Copernicus Climate Change Service (ECMWF), hourly reanalysis at 0.25°",
            "via": "Open-Meteo historical weather API",
            "cell": {"lat": raw["latitude"], "lon": raw["longitude"]},
            "temperatureAtM": raw["elevation"],
        },
        "timeZone": fire["timeZone"],
        "utcOffsetH": raw["utc_offset_seconds"] / 3600,
        "notes": "Valores instantâneos em cada hora: vento a 10 m, temperatura e humidade relativa a 2 m. "
                 "A precipitação é a acumulada na hora anterior. windFromDeg é de onde o vento vem.",
        "time": times,
        **columns,
    }
    (FIRES / fire_id / "weather.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")

    during = [k for k, t in enumerate(times) if fire["start"] <= t <= fire["end"]]
    pick = lambda key, f: f(columns[key][k] for k in during)  # noqa: E731
    print(f"{fire_id}: {len(times)} h; during the fire {pick('tempC', min)}..{pick('tempC', max)} °C, "
          f"RH {pick('rhPct', min)}..{pick('rhPct', max)} %, wind up to {pick('windKmh', max)} km/h "
          f"(gusts {pick('gustKmh', max)}), {sum(columns['precipMm'][:during[0]]):.1f} mm in the days before")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        build(fire_id)


if __name__ == "__main__":
    main()
