"""The official records of a fire in the package (web/public/fires/<id>/), for the hindcast: the ICNF incident
record, the mapped burn perimeters (this fire's and those of the fires put out nearby shortly before it), satellite
hotspots, and what the press reported at the time.

    hindcast/.venv/bin/python -I hindcast/evidence.py VieiradoMinho_10082016

Sources (downloaded once into data/hindcast/evidence/, not versioned):
  * ICNF SGIF, the national rural fire database, through ICNF's public web service
    (https://fogos.icnf.pt/localizador/webserviceocorrencias.asp?ANO=..&MES=..): per fire the alert, first intervention
    and extinction times, burned area by land cover, cause, fire weather indices at the fire, and the Farsite fuel
    model at the ignition. Each record links the burn perimeter mapped afterwards by the GNR and/or the municipal
    forestry office (GTF), as KML. The fire is found by fire.json incidentId (the ANEPC number, NCCO in SGIF).
  * NASA FIRMS active fire detections, VIIRS S-NPP 375 m and MODIS 1 km, yearly country files (no login).
  * Press reports, curated by hand below (NEWS) with their URLs.

Writes hindcast/fires/<id>/:
  evidence.json     the incident record, the news, the earlier fires ("scars") and the satellite passes
  evidence.geojson  lon/lat features: kind = perimeter (this fire, official), scar (an earlier fire), hotspot
  evidence.png      a map on the package grid: observed times, official perimeter (cyan), scars (red), hotspots
                    (green before the alert, cyan the first 6 h, magenta to 20 h, white later)

A scar is a fire within the package grid (+1.5 km) put out in the --days-before days before this one's alert: its fuel
was gone, so run.py --scars makes it non-burnable.
"""

import argparse
import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import numpy as np
import requests
import shapely
from PIL import Image, ImageDraw
from pyproj import Geod
from shapely.geometry import Polygon, mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, fire_dir, fires, observed_arrival  # noqa: E402

SGIF = "https://fogos.icnf.pt/localizador/webserviceocorrencias.asp"
FIRMS = "https://firms.modaps.eosdis.nasa.gov/data/country/{p}/{y}/{p}_{y}_Portugal.csv"
FIRMS_PRODUCTS = {"viirs-snpp": 375.0, "modis": 1000.0}  # nominal pixel size, m
UA = {"User-Agent": "atalaia-hindcast/0.1 (Hack4Guimaraes)"}
LOCAL = dt.timezone(dt.timedelta(hours=1))  # SGIF and the press give local summer time (WEST)

# Press reports at the time, for the fires we reconstruct. Each item: when it was said (local time), what, source.
NEWS = {
    "2016030060428": [
        {"time": "2016-08-10T22:17", "kind": "evacuation",
         "fact": "Two hamlets of Sobradelo da Goma parish (Póvoa de Lanhoso), Carreiras and Cabanelas, evacuated "
                 "'as a precaution' as the fire that started at 09:46 in Rossas approached; residents rehoused with "
                 "family and in a municipal building. Not in OpenStreetMap, so located only by parish.",
         "parish": "Sobradelo da Goma",
         "source": "RTP live blog, 10 Aug 2016, 22:17; Lusa via JN, 11 Aug 2016",
         "url": "https://www.rtp.pt/noticias/pais/incendios-acompanhe-a-situacao-minuto-a-minuto_e939680"},
        {"time": "2016-08-11T09:00", "kind": "front",
         "fact": "By the morning of 11 Aug the flames had consumed an abandoned house on the hill at Agrela (Fafe), "
                 "at the fire's western end (time approximate: 'de manhã').",
         "place": {"name": "Agrela (Fafe)", "lon": -8.2079624, "lat": 41.5428879},
         "source": "Operational commander Vítor Azevedo to Lusa, in JN, 11 Aug 2016",
         "url": "https://www.jn.pt/pais/artigo/fogo-de-vieira-do-minho-em-resolucao-apos-32-horas-de-combate/5334298"},
        {"time": "2016-08-11T09:00", "kind": "weather",
         "fact": "Strong wind with gusts of up to 80 km/h was the main difficulty for the firefighters.",
         "source": "Operational commander Vítor Azevedo to Lusa, in JN, 11 Aug 2016",
         "url": "https://www.jn.pt/pais/artigo/fogo-de-vieira-do-minho-em-resolucao-apos-32-horas-de-combate/5334298"},
        {"time": "2016-08-11T20:11", "kind": "resolution",
         "fact": "The fire, which had spread into Fafe and Póvoa de Lanhoso, entered 'resolution' (no longer "
                 "spreading) after 32 hours of firefighting, per the national civil protection authority (ANPC); "
                 "the evacuated residents had returned home.",
         "source": "JN, 11 Aug 2016, 20:11",
         "url": "https://www.jn.pt/pais/artigo/fogo-de-vieira-do-minho-em-resolucao-apos-32-horas-de-combate/5334298"},
        {"time": "2016-08-17T00:00", "kind": "area",
         "fact": "ICNF provisional report RIF05/2016 (17 Aug 2016) lists Vieira do Minho / Rossas, 10-08-2016: "
                 "1,000 ha of forest stands and 1,500 ha of shrubland, 2,500 ha (provisional; the final SGIF record "
                 "is 1,839 ha).",
         "source": "ICNF, 5.º Relatório Provisório de Incêndios Florestais 2016, RIF05/2016",
         "url": "https://www.icnf.pt/api/file/doc/077273386c350b52"},
    ],
}


