"""Put the hindcast's scars and LiDAR canopy into a fire's package, for the API's runs.

    scripts/.venv/bin/python -I scripts/build_scars_canopy.py [fire_id ...]   (all built fires by default)

Reads hindcast/fires/<id>/evidence.geojson and canopy.npz (hindcast/evidence.py and canopy.py, see
hindcast/README.md) and writes next to the grid:

    scars.geojson      the burn perimeters of the fires put out shortly before this one (evidence.py's
                       --days-before, 40 days), lon/lat as evidence.py gives them: their fuel was gone
    canopy_cover.u8    canopy cover, % (the engines' canopy_cover_pct)
    canopy_height.u16  canopy height, dm (canopy_height_m x 10)
    canopy_base.u16    canopy base height, dm (canopy_base_m x 10)
    canopy_bulk.u8     canopy bulk density, hundredths of kg/m3 (canopy_bulk_kgm3 x 100)
    canopy.json        what each file holds, where it comes from, and its range

The canopy files hold one value per cell, row-major, row 0 along the northern edge, little-endian, as
the relief does (build_terrain.py).
"""

import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
HINDCAST = ROOT / "hindcast/fires"
# canopy.npz array: the engines' layer, the package file, its type and unit, how many of them make one of the
# layer's, and what it is (canopy.py)
CANOPY = {
    "cover_pct": ("canopy_cover_pct", "canopy_cover.u8", "uint8", "%", 1,
                  "cobertura das copas: a parte da célula com vegetação de 4 m ou mais"),
    "height_dm": ("canopy_height_m", "canopy_height.u16", "uint16", "dm", 10,
                  "altura das copas: o percentil 90 dessa vegetação"),
    "base_dm": ("canopy_base_m", "canopy_base.u16", "uint16", "dm", 10,
                "altura da base das copas: estimada, 0,30 (eucalipto) ou 0,35 (as outras) da altura, pelo menos 1,5 m"),
    "bulk_cg_m3": ("canopy_bulk_kgm3", "canopy_bulk.u8", "uint8", "centésimas de kg/m³", 100,
                   "densidade aparente das copas: estimada, a cobertura vezes 0,08 a 0,20 kg/m³ consoante a espécie"),
}


def build(fire_id: str):
    folder, source = FIRES / fire_id, HINDCAST / fire_id
    grid = json.loads((folder / "grid.json").read_text())
    if not (source / "evidence.geojson").exists():
        raise SystemExit(f"falta {(source / 'evidence.geojson').relative_to(ROOT)} (hindcast/evidence.py)")
    lidar = (source / "canopy.npz").exists() and (source / "canopy.json").exists()

    features = json.loads((source / "evidence.geojson").read_text())["features"]
    scars = [f for f in features if f["properties"]["kind"] == "scar"]
    (folder / "scars.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": scars}, ensure_ascii=False, separators=(",", ":")))

    if lidar:
        arrays, about = np.load(source / "canopy.npz"), json.loads((source / "canopy.json").read_text())
    else:  # no LiDAR for this fire yet (hindcast/dgt_tiles.py, canopy.py): no canopy, as --no-canopy
        zero = np.zeros((grid["rows"], grid["cols"]))
        arrays = {key: zero for key in CANOPY}
        about = {"source": "sem copas: não há canopy.npz (LiDAR da DGT) para este incêndio",
                 "method": {}, "caveat": "camadas a zero: o ELMFIRE corre sem copas (sem fogo de copas e sem abrigo do vento)"}
    layers = {}
    for key, (layer, file, dtype, unit, per, notes) in CANOPY.items():
        a = arrays[key]
        if a.shape != (grid["rows"], grid["cols"]):
            raise SystemExit(f"{fire_id}: canopy.npz {key} tem {a.shape}, a grade {grid['rows']} x {grid['cols']}")
        a.astype(np.dtype(dtype).newbyteorder("<")).tofile(folder / file)
        layers[layer] = {"file": file, "type": dtype, "unit": unit, "per": per, "min": int(a.min()), "max": int(a.max()),
                         "notes": notes}
    doc = {
        "source": about["source"],
        "cells": "um valor por célula, linha a linha a partir da borda norte, little-endian",
        "layers": layers,
        "method": about["method"],
        "caveat": about["caveat"],
        "notes": "o valor da camada do motor é o do ficheiro a dividir por `per` (canopy_height_m = canopy_height.u16 / 10)",
    }
    (folder / "canopy.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")

    print(f"{fire_id}: {len(scars)} cicatrizes, {sum(f['properties']['area_ha'] for f in scars):.0f} ha")
    for layer, d in layers.items():
        print(f"  {d['file']:<18} {layer:<17} {d['min']}-{d['max']} {d['unit']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    ids = parser.parse_args().fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]
    for fire_id in ids:
        build(fire_id)
