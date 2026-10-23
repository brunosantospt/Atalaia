"""Spread adjustment per fuel class learned from the other fires (leave one fire out), for run.py --adj-class.

    hindcast/.venv/bin/python -I hindcast/calibrate.py --steps K5

Reads the step-by-step windows of a configuration (fires/<id>/steps/<cfg>.json, steps.py) and, for every window
with at least --min-ha of observed growth, the error of its head ROS, y = ln(ROS observed / ROS run), and the share of
each fuel class in the observed growth, x_c. ELMFIRE's rate of spread scales with its adjustment factor, so the fit is
y ~ sum_c x_c a_c (least squares, a small ridge pulling each a_c towards 0, i.e. no change), and adj_c = exp(a_c),
kept within [0.5, 2.2] (ELMFIRE burns nothing from about 2.5). A run that did not grow at all has its ROS floored at
one cell over the window (dropping it would hide the worst under-predictions), and y is clipped to +-ln 4 so that one
window cannot carry the fit. A factor capped at 2.2 cannot close a gap of x10 or more: that is a fuel map or fuel
model failure, not a tuning one.

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
CELL_M = 30.0
CLIP = math.log(4)


def rows(cfg: str, min_ha: float):
    out = []
    for f in sorted(FIRES.glob(f"*/steps/{cfg}.json")):
        fire = f.parent.parent.name
        for w in json.loads(f.read_text())["windows"]:
            m = w.get("model")
            if not m or m["growth_obs_ha"] < min_ha or m["ros_obs"] <= 0:
                continue
            x = [w["growth_fuel"].get(name, 0.0) for _, name in CLASSES]
            if sum(x) < 0.5:   # mostly non-burnable or unknown: says nothing about a class
                continue
            ros_run = max(m["ros_run"], CELL_M / (w["minutes"] / 60))
            y = float(np.clip(math.log(m["ros_obs"] / ros_run), -CLIP, CLIP))
            out.append((fire, np.array(x), y))
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
    folds = []
    for fire in fires:
        train = [d for d in data if d[0] != fire]
        a = fit(train, args.ridge)
        folds.append(np.clip(np.exp(a), 0.5, 2.2))
        (FIRES / fire / f"adj_lofo_{args.steps}.json").write_text(json.dumps(
            {"adj_class": as_arg(a), "fitted_on": sorted({d[0] for d in train}), "windows": len(train),
             "steps": args.steps}, indent=1))
        print(f"  {fire:28s} {as_arg(a)}")
    folds = np.array(folds)
    spread = {k: [round(float(folds[:, i].min()), 2), round(float(folds[:, i].max()), 2)] for i, (k, _) in enumerate(CLASSES)}
    support = {k: round(float(sum(x[i] for _, x, _ in data)), 1) for i, (k, _) in enumerate(CLASSES)}
    print(f"  range over the folds: {spread}")
    print(f"  windows' worth of each class: {support}")
    doc = json.loads((FIRES / f"adj_all_{args.steps}.json").read_text())
    doc.update({"fold_range": spread, "class_support_windows": support,
                "residual_ln_before": round(float(np.median(np.abs([y for _, _, y in data]))), 3),
                "residual_ln_after": round(float(np.median(np.abs([y - x @ a_all for _, x, y in data]))), 3)})
    (FIRES / f"adj_all_{args.steps}.json").write_text(json.dumps(doc, indent=1))
    print(f"  median |ln error|: {doc['residual_ln_before']} -> {doc['residual_ln_after']} (in sample)")


if __name__ == "__main__":
    main()
