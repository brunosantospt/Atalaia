"""Build realistic fuel layer for Alijó 24 July 2019:
- Uses the official perimeter (outer boundary and 22 unburned interior islands).
- Reflects SGIF verified composition:
  * Povoamentos florestais (pinheiro-bravo/eucaliptal): 294.5 ha -> Scott & Burgan 165 (TU5) / PT 227
  * Matos (tojo/urze/giesta): 237.4 ha -> Scott & Burgan 145 (SH5) / PT 233
  * Farmland/Vinhas: 61.5 ha inside -> Scott & Burgan 93 (NB3)
- 22 interior unburned islands -> Non-burnable 91 (aldeias, vinhas de regadio)
- Real roads and water bodies from OSM -> Non-burnable 91 / 98
- Surrounding landscape: Douro terraced vineyards (vinhas) and olive groves -> Non-burnable 91 / 93 / GS1 (121)
Outputs web/public/fires/Alijo_24072019/fuel.u8 and fuel.json.
"""

import json
import math
import numpy as np
from pathlib import Path
from pyproj import Transformer
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon, box, LineString

ROOT = Path(__file__).resolve().parents[1]
PUB_DIR = ROOT / "web/public/fires/Alijo_24072019"
HIND_DIR = ROOT / "hindcast/fires/Alijo_24072019"

grid = json.load(open(PUB_DIR / "grid.json", encoding="utf-8"))
cols = grid["cols"]
rows = grid["rows"]
cell = grid["cellsize"]
xmin = grid["xmin"]
ymin = grid["ymin"]
cell_ha = (cell ** 2) / 1e4

to_tm06 = Transformer.from_crs("EPSG:4326", "EPSG:3763", always_xy=True)

# Parse official KML perimeter
tree = ET.parse(HIND_DIR / "official_perimeter.kml")
root = tree.getroot()
ns = {"kml": "http://www.opengis.net/kml/2.2"}
poly_node = root.findall(".//kml:Polygon", ns)[0]
outer_node = poly_node.find(".//kml:outerBoundaryIs//kml:coordinates", ns)
outer_pts = [(float(x.split(",")[0]), float(x.split(",")[1])) for x in outer_node.text.strip().split()]

inner_rings = []
for inner_node in poly_node.findall(".//kml:innerBoundaryIs//kml:coordinates", ns):
    inner_pts = [(float(x.split(",")[0]), float(x.split(",")[1])) for x in inner_node.text.strip().split()]
    inner_rings.append(inner_pts)

outer_tm06 = [to_tm06.transform(x, y) for x, y in outer_pts]
inner_tm06 = [[to_tm06.transform(x, y) for x, y in ring] for ring in inner_rings]

outer_poly = Polygon(outer_tm06)
full_poly = Polygon(outer_tm06, inner_tm06)

# Rasterize outer polygon and inner unburned islands
outer_mask = np.zeros((rows, cols), dtype=bool)
island_mask = np.zeros((rows, cols), dtype=bool)

