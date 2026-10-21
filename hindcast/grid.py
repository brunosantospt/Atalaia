"""A grid of runs against the observed fire: one column per run, one row per time.

    hindcast/.venv/bin/python -I hindcast/grid.py VieiradoMinho_10082016 \\
        --runs "0_api=0 · API" "4_seca=5 · + drought" ... --hours 2 5 10 17.5 22.5

Each cell is the fire at that time on the package grid: orange where the run and the observed fire both burned,
red where only the run did, blue where only the observed fire did. The first column is the observed fire alone. Each
cell says the run's area and its Sørensen index against the observed fire at that time. Rows at an observed step
time compare with a mapped perimeter; the rows between steps compare with the interpolated observed arrival
(common.observed_arrival). Runs come from data/hindcast/<id>/<name>.npy (run.py); all must start at step 0.

Writes hindcast/fires/<id>/grid.png (or --out).
"""

import argparse
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, fire_dir, fires, observed_arrival, sorensen  # noqa: E402

BOTH, RUN, OBS, BACK, OBS_ONLY_COL = (255, 165, 40), (225, 45, 45), (60, 125, 255), (28, 28, 28), (235, 235, 235)


def font(size, bold=False):
    for name in (f"DejaVuSans{'-Bold' if bold else ''}.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--runs", nargs="+", required=True, help="name=label (label may contain \\n)")
    p.add_argument("--hours", nargs="+", type=float, required=True, help="hours after step 0, one row each")
    p.add_argument("--zoom", type=float, default=1.0)
    p.add_argument("--title", default="")
    p.add_argument("--out", type=Path)
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    t0 = fires.parse_time(fire.steps[0]["time"])
    step_h = {s["hours"] for s in fire.steps}
    obs = np.nan_to_num(observed_arrival(fire), nan=np.inf)
    runs = []
    for spec in args.runs:
        name, _, label = spec.partition("=")
        runs.append((label.replace("\\n", "\n") or name, np.nan_to_num(np.load(CACHE / args.fire / f"{name}.npy"),
                                                                          nan=np.inf)))
    tmax = max(args.hours) * 60
    seen = obs <= tmax
    for _, a in runs:
        seen |= a <= tmax
    rr, cc = np.nonzero(seen)
    pad = 8
    r0, r1 = max(rr.min() - pad, 0), min(rr.max() + pad + 1, fire.rows)
    c0, c1 = max(cc.min() - pad, 0), min(cc.max() + pad + 1, fire.cols)
    w, h = int((c1 - c0) * args.zoom), int((r1 - r0) * args.zoom)
    cell_ha = fire.cellsize ** 2 / 1e4

    head_h, row_w, gap, text_h = 70, 175, 6, 22
    cols = 1 + len(runs)
    W = row_w + cols * (w + gap)
    H = head_h + len(args.hours) * (h + text_h + gap) + 40
    img = Image.new("RGB", (W, H), (15, 15, 15))
    d = ImageDraw.Draw(img)
    f_head, f_cell, f_row = font(15, True), font(14), font(15, True)

    def tile(o, a):
        rgb = np.zeros(o.shape + (3,), np.uint8)
        rgb[:] = BACK
        if a is None:
            rgb[o] = OBS_ONLY_COL
        else:
            rgb[o & a], rgb[a & ~o], rgb[o & ~a] = BOTH, RUN, OBS
        return Image.fromarray(rgb).resize((w, h), Image.NEAREST)

    labels = [("Observed\n(PT-FireSprd)", None)] + runs
    for j, (label, _) in enumerate(labels):
        x = row_w + j * (w + gap)
        d.multiline_text((x + 4, 8), label, fill=(255, 255, 255), font=f_head, spacing=2)
    for i, hh in enumerate(args.hours):
        y = head_h + i * (h + text_h + gap)
        t = t0 + timedelta(hours=hh)
        kind = "observed\nperimeter" if hh in step_h else "interpolated"
        d.multiline_text((8, y + h / 2 - 36), f"{t:%d %b %H:%M}\n+{hh:g} h\n{kind}", fill=(255, 255, 255),
                         font=f_row, spacing=3)
        o = (obs <= hh * 60)[r0:r1, c0:c1]
        for j, (label, a) in enumerate(labels):
            x = row_w + j * (w + gap)
            if a is None:
                img.paste(tile(o, None), (x, y))
                txt = f"{o.sum() * cell_ha:.0f} ha"
            else:
                m = (a <= hh * 60)[r0:r1, c0:c1]
                img.paste(tile(o, m), (x, y))
                txt = f"{m.sum() * cell_ha:.0f} ha · S {sorensen(o, m):.2f}"
            d.text((x + 4, y + h + 3), txt, fill=(220, 220, 220), font=f_cell)
    ly = H - 30
    for k, (col, txt) in enumerate([(BOTH, "both burned"), (RUN, "model only"), (OBS, "observed only")]):
        d.rectangle([row_w + k * 190, ly, row_w + k * 190 + 18, ly + 18], fill=col)
        d.text((row_w + k * 190 + 26, ly), txt, fill=(220, 220, 220), font=f_cell)
    if args.title:
        d.text((row_w + 3 * 190 + 20, ly), args.title, fill=(180, 180, 180), font=f_cell)
    out = args.out or fire_dir(args.fire) / "grid.png"
    img.save(out)
    print(f"-> {out} ({W}x{H})")


if __name__ == "__main__":
    main()
