"""Estimate what each fire station can send: people, vehicles by type, DECIR teams.

    scripts/.venv/bin/python -I scripts/build_inventory.py

Reads web/public/stations.json (from build_stations.py) and writes web/public/inventory.json:
one entry per station, keyed by its id, so the A/B decisions can mobilise real means.

No public dataset lists the vehicles of each corpo de bombeiros, so the numbers here are an
assumption and are labelled as such, value by value:

- municipality: the CAOP polygon (Carta Administrativa Oficial de Portugal, DGT, CC BY 4.0,
  data/caop/ from fetch_caop.py) that contains the station's position. The station's names
  (place, section, name) are matched to a municipality too, as a cross-check only: every
  disagreement is printed and geography wins, since many corps are named after a parish (Aguda,
  Avintes and Valadares are all Vila Nova de Gaia) or a demonym, and would otherwise be left out.
- people: INE indicator 0013371 "Bombeiros (N.º)", the yearly survey of the entities that
  run fire corps, by municipality (dados.gov.pt "bombeiros-n-o-2", CC BY 4.0). The latest
  year is downloaded once to data/ine-bombeiros/ and kept. A municipality's firefighters are
  split evenly between all of its stations. A station whose municipality has no INE count keeps
  personnel.total = null and is listed at the end, instead of guessing.
- tier from personnel.total (small, medium, large; municipal for sapadores and bombeiros
  municipais), and from the tier a starting point for vehicles, people on duty and DECIR teams.
- scripts/data/inventory-overrides.json replaces any of that per station, with a source URL. An
  override may list the station's vehicles with their litres instead of counting units: the 21
  stations of the Braga district come from Table 41 of Matos (2025), a UMinho PhD thesis (hdl
  1822/97938, CC BY-NC-SA 4.0), and their unit counts follow from the litres (KIND_BY_LITRES).

The GeoPackage is downloaded data: SQLite opens it read-only and immutable, in defensive mode with
trusted_schema off, and only the name and geometry columns of the municipality layer are read.
"""

import datetime as dt
import json
import re
import sqlite3
import unicodedata
import urllib.request
from pathlib import Path

import shapely
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
STATIONS = ROOT / "web/public/stations.json"
OVERRIDES = ROOT / "scripts/data/inventory-overrides.json"
OUT = ROOT / "web/public/inventory.json"

# CAOP, the official administrative map (fetch_caop.py): the mainland municipalities, in PT-TM06.
CAOP_EDITION = "CAOP2025"
CAOP = ROOT / "data/caop/Continente_CAOP2025.gpkg"
CAOP_TABLE = "cont_municipios"
CAOP_DATASET = "https://dados.gov.pt/pt/datasets/carta-administrativa-oficial-de-portugal-caop2025-continente"
CAOP_EPSG = 3763

# INE serves the dataset as JSON (dados.gov.pt lists no CSV); without a period it answers
# with the latest year only, which is the one wanted.
INE_INDICATOR = "0013371"
INE_URL = f"https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd={INE_INDICATOR}&lang=PT"
INE_DATASET = "https://dados.gov.pt/en/datasets/bombeiros-n-o-2"
RAW = ROOT / f"data/ine-bombeiros/bombeiros-{INE_INDICATOR}.json"
MUNICIPALITY_GEOCOD = 7  # geocod length: 7 digits is a municipality, shorter is NUTS or the country

# Assumed starting point per tier. Tiers by personnel.total; sapadores and municipais are
# "municipal" whatever their size. Unknown size counts as small.
TIERS = {
    "small": {"max": 60, "onDuty": 6, "units": {"vfci": 2, "vttu": 1, "vlci": 1, "vrci": 1}, "ecin": 1},
    "medium": {"max": 120, "onDuty": 10, "units": {"vfci": 3, "vttu": 2, "vlci": 2, "vrci": 1}, "ecin": 2},
    "large": {"max": None, "onDuty": 16, "units": {"vfci": 5, "vttu": 2, "vlci": 3, "vrci": 2}, "ecin": 3},
    "municipal": {"max": None, "onDuty": 24, "units": {"vfci": 6, "vttu": 3, "vlci": 4, "vrci": 2}, "ecin": 3},
}
MUNICIPAL_KINDS = {"professional", "municipal"}  # build_stations.py: sapadores, municipais
EIP = 1  # one Equipa de Intervenção Permanente everywhere

