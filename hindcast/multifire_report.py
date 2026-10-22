"""The multi-fire test in numbers: hindcast/MULTIFIRE.md (and multifire.json).

    hindcast/.venv/bin/python -I hindcast/multifire_report.py

Reads every fire's free runs (fires/<id>/runs/mf_<cfg>/result.json, multifire_runs.sh free), its naive references
(runs/b_vento, b_uniforme: baseline.py) and its step-by-step windows (fires/<id>/steps/<cfg>.json, steps.py), and
writes:

  1. free runs: per fire and configuration, Sørensen at the last observed step, its margin over the downwind ellipse
     that knows the observed area (b_vento), the final area against the observed one, and the area outside the
     official perimeter; the median over the fires and how many fires each configuration wins;
  2. step by step: per configuration, over all windows, the growth area ratio (run / observed), the share of
     windows within a factor of 2, the growth Sørensen, the head ROS bias; rule10 (10 % of the wind) alongside;
  3. why it fails: the log of the head ROS ratio (run / observed) per window against the conditions (wind, gust,
     temperature, humidity, day or night, slope, fuel, the observed ROS itself): Spearman correlations and the
     median ratio per bin;
  4. the calibration per fuel class (calibrate.py: fires/adj_all_<cfg>.json) and the ensembles (ensemble.py:
     hindcast/ensemble*.json), when they exist.

The per-fire step table shows the base configurations only (MAIN); the ensemble members, the calibrated and the
gust runs are in the summary table.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

HERE = Path(__file__).resolve().parent
FIRES = HERE / "fires"
FREE = ["K0", "K3", "K3m", "K4", "K5", "K5m", "K3s", "K6", "K6m", "K6d"]
MAIN = ["K3", "K3m", "K5", "K5m", "K6", "K6d"]
DRIVERS = ["K3", "K3m", "K5", "K5m", "K6"]


def load_free():
    out = {}
    for d in sorted(FIRES.iterdir()):
        runs = {}
        for r in sorted((d / "runs").glob("*/result.json")) if (d / "runs").exists() else []:
            name = r.parent.name
            if name.startswith("mf_") or name in ("b_vento", "b_uniforme"):
                runs[name.removeprefix("mf_")] = json.loads(r.read_text())["stats"]
        if runs:
            out[d.name] = runs
    return out


def load_steps():
    out = {}
    for d in sorted(FIRES.iterdir()):
        for f in sorted((d / "steps").glob("*.json")) if (d / "steps").exists() else []:
            if f.stem.startswith("test"):
                continue
            out.setdefault(f.stem, {})[d.name] = json.loads(f.read_text())["windows"]
    return out


def last_obs(stats):
    return stats["by_hour"][-1]["observed_ha"] if stats.get("by_hour") else None


def fmt(x, nd=2):
    return "" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{nd}f}"


def short(fire):
    return fire.split("_")[0]


def fires_table(ids):
    """The fires: when, how big, how many observed steps, the fuel classes of the final perimeter, the wind."""
    sys.path.insert(0, str(HERE))
    from common import fires   # noqa: E402  (api/fires.py through common)
    out = ["## 0. Os incêndios (PT-FireSprd v2, 2015–2021)", "",
           "| Incêndio | Início | Passos observados | Horas | Área no último passo (ha) | Combustível ardido (COS): herbáceo · mato · eucalipto · pinhal e folhosas · não combustível | Vento médio (km/h) · rajada máx. |",
           "|---|---|---|---|---|---|---|"]
    for fid in ids:
        f = fires.Fire(fid)
        legend = json.loads((f.folder / "fuel.json").read_text())["legend"]
        cls = np.array([entry["class"] for entry in legend])[f.read("fuel.u8", "u1")]
        last = f.perimeter(len(f.steps) - 1)
        share = [float((cls[last] == c).mean()) for c in (1, 2, 3, 4, 0)]
        w = json.loads((f.folder / "weather.json").read_text())
        hrs = f.steps[-1]["hours"]
        t0 = fires.parse_time(f.steps[0]["time"])
        on = [i for i, t in enumerate(w["time"]) if 0 <= (fires.parse_time(t[:16]) - t0).total_seconds() / 3600 <= hrs]
        w = {k: [w[k][i] for i in on] for k in ("windKmh", "gustKmh") if k in w}
        out.append(f"| {f.meta['name'] if hasattr(f, 'meta') else short(fid)} | {f.steps[0]['time'][:16].replace('T', ' ')} | {len(f.steps)} | "
                   f"{hrs:.1f} | {last.sum() * f.cellsize ** 2 / 1e4:.0f} | " + " · ".join(f"{x:.0%}" for x in share) +
                   f" | {np.mean(w['windKmh']):.0f} · {max(w.get('gustKmh') or [0]):.0f} |")
    return out + [""]


def main():
    lines = ["# O ELMFIRE em nove incêndios", "",
             "Gerado por `hindcast/multifire_report.py` a partir de `multifire_runs.sh` (corridas livres e passo a passo).", ""]
    free = load_free()
    lines += fires_table(sorted(free))
    configs = [c for c in FREE if any(c in r for r in free.values())]
    result = {"free": {}, "steps": {}, "drivers": {}}

    # 1. free runs
    lines += ["## 1. Corridas livres (do passo 0 ao último passo observado)", "",
              "Sørensen no último passo (e, entre parênteses, a margem sobre a elipse a favor do vento que sabe a área, `b_vento`).", ""]
    lines.append("| Incêndio | b_vento | " + " | ".join(configs) + " |")
    lines.append("|---|---|" + "---|" * len(configs))
    per_cfg = {c: [] for c in configs}
    wins = {c: 0 for c in configs}
    for fire, runs in free.items():
        base = runs.get("b_vento", {}).get("sorensen_last_step")
        row = [short(fire), fmt(base)]
        best = max((runs[c]["sorensen_last_step"] for c in configs if c in runs), default=None)
        for c in configs:
            if c in runs:
                s = runs[c]["sorensen_last_step"]
                per_cfg[c].append((s, None if base is None else s - base))
                if best is not None and s == best:
                    wins[c] += 1
                row.append(f"{s:.2f} ({s - base:+.2f})" if base is not None else f"{s:.2f}")
            else:
                row.append("")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("| **Mediana** | " + fmt(float(np.median([r["b_vento"]["sorensen_last_step"] for r in free.values()
                                                            if "b_vento" in r]))) + " | " +
                 " | ".join(f"**{np.median([s for s, _ in per_cfg[c]]):.2f}** ({np.median([m for _, m in per_cfg[c] if m is not None]):+.2f})"
                            if per_cfg[c] else "" for c in configs) + " |")
    lines.append("| Incêndios em que é a melhor | | " + " | ".join(str(wins[c]) for c in configs) + " |")
    lines += ["", "Área no fim (corrida / observada) e área ardida fora do perímetro oficial:", ""]
    lines.append("| Incêndio | Observado (ha) | " + " | ".join(configs) + " |")
    lines.append("|---|---|" + "---|" * len(configs))
    for fire, runs in free.items():
        obs = next((last_obs(runs[c]) for c in configs if c in runs), None)
        row = [short(fire), f"{obs:.0f}" if obs else ""]
        for c in configs:
            if c in runs and obs:
                st = runs[c]
                out_ha = st.get("outside_official_ha")
                row.append(f"{st['by_hour'][-1]['run_ha'] / obs:.2f}× · " + ("—" if out_ha is None or out_ha != out_ha else f"{out_ha:.0f} ha"))
            else:
                row.append("")
        lines.append("| " + " | ".join(row) + " |")
    result["free"] = {f: {c: r[c]["sorensen_last_step"] for c in r} for f, r in free.items()}

    # 2. step by step
    steps = load_steps()
    if steps:
        lines += ["", "## 2. Passo a passo (recomeça em cada perímetro observado e prevê o seguinte)", "",
                  "Só conta o crescimento entre os dois perímetros. Uma janela acerta \"no fator 2\" se a área nova da corrida "
                  "fica entre metade e o dobro da observada. A regra dos 10 % (sem combustível nem relevo) é a referência.", ""]
        lines.append("| Configuração | Janelas | Área: mediana corrida/obs. | No fator 2 | Sørensen do crescimento (mediana) | ROS: mediana corrida/obs. |")
        lines.append("|---|---|---|---|---|---|")
        seen_rule = {}
        for cfg, by_fire in sorted(steps.items()):
            ws = [w for v in by_fire.values() for w in v if "model" in w]
            for f, v in by_fire.items():
                for w in v:
                    if "rule10" in w:
                        seen_rule[(f, w["k"])] = w["rule10"]
            if not ws:
                continue
            ratio = np.array([w["model"]["ratio"] for w in ws])
            sg = np.array([w["model"]["sorensen_growth"] for w in ws])
            ros = np.array([w["model"]["ros_run"] / max(1, w["model"]["ros_obs"]) for w in ws])
            within = float(np.mean((ratio >= 0.5) & (ratio <= 2)))
            result["steps"][cfg] = {"windows": len(ws), "median_ratio": float(np.median(ratio)), "within2": within,
                                    "median_sorensen_growth": float(np.median(sg)), "median_ros_ratio": float(np.median(ros)),
                                    "fires": sorted(by_fire)}
            lines.append(f"| {cfg} | {len(ws)} ({len(by_fire)} incêndios) | {np.median(ratio):.2f} | {within:.0%} | {np.median(sg):.2f} | {np.median(ros):.2f} |")
        if seen_rule:
            rr = list(seen_rule.values())
            ratio = np.array([w["ratio"] for w in rr])
            ros = np.array([w["ros_run"] / max(1, w["ros_obs"]) for w in rr])
            lines.append(f"| regra dos 10 % | {len(rr)} | {np.median(ratio):.2f} | {np.mean((ratio >= 0.5) & (ratio <= 2)):.0%} | "
                         f"{np.median([w['sorensen_growth'] for w in rr]):.2f} | {np.median(ros):.2f} |")
        # per fire
        lines += ["", "Por incêndio (mediana das janelas): área corrida/obs. · Sørensen do crescimento", ""]
        cfgs = [c for c in MAIN if c in steps]
        lines.append("| Incêndio | Janelas | " + " | ".join(cfgs) + " | regra dos 10 % |")
        lines.append("|---|---|" + "---|" * (len(cfgs) + 1))
        allf = sorted({f for v in steps.values() for f in v})
        for f in allf:
            row = [short(f)]
            nwin = max(len(steps[c].get(f, [])) for c in cfgs)
            row.append(str(nwin))
            rr = list({w["k"]: w["rule10"] for c in cfgs for w in steps[c].get(f, []) if "rule10" in w}.values())
            for c in cfgs:
                ws = [w for w in steps[c].get(f, []) if "model" in w]
                row.append(f"{np.median([w['model']['ratio'] for w in ws]):.2f} · {np.median([w['model']['sorensen_growth'] for w in ws]):.2f}" if ws else "")
            row.append(f"{np.median([w['ratio'] for w in rr]):.2f} · {np.median([w['sorensen_growth'] for w in rr]):.2f}" if rr else "")
            lines.append("| " + " | ".join(row) + " |")

        # 3. drivers of the error
        lines += ["", "## 3. Porque falha: o erro do ROS de cabeça contra as condições", "",
                  "log2(ROS corrida / ROS observado) por janela: 0 é certo, −1 é metade, +1 o dobro. Correlação de Spearman "
                  "(ρ) com cada condição, e a mediana do erro por classe. Janelas com crescimento observado de pelo menos 5 ha.", ""]
        for cfg in [c for c in DRIVERS if c in steps]:
            ws = [(f, w) for f, v in steps[cfg].items() for w in v if "model" in w and w["model"]["growth_obs_ha"] >= 5
                  and w["model"]["ros_obs"] > 0]
            if len(ws) < 8:
                continue
            err = np.array([math.log2(max(w["model"]["ros_run"], 1) / w["model"]["ros_obs"]) for _, w in ws])
            preds = {
                "vento médio (km/h)": [w["wind_kmh"] for _, w in ws],
                "rajada (km/h)": [w.get("gust_kmh") or np.nan for _, w in ws],
                "temperatura (°C)": [w["temp_c"] for _, w in ws],
                "humidade (%)": [w["rh_pct"] for _, w in ws],
                "dia (10-19 h)": [1.0 if 10 <= w["mid_hour"] <= 19 else 0.0 for _, w in ws],
                "declive (°)": [w["growth_slope_deg"] or 0 for _, w in ws],
                "fração de mato": [w["growth_fuel"].get("Mato", 0) for _, w in ws],
                "fração de eucalipto": [w["growth_fuel"].get("Eucalipto e acácia", 0) for _, w in ws],
                "fração de pinhal e folhosas": [w["growth_fuel"].get("Pinhal e folhosas", 0) for _, w in ws],
                "fração herbácea": [w["growth_fuel"].get("Herbáceo", 0) for _, w in ws],
                "ROS observado (m/h)": [w["model"]["ros_obs"] for _, w in ws],
                "duração da janela (h)": [w["minutes"] / 60 for _, w in ws],
            }
            lines += [f"### {cfg} ({len(ws)} janelas, mediana do erro {np.median(err):+.2f}, ou seja ×{2 ** np.median(err):.2f})", "",
                      "| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |", "|---|---|---|---|"]
            drv = {}
            for name, x in preds.items():
                x = np.array(x, float)
                ok = np.isfinite(x)
                if ok.sum() < 8 or np.nanstd(x) == 0:
                    continue
                rho, pv = spearmanr(x[ok], err[ok])
                med = np.median(x[ok])
                lo, hi = err[ok][x[ok] <= med], err[ok][x[ok] > med]
                drv[name] = {"rho": float(rho), "p": float(pv)}
                lines.append(f"| {name} | {rho:+.2f} | {pv:.3f} | {np.median(lo):+.2f} → {np.median(hi):+.2f} |" if len(hi) else
                             f"| {name} | {rho:+.2f} | {pv:.3f} | |")
            result["drivers"][cfg] = drv
            lines.append("")

    # 4. calibration and ensembles
    cal = sorted(FIRES.glob("adj_all_*.json"))
    if cal:
        lines += ["## 4. Calibração por classe de combustível (deixando um incêndio de fora)", "",
                  "Fator de ajuste do ROS por classe, ajustado ao erro do ROS de cabeça nas janelas dos outros incêndios "
                  "(`calibrate.py`). Intervalo = o menor e o maior fator entre as dobras.", "",
                  "| Sobre | Janelas | Todos os incêndios | Intervalo entre dobras | |ln erro| antes → depois (na amostra) |",
                  "|---|---|---|---|---|"]
        for f in cal:
            d = json.loads(f.read_text())
            rng = ", ".join(f"{k} {a:.2f}–{b:.2f}" for k, (a, b) in d.get("fold_range", {}).items())
            lines.append(f"| {d['steps']} | {d['windows']} | {d['adj_class']} | {rng} | "
                         f"{d.get('residual_ln_before', '')} → {d.get('residual_ln_after', '')} |")
        lines.append("")
    ens = sorted(HERE.glob("ensemble*.json"))
    if ens:
        lines += ["## 5. Ensembles (probabilidade de arder por janela)", "",
                  "| Ensemble | Membros | Janelas | Brier: ensemble · melhor membro · regra 10 % | Sørensen P≥0,5 · membro mediano · "
                  "oráculo · regra 10 % | Cobertura P≥0,5 · envelope | Área observada dentro do leque | Ganha à regra 10 % (Brier · Sørensen) |",
                  "|---|---|---|---|---|---|---|---|"]
        for f in ens:
            sm = json.loads(f.read_text())["summary"]
            best_member = min(sm["brier_member_medians"].values())
            lines.append(f"| {f.stem} | {' '.join(sm['members'])} | {sm['windows']} | {sm['brier_ensemble_median']:.3f} · "
                         f"{best_member:.3f} · {sm.get('brier_rule10_median', float('nan')):.3f} | {sm['sorensen_p50_median']:.2f} · "
                         f"{sm['sorensen_median_member_median']:.2f} · {sm['sorensen_best_member_median (oracle)']:.2f} · "
                         f"{sm.get('sorensen_rule10_median', float('nan')):.2f} | {sm['hit_p50_median']:.0%} · {sm['hit_any_median']:.0%} | "
                         f"{sm['bracket_share']:.0%} | {sm.get('ensemble_beats_rule10_brier_share', float('nan')):.0%} · "
                         f"{sm.get('ensemble_beats_rule10_sorensen_share', float('nan')):.0%} |")
            result.setdefault("ensembles", {})[f.stem] = sm
        lines.append("")
    (HERE / "MULTIFIRE.md").write_text("\n".join(lines) + "\n")
    (HERE / "multifire.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