def sgif_month(year: int, month: int, cache: Path) -> list[dict]:
    """Every SGIF record of a month (cached), as dicts of the web service's fields."""
    f = cache / f"sgif_{year}_{month:02d}.xml"
    if not f.exists():
        print(f"SGIF {year}-{month:02d} ...")
        r = requests.get(SGIF, params={"ANO": year, "MES": month}, headers=UA, timeout=300)
        r.raise_for_status()
        f.write_bytes(r.content)
    root = ET.parse(f).getroot()
    out = []
    for node in root:
        d = {"id": node.attrib.get("id")}
        d.update({c.tag: (c.text or "").strip() for c in node})
        out.append(d)
    return out


def sgif_time(d: dict, date_key: str, hour_key: str) -> dt.datetime | None:
    s, h = d.get(date_key, ""), d.get(hour_key, "")
    for fmt in ("%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M"):
        try:
            return dt.datetime.strptime(f"{s} {h}", fmt).replace(tzinfo=LOCAL)
        except ValueError:
            pass
    return None


def file_urls(d: dict) -> list[tuple[str, str]]:
    """(kind, https url) of the perimeter files a record links: gnr (GNR) or gtf (municipal forestry office)."""
    out = []
    for k, v in d.items():
        if not k.startswith("AREASFICHEIRO") or not v:
            continue
        for u in re.split(r"\s+(?=https?://)", v.strip()):
            u = u.strip().replace("http://", "https://")
            if not u.lower().endswith((".kml", ".kmz")):
                continue
            base, name = u.rsplit("/", 1)
            out.append(("gtf" if "GTF" in k else "gnr", base + "/" + urllib.parse.quote(urllib.parse.unquote(name))))
    return out


def kml_polygons(blob: bytes) -> shapely.Geometry | None:
    if blob[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(blob))
        blob = z.read(next(n for n in z.namelist() if n.lower().endswith(".kml")))
    txt = blob.decode("utf-8", "replace")
    polys = []
    for pm in re.findall(r"<Polygon>.*?</Polygon>", txt, flags=re.S):
        rings = [[tuple(map(float, p.split(",")[:2])) for p in r.split()]
                 for r in re.findall(r"<coordinates>(.*?)</coordinates>", pm, flags=re.S)]
        if len(rings[0]) >= 4:
            polys.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]).buffer(0))
    return shapely.unary_union(polys) if polys else None


