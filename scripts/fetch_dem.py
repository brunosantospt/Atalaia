"""Download the Copernicus DEM GLO-30 tiles that cover each fire's grid.

    scripts/.venv/bin/python -I scripts/fetch_dem.py [fire_id ...]   (all built fires by default)

Reads web/public/fires/<id>/grid.json (build_grid.py) and saves every 1° x 1° tile its corners
touch, untouched, to data/copernicus-dem-glo30/<tile>.tif. A tile already there is not fetched
again. build_terrain.py reads them. No account or key: the tiles are on the AWS open data bucket.

GLO-30 is a surface model (TanDEM-X radar, 2011-2015), 1 arc second (about 23 x 31 m here): in a
forest it sits partly on the canopy. Credit "© DLR e.V. 2010-2014 and © Airbus Defence and Space
GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".
"""

import argparse
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
OUT = ROOT / "data/copernicus-dem-glo30"
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
MAX_BYTES = 100_000_000  # a land tile is 10-60 MB


def tile_name(lat: int, lon: int) -> str:
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def tiles(fire_id: str):
    corners = json.loads((FIRES / fire_id / "grid.json").read_text())["wgs84"].values()
    lons, lats = zip(*corners)
    # The grid's edges bow a little between the corners, far less than this.
    pad = 0.01
    return [tile_name(lat, lon)
            for lat in range(math.floor(min(lats) - pad), math.floor(max(lats) + pad) + 1)
            for lon in range(math.floor(min(lons) - pad), math.floor(max(lons) + pad) + 1)]


def fetch(name: str):
    path = OUT / f"{name}.tif"
    if path.exists():
        print(f"{name}: already here")
        return
    request = urllib.request.Request(f"{BUCKET}/{name}/{name}.tif", headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
    part = path.with_suffix(".part")
    with urllib.request.urlopen(request, timeout=60) as response:
        size = int(response.headers["Content-Length"])
        if not 0 < size <= MAX_BYTES:
            raise SystemExit(f"{name}: unexpected size {size}")
        with part.open("wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    if part.stat().st_size != size:
        raise SystemExit(f"{name}: got {part.stat().st_size} of {size} bytes")
    part.rename(path)
    print(f"{name}: {size / 1e6:.1f} MB → {path.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    needed = {}
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        for name in tiles(fire_id):
            needed.setdefault(name, []).append(fire_id)
    for name, fire_ids in needed.items():
        print(f"{name} covers {', '.join(fire_ids)}")
        fetch(name)


if __name__ == "__main__":
    main()
