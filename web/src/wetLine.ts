// What a decision puts on the ground for the fire engines: barriers, in exactly the shape of the
// scenario's `decision.barriers` (docs/contracts.md): a path, a width and the minute from which
// nothing burns in the cells the strip touches (fuel 91). Ground units at a point lay a wet line
// across the local spread, centred on their access point, as long and wide as their kind
// (suppression.json), and from then on keep extending it both ways along the fire edge at their
// attack rate, in pieces that hold from the minute they are finished; a crew line is laid in
// pieces as it is dug. The fast model (fastModel.ts)
// applies these same barriers, so the preview and an ELMFIRE run see the same input. Aerial
// units are not barriers: their drops only slow the fire for a while, and the contract has no
// end minute. Pure: no DOM and no fastModel at run time, so it runs in the ILS worker too.

import { findAirBase } from './airBases'
import type { Scenario } from './fastModel'
import { bearingDeg, destination, distanceM, lerpLonLat, toPTTM06, type LonLat } from './geo'
import { cellOfXY, lonLatAt, type Grid } from './grid'
import { arrivalMin, attackMPerH, dutyCycle, isAerial, type Assignment, type Decision } from './suppression'

/** One entry of the scenario's `decision.barriers`, as the API takes it. */
export interface Barrier {
  path: [number, number][] // [[lon, lat], ...], WGS84, at least 2 points
  width_m: number
  from_min: number // minutes from the start of the run; always before its end
}

/** A barrier and what laid it: the assignment (its index in the decision) and how. */
export interface WetLine {
  barrier: Barrier
  slot: number
  kind: 'wet' | 'line' // a wet line at a point, or a piece of a crew line
  lengthM: number
  spreadDeg?: number // wet line: the local spread it stands across
  grown?: boolean // a piece laid along the fire edge after the first line, not the first line itself
}

const LINE_PIECE_MIN = 30 // a crew line holds piece by piece, each one this much work
const MAX_FROM = 6 // distinct from_min per decision: each one splits the ELMFIRE run into one more stretch
const GROW_MIN_SLICE = 30 // a unit's growth holds in slices of at least this much work (min), on one grid for all units
const GROW_LEAD_MIN = 20 // a growing line is laid on the free run's isochrone this far ahead of the minute it holds
const FIT_CELLS = [5, 8] // spread from the free run: least squares over the reached cells this many around (150 m; 240 m if too few)

/** Minutes since ignition until each assignment is at work: its dispatch time plus turnout and the
 *  straight line × the road factor from its station (an aircraft flies from its air base), and the
 *  first ground assignment of each station is its ECIN, out in 2 min (a shuttle takes that place too). */
export function arrivals(scenario: Scenario, decision: Decision): number[] {
  const { stations, suppression: sup } = scenario
  const ecinUsed = new Set<string>()
  return decision.assignments.map((a) => {
    const unit = sup.units[a.unit]
    const aerial = isAerial(unit)
    const ecin = !aerial && !ecinUsed.has(a.from)
    if (!aerial) ecinUsed.add(a.from)
    const target = decision.points[a.target] ?? decision.lines[a.target]?.[0]
    const origin = aerial ? findAirBase(a.from) : stations.find((s) => s.id === a.from)
    const km = origin && target ? distanceM(origin, target) / 1000 : sup.dispatch.airBaseKm
    return (a.dispatchMin ?? scenario.dispatchMin ?? 0) + arrivalMin(sup, unit, km, ecin)
  })
}

/** Metres of wet line an assignment at a point lays: its kind's length × count, plus the line of a
 *  tanker shuttling water to the point for units with a tank, and never further than reachM either side. */
export function wetLineLengthM(scenario: Scenario, decision: Decision, a: Assignment): number {
  const sup = scenario.suppression
  const unit = sup.units[a.unit]
  if (!unit.wetLineLengthM) return 0
  let length = unit.wetLineLengthM * a.count
  if (unit.waterL)
    for (const s of decision.assignments)
      if (s.task === 'shuttle' && s.target === a.target) length += (sup.units[s.unit].wetLineLengthM ?? 0) * s.count
  return unit.reachM ? Math.min(length, 2 * unit.reachM) : length
}

/** The barriers of a decision, with what laid each one: the input an engine runs the decision with.
 *  `free` is the free run's arrival (fastModel.freeArrival), for the local direction of spread. */
