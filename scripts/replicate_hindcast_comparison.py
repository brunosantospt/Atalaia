"""Replication and Comparison Benchmark:
Colleague Hindcast (ERA5 + Flat Wind + Static Moisture)
VS
Our New Conditions (CERRA 5.5km + 30m TopoWind + Dynamic Simard Moisture).
Generates JSON statistics and side-by-side comparison visualization image.
"""

import sys
import json
import math
import heapq
import time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import shape

# Ensure local imports work
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hindcast"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import fires
import common
import fuels
import runs
from build_wind_field import calculate_micro_wind

FIRE_ID = "VieiradoMinho_10082016"

def load_all_data():
    fire = fires.Fire(FIRE_ID)
    ev, feats = common.evidence(FIRE_ID)
    legend = json.loads((fire.folder / "fuel.json").read_text(encoding="utf-8"))["legend"]
    w_era5 = json.loads((fire.folder / "weather.json").read_text(encoding="utf-8"))
    w_cerra = json.loads((fire.folder / "weather_cerra.json").read_text(encoding="utf-8"))
    m_cerra = json.loads((fire.folder / "moisture_cerra.json").read_text(encoding="utf-8"))
    
    cols, rows = fire.cols, fire.rows
    elev = np.fromfile(fire.folder / "elevation.f32", dtype=np.float32).reshape((rows, cols))
    slope = np.fromfile(fire.folder / "slope.u8", dtype=np.uint8).reshape((rows, cols)).astype(np.float32)
    aspect = np.fromfile(fire.folder / "aspect.u16", dtype=np.uint16).reshape((rows, cols)).astype(np.float32)
    fuel_idx = np.fromfile(fire.folder / "fuel.u8", dtype=np.uint8).reshape((rows, cols))
    
    # Canopy layer
    canopy_path = Path("hindcast/fires") / FIRE_ID / "canopy.npz"
    if canopy_path.exists():
        c = np.load(canopy_path)
        cover = c["cover_pct"]
    else:
        cover = np.zeros((rows, cols), dtype=np.float32)
        
    # Wind reduction factor (Albini & Baughman 1979 / Rothermel 1983)
    # Open shrub/heath: wrf ~ 0.55; dense forest (cover > 50%): wrf ~ 0.20
    wrf = np.where(cover > 10, 0.20 + 0.15 * (1.0 - cover / 100.0), 0.55).astype(np.float32)
    
    # Barriers
    att_path = Path("hindcast/fires") / FIRE_ID / "attack_lines.json"
    lines = []
    if att_path.exists():
        att_data = json.loads(att_path.read_text(encoding="utf-8"))
        lines = att_data.get("barriers", [])
        
    return fire, ev, feats, legend, w_era5, w_cerra, m_cerra, elev, slope, aspect, fuel_idx, cover, wrf, lines

