"""Generate persistent 3D canopy layers for Cabeceiras de Basto based on COS forest classes."""

import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FID = "CabeceirasdeBasto_06092016"
folder = ROOT / "web/public/fires" / FID
out_dir = ROOT / "hindcast/fires" / FID

grid = json.loads((folder / "grid.json").read_text(encoding="utf-8"))
legend = json.loads((folder / "fuel.json").read_text(encoding="utf-8"))["legend"]
fuel_idx = np.fromfile(folder / "fuel.u8", dtype=np.uint8).reshape((grid["rows"], grid["cols"]))

cov_list, h_list, b_list, blk_list = [], [], [], []
for item in legend:
    cos = str(item.get("cos", ""))
    sb = int(item.get("scottBurgan", 0))
    if sb <= 99:
        cov_list.append(0.0)
        h_list.append(0.0)
        b_list.append(0.0)
        blk_list.append(0.0)
    elif cos.startswith("5.1.2"):  # Pinhal-bravo
        cov_list.append(70.0)
        h_list.append(15.0)
        b_list.append(2.5)
        blk_list.append(0.14)
    elif cos in ("5.1.1.5", "5.1.1.6"):  # Eucaliptal
        cov_list.append(75.0)
        h_list.append(18.0)
        b_list.append(3.5)
        blk_list.append(0.12)
    elif cos.startswith("5.1"):  # Carvalhais e folhosas
        cov_list.append(65.0)
        h_list.append(14.0)
        b_list.append(3.0)
        blk_list.append(0.08)
    else:
        cov_list.append(0.0)
        h_list.append(0.0)
        b_list.append(0.0)
        blk_list.append(0.0)

cc = np.array(cov_list, dtype=np.float32)[fuel_idx]
ch = np.array(h_list, dtype=np.float32)[fuel_idx]
cbh = np.array(b_list, dtype=np.float32)[fuel_idx]
cbd = np.array(blk_list, dtype=np.float32)[fuel_idx]

arrays = {
    "cover_pct": np.round(cc).astype(np.uint8),
    "height_dm": np.round(ch * 10).astype(np.uint16),
    "base_dm": np.round(cbh * 10).astype(np.uint16),
    "bulk_cg_m3": np.round(cbd * 100).astype(np.uint8),
}

np.savez_compressed(out_dir / "canopy.npz", **arrays)
meta = {
    "file": "canopy.npz",
    "grid": "grid.json, row 0 north",
    "source": "Physical forestry parameterization (Fernandes 2009 / DGT COS2018)",
    "summary": {
        "canopy_cells_pct": round(float((cc > 0).mean()) * 100, 1),
        "mean_height_m": round(float(ch[cc > 0].mean()), 1) if (cc > 0).any() else 0.0,
        "mean_cover_pct": round(float(cc[cc > 0].mean()), 1) if (cc > 0).any() else 0.0,
    }
}
(out_dir / "canopy.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Generated {out_dir / 'canopy.npz'}: {meta['summary']}")
