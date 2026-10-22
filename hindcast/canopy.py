"""ELMFIRE's canopy layers for a fire, from the DGT national LiDAR, on the package grid: fires/<id>/canopy.npz.

    hindcast/.venv/bin/python -I hindcast/canopy.py VieiradoMinho_10082016 --dgt /path/to/dgt

--dgt is a folder with MDS-2m/*.tif (surface) and MDT-2m/*.tif (terrain), the DGT LiDAR 2024-25 tiles at 2 m in
EPSG:3763 (cdd.dgterritorio.gov.pt; free, needs a login), covering the package grid. The tiles stay outside the repo.

On the package's 30 m cells (the canopy height model is MDS - MDT, clipped to 0-60 m):
  cover   share of the cell's 2 m pixels with vegetation 4 m or taller
  height  90th percentile of those pixels
  base    assumed, not measured: 0.30 (eucalyptus) or 0.35 (others) x height, at least 1.5 m
  bulk    assumed: cover x 0.20 kg/m3 (pine), 0.15 (eucalyptus, acacia), 0.08 (oak, other broadleaves), 0.12 (others)
Cells without LiDAR take their COS class's median; non-burnable cells (Scott & Burgan code <= 99) get no canopy.
--prefire raises every forest cell (COS 5.1) to at least its class's median cover and height (a try at undoing the
regrowth since the fire; it made ELMFIRE slower in Vieira, and is not used).

The same method as FireRenderer's tools/terrain/src/terrain/elmfire.py canopy_layers, which wrote Vieira's file.
run.py uses canopy.npz when it exists (--no-canopy to leave it out).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from rasterio.merge import merge

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import fire_dir, fires  # noqa: E402


def layers(grid: dict, idx: np.ndarray, legend: list, dgt: Path, prefire: bool = False) -> tuple[dict, dict]:
    rows, cols, cs = grid["rows"], grid["cols"], grid["cellsize"]
    k = int(round(cs / 2.0))
    bounds = (grid["xmin"], grid["ymin"], grid["xmin"] + cols * cs, grid["ymin"] + rows * cs)

    def mosaic(kind):
        files = sorted(str(f) for f in (dgt / kind).glob("*.tif"))
        if not files:
            raise SystemExit(f"{dgt / kind}: sem tiles .tif")
        a = merge(files, bounds=bounds, res=2.0, nodata=np.nan, dtype="float32")[0][0]
        a[a < -100] = np.nan
        return a

    chm = np.clip(mosaic("MDS-2m") - mosaic("MDT-2m"), 0, 60)
    return layers_from_chm(grid, idx, legend, chm, prefire)


def layers_from_chm(grid: dict, idx: np.ndarray, legend: list, chm: np.ndarray, prefire: bool = False) -> tuple[dict, dict]:
    """The four layers from a canopy height model at 2 m over the package grid (NaN where unknown), whatever its
    source: the DGT LiDAR here, Meta and WRI's global map in canopy_open.py."""
    rows, cols, cs = grid["rows"], grid["cols"], grid["cellsize"]
    k = int(round(cs / 2.0))
    blk = chm.reshape(rows, k, cols, k).transpose(0, 2, 1, 3).reshape(rows, cols, k * k)
    ok = np.isfinite(blk)
    has = ok.mean(-1) > 0.5
    tree = ok & (blk >= 4.0)
    cc = tree.sum(-1) / np.maximum(ok.sum(-1), 1)
    ch = np.zeros((rows, cols))
    some = tree.any(-1)
    ch[some] = np.nanpercentile(np.where(tree, blk, np.nan)[some], 90, axis=-1)
    cc[~some] = 0.0

    cos = np.array([l["cos"] for l in legend])
    sb = np.array([l["scottBurgan"] for l in legend])
    burnable = sb[idx] > 99
    forest = np.char.startswith(cos, "5.1")[idx]
    med_cc, med_ch = np.zeros(len(legend)), np.zeros(len(legend))
    for i in range(len(legend)):
        m = (idx == i) & has
        if m.any():
            med_cc[i] = float(np.median(cc[m]))
            med_ch[i] = float(np.median(ch[m & some])) if (m & some).any() else 0.0
    cc = np.where(has, cc, med_cc[idx])
    ch = np.where(has, ch, med_ch[idx])
    if prefire:
        cc = np.where(forest, np.maximum(cc, med_cc[idx]), cc)
        ch = np.where(forest, np.maximum(ch, med_ch[idx]), ch)

    pine = np.char.startswith(cos, "5.1.2")[idx]
    euc = np.isin(cos, ["5.1.1.5", "5.1.1.6"])[idx]
    broad = forest & ~pine & ~euc
    density = np.select([pine, euc, broad], [0.20, 0.15, 0.08], 0.12)
    present = burnable & (cc > 0) & (ch >= 4.0)
    cbh = np.clip(np.where(euc, 0.30, 0.35) * ch, 1.5, np.maximum(ch - 1.0, 1.5))
    out = {"cover_pct": np.where(present, np.round(cc * 100), 0).astype(np.uint8),
           "height_dm": np.round(np.where(present, np.round(ch, 1), 0) * 10).astype(np.uint16),
           "base_dm": np.round(np.where(present, np.round(cbh, 1), 0) * 10).astype(np.uint16),
           "bulk_cg_m3": np.round(np.where(present, np.round(cc * density, 2), 0) * 100).astype(np.uint8)}
    crown = present & (cc >= 0.39)
    summary = {"mode": "prefire" if prefire else "lidar", "lidar_cells_pct": round(100 * float(has.mean()), 1),
               "canopy_cells_pct": round(100 * float(present.mean()), 1),
               "crown_capable_cells_pct (cover >= 39 %)": round(100 * float(crown.mean()), 1),
               "median_height_m": round(float(np.median(ch[present])), 1) if present.any() else 0.0,
               "median_bulk_kgm3": round(float(np.median(out["bulk_cg_m3"][present])) / 100, 3) if present.any() else 0.0}
    return out, summary


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--dgt", type=Path, required=True, help="folder with MDS-2m/ and MDT-2m/ (DGT LiDAR, EPSG:3763)")
    p.add_argument("--prefire", action="store_true")
    p.add_argument("--out", type=Path, help="default: hindcast/fires/<id>/canopy.npz")
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    legend = json.loads((fire.folder / "fuel.json").read_text())["legend"]
    arrays, summary = layers(fire.grid, fire.read("fuel.u8", "u1"), legend, args.dgt, args.prefire)
    out = args.out or fire_dir(args.fire) / "canopy.npz"
    np.savez_compressed(out, **arrays)
    (out.with_suffix(".json")).write_text(json.dumps({
        "file": out.name, "grid": "the package grid (grid.json), row 0 north",
        "arrays": {"cover_pct": "canopy cover, %", "height_dm": "canopy height, dm", "base_dm": "canopy base height, dm",
                   "bulk_cg_m3": "canopy bulk density, hundredths of kg/m3"},
        "source": "DGT national LiDAR 2024-25, MDS-2m minus MDT-2m (canopy height model), aggregated to the 30 m "
                  "cells by hindcast/canopy.py",
        "method": {"cover": "share of the cell's 2 m pixels with vegetation >= 4 m",
                   "height": "90th percentile of those pixels",
                   "base": "assumed, not measured: 0.30 (eucalyptus) or 0.35 (others) x height, >= 1.5 m",
                   "bulk": "assumed: cover x 0.20 kg/m3 (pine), 0.15 (eucalyptus, acacia), 0.08 (oak, other "
                           "broadleaves), 0.12 (others)",
                   "gaps": "cells without LiDAR take their COS class's median; non-burnable cells have no canopy"},
        "caveat": "today's canopy (2024-25), not the year of the fire: burn scars have regrown since",
        "summary": summary}, indent=1, ensure_ascii=False))
    print(f"-> {out}: {summary}")


if __name__ == "__main__":
    main()