def simulate_propagation(fire, slope, aspect, fuel_codes, wrf, weather, moistures,
                         use_topowind=False, use_dynamic_moisture=False,
                         use_scars=False, use_spotting=False, barriers=None,
                         feats=None, seed=1):
    np.random.seed(seed)
    rows, cols = fire.rows, fire.cols
    cellsize = fire.cellsize
    duration_min = (fire.steps[-1]["hours"] - fire.steps[0]["hours"]) * 60.0  # 1350 min (22.5 h)
    start_dt = fires.parse_time(fire.steps[0]["time"])
    
    # Weather timeline
    w_times = np.array([(fires.parse_time(t) - start_dt).total_seconds() / 60.0 for t in weather["time"]])
    
    # Non-burnable mask
    non_burnable = (fuel_codes == fires.NONBURNABLE) | (fuel_codes < 100)
    
    # Scars (Cicatrizes dos 40 dias anteriores, ex: Sobradelo da Goma)
    if use_scars and feats:
        scar_mask = np.zeros((rows, cols), dtype=bool)
        for f in feats:
            if f["properties"]["kind"] == "scar":
                scar_mask |= common.cells(fire, shape(f["geometry"]))
        non_burnable |= scar_mask

    # Rasterize barriers with holding minute
    raster_barriers = []
    if barriers:
        for b in barriers:
            from_m = b.get("from_min", 0.0)
            if from_m < duration_min:
                mask = fire.line(b["path"], b.get("width_m", 20.0))
                raster_barriers.append((from_m, mask))
                
    # Fuel properties
    # High-load shrubs (233 / V-MAa) have high dead fine fuel load and fast spread
    fuel_mult = np.ones((rows, cols), dtype=np.float32)
    is_shrub = (fuel_codes == 233) | (fuel_codes == 145) | (fuel_codes == 234)
    is_pine = (fuel_codes == 227) | (fuel_codes == 165)
    is_euc = (fuel_codes == 211) | (fuel_codes == 223)
    fuel_mult[is_shrub] = 1.25
    fuel_mult[is_pine] = 1.05
    fuel_mult[is_euc] = 1.10

    # Hourly weather fields
    n_hours = int(math.ceil(duration_min / 60.0)) + 1
    hourly_sp = []
    hourly_dir = []
    hourly_dead_m = []
    
    for h in range(n_hours):
        t_m = h * 60.0
        idx = np.searchsorted(w_times, t_m)
        idx = np.clip(idx, 0, len(w_times) - 1)
        u_amb = weather["windKmh"][idx]
        dir_amb = weather["windFromDeg"][idx]
        hour_of_day = (start_dt.hour + h) % 24
        
        if use_topowind:
            sp_map, dir_map = calculate_micro_wind(u_amb, dir_amb, hour_of_day, slope, aspect)
        else:
            sp_map = np.full((rows, cols), u_amb, dtype=np.float32)
            dir_map = np.full((rows, cols), dir_amb, dtype=np.float32)
            
        if use_dynamic_moisture and moistures:
            d_val = moistures["dead_1h_pct"][idx] if idx < len(moistures["dead_1h_pct"]) else 6.0
        else:
            # Fixed dead moisture 6.0% (standard API / hindcast fixed)
            d_val = 6.0
            
        hourly_sp.append(sp_map)
        hourly_dir.append(dir_map)
        hourly_dead_m.append(d_val)

    # Initial arrival grid from perimeter 0
    arrival = np.full((rows, cols), np.inf, dtype=np.float32)
    p0 = fire.perimeter(0)
    arrival[p0] = 0.0
    
    pq = []
    for r, c in zip(*np.where(p0)):
        heapq.heappush(pq, (0.0, int(r), int(c)))
        
    neighbors = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
        dist = cellsize * math.sqrt(dr**2 + dc**2)
        ang = (math.atan2(dc, -dr) + 2 * math.pi) % (2 * math.pi)
        neighbors.append((dr, dc, dist, ang))
        
    visited = np.zeros((rows, cols), dtype=bool)
    pop_count = 0
    spot_interval = 180
    base_ros_zero = 0.78  # Calibrated baseline surface spread rate (m/min)

    while pq:
        t_cur, r, c = heapq.heappop(pq)
        if t_cur > duration_min or t_cur > arrival[r, c] or visited[r, c]:
            continue
        visited[r, c] = True
        pop_count += 1
        
        h_idx = min(int(t_cur // 60.0), n_hours - 1)
        dead_m = hourly_dead_m[h_idx]
        
        # Dynamic Simard Moisture Factor (Simard 1968 / Rothermel 1972)
        # Moisture damping eta_m: at 6% -> 1.0; at 4.7% -> 1.15; at 12% -> 0.45
        moist_factor = max(0.20, (1.0 - dead_m / 24.0) ** 1.8 / 0.58)
        
        # Slope factor
        slp_rad = math.radians(slope[r, c])
        phi_s_base = 5.275 * (math.tan(slp_rad)) ** 2
        asp_rad = math.radians(aspect[r, c])
        uphill_rad = (asp_rad + math.pi) % (2.0 * math.pi)
        
        # Midflame wind from canopy reduction factor
        u_10m = hourly_sp[h_idx][r, c]
        dir_deg = hourly_dir[h_idx][r, c]
        w_to_rad = math.radians((dir_deg + 180.0) % 360.0)
        u_midflame = u_10m * wrf[r, c]
        phi_w_max = 0.22 * (u_midflame ** 1.45)
        
        f_mult = fuel_mult[r, c]
        
        # Check active attack lines
        is_blocked = False
        for b_time, b_mask in raster_barriers:
            if t_cur >= b_time and b_mask[r, c]:
                is_blocked = True
                break
        if is_blocked:
            continue

        for dr, dc, dist_m, travel_ang in neighbors:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols) or non_burnable[nr, nc]:
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
                
        # Spotting ahead of the front (NASA FIRMS & ELMFIRE ember model)
        if use_spotting and pop_count % spot_interval == 0 and u_10m > 18.0:
            spot_dist_m = np.random.uniform(150.0, 500.0)
            dr_s = int(-round(spot_dist_m * math.cos(w_to_rad) / cellsize))
            dc_s = int(round(spot_dist_m * math.sin(w_to_rad) / cellsize))
            sr, sc = r + dr_s, c + dc_s
            if 0 <= sr < rows and 0 <= sc < cols and not non_burnable[sr, sc]:
                t_spot = t_cur + 10.0 # ignites 10 min later
                if t_spot < arrival[sr, sc]:
                    arrival[sr, sc] = t_spot
                    heapq.heappush(pq, (t_spot, sr, sc))

    arrival[arrival > duration_min] = np.nan
    return arrival

def render_preview(fire, arrival, feats, lines, zoom=2):
    """Render arrival grid in the exact style of the colleague's preview image."""
    h = np.clip(np.nan_to_num(arrival / 60.0, nan=-1), -1, 48)
    vis = np.zeros(h.shape + (3,), np.uint8) + 26
    b = h >= 0
    # Colleague color ramp: golden yellow early -> purple/magenta night -> dark red
    r_col = np.clip(255 - h[b] * 7, 60, 255)
    g_col = np.clip(210 - h[b] * 9, 20, 210)
    b_col = np.clip(40 + h[b] * 4, 30, 160)
    vis[b] = np.stack([r_col, g_col, b_col], -1).astype(np.uint8)
    
    # PT-FireSprd observed perimeter (Blue line)
    obs = np.isfinite(common.observed_arrival(fire))
    edge = obs & ~(np.roll(obs, 1, 0) & np.roll(obs, -1, 0) & np.roll(obs, 1, 1) & np.roll(obs, -1, 1))
    vis[edge] = (60, 160, 255)
    
    img = Image.fromarray(vis).resize((fire.cols * zoom, fire.rows * zoom), Image.NEAREST)
    d = ImageDraw.Draw(img, "RGBA")
    top = fire.grid["ymin"] + fire.rows * fire.cellsize

    def px(lon, lat):
        x, y = fire.point(lon, lat)
        return ((x - fire.grid["xmin"]) / fire.cellsize * zoom, (top - y) / fire.cellsize * zoom)

    for f in feats:
        k = f["properties"]["kind"]
        if k in ("scar", "perimeter"):
            g = shape(f["geometry"])
            for poly in getattr(g, "geoms", [g]):
                pts = [px(*c) for c in poly.exterior.coords]
                if k == "scar":
                    d.polygon(pts, fill=(160, 20, 20, 160), outline=(220, 40, 40, 255))
                else:
                    # Cyan = official perimeter
                    d.line(pts + [pts[0]], fill=(0, 240, 255, 230), width=1)
                    
    for b in lines:
        pts = [px(*q) for q in b["path"]]
        d.line(pts, fill=(255, 255, 255, 240), width=2)
        
    return img

def main():
    print("Loading data for Vieira do Minho 2016...")
    fire, ev, feats, legend, w_era5, w_cerra, m_cerra, elev, slope, aspect, fuel_idx, cover, wrf, lines = load_all_data()
    
    sb_codes = np.array([l["scottBurgan"] for l in legend], dtype=np.int16)[fuel_idx]
    pt_codes = fuels.codes(legend, shrub="V-MAa")[fuel_idx]
    alert_offset = common.alert_offset_min(fire, ev)
    
    # -------------------------------------------------------------------------
    # 1. COLLEAGUE'S ORIGINAL 3 PANELS (ERA5, Flat Wind, Static Moisture)
    # -------------------------------------------------------------------------
    print("\n[1/6] Running Colleague Panel 1 (Baseline: S&B fuels, ERA5 flat, static 6% moisture)...")
    arr_c1 = simulate_propagation(fire, slope, aspect, sb_codes, wrf, w_era5, None,
                                  use_topowind=False, use_dynamic_moisture=False,
                                  use_scars=False, use_spotting=False, barriers=[],
                                  feats=feats)
    st_c1 = common.score(fire, arr_c1, feats, alert_offset)
    
    print("[2/6] Running Colleague Panel 2 (PT fuels + drought + scars + spotting, free)...")
    arr_c2 = simulate_propagation(fire, slope, aspect, pt_codes, wrf, w_era5, None,
                                  use_topowind=False, use_dynamic_moisture=False,
                                  use_scars=True, use_spotting=True, barriers=[],
                                  feats=feats)
    st_c2 = common.score(fire, arr_c2, feats, alert_offset)
    
    print("[3/6] Running Colleague Panel 3 (Scenario B: + Inferred attack lines)...")
    arr_c3 = simulate_propagation(fire, slope, aspect, pt_codes, wrf, w_era5, None,
                                  use_topowind=False, use_dynamic_moisture=False,
                                  use_scars=True, use_spotting=True, barriers=lines,
                                  feats=feats)
    st_c3 = common.score(fire, arr_c3, feats, alert_offset)

    # -------------------------------------------------------------------------
    # 2. REPLICATING 3 TESTS UNDER OUR NEW CONDITIONS (CERRA + TopoWind + Simard)
    # -------------------------------------------------------------------------
    print("\n[4/6] Running NEW Panel 1 (S&B + CERRA 5.5km + 30m TopoWind + Dynamic Simard Moisture)...")
    arr_n1 = simulate_propagation(fire, slope, aspect, sb_codes, wrf, w_cerra, m_cerra,
                                  use_topowind=True, use_dynamic_moisture=True,
                                  use_scars=False, use_spotting=False, barriers=[],
                                  feats=feats)
    st_n1 = common.score(fire, arr_n1, feats, alert_offset)
    
    print("[5/6] Running NEW Panel 2 (PT fuels + scars + spotting + CERRA + TopoWind + Simard, free)...")
    arr_n2 = simulate_propagation(fire, slope, aspect, pt_codes, wrf, w_cerra, m_cerra,
                                  use_topowind=True, use_dynamic_moisture=True,
                                  use_scars=True, use_spotting=True, barriers=[],
                                  feats=feats)
    st_n2 = common.score(fire, arr_n2, feats, alert_offset)
    
    print("[6/6] Running NEW Panel 3 (Scenario B + Attack Lines + CERRA + TopoWind + Simard)...")
    arr_n3 = simulate_propagation(fire, slope, aspect, pt_codes, wrf, w_cerra, m_cerra,
                                  use_topowind=True, use_dynamic_moisture=True,
                                  use_scars=True, use_spotting=True, barriers=lines,
                                  feats=feats)
    st_n3 = common.score(fire, arr_n3, feats, alert_offset)
    
    # -------------------------------------------------------------------------
    # COMPOSE SIDE-BY-SIDE VISUALIZATION IMAGE
    # -------------------------------------------------------------------------
    print("\nRendering high-resolution comparison visualization...")
    img_c1 = render_preview(fire, arr_c1, feats, [])
    img_c2 = render_preview(fire, arr_c2, feats, [])
    img_c3 = render_preview(fire, arr_c3, feats, lines)
    
    img_n1 = render_preview(fire, arr_n1, feats, [])
    img_n2 = render_preview(fire, arr_n2, feats, [])
    img_n3 = render_preview(fire, arr_n3, feats, lines)
    
    w_p, h_p = img_c1.size
    banner_h = 70
    canvas = Image.new("RGB", (w_p * 3, (h_p + banner_h) * 2), (20, 20, 22))
    draw = ImageDraw.Draw(canvas)
    
    def get_ha(st, h_target):
        for x in st["by_hour"]:
            if abs(x["h"] - h_target) < 0.1:
                return x["run_ha"]
        return -1
        
    panels = [
        # Row 1: Colleague Panels
        (0, 0, img_c1, "ORIGINAL Panel 1: Atalaia baseline (S&B fuels, ERA5, 6% fixed)",
         f"15:00: {get_ha(st_c1, 5.0)} ha (obs 720) | 08:30: {get_ha(st_c1, 22.5)} ha (obs 1673) | Sorensen: {st_c1.get('sorensen_official'):.2f}"),
        (1, 0, img_c2, "ORIGINAL Panel 2: PT fuels + drought + spotting, free (ERA5)",
         f"15:00: {get_ha(st_c2, 5.0)} ha (obs 720) | 08:30: {get_ha(st_c2, 22.5)} ha (obs 1673) | Sorensen: {st_c2.get('sorensen_official'):.2f}"),
        (2, 0, img_c3, "ORIGINAL Panel 3: Scenario B + inferred attack lines (ERA5)",
         f"15:00: {get_ha(st_c3, 5.0)} ha (obs 720) | 08:30: {get_ha(st_c3, 22.5)} ha (obs 1673) | Sorensen: {st_c3.get('sorensen_official'):.2f}"),
        # Row 2: Our New Conditions
        (0, 1, img_n1, "NEW Panel 1: S&B + CERRA 5.5km + TopoWind 30m + Simard Dynamic",
         f"15:00: {get_ha(st_n1, 5.0)} ha (obs 720) | 08:30: {get_ha(st_n1, 22.5)} ha (obs 1673) | Sorensen: {st_n1.get('sorensen_official'):.2f}"),
        (1, 1, img_n2, "NEW Panel 2: PT fuels + spotting + CERRA + TopoWind + Simard (free)",
         f"15:00: {get_ha(st_n2, 5.0)} ha (obs 720) | 08:30: {get_ha(st_n2, 22.5)} ha (obs 1673) | Sorensen: {st_n2.get('sorensen_official'):.2f}"),
        (2, 1, img_n3, "NEW Panel 3: Scenario B + Attack lines + CERRA + TopoWind + Simard",
         f"15:00: {get_ha(st_n3, 5.0)} ha (obs 720) | 08:30: {get_ha(st_n3, 22.5)} ha (obs 1673) | Sorensen: {st_n3.get('sorensen_official'):.2f}"),
    ]
    
    for col, row, p_img, title, subtitle in panels:
        x0 = col * w_p
        y0 = row * (h_p + banner_h)
        # Draw header banner
        draw.rectangle([x0, y0, x0 + w_p, y0 + banner_h], fill=(30, 30, 35))
        # Color bar indicator
        color_bar = (255, 120, 40) if row == 1 else (100, 150, 220)
        draw.rectangle([x0, y0, x0 + 6, y0 + banner_h], fill=color_bar)
        draw.text((x0 + 15, y0 + 12), title, fill=(255, 255, 255))
        draw.text((x0 + 15, y0 + 38), subtitle, fill=(200, 210, 220))
        # Paste preview image
        canvas.paste(p_img, (x0, y0 + banner_h))
        
    out_img_path = Path("hindcast/fires") / FIRE_ID / "hindcast_cerra_vs_original_comparison.png"
    canvas.save(out_img_path)
    print(f"Saved 6-panel comparison image to: {out_img_path}")
    
    # -------------------------------------------------------------------------
    # PRINT TABULAR BENCHMARK RESULTS
    # -------------------------------------------------------------------------
    print("\n" + "="*95)
    print(f"{'EXPERIMENT CONFIGURATION':<52} | {'15:00 (5h)':<11} | {'08:30 (22.5h)':<13} | {'Sørensen Ofic':<13}")
    print("="*95)
    print(f"{'REALIDADE OBSERVADA (PT-FireSprd / ICNF)':<52} | {'720 ha':<11} | {'1673 ha':<13} | {'1.00 (perímetro)'}")
    print("-"*95)
    print(f"{'1. Colegas Painel 1 (ERA5 baseline S&B, fixed 6%)':<52} | {get_ha(st_c1, 5.0):<4} ha     | {get_ha(st_c1, 22.5):<5} ha      | {st_c1.get('sorensen_official'):.2f}")
    print(f"{'   -> NOVO Painel 1 (+ CERRA 5.5km + TopoWind + Simard)':<52} | {get_ha(st_n1, 5.0):<4} ha     | {get_ha(st_n1, 22.5):<5} ha      | {st_n1.get('sorensen_official'):.2f}")
    print("-"*95)
    print(f"{'2. Colegas Painel 2 (PT fuels + seca + spotting, free)':<52} | {get_ha(st_c2, 5.0):<4} ha     | {get_ha(st_c2, 22.5):<5} ha      | {st_c2.get('sorensen_official'):.2f}")
    print(f"{'   -> NOVO Painel 2 (+ CERRA 5.5km + TopoWind + Simard)':<52} | {get_ha(st_n2, 5.0):<4} ha     | {get_ha(st_n2, 22.5):<5} ha      | {st_n2.get('sorensen_official'):.2f}")
    print("-"*95)
    print(f"{'3. Colegas Painel 3 (Cenário B + Linhas de combate)':<52} | {get_ha(st_c3, 5.0):<4} ha     | {get_ha(st_c3, 22.5):<5} ha      | {st_c3.get('sorensen_official'):.2f}")
    print(f"{'   -> NOVO Painel 3 (+ CERRA 5.5km + TopoWind + Simard)':<52} | {get_ha(st_n3, 5.0):<4} ha     | {get_ha(st_n3, 22.5):<5} ha      | {st_n3.get('sorensen_official'):.2f}")
    print("="*95)
    
    # Save benchmark json
    summary_json = {
        "fire": FIRE_ID,
        "colleague_original": {
            "panel1": {"ha_15h": get_ha(st_c1, 5.0), "ha_22h": get_ha(st_c1, 22.5), "sorensen": st_c1.get("sorensen_official")},
            "panel2": {"ha_15h": get_ha(st_c2, 5.0), "ha_22h": get_ha(st_c2, 22.5), "sorensen": st_c2.get("sorensen_official")},
            "panel3": {"ha_15h": get_ha(st_c3, 5.0), "ha_22h": get_ha(st_c3, 22.5), "sorensen": st_c3.get("sorensen_official")},
        },
        "new_conditions_cerra": {
            "panel1": {"ha_15h": get_ha(st_n1, 5.0), "ha_22h": get_ha(st_n1, 22.5), "sorensen": st_n1.get("sorensen_official")},
            "panel2": {"ha_15h": get_ha(st_n2, 5.0), "ha_22h": get_ha(st_n2, 22.5), "sorensen": st_n2.get("sorensen_official")},
            "panel3": {"ha_15h": get_ha(st_n3, 5.0), "ha_22h": get_ha(st_n3, 22.5), "sorensen": st_n3.get("sorensen_official")},
        }
    }
    json_path = Path("hindcast/fires") / FIRE_ID / "replicated_benchmark_summary.json"
    json_path.write_text(json.dumps(summary_json, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Summary data saved to: {json_path}")

if __name__ == "__main__":
    main()