def perimeter(d: dict, cache: Path) -> tuple[shapely.Geometry | None, str]:
    """The record's burn perimeter: the GNR file, else a GTF file whose area matches the record (GTF files sometimes
    hold a whole batch of fires)."""
    geod = Geod(ellps="WGS84")
    reported = float(d.get("AREATOTAL") or 0)
    best = (None, "")
    for kind, url in sorted(file_urls(d), key=lambda ku: ku[0] != "gnr"):
        f = cache / "kml" / f"{d['NCCO']}_{kind}{Path(urllib.parse.unquote(url)).suffix.lower()}"
        if not f.exists():
            try:
                r = requests.get(url, headers=UA, timeout=60)
                r.raise_for_status()
            except requests.RequestException as e:
                print(f"  {d['NCCO']}: {url}: {e}")
                continue
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(r.content)
        try:
            g = kml_polygons(f.read_bytes())
        except Exception as e:  # malformed files exist
            print(f"  {d['NCCO']}: {f.name}: {e}")
            continue
        if g is None:
            continue
        ha = abs(geod.geometry_area_perimeter(g)[0]) / 1e4
        if reported <= 0 or 0.5 <= ha / reported <= 2.0:
            return g, f"{kind}: {url}"
        best = best if best[0] is not None else (None, f"{kind} file {ha:.0f} ha against {reported:g} ha reported")
    return best


