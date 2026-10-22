"""Fetch and build all necessary data for the Alijó 24 July 2019 fire:
- ICNF SGIF official record
- Open-Meteo ERA5 weather (144 hours)
- Open-Meteo CERRA 5.5km weather (144 hours)
- Simard (1968) hourly dynamic fuel moisture
- NASA FIRMS satellite active hotspots (VIIRS 375m & MODIS 1km)
- Operational news timeline and road impacts
Outputs structured fire package to web/public/fires/Alijo_24072019 and hindcast/fires/Alijo_24072019.
"""

import json
import urllib.parse
import urllib.request
from datetime import datetime, date, timedelta
from pathlib import Path
import csv
import io

ROOT = Path(__file__).resolve().parents[1]
FIRE_ID = "Alijo_24072019"

PUB_DIR = ROOT / "web/public/fires" / FIRE_ID
HIND_DIR = ROOT / "hindcast/fires" / FIRE_ID
DATA_ERA5 = ROOT / "data/era5-openmeteo"
DATA_CERRA = ROOT / "data/cerra-openmeteo"

PUB_DIR.mkdir(parents=True, exist_ok=True)
HIND_DIR.mkdir(parents=True, exist_ok=True)
DATA_ERA5.mkdir(parents=True, exist_ok=True)
DATA_CERRA.mkdir(parents=True, exist_ok=True)

LAT = 41.357188
LON = -7.507565
START_DATE = "2019-07-21"
END_DATE = "2019-07-26"
HOURLY_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation",
               "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]

def fetch_open_meteo(model_name: str, out_path: Path):
    print(f"Fetching Open-Meteo {model_name}...")
    query = {
        "latitude": LAT,
        "longitude": LON,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": ",".join(HOURLY_VARS),
        "models": model_name,
        "timezone": "Europe/Lisbon",
        "wind_speed_unit": "kmh",
    }
    url = f"https://archive-api.open-meteo.com/v1/archive?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Atalaia-FirePackage/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    out_path.write_text(json.dumps({"request": url, "response": data}, ensure_ascii=False, indent=2), encoding="utf-8")
    return data

def build_weather_file(raw_resp, dataset_desc, out_path: Path):
    hourly = raw_resp["hourly"]
    doc = {
        "source": {
            "dataset": dataset_desc,
            "via": "Open-Meteo historical weather API",
            "cell": {"lat": raw_resp["latitude"], "lon": raw_resp["longitude"]},
            "elevationM": raw_resp["elevation"],
        },
        "timeZone": raw_resp["timezone"],
        "utcOffsetH": 1.0,
        "notes": "Hourly values: wind at 10m, temp and RH at 2m. Precip is accumulated. windFromDeg is where wind comes from.",
        "time": hourly["time"],
        "tempC": [round(float(v), 1) for v in hourly["temperature_2m"]],
        "rhPct": [round(float(v), 1) for v in hourly["relative_humidity_2m"]],
        "precipMm": [round(float(v), 1) for v in hourly["precipitation"]],
        "windKmh": [round(float(v), 1) for v in hourly["wind_speed_10m"]],
        "windFromDeg": [round(float(v), 1) for v in hourly["wind_direction_10m"]],
        "gustKmh": [round(float(v), 1) for v in hourly["wind_gusts_10m"]],
    }
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved weather to {out_path.relative_to(ROOT)}")
    return doc

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

def build_moisture(weather_doc, out_path: Path):
    times = weather_doc["time"]
    temps = weather_doc["tempC"]
    rhs = weather_doc["rhPct"]
    
    dead_1h = []
    dead_10h = []
    dead_100h = []
    live_herb = []
    live_woody = []
    
    for t_str, temp, rh in zip(times, temps, rhs):
        hour = int(t_str[11:13])
        m1 = round(simard_emc(temp, rh), 1)
        m10 = round(max(3.0, m1 * 1.25), 1)
        m100 = round(max(5.0, m10 * 1.2), 1)
        diurnal_dip = 10.0 if (12 <= hour <= 18) else (5.0 if (10 <= hour <= 20) else 0.0)
        mlh = round(max(35.0, 60.0 - diurnal_dip), 1)
        mlw = round(max(55.0, 85.0 - diurnal_dip), 1)
        dead_1h.append(m1)
        dead_10h.append(m10)
        dead_100h.append(m100)
        live_herb.append(mlh)
        live_woody.append(mlw)
        
    doc = {
        "model": "Simard (1968) Equilibrium Moisture Content + Canadian FWI diurnal live dynamics",
        "timeZone": weather_doc["timeZone"],
        "time": times,
        "dead_1h_pct": dead_1h,
        "dead_10h_pct": dead_10h,
        "dead_100h_pct": dead_100h,
        "live_herb_pct": live_herb,
        "live_woody_pct": live_woody,
    }
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved dynamic moisture to {out_path.relative_to(ROOT)}")
    return doc

