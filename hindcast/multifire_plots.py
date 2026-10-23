"""Three panels of the nine-fire test: hindcast/multifire_plots.png.

    hindcast/.venv/bin/python -I hindcast/multifire_plots.py     (needs matplotlib)

1. the first hours: area of each step window starting within 4 h of step 0 (and at most 4 h long), model / observed,
   for the API (K3), the Portuguese fuels (K5) and the 10 % rule;
2. the free runs: Sørensen at the last observed step per fire (no Monchique), with the naive ellipse that knows the area;
3. the active edge: growth Sørensen per window, whole edge (K5), satellite hotspots (K5a) and the true edge (K5o).
"""

import glob
import json
import sys
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import fires  # noqa: E402

NAMES = {"VilaNovadeCerveira": "Cerveira", "CabeceirasdeBasto": "Cabeceiras", "VieiradoMinho": "Vieira",
         "SeverdoVouga": "Sever", "ViladeRei": "Vila de Rei", "CastroMarim": "Castro Marim"}


def steps(f, c):
    p = HERE / "fires" / f / "steps" / f"{c}.json"
    return {w["k"]: w for w in json.loads(p.read_text())["windows"] if "model" in w} if p.exists() else {}


def main():
    rng = np.random.default_rng(0)
    F = sorted(Path(p).parent.parent.name for p in glob.glob(str(HERE / "fires/*/steps/K3.json")))
    FF = [f for f in F if f != "Monchique_03082018"]
    fig, ax = plt.subplots(1, 3, figsize=(18, 5.5))

    early = {"K3 (API)": [], "K5 (PT fuels)": [], "10 % rule": []}
    for f in F:
        fire = fires.Fire(f)
        a, b = steps(f, "K3"), steps(f, "K5")
        for k, w in a.items():
            if fire.steps[k]["hours"] <= 4 and w["minutes"] <= 240 and k in b:
                o = w["model"]["growth_obs_ha"]
                early["K3 (API)"].append(max(w["model"]["growth_run_ha"], .5) / o)
                early["K5 (PT fuels)"].append(max(b[k]["model"]["growth_run_ha"], .5) / o)
                early["10 % rule"].append(w["rule10"]["growth_run_ha"] / o)
    for i, v in enumerate(early.values()):
        ax[0].scatter(i + rng.uniform(-.12, .12, len(v)), v, alpha=.7)
        ax[0].hlines(np.median(v), i - .3, i + .3, color="k", lw=2)
    ax[0].axhspan(.5, 2, color="green", alpha=.1)
    ax[0].axhline(1, color="green", lw=1)
    ax[0].set_yscale("log")
    ax[0].set_xticks(range(3))
    ax[0].set_xticklabels(early)
    ax[0].set_ylabel("area burned: model / observed")
    ax[0].set_title(f"First hours (windows within 4 h, n={len(early['K3 (API)'])})\nbar = median, green = within x2")

    cfg = [("b_vento", "naive ellipse*"), ("K3", "K3 API"), ("K3m", "K3m"), ("K5", "K5 PT"), ("K5mm", "K5 medium shrub")]
    x, wdt = np.arange(len(FF)), .16
    for j, (c, lab) in enumerate(cfg):
        vals = [json.loads((HERE / "fires" / f / "runs" / (c if c == "b_vento" else f"mf_{c}") / "result.json")
                           .read_text())["stats"]["sorensen_last_step"] for f in FF]
        ax[1].bar(x + (j - 2) * wdt, vals, wdt, label=f"{lab} (median {np.median(vals):.2f})")
    ax[1].set_xticks(x)
    ax[1].set_xticklabels([NAMES.get(f.split("_")[0], f.split("_")[0]) for f in FF], rotation=30)
    ax[1].set_ylim(0, 1)
    ax[1].set_ylabel("Sørensen at the last observed step")
    ax[1].legend(fontsize=8, loc="upper right")
    ax[1].set_title("Free runs (no firefighting), whole fire\n*the ellipse knows the observed area")

    data = {}
    for c, lab in [("K5", "whole edge\n(K5)"), ("K5a", "satellite hotspots\n(K5a, real time)"),
                   ("K5o", "true active edge\n(K5o, bound)")]:
        data[lab] = [w["model"]["sorensen_growth"] for f in FF for w in steps(f, c).values()]
    ax[2].boxplot(list(data.values()), tick_labels=list(data), showfliers=False)
    for i, v in enumerate(data.values()):
        ax[2].scatter(i + 1 + rng.uniform(-.15, .15, len(v)), v, s=8, alpha=.4)
    ax[2].set_ylabel("Sørensen of the new growth, per window")
    ax[2].set_ylim(0, 1)
    ax[2].set_title(f"Restart from each observed perimeter ({len(next(iter(data.values())))} windows, {len(FF)} fires)\n"
                    "which part of the edge keeps burning")
    plt.tight_layout()
    plt.savefig(HERE / "multifire_plots.png", dpi=110)
    print(f"-> {HERE / 'multifire_plots.png'}")


if __name__ == "__main__":
    main()