def firms(year: int, cache: Path) -> list[dict]:
    rows = []
    for prod, size in FIRMS_PRODUCTS.items():
        f = cache / f"firms_{prod}_{year}_Portugal.csv"
        if not f.exists():
            print(f"FIRMS {prod} {year} ...")
            r = requests.get(FIRMS.format(p=prod, y=year), headers=UA, timeout=300)
            r.raise_for_status()
            f.write_bytes(r.content)
        for d in csv.DictReader(f.open()):
            d["product"], d["pixel_m"] = prod, size
            rows.append(d)
    return rows


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire", help="the fire's id in web/public/fires/index.json")
    p.add_argument("--days-before", type=int, default=40, help="how far back earlier fires count as scars")
    args = p.parse_args(argv)
    cache = CACHE / "evidence"
    cache.mkdir(parents=True, exist_ok=True)

    fire = fires.Fire(args.fire)
    ncco = fire.meta.get("incidentId")
    if not ncco:
        raise SystemExit(f"{args.fire}: fire.json has no incidentId")
    g = fire.grid
    x0, y0 = g["xmin"], g["ymin"]
    x1, y1 = x0 + g["cols"] * g["cellsize"], y0 + g["rows"] * g["cellsize"]

    def inside(lon, lat, margin=0.0):
        x, y = fire.point(lon, lat)
        return x0 - margin <= x <= x1 + margin and y0 - margin <= y <= y1 + margin

    t0 = fires.parse_time(fire.steps[0]["time"]).replace(tzinfo=LOCAL)
    first = t0 - dt.timedelta(days=args.days_before)
    months = sorted({(first.year, first.month), (t0.year, t0.month)})
    recs = [d for y, m in months for d in sgif_month(y, m, cache)]
    me = next((d for d in recs if d.get("NCCO") == ncco), None)
    if me is None:
        raise SystemExit(f"SGIF has no record with NCCO {ncco} in {months}")
    alert = sgif_time(me, "DATAALERTA", "HORAALERTA")
    first_att = sgif_time(me, "DATA1INTERVENCAO", "HORA1INTERVENCAO")
    out_t = sgif_time(me, "DATAEXTINCAO", "HORAEXTINCAO")
    print(f"SGIF {me['id']} / {ncco}: {me['FREGUESIA']} ({me['CONCELHO']}), alerta {alert}, 1.ª intervenção "
          f"{first_att}, extinto {out_t}, {me['AREATOTAL']} ha")
    feats = []
    geod = Geod(ellps="WGS84")
    geom, src = perimeter(me, cache)
    if geom is not None:
        ha = abs(geod.geometry_area_perimeter(geom)[0]) / 1e4
        feats.append({"type": "Feature", "geometry": mapping(geom),
                      "properties": {"kind": "perimeter", "ncco": ncco, "area_ha": round(ha, 1), "source": src}})
        print(f"  perímetro oficial {ha:.0f} ha ({src})")

    scars = []
    for d in recs:
        try:
            lon, lat = float(d["LON"]), float(d["LAT"])
        except (KeyError, ValueError):
            continue
        a, e = sgif_time(d, "DATAALERTA", "HORAALERTA"), sgif_time(d, "DATAEXTINCAO", "HORAEXTINCAO")
        if d.get("NCCO") == ncco or a is None or e is None or not (first <= a and e <= alert):
            continue
        if not inside(lon, lat, margin=1500) or float(d.get("AREATOTAL") or 0) < 1.0:
            continue
        sg, ssrc = perimeter(d, cache)
        if sg is None:
            continue
        ha = abs(geod.geometry_area_perimeter(sg)[0]) / 1e4
        props = {"kind": "scar", "ncco": d["NCCO"], "parish": d["FREGUESIA"], "municipality": d["CONCELHO"],
                 "alert": a.isoformat(), "extinguished": e.isoformat(), "area_ha": round(ha, 1),
                 "reported_ha": float(d["AREATOTAL"]), "cause": d.get("TIPOCAUSA", ""), "source": ssrc}
        feats.append({"type": "Feature", "geometry": mapping(sg), "properties": props})
        scars.append(props)
    scars.sort(key=lambda s: s["alert"])
    print(f"  {len(scars)} cicatrizes: " + ", ".join(f"{s['parish']} {s['alert'][5:10]} {s['area_ha']:.0f} ha"
                                                    for s in scars if s["area_ha"] >= 10))

    lo, hi = alert - dt.timedelta(days=2), (out_t or alert) + dt.timedelta(hours=6)
    passes = {}
    fire_shape = shapely.buffer(geom, 0.004) if geom is not None else None  # ~350 m
    scar_shape = shapely.unary_union([shape(f["geometry"]) for f in feats if f["properties"]["kind"] == "scar"]) \
        if scars else None
    for d in firms(alert.year, cache):
        lon, lat = float(d["longitude"]), float(d["latitude"])
        if not inside(lon, lat):
            continue
        t = dt.datetime.strptime(d["acq_date"] + d["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=dt.timezone.utc)
        if not lo <= t <= hi:
            continue
        pt = shapely.Point(lon, lat)
        h = (t - alert).total_seconds() / 3600
        props = {"kind": "hotspot", "product": d["product"], "satellite": d["satellite"], "pixel_m": d["pixel_m"],
                 "time_utc": t.isoformat(), "hours_after_alert": round(h, 2), "frp_mw": float(d["frp"]),
                 "confidence": d["confidence"], "daynight": d["daynight"],
                 "near_fire": bool(fire_shape is not None and fire_shape.contains(pt)),
                 "in_scar": bool(scar_shape is not None and scar_shape.buffer(0.004).contains(pt)),
                 "this_fire": bool(h > 0 and fire_shape is not None and fire_shape.contains(pt))}
        feats.append({"type": "Feature", "geometry": mapping(pt), "properties": props})
        s = passes.setdefault((props["time_utc"][:16], d["product"]), {
            "time_utc": t.isoformat(), "time_local": t.astimezone(LOCAL).strftime("%d %b %H:%M"),
            "hours_after_alert": round(h, 2), "product": d["product"], "satellite": d["satellite"], "n": 0,
            "this_fire": 0, "near_fire_before_alert": 0})
        s["n"] += 1
        s["this_fire"] += props["this_fire"]
        s["near_fire_before_alert"] += bool(h < 0 and props["near_fire"] and not props["in_scar"])
    passes = sorted(passes.values(), key=lambda s: s["time_utc"])
    for s in passes:
        if s["this_fire"] or s["near_fire_before_alert"]:
            what = f"{s['this_fire']} neste incêndio" if s["this_fire"] else \
                f"{s['near_fire_before_alert']} dentro do perímetro oficial ANTES do alerta"
            print(f"  {s['time_local']} {s['product']:10s} {what} ({s['hours_after_alert']:+.1f} h)")

    fwi = {k.lower(): round(float(me[k]), 1) for k in ("FFMC", "DMC", "DC", "ISI", "BUI", "FWI", "DSR") if me.get(k)}
    incident = {
        "sgif_id": me["id"], "ncco": ncco, "municipality": me["CONCELHO"], "parish": me["FREGUESIA"],
        "place": me["LOCAL"], "lon": float(me["LON"]), "lat": float(me["LAT"]),
        "alert": alert.isoformat(), "alert_source": me.get("FONTEALERTA", ""),
        "first_intervention": first_att.isoformat() if first_att else None,
        "extinguished": out_t.isoformat() if out_t else None,
        "duration_h": round((out_t - alert).total_seconds() / 3600, 1) if out_t else None,
        "area_ha": {"stands": float(me["AREAPOV"]), "shrub": float(me["AREAMATO"]), "farmland": float(me["AREAAGRIC"]),
                    "total": float(me["AREATOTAL"])},
        "cause": me.get("TIPOCAUSA", ""),
        "weather_at_fire": {"temp_c": round(float(me["TEMPERATURA"]), 1), "rh_pct": round(float(me["HUMIDADERELATIVA"]), 0),
                            "wind_kmh": round(float(me["VENTOINTENSIDADE"]), 1),
                            "wind_from_deg": float(me["VENTODIRECAO_VETOR"]), **fwi},
        "fuel_model_at_ignition": me.get("MODFARSITE", ""),
        "source": f"ICNF SGIF ({SGIF}?ANO={alert.year}&MES={alert.month})",
    }
    doc = {"fire": args.fire, "incident": incident, "news": NEWS.get(ncco, []), "scars": scars, "satellite_passes": passes,
           "sources": {
               "sgif": "ICNF, Sistema de Gestão de Informação de Incêndios Florestais (SGIF), public web service",
               "perimeters": "GNR / GTF burn perimeters linked from the SGIF records (KML)",
               "firms": "NASA FIRMS, VIIRS S-NPP 375 m (VNP14IMGTDL) and MODIS C6.1 1 km active fire detections; "
                        "https://firms.modaps.eosdis.nasa.gov",
           }}
    out = fire_dir(args.fire)
    (out / "evidence.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False))
    (out / "evidence.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    draw_map(out / "evidence.png", fire, feats)
    print(f"-> {out}/evidence.json, evidence.geojson, evidence.png")


def draw_map(path: Path, fire, feats: list, zoom: int = 2):
    h = observed_arrival(fire) / 60
    vis = np.zeros(h.shape + (3,), np.uint8) + 25
    b = np.isfinite(h)
    vis[b] = np.stack([255 - h[b] * 8, 200 - h[b] * 8, 40 + h[b] * 4], -1).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(vis).resize((fire.cols * zoom, fire.rows * zoom), Image.NEAREST)
    d = ImageDraw.Draw(img, "RGBA")
    top = fire.grid["ymin"] + fire.rows * fire.cellsize

    def px(lon, lat):
        x, y = fire.point(lon, lat)
        return ((x - fire.grid["xmin"]) / fire.cellsize * zoom, (top - y) / fire.cellsize * zoom)

    def rings(geom):
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        return [[px(*c) for c in poly[0]] for poly in polys]

    for f in feats:
        k = f["properties"]["kind"]
        if k == "scar":
            for r in rings(f["geometry"]):
                d.polygon(r, fill=(255, 0, 0, 80), outline=(255, 60, 60, 255))
        elif k == "perimeter":
            for r in rings(f["geometry"]):
                d.line(r + [r[0]], fill=(0, 255, 255, 255), width=2)
    for f in feats:
        p = f["properties"]
        if p["kind"] != "hotspot":
            continue
        x, y = px(*f["geometry"]["coordinates"])
        rad = p["pixel_m"] / 2 / fire.cellsize * zoom
        hh = p["hours_after_alert"]
        col = (0, 255, 0) if hh < 0 else (0, 255, 255) if hh < 6 else (255, 0, 255) if hh < 20 else (255, 255, 255)
        d.ellipse([x - rad, y - rad, x + rad, y + rad], outline=col)
    img.save(path)


if __name__ == "__main__":
    main()
