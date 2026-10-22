"""Attack lines for a real fire, inferred from where it stopped, as barriers of the API scenario (docs/contracts.md,
decision.barriers): for run.py --barriers, or for POST /api/run.

    hindcast/.venv/bin/python -I hindcast/attack.py VieiradoMinho_10082016

No map of the lines held in 2016 exists in the open records (SGIF has times and areas, the GNR/GTF files only the
final perimeter, ANEPC publishes no line maps), so these lines are inferred, and each one says how (tier, source):

  road       a road or track (web/public/fires/<id>/osm.json) that the official perimeter (evidence.py) follows for
             --min-run m or more, outside the burn: the fire stopped there, which is where crews hold a flank (a road
             gives them access and a fuel break).
               * the minimum length applies to a connected stretch of road, not to each piece between two junctions;
               * a road the fire burned across also passes near the perimeter, so a stretch counts only if it runs
                 along it: its ends are at least --min-along x its length apart, measured along the perimeter;
               * only the outer edge counts, and not where it runs along an earlier fire's scar (run.py --scars).
  connector  the official perimeter between the ends of two road lines less than --bridge-m apart with no road
             between them in OpenStreetMap: crews tie two held flanks together with a hand or dozer line. Holds from
             the later of the two lines' minutes.

Timing (from_min, minutes after step 0): when the observed fire (progression.geojson, interpolated between the steps)
first comes within --reach-m of the line, minus --lead minutes (crews are placed ahead of the front), rounded down to
--step (each distinct from_min splits the run, as in the API) and never before --earliest.
With --timing run --run <name>, the same rule on the fire of a run.py run (a free run, no lines): the records say
these lines held, not when they were made, and the model's fire gets there at other times than the real one. Timed
on the model's own fire, a line fails only where the model's fire is faster than crews placed --lead min ahead of it.
Writes attack_lines_<name>.json. Settlement defence is not
inferred: OpenStreetMap maps few houses in these parishes.

The location of every line comes from the final perimeter, so a run with them matches that perimeter better by
construction. Judge them by the satellite hotspots and the burned area over time (run.py scores both).

Writes hindcast/fires/<id>/attack_lines.json and attack_lines.png.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import shapely
import shapely.ops
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, evidence, fire_dir, fires, observed_arrival, official  # noqa: E402

HIGHWAYS = ("primary", "secondary", "tertiary", "unclassified", "residential", "track", "service")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--near-m", type=float, default=60.0, help="road within this of the perimeter counts as on it")
    p.add_argument("--min-run", type=float, default=300.0, help="shortest connected road stretch kept (m)")
    p.add_argument("--min-along", type=float, default=0.5)
    p.add_argument("--bridge-m", type=float, default=250.0, help="longest gap between two road lines joined (m)")
    p.add_argument("--reach-m", type=float, default=400.0)
    p.add_argument("--lead", type=float, default=60.0, help="minutes a line is held before the front arrives")
    p.add_argument("--earliest", type=float, default=30.0)
    p.add_argument("--step", type=float, default=60.0)
    p.add_argument("--width", type=float, default=20.0, help="width_m of each line")
    p.add_argument("--timing", choices=["observed", "run"], default="observed",
                   help="time each line by the observed fire, or by a run's own fire (--run): crews in place before "
                        "the modelled front, so a line fails only if the model's fire beats it there")
    p.add_argument("--run", help="with --timing run: the run.py run whose arrival times the lines (a free run)")
    args = p.parse_args(argv)

    fire = fires.Fire(args.fire)
    _, ev = evidence(args.fire)
    off = official(ev)
    if off is None:
        raise SystemExit(f"{args.fire}: corre primeiro evidence.py (falta o perímetro oficial)")
    to_ll = Transformer.from_crs(fire.grid["srs"], "EPSG:4326", always_xy=True)
    outer = shapely.Polygon(fire.project(off).buffer(0).exterior)   # metres; unburned islands inside are not lines
    scars = shapely.unary_union([fire.project(shapely.geometry.shape(f["geometry"])) for f in ev
                                 if f["properties"]["kind"] == "scar"])
    boundary = outer.boundary.difference(scars.buffer(100)) if not scars.is_empty else outer.boundary
    ring, inner = outer.exterior, outer.buffer(-args.near_m)

    obs = observed_arrival(fire)
    clock = obs
    if args.timing == "run":
        clock = np.load(CACHE / args.fire / f"{args.run}.npy").astype(float)   # minutes after step 0 (run.py)
    who = "observed" if args.timing == "observed" else f"modelled ({args.run})"
    xs, ys = fire.centres()
    timed = np.isfinite(clock)
    xs, ys, ts = xs[timed], ys[timed], clock[timed]

    def when(geom) -> tuple[float, str]:
        d = shapely.distance(geom, shapely.points(xs, ys))
        near = d <= args.reach_m
        if near.any():
            t, how = ts[near].min() - args.lead, f"{who} arrival within reach"
        else:
            i = int(np.argmin(d))
            t, how = ts[i] - args.lead, f"nearest {who} cell, {d[i]:.0f} m away"
        return max(args.earliest, np.floor(t / args.step) * args.step), how

    osm = json.loads((fire.folder / "osm.json").read_text())
    pieces = []
    for road in osm["roads"]:
        if road["hw"] not in HIGHWAYS or len(road["pts"]) < 2:
            continue
        line = fire.project(LineString(road["pts"]))
        if line.distance(outer) > args.near_m:
            continue
        n = max(1, int(line.length // 25))
        for k in range(n):
            seg = shapely.ops.substring(line, k * line.length / n, (k + 1) * line.length / n)
            mid = seg.interpolate(0.5, normalized=True)
            if mid.distance(boundary) <= args.near_m and not inner.contains(mid):
                pieces.append((seg, road["hw"]))

    merged = linemerge(MultiLineString([s for s, _ in pieces])) if pieces else MultiLineString()
    runs = [r for r in getattr(merged, "geoms", [merged]) if not r.is_empty]

    def along(r):
        d = abs(ring.project(shapely.Point(r.coords[0])) - ring.project(shapely.Point(r.coords[-1])))
        return min(d, ring.length - d) / max(r.length, 1.0)
    crossing = [r for r in runs if along(r) < args.min_along]
    runs = [r for r in runs if along(r) >= args.min_along]

    group = list(range(len(runs)))

    def root(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i
    for i in range(len(runs)):
        for j in range(i + 1, len(runs)):
            if runs[i].distance(runs[j]) < 1.0:
                group[root(i)] = root(j)
    sets = {}
    for i, r in enumerate(runs):
        sets.setdefault(root(i), []).append(r)

    lines = []
    for members in sets.values():
        total = sum(r.length for r in members)
        if total < args.min_run:
            continue
        t, how = when(shapely.unary_union(members))
        for run in members:
            kinds = sorted({hw for s, hw in pieces if s.distance(run) < 1})
            lines.append(("road", run.simplify(10), t, f"road along the official perimeter, {run.length:.0f} m of a "
                                                       f"{total:.0f} m held line ({', '.join(kinds)}); time: {how}"))

    ends = [(i, shapely.Point(c)) for i, l in enumerate(lines) for c in (l[1].coords[0], l[1].coords[-1])]
    roads = shapely.unary_union([l[1] for l in lines]) if lines else None
    done = set()
    for a in range(len(ends)):
        for b in range(a + 1, len(ends)):
            (i, pa), (j, pb) = ends[a], ends[b]
            if i == j or (min(i, j), max(i, j)) in done or not 1.0 <= pa.distance(pb) <= args.bridge_m:
                continue
            if pa.distance(ring) > args.near_m or pb.distance(ring) > args.near_m:
                continue
            da, db = ring.project(pa), ring.project(pb)
            lo, hi = min(da, db), max(da, db)
            path = shapely.ops.substring(ring, lo, hi)
            if path.length > ring.length / 2:      # the short way round
                path = linemerge([shapely.ops.substring(ring, hi, ring.length), shapely.ops.substring(ring, 0, lo)])
            if path.geom_type != "LineString" or not 20 <= path.length <= 1.5 * args.bridge_m:
                continue
            if path.buffer(5).difference(roads.buffer(args.near_m)).area < 5 * path.length:
                continue                            # already along the road lines
            coords = list(path.coords)
            if shapely.Point(coords[0]).distance(pa) > shapely.Point(coords[-1]).distance(pa):
                coords.reverse()                    # from pa's end to pb's
            done.add((min(i, j), max(i, j)))
            lines.append(("connector", LineString([pa.coords[0], *coords, pb.coords[0]]).simplify(5),
                          max(lines[i][2], lines[j][2]),
                          f"official perimeter between the ends of two road lines {pa.distance(pb):.0f} m apart "
                          f"(no road in OpenStreetMap); time: the later of the two lines"))
    covered = shapely.unary_union([l[1].buffer(args.near_m) for l in lines]).intersection(boundary).length \
        if lines else 0.0

    out = []
    for i, (tier, geom, t, why) in enumerate(lines, 1):
        lon, lat = to_ll.transform(*np.array(geom.coords).T)
        out.append({"label": f"{tier} {i}", "tier": tier, "source": why,
                    "path": [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)],
                    "width_m": args.width, "from_min": round(float(t), 1), "length_m": round(geom.length)})
    doc = {"fire": args.fire,
           "format": "decision.barriers of docs/contracts.md (path, width_m, from_min, from step 0), plus label, tier, "
                     "source and length_m; POST /api/run takes path, width_m and from_min",
           "options": vars(args),
           "official_boundary_km": round(outer.boundary.length / 1000, 2),
           "boundary_along_scars_km": round((outer.boundary.length - boundary.length) / 1000, 2),
           "boundary_covered_km": round(covered / 1000, 2),
           "crossings_left_out_km": round(sum(r.length for r in crossing) / 1000, 2),
           "barriers": out}
    d = fire_dir(args.fire)
    name = "attack_lines" if args.timing == "observed" else f"attack_lines_{args.run}"
    (d / f"{name}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"{len(out)} linhas ({sum(b['tier'] == 'connector' for b in out)} ligações), "
          f"{sum(b['length_m'] for b in out) / 1000:.1f} km; perímetro oficial {doc['official_boundary_km']} km, "
          f"{doc['boundary_along_scars_km']} km junto a cicatrizes, {doc['boundary_covered_km']} km com linhas; "
          f"{len(crossing)} estradas que o fogo atravessou ficam de fora ({doc['crossings_left_out_km']} km)")
    print("  começam a segurar às", sorted({round(b['from_min'] / 60, 1) for b in out}), "h")

    z = 2
    top = fire.grid["ymin"] + fire.rows * fire.cellsize
    h = obs / 60
    vis = np.zeros(h.shape + (3,), np.uint8) + 25
    b = np.isfinite(h)
    vis[b] = np.stack([255 - h[b] * 8, 200 - h[b] * 8, 40 + h[b] * 4], -1).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(vis).resize((fire.cols * z, fire.rows * z), Image.NEAREST)
    dr = ImageDraw.Draw(img, "RGBA")
    px = lambda x, y: ((x - fire.grid["xmin"]) / fire.cellsize * z, (top - y) / fire.cellsize * z)  # noqa: E731
    for poly in getattr(scars, "geoms", [scars]):
        if not poly.is_empty:
            dr.polygon([px(*c) for c in poly.exterior.coords], fill=(255, 0, 0, 90))
    dr.line([px(*c) for c in outer.exterior.coords], fill=(0, 255, 255, 255), width=1)
    for bb, (tier, geom, t, _) in zip(out, lines):
        dr.line([px(*c) for c in geom.coords], fill=(255, 255, 255) if tier == "road" else (120, 255, 120), width=4)
        x0, y0 = px(*geom.coords[0])
        dr.text((x0 + 4, y0 - 12), f"{t / 60:.0f}h", fill=(255, 255, 255))
    img.save(d / f"{name}.png")
    print(f"-> {d}/{name}.json, {name}.png")


if __name__ == "__main__":
    main()
