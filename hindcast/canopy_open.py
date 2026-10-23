"""ELMFIRE's canopy layers from an open global map, for fires with no LiDAR: fires/<id>/canopy_meta.npz.

    hindcast/.venv/bin/python -I hindcast/canopy_open.py Guarda_23082017

The map is Meta and WRI's global canopy height (Tolan et al. 2024, Remote Sensing of Environment 300: 113888), a
model of Maxar imagery against GEDI and airborne LiDAR, about 1.2 m per pixel, mostly 2018-2020 imagery, free on
AWS (s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/, no account). Its mean absolute error is 2.8 m.
The zoom-9 tiles that touch the package grid are downloaded once into data/meta-canopy/chm/ (about 20 MB each),
read over the grid at half resolution (average) and resampled to 2 m and turned into the four layers exactly as canopy.py does for the DGT LiDAR
(canopy.layers_from_chm): cover = share of 2 m pixels at 4 m or more, height = their 90th percentile, base and bulk
density assumed per COS class.

run.py --canopy-source meta uses it. canopy.npz (the LiDAR) is left alone where there is one; comparing the two on
Vieira and Cabeceiras says how far the open map can stand in for the LiDAR.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import requests
import shapely
from pyproj import Transformer
from rasterio import open as ropen
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject
from rasterio.windows import from_bounds
from shapely.geometry import box, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canopy import layers_from_chm  # noqa: E402
from common import ROOT, fire_dir, fires  # noqa: E402

BUCKET = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float"
CACHE = ROOT / "data/meta-canopy"


def tiles_for(grid: dict) -> list[str]:
    index = CACHE / "tiles.geojson"
    if not index.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        r = requests.get(f"{BUCKET}/tiles.geojson", timeout=300)
        r.raise_for_status()
        index.write_bytes(r.content)
    to_ll = Transformer.from_crs(grid["srs"], "EPSG:4326", always_xy=True)
    x1, y1 = grid["xmin"] + grid["cols"] * grid["cellsize"], grid["ymin"] + grid["rows"] * grid["cellsize"]
    area = box(*to_ll.transform_bounds(grid["xmin"], grid["ymin"], x1, y1, densify_pts=21))
    return [f["properties"]["tile"] for f in json.loads(index.read_text())["features"]
            if shape(f["geometry"]).intersects(area)]


def tile_path(tile: str) -> Path:
    path = CACHE / "chm" / f"{tile}.tif"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  {tile}.tif ...")
        with requests.get(f"{BUCKET}/chm/{tile}.tif", stream=True, timeout=600) as r:
            r.raise_for_status()
            tmp = path.with_suffix(".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            tmp.replace(path)
    return path


def chm_2m(grid: dict) -> np.ndarray:
    """The canopy height at 2 m over the package grid, NaN where no tile covers it."""
    cs = grid["cellsize"]
    k = int(round(cs / 2.0))
    shape_2m = (grid["rows"] * k, grid["cols"] * k)
    dst_tr = Affine(2.0, 0, grid["xmin"], 0, -2.0, grid["ymin"] + grid["rows"] * cs)
    out = np.full(shape_2m, np.nan, np.float32)
    x1, y1 = grid["xmin"] + grid["cols"] * cs, grid["ymin"] + grid["rows"] * cs
    for tile in tiles_for(grid):
        with ropen(tile_path(tile)) as src:
            # only the part of the tile over the grid, read at half resolution (~2.4 m, averaged): a whole tile is
            # 65536 x 65536 pixels (4.3 GB)
            l, b, r, t = Transformer.from_crs(grid["srs"], src.crs, always_xy=True).transform_bounds(
                grid["xmin"], grid["ymin"], x1, y1, densify_pts=21)
            win = from_bounds(max(l, src.bounds.left), max(b, src.bounds.bottom), min(r, src.bounds.right),
                              min(t, src.bounds.top), src.transform).round_offsets().round_lengths()
            if win.width <= 0 or win.height <= 0:
                continue
            h, w = max(1, int(win.height) // 2), max(1, int(win.width) // 2)
            data = src.read(1, window=win, out_shape=(h, w), resampling=Resampling.average).astype(np.float32)
            tr = src.window_transform(win) * Affine.scale(win.width / w, win.height / h)
            part = np.full(shape_2m, np.nan, np.float32)
            reproject(source=data, destination=part, src_transform=tr, src_crs=src.crs, src_nodata=None,
                      dst_transform=dst_tr, dst_crs=grid["srs"], dst_nodata=np.nan, resampling=Resampling.bilinear)
            del data
        out = np.where(np.isnan(out), part, np.fmax(out, part))
    return np.clip(out, 0, 60)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    args = p.parse_args(argv)
    fire = fires.Fire(args.fire)
    legend = json.loads((fire.folder / "fuel.json").read_text())["legend"]
    arrays, summary = layers_from_chm(fire.grid, fire.read("fuel.u8", "u1"), legend, chm_2m(fire.grid))
    summary["mode"] = "meta"
    out = fire_dir(args.fire) / "canopy_meta.npz"
    np.savez_compressed(out, **arrays)
    out.with_suffix(".json").write_text(json.dumps({
        "file": out.name, "grid": "the package grid (grid.json), row 0 north",
        "arrays": {"cover_pct": "canopy cover, %", "height_dm": "canopy height, dm", "base_dm": "canopy base height, dm",
                   "bulk_cg_m3": "canopy bulk density, hundredths of kg/m3"},
        "source": "Meta & WRI global canopy height (Tolan et al. 2024), ~1.2 m, imagery mostly 2018-2020, "
                  f"{BUCKET}; resampled to 2 m (average) and aggregated by hindcast/canopy_open.py",
        "method": "as canopy.py (canopy.layers_from_chm): cover = share of 2 m pixels >= 4 m, height = their 90th "
                  "percentile, base and bulk density assumed per COS class",
        "caveat": "a model of satellite imagery (MAE 2.8 m), not a measurement; its year is not the fire's",
        "summary": summary}, indent=1, ensure_ascii=False))
    print(f"-> {out}: {summary}")


if __name__ == "__main__":
    main()
