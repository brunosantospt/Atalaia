"""The operational test: restart from each observed step and forecast to the next one, as a real-time system would.

    hindcast/.venv/bin/python -I hindcast/steps.py VieiradoMinho_10082016 --name K3 -- --fuels sb --scars

For each observed step k (k = 0 .. n-2) the model starts from the perimeter of step k (run.py --start-step k) and runs
to step k+1. Only the growth counts: the cells burned between the two perimeters, observed against simulated, so the
shared starting perimeter cannot inflate the score. Per window it writes:

  growth_obs_ha, growth_run_ha, ratio        the new area, and run / observed
  sorensen_growth                            Sørensen of the new area alone
  reach_obs_m, reach_run_m, ros_obs, ros_run how far the growth goes beyond step k's perimeter (95th percentile of
                                             the distance) and that over the window, m/h: a head ROS proxy
  conditions                                 window length, local hour, mean 10 m wind (speed and direction it comes
                                             from), temperature, humidity, the fuel classes and slope of the observed
                                             growth

Every window is also forecast by rule10, a model with no fuel and no terrain: Cruz & Alexander's (2019) rule of thumb
that a wildfire's head spreads at 10 % of the 10 m open wind speed, grown as an ellipse downwind of step k's perimeter
(Alexander 1985 length-to-breadth for that wind; the window's mean wind vector, its mean speed). It is the bar a fire
model has to clear.

Online correction (what a real-time system can do with the last two perimeters): with --assimilate-from CFG among the
arguments after "--", window k runs with --adj (ratio_{k-1})^-beta, where ratio_{k-1} is the growth area ratio (run /
observed) of the uncorrected run CFG in the previous window (fires/<id>/steps/<CFG>.json), beta from
--assimilate-beta (0.5 by default: the error carries over only partly, rho ~0.6 between windows of up to 6 h), the
factor kept within [0.3, 2.2]. With no previous window the factor is 1.

The run.py arguments after "--" are the configuration (the same in every window). Writes
hindcast/fires/<id>/steps/<name>.json; the runs go to fires/<id>/runs/st_<name>_<k>/ and data/hindcast/<id>/.
"""

import argparse
import json
import math
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, HERE, fire_dir, fires, sorensen  # noqa: E402

PY = sys.executable


def mean_wind(fire, start, minutes: float) -> tuple[float, float, float]:
    """Over [start, start + minutes]: the direction the mean wind vector blows to (deg from north), its speed, and the
    mean speed (km/h)."""
    w = fire.weather(start, list(np.arange(0, minutes + 1, 30)))
    to = np.radians([x["wind_from_deg"] + 180 for x in w])
    s = np.array([x["wind_kmh"] for x in w])
    east, north = float((s * np.sin(to)).mean()), float((s * np.cos(to)).mean())
    return math.degrees(math.atan2(east, north)) % 360, math.hypot(east, north), float(s.mean())