export function wetLines(scenario: Scenario, decision: Decision, free: Float32Array): WetLine[] {
  const { suppression: sup, durationMin } = scenario
  const eta = arrivals(scenario, decision)
  const out: WetLine[] = []
  const push = (w: WetLine) => {
    // A barrier the API takes: from a whole minute (fewer cuts of the run), before the end.
    w.barrier.from_min = Math.ceil(w.barrier.from_min - 1e-6)
    if (Number.isFinite(w.barrier.from_min) && w.barrier.from_min < durationMin && w.barrier.path.length >= 2) out.push(w)
  }
  decision.assignments.forEach((a, slot) => {
    const unit = sup.units[a.unit]
    if (isAerial(unit)) return
    if (a.task === 'line') {
      for (const piece of linePieces(scenario, decision, a, eta[slot])) push({ ...piece, slot, kind: 'line' })
      return
    }
    if (a.task !== 'direct' && a.task !== 'protect') return
    const p = decision.points[a.target]
    const lengthM = p ? wetLineLengthM(scenario, decision, a) : 0
    if (!p || lengthM <= 0 || !unit.wetLineWidthM) return
    const spreadDeg = spreadAt(scenario, free, p)
    const ends = [destination(p, spreadDeg + 90, lengthM / 2), destination(p, spreadDeg - 90, lengthM / 2)]
    push({
      barrier: { path: ends.map((q) => [q.lon, q.lat]), width_m: unit.wetLineWidthM, from_min: eta[slot] },
      slot,
      kind: 'wet',
      lengthM,
      spreadDeg,
    })
  })
  growLines(scenario, decision, free, eta, out, push)
  capFromMin(out)
  return out
}

/** Just the barriers, for `decision.barriers` of the scenario sent to the API. */
export function barriers(scenario: Scenario, decision: Decision, free: Float32Array): Barrier[] {
  return wetLines(scenario, decision, free).map((w) => w.barrier)
}

/** One end of a growing wet line: the cell it has reached, the way it is heading (east, north) and the
 *  work (m) the unit has done that it has not laid yet. */
interface Front {
  col: number
  row: number
  hx: number
  hy: number
  at: LonLat
}

/** Wet lines that keep growing. A ground unit with `followsEdge` (suppression.json) at a point goes on
 *  after its first line, from both ends of it, along the edge of the fire at its attack rate in the fuel
 *  × count, with the tank's duty cycle (alerts.ts: the trip to refill, none with a shuttle at the point),
 *  for `maxWorkH` hours. The work is laid in slices on ONE time grid for the whole decision, so the
 *  distinct from_min stay few: the piece of a slice holds from the slice's end. A slice follows the
 *  isochrone of the free run GROW_LEAD_MIN ahead of that minute (the edge the line meets), walking cell to cell
 *  with a heading it keeps; where the free run never gets, it goes straight on. Units at the same
 *  point share the ends of their line: the next one starts where the last one got to. */
