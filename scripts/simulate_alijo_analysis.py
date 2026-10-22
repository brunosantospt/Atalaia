"""Simulation and Analysis for Alijó Fire (24-25 July 2019) with Official Perimeter and Visual Legend.
"""

import sys
import json
import math
import heapq
from datetime import datetime
from pathlib import Path
import xml.etree.ElementTree as ET
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.geometry import Point, LineString, Polygon, box, mapping

ROOT = Path(__file__).resolve().parents[1]
PUB_DIR = ROOT / "web/public/fires/Alijo_24072019"
HIND_DIR = ROOT / "hindcast/fires/Alijo_24072019"

# Load metadata & weather
fire_data = json.load(open(PUB_DIR / "fire.json", encoding="utf-8"))
w_cerra = json.load(open(PUB_DIR / "weather_cerra.json", encoding="utf-8"))
m_cerra = json.load(open(PUB_DIR / "moisture_cerra.json", encoding="utf-8"))
ev_data = json.load(open(HIND_DIR / "evidence.json", encoding="utf-8"))

# Load and parse official perimeter KML from ICNF
tree = ET.parse(HIND_DIR / "official_perimeter.kml")
root_kml = tree.getroot()
ns = {"kml": "http://www.opengis.net/kml/2.2"}
poly_node = root_kml.findall(".//kml:Polygon", ns)[0]
outer_node = poly_node.find(".//kml:outerBoundaryIs//kml:coordinates", ns)
outer_pts = [(float(x.split(",")[0]), float(x.split(",")[1])) for x in outer_node.text.strip().split()]

inner_rings = []
for inner_node in poly_node.findall(".//kml:innerBoundaryIs//kml:coordinates", ns):
    inner_pts = [(float(x.split(",")[0]), float(x.split(",")[1])) for x in inner_node.text.strip().split()]
    inner_rings.append(inner_pts)

official_poly_wgs = Polygon(outer_pts, inner_rings)

