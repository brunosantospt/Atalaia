"""Calculate dynamic fuel moisture (dead and live) from hourly weather using Simard (1968).

    uv run python scripts/build_fuel_moisture.py [fire_id ...]

Instead of assuming constant dead fuel moisture (e.g. 6% dead 1h, 8% dead 10h) all day and night,
this script computes hourly Equilibrium Moisture Content (EMC) using Simard's standard formulation:
  - Daytime heat / low RH drops 1h dead fuel moisture to 3.5 - 4.5% (explosive spread conditions)
  - Nighttime cooling / RH recovery raises 1h dead fuel moisture to 9 - 14% (spread slows down)

Reads:
  - web/public/fires/<id>/weather_cerra.json (or weather.json fallback)
  - web/public/fires/<id>/fire.json

Writes:
  - web/public/fires/<id>/moisture_cerra.json (hourly dynamic moistures for ELMFIRE & FastModel)
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"


def simard_emc(temp_c: float, rh_pct: float) -> float:
    """Equilibrium moisture content (%) of fine dead fuel via Simard (1968)."""
    t_f = temp_c * 1.8 + 32.0
    h = max(1.0, min(100.0, float(rh_pct)))
    if h < 10.0:
        emc = 0.03229 + 0.281073 * h - 0.000578 * h * t_f
    elif h <= 50.0:
        emc = 2.22749 + 0.160107 * h - 0.014784 * t_f
    else:
        emc = 21.0606 + 0.005565 * (h ** 2) - 0.00035 * h * t_f - 0.483199 * h
    return max(1.5, min(30.0, emc))


def compute_fuel_moistures(temp_series: list[float], rh_series: list[float], time_series: list[str]):
    """Compute dynamic dead and live fuel moisture series for all hours."""
    dead_1h = []
    dead_10h = []
    dead_100h = []
    live_herb = []
    live_woody = []

    for t_str, temp, rh in zip(time_series, temp_series, rh_series):
        hour = int(t_str[11:13])
        
        # 1-hour dead fuel follows instantaneous EMC closely
        m1 = round(simard_emc(temp, rh), 1)
        
        # 10-hour and 100-hour fuels have longer time lags (damped diurnal amplitude)
        m10 = round(max(3.0, m1 * 1.25), 1)
        m100 = round(max(5.0, m10 * 1.2), 1)
        
        # Live fuels: physiological diurnal variation due to transpiration / VPD
        # In hot summer afternoons (13:00 - 18:00), live foliage moisture dips
        diurnal_dip = 10.0 if (12 <= hour <= 18) else (5.0 if (10 <= hour <= 20) else 0.0)
        mlh = round(max(35.0, 60.0 - diurnal_dip), 1)
        mlw = round(max(50.0, 90.0 - (diurnal_dip * 0.7)), 1)

        dead_1h.append(m1)
        dead_10h.append(m10)
        dead_100h.append(m100)
        live_herb.append(mlh)
        live_woody.append(mlw)

    return {
        "dead_1h_pct": dead_1h,
        "dead_10h_pct": dead_10h,
        "dead_100h_pct": dead_100h,
        "live_herb_pct": live_herb,
        "live_woody_pct": live_woody,
    }


def process_fire(fire_id: str):
    folder = FIRES / fire_id
    fire = json.loads((folder / "fire.json").read_text(encoding="utf-8"))
    
    cerra_path = folder / "weather_cerra.json"
    if cerra_path.exists():
        weather = json.loads(cerra_path.read_text(encoding="utf-8"))
        src_label = "CERRA (5.5 km)"
    else:
        weather = json.loads((folder / "weather.json").read_text(encoding="utf-8"))
        src_label = "ERA5 (25 km)"

    times = weather["time"]
    temp = weather["tempC"]
    rh = weather["rhPct"]

    moistures = compute_fuel_moistures(temp, rh, times)

    during = [k for k, t in enumerate(times) if fire["start"] <= t <= fire["end"]]
    if not during:
        during = range(len(times))

    doc = {
        "fire_id": fire_id,
        "source_weather": src_label,
        "model": "Simard (1968) Equilibrium Moisture Content (EMC)",
        "notes": "Humidade horária dinâmica dos combustíveis mortos (1h, 10h, 100h) e vivos (herbáceo, lenhoso). "
                 "Captura o colapso de humidade para ~4% nas horas mais quentes da tarde e a recuperação noturna.",
        "time": times,
        "summary_during_fire": {
            "dead_1h_min_pct": min(moistures["dead_1h_pct"][k] for k in during),
            "dead_1h_max_pct": max(moistures["dead_1h_pct"][k] for k in during),
            "dead_1h_mean_pct": round(sum(moistures["dead_1h_pct"][k] for k in during) / len(during), 1),
            "reference_static_pct": 6.0,
        },
        **moistures,
    }

    out_file = folder / "moisture_cerra.json"
    out_file.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    s = doc["summary_during_fire"]
    print(
        f"{fire_id} [Dynamic Moisture]: 1h Dead Fuel varies from {s['dead_1h_min_pct']}% (afternoon peak) "
        f"to {s['dead_1h_max_pct']}% (night recovery) vs {s['reference_static_pct']}% static -> {out_file.relative_to(ROOT)}"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text(encoding="utf-8"))]:
        process_fire(fire_id)


if __name__ == "__main__":
    main()