UNITS = {
    "vfci": "Veículo Florestal de Combate a Incêndios",
    "vttu": "Veículo Tanque Tático Urbano",
    "vlci": "Veículo Ligeiro de Combate a Incêndios",
    "vrci": "Veículo Rural de Combate a Incêndios",
    "ecin": "Equipa de Combate a Incêndios (DECIR)",
    "eip": "Equipa de Intervenção Permanente",
}
NOTE = "Estimativa Atalaia: viaturas por tier assumidas; efetivos INE por concelho (concelho de cada quartel pela CAOP) divididos pelos quartéis do concelho"

# The kind of a listed vehicle by its tank, first bound that holds it: the thesis gives litres only.
# Despacho 21638/2009 (ANEPC) asks at least 500 L of a VLCI and 3000 L of a VFCI, yet Table 41 has
# 300–400 L and 1500–2500 L vehicles, so these are classes by size, not the registered types.
KIND_BY_LITRES = ((1000, "vlci"), (6000, "vfci"), (None, "vttu"))
VEHICLES = {
    "reference": "Matos, M. A. (2025). Minimizing the Impact of Forest Fires. PhD thesis, Universidade do Minho. Table 41",
    "url": "https://hdl.handle.net/1822/97938",
    "licence": "CC BY-NC-SA 4.0",
    "kinds": "até 1000 L vlci, até 6000 L vfci, acima vttu (inferido da capacidade)",
}

LINKING = {"de", "da", "do", "dos", "das", "e"}

# Corps named after a demonym or a short form rather than their town, by the word that says so
# ("Tirsenses (Amarelos)" → tirsenses). Only for the name cross-check: the CAOP places the station.
ALIASES = {
    "cabeceirenses": "Cabeceiras de Basto",
    "celoricenses": "Celorico de Basto",
    "espinhenses": "Espinho",
    "famalicenses": "Vila Nova de Famalicão",
    "flavienses": "Chaves",
    "portuenses": "Porto",
    "tirsenses": "Santo Tirso",
    "gaia": "Vila Nova de Gaia",
}


