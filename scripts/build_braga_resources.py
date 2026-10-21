"""Build the Braga district firefighting resources inventory from the Universidade do Minho PhD Thesis:
'Minimizing the Impact of Forest Fires' (Marina Araújo de Matos, UMinho, Sept 2025), hdl 1822/97938.

Transcribes the 21 Fire Stations (Bombeiros) and 113 combat vehicles of Braga District (Table 41).
The table is the thesis case study and cites no source of its own, so this is not an official ANEPC list.
It gives only each vehicle's water capacity: the category below is inferred from it.
Outputs web/public/suppression_braga_uminho.json.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "web/public/suppression_braga_uminho.json"

# Category by tank size, inferred: the thesis lists litres only. Despacho 21638/2009 (ANEPC) asks at
# least 500 L of a VLCI and 3000 L of a VFCI, yet the table has 300-400 L and 1500-2500 L vehicles,
# so these are classes by capacity, not the vehicles' registered types.
CATEGORIES = [(1000, "VLCI"), (6000, "VFCI"), (None, "VTTU")]


def category(capacity_l):
    return next(name for top, name in CATEGORIES if top is None or capacity_l <= top)

STATIONS_DATA = [
    {
        "id": "guimaraes",
        "name": "Associação Humanitária dos Bombeiros Voluntários de Guimarães",
        "municipality": "Guimarães",
        "vehicles": [
            {"id": "A", "capacity_l": 400},
            {"id": "B", "capacity_l": 400},
            {"id": "C", "capacity_l": 2000},
            {"id": "D", "capacity_l": 3200},
            {"id": "E", "capacity_l": 3500}
        ]
    },
    {
        "id": "caldas_das_taipas",
        "name": "Associação Humanitária dos Bombeiros Voluntários das Caldas das Taipas",
        "municipality": "Guimarães",
        "vehicles": [
            {"id": "K", "capacity_l": 500},
            {"id": "L", "capacity_l": 500},
            {"id": "M", "capacity_l": 600},
            {"id": "F", "capacity_l": 3500},
            {"id": "G", "capacity_l": 4000},
            {"id": "H", "capacity_l": 4500},
            {"id": "I", "capacity_l": 4500},
            {"id": "J", "capacity_l": 400}
        ]
    },
    {
        "id": "riba_de_ave",
        "name": "Associação Humanitária Bombeiros Voluntários de Riba de Ave",
        "municipality": "Vila Nova de Famalicão",
        "vehicles": [
            {"id": "R", "capacity_l": 400},
            {"id": "S", "capacity_l": 500},
            {"id": "T", "capacity_l": 600},
            {"id": "U", "capacity_l": 2000},
            {"id": "N", "capacity_l": 3000},
            {"id": "O", "capacity_l": 3000},
            {"id": "P", "capacity_l": 3500},
            {"id": "Q", "capacity_l": 4500}
        ]
    },
    {
        "id": "cabeceiras_de_basto",
        "name": "Associação Humanitária de Bombeiros Voluntários Cabeceirenses",
        "municipality": "Cabeceiras de Basto",
        "vehicles": [
            {"id": "V", "capacity_l": 400},
            {"id": "X", "capacity_l": 2500},
            {"id": "W", "capacity_l": 3500}
        ]
    },
    {
        "id": "amares",
        "name": "Associação Humanitária de Bombeiros Voluntários de Amares",
        "municipality": "Amares",
        "vehicles": [
            {"id": "Y", "capacity_l": 400},
            {"id": "Z", "capacity_l": 500},
            {"id": "AA", "capacity_l": 600},
            {"id": "AB", "capacity_l": 2000},
            {"id": "AC", "capacity_l": 4500}
        ]
    },
    {
        "id": "barcelos",
        "name": "Associação Humanitária de Bombeiros Voluntários de Barcelos",
        "municipality": "Barcelos",
        "vehicles": [
            {"id": "AD", "capacity_l": 500},
            {"id": "AE", "capacity_l": 2200},
            {"id": "AG", "capacity_l": 3000},
            {"id": "AH", "capacity_l": 3000},
            {"id": "AF", "capacity_l": 4500}
        ]
    },
    {
        "id": "esposende",
        "name": "Associação Humanitária de Bombeiros Voluntários de Esposende",
        "municipality": "Esposende",
        "vehicles": [
            {"id": "AK", "capacity_l": 500},
            {"id": "AI", "capacity_l": 3000},
            {"id": "AJ", "capacity_l": 3500}
        ]
    },
    {
        "id": "fafe",
        "name": "Associação Humanitária de Bombeiros Voluntários de Fafe",
        "municipality": "Fafe",
        "vehicles": [
            {"id": "AL", "capacity_l": 500},
            {"id": "AM", "capacity_l": 500},
            {"id": "AN", "capacity_l": 500},
            {"id": "AQ", "capacity_l": 2500},
            {"id": "AR", "capacity_l": 2500},
            {"id": "AO", "capacity_l": 3000},
            {"id": "AP", "capacity_l": 3000}
        ]
    },
    {
        "id": "povoa_de_lanhoso",
        "name": "Associação Humanitária de Bombeiros Voluntários de Póvoa de Lanhoso",
        "municipality": "Póvoa de Lanhoso",
        "vehicles": [
            {"id": "AV", "capacity_l": 500},
            {"id": "AW", "capacity_l": 600},
            {"id": "AS", "capacity_l": 3000},
            {"id": "AT", "capacity_l": 3500},
            {"id": "AU", "capacity_l": 4000}
        ]
    },
    {
        "id": "viatodos",
        "name": "Associação Humanitária de Bombeiros Voluntários de Viatodos",
        "municipality": "Barcelos",
        "vehicles": [
            {"id": "AY", "capacity_l": 500},
            {"id": "AX", "capacity_l": 3000}
        ]
    },
    {
        "id": "vieira_do_minho",
        "name": "Associação Humanitária de Bombeiros Voluntários de Vieira do Minho",
        "municipality": "Vieira do Minho",
        "vehicles": [
            {"id": "BC", "capacity_l": 600},
            {"id": "BD", "capacity_l": 600},
            {"id": "BE", "capacity_l": 600},
            {"id": "BF", "capacity_l": 600},
            {"id": "AZ", "capacity_l": 2500},
            {"id": "BA", "capacity_l": 4000},
            {"id": "BB", "capacity_l": 9000}
        ]
    },
    {
        "id": "vila_nova_de_famalicao",
        "name": "Associação Humanitária de Bombeiros Voluntários de Vila Nova de Famalicão",
        "municipality": "Vila Nova de Famalicão",
        "vehicles": [
            {"id": "BN", "capacity_l": 300},
            {"id": "BJ", "capacity_l": 500},
            {"id": "BK", "capacity_l": 500},
            {"id": "BL", "capacity_l": 500},
            {"id": "BM", "capacity_l": 500},
            {"id": "BG", "capacity_l": 3500},
            {"id": "BH", "capacity_l": 3500},
            {"id": "BI", "capacity_l": 4000}
        ]
    },
    {
        "id": "vila_verde",
        "name": "Associação Humanitária de Bombeiros Voluntários de Vila Verde",
        "municipality": "Vila Verde",
        "vehicles": [
            {"id": "BO", "capacity_l": 500},
            {"id": "BQ", "capacity_l": 3500},
            {"id": "BP", "capacity_l": 4000}
        ]
    },
    {
        "id": "famalicenses",
        "name": "Associação Humanitária de Bombeiros Voluntários Famalicenses",
        "municipality": "Vila Nova de Famalicão",
        "vehicles": [
            {"id": "BV", "capacity_l": 500},
            {"id": "BW", "capacity_l": 500},
            {"id": "BX", "capacity_l": 600},
            {"id": "BT", "capacity_l": 1500},
            {"id": "BR", "capacity_l": 3000},
            {"id": "BS", "capacity_l": 3500},
            {"id": "BU", "capacity_l": 9000}
        ]
    },
    {
        "id": "celoricenses",
        "name": "Associação Humanitária dos Bombeiros Voluntários Celoricenses",
        "municipality": "Celorico de Basto",
        "vehicles": [
            {"id": "CD", "capacity_l": 500},
            {"id": "CE", "capacity_l": 500},
            {"id": "BY", "capacity_l": 1000},
            {"id": "BZ", "capacity_l": 1000},
            {"id": "CA", "capacity_l": 1000},
            {"id": "CB", "capacity_l": 3500},
            {"id": "CC", "capacity_l": 3500}
        ]
    },
    {
        "id": "terras_de_bouro",
        "name": "Associação Humanitária dos Bombeiros Voluntários de Terras de Bouro",
        "municipality": "Terras de Bouro",
        "vehicles": [
            {"id": "CF", "capacity_l": 500},
            {"id": "CG", "capacity_l": 600},
            {"id": "CH", "capacity_l": 3000},
            {"id": "CI", "capacity_l": 3500},
            {"id": "CJ", "capacity_l": 4500}
        ]
    },
    {
        "id": "braga_voluntarios",
        "name": "Associação Humanitária e Beneficente de Bombeiros Voluntários de Braga",
        "municipality": "Braga",
        "vehicles": [
            {"id": "CM", "capacity_l": 400},
            {"id": "CK", "capacity_l": 3000},
            {"id": "CL", "capacity_l": 3000}
        ]
    },
    {
        "id": "fao",
        "name": "Benemérita Associação Humanitária de Bombeiros Voluntários de Fão",
        "municipality": "Esposende",
        "vehicles": [
            {"id": "CP", "capacity_l": 500},
            {"id": "CO", "capacity_l": 1500},
            {"id": "CN", "capacity_l": 3500}
        ]
    },
    {
        "id": "braga_sapadores",
        "name": "Companhia de Bombeiros Sapadores de Braga",
        "municipality": "Braga",
        "vehicles": [
            {"id": "CU", "capacity_l": 500},
            {"id": "CQ", "capacity_l": 3000},
            {"id": "CS", "capacity_l": 3000},
            {"id": "CR", "capacity_l": 3500},
            {"id": "CT", "capacity_l": 4500}
        ]
    },
    {
        "id": "barcelinhos",
        "name": "Corpo Voluntário de Salvação Pública Barcelinense - Bombeiros de Barcelinhos",
        "municipality": "Barcelos",
        "vehicles": [
            {"id": "CX", "capacity_l": 500},
            {"id": "CY", "capacity_l": 500},
            {"id": "CZ", "capacity_l": 600},
            {"id": "CW", "capacity_l": 3000},
            {"id": "CV", "capacity_l": 3500}
        ]
    },
    {
        "id": "vizela",
        "name": "Real Associação Humanitária de Bombeiros Voluntários de Vizela",
        "municipality": "Vizela",
        "vehicles": [
            {"id": "DF", "capacity_l": 500},
            {"id": "DG", "capacity_l": 500},
            {"id": "DH", "capacity_l": 500},
            {"id": "DI", "capacity_l": 500},
            {"id": "DB", "capacity_l": 1500},
            {"id": "DC", "capacity_l": 1800},
            {"id": "DD", "capacity_l": 2000},
            {"id": "DA", "capacity_l": 3000},
            {"id": "DE", "capacity_l": 7000}
        ]
    }
]

def main():
    total_vehicles = sum(len(s["vehicles"]) for s in STATIONS_DATA)
    total_water_capacity = sum(sum(v["capacity_l"] for v in s["vehicles"]) for s in STATIONS_DATA)
    stations = [
        {**s, "vehicles": [{**v, "category": category(v["capacity_l"])} for v in s["vehicles"]]}
        for s in STATIONS_DATA
    ]

    doc = {
        "title": "Inventário Operacional de Meios de Combate a Incêndios Florestais do Distrito de Braga",
        "source": {
            "author": "Marina Araújo de Matos",
            "thesis": "Minimizing the Impact of Forest Fires",
            "degree": "PhD, Doctoral Program in Industrial and Systems Engineering",
            "institution": "Universidade do Minho, Escola de Engenharia",
            "date": "2025-09",
            "advisors": ["Ana Maria Alves Coutinho da Rocha", "Filipe Pereira Pinto Cunha Alvelos"],
            "project": "FCT PCIF/GRF/0141/2019 (O3F - An Optimization Framework to Reduce Forest Fire)",
            "url": "https://hdl.handle.net/1822/97938",
            "licence": "CC BY-NC-SA 4.0",
            "table_reference": "Table 41: Firefighting resources available at each fire station (p. 75)"
        },
        "category_note": "A tese só dá a capacidade (L); a categoria é inferida dela: até 1000 L VLCI, até 6000 L VFCI, acima VTTU",
        "district": "Braga",
        "totals": {
            "fire_stations": len(STATIONS_DATA),
            "vehicles": total_vehicles,
            "total_water_liters": total_water_capacity,
            "operational_water_points": 139
        },
        # The case study's assumptions (thesis section 6.1, p. 72). Flame limits are not in the thesis:
        # they are Atalaia's own in web/public/suppression.json.
        "operational_rules": {
            "initial_attack_threshold_min": 90,
            "response_time_min": 10,
            "water_tank_refill_duration_min": 10,
            "liters_water_per_meter_fireline": 10.0,
            "extinction_time": "3.3 * sqrt(TBA)",
            "resources_available_pct": [25, 50, 100]
        },
        "stations": stations
    }
    
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Generated {OUT_JSON.relative_to(ROOT)} with {len(STATIONS_DATA)} stations, {total_vehicles} vehicles and {total_water_capacity:,} L total water.")

if __name__ == "__main__":
    main()
