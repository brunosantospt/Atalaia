// What a decision puts on the ground for the fire engines: barriers, in exactly the shape of the
// scenario's `decision.barriers` (docs/contracts.md): a path, a width and the minute from which
// nothing burns in the cells the strip touches (fuel 91). Ground units at a point lay a wet line
// across the local spread, centred on their access point, as long and wide as their kind
// (suppression.json); a crew line is laid in pieces as it is dug. The fast model (fastModel.ts)
// applies these same barriers, so the preview and an ELMFIRE run see the same input. Aerial
// units are not barriers: their drops only slow the fire for a while, and the contract has no
// end minute. Pure: no DOM and no fastModel at run time, so it runs in the ILS worker too.

import { findAirBase } from './airBases'
import type { Scenario } from './fastModel'
import { bearingDeg, destination, distanceM, lerpLonLat, toPTTM06, type LonLat } from './geo'
import { cellOfXY, type Grid } from './grid'
import { arrivalMin, isAerial, type Assignment, type Decision } from './suppression'

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
}

const LINE_PIECE_MIN = 30 // a crew line holds piece by piece, each one this much work
const FIT_CELLS = [5, 8] // spread from the free run: least squares over the reached cells this many around (150 m; 240 m if too few)

/** Minutes from the call until each assignment is at work, as the fast model counts them: the
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
    return arrivalMin(sup, unit, km, ecin)
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
  return out
}

/** Just the barriers, for `decision.barriers` of the scenario sent to the API. */
export function barriers(scenario: Scenario, decision: Decision, free: Float32Array): Barrier[] {
  return wetLines(scenario, decision, free).map((w) => w.barrier)
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
