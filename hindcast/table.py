"""The runs of a fire (fires/<id>/runs/*/result.json) as a Markdown table, for the README.

    hindcast/.venv/bin/python -I hindcast/table.py VieiradoMinho_10082016

The seeds of a run (<name>, <name>_seed2, ...) make one row: the median and, in brackets, the lowest and highest.
"Máquina" is where they ran (result.json's platform; "?" for runs from before it was recorded): with spotting, the
same seed differs between machines.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent


def cell(values: list, fmt: str) -> str:
    v = [x for x in values if x is not None and x != ""]
    if not v:
        return ""
    if len(v) == 1:
        return format(v[0], fmt)
    return f"{format(float(np.median(v)), fmt)} ({format(min(v), fmt)}–{format(max(v), fmt)})"


def main():
    fire = sys.argv[1]
    rows = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((HERE / "fires" / fire / "runs").glob("*/result.json"))]
    if not rows:
        raise SystemExit(f"{fire}: sem corridas em hindcast/fires/{fire}/runs/")
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(re.sub(r"_seed\d+$", "", r["name"]), []).append(r)
    steps = [x["h"] for x in rows[0]["stats"]["sorensen_by_step"]]
    head = ["Corrida", "Sementes", *[f"{h:g} h" for h in steps], "Sørensen último passo", "Sørensen oficial",
            "Fora do oficial", "Satélite", "Máquina"]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    obs = {x["h"]: x["observed_ha"] for x in rows[0]["stats"]["by_hour"]}
    print("| Observado | | " + " | ".join(f"{obs[h]} ha" for h in steps) + " | | | | | |")
    for name, rs in groups.items():
        st = [r["stats"] for r in rs]
        by = [{x["h"]: x["run_ha"] for x in s["by_hour"]} for s in st]
        machines = sorted({r.get("platform", {}).get("machine", "?") for r in rs if r["engine"].startswith("ELMFIRE")})
        print(f"| {name} | {len(rs)} | " + " | ".join(cell([b.get(h) for b in by], ".0f") for h in steps)
              + f" | {cell([s['sorensen_last_step'] for s in st], '.3f')}"
              + f" | {cell([s.get('sorensen_official') for s in st], '.3f')}"
              + f" | {cell([s.get('outside_official_ha') for s in st], '.0f')}"
              + f" | {cell([s.get('satellite', {}).get('mean_reached') for s in st], '.2f')}"
              + f" | {', '.join(machines)} |")


if __name__ == "__main__":
    main()