function growLines(
  scenario: Scenario,
  decision: Decision,
  free: Float32Array,
  eta: number[],
  out: WetLine[],
  push: (w: WetLine) => void,
) {
  const { grid, suppression: sup, durationMin } = scenario
  const shuttled = new Set(decision.assignments.filter((a) => a.task === 'shuttle').map((a) => a.target))
  interface Grower { slot: number; a: Assignment; rate: number; stop: number } // rate: m/h laid in all, stop: minute it stops
  const groups = new Map<string, { growers: Grower[]; fronts: Front[]; seen: Set<number> }>()
  const longest = new Map<string, number>() // the first line of a point that reaches furthest
  decision.assignments.forEach((a, slot) => {
    const unit = sup.units[a.unit]
    if (isAerial(unit) || (a.task !== 'direct' && a.task !== 'protect') || !decision.points[a.target]) return
    longest.set(a.target, Math.max(longest.get(a.target) ?? 0, wetLineLengthM(scenario, decision, a)))
    if (!unit.followsEdge || !unit.wetLineWidthM || !(eta[slot] < durationMin)) return
    const p = decision.points[a.target]
    const cell = cellOfXY(grid, toPTTM06(p).x, toPTTM06(p).y)
    const inside = cell.col >= 0 && cell.row >= 0 && cell.col < grid.cols && cell.row < grid.rows
    const rate = inside ? attackMPerH(unit, grid.fuelClass[cell.row * grid.cols + cell.col]) * a.count * dutyCycle(unit, shuttled.has(a.target) ? 0 : sup.dispatch.waterPointKm) : 0
    if (!(rate > 0)) return
    const g = groups.get(a.target) ?? { growers: [], fronts: [], seen: new Set<number>() }
    g.growers.push({ slot, a, rate, stop: eta[slot] + (unit.maxWorkH ?? 12) * 60 })
    groups.set(a.target, g)
  })
  if (!groups.size) return
  for (const [target, g] of groups) {
    const p = decision.points[target]
    const spread = spreadAt(scenario, free, p)
    for (const sign of [1, -1]) {
      const brg = spread + 90 * sign
      const end = destination(p, brg, (longest.get(target) ?? 0) / 2)
      const { x, y } = toPTTM06(end)
      const { col, row } = cellOfXY(grid, x, y)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
      const r = (brg * Math.PI) / 180
      g.fronts.push({ col, row, hx: Math.sin(r), hy: Math.cos(r), at: end })
    }
  }

  // The time grid: slots left by the other pieces' distinct minutes, but never slices shorter than GROW_MIN_SLICE.
  const all = [...groups.values()].flatMap((g) => g.growers)
  const t0 = Math.ceil(Math.min(...all.map((x) => eta[x.slot])))
  const t1 = Math.floor(Math.min(durationMin - 1, Math.max(...all.map((x) => x.stop))))
  const used = new Set(out.map((w) => w.barrier.from_min)).size
  const slots = Math.min(MAX_FROM - 1, Math.max(3, MAX_FROM - used))
  // Slices of GROW_MIN_SLICE first, then longer by a constant ratio until `slots` of them reach the end:
  // the lines are cheapest to close, and the lag of a slice costs least, while the fire is small.
  const cuts = sliceCuts(t0, t1, slots)
  for (let k = 1; k < cuts.length; k++) {
    const prev = cuts[k - 1]
    const now = cuts[k]
    for (const g of groups.values()) {
      for (const w of g.growers) {
        const worked = Math.min(now, w.stop) - Math.max(prev, eta[w.slot])
        if (worked <= 0) continue
        const unit = sup.units[w.a.unit]
        const halfM = (w.rate * worked) / 60 / 2
        for (const f of g.fronts) {
          const piece = walk(grid, free, durationMin, f, g.seen, halfM, Math.min(now + GROW_LEAD_MIN, durationMin))
          if (piece.m <= 0) continue
          push({
            barrier: { path: piece.path.map((q) => [q.lon, q.lat]), width_m: unit.wetLineWidthM!, from_min: now },
            slot: w.slot,
            kind: 'wet',
            lengthM: piece.m,
            grown: true,
          })
        }
      }
    }
  }
}

/** Minutes t0 < ... < t1, at most `slots` slices: the first GROW_MIN_SLICE long, each the next ratio times longer. */
function sliceCuts(t0: number, t1: number, slots: number): number[] {
  let ratio = 1
  if (t1 - t0 > slots * GROW_MIN_SLICE) {
    let lo = 1
    let hi = 3
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      const total = (GROW_MIN_SLICE * (Math.pow(mid, slots) - 1)) / (mid - 1)
      if (total < t1 - t0) lo = mid
      else hi = mid
    }
    ratio = hi
  }
  const cuts = [t0]
  for (let len = GROW_MIN_SLICE; cuts[cuts.length - 1] < t1 && cuts.length <= slots; len *= ratio) cuts.push(Math.min(Math.round(cuts[cuts.length - 1] + len), t1))
  cuts[cuts.length - 1] = t1
  return cuts.filter((c, i) => i === 0 || c > cuts[i - 1])
}

/** Walks a front along the isochrone of `level` in the free run for about `metres` of line: from cell to
 *  cell within ±60° of its heading, to the one nearest the level (a cell the fire has passed by then weighs
 *  3 times as much as one it has not). Moves `f`; returns the path from where it was and its length. */
