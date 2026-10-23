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

--active-edge oracle|hotspots (with --active-window-h, as run.py) grows the ellipses from the active part of the edge
only, the same as a run with that option, and writes ref_rule10_<mode>.json (rule10 itself from that edge),
ref_persist_<mode>.json, ref_area_<mode>.json and shape_<cfg>.json: a model that knows which flanks are held must be
compared with references that know it too.

--shape-of K3 K5 ... adds shape_<cfg>.json: the model's shape against the ellipse's at the same area. In each window
both are cut to the same number of cells n = min(the model's growth, the observed growth), the first n cells each one
reaches, and scored against the observed growth: "model" and "ellipse", same n, so only where the fire goes differs,
not how fast. If the model wins here and loses on area, a real-time speed correction (satellite hotspots) is what it
needs; if it loses here too, fuel, terrain and wind add nothing over a downwind ellipse.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import types  # noqa: E402

from common import CACHE, HERE, evidence, fire_dir, fires  # noqa: E402
from run import held_edge  # noqa: E402
from scipy import ndimage  # noqa: E402
from steps import rule10, scores  # noqa: E402


def first_cells(t: np.ndarray, p0: np.ndarray, cells: int) -> np.ndarray:
    """The `cells` cells outside p0 that t reaches first (ties at the cut kept), plus p0."""
    t = np.where(np.isfinite(t), t, np.inf)
    return grown_to(t, p0, cells)


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
    p.add_argument("--shape-of", nargs="*", default=[], help="configurations whose shape to compare at equal area")
    p.add_argument("--active-edge", choices=["all", "hotspots", "oracle"], default="all")
    p.add_argument("--active-window-h", type=float, default=12.0)
    args = p.parse_args(argv)
    ids = args.fires or sorted(f.parent.parent.name for f in (HERE / "fires").glob(f"*/steps/{args.windows_from}.json"))
    for fid in ids:
        fire = fires.Fire(fid)
        src = json.loads((fire_dir(fid) / "steps" / f"{args.windows_from}.json").read_text())
        sfx = "" if args.active_edge == "all" else f"_{args.active_edge}"
        ev, feats = evidence(fid)
        out = {f"ref_persist{sfx}": [], f"ref_area{sfx}": [], **({f"ref_rule10{sfx}": []} if sfx else {})}
        shapes = {c: [] for c in args.shape_of}
        runs = {c: {w["k"]: w for w in json.loads(f.read_text())["windows"] if "model" in w}
                for c in args.shape_of if (f := fire_dir(fid) / "steps" / f"{c}.json").exists()}
        for w in src["windows"]:
            k, minutes = w["k"], w["minutes"]
            p0, p1 = fire.perimeter(k), fire.perimeter(k + 1)
            edge = None
            if sfx:
                held, _ = held_edge(fire, types.SimpleNamespace(active_edge=args.active_edge, start_step=k,
                                                                active_window_h=args.active_window_h), p0, ev, feats)
                if held.any():
                    edge = p0 & ~ndimage.binary_erosion(p0, structure=np.ones((3, 3), bool)) & ~held
            t = rule10(fire, p0, w["wind_to_deg"], w["wind_kmh"], edge)
            base = {key: v for key, v in w.items() if key not in ("model", "rule10")}
            sim = grown_to(t, p0, int((p1 & ~p0).sum()))
            for c, ws in runs.items():
                if k not in ws or not (CACHE / fid / f"st_{c}_{k}.npy").exists():
                    continue
                arr = np.load(CACHE / fid / f"st_{c}_{k}.npy")
                reached = np.isfinite(arr) & (arr <= minutes) & ~p0
                n = min(int(reached.sum()), int((p1 & ~p0).sum()))
                if n == 0:
                    continue
                shapes[c].append({**base, "cells": n,
                                  "model": scores(fire, p0, p1, first_cells(np.where(reached, arr, np.inf), p0, n), minutes),
                                  "ellipse": scores(fire, p0, p1, grown_to(t, p0, n), minutes)})
            out[f"ref_area{sfx}"].append({**base, "model": scores(fire, p0, p1, sim, minutes)})
            if sfx:
                out[f"ref_rule10{sfx}"].append({**base, "model": scores(fire, p0, p1, p0 | (t <= minutes), minutes)})
            if k >= 1:
                prev_cells = int((p0 & ~fire.perimeter(k - 1)).sum())
                prev_min = (fire.steps[k]["hours"] - fire.steps[k - 1]["hours"]) * 60
                target = int(round(prev_cells / max(prev_min, 1) * minutes))
                rec = {**base, "model": scores(fire, p0, p1, grown_to(t, p0, target), minutes),
                       "persist_rate_ha_h": round(prev_cells * fire.cellsize ** 2 / 1e4 / (prev_min / 60), 1)}
                out[f"ref_persist{sfx}"].append(rec)
        for c, ws in shapes.items():
            if c in runs:
                (fire_dir(fid) / "steps" / f"shape_{c}.json").write_text(json.dumps(
                    {"fire": fid, "name": f"shape_{c}", "of": c, "windows": ws}, indent=1, ensure_ascii=False))
                if ws:
                    print(f"  shape {c}: model S {np.median([w['model']['sorensen_growth'] for w in ws]):.2f} vs ellipse "
                          f"{np.median([w['ellipse']['sorensen_growth'] for w in ws]):.2f} at equal area ({len(ws)} windows)")
        for name, ws in out.items():
            (fire_dir(fid) / "steps" / f"{name}.json").write_text(json.dumps(
                {"fire": fid, "name": name, "windows_from": args.windows_from, "windows": ws}, indent=1, ensure_ascii=False))
        sg = lambda ws: np.median([w["model"]["sorensen_growth"] for w in ws]) if ws else float("nan")  # noqa: E731
        rt = lambda ws: np.median([w["model"]["ratio"] for w in ws]) if ws else float("nan")  # noqa: E731
        print(f"{fid:30s} persist: {len(out[f'ref_persist{sfx}'])} windows, area x{rt(out[f'ref_persist{sfx}']):.2f}, "
              f"S {sg(out[f'ref_persist{sfx}']):.2f} | area-oracle ellipse: S {sg(out[f'ref_area{sfx}']):.2f}", flush=True)


if __name__ == "__main__":
    main()