def rule10(fire, start_mask: np.ndarray, to_deg: float, speed_kmh: float) -> np.ndarray:
    """Minutes for an elliptical fire (head ROS = 10 % of the wind, Alexander's length-to-breadth) to reach each cell
    from the nearest point of start_mask's edge. A point p is reached at time t when, along the wind (x) and across
    it (y) from the source, ((x - c t) / (a t))^2 + (y / (b t))^2 <= 1; solved for t in closed form."""
    head = 0.10 * speed_kmh * 1000 / 60                     # m/min
    lb = 1 + 8.729 * (1 - math.exp(-0.030 * speed_kmh)) ** 2.155
    hb = (lb + math.sqrt(lb * lb - 1)) / (lb - math.sqrt(lb * lb - 1))
    back = head / hb
    a = (head + back) / 2
    b = a / lb
    c = a - back
    A = 1 - c * c / (a * a)
    u = np.array([-math.cos(math.radians(to_deg)), math.sin(math.radians(to_deg))])   # (row, col) downwind
    n = np.array([u[1], -u[0]])
    edge = np.argwhere(start_mask & ~ndimage.binary_erosion(start_mask)).astype(float)
    if len(edge) > 1500:
        edge = edge[np.linspace(0, len(edge) - 1, 1500).astype(int)]
    rows, cols = np.indices(start_mask.shape)
    cell = np.stack([rows.ravel(), cols.ravel()], -1).astype(float)
    t = np.full(len(cell), np.inf)
    chunk = int(np.clip(2e7 // len(cell), 8, 128))          # edge points at a time: ~1 GB at most on a large grid
    for k in range(0, len(edge), chunk):
        v = (cell[:, None, :] - edge[None, k:k + chunk, :]) * fire.cellsize
        x, y = v @ u, v @ n
        q = x * c / (a * a)
        tt = (-q + np.sqrt(q * q + A * (x * x / (a * a) + y * y / (b * b)))) / A
        t = np.minimum(t, tt.min(1))
    t = t.reshape(start_mask.shape)
    t[start_mask] = 0.0
    return t


def window(fire, k: int, legend: list, idx: np.ndarray, slope: np.ndarray) -> dict:
    s0, s1 = fire.steps[k], fire.steps[k + 1]
    minutes = (s1["hours"] - s0["hours"]) * 60
    start = fires.parse_time(s0["time"])
    p0, p1 = fire.perimeter(k), fire.perimeter(k + 1)
    to, vec, speed = mean_wind(fire, start, minutes)
    w = json.loads((fire.folder / "weather.json").read_text())
    hrs = np.array([(fires.parse_time(t) - start).total_seconds() / 60 for t in w["time"]])
    mids = np.arange(0, minutes + 1, 30)
    temp = float(np.interp(mids, hrs, w["tempC"]).mean())
    rh = float(np.interp(mids, hrs, w["rhPct"]).mean())
    gust = float(np.interp(mids, hrs, w["gustKmh"]).mean()) if "gustKmh" in w else None
    growth = p1 & ~p0
    classes = np.array([l["class"] for l in legend])[idx]
    names = json.loads((fire.folder / "fuel.json").read_text())["classes"]
    frac = {names[c]: round(float((classes[growth] == c).mean()), 2) for c in range(len(names))} if growth.any() else {}
    return {"k": k, "start": s0["time"], "end": s1["time"], "minutes": minutes,
            "mid_hour": (start + timedelta(minutes=minutes / 2)).hour,
            "wind_to_deg": round(to, 1), "wind_from_deg": round((to + 180) % 360, 1), "wind_kmh": round(speed, 1),
            "wind_vector_kmh": round(vec, 1), "gust_kmh": round(gust, 1) if gust is not None else None,
            "temp_c": round(temp, 1), "rh_pct": round(rh, 0), "start_ha": round(float(p0.sum()) * fire.cellsize ** 2 / 1e4, 1),
            "growth_fuel": frac, "growth_slope_deg": round(float(slope[growth].mean()), 1) if growth.any() else None}


def scores(fire, p0, p1, sim, minutes):
    """Growth scores of a simulated burned mask against the observed one."""
    growth_obs = p1 & ~p0
    growth_sim = sim & ~p0
    d = ndimage.distance_transform_edt(~p0) * fire.cellsize
    ha = fire.cellsize ** 2 / 1e4
    reach = lambda m: float(np.percentile(d[m], 95)) if m.any() else 0.0   # noqa: E731
    ro, rs = reach(growth_obs), reach(growth_sim)
    return {"growth_obs_ha": round(float(growth_obs.sum()) * ha, 1), "growth_run_ha": round(float(growth_sim.sum()) * ha, 1),
            "ratio": round(float(growth_sim.sum()) / max(1, int(growth_obs.sum())), 3),
            "sorensen_growth": sorensen(growth_obs, growth_sim), "sorensen_total": sorensen(p1, sim | p0),
            "reach_obs_m": round(ro), "reach_run_m": round(rs),
            "ros_obs": round(ro / (minutes / 60)), "ros_run": round(rs / (minutes / 60))}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    extra = argv[argv.index("--") + 1:] if "--" in argv else []
    argv = argv[:argv.index("--")] if "--" in argv else argv
    assim, beta = None, 0.5
    if "--assimilate-from" in extra:
        i = extra.index("--assimilate-from")
        assim = extra[i + 1]
        extra = extra[:i] + extra[i + 2:]
    if "--assimilate-beta" in extra:
        i = extra.index("--assimilate-beta")
        beta = float(extra[i + 1])
        extra = extra[:i] + extra[i + 2:]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--name", required=True)
    p.add_argument("--min-minutes", type=float, default=30, help="skip windows shorter than this")
    p.add_argument("--max-minutes", type=float, default=24 * 60, help="skip windows longer than this")
    p.add_argument("--no-model", action="store_true", help="only rule10 and the conditions (no ELMFIRE)")
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    prev = {}
    if assim:
        prev = {w["k"]: w["model"]["ratio"] for w in
                json.loads((fire_dir(args.fire) / "steps" / f"{assim}.json").read_text())["windows"] if "model" in w}
    legend = json.loads((fire.folder / "fuel.json").read_text())["legend"]
    idx = fire.read("fuel.u8", "u1")
    slope = fire.read("slope.u8", "u1").astype(float)
    out = []
    for k in range(len(fire.steps) - 1):
        minutes = (fire.steps[k + 1]["hours"] - fire.steps[k]["hours"]) * 60
        if not args.min_minutes <= minutes <= args.max_minutes:
            continue
        p0, p1 = fire.perimeter(k), fire.perimeter(k + 1)
        if not (p1 & ~p0).any():
            continue
        rec = window(fire, k, legend, idx, slope)
        t10 = rule10(fire, p0, rec["wind_to_deg"], rec["wind_kmh"])
        rec["rule10"] = scores(fire, p0, p1, t10 <= minutes, minutes)
        if not args.no_model:
            name = f"st_{args.name}_{k}"
            more = []
            if assim:
                adj = float(np.clip(max(prev.get(k - 1, 1.0), 0.01) ** -beta, 0.3, 2.2)) if k - 1 in prev else 1.0
                rec["assim_adj"] = round(adj, 3)
                more = ["--adj", f"{adj:.3f}"]
            done = subprocess.run([PY, "-I", str(HERE / "run.py"), args.fire, "--name", name, "--start-step", str(k),
                                   "--duration-min", str(minutes), "--no-preview", *extra, *more],
                                  capture_output=True, text=True)
            if done.returncode != 0:
                print(f"  k={k}: run.py failed: {done.stderr.strip().splitlines()[-1:]}")
                continue
            arr = np.load(CACHE / args.fire / f"{name}.npy")
            rec["model"] = scores(fire, p0, p1, np.isfinite(arr) & (arr <= minutes), minutes)
        out.append(rec)
        m = rec.get("model", {})
        print(f"  k={k:2d} {rec['start'][5:]} +{minutes / 60:4.1f} h wind {rec['wind_kmh']:4.1f} km/h | obs "
              f"{rec['rule10']['growth_obs_ha']:7.1f} ha ROS {rec['rule10']['ros_obs']:5d} | model "
              f"{m.get('growth_run_ha', float('nan')):7.1f} ha ROS {m.get('ros_run', 0):5d} S {m.get('sorensen_growth', 0):.2f}"
              f" | rule10 {rec['rule10']['growth_run_ha']:7.1f} ha S {rec['rule10']['sorensen_growth']:.2f}", flush=True)
    d = fire_dir(args.fire) / "steps"
    d.mkdir(exist_ok=True)
    (d / f"{args.name}.json").write_text(json.dumps({"fire": args.fire, "name": args.name, "run_args": extra,
                                                     "assimilate_from": assim, "assimilate_beta": beta if assim else None,
                                                     "windows": out}, indent=1, ensure_ascii=False))
    print(f"-> {d / (args.name + '.json')}")


if __name__ == "__main__":
    main()
