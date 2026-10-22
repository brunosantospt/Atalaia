"""Naive references for the scores: step 0's perimeter grown to the observed area of each step, with no model.

    hindcast/.venv/bin/python -I hindcast/baseline.py VieiradoMinho_10082016

Both are given the observed area at each step (common.observed_arrival), which no model has, and know nothing of
fuel or terrain, so they get the area right and the shape only as well as their rule allows:

  b_uniforme  the same distance in every direction (a circle around step 0)
  b_vento     an ellipse downwind of the run's mean wind (the wind vectors of weather.json, step 0 to the last step,
              averaged), with step 0 at its rear focus and the length-to-breadth ratio of Alexander (1985) for that
              mean 10 m speed: LB = 1 + 8.729 (1 - exp(-0.030 U))^2.155, U in km/h

The fire reaches a cell when its distance from step 0 (the ellipse's: |v| - e v.u, e its eccentricity, u downwind)
reaches the one that gives that step's area, linear in between. Scored like a run (common.score): a model's Sørensen
means something only by how far it is above these.

Writes hindcast/fires/<id>/runs/b_*/result.json and preview.png, and data/hindcast/<id>/b_*.npy, so that grid.py and
table.py take them like runs.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, alert_offset_min, evidence, fire_dir, fires, observed_arrival, score  # noqa: E402
from run import preview  # noqa: E402


def grow(fire: fires.Fire, dist: np.ndarray) -> np.ndarray:
    """Minutes after step 0 at which a growth by `dist` (0 inside step 0) reaches each cell, given the observed
    area at each step; NaN beyond the last step's area."""
    obs = observed_arrival(fire)
    order = np.sort(dist.ravel())
    reach, minutes = [0.0], [0.0]
    for s in fire.steps[1:]:
        n = int((obs <= s["hours"] * 60).sum())
        r = float(order[min(n, order.size) - 1])
        if r > reach[-1]:   # a step that adds no area adds no point (np.interp needs them increasing)
            reach.append(r)
            minutes.append(s["hours"] * 60)
    arrival = np.interp(dist, reach, minutes)
    arrival[dist > reach[-1]] = np.nan
    return arrival


def mean_wind(fire: fires.Fire) -> tuple[float, float, float]:
    """The run's wind, half-hourly from step 0 to the last step: the direction it blows to (degrees from north) of
    the mean wind vector, that vector's speed and the mean speed (km/h)."""
    w = fire.weather(fires.parse_time(fire.steps[0]["time"]), list(np.arange(0, fire.steps[-1]["hours"] * 60 + 1, 30)))
    to = np.radians([x["wind_from_deg"] + 180 for x in w])
    s = np.array([x["wind_kmh"] for x in w])
    east, north = float((s * np.sin(to)).mean()), float((s * np.cos(to)).mean())
    return math.degrees(math.atan2(east, north)) % 360, math.hypot(east, north), float(s.mean())


def downwind(fire: fires.Fire) -> tuple[np.ndarray, dict]:
    to, vector_kmh, speed_kmh = mean_wind(fire)
    lb = 1 + 8.729 * (1 - math.exp(-0.030 * speed_kmh)) ** 2.155
    e = math.sqrt(1 - 1 / lb ** 2)
    u = np.array([-math.cos(math.radians(to)), math.sin(math.radians(to))])   # (rows, cols); row 0 is north
    start = fire.perimeter(0)
    edge = np.argwhere(start & ~ndimage.binary_erosion(start))   # the nearest point of step 0 is on its edge
    rows, cols = np.indices((fire.rows, fire.cols))
    cell = np.stack([rows.ravel(), cols.ravel()], -1).astype(float)
    dist = np.full(len(cell), np.inf)
    for k in range(0, len(edge), 64):
        v = cell[:, None, :] - edge[None, k:k + 64, :]
        dist = np.minimum(dist, (np.hypot(v[..., 0], v[..., 1]) - e * (v @ u)).min(1))
    dist = dist.reshape(fire.rows, fire.cols)
    dist[start] = 0.0
    return dist, {"wind_to_deg": round(to, 1), "mean_vector_kmh": round(vector_kmh, 1),
                  "mean_speed_kmh": round(speed_kmh, 1), "length_to_breadth": round(lb, 2)}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    ev, feats = evidence(args.fire)
    wind, shape_ = downwind(fire)
    refs = {"b_uniforme": (ndimage.distance_transform_edt(~fire.perimeter(0)), {},
                           "a mesma distância em todas as direções"),
            "b_vento": (wind, shape_, f"elipse a favor do vento médio (para {shape_['wind_to_deg']:.0f}°, "
                                      f"{shape_['mean_speed_kmh']:.0f} km/h, LB {shape_['length_to_breadth']:.1f})")}
    raw = CACHE / args.fire
    raw.mkdir(parents=True, exist_ok=True)
    for name, (dist, info, how) in refs.items():
        arrival = grow(fire, dist)
        stats = score(fire, arrival, feats, alert_offset_min(fire, ev))
        out = fire_dir(args.fire) / "runs" / name
        out.mkdir(parents=True, exist_ok=True)
        result = {"fire": args.fire, "name": name, "start": fire.steps[0]["time"],
                  "duration_min": fire.steps[-1]["hours"] * 60, "options": {**vars(args), **info},
                  "engine": "none: step 0 grown to the observed area of each step (hindcast/baseline.py)",
                  "barriers": 0, "stretches": 0, "runtime_s": 0.0, "wall_s": 0.0,
                  "notes": [f"referência ingénua com a área observada de cada passo: {how}"], "stats": stats}
        (out / "result.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
        np.save(raw / f"{name}.npy", arrival.astype(np.float32))
        preview(out / "preview.png", fire, arrival, [f for f in feats if f["properties"]["kind"] != "scar"], [])
        print(f"{name}: Sørensen por passo "
              + ", ".join(f"{x['h']:g} h {x['sorensen']}" for x in stats["sorensen_by_step"])
              + f" | oficial {stats.get('sorensen_official')}, fora {stats.get('outside_official_ha')} ha"
              + f" | satélite {stats.get('satellite', {}).get('mean_reached')} | {how}")


if __name__ == "__main__":
    main()
