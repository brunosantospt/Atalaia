"""Turn the COS2015 land cover into the fuel layer of a fire's grid.

    scripts/.venv/bin/python scripts/build_fuel.py [fire_id ...]   (all built fires by default)

Reads web/public/fires/<id>/grid.json (build_grid.py) and the COS2015 v2 GeoPackage in
data/cos2015v2-dgt/extracted, and writes next to the grid:

    fuel.u8    one byte per cell, row-major, row 0 along the northern edge: an index into the legend
    fuel.json  the legend: each COS class found, with its fuel class, fuel models and the reason

Every cell takes the COS polygon its centre falls in. COS2015 is the land cover of 2015, the year
before both fires; polygons of at least 1 ha, level-4 classes, already in PT-TM06 like the grid.
Each COS class is given two readings of the same fuel, in RULES:
  - one of 5 classes (CLASSES), for the fast model in the browser and the map;
  - a Scott & Burgan 40 model, the code every engine gets (engines/CONTRACT.md). SimFire, which
    only knows the original 13 (Anderson), converts it in its own adapter.
The two agree on what does not burn.

The GeoPackage is downloaded data: SQLite opens it read-only and immutable, in defensive mode with
trusted_schema off, and only plain columns and geometry blobs are read.
"""

import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
import shapely

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / "web/public/fires"
GPKG = ROOT / "data/cos2015v2-dgt/extracted/COS2015v2-S1.gpkg"
TABLE = "COS2015v2"
SOURCE = {
    "dataset": "COS2015 v2, Carta de Uso e Ocupação do Solo de 2015 (série 1), Direção-Geral do Território",
    "licence": "CC BY 4.0",
    "url": "https://geo2.dgterritorio.gov.pt/cos/S1/COS2015/COS2015v2-S1-gpkg.zip",
}

CLASSES = ["Não combustível", "Herbáceo", "Mato", "Eucalipto e acácia", "Pinhal e folhosas"]
NONE, GRASS, SHRUB, EUCALYPT, FOREST = range(len(CLASSES))

# COS code prefix -> (class, Scott & Burgan, why). The longest matching prefix wins, so a level-4
# class can refine its group. S&B 91-99 do not burn. Both fires are in the Minho, in August and
# September: watered fields are green, the grass and the shrubs are dry.
RULES = {
    "1": (NONE, 91, "artificializado: edifícios, estradas, indústria"),
    "2.1": (NONE, 93, "culturas temporárias: no Minho, no verão, é sobretudo milho e forragem regados"),
    "2.2.1": (NONE, 93, "vinha: verde no verão, com a entrelinha lavrada"),
    "2.2.2": (GRASS, 102, "pomar: erva seca entre árvores espaçadas"),
    "2.2.3": (GRASS, 121, "olival: erva e mato baixo entre oliveiras espaçadas"),
    "2.3.1": (NONE, 93, "culturas temporárias associadas à vinha: regadas"),
    "2.3.2": (GRASS, 101, "mosaico de parcelas pequenas, parte regada e parte em pousio: erva de carga baixa"),
    "2.3.3": (GRASS, 122, "parcelas agrícolas com manchas de mato e árvores: erva com arbustos"),
    "2.4": (NONE, 93, "estufas e viveiros, regados"),
    "3.1": (GRASS, 102, "pastagem: erva contínua, seca no verão"),
    "4": (GRASS, 102, "sistema agroflorestal: erva seca sob árvores espaçadas"),
    "5.1.1": (FOREST, 186, "folhosas: folhada larga"),
    "5.1.1.3": (FOREST, 162, "carvalhal: folhada com sub-bosque de fetos, silvas e mato baixo"),
    "5.1.1.4": (FOREST, 186, "souto: limpo por baixo para a apanha da castanha, só folhada"),
    "5.1.1.5": (EUCALYPT, 165, "eucaliptal: casca, ramos e sub-bosque de mato, carga muito alta"),
    "5.1.1.6": (EUCALYPT, 165, "acacial: denso, com muitos ramos mortos, carga como a do eucaliptal"),
    "5.1.1.7": (FOREST, 186, "outras folhosas (bétula, amieiro, freixo), sobretudo em vales húmidos: folhada larga"),
    "5.1.2": (FOREST, 188, "resinosas: folhada de agulha longa"),
    "5.1.2.1": (FOREST, 165, "pinhal-bravo do Norte: sub-bosque de tojo e urze, que arde mais do que a folhada"),
    "5.1.2.3": (FOREST, 183, "outras resinosas, em povoamento fechado: folhada de agulha curta e compacta"),
    "6": (SHRUB, 145, "matos de tojo, urze e giesta, de 1 a 2 m; a COS não separa altura nem idade"),
    "7.1.1": (NONE, 99, "areia"),
    "7.1.2": (NONE, 99, "rocha nua"),
    "7.1.3": (GRASS, 101, "vegetação esparsa sobre rocha: erva e arbustos dispersos"),
    "8": (NONE, 98, "zona húmida"),
    "9": (NONE, 98, "água"),
}
SB_FAMILIES = {91: "NB", 101: "GR", 121: "GS", 141: "SH", 161: "TU", 181: "TL"}


