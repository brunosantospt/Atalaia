"""The runs of a fire (fires/<id>/runs/*/result.json) as a Markdown table, for the README.

    hindcast/.venv/bin/python -I hindcast/table.py VieiradoMinho_10082016
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    fire = sys.argv[1]
    rows = [json.loads(p.read_text()) for p in sorted((HERE / "fires" / fire / "runs").glob("*/result.json"))]
    if not rows:
        raise SystemExit(f"{fire}: sem corridas em hindcast/fires/{fire}/runs/")
    steps = [x["h"] for x in rows[0]["stats"]["sorensen_by_step"]]
    head = ["Corrida", *[f"{h:g} h" for h in steps], "Sørensen último passo", "Sørensen oficial", "Fora do oficial",
            "Satélite"]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    obs = {x["h"]: x["observed_ha"] for x in rows[0]["stats"]["by_hour"]}
    print("| Observado | " + " | ".join(f"{obs[h]} ha" for h in steps) + " | | | | |")
    for r in rows:
        s = r["stats"]
        by = {x["h"]: x["run_ha"] for x in s["by_hour"]}
        print(f"| {r['name']} | " + " | ".join(str(by.get(h, "")) for h in steps)
              + f" | {s['sorensen_last_step']} | {s.get('sorensen_official', '')} | {s.get('outside_official_ha', '')}"
              + f" | {s.get('satellite', {}).get('mean_reached', '')} |")


if __name__ == "__main__":
    main()