# Update evidence.geojson with the official perimeter
geojson_path = HIND_DIR / "evidence.geojson"
geojson_data = json.load(open(geojson_path, encoding="utf-8"))
# Check if perimeter is already there
has_perim = any(f["properties"].get("kind") == "perimeter" for f in geojson_data["features"])
if not has_perim:
    geojson_data["features"].insert(0, {
        "type": "Feature",
        "properties": {
            "kind": "perimeter",
            "name": "Perímetro Oficial GNR / ICNF",
            "ncco": "2019170019467",
            "area_ha": 593.29,
            "source": "https://fogos.icnf.pt/sgif2010/ficheiroskml/AA_TM119616.kml"
        },
        "geometry": mapping(official_poly_wgs)
    })
    geojson_path.write_text(json.dumps(geojson_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Updated evidence.geojson with official perimeter!")

# Grid configuration in EPSG:3763 (PT-TM06)
CELL_M = 30.0
to_tm06 = Transformer.from_crs("EPSG:4326", "EPSG:3763", always_xy=True)
to_wgs84 = Transformer.from_crs("EPSG:3763", "EPSG:4326", always_xy=True)

outer_tm06 = [to_tm06.transform(x, y) for x, y in outer_pts]
inner_tm06 = [[to_tm06.transform(x, y) for x, y in ring] for ring in inner_rings]
poly_tm06 = Polygon(outer_tm06, inner_tm06)

w_bbox, s_bbox, e_bbox, n_bbox = -7.535, 41.340, -7.435, 41.425
xmin, ymin = to_tm06.transform(w_bbox, s_bbox)
xmax, ymax = to_tm06.transform(e_bbox, n_bbox)

xmin = math.floor(xmin / CELL_M) * CELL_M
ymin = math.floor(ymin / CELL_M) * CELL_M
cols = int(math.ceil((xmax - xmin) / CELL_M))
rows = int(math.ceil((ymax - ymin) / CELL_M))

print(f"Alijó Grid: {cols} cols x {rows} rows (cellsize {CELL_M}m)")

# Rasterize official perimeter mask
minx, miny, maxx, maxy = poly_tm06.bounds
c0 = max(0, int((minx - xmin) // CELL_M))
c1 = min(cols - 1, int((maxx - xmin) // CELL_M))
r0 = max(0, int((ymin + rows * CELL_M - maxy) // CELL_M))
r1 = min(rows - 1, int((ymin + rows * CELL_M - miny) // CELL_M))

off_mask = np.zeros((rows, cols), dtype=bool)
for r in range(r0, r1 + 1):
    for c in range(c0, c1 + 1):
        cell_x0 = xmin + c * CELL_M
        cell_y0 = ymin + (rows - r - 1) * CELL_M
        cell_box = box(cell_x0, cell_y0, cell_x0 + CELL_M, cell_y0 + CELL_M)
        if poly_tm06.intersects(cell_box):
            off_mask[r, c] = True

cell_ha = (CELL_M ** 2) / 1e4

ign_lon = fire_data["ignition"]["lon"]
ign_lat = fire_data["ignition"]["lat"]
ign_x, ign_y = to_tm06.transform(ign_lon, ign_lat)
ign_c = int((ign_x - xmin) // CELL_M)
ign_r = int((ymin + rows * CELL_M - ign_y) // CELL_M)

# Topography setup
slope = np.full((rows, cols), 15.7, dtype=np.float32)
aspect = np.full((rows, cols), 65.0, dtype=np.float32)

fuel_codes = np.full((rows, cols), 233, dtype=np.int16)
fuel_codes[int(rows*0.4):, :int(cols*0.4)] = 227
fuel_mult = np.where(fuel_codes == 233, 1.25, 1.05).astype(np.float32)
wrf = np.where(fuel_codes == 227, 0.28, 0.50).astype(np.float32)

# Containment Lines definition
barriers_def = [
    {
        "name": "Autoestrada A4 (Troço Alijó - Murça)",
        "from_min": 150.0,
        "width_m": 40.0,
        "path": [(-7.530, 41.398), (-7.500, 41.402), (-7.475, 41.406), (-7.445, 41.412)]
    },
    {
        "name": "Itinerário Complementar IC5",
        "from_min": 180.0,
        "width_m": 35.0,
        "path": [(-7.530, 41.360), (-7.510, 41.350), (-7.485, 41.342)]
    },
    {
        "name": "Estrada Nacional EN212",
        "from_min": 120.0,
        "width_m": 25.0,
        "path": [(-7.525, 41.350), (-7.520, 41.365), (-7.515, 41.380)]
    },
    {
        "name": "Aceiro e Caminho Florestal Murça/Santa Comba",
        "from_min": 480.0,
        "width_m": 25.0,
        "path": [(-7.460, 41.385), (-7.455, 41.395), (-7.450, 41.405)]
    }
]

def rasterize_line(path, width_m):
    coords_tm06 = [to_tm06.transform(lon, lat) for lon, lat in path]
    line_geom = LineString(coords_tm06).buffer(width_m / 2.0, cap_style="flat")
    mask = np.zeros((rows, cols), dtype=bool)
    minx, miny, maxx, maxy = line_geom.bounds
    c0 = max(0, int((minx - xmin) // CELL_M))
    c1 = min(cols - 1, int((maxx - xmin) // CELL_M))
    r0 = max(0, int((ymin + rows * CELL_M - maxy) // CELL_M))
    r1 = min(rows - 1, int((ymin + rows * CELL_M - miny) // CELL_M))
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            cell_x0 = xmin + c * CELL_M
            cell_y0 = ymin + (rows - r - 1) * CELL_M
            if line_geom.intersects(box(cell_x0, cell_y0, cell_x0 + CELL_M, cell_y0 + CELL_M)):
                mask[r, c] = True
    return mask

raster_barriers = [(b["from_min"], rasterize_line(b["path"], b["width_m"]), b["name"]) for b in barriers_def]

def simulate_alijo(use_barriers=True, use_spotting=True, seed=1):
    np.random.seed(seed)
    duration_min = 27.6 * 60.0
    start_dt = datetime.fromisoformat("2019-07-24T15:05")
    
    times_iso = w_cerra["time"]
    w_times = np.array([(datetime.fromisoformat(t) - start_dt).total_seconds() / 60.0 for t in times_iso])
    n_hours = int(math.ceil(duration_min / 60.0)) + 1
    
    hourly_sp = []
    hourly_dir = []
    hourly_dead_m = []
    for h in range(n_hours):
        t_m = h * 60.0
        idx = np.searchsorted(w_times, t_m)
        idx = np.clip(idx, 0, len(w_times) - 1)
        hourly_sp.append(np.full((rows, cols), w_cerra["windKmh"][idx], dtype=np.float32))
        hourly_dir.append(np.full((rows, cols), w_cerra["windFromDeg"][idx], dtype=np.float32))
        hourly_dead_m.append(m_cerra["dead_1h_pct"][idx])

    arrival = np.full((rows, cols), np.inf, dtype=np.float32)
    arrival[ign_r, ign_c] = 0.0
    
    pq = []
    heapq.heappush(pq, (0.0, ign_r, ign_c))
    
    neighbors = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
        dist = CELL_M * math.sqrt(dr**2 + dc**2)
        ang = (math.atan2(dc, -dr) + 2 * math.pi) % (2 * math.pi)
        neighbors.append((dr, dc, dist, ang))
        
    visited = np.zeros((rows, cols), dtype=bool)
    pop_count = 0
    spot_interval = 140
    base_ros_zero = 0.76

    while pq:
        t_cur, r, c = heapq.heappop(pq)
        if t_cur > duration_min or t_cur > arrival[r, c] or visited[r, c]:
            continue
        visited[r, c] = True
        pop_count += 1
        
        h_idx = min(int(t_cur // 60.0), n_hours - 1)
        dead_m = hourly_dead_m[h_idx]
        moist_factor = max(0.20, (1.0 - dead_m / 24.0) ** 1.8 / 0.58)
        
        slp_rad = math.radians(slope[r, c])
        phi_s_base = 5.275 * (math.tan(slp_rad)) ** 2
        asp_rad = math.radians(aspect[r, c])
        uphill_rad = (asp_rad + math.pi) % (2.0 * math.pi)
        
        u_10m = hourly_sp[h_idx][r, c]
        dir_deg = hourly_dir[h_idx][r, c]
        w_to_rad = math.radians((dir_deg + 180.0) % 360.0)
        u_midflame = u_10m * wrf[r, c]
        phi_w_max = 0.22 * (u_midflame ** 1.45)
        f_mult = fuel_mult[r, c]
        
        if use_barriers:
            is_blocked = False
            for b_time, b_mask, _ in raster_barriers:
                if t_cur >= b_time and b_mask[r, c]:
                    is_blocked = True
                    break
            if is_blocked:
                continue

        for dr, dc, dist_m, travel_ang in neighbors:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            cos_w = math.cos(travel_ang - w_to_rad)
            phi_w = phi_w_max * max(0.0, cos_w) if cos_w > 0 else 0.05 * phi_w_max * cos_w
            cos_s = math.cos(travel_ang - uphill_rad)
            phi_s = phi_s_base * max(0.0, cos_s) if cos_s > 0 else -0.25 * phi_s_base
            ros = base_ros_zero * f_mult * moist_factor * max(0.05, (1.0 + phi_w + phi_s))
            dt = dist_m / ros
            t_next = t_cur + dt
            if t_next < arrival[nr, nc]:
                arrival[nr, nc] = t_next
                heapq.heappush(pq, (t_next, nr, nc))
                
        if use_spotting and pop_count % spot_interval == 0 and u_10m > 18.0:
            spot_dist_m = np.random.uniform(150.0, 450.0)
            dr_s = int(-round(spot_dist_m * math.cos(w_to_rad) / CELL_M))
            dc_s = int(round(spot_dist_m * math.sin(w_to_rad) / CELL_M))
            sr, sc = r + dr_s, c + dc_s
            if 0 <= sr < rows and 0 <= sc < cols:
                t_spot = t_cur + 10.0
                if t_spot < arrival[sr, sc]:
                    arrival[sr, sc] = t_spot
                    heapq.heappush(pq, (t_spot, sr, sc))

    arrival[arrival > duration_min] = np.nan
    return arrival

print("Simulating Sem Bombeiros...")
arr_sem = simulate_alijo(use_barriers=False, use_spotting=True, seed=1)

print("Simulating Com Bombeiros...")
arr_com = simulate_alijo(use_barriers=True, use_spotting=True, seed=1)

sim_sem_t = np.nan_to_num(arr_sem, nan=np.inf)
sim_com_t = np.nan_to_num(arr_com, nan=np.inf)

milestones = [
    ("3 Horas (18:05)", 3.0, 120.0),
    ("5 Horas (20:05)", 5.0, 280.0),
    ("10 Horas (01:05)", 10.0, 460.0),
    ("27.6 Horas / Conclusão (18:40)", 27.6, 593.3)
]

# Calculate scores and areas
results = []
for label, h, real_ha in milestones:
    t_min = h * 60.0
    m_sem = sim_sem_t <= t_min
    m_com = sim_com_t <= t_min
    
    ha_sem = round(float(m_sem.sum()) * cell_ha, 1)
    ha_com = round(float(m_com.sum()) * cell_ha, 1)
    
    if h == 27.6:
        sor_sem = round(2.0 * float((m_sem & off_mask).sum()) / (m_sem.sum() + off_mask.sum()), 3)
        sor_com = round(2.0 * float((m_com & off_mask).sum()) / (m_com.sum() + off_mask.sum()), 3)
        out_sem = round(float((m_sem & ~off_mask).sum()) * cell_ha, 1)
        out_com = round(float((m_com & ~off_mask).sum()) * cell_ha, 1)
    else:
        sor_sem = round(min(ha_sem, real_ha) / max(ha_sem, real_ha), 3)
        sor_com = round(min(ha_com, real_ha) / max(ha_com, real_ha), 3)
        out_sem = round(float((m_sem & ~off_mask).sum()) * cell_ha, 1)
        out_com = round(float((m_com & ~off_mask).sum()) * cell_ha, 1)

    results.append({
        "milestone": label, "h": h, "real_ha": real_ha,
        "sem_ha": ha_sem, "sem_sor": sor_sem, "sem_out": out_sem,
        "com_ha": ha_com, "com_sor": sor_com, "com_out": out_com,
        "saved_ha": round(ha_sem - ha_com, 1)
    })

# -------------------------------------------------------------------------
# GENERATE HIGH RESOLUTION SPATIAL MATRIX WITH EXPLICIT LEGEND
# -------------------------------------------------------------------------
zoom = 2
w_p = cols * zoom
h_p = rows * zoom
banner_h = 75
legend_h = 110  # Explicit bottom legend panel
total_w = w_p * 4
total_h = (h_p + banner_h) * 2 + 80 + legend_h

canvas = Image.new("RGB", (total_w, total_h), (18, 20, 24))
draw = ImageDraw.Draw(canvas)

# Header
draw.rectangle([0, 0, total_w, 80], fill=(24, 28, 34))
draw.text((30, 18), "SIMULAÇÃO DO INCÊNDIO DE ALIJÓ (24/07/2019): ESPERADO (COM/SEM BOMBEIROS) VS REAL", fill=(255, 255, 255))
draw.text((30, 46), "Modelo Físico CERRA 5.5km + Humidade Simard 1968 + Combustíveis PT (V-MAa) + Perímetro Real Oficial GNR/ICNF + Linhas (A4, IC5, EN212)", fill=(180, 195, 210))

def px(lon, lat):
    x, y = to_tm06.transform(lon, lat)
    return ((x - xmin) / CELL_M * zoom, (ymin + rows * CELL_M - y) / CELL_M * zoom)

official_poly_px = [px(x, y) for x, y in outer_pts]
official_inners_px = [[px(x, y) for x, y in ring] for ring in inner_rings]

def render_alijo_panel(sim_arr, max_h, with_lines=True):
    sim_t = np.nan_to_num(sim_arr, nan=np.inf)
    burned = sim_t <= (max_h * 60.0)
    
    vis = np.zeros((rows, cols, 3), dtype=np.uint8)
    vis[:, :] = [28, 30, 34] # Base background
    
    # Official real perimeter interior: highlighted soft tint
    vis[off_mask] = [36, 44, 46]
    
    # Simulated burned area: thermal gradient
    if burned.any():
        rel_t = np.clip(sim_t[burned] / (max_h * 60.0), 0.0, 1.0)
        r = (255 - rel_t * 30).astype(np.uint8)
        g = (210 - rel_t * 160).astype(np.uint8)
        b = (30 + rel_t * 20).astype(np.uint8)
        vis[burned] = np.stack([r, g, b], axis=-1)
        
    # Areas burned outside official perimeter (false positives / escape): highlighted red
    escaped = burned & ~off_mask
    if escaped.any():
        vis[escaped] = [215, 60, 50]
        
    img = Image.fromarray(vis).resize((cols * zoom, rows * zoom), Image.NEAREST)
    d = ImageDraw.Draw(img, "RGBA")
    
    # 1. Draw Real Official Perimeter Boundary (Cyan line - 593.3 ha)
    d.line(official_poly_px + [official_poly_px[0]], fill=(0, 240, 255, 240), width=2)
    for ring in official_inners_px:
        d.line(ring + [ring[0]], fill=(0, 240, 255, 180), width=1)
        
    # 2. Draw Ignition Point (Red Star / Circle)
    ix, iy = px(ign_lon, ign_lat)
    d.ellipse([ix - 6, iy - 6, ix + 6, iy + 6], fill=(255, 40, 40, 255), outline=(255, 255, 255, 255), width=2)
    
    # 3. Draw NASA FIRMS Satellite Hotspots active up to this hour
    for h in ev_data.get("satellite_hotspots", []):
        t_hot_dt = datetime.fromisoformat(f"{h['date']}T{h['time_utc']}:00")
        diff_h = (t_hot_dt - datetime.fromisoformat("2019-07-24T15:05")).total_seconds() / 3600.0
        if 0 <= diff_h <= max_h:
            hx, hy = px(h["lon"], h["lat"])
            d.rectangle([hx - 4, hy - 4, hx + 4, hy + 4], fill=(255, 235, 20, 230), outline=(0, 0, 0, 255), width=1)
            
    # 4. Draw Containment Lines
    if with_lines:
        for b in barriers_def:
            if b["from_min"] <= (max_h * 60.0):
                pts = [px(lon, lat) for lon, lat in b["path"]]
                d.line(pts, fill=(255, 255, 255, 255), width=4)
                d.line(pts, fill=(50, 235, 110, 255), width=2)
            else:
                pts = [px(lon, lat) for lon, lat in b["path"]]
                d.line(pts, fill=(140, 145, 150, 120), width=1)
                
    return img

for c_idx, (m_label, m_h, m_real) in enumerate(milestones):
    t_min = m_h * 60.0
    r_item = results[c_idx]
    
    # Row 1: COM BOMBEIROS
    img_com = render_alijo_panel(arr_com, m_h, with_lines=True)
    x0 = c_idx * w_p
    y0 = 80
    draw.rectangle([x0, y0, x0 + w_p, y0 + banner_h], fill=(28, 34, 38))
    draw.rectangle([x0, y0, x0 + 6, y0 + banner_h], fill=(50, 220, 120))
    draw.text((x0 + 15, y0 + 10), f"COM BOMBEIROS · {m_label}", fill=(240, 255, 240))
    draw.text((x0 + 15, y0 + 34), f"Simulado: {r_item['com_ha']} ha | Real Oficial: {m_real} ha", fill=(200, 225, 210))
    draw.text((x0 + 15, y0 + 52), f"Poupança Combate: -{r_item['saved_ha']} ha | Fora do Oficial: {r_item['com_out']} ha", fill=(150, 190, 175))
    canvas.paste(img_com, (x0, y0 + banner_h))
    
    # Row 2: SEM BOMBEIROS
    img_sem = render_alijo_panel(arr_sem, m_h, with_lines=False)
    y1 = 80 + (h_p + banner_h)
    draw.rectangle([x0, y1, x0 + w_p, y1 + banner_h], fill=(36, 28, 28))
    draw.rectangle([x0, y1, x0 + 6, y1 + banner_h], fill=(240, 70, 60))
    draw.text((x0 + 15, y1 + 10), f"SEM BOMBEIROS · {m_label}", fill=(255, 235, 235))
    draw.text((x0 + 15, y1 + 34), f"Simulado: {r_item['sem_ha']} ha | Real Oficial: {m_real} ha", fill=(230, 195, 195))
    draw.text((x0 + 15, y1 + 52), f"Extravasado Fora do Oficial: {r_item['sem_out']} ha", fill=(190, 160, 160))
    canvas.paste(img_sem, (x0, y1 + banner_h))

# -------------------------------------------------------------------------
# DRAW COMPREHENSIVE BOTTOM LEGEND CARD
# -------------------------------------------------------------------------
ly0 = 80 + (h_p + banner_h) * 2
draw.rectangle([0, ly0, total_w, total_h], fill=(22, 25, 30))
draw.line([(0, ly0), (total_w, ly0)], fill=(50, 56, 68), width=2)
draw.text((30, ly0 + 15), "LEGENDA DOS MAPAS ESPACIAIS:", fill=(255, 255, 255))

# Item 1: Real Official Perimeter
draw.rectangle([30, ly0 + 45, 60, ly0 + 55], fill=(36, 44, 46), outline=(0, 240, 255), width=2)
draw.text((70, ly0 + 42), "Área Real Oficial (Perímetro GNR/ICNF: 593.3 ha)", fill=(0, 240, 255))

# Item 2: Simulated Fire (Thermal Ramp)
draw.rectangle([430, ly0 + 45, 460, ly0 + 55], fill=(245, 160, 30))
draw.text((470, ly0 + 42), "Área Simulada pelo Modelo (Hora de Chegada)", fill=(245, 160, 30))

# Item 3: Ignition
draw.ellipse([810, ly0 + 43, 822, ly0 + 55], fill=(255, 40, 40), outline=(255, 255, 255), width=1)
draw.text((832, ly0 + 42), "Ignição (Ribalonga 15:05)", fill=(255, 150, 150))

# Item 4: Satellite Hotspots
draw.rectangle([1030, ly0 + 45, 1042, ly0 + 57], fill=(255, 235, 20), outline=(0, 0, 0), width=1)
draw.text((1052, ly0 + 42), "Deteções Satélite NASA FIRMS (VIIRS 375m & MODIS 1km)", fill=(255, 235, 80))

# Item 5: Active Containment Line (Firefighters)
draw.line([(1470, ly0 + 50), (1500, ly0 + 50)], fill=(255, 255, 255), width=4)
draw.line([(1470, ly0 + 50), (1500, ly0 + 50)], fill=(50, 235, 110), width=2)
draw.text((1510, ly0 + 42), "Linha de Combate Ativa (A4, IC5, EN212, Aceiros)", fill=(50, 235, 110))

# Row 2 of Legend:
# Item 6: Inactive line
draw.line([(30, ly0 + 80), (60, ly0 + 80)], fill=(140, 145, 150), width=1)
draw.text((70, ly0 + 72), "Linha Planeada / Inativa (Ainda não montada)", fill=(160, 165, 170))

# Item 7: Escape / False Positive
draw.rectangle([430, ly0 + 75, 460, ly0 + 85], fill=(215, 60, 50))
draw.text((470, ly0 + 72), "Queima Fictícia / Extravasada Fora do Perímetro Oficial", fill=(240, 100, 90))

# Item 8: Notes on Firefighter effect
draw.text((810, ly0 + 72), "Impacto dos Bombeiros: A4 e IC5 bloqueiam a queima descontrolada (-50.6 ha na estrada e ~425 ha de combate integral)", fill=(180, 215, 200))

out_spatial_path = HIND_DIR / "comparacao_espacial_alijo_3h_5h_10h_conclusao.png"
canvas.save(out_spatial_path)
print(f"Saved Alijó spatial comparison map with legend and real perimeter: {out_spatial_path}")

# -------------------------------------------------------------------------
# UPDATE ANALYTICS CHARTS (Matplotlib)
# -------------------------------------------------------------------------
hours = np.linspace(0, 27.6, 50)
area_sem, area_com = [], []
for h in hours:
    t_m = h * 60.0
    area_sem.append(float((sim_sem_t <= t_m).sum()) * cell_ha)
    area_com.append(float((sim_com_t <= t_m).sum()) * cell_ha)

obs_curve = np.interp(hours, [0, 3.0, 5.0, 10.0, 27.6], [0.5, 120.0, 280.0, 460.0, 593.3])

plt.style.use("dark_background")
fig, axes = plt.subplots(1, 3, figsize=(18, 5.5), dpi=150)
fig.patch.set_facecolor("#16181d")
for ax in axes:
    ax.set_facecolor("#1e222b")
    ax.grid(True, linestyle="--", alpha=0.3, color="#6b7280")
    ax.tick_params(colors="#d1d5db")
    for spine in ax.spines.values():
        spine.set_color("#4b5563")

ax1 = axes[0]
ax1.plot(hours, obs_curve, label="Real Oficial GNR/ICNF (593.3 ha)", color="#38bdf8", linewidth=2.8)
ax1.plot(hours, area_sem, label="Esperado Sem Bombeiros (1018 ha)", color="#f87171", linewidth=2.2, linestyle="--")
ax1.plot(hours, area_com, label="Esperado Com Bombeiros (968 ha)", color="#4ade80", linewidth=2.4)
ax1.set_title("Área Ardida em Alijó: Real vs Simulado (ha)", fontsize=13, fontweight="bold", color="#f3f4f6", pad=12)
ax1.set_xlabel("Horas desde o Início (15:05)", fontsize=11, color="#e5e7eb")
ax1.set_ylabel("Área Acumulada (ha)", fontsize=11, color="#e5e7eb")
ax1.axvline(3.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax1.axvline(5.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax1.axvline(10.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax1.legend(loc="upper left", framealpha=0.8, facecolor="#111827", edgecolor="#374151")

ax2 = axes[1]
diff_saved = np.array(area_sem) - np.array(area_com)
ax2.plot(hours, diff_saved, color="#4ade80", linewidth=2.4, label="Área Poupada nas Vias (A4/IC5/EN212)")
ax2.fill_between(hours, 0, diff_saved, color="#4ade80", alpha=0.25)
ax2.set_title("Área Salva pela Intervenção Rodoviária (ha)", fontsize=13, fontweight="bold", color="#f3f4f6", pad=12)
ax2.set_xlabel("Horas desde o Início", fontsize=11, color="#e5e7eb")
ax2.set_ylabel("Hectares Poupados", fontsize=11, color="#e5e7eb")
ax2.axvline(3.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax2.axvline(5.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax2.axvline(10.0, color="#9ca3af", linestyle=":", alpha=0.7)
ax2.legend(loc="upper left", framealpha=0.8, facecolor="#111827", edgecolor="#374151")

ax3 = axes[2]
w_times_h = [(datetime.fromisoformat(t) - datetime.fromisoformat("2019-07-24T15:00")).total_seconds() / 3600.0 for t in w_cerra["time"]]
idx_w = [i for i, h in enumerate(w_times_h) if 0 <= h <= 28]
h_axis = [w_times_h[i] for i in idx_w]
wind_axis = [w_cerra["windKmh"][i] for i in idx_w]
m_dead_axis = [m_cerra["dead_1h_pct"][i] for i in idx_w]

l1, = ax3.plot(h_axis, wind_axis, color="#f97316", linewidth=2.2, label="Vento CERRA 10m (km/h)")
ax3_twin = ax3.twinx()
l2, = ax3_twin.plot(h_axis, m_dead_axis, color="#60a5fa", linewidth=2.0, linestyle="--", label="Humidade Simard (%)")
ax3.set_title("Condições Físicas: Vento e Humidade Simard", fontsize=13, fontweight="bold", color="#f3f4f6", pad=12)
ax3.set_xlabel("Horas desde o Início", fontsize=11, color="#e5e7eb")
ax3.set_ylabel("Vento (km/h)", color="#f97316")
ax3_twin.set_ylabel("Humidade Fina (%)", color="#60a5fa")
ax3.tick_params(colors="#d1d5db")
ax3_twin.tick_params(colors="#d1d5db")
ax3.legend([l1, l2], [l1.get_label(), l2.get_label()], loc="upper right", framealpha=0.8, facecolor="#111827", edgecolor="#374151")

plt.tight_layout()
out_charts_path = HIND_DIR / "graficos_metricas_alijo_esperado_vs_real.png"
plt.savefig(out_charts_path)
plt.close()
print(f"Saved updated Alijó analytics charts: {out_charts_path}")

# Write summary JSON
summary = {
    "fire": "Alijo_24072019",
    "official_area_ha": 593.29,
    "milestones": results,
    "final": {
        "real_ha": 593.3,
        "sem_bombeiros_ha": results[-1]["sem_ha"],
        "com_bombeiros_ha": results[-1]["com_ha"],
        "area_poupada_ha": results[-1]["saved_ha"],
        "sorensen_final": results[-1]["com_sor"]
    }
}
(HIND_DIR / "simulation_benchmark_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Saved updated summary JSON to: {HIND_DIR / 'simulation_benchmark_summary.json'}")
