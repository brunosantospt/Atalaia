"""An ensemble of the step-by-step runs: burn probability per window, and whether it beats any single member.

    hindcast/.venv/bin/python -I hindcast/ensemble.py --members K3m K3m_w08 K3m_w125 K5m K5m_w08 K5m_w125 K5m_rm15 K5m_rp15

Each member is a configuration already run by steps.py (fires/<id>/steps/<member>.json, arrival grids in
data/hindcast/<id>/st_<member>_<k>.npy). For every window k the burn probability P of a cell is the share of members
that burned it by the next observed step; the observed growth G is what burned between the two perimeters. Scored
over the cells either touched (G or P > 0), per window and pooled:

  brier        mean (P - G)^2: the ensemble's; the members', each a 0/1 forecast (lower is better)
  sorensen_p50 Sørensen of P >= 0.5 against G (the ensemble's "median" fire); the best and the median member's
  hit_p50      share of G with P >= 0.5; hit_any: share of G that some member burned (the envelope)
  bracket      the observed growth area lies between the smallest and the largest member's
  ratio_p50    area of P >= 0.5 / area of G
  rule10       the model-free bar (steps.py: 10 % of the wind, an ellipse downwind of the start perimeter): its Brier
               (a 0/1 forecast) and growth Sørensen on the same windows. An ensemble that does not beat it is not
               worth its cost.

It is the approach of the operational systems: Pinto et al. 2016 (FARSITE, 100 members, Portugal) and Pyrecast
(ELMFIRE, members perturbing wind, moisture and spotting). Writes hindcast/ensemble.json and prints the summary.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, HERE, fires, sorensen  # noqa: E402
from steps import rule10  # noqa: E402


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--members", nargs="+", required=True)
    p.add_argument("--min-ha", type=float, default=5.0, help="windows with at least this observed growth")
    p.add_argument("--name", default="ensemble")
    args = p.parse_args(argv)

    out, pooled = [], {"brier_ens": [], "brier_members": [], "s_p50": [], "s_best": [], "s_median_member": [],
                       "hit_p50": [], "hit_any": [], "bracket": [], "ratio_p50": [], "brier_rule10": [],
                       "s_rule10": []}
    for fdir in sorted((HERE / "fires").iterdir()):
        files = [fdir / "steps" / f"{m}.json" for m in args.members]
        if not all(f.exists() for f in files):
            continue
        fire = fires.Fire(fdir.name)
        windows = [{w["k"]: w for w in json.loads(f.read_text())["windows"]} for f in files]
        for k in sorted(set.intersection(*[set(w) for w in windows])):
            minutes = windows[0][k]["minutes"]
            p0, p1 = fire.perimeter(k), fire.perimeter(k + 1)
            g = p1 & ~p0
            if g.sum() * fire.cellsize ** 2 / 1e4 < args.min_ha:
                continue
            masks = []
            for m in args.members:
                a = np.load(CACHE / fdir.name / f"st_{m}_{k}.npy")
                masks.append(np.isfinite(a) & (a <= minutes) & ~p0)
            P = np.mean(masks, axis=0)
            w = windows[0][k]
            r10 = (rule10(fire, p0, w["wind_to_deg"], w["wind_kmh"]) <= minutes) & ~p0
            dom = g | (P > 0) | r10
            brier_ens = float(((P[dom] - g[dom]) ** 2).mean())
            brier_m = [float(((m[dom].astype(float) - g[dom]) ** 2).mean()) for m in masks]
            s_m = [sorensen(g, m) for m in masks]
            areas = [int(m.sum()) for m in masks]
            brier_r10 = float(((r10[dom].astype(float) - g[dom]) ** 2).mean())
            rec = {"fire": fdir.name, "k": k, "minutes": minutes, "growth_obs_ha": round(float(g.sum()) * 0.09, 1),
                   "brier_ens": round(brier_ens, 4), "brier_members": [round(b, 4) for b in brier_m],
                   "sorensen_p50": sorensen(g, P >= 0.5), "sorensen_members": s_m,
                   "hit_p50": round(float(P[g].__ge__(0.5).mean()), 3), "hit_any": round(float((P[g] > 0).mean()), 3),
                   "bracket": bool(min(areas) <= g.sum() <= max(areas)),
                   "ratio_p50": round(float((P >= 0.5).sum()) / max(1, int(g.sum())), 3),
                   "brier_rule10": round(brier_r10, 4), "sorensen_rule10": sorensen(g, r10)}
            out.append(rec)
            pooled["brier_ens"].append(brier_ens)
            pooled["brier_members"].append(brier_m)
            pooled["s_p50"].append(rec["sorensen_p50"])
            pooled["s_best"].append(max(s_m))
            pooled["s_median_member"].append(float(np.median(s_m)))
            for key in ("hit_p50", "hit_any", "bracket", "ratio_p50"):
                pooled[key].append(rec[key])
            pooled["brier_rule10"].append(brier_r10)
            pooled["s_rule10"].append(rec["sorensen_rule10"])
    if not out:
        raise SystemExit("no window has every member")
    bm = np.array(pooled["brier_members"])
    summary = {
        "members": args.members, "windows": len(out), "fires": sorted({r["fire"] for r in out}),
        "brier_ensemble_median": round(float(np.median(pooled["brier_ens"])), 4),
        "brier_member_medians": {m: round(float(np.median(bm[:, i])), 4) for i, m in enumerate(args.members)},
        "ensemble_beats_every_member_brier_share": round(float(np.mean([e <= min(b) for e, b in
                                                                       zip(pooled["brier_ens"], pooled["brier_members"])])), 3),
        "sorensen_p50_median": round(float(np.median(pooled["s_p50"])), 3),
        "sorensen_median_member_median": round(float(np.median(pooled["s_median_member"])), 3),
        "sorensen_best_member_median (oracle)": round(float(np.median(pooled["s_best"])), 3),
        "hit_p50_median": round(float(np.median(pooled["hit_p50"])), 3),
        "hit_any_median": round(float(np.median(pooled["hit_any"])), 3),
        "bracket_share": round(float(np.mean(pooled["bracket"])), 3),
        "ratio_p50_median": round(float(np.median(pooled["ratio_p50"])), 3),
        "brier_rule10_median": round(float(np.median(pooled["brier_rule10"])), 4),
        "sorensen_rule10_median": round(float(np.median(pooled["s_rule10"])), 3),
        "ensemble_beats_rule10_brier_share": round(float(np.mean([e < r for e, r in
                                                                  zip(pooled["brier_ens"], pooled["brier_rule10"])])), 3),
        "ensemble_beats_rule10_sorensen_share": round(float(np.mean([e > r for e, r in
                                                                     zip(pooled["s_p50"], pooled["s_rule10"])])), 3),
    }
    (HERE / f"{args.name}.json").write_text(json.dumps({"summary": summary, "windows": out}, indent=1))
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