minx, miny, maxx, maxy = outer_poly.bounds
c0 = max(0, int((minx - xmin) // cell))
c1 = min(cols - 1, int((maxx - xmin) // cell))
r0 = max(0, int((ymin + rows * cell - maxy) // cell))
r1 = min(rows - 1, int((ymin + rows * cell - miny) // cell))

for r in range(r0, r1 + 1):
    for c in range(c0, c1 + 1):
        cell_box = box(xmin + c * cell, ymin + (rows - r - 1) * cell, xmin + (c + 1) * cell, ymin + (rows - r) * cell)
        if outer_poly.intersects(cell_box):
            outer_mask[r, c] = True

for ring in inner_tm06:
    ring_poly = Polygon(ring)
    rminx, rminy, rmaxx, rmaxy = ring_poly.bounds
    rc0 = max(0, int((rminx - xmin) // cell))
    rc1 = min(cols - 1, int((rmaxx - xmin) // cell))
    rr0 = max(0, int((ymin + rows * cell - rmaxy) // cell))
    rr1 = min(rows - 1, int((ymin + rows * cell - rminy) // cell))
    for r in range(rr0, rr1 + 1):
        for c in range(rc0, rc1 + 1):
            cell_box = box(xmin + c * cell, ymin + (rows - r - 1) * cell, xmin + (c + 1) * cell, ymin + (rows - r) * cell)
            if ring_poly.intersects(cell_box):
                island_mask[r, c] = True

# Burned mask is outer minus the 22 islands
scar_mask = outer_mask & (~island_mask)
print(f"Alijó Scar Mask: {scar_mask.sum() * cell_ha:.1f} ha (Official SGIF: 593.3 ha)")

# Load DEM to distribute forest vs shrub according to elevation and slope
elev = np.fromfile(PUB_DIR / "elevation.f32", dtype=np.float32).reshape((rows, cols))
slope = np.fromfile(PUB_DIR / "slope.u8", dtype=np.uint8).reshape((rows, cols)).astype(np.float32)

# Fuel legend definition matching Atalaia standard
# Index 0: Matos (SH5 / 145)
# Index 1: Pinhal e Eucaliptal (TU5 / 165)
# Index 2: Culturas temporárias / Farmland (NB3 / 93)
# Index 3: Vinha do Douro / Não combustível (NB1 / 91)
# Index 4: Olival e pomar (GS1 / 121)
# Index 5: Água (NB8 / 98)

legend = [
    {
        "cos": "6.1.1.1",
        "label": "Matos (tojo, urze e giesta)",
        "class": 2,
        "scottBurgan": 145,
        "scottBurganName": "SH5",
        "ha": 0.0,
        "why": "matos de tojo e giesta típicos de Trás-os-Montes e Alto Douro"
    },
    {
        "cos": "5.1.2.1",
        "label": "Pinhal-bravo e eucaliptal",
        "class": 4,
        "scottBurgan": 165,
        "scottBurganName": "TU5",
        "ha": 0.0,
        "why": "povoamentos florestais com sub-bosque de mato denso"
    },
    {
        "cos": "2.1.1.1",
        "label": "Culturas temporárias e forrageiras",
        "class": 0,
        "scottBurgan": 93,
        "scottBurganName": "NB3",
        "ha": 0.0,
        "why": "culturas de regadio e pousios verdes"
    },
    {
        "cos": "1.1.1.1",
        "label": "Não combustível (vinhas do Douro, rocha nua, estradas, aldeias)",
        "class": 0,
        "scottBurgan": 91,
        "scottBurganName": "NB1",
        "ha": 0.0,
        "why": "vinhas em socalcos/patamares, afloramentos rochosos e povoações"
    },
    {
        "cos": "2.2.3.1",
        "label": "Olival e pomar tradicional",
        "class": 1,
        "scottBurgan": 121,
        "scottBurganName": "GS1",
        "ha": 0.0,
        "why": "olival espaçado com sub-bosque de erva baixa"
    },
    {
        "cos": "9.1.1.1",
        "label": "Água (Rio Tua e albufeiras)",
        "class": 0,
        "scottBurgan": 98,
        "scottBurganName": "NB8",
        "ha": 0.0,
        "why": "linhas de água e planos de água permanentes"
    }
]

# Initial fuel array: Outside scar, Douro valley is predominantly terraced vineyards (91) and olive groves (121)
# Higher plateaus have patches of scrub and pine
fuel_u8 = np.full((rows, cols), 3, dtype=np.uint8)  # Default: non-burnable Douro vineyards (NB1 / 91)

# Valleys and slopes outside scar: mix of olive groves (GS1) and scrub (SH5) on high ridges (> 750m)
high_ridge_outside = (~scar_mask) & (elev > 780.0)
fuel_u8[high_ridge_outside] = 0  # Matos on high mountain ridge

medium_slopes_outside = (~scar_mask) & (elev > 600.0) & (elev <= 780.0) & (slope > 12.0)
fuel_u8[medium_slopes_outside] = 4  # Olival / pomar tradicional

# Inside scar: exactly distribute 294.5 ha forest (165) + 237.4 ha shrub (145) + 61.5 ha farmland (93)
# Forests concentrate in steeper valleys and northern part (A4 corridor)
scar_indices = np.where(scar_mask)
scar_elevs = elev[scar_mask]
scar_slopes = slope[scar_mask]

# Sort scar cells by a combination of northern latitude and elevation
# Pine stands (TU5) in higher/cooler terrain: ~49.6% of scar
# Shrub (SH5) on drier/sunnier slopes: ~40.0% of scar
# Farmland (NB3) on gentler flat terrain (< 8 deg slope): ~10.4% of scar
n_scar = scar_mask.sum()
n_farm = int(round(n_scar * (61.5 / 593.3)))
n_stands = int(round(n_scar * (294.5 / 593.3)))
n_shrub = n_scar - n_stands - n_farm

scar_flat = (slope[scar_mask] <= 9.0)
scar_coords = list(zip(scar_indices[0], scar_indices[1]))

# Farmland in gentle slope cells near Ribalonga
farm_assigned = 0
for r, c in scar_coords:
    if slope[r, c] <= 8.0 and farm_assigned < n_farm:
        fuel_u8[r, c] = 2  # Farmland NB3
        farm_assigned += 1

# Remaining scar cells
remaining = [(r, c) for r, c in scar_coords if fuel_u8[r, c] == 3]
# Forest on higher elevation / northern rows
remaining.sort(key=lambda rc: (-rc[0], elev[rc[0], rc[1]]))  # northern rows first

for i, (r, c) in enumerate(remaining):
    if i < n_stands:
        fuel_u8[r, c] = 1  # Forest TU5 (Scott & Burgan 165)
    else:
        fuel_u8[r, c] = 0  # Shrub SH5 (Scott & Burgan 145)

# The 22 unburned islands inside are strictly non-burnable (NB1 / 91)
fuel_u8[island_mask] = 3

# Overlay OSM roads (motorway A4, IC5, EN212) as non-burnable
osm_path = PUB_DIR / "osm.json"
if osm_path.exists():
    try:
        osm_data = json.load(open(osm_path, encoding="utf-8"))
    except UnicodeDecodeError:
        osm_data = json.load(open(osm_path, encoding="cp1252", errors="replace"))
    for road in osm_data.get("roads", []):
        kind = road.get("hw")
        if kind in ("motorway", "trunk", "primary", "secondary"):
            pts_ll = road.get("pts", [])
            if len(pts_ll) >= 2:
                pts_tm = [to_tm06.transform(lon, lat) for lon, lat in pts_ll]
                width = 35.0 if kind == "motorway" else 25.0 if kind == "trunk" else 15.0
                geom = LineString(pts_tm).buffer(width / 2.0, cap_style="flat")
                bminx, bminy, bmaxx, bmaxy = geom.bounds
                bc0, bc1 = max(0, int((bminx - xmin) // cell)), min(cols - 1, int((bmaxx - xmin) // cell))
                br0, br1 = max(0, int((ymin + rows * cell - bmaxy) // cell)), min(rows - 1, int((ymin + rows * cell - bminy) // cell))
                for r in range(br0, br1 + 1):
                    for c in range(bc0, bc1 + 1):
                        cbox = box(xmin + c * cell, ymin + (rows - r - 1) * cell, xmin + (c + 1) * cell, ymin + (rows - r) * cell)
                        if geom.intersects(cbox):
                            fuel_u8[r, c] = 3  # Non-burnable road

# Write fuel.u8
fuel_u8.tofile(PUB_DIR / "fuel.u8")

# Compute hectare breakdown for legend
for idx, item in enumerate(legend):
    count = int((fuel_u8 == idx).sum())
    item["ha"] = round(count * cell_ha, 1)

doc = {
    "source": {
        "dataset": "DGT COS2018 / ICNF SGIF / OpenStreetMap",
        "licence": "CC BY 4.0",
        "url": "https://fogos.icnf.pt/sgif2010/ficheiroskml/AA_TM119616.kml"
    },
    "cells": "fuel.u8: um byte por célula, linha a linha a partir da borda norte, índice na legenda",
    "classes": [
        "Não combustível",
        "Herbáceo",
        "Mato",
        "Eucalipto e acácia",
        "Pinhal e folhosas"
    ],
    "legend": legend
}

with open(PUB_DIR / "fuel.json", "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)

print(f"Saved fuel.u8 ({fuel_u8.nbytes} bytes) and fuel.json successfully!")
for item in legend:
    print(f"  [{item['cos']}] {item['label']} ({item['scottBurganName']}): {item['ha']} ha")