def sb_name(code: int) -> str:
    base = max(b for b in SB_FAMILIES if b <= code)
    return f"{SB_FAMILIES[base]}{code - base + 1}"


for _cls, _sb, _ in RULES.values():
    assert (_cls == NONE) == (_sb < 100), "the class and the fuel model must agree on what burns"
    assert sb_name(_sb)


def rule(code: str):
    keys = [k for k in RULES if code == k or code.startswith(k + ".")]
    if not keys:
        raise SystemExit(f"COS class {code} has no fuel rule")
    return RULES[max(keys, key=len)]


def open_gpkg():
    db = sqlite3.connect(f"file:{GPKG}?mode=ro&immutable=1", uri=True)
    db.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
    db.execute("PRAGMA trusted_schema = OFF")
    srs = db.execute("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name = ?", (TABLE,)).fetchone()
    if srs != (3763,):
        raise SystemExit(f"{GPKG.name}: expected EPSG:3763, got {srs}")
    return db


def gpkg_geometry(blob: bytes):
    """A GeoPackage geometry blob: an 8-byte header, an optional envelope, then standard WKB."""
    if not isinstance(blob, bytes) or blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    envelope = (blob[3] >> 1) & 0b111
    if envelope > 4:
        raise ValueError(f"bad envelope code {envelope}")
    return shapely.from_wkb(blob[8 + (0, 32, 48, 48, 64)[envelope]:])


def build(db, fire_id: str):
    folder = FIRES / fire_id
    grid = json.loads((folder / "grid.json").read_text())
    cell, cols, rows = grid["cellsize"], grid["cols"], grid["rows"]
    x0, y0 = grid["xmin"], grid["ymin"]
    x1, y1 = x0 + cols * cell, y0 + rows * cell

    found = db.execute(
        f'SELECT t.geom, t.COS15n4_C, t.COS15n4_L FROM "{TABLE}" t JOIN "rtree_{TABLE}_geom" r ON r.id = t.fid '
        "WHERE r.maxx >= ? AND r.minx <= ? AND r.maxy >= ? AND r.miny <= ?",
        (x0, x1, y0, y1),
    ).fetchall()
    labels = {}
    for _, code, label in found:
        if not (isinstance(code, str) and isinstance(label, str) and len(code) <= 9 and len(label) <= 120):
            raise SystemExit(f"bad COS row {code!r} {label!r}")
        labels[code] = label
    # Clipped to the grid first: the road network and the ocean are single polygons the size of a region.
    shapes = shapely.clip_by_rect(np.array([gpkg_geometry(g) for g, _, _ in found]), x0, y0, x1, y1)
    codes = np.array([c for _, c, _ in found])

    # Cell centres, row 0 to the north, against the polygon that holds each one.
    xs = x0 + (np.arange(cols) + 0.5) * cell
    ys = y1 - (np.arange(rows) + 0.5) * cell
    centres = shapely.points(*(a.ravel() for a in np.meshgrid(xs, ys)))
    hit_cell, hit_shape = shapely.STRtree(shapes).query(centres, predicate="intersects")
    owner = np.full(centres.size, -1)
    owner[hit_cell] = hit_shape  # a centre right on a shared edge takes either polygon
    if (owner < 0).any():
        raise SystemExit(f"{fire_id}: {(owner < 0).sum()} cells outside every COS polygon")

    cell_codes = codes[owner]
    present, counts = np.unique(cell_codes, return_counts=True)
    order = np.argsort(-counts)
    legend = []
    for code, n in zip(present[order], counts[order]):
        cls, sb, why = rule(code)
        legend.append({"cos": code, "label": labels[code], "class": cls, "scottBurgan": sb,
                       "scottBurganName": sb_name(sb), "ha": round(int(n) * cell**2 / 1e4, 1), "why": why})
    index = {e["cos"]: i for i, e in enumerate(legend)}
    if len(legend) > 255:
        raise SystemExit(f"{fire_id}: {len(legend)} COS classes do not fit in one byte")
    (folder / "fuel.u8").write_bytes(np.vectorize(index.get)(cell_codes).astype(np.uint8).tobytes())

    doc = {
        "source": SOURCE,
        "cells": "fuel.u8: um byte por célula, linha a linha a partir da borda norte, índice na legenda",
        "classes": CLASSES,
        "legend": legend,
    }
    (folder / "fuel.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")

    total = cols * rows * cell**2 / 1e4
    print(f"{fire_id}: {len(found)} polígonos COS, {len(legend)} classes")
    for c, name in enumerate(CLASSES):
        ha = sum(e["ha"] for e in legend if e["class"] == c)
        print(f"  {name:<20} {ha:7.0f} ha  {100 * ha / total:4.1f} %")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fire_ids", nargs="*", help="default: every fire in web/public/fires/index.json")
    args = parser.parse_args()
    db = open_gpkg()
    for fire_id in args.fire_ids or [f["id"] for f in json.loads((FIRES / "index.json").read_text())]:
        build(db, fire_id)


if __name__ == "__main__":
    main()
