"""Clean the OpenStreetMap fire stations into the list the app shows.

    scripts/.venv/bin/python scripts/build_stations.py

Reads data/osm-fire-stations/raw.json (from fetch_stations.py) and writes
web/public/stations.json: one entry per station (a corporação, or a secção of one)
with its name, a short label for the map, its kind and its position.

OSM maps some stations twice (a node and the building, or two spellings of the name),
has unnamed buildings next to named ones, and tags as fire_station things that are not
stations: Red Cross posts, a training centre, the airport crash service. Those go.
"""

import json
import re
import unicodedata
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/osm-fire-stations/raw.json"
OUT = ROOT / "web/public/stations.json"
FIRES = ROOT / "web/public/fires/index.json"

SAME_STATION_KM = 2.0  # same kind and place name this close: one station mapped twice
NEARBY_KM = 0.5  # a station with no place name this close to a named one is that one

NOT_STATIONS = re.compile(
    r"cruz vermelha|protec?[cç][aã]o civil|centro de forma[cç][aã]o|\bcma\b|aeroporto|destacamento|^antigos",
    re.IGNORECASE,
)

# Words that open a station's name before the place: "Associação Humanitária dos
# Bombeiros Voluntários de", "Batalhão de Sapadores Bombeiros de", ... (compared folded).
LEADING = {
    "associacao", "humanitaria", "quartel", "corpo", "batalhao", "regimento", "bombeiros",
    "voluntarios", "volutarios", "municipais", "sapadores", "privativos",
    "de", "da", "do", "dos", "das",
}

# kind, label prefix, pattern; the first match wins, anything else is volunteer.
KINDS = [
    ("professional", "BS", re.compile(r"sapadores", re.IGNORECASE)),  # Bombeiros Sapadores, full-time
    ("municipal", "BM", re.compile(r"municipais", re.IGNORECASE)),
    ("private", "BP", re.compile(r"privativos", re.IGNORECASE)),  # company brigades
]
VOLUNTEER = ("volunteer", "BV")  # Bombeiros Voluntários, most stations in Portugal


def fold(text: str) -> str:
    """Lower case without accents, so "Monçao" and "Monção" compare equal."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower()


def km(a, b):
    """Great-circle distance between two {lat, lon}."""
    dlat, dlon = radians(b["lat"] - a["lat"]), radians(b["lon"] - a["lon"])
    h = sin(dlat / 2) ** 2 + cos(radians(a["lat"])) * cos(radians(b["lat"])) * sin(dlon / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def place_and_section(name: str):
    """'... Bombeiros Voluntários de Vieira do Minho - Secção de Ruivães' → ('Vieira do Minho', 'Ruivães')."""
    base, _, rest = name.partition(" - ")
    section = None
    if m := re.match(r"sec[cç][aã]o (?:de |da |do )?(.+)", rest, re.IGNORECASE):
        section = m.group(1).strip()
    elif rest and not re.match(r"quartel operacional", rest, re.IGNORECASE):
        base = f"{base} - {rest}"  # part of the name, as in "Areosa - Rio Tinto"
    words = base.split()
    while words and fold(words[0]) in LEADING:
        words.pop(0)
    return " ".join(words) or None, section


def candidate(element):
    tags = element.get("tags", {})
    position = element.get("center") or element
    name = tags.get("name")
    place, section = place_and_section(name) if name else (None, None)
    place = place or tags.get("addr:city")  # a bare "Bombeiros Voluntários" may still have an address
    kind, prefix = next(((k, p) for k, p, pattern in KINDS if name and pattern.search(name)), VOLUNTEER)
    short = " ".join(filter(None, [prefix, place])) + (f" ({section})" if section else "")
    return {
        "id": f"{element['type']}/{element['id']}",
        "name": name,
        "short": short,
        "kind": kind,
        "place": place,
        "section": section,
        "lat": round(position["lat"], 5),
        "lon": round(position["lon"], 5),
        # Which of two copies to keep: the building over a node, then the better tagged one.
        "_rank": (element["type"] != "node", "official_name" in tags, len(tags)),
        # Kind too: Porto and Viana have volunteers and a professional/municipal corps in town.
        "_key": (kind, fold(place), fold(section or "")) if place else None,
    }


def build():
    raw = json.loads(RAW.read_text())
    candidates = [candidate(e) for e in raw["elements"]]

    dropped = [c for c in candidates if c["name"] and NOT_STATIONS.search(c["name"])]
    candidates = [c for c in candidates if c not in dropped]
    # Named ones first, so a nameless copy finds the station it belongs to.
    candidates.sort(key=lambda c: (c["_key"] is not None, c["_rank"]), reverse=True)

    kept, merged, unnamed = [], [], []
    for c in candidates:
        if c["_key"] is not None:
            twin = next((k for k in kept if k["_key"] == c["_key"] and km(k, c) < SAME_STATION_KM), None)
        else:
            twin = next((k for k in kept if km(k, c) < NEARBY_KM), None)
        if twin:
            merged.append((c, twin))
        elif c["name"] is None:
            unnamed.append(c)  # no name and nothing nearby: cannot tell what it is
        else:
            kept.append(c)

    stations = sorted(({k: v for k, v in s.items() if not k.startswith("_")} for s in kept), key=lambda s: fold(s["short"]))
    OUT.write_text(
        json.dumps(
            {
                "source": {
                    "data": "© contribuidores do OpenStreetMap",
                    "licence": "ODbL 1.0",
                    "query": "amenity=fire_station in Portugal within 100 km of Monte da Penha",
                    "osmDate": raw["osm3s"]["timestamp_osm_base"],
                },
                "stations": stations,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n"
    )
    report(len(raw["elements"]), dropped, merged, unnamed, stations)


def report(total, dropped, merged, unnamed, stations):
    print(f"{total} OSM elements → {len(stations)} stations")
    print(f"  not stations ({len(dropped)}): " + "; ".join(c["name"] for c in dropped))
    print(f"  unnamed, nothing nearby ({len(unnamed)}): " + ", ".join(c["id"] for c in unnamed))
    print(f"  duplicates merged ({len(merged)}):")
    for c, twin in merged:
        print(f"    {c['name'] or c['id']}  →  {twin['short']} ({twin['id']}, {km(c, twin):.2f} km)")
    kinds = {}
    for s in stations:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    print(f"  kinds: {kinds}")
    print(f"  no place name: {[s['id'] for s in stations if not s['place']]}")
    if FIRES.exists():
        for fire in json.loads(FIRES.read_text()):
            near = sorted((km(fire, s), s["short"]) for s in stations)
            print(f"  nearest to {fire['name']}: " + ", ".join(f"{name} {d:.1f} km" for d, name in near[:3] if d <= 20))
    print(f"→ {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    build()