function walk(grid: Grid, free: Float32Array, durationMin: number, f: Front, seen: Set<number>, metres: number, level: number) {
  const path: LonLat[] = [f.at]
  let m = 0
  let col = f.col
  let row = f.row
  while (m < metres) {
    let best = -1
    let bestScore = Infinity
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue
        const c = col + dc
        const r = row + dr
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || seen.has(r * grid.cols + c)) continue
        const len = Math.hypot(dc, dr)
        const cos = (dc * f.hx - dr * f.hy) / len // rows go south
        if (cos < 0.5) continue
        const t = free[r * grid.cols + c]
        const e = Math.min(t <= durationMin ? t : 2 * durationMin, 2 * durationMin) - level
        const score = (e < 0 ? -3 * e : e) / 4 + (1 - cos) * 4
        if (score < bestScore) (bestScore = score), (best = (dr + 1) * 3 + dc + 1)
      }
    if (best < 0) break
    const dc = (best % 3) - 1
    const dr = Math.floor(best / 3) - 1
    const len = Math.hypot(dc, dr)
    col += dc
    row += dr
    seen.add(row * grid.cols + col)
    m += len * grid.cellsize
    f.hx = 0.85 * f.hx + (0.15 * dc) / len
    f.hy = 0.85 * f.hy + (-0.15 * dr) / len
    const h = Math.hypot(f.hx, f.hy)
    f.hx /= h
    f.hy /= h
    path.push(lonLatAt(grid, col + 0.5, row + 0.5))
  }
  f.col = col
  f.row = row
  f.at = path[path.length - 1]
  // Every other cell is enough for the strip to touch the same cells, and a shorter path for the API.
  const thin = path.filter((_, i) => i === 0 || i === path.length - 1 || i % 2 === 0)
  return { path: thin, m: path.length > 1 ? m : 0 }
}

/** At most MAX_FROM distinct from_min in all: past that, every piece waits for the next of MAX_FROM
 *  evenly spaced minutes from the first to the last (later never earlier, so nothing holds sooner than it was laid). */
function capFromMin(out: WetLine[]) {
  const set = [...new Set(out.map((w) => w.barrier.from_min))]
  if (set.length <= MAX_FROM) return
  const lo = Math.min(...set)
  const hi = Math.max(...set)
  const step = (hi - lo) / (MAX_FROM - 1)
  for (const w of out) w.barrier.from_min = Math.min(hi, Math.ceil(lo + Math.ceil((w.barrier.from_min - lo) / step - 1e-9) * step - 1e-6))
}

/** A crew line as it is dug from its first click: a piece every LINE_PIECE_MIN of work, holding
 *  from the minute it is finished. Each stretch costs its length at the crew's rate in the fuel
 *  under it (lineMPerH × count); ground with nothing to burn costs nothing. */
function linePieces(scenario: Scenario, decision: Decision, a: Assignment, start: number): Omit<WetLine, 'slot' | 'kind'>[] {
  const { grid, suppression: sup } = scenario
  const unit = sup.units[a.unit]
  const line = decision.lines[a.target]
  if (!line || line.length < 2 || !unit.lineMPerH) return []
  const width = unit.wetLineWidthM ?? 0
  const pieces: Omit<WetLine, 'slot' | 'kind'>[] = []
  let t = start
  let path: LonLat[] = [line[0]]
  let pieceT = start
  let pieceM = 0
  const close = () => {
    if (path.length >= 2 && pieceM > 0)
      pieces.push({ barrier: { path: path.map((q) => [q.lon, q.lat]), width_m: width, from_min: t }, lengthM: pieceM })
    path = [path[path.length - 1]]
    pieceT = t
    pieceM = 0
  }
  for (let s = 1; s < line.length; s++) {
    const from = line[s - 1]
    const to = line[s]
    const segM = distanceM(from, to)
    const steps = Math.max(1, Math.ceil(segM / (grid.cellsize / 2)))
    for (let q = 1; q <= steps; q++) {
      const p = lerpLonLat(from, to, q / steps)
      const mid = lerpLonLat(from, to, (q - 0.5) / steps)
      const { x, y } = toPTTM06(mid)
      const { col, row } = cellOfXY(grid, x, y)
      const inside = col >= 0 && row >= 0 && col < grid.cols && row < grid.rows
      const rate = inside ? (unit.lineMPerH[grid.fuelClass[row * grid.cols + col]] ?? 0) * a.count : 0 // m/h
      if (rate > 0) t += ((segM / steps) * 60) / rate
      pieceM += segM / steps
      if (t - pieceT >= LINE_PIECE_MIN) path.push(p), close()
      else if (q === steps) path.push(p)
    }
  }
  close()
  return pieces
}

/** Bearing the fire spreads towards at p in the free run: the gradient of its arrival, fitted by least
 *  squares over the reached cells around p. Where it is not reached (or flat), away from the ignition. */