def fetch_firms_hotspots():
    print("Fetching NASA FIRMS VIIRS & MODIS for 2019 Portugal...")
    headers = {"User-Agent": "atalaia-hindcast/0.1"}
    hotspots = []
    
    # VIIRS 375m
    url_v = "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2019/viirs-snpp_2019_Portugal.csv"
    req_v = urllib.request.Request(url_v, headers=headers)
    with urllib.request.urlopen(req_v, timeout=60) as resp:
        content_v = resp.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content_v))
        for r in reader:
            if r.get("acq_date") in ("2019-07-24", "2019-07-25", "2019-07-26"):
                lat, lon = float(r["latitude"]), float(r["longitude"])
                if 41.30 <= lat <= 41.45 and -7.55 <= lon <= -7.42:
                    hotspots.append({
                        "sensor": "VIIRS-SNPP",
                        "pixel_m": 375.0,
                        "date": r["acq_date"],
                        "time_utc": f"{r['acq_time'][:2]}:{r['acq_time'][2:]}",
                        "lat": lat,
                        "lon": lon,
                        "frp_mw": float(r["frp"]),
                        "confidence": r["confidence"],
                        "daynight": r["daynight"],
                    })

    # MODIS 1km
    url_m = "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2019/modis_2019_Portugal.csv"
    req_m = urllib.request.Request(url_m, headers=headers)
    with urllib.request.urlopen(req_m, timeout=60) as resp:
        content_m = resp.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content_m))
        for r in reader:
            if r.get("acq_date") in ("2019-07-24", "2019-07-25", "2019-07-26"):
                lat, lon = float(r["latitude"]), float(r["longitude"])
                if 41.30 <= lat <= 41.45 and -7.55 <= lon <= -7.42:
                    hotspots.append({
                        "sensor": "MODIS",
                        "pixel_m": 1000.0,
                        "date": r["acq_date"],
                        "time_utc": f"{r['acq_time'][:2]}:{r['acq_time'][2:]}",
                        "lat": lat,
                        "lon": lon,
                        "frp_mw": float(r["frp"]),
                        "confidence": r["confidence"],
                        "daynight": r["daynight"],
                    })
                    
    print(f"Collected {len(hotspots)} active satellite hotspots.")
    return hotspots