def fold(text: str) -> str:
    """Lower case without accents, so "Monçao" and "Monção" compare equal."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower()


def words(text: str) -> tuple:
    """Folded words without the linking de/da/do, split on anything that is not a letter or digit:
    "Moreira-Maia" → (moreira, maia); OSM's "Terras do Bouro" and INE's "Terras de Bouro" come out equal."""
    return tuple(w for w in re.split(r"[^a-z0-9]+", fold(text)) if w and w not in LINKING)


def fetch_ine():
    """Download the latest INE year once; later runs read the saved file."""
    if RAW.exists():
        return
    RAW.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(INE_URL, headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        RAW.write_bytes(response.read())
    print(f"downloaded INE {INE_INDICATOR} → {RAW.relative_to(ROOT)}  {RAW.stat().st_size / 1024:.0f} KB")


def load_ine():
    """{municipality name: firefighters, or None where INE has no value} for the latest year,
    plus the year and the INE update date."""
    indicator = json.loads(RAW.read_text(encoding="utf-8-sig"))[0]
    year = max(indicator["Dados"], key=int)
    counts = {}
    for row in indicator["Dados"][year]:
        if len(row["geocod"]) == MUNICIPALITY_GEOCOD:
            value = row.get("valor", "")
            counts[row["geodsg"]] = int(value) if value.isdigit() else None
    return counts, int(year), indicator["DataUltimoAtualizacao"]


def open_gpkg():
    if not CAOP.exists():
        raise SystemExit(f"{CAOP.relative_to(ROOT)} not found: run scripts/fetch_caop.py")
    db = sqlite3.connect(f"file:{CAOP}?mode=ro&immutable=1", uri=True)
    db.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
    db.execute("PRAGMA trusted_schema = OFF")
    srs = db.execute("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name = ?", (CAOP_TABLE,)).fetchone()
    if srs != (CAOP_EPSG,):
        raise SystemExit(f"{CAOP.name}: expected EPSG:{CAOP_EPSG}, got {srs}")
    return db


def gpkg_geometry(blob: bytes):
    """A GeoPackage geometry blob: an 8-byte header, an optional envelope, then standard WKB."""
    if not isinstance(blob, bytes) or blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    envelope = (blob[3] >> 1) & 0b111
    if envelope > 4:
        raise ValueError(f"bad envelope code {envelope}")
    return shapely.from_wkb(blob[8 + (0, 32, 48, 48, 64)[envelope]:])


def load_caop():
    """The mainland municipalities as parallel lists: CAOP names and their polygons."""
    db = open_gpkg()
    rows = db.execute(f'SELECT municipio, geom FROM "{CAOP_TABLE}"').fetchall()
    db.close()
    names, shapes = [], []
    for name, geom in rows:
        if not (isinstance(name, str) and 0 < len(name) <= 60):
            raise SystemExit(f"bad CAOP row {name!r}")
        names.append(name)
        shapes.append(gpkg_geometry(geom))
    if len(names) != len(set(names)):
        raise SystemExit(f"{CAOP.name}: municipality names repeat")
    return names, shapes


def locate(stations, names, shapes):
    """{station id: CAOP municipality} by position, and {station id: metres} for the stations
    on no polygon at all (a quay past the coastline, say), which take the nearest one."""
    to_tm06 = Transformer.from_crs("EPSG:4326", f"EPSG:{CAOP_EPSG}", always_xy=True)
    tree = shapely.STRtree(shapes)
    found, outside = {}, {}
    for s in stations:
        point = shapely.Point(to_tm06.transform(s["lon"], s["lat"]))
        hits = tree.query(point, predicate="intersects")  # a station right on a shared edge takes either side
        if len(hits) == 0:
            hits = [tree.nearest(point)]
            outside[s["id"]] = shapes[hits[0]].distance(point)
        found[s["id"]] = names[hits[0]]
    return found, outside


def match_by_name(station, municipalities):
    """The municipality a station's names alone point to, or None: the cross-check of the CAOP.

    In order: place, section or an alias equal to a municipality name; then the longest
    municipality name that appears whole in the station name ("... de Salvação Pública de
    Chaves" → Chaves, "Paredes de Coura" before "Paredes").
    """
    by_words = {words(name): name for name in municipalities}
    for field in (station["place"], station["section"]):
        if field and words(field) in by_words:
            return by_words[words(field)]
        if field and (alias := next((ALIASES[w] for w in words(field) if w in ALIASES), None)):
            return alias
    name = words(station["name"] or "")
    hits = [
        (len(key), key)
        for key in by_words
        if any(name[i : i + len(key)] == key for i in range(len(name) - len(key) + 1))
    ]
    return by_words[max(hits)[1]] if hits else None


def load_overrides():
    """Validated manual entries by station id; keys starting with "_" are notes."""
    data = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    overrides = {}
    for station_id, entry in data.items():
        if station_id.startswith("_"):
            continue
        if not isinstance(entry.get("source"), str) or not entry["source"].startswith("http"):
            raise ValueError(f"override {station_id}: 'source' must be a URL")
        if unknown := set(entry) - {"source", "personnel", "units", "decir", "vehicles"}:
            raise ValueError(f"override {station_id}: unknown keys {sorted(unknown)}")
        if "vehicles" in entry:
            vehicles = entry["vehicles"]
            if not isinstance(vehicles, dict) or not all(type(litres) is int and litres > 0 for litres in vehicles.values()):
                raise ValueError(f"override {station_id}: 'vehicles' must map each vehicle to its litres")
            if "units" in entry:
                raise ValueError(f"override {station_id}: give 'units' or 'vehicles', not both")
        overrides[station_id] = entry
    return overrides


def tier_for(total, kind):
    if kind in MUNICIPAL_KINDS:
        return "municipal"
    if total is None:
        return "small"
    for name in ("small", "medium", "large"):
        if TIERS[name]["max"] is None or total <= TIERS[name]["max"]:
            return name


def kind_for(litres):
    return next(kind for top, kind in KIND_BY_LITRES if top is None or litres <= top)


def entry(station, municipality, total, year, override):
    """One inventory entry: INE share → tier → tier defaults, then the override on top. Listed
    vehicles replace the tier's units with their own count by kind (none of them is a vrci)."""
    manual = override or {}
    personnel = {"total": total, **manual.get("personnel", {})}
    tier = tier_for(personnel["total"], station["kind"])
    personnel.setdefault("onDuty", TIERS[tier]["onDuty"])
    units = {**TIERS[tier]["units"], **manual.get("units", {})}
    listed = {}
    if "vehicles" in manual:
        by_size = sorted(manual["vehicles"].items(), key=lambda item: (item[1], len(item[0]), item[0]))
        listed["vehicles"] = [{"id": v, "capacityL": litres, "kind": kind_for(litres)} for v, litres in by_size]
        units = {unit: sum(1 for v in listed["vehicles"] if v["kind"] == unit) for unit in units}
    return {
        "tier": tier,
        "source": f"manual:{manual['source']}" if override else f"estimate:ine-{year}+tier",
        "municipality": municipality,
        "personnel": personnel,
        "units": units,
        "decir": {"ecin": TIERS[tier]["ecin"], "eip": EIP, **manual.get("decir", {})},
        **listed,
    }


def build():
    fetch_ine()
    counts, year, updated = load_ine()
    stations = json.loads(STATIONS.read_text(encoding="utf-8"))["stations"]
    overrides = load_overrides()
    names, shapes = load_caop()

    # The CAOP and the INE spell the mainland municipalities alike; compared folded in case an
    # edition drifts. A CAOP name the INE lacks keeps the CAOP spelling and gets no count.
    ine_names = {words(name): name for name in counts}

    def ine_spelling(caop_name):
        return ine_names.get(words(caop_name), caop_name)

    by_geography, outside = locate(stations, names, shapes)
    municipality, by_name = {}, {}
    for s in stations:
        municipality[s["id"]] = ine_spelling(by_geography[s["id"]])
        named = match_by_name(s, names)  # among the mainland names only: the INE list has the islands too
        by_name[s["id"]] = ine_spelling(named) if named else None

    per_municipality = {}
    for m in municipality.values():
        per_municipality[m] = per_municipality.get(m, 0) + 1

    inventory = {}
    for s in stations:
        m = municipality[s["id"]]
        total = int(counts[m] / per_municipality[m] + 0.5) if counts.get(m) is not None else None  # even split, half up
        inventory[s["id"]] = entry(s, m, total, year, overrides.get(s["id"]))

    meta = {
        "generated": dt.date.today().isoformat(),
        "note": NOTE,
        "caop": {
            "edition": CAOP_EDITION,
            "dataset": CAOP_DATASET,
            "licence": "CC BY 4.0",
            "layer": CAOP_TABLE,
            "located": len(stations) - len(outside),
            "nearest": len(outside),
        },
        "ine": {
            "indicator": INE_INDICATOR,
            "dataset": INE_DATASET,
            "licence": "CC BY 4.0",
            "year": year,
            "updated": updated,
            "matched": sum(1 for m in municipality.values() if counts.get(m) is not None),
            "unmatched": sum(1 for m in municipality.values() if counts.get(m) is None),
        },
        "tiers": {
            name: {"maxPersonnel": t["max"], "onDuty": t["onDuty"], "units": t["units"], "decir": {"ecin": t["ecin"], "eip": EIP}}
            for name, t in TIERS.items()
        },
        "units": UNITS,
        "vehicles": {**VEHICLES, "stations": sum(1 for e in inventory.values() if "vehicles" in e)},
    }
    OUT.write_text(json.dumps({"_meta": meta, **inventory}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    report(stations, inventory, counts, per_municipality, by_name, outside, overrides, year)


def report(stations, inventory, counts, per_municipality, by_name, outside, overrides, year):
    by_id = {s["id"]: s for s in stations}
    unmatched = [s for s in stations if counts.get(inventory[s["id"]]["municipality"]) is None]
    disagree = [s for s in stations if by_name[s["id"]] and by_name[s["id"]] != inventory[s["id"]]["municipality"]]
    nameless = sum(1 for s in stations if not by_name[s["id"]])
    tiers = {}
    for e in inventory.values():
        tiers[e["tier"]] = tiers.get(e["tier"], 0) + 1

    print(f"{len(stations)} stations in {len(per_municipality)} {CAOP_EDITION} municipalities; INE {year}: {len(stations) - len(unmatched)} with a count")
    print(f"  tiers: {tiers}; overrides: {len(overrides)}" + (f" ({', '.join(overrides)})" if overrides else ""))
    print(f"  name match: agrees with the CAOP for {len(stations) - len(disagree) - nameless}, finds nothing for {nameless}, disagrees for {len(disagree)} (CAOP wins):")
    for s in disagree:
        print(f"    {s['id']:<18} {s['name']}: by name {by_name[s['id']]}, by position {inventory[s['id']]['municipality']}")
    shared = sorted((n, m) for m, n in per_municipality.items() if n > 1)
    print(f"  municipalities split between stations ({len(shared)}): " + ", ".join(f"{m} ×{n} ({counts[m]})" for n, m in reversed(shared)))
    zero = sorted(m for m in per_municipality if counts.get(m) == 0)
    if zero:
        print(f"  INE reports no firefighters in: {', '.join(zero)}")
    missing = [i for i in overrides if i not in by_id]
    if missing:
        print(f"  overrides for ids not in stations.json: {missing}")
    if outside:
        print(f"  outside every CAOP polygon, nearest municipality taken ({len(outside)}):")
        for station_id, metres in outside.items():
            print(f"    {station_id:<18} {by_id[station_id]['name']}: {inventory[station_id]['municipality']}, {metres:.0f} m away")
    print(f"  no INE count for the municipality, personnel.total null ({len(unmatched)}):")
    for s in unmatched:
        print(f"    {s['id']:<18} {s['name']}  ({inventory[s['id']]['municipality']})")
    print(f"→ {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    build()