export function spreadAt(scenario: Scenario, free: Float32Array, p: LonLat): number {
  const { grid, durationMin, ignition } = scenario
  const { x, y } = toPTTM06(p)
  const c0 = cellOfXY(grid, x, y)
  for (const span of FIT_CELLS) {
    let n = 0
    let sx = 0, sy = 0, st = 0, sxx = 0, syy = 0, sxy = 0, sxt = 0, syt = 0
    for (let r = c0.row - span; r <= c0.row + span; r++)
      for (let c = c0.col - span; c <= c0.col + span; c++) {
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
        const t = free[r * grid.cols + c]
        if (!(t <= durationMin)) continue
        const dx = c - c0.col // east
        const dy = c0.row - r // north: rows go south
        n++
        sx += dx; sy += dy; st += t
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxt += dx * t; syt += dy * t
      }
    if (n < 6) continue
    const cxx = sxx - (sx * sx) / n
    const cyy = syy - (sy * sy) / n
    const cxy = sxy - (sx * sy) / n
    const cxt = sxt - (sx * st) / n
    const cyt = syt - (sy * st) / n
    const det = cxx * cyy - cxy * cxy
    if (det <= 1e-9) continue
    const gx = (cxt * cyy - cyt * cxy) / det
    const gy = (cyt * cxx - cxt * cxy) / det
    if (Math.hypot(gx, gy) < 1e-6) continue
    return ((Math.atan2(gx, gy) * 180) / Math.PI + 360) % 360
  }
  return distanceM(ignition, p) > 1 ? bearingDeg(ignition, p) : 0
}

/** The cells a barrier touches, as the API counts them (api/fires.py `line`): the path buffered
 *  width/2 with flat ends and round joins, every cell whose square it touches. */
export function stripCells(grid: Grid, barrier: Barrier): number[] {
  const { cellsize: cs, xmin, ymin, rows, cols } = grid
  const pts = barrier.path.map(([lon, lat]) => toPTTM06({ lon, lat }))
  const half = barrier.width_m / 2
  const shapes: { poly?: { x: number; y: number }[]; disc?: { x: number; y: number; r: number } }[] = []
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s]
    const b = pts[s + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    const nx = (-(b.y - a.y) / len) * half
    const ny = ((b.x - a.x) / len) * half
    shapes.push({
      poly: half > 0 ? [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }] : [a, b],
    })
    if (half > 0 && s > 0) shapes.push({ disc: { x: a.x, y: a.y, r: half } })
  }
  if (!shapes.length) return []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) (x0 = Math.min(x0, p.x - half)), (x1 = Math.max(x1, p.x + half)), (y0 = Math.min(y0, p.y - half)), (y1 = Math.max(y1, p.y + half))
  const top = ymin + rows * cs
  const c0 = Math.max(Math.floor((x0 - xmin) / cs), 0)
  const c1 = Math.min(Math.floor((x1 - xmin) / cs), cols - 1)
  const r0 = Math.max(Math.floor((top - y1) / cs), 0)
  const r1 = Math.min(Math.floor((top - y0) / cs), rows - 1)
  const cells: number[] = []
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const bx0 = xmin + c * cs
      const by1 = top - r * cs
      const box = { x0: bx0, x1: bx0 + cs, y0: by1 - cs, y1: by1 }
      if (shapes.some((s) => (s.poly ? polyTouchesBox(s.poly, box) : discTouchesBox(s.disc!, box)))) cells.push(r * cols + c)
    }
  return cells
}

type Box = { x0: number; x1: number; y0: number; y1: number }

/** Separating axes: a convex polygon (or a segment) and an axis-aligned box touch unless one axis parts them. */
function polyTouchesBox(poly: { x: number; y: number }[], box: Box): boolean {
  let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity
  for (const p of poly) (px0 = Math.min(px0, p.x)), (px1 = Math.max(px1, p.x)), (py0 = Math.min(py0, p.y)), (py1 = Math.max(py1, p.y))
  if (px1 < box.x0 || px0 > box.x1 || py1 < box.y0 || py0 > box.y1) return false
  const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const nx = -(b.y - a.y)
    const ny = b.x - a.x
    if (nx === 0 && ny === 0) continue
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity
    for (const p of poly) {
      const d = p.x * nx + p.y * ny
      ;(p0 = Math.min(p0, d)), (p1 = Math.max(p1, d))
    }
    for (const q of corners) {
      const d = q.x * nx + q.y * ny
      ;(q0 = Math.min(q0, d)), (q1 = Math.max(q1, d))
    }
    if (p1 < q0 || q1 < p0) return false
  }
  return true
}

function discTouchesBox(d: { x: number; y: number; r: number }, box: Box): boolean {
  const x = Math.min(Math.max(d.x, box.x0), box.x1)
  const y = Math.min(Math.max(d.y, box.y0), box.y1)
  return Math.hypot(x - d.x, y - d.y) <= d.r
}
