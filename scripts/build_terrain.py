"""Put the relief on a fire's grid: elevation, slope and aspect from the Copernicus DEM.

    scripts/.venv/bin/python -I scripts/build_terrain.py [fire_id ...]   (all built fires by default)

Reads web/public/fires/<id>/grid.json (build_grid.py) and the GLO-30 tiles in
data/copernicus-dem-glo30 (fetch_dem.py), and writes next to the grid one value per cell, row-major,
row 0 along the northern edge, little-endian:

    elevation.f32  metres above sea level (the engines' elevation_m)
    slope.u8       degrees from the horizontal (slope_deg)
    aspect.u16     degrees clockwise from north of the way the ground faces, downhill (aspect_deg)
    terrain.json   what each file holds, where it comes from, and its range

The tiles touching the grid are joined and resampled bilinearly from 1 arc second onto the 30 m
PT-TM06 cells. Slope and aspect come from that elevation, by Horn's 3 x 3 method, as ELMFIRE's
inputs from LANDFIRE do. Aspect is read from the grid's north, which is within 0.2° of true north
in these grids, and is 0 where the ground is flat.

GLO-30 is a surface model: in a forest it sits partly on the canopy, so a stand edge can show as a
step of a few metres. The tiles are downloaded data, read only through GDAL's GeoTIFF driver.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
TILES = ROOT / "data/copernicus-dem-glo30"
SOURCE = {
    "dataset": "Copernicus DEM GLO-30, 1 arc second (DSM, TanDEM-X 2011-2015)",
    "licence": "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
               "by the European Union and ESA; all rights reserved",
    "url": "https://registry.opendata.aws/copernicus-dem/",
}
LOWEST_M, HIGHEST_M = -10, 2000  # mainland Portugal tops out at 1993 m


def elevation(grid):
    """The DEM on the grid's cells, in metres."""
    cell, cols, rows = grid["cellsize"], grid["cols"], grid["rows"]
    lons, lats = zip(*grid["wgs84"].values())
    pad = 0.01  # degrees: room for the bilinear kernel and for the grid's edges, which bow a little
    west, south, east, north = min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad

    paths = sorted(TILES.glob("Copernicus_DSM_COG_10_*_DEM.tif"))
    sources = [rasterio.open(p) for p in paths]
    try:
        touching = [s for s in sources if s.bounds.left < east and s.bounds.right > west
                    and s.bounds.bottom < north and s.bounds.top > south]
        for s in touching:
            if s.crs.to_epsg() != 4326 or s.count != 1 or s.dtypes[0] != "float32":
                raise SystemExit(f"{Path(s.name).name}: not a GLO-30 tile")
        covered = sum((min(s.bounds.right, east) - max(s.bounds.left, west))
                      * (min(s.bounds.top, north) - max(s.bounds.bottom, south)) for s in touching)
        if not np.isclose(covered, (east - west) * (north - south)):
            raise SystemExit("the DEM tiles do not cover the grid: run scripts/fetch_dem.py")
        mosaic, transform = merge(touching, bounds=(west, south, east, north))
    finally:
        for s in sources:
            s.close()

    z = np.full((rows, cols), np.nan, dtype=np.float32)
    reproject(mosaic[0], z, src_transform=transform, src_crs="EPSG:4326",
              dst_transform=from_origin(grid["xmin"], grid["ymin"] + rows * cell, cell, cell),
              dst_crs=grid["srs"], dst_nodata=np.nan, resampling=Resampling.bilinear)
    if np.isnan(z).any() or z.min() < LOWEST_M or z.max() > HIGHEST_M:
        raise SystemExit(f"elevation missing or out of range: {np.nanmin(z):.0f}..{np.nanmax(z):.0f} m")
    return z


def slope_aspect(z, cell):
    """Horn's method. Rows run north to south and columns west to east; the outer ring repeats the edge."""
    p = np.pad(z.astype(np.float64), 1, mode="edge")
    nw, n, ne = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    w, e = p[1:-1, :-2], p[1:-1, 2:]
    sw, s, se = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    rise_east = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / (8 * cell)
    rise_north = ((nw + 2 * n + ne) - (sw + 2 * s + se)) / (8 * cell)
    slope = np.degrees(np.arctan(np.hypot(rise_east, rise_north)))
    # Downhill is against the rise; its bearing is measured from north towards east.
    aspect = np.degrees(np.arctan2(-rise_east, -rise_north)) % 360
    return slope, aspect


def build(fire_id: str):
    folder = FIRES / fire_id
    grid = json.loads((folder / "grid.json").read_text())
    z = elevation(grid)
    slope, aspect = slope_aspect(z, grid["cellsize"])

    slope_u8 = np.rint(slope).astype(np.uint8)
    aspect_u16 = (np.rint(aspect).astype(np.uint16) % 360) * (slope_u8 > 0)
    (folder / "elevation.f32").write_bytes(z.astype("<f4").tobytes())
    (folder / "slope.u8").write_bytes(slope_u8.tobytes())
    (folder / "aspect.u16").write_bytes(aspect_u16.astype("<u2").tobytes())

    doc = {
        "source": SOURCE,
        "cells": "um valor por célula, linha a linha a partir da borda norte, little-endian",
        "layers": {
            "elevation_m": {"file": "elevation.f32", "type": "float32", "unit": "m",
                            "min": round(float(z.min()), 1), "max": round(float(z.max()), 1),
                            "notes": "altitude do MDT, reamostrada bilinearmente para a célula"},
            "slope_deg": {"file": "slope.u8", "type": "uint8", "unit": "°",
                          "min": int(slope_u8.min()), "max": int(slope_u8.max()),
                          "notes": "declive em graus a partir da horizontal, pelo método de Horn"},
            "aspect_deg": {"file": "aspect.u16", "type": "uint16", "unit": "°",
                           "notes": "para onde a encosta está virada, a descer: 0 = norte, 90 = este; 0 onde é plano"},
        },
        "notes": "MDT de superfície: em floresta fica em parte sobre as copas. O norte é o da grade PT-TM06, "
                 "a menos de 0,2° do norte geográfico.",
    }
    (folder / "terrain.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")

    steep = 100 * (slope >= 30).mean()
    print(f"{fire_id}: {z.min():.0f}..{z.max():.0f} m, slope median {np.median(slope):.0f}°, "
          f"90th percentile {np.percentile(slope, 90):.0f}°, {steep:.0f} % of cells at 30° or more")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        build(fire_id)


if __name__ == "__main__":
    main()
