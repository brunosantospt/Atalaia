"""Two model-free forecasts of each step-by-step window, scored like the model: fires/<id>/steps/ref_*.json.

    hindcast/.venv/bin/python -I hindcast/references.py            # every fire with steps/K3.json
    hindcast/.venv/bin/python -I hindcast/references.py --windows-from K5 Guarda_23082017

Both grow the same shape as rule10 (steps.py: an ellipse downwind of step k's perimeter, Alexander's length-to-breadth
for the window's mean wind) and stop it at a given area, so they only differ from rule10 in how far the fire gets:

  ref_persist  the area the fire grew per hour in the previous observed window, times this window's length: what a
               duty officer would say knowing only the last two perimeters ("it keeps going as it went"). From the
               second window on (k >= 1).
  ref_area     the observed growth area itself (it cheats: it knows the answer's size). Like b_vento for the free runs,
               it is the score of the right area in a shape with no fuel and no terrain: a model that does not beat it
               adds nothing but the area.

The windows (k, length, mean wind) are those of an existing step run (--windows-from, K3 by default), so the scores
pair window by window with the model's. Same record as steps.py, with the reference's scores under "model".
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, fire_dir, fires  # noqa: E402
from steps import rule10, scores  # noqa: E402


def grown_to(t: np.ndarray, p0: np.ndarray, cells: int) -> np.ndarray:
    """The ellipse fire (rule10 times t) stopped when it has burned `cells` new cells."""
    free = t[~p0]
    if cells <= 0 or not len(free):
        return p0.copy()
    thr = np.partition(free, min(cells, len(free)) - 1)[min(cells, len(free)) - 1]
    return p0 | (t <= thr)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fires", nargs="*")
    p.add_argument("--windows-from", default="K3")
    args = p.parse_args(argv)
    ids = args.fires or sorted(f.parent.parent.name for f in (HERE / "fires").glob(f"*/steps/{args.windows_from}.json"))
    for fid in ids:
        fire = fires.Fire(fid)
        src = json.loads((fire_dir(fid) / "steps" / f"{args.windows_from}.json").read_text())
        out = {"ref_persist": [], "ref_area": []}
        for w in src["windows"]:
            k, minutes = w["k"], w["minutes"]
            p0, p1 = fire.perimeter(k), fire.perimeter(k + 1)
            t = rule10(fire, p0, w["wind_to_deg"], w["wind_kmh"])
            base = {key: v for key, v in w.items() if key not in ("model", "rule10")}
            sim = grown_to(t, p0, int((p1 & ~p0).sum()))
            out["ref_area"].append({**base, "model": scores(fire, p0, p1, sim, minutes)})
            if k >= 1:
                prev_cells = int((p0 & ~fire.perimeter(k - 1)).sum())
                prev_min = (fire.steps[k]["hours"] - fire.steps[k - 1]["hours"]) * 60
                target = int(round(prev_cells / max(prev_min, 1) * minutes))
                rec = {**base, "model": scores(fire, p0, p1, grown_to(t, p0, target), minutes),
                       "persist_rate_ha_h": round(prev_cells * fire.cellsize ** 2 / 1e4 / (prev_min / 60), 1)}
                out["ref_persist"].append(rec)
        for name, ws in out.items():
            (fire_dir(fid) / "steps" / f"{name}.json").write_text(json.dumps(
                {"fire": fid, "name": name, "windows_from": args.windows_from, "windows": ws}, indent=1, ensure_ascii=False))
        sg = lambda ws: np.median([w["model"]["sorensen_growth"] for w in ws]) if ws else float("nan")  # noqa: E731
        rt = lambda ws: np.median([w["model"]["ratio"] for w in ws]) if ws else float("nan")  # noqa: E731
        print(f"{fid:30s} persist: {len(out['ref_persist'])} windows, area x{rt(out['ref_persist']):.2f}, "
              f"S {sg(out['ref_persist']):.2f} | area-oracle ellipse: S {sg(out['ref_area']):.2f}", flush=True)


if __name__ == "__main__":
    main()
