"""Spread adjustment per fuel class learned from the other fires (leave one fire out), for run.py --adj-class.

    hindcast/.venv/bin/python -I hindcast/calibrate.py --steps K5

Reads the step-by-step windows of a configuration (fires/<id>/steps/<cfg>.json, steps.py) and, for every window
with at least --min-ha of observed growth, the error of its head ROS, y = ln(ROS observed / ROS run), and the share of
each fuel class in the observed growth, x_c. ELMFIRE's rate of spread scales with its adjustment factor, so the fit is
y ~ sum_c x_c a_c (least squares, a small ridge pulling each a_c towards 0, i.e. no change), and adj_c = exp(a_c),
kept within [0.5, 2.2] (ELMFIRE burns nothing from about 2.5).

Each fire gets the factors fitted on the other fires only, so a run with them is a fair forecast of that fire:
fires/<id>/adj_lofo_<cfg>.json holds {"adj_class": "herb=..,shrub=..,euc=..,forest=..", "fitted_on": [...]}.
All fires together go to fires/adj_all_<cfg>.json (for a new fire). multifire_runs.sh reads the per-fire file for the
configurations that use @ADJ_LOFO@.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
FIRES = HERE / "fires"
CLASSES = [("herb", "Herbáceo"), ("shrub", "Mato"), ("euc", "Eucalipto e acácia"), ("forest", "Pinhal e folhosas")]


def rows(cfg: str, min_ha: float):
    out = []
    for f in sorted(FIRES.glob(f"*/steps/{cfg}.json")):
        fire = f.parent.parent.name
        for w in json.loads(f.read_text())["windows"]:
            m = w.get("model")
            if not m or m["growth_obs_ha"] < min_ha or m["ros_obs"] <= 0 or m["ros_run"] <= 0:
                continue
            x = [w["growth_fuel"].get(name, 0.0) for _, name in CLASSES]
            if sum(x) < 0.5:   # mostly non-burnable or unknown: says nothing about a class
                continue
            out.append((fire, np.array(x), math.log(m["ros_obs"] / m["ros_run"])))
    return out


def fit(data, ridge: float) -> np.ndarray:
    X = np.array([x for _, x, _ in data])
    y = np.array([v for _, _, v in data])
    return np.linalg.solve(X.T @ X + ridge * np.eye(X.shape[1]), X.T @ y)


def as_arg(a: np.ndarray) -> str:
    return ",".join(f"{k}={float(np.clip(math.exp(v), 0.5, 2.2)):.2f}" for (k, _), v in zip(CLASSES, a))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--steps", default="K5", help="the configuration whose step windows are fitted")
    p.add_argument("--min-ha", type=float, default=5.0)
    p.add_argument("--ridge", type=float, default=1.0)
    args = p.parse_args(argv)
    data = rows(args.steps, args.min_ha)
    fires = sorted({f for f, _, _ in data})
    print(f"{len(data)} windows from {len(fires)} fires")
    a_all = fit(data, args.ridge)
    (FIRES / f"adj_all_{args.steps}.json").write_text(json.dumps(
        {"adj_class": as_arg(a_all), "fitted_on": fires, "windows": len(data), "steps": args.steps}, indent=1))
    print(f"  all fires:  {as_arg(a_all)}")
    for fire in fires:
        train = [d for d in data if d[0] != fire]
        a = fit(train, args.ridge)
        (FIRES / fire / f"adj_lofo_{args.steps}.json").write_text(json.dumps(
            {"adj_class": as_arg(a), "fitted_on": sorted({d[0] for d in train}), "windows": len(train),
             "steps": args.steps}, indent=1))
        print(f"  {fire:28s} {as_arg(a)}")


if __name__ == "__main__":
    main()
