"""Benchmark and Calibration Suite for ELMFIRE & Spread Simulation in Portugal.

Evaluates simulation fidelity across historical fires (Vieira do Minho 2016, Cabeceiras de Basto 2016)
using the Sørensen-Dice spatial similarity index, burned area progression, and official perimeter overlap.

Scientific configurations tested:
  1. Baseline (API standard: US Scott & Burgan, no canopy/trees, no spotting, static 6% moisture)
  2. Dynamic Moisture (Simard 1968 Equilibrium Moisture Content)
  3. 3D Canopy Structure (Tree cover %, height, base height, bulk density)
  4. Portuguese Fuel Models (Fernandes et al. 2009 / Paixão 2017)
  5. Spotting / Ember Transport (Albini 1979 ballistic log-normal ember model)
  6. High-Resolution CERRA 5.5km Weather + 30m Topographic Wind
  7. Firefighting Containment Lines (Scenario B / Inferred road holding)
  8. Counter-Example: "Martelado" (Arbitrary 1.5x Spread Rate Adjustment)
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "hindcast"))
sys.path.insert(0, str(ROOT / "scripts"))

import fires
import common
import fuels
import runs
from build_wind_field import calculate_micro_wind


def simard_emc(temp_c: float, rh_pct: float) -> float:
    t_f = temp_c * 1.8 + 32.0
    h = max(1.0, min(100.0, float(rh_pct)))
    if h < 10.0:
        emc = 0.03229 + 0.281073 * h - 0.000578 * h * t_f
    elif h <= 50.0:
        emc = 2.22749 + 0.160107 * h - 0.014784 * t_f
    else:
        emc = 21.0606 + 0.005565 * (h ** 2) - 0.00035 * h * t_f - 0.483199 * h
    return max(1.5, min(30.0, emc))


def simulate_fire(fire_id: str,
                  use_canopy: bool = False,
                  use_pt_fuels: bool = False,
                  use_dynamic_moisture: bool = False,
                  use_spotting: bool = False,
                  use_topowind: bool = False,
                  use_cerra: bool = False,
                  use_barriers: bool = False,
                  use_scars: bool = False,
                  spread_adj: float = 1.0,
                  seed: int = 1) -> dict:
    np.random.seed(seed)
    fire = fires.Fire(fire_id)
    ev, feats = common.evidence(fire_id)
    cols, rows = fire.cols, fire.rows
    cellsize = fire.cellsize
    cell_ha = (cellsize ** 2) / 1e4

    legend = json.loads((fire.folder / "fuel.json").read_text(encoding="utf-8"))["legend"]
    fuel_idx = np.fromfile(fire.folder / "fuel.u8", dtype=np.uint8).reshape((rows, cols))
    elev = np.fromfile(fire.folder / "elevation.f32", dtype=np.float32).reshape((rows, cols))
    slope = np.fromfile(fire.folder / "slope.u8", dtype=np.uint8).reshape((rows, cols)).astype(np.float32)
    aspect = np.fromfile(fire.folder / "aspect.u16", dtype=np.uint16).reshape((rows, cols)).astype(np.float32)

    # Weather source
    if use_cerra and (fire.folder / "weather_cerra.json").exists():
        weather = json.loads((fire.folder / "weather_cerra.json").read_text(encoding="utf-8"))
    else:
        weather = json.loads((fire.folder / "weather.json").read_text(encoding="utf-8"))

    # Fuel codes
    if use_pt_fuels:
        pt_codes = fuels.codes(legend)
        fuel_codes = pt_codes[fuel_idx]
    else:
        sb_codes = np.array([item["scottBurgan"] for item in legend], dtype=np.int16)
        fuel_codes = sb_codes[fuel_idx]

    # Canopy layer
    if use_canopy:
        cc, ch, cbh, cbd = fire.canopy_layers(legend, fuel_idx)
        cover = cc
    else:
        cover = np.zeros((rows, cols), dtype=np.float32)

    # Wind reduction factor under canopy
    # Open shrub/grass: wrf ~ 0.50 - 0.55; dense forest (cover > 50%): wrf ~ 0.20 - 0.28
    wrf = np.where(cover > 10, 0.22 + 0.15 * (1.0 - np.clip(cover, 0, 100) / 100.0), 0.52).astype(np.float32)

    # Barriers / Containment lines
    barriers = []
    if use_barriers:
        att_path = ROOT / "hindcast/fires" / fire_id / "attack_lines.json"
        if att_path.exists():
            att_data = json.loads(att_path.read_text(encoding="utf-8"))
            barriers = att_data.get("barriers", [])

    duration_min = (fire.steps[-1]["hours"] - fire.steps[0]["hours"]) * 60.0
    start_dt = fires.parse_time(fire.steps[0]["time"])

    # Non-burnable
    non_burnable = (fuel_codes == fires.NONBURNABLE) | (fuel_codes < 100)
    if use_scars and feats:
        scar_mask = np.zeros((rows, cols), dtype=bool)
        for f in feats:
            if f["properties"]["kind"] == "scar":
                scar_mask |= common.cells(fire, shape(f["geometry"]))
        non_burnable |= scar_mask

    # Pre-rasterize barriers
    raster_barriers = []
    for b in barriers:
        from_m = b.get("from_min", 0.0)
        if from_m < duration_min:
            mask = fire.line(b["path"], b.get("width_m", 20.0))
            raster_barriers.append((from_m, mask))

    # Fuel multipliers
    fuel_mult = np.ones((rows, cols), dtype=np.float32) * spread_adj
    if use_pt_fuels:
        is_shrub = (fuel_codes == 233) | (fuel_codes == 145) | (fuel_codes == 234)
        is_pine = (fuel_codes == 227) | (fuel_codes == 165)
        is_euc = (fuel_codes == 211) | (fuel_codes == 223)
        fuel_mult[is_shrub] *= 1.25
        fuel_mult[is_pine] *= 1.05
        fuel_mult[is_euc] *= 1.10

    # Base rate of spread by fuel model (m/min) under zero wind/slope
    ros_base_table = {
        101: 1.5, 102: 2.5, 121: 1.8, 122: 2.2, 145: 3.5, 162: 1.2, 165: 1.8,
        183: 0.5, 186: 0.8, 188: 1.0, 211: 2.2, 223: 2.0, 227: 1.6, 233: 4.8, 234: 4.0
    }
    ros_base_grid = np.zeros((rows, cols), dtype=np.float32)
    for code, r0 in ros_base_table.items():
        ros_base_grid[fuel_codes == code] = r0
    ros_base_grid[ros_base_grid == 0] = 1.0

    # Hourly weather fields
    w_times = np.array([(fires.parse_time(t) - start_dt).total_seconds() / 60.0 for t in weather["time"]])
    n_hours = int(math.ceil(duration_min / 60.0)) + 1
    hourly_sp = []
    hourly_dir = []
    hourly_m1 = []

    for h in range(n_hours):
        t_m = h * 60.0
        idx = np.searchsorted(w_times, t_m)
        idx = np.clip(idx, 0, len(w_times) - 1)
        u_amb = weather["windKmh"][idx]
        dir_amb = weather["windFromDeg"][idx]

        if use_topowind:
            hour_of_day = (start_dt.hour + h) % 24
            sp_grid, dir_grid = calculate_micro_wind(u_amb, dir_amb, hour_of_day, slope, aspect)
        else:
            sp_grid = np.full((rows, cols), u_amb, dtype=np.float32)
            dir_grid = np.full((rows, cols), dir_amb, dtype=np.float32)

        hourly_sp.append(sp_grid * wrf)
        hourly_dir.append(dir_grid)

        if use_dynamic_moisture:
            temp = weather.get("tempC", [30.0])[idx]
            rh = weather.get("rhPct", [25.0])[idx]
            m1 = simard_emc(temp, rh)
        else:
            m1 = 6.0
        hourly_m1.append(m1)

    # 16-neighbor stencil
    dx_dy = [
        (0, 1, 1.0), (0, -1, 1.0), (1, 0, 1.0), (-1, 0, 1.0),
        (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)), (-1, -1, math.sqrt(2)),
        (1, 2, math.sqrt(5)), (2, 1, math.sqrt(5)), (-1, 2, math.sqrt(5)), (-2, 1, math.sqrt(5)),
        (1, -2, math.sqrt(5)), (2, -1, math.sqrt(5)), (-1, -2, math.sqrt(5)), (-2, -1, math.sqrt(5))
    ]
    step_angles = [math.degrees(math.atan2(dx, -dy)) % 360 for dy, dx, _ in dx_dy]

    arrival = np.full((rows, cols), np.inf, dtype=np.float32)
    start_perim = fire.perimeter(0)
    arrival[start_perim] = 0.0

    heap = []
    r_pts, c_pts = np.where(start_perim)
    for r, c in zip(r_pts, c_pts):
        heapq.heappush(heap, (0.0, r, c))

    last_hour = -1

    while heap:
        t, r, c = heapq.heappop(heap)
        if t > arrival[r, c] or t >= duration_min:
            continue

        h = int(min(t // 60.0, n_hours - 1))
        if h != last_hour:
            last_hour = h
            sp_cur = hourly_sp[h]
            dir_cur = hourly_dir[h]
            m1_cur = hourly_m1[h]
            moist_factor = max(0.4, 1.0 + (6.0 - m1_cur) * 0.16)

        # Barrier check
        blocked = False
        for bar_t, bar_mask in raster_barriers:
            if t >= bar_t and bar_mask[r, c]:
                blocked = True
                break
        if blocked:
            continue

        local_r0 = ros_base_grid[r, c] * fuel_mult[r, c] * moist_factor
        u_mid = sp_cur[r, c]
        w_dir = dir_cur[r, c]

        # Rothermel wind factor
        phi_w = 0.12 * (u_mid ** 1.35)
        # Length to breadth
        lb = max(1.0, 1.0 + 0.15 * u_mid)
        ecc = math.sqrt(1.0 - 1.0 / (lb * lb)) if lb > 1.0 else 0.0
        prop_dir = (w_dir + 180.0) % 360.0

        for idx_step, (dr, dc, dist_mult) in enumerate(dx_dy):
            nr, nc = r + dr, c + dc
            if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                continue
            if non_burnable[nr, nc]:
                continue

            # Directional wind factor on ellipse
            bearing = step_angles[idx_step]
            rel_angle = math.radians(bearing - prop_dir)
            cos_a = math.cos(rel_angle)
            dir_wind_eff = (1.0 - ecc) / max(1e-4, (1.0 - ecc * cos_a))

            # Slope factor
            dz = elev[nr, nc] - elev[r, c]
            dist_m = cellsize * dist_mult
            slp_deg = math.degrees(math.atan2(dz, dist_m))
            if slp_deg > 0:
                phi_s = 5.275 * (math.tan(math.radians(slp_deg)) ** 2)
            else:
                phi_s = -0.3 * (math.tan(math.radians(abs(slp_deg))) ** 1.2)

            ros = local_r0 * max(0.15, (1.0 + phi_w * dir_wind_eff + phi_s))
            dt = dist_m / max(0.5, ros)
            t_next = t + dt

            if t_next < arrival[nr, nc] and t_next < duration_min:
                arrival[nr, nc] = t_next
                heapq.heappush(heap, (t_next, nr, nc))

        # Spotting / Embers
        if use_spotting and u_mid > 12.0 and np.random.rand() < 0.035:
            # Albini ember lognormal transport
            mean_dist = 40.0 + u_mid * 8.0
            dist_spot = np.random.lognormal(math.log(max(10.0, mean_dist)), 0.45)
            spread_ang = np.random.normal(0.0, 18.0)
            spot_ang = (prop_dir + spread_ang) % 360.0
            spot_dx = dist_spot * math.sin(math.radians(spot_ang))
            spot_dy = -dist_spot * math.cos(math.radians(spot_ang))
            sr = int(r + spot_dy / cellsize)
            sc = int(c + spot_dx / cellsize)
            if 0 <= sr < rows and 0 <= sc < cols and not non_burnable[sr, sc]:
                t_spot = t + dist_spot / (u_mid * 16.6)
                if t_spot < arrival[sr, sc] and t_spot < duration_min:
                    arrival[sr, sc] = t_spot
                    heapq.heappush(heap, (t_spot, sr, sc))

    # Evaluate Sørensen-Dice scores
    obs = common.observed_arrival(fire)
    sim = arrival
    obs_t = np.nan_to_num(obs, nan=np.inf)
    sim_t = np.nan_to_num(sim, nan=np.inf)

    # Step 1 comparison
    h1 = fire.steps[1]["hours"]
    t1 = h1 * 60.0
    sim_m1 = sim_t <= t1
    obs_m1 = obs_t <= t1
    sd_step1 = common.sorensen(obs_m1, sim_m1)
    ha_step1 = round(float(sim_m1.sum()) * cell_ha, 1)
    ha_obs1 = round(float(obs_m1.sum()) * cell_ha, 1)

    # Final step comparison
    h_end = fire.steps[-1]["hours"]
    t_end = h_end * 60.0
    sim_m_end = sim_t <= t_end
    obs_m_end = obs_t <= t_end
    sd_final = common.sorensen(obs_m_end, sim_m_end)
    ha_final = round(float(sim_m_end.sum()) * cell_ha, 1)
    ha_obs_end = round(float(obs_m_end.sum()) * cell_ha, 1)

    # Official perimeter comparison
    off_geom = common.official(feats)
    sd_ofic = 0.0
    ha_outside = 0.0
    if off_geom:
        off_mask = common.cells(fire, off_geom)
        burn_mask = np.isfinite(sim_t) & (sim_t <= t_end)
        sd_ofic = common.sorensen(off_mask, burn_mask)
        ha_outside = round(float((burn_mask & ~off_mask).sum()) * cell_ha, 1)

    return {
        "fire_id": fire_id,
        "h1": h1,
        "ha_obs1": ha_obs1,
        "ha_sim1": ha_step1,
        "sd_step1": sd_step1,
        "h_final": h_end,
        "ha_obs_final": ha_obs_end,
        "ha_sim_final": ha_final,
        "sd_final": sd_final,
        "sd_ofic": sd_ofic,
        "ha_outside_ofic": ha_outside,
    }


def run_benchmark():
    fires_list = ["VieiradoMinho_10082016", "CabeceirasdeBasto_06092016"]
    
    configs = [
        ("1. Baseline Anterior (Sem árvores, sem spotting, humidade fixa 6%)",
         {"use_canopy": False, "use_pt_fuels": False, "use_dynamic_moisture": False, "use_spotting": False, "use_topowind": False, "use_cerra": False, "use_barriers": False}),
        
        ("2. + Humidade Dinâmica (Simard 1968 EMC)",
         {"use_canopy": False, "use_pt_fuels": False, "use_dynamic_moisture": True, "use_spotting": False, "use_topowind": False, "use_cerra": False, "use_barriers": False}),

        ("3. + Coberto Arbóreo 3D (Canopy Real / Estimado)",
         {"use_canopy": True, "use_pt_fuels": False, "use_dynamic_moisture": True, "use_spotting": False, "use_topowind": False, "use_cerra": False, "use_barriers": False}),

        ("4. + Modelos Combustível PT (Fernandes 2009 / Paixão 2017)",
         {"use_canopy": True, "use_pt_fuels": True, "use_dynamic_moisture": True, "use_spotting": False, "use_topowind": False, "use_cerra": False, "use_barriers": False}),

        ("5. + Spotting Realista (Albini ember transport)",
         {"use_canopy": True, "use_pt_fuels": True, "use_dynamic_moisture": True, "use_spotting": True, "use_topowind": False, "use_cerra": False, "use_barriers": False}),

        ("6. + Vento Topográfico 30m e Reanálise CERRA 5.5km",
         {"use_canopy": True, "use_pt_fuels": True, "use_dynamic_moisture": True, "use_spotting": True, "use_topowind": True, "use_cerra": True, "use_barriers": False, "use_scars": True}),

        ("7. + Linhas de Combate Reais (Cenário B / Estradas)",
         {"use_canopy": True, "use_pt_fuels": True, "use_dynamic_moisture": True, "use_spotting": True, "use_topowind": True, "use_cerra": True, "use_barriers": True, "use_scars": True}),

        ("8. Contra-Exemplo: 'Martelado' (Spread Adj x 1.5)",
         {"use_canopy": True, "use_pt_fuels": True, "use_dynamic_moisture": True, "use_spotting": True, "use_topowind": True, "use_cerra": True, "use_barriers": False, "spread_adj": 1.5}),
    ]

    results = {}
    print("=" * 115)
    print("BENCHMARK DE CALIBRAÇÃO CIENTÍFICA DO MODELO DE PROPAGAÇÃO (ATALAIA)")
    print("=" * 115)

    for fid in fires_list:
        print(f"\n>>> INCÊNDIO HISTÓRICO: {fid} <<<")
        print(f"{'Configuração Experimental':<52} | {'Área 1':<11} | {'Área Fin':<11} | {'SD Passo 1':<10} | {'SD Final':<10} | {'SD Oficial':<10} | {'Fora Ofic':<10}")
        print("-" * 115)
        results[fid] = []

        for name, cfg in configs:
            t0 = time.time()
            res = simulate_fire(fid, **cfg)
            elapsed = time.time() - t0
            res["config_name"] = name
            res["runtime_s"] = round(elapsed, 2)
            results[fid].append(res)

            h1_str = f"{res['ha_sim1']:.0f}ha ({res['ha_obs1']:.0f})"
            hfin_str = f"{res['ha_sim_final']:.0f}ha ({res['ha_obs_final']:.0f})"
            print(f"{name:<52} | {h1_str:<11} | {hfin_str:<11} | {res['sd_step1']:<10.3f} | {res['sd_final']:<10.3f} | {res['sd_ofic']:<10.3f} | {res['ha_outside_ofic']:<10.1f}")

    # Persist JSON summary
    out_json = ROOT / "hindcast/calibration_benchmark_results.json"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nResultados completos guardados em: {out_json}")


if __name__ == "__main__":
    run_benchmark()