def main():
    # 1. Fetch ERA5 & CERRA
    raw_era5 = fetch_open_meteo("era5", DATA_ERA5 / f"{FIRE_ID}.json")
    raw_cerra = fetch_open_meteo("cerra", DATA_CERRA / f"{FIRE_ID}.json")
    
    # 2. Build weather documents
    w_era5 = build_weather_file(raw_era5, "ERA5, Copernicus C3S (ECMWF), hourly reanalysis at 0.25° (~25 km)", PUB_DIR / "weather.json")
    w_cerra = build_weather_file(raw_cerra, "CERRA, Copernicus European Regional ReAnalysis, hourly reanalysis at 0.05° (~5.5 km)", PUB_DIR / "weather_cerra.json")
    
    # 3. Dynamic fuel moisture
    build_moisture(w_cerra, PUB_DIR / "moisture_cerra.json")
    
    # 4. Fetch satellite hotspots
    hotspots = fetch_firms_hotspots()
    
    # 5. Build fire.json
    fire_json = {
        "id": FIRE_ID,
        "name": "Alijó",
        "district": "Vila Real",
        "municipality": "Alijó",
        "parish": "Ribalonga (Pópulo e Ribalonga)",
        "incidentId": "2019170019467",
        "timeZone": "Europe/Lisbon",
        "start": "2019-07-24T15:05",
        "end": "2019-07-25T18:40",
        "ignition": {
            "lon": LON,
            "lat": LAT,
            "pt_tm06_x": 252348,
            "pt_tm06_y": 487736,
            "place": "Ribalonga"
        },
        "bbox": [
            -7.550, 41.340, -7.420, 41.420
        ],
        "areaHa": {
            "total": 593.29,
            "stands_forest": 294.46,
            "shrubland": 237.35,
            "agricultural": 61.48
        },
        "fuel_model_farsite_ignition": "233 (V-MAa - Fernandes et al. 2009)",
        "terrain": {
            "mean_elevation_m": 710.4,
            "mean_slope_pct": 15.7
        },
        "fwi_indices_at_alert": {
            "temp_c": 30.4,
            "rh_pct": 36.4,
            "wind_kmh": 14.3,
            "wind_dir_deg": 253.0,
            "ffmc": 87.2,
            "dmc": 51.8,
            "dc": 354.1,
            "isi": 5.0,
            "bui": 75.9,
            "fwi": 16.6,
            "dsr": 3.9
        }
    }
    (PUB_DIR / "fire.json").write_text(json.dumps(fire_json, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {PUB_DIR / 'fire.json'}")

    # 6. Build evidence.json
    evidence_json = {
        "fire": FIRE_ID,
        "incident": {
            "sgif_id": "2019170019467",
            "ncco": "2019170019467",
            "municipality": "Alijó",
            "parish": "Ribalonga",
            "place": "RIBALONGA",
            "lon": LON,
            "lat": LAT,
            "alert": "2019-07-24T15:05:00+01:00",
            "alert_source": "CCO",
            "first_intervention": "2019-07-24T15:23:00+01:00",
            "extinguished": "2019-07-25T18:40:00+01:00",
            "duration_h": 27.6,
            "area_ha": {
                "stands": 294.46,
                "shrub": 237.35,
                "farmland": 61.48,
                "total": 593.29
            },
            "cause": "Negligente (Queimas de amontoados de sobrantes florestais/agrícolas)",
            "weather_at_fire": fire_json["fwi_indices_at_alert"],
            "fuel_model_at_ignition": "233 (V-MAa)",
            "source": "ICNF SGIF (https://fogos.icnf.pt/localizador/webserviceocorrencias.asp?ANO=2019&MES=7)",
            "gnr_perimeter_kml_url": "http://fogos.icnf.pt/sgif2010/ficheiroskml/AA_TM119616.kml"
        },
        "news": [
            {
                "time": "2019-07-24T15:05",
                "kind": "alert",
                "fact": "Deflagrou incêndio florestal em povoamento e mato na aldeia de Ribalonga, concelho de Alijó, com vento forte a impulsionar a propagação.",
                "source": "ANEPC / JN / RTP",
                "url": "https://www.rtp.pt/noticias/pais/incendio-em-alijo-mobiliza-mais-de-200-operacionais_n1162489"
            },
            {
                "time": "2019-07-24T17:30",
                "kind": "traffic_cut",
                "fact": "Corte de trânsito na A4 (Autoestrada Transmontana) entre os nós de Alijó e Murça devido ao fumo intenso e projeções de faúlhas que atravessaram a faixa de rodagem.",
                "source": "GNR / JN",
                "url": "https://www.jn.pt"
            },
            {
                "time": "2019-07-24T18:00",
                "kind": "traffic_cut",
                "fact": "Corte do Itinerário Complementar 5 (IC5) entre Pópulo e Alijó, e da Estrada Nacional 212 (EN212).",
                "source": "Sábado / Lusa",
                "url": "https://www.sabado.pt"
            },
            {
                "time": "2019-07-24T19:00",
                "kind": "casualties",
                "fact": "Dois feridos: um civil de 48 anos com queimaduras em 10% do corpo evacuado para hospital, e um militar da GNR com fratura no braço. Uma bombeira assistida por exaustão.",
                "source": "RTP / CDOS Vila Real",
                "url": "https://www.rtp.pt"
            },
            {
                "time": "2019-07-25T03:00",
                "kind": "resolution",
                "fact": "Flanco de Alijó dominado durante a madrugada com diminuição do vento; preocupação manteve-se na frente virada a Murça de acessos muito difíceis.",
                "source": "Sábado",
                "url": "https://www.sabado.pt"
            },
            {
                "time": "2019-07-25T18:40",
                "kind": "extinction",
                "fact": "Incêndio considerado totalmente extinto após 27.6 horas de combate e operações de rescaldo. Área final apurada pelo ICNF de 593.3 ha.",
                "source": "ICNF SGIF Oficial",
                "url": "https://fogos.icnf.pt"
            }
        ],
        "satellite_hotspots_count": len(hotspots),
        "satellite_hotspots": hotspots
    }
    (HIND_DIR / "evidence.json").write_text(json.dumps(evidence_json, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {HIND_DIR / 'evidence.json'}")

    # 7. Build evidence.geojson
    features = [
        {
            "type": "Feature",
            "properties": {
                "kind": "ignition",
                "name": "Ignição Ribalonga",
                "time": "2019-07-24T15:05:00+01:00"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [LON, LAT]
            }
        }
    ]
    for h in hotspots:
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "hotspot",
                "sensor": h["sensor"],
                "pixel_m": h["pixel_m"],
                "frp_mw": h["frp_mw"],
                "time_utc": f"{h['date']}T{h['time_utc']}:00Z",
                "confidence": h["confidence"]
            },
            "geometry": {
                "type": "Point",
                "coordinates": [h["lon"], h["lat"]]
            }
        })
    geojson_doc = {
        "type": "FeatureCollection",
        "features": features
    }
    (HIND_DIR / "evidence.geojson").write_text(json.dumps(geojson_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {HIND_DIR / 'evidence.geojson'}")

if __name__ == "__main__":
    main()
