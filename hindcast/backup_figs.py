"""Simple pitch backup figures: per fire, three model versions at one observed step, in the style of the Vieira
validation figure: arrival time in colour, observed perimeter blue, official cyan, scars dark red. -> hindcast/fires/<id>/backup_<h>h.png

    hindcast/.venv/bin/python -I hindcast/backup_figs.py [--early]

Default: the last observed step (48 h for Monchique). --early: the first observed step within 5 h (the first hours).
"""

import json
import sys
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import CACHE, cells, evidence, fires, observed_arrival, official, sorensen  # noqa: E402
from scipy import ndimage  # noqa: E402
from shapely.geometry import shape  # noqa: E402

FIRES = ["VieiradoMinho_10082016", "CabeceirasdeBasto_06092016", "VilaNovadeCerveira_08082015", "SeverdoVouga_09082016",
         "Guarda_23082017", "Oleiros_25072020", "CastroMarim_16082021", "ViladeRei_20072019", "Monchique_03082018"]
RUNS = [("mf_K3", "Current API (S&B fuels)"), ("mf_K5", "Portuguese fuels + dry season"),
        ("mf_K5mm", "+ medium shrub model")]
BOTH, MODEL, OBS = (1.0, 0.65, 0.16), (0.88, 0.18, 0.18), (0.24, 0.49, 1.0)


def hillshade(z, cs):
    gy, gx = np.gradient(z, cs)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(45)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def figure(fid, early):
    fire = fires.Fire(fid)
    hrs = [s["hours"] for s in fire.steps[1:] if s["hours"] <= 48]
    h = next((x for x in hrs if x <= 5), None) if early else hrs[-1]
    if h is None:
        return None
    t = h * 60
    obs = observed_arrival(fire) <= t
    z = fire.read("elevation.f32", "f4")
    shade = hillshade(z, fire.cellsize)
    rows, cols = np.where(obs)
    pad = 25
    r0, r1, c0, c1 = max(rows.min() - pad, 0), rows.max() + pad, max(cols.min() - pad, 0), cols.max() + pad
    runs = [(n, lab) for n, lab in RUNS if (CACHE / fid / f"{n}.npy").exists()]
    ev, feats = evidence(fid)
    off = official(feats)
    offm = cells(fire, off) if off is not None else np.zeros_like(obs)
    scar = np.zeros_like(obs)
    for f in feats:
        if f["properties"]["kind"] == "scar":
            scar |= cells(fire, shape(f["geometry"]))
    edge = lambda m: m & ~ndimage.binary_erosion(m)  # noqa: E731
    cmap = plt.get_cmap("inferno")
    fig, axs = plt.subplots(1, len(runs), figsize=(5.6 * len(runs), 4.9), facecolor="#141414")
    for ax, (n, title) in zip(np.atleast_1d(axs), runs):
        a = np.load(CACHE / fid / f"{n}.npy")
        sim = np.isfinite(a) & (a <= t)
        img = np.full(obs.shape + (3,), 0.12)
        img[scar] = (0.45, 0.06, 0.06)
        img[sim] = cmap(0.25 + 0.6 * (1 - np.clip(a[sim] / t, 0, 1)))[:, :3]   # early = yellow, late = purple
        img[edge(offm)] = (0.2, 0.75, 0.75)
        img[ndimage.binary_dilation(edge(obs))] = (0.3, 0.6, 1.0)
        ha = sim.sum() * fire.cellsize ** 2 / 1e4
        ax.imshow(img[r0:r1, c0:c1], interpolation="nearest")
        ax.set_title(f"{title}\n{h:g} h: {ha:.0f} ha (obs {obs.sum() * fire.cellsize ** 2 / 1e4:.0f})\n"
                     f"Sørensen vs observed {sorensen(obs, sim):.2f}"
                     + (f" · vs official {sorensen(offm, np.isfinite(a)):.2f}" if off is not None else ""),
                     color="white", fontsize=10, loc="left")
        ax.axis("off")
    name = fire.meta.get("name", fid)
    fig.suptitle(f"{name}, {fire.steps[0]['time'][:10]} · {h:g} h after the first observed perimeter "
                 f"(ELMFIRE, no firefighting)", color="white", fontsize=12, x=0.01, ha="left")
    fig.text(0.01, 0.02, "colour = ELMFIRE arrival (yellow early, purple late) · blue = observed perimeter "
             "(PT-FireSprd) · cyan = official ICNF/GNR perimeter · dark red = earlier fire scars", color="#ccc", fontsize=9)
    plt.tight_layout(rect=(0, 0.06, 1, 0.94))
    out = HERE / "fires" / fid / f"backup_{h:g}h.png"
    plt.savefig(out, dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)
    return out


def main():
    early = "--early" in sys.argv
    for fid in FIRES:
        print("->", figure(fid, early))


if __name__ == "__main__":
    main()
