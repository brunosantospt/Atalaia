"""Lay the simulation grid over a fire: the one grid every layer and every engine shares.

    scripts/.venv/bin/python scripts/build_grid.py [fire_id ...]   (all built fires by default)

Reads web/public/fires/<id>/fire.json (build_fires.py) and writes web/public/fires/<id>/grid.json:
square CELL_M cells in PT-TM06 (EPSG:3763) over the whole burned area plus MARGIN_M on every side,
so a decision can let the fire run further than it did. Row 0 is the northern edge.

The first six keys are the engines' `grid` (engines/CONTRACT.md) and go into a request as they are.
`wgs84` holds the four outer corners, for the browser, which has no PT-TM06: inside a grid this
size, interpolating between them lands within a few metres of the exact transform (checked here).
"""

import argparse
import json
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"

CELL_M = 30  # ELMFIRE's usual resolution; COS2015 polygons are at least 1 ha (100 m) wide
MARGIN_M = 3000
MAX_CORNER_ERROR_M = CELL_M / 4  # for drawing on the globe; the engines and the scores stay in PT-TM06

PTTM06 = CRS.from_epsg(3763)
TO_TM06 = Transformer.from_crs(CRS.from_epsg(4326), PTTM06, always_xy=True)
TO_WGS84 = Transformer.from_crs(PTTM06, CRS.from_epsg(4326), always_xy=True)


def build(fire_id: str):
    fire = json.loads((FIRES / fire_id / "fire.json").read_text())
    # The bbox edges are densified, so the projected box holds the whole curved outline.
    x0, y0, x1, y1 = TO_TM06.transform_bounds(*fire["bbox"], densify_pts=21)
    xmin = np.floor((x0 - MARGIN_M) / CELL_M) * CELL_M
    ymin = np.floor((y0 - MARGIN_M) / CELL_M) * CELL_M
    cols = int(np.ceil((x1 + MARGIN_M - xmin) / CELL_M))
    rows = int(np.ceil((y1 + MARGIN_M - ymin) / CELL_M))
    xmax, ymax = xmin + cols * CELL_M, ymin + rows * CELL_M

    corners = {k: TO_WGS84.transform(x, y) for k, (x, y) in
               {"sw": (xmin, ymin), "se": (xmax, ymin), "ne": (xmax, ymax), "nw": (xmin, ymax)}.items()}
    error = corner_error(corners, xmin, ymin, xmax, ymax)
    if error > MAX_CORNER_ERROR_M:
        raise SystemExit(f"{fire_id}: corner interpolation is off by {error:.2f} m, the grid is too large for it")

    grid = {
        "cols": cols,
        "rows": rows,
        "cellsize": CELL_M,
        "xmin": float(xmin),
        "ymin": float(ymin),
        "srs": "EPSG:3763",
        "wgs84": {k: [round(lon, 7), round(lat, 7)] for k, (lon, lat) in corners.items()},
    }
    (FIRES / fire_id / "grid.json").write_text(json.dumps(grid, indent=2) + "\n")
    print(f"{fire_id}: {cols} x {rows} cells of {CELL_M} m, {cols * CELL_M / 1000:.1f} x {rows * CELL_M / 1000:.1f} km, "
          f"corner interpolation within {error:.2f} m")


def corner_error(corners, xmin, ymin, xmax, ymax):
    """Worst distance, over a lattice of points, between the corner interpolation and the exact point."""
    u, v = np.meshgrid(np.linspace(0, 1, 41), np.linspace(0, 1, 41))
    sw, se, ne, nw = (np.array(corners[k]) for k in ("sw", "se", "ne", "nw"))
    lon, lat = (((1 - u) * (1 - v))[..., None] * sw + (u * (1 - v))[..., None] * se
                + (u * v)[..., None] * ne + ((1 - u) * v)[..., None] * nw).transpose(2, 0, 1)
    x, y = TO_TM06.transform(lon, lat)
    return float(np.hypot(x - (xmin + u * (xmax - xmin)), y - (ymin + v * (ymax - ymin))).max())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        build(fire_id)


if __name__ == "__main__":
    main()
