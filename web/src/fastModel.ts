// The fast spread model, in the browser: the minute the fire reaches each cell of the 30 m grid
// is the shortest path from the ignition (Dijkstra), with the rate of spread from the fuel, the
// slope along each step and the wind as an ellipse. Not Rothermel: an answer in ~100 ms so the
// decisions A and B are compared live: the barriers of each one (wetLine.ts, the same input the
// engines get) hold from their minute, and aerial drops slow the fire where they fall
// (suppression.ts). The engines (engines/CONTRACT.md) remain the reference.

import { computeFWISeries, fwiAt, type FWIHourly } from './fwi'
import { toPTTM06, type LonLat } from './geo'
import { cellOf, cellOfXY, centerXY, type Grid } from './grid'
import { aerialFrontM, dropCycleMin, flameLengthM, intensityKWPerM, isAerial, type Decision } from './suppression'
import { burnedHa, type Run, type Scenario as BaseScenario } from './scenario'
import { arrivals, barriers, stripCells, type Barrier } from './wetLine'

/**
 * Rate of spread with no wind on flat ground (m/min) and fine fuel load (kg/m²), by Scott & Burgan
 * code. Starting points from the model descriptions (Scott & Burgan 2005), scaled so shrub under
 * the ~20 km/h wind of Vieira do Minho 2016 runs near the 875 m/h PT-FireSprd measured.
 */
const FUEL: Record<number, [number, number]> = {
  101: [1.5, 0.1],
  102: [2.5, 0.25],
  121: [1.8, 0.35],
  122: [2.2, 0.5],
  145: [2.4, 1.4],
  162: [1.0, 0.6],
  165: [1.0, 1.6],
  183: [0.3, 0.6],
  186: [0.6, 0.8],
  188: [0.7, 1.3],
}
/** The knobs of the model, in one place so they can be tuned from the console in dev (atalaia.params). */
export const params = {
  // The table is for moderate fuel moisture; a Minho afternoon in August with 25 % humidity burns
  // faster. 2.2 puts the free burn near the 705 ha PT-FireSprd measured at 5 h (743 ha; 90 ha at 1.0).
  fuelScale: 2.2,
  windGain: 0.18, // head ROS = ROS0 × (1 + windGain × wind in km/h)
  slopeDoubleDeg: 10, // ROS doubles every this many degrees uphill
  slopeDown: 1, // and is multiplied by this at the same angle downhill (1 = no slowing)
  slopeMin: 0.4,
  slopeMax: 4,
  // Fine fuels dry as the air does: ROS × exp(−rhGain × (RH − rhRef) / 100). rhRef is the afternoon
  // of Vieira do Minho 2016 (the calibration above); 2.5 halves the ROS from 30 % to 58 % RH.
  rhGain: 2.5,
  rhRef: 30,
  // Official Canadian Fire Weather Index (FWI / ISI) coupling (IPMA / ANEPC standard in Portugal).
  // ISI integrates Van Wagner fine fuel moisture desorption/adsorption and wind into head ROS.
  useFWI: true,
  isiRef: 11.2,
  fwiHeadBase: 4.6,
}

// 16 neighbours: the 8 around plus the knight moves, so the ellipse is sampled every ~22°.
const OFFSETS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1],
]
const K = OFFSETS.length
// Bearing of each step, degrees clockwise from north: columns go east, rows go south.
// A knight move passes through two cells on its way: a barrier in either stops it, as it would the engines.
const MID = OFFSETS.map(([dx, dy]) =>
  Math.abs(dx) === 2 ? [[Math.sign(dx), 0], [Math.sign(dx), dy]] : Math.abs(dy) === 2 ? [[0, Math.sign(dy)], [dx, Math.sign(dy)]] : [],
)
const BEARING = OFFSETS.map(([dx, dy]) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360)
const STEP = OFFSETS.map(([dx, dy]) => Math.hypot(dx, dy))

export { burnedHa, type Run }

interface Zone {
  factor: number
  holdFlameM: number
  windows: number[] // start, end, start, end… minutes while the units are on the fire
  // Units at a point hold a front that grows from the access point while they work; a line or
  // the drops along it have no centre (r0 = Infinity) and hold every cell of the zone.
  x: number
  y: number
  r0: number // metres held on arrival
  grow: number // metres more per minute of work
  reach: number // and never beyond this
  // Drops along a line go where the fire touches it: a stretch opens a window when the fire first
  // tries to enter it, if the aircraft have a drop to spare (the flight's windows are then made on the run).
  drops?: Drops
}

interface Drops {
  from: number // minute the aircraft are over the fire
  holdMin: number
  capacity: number // stretches a drop can keep slowed at any time: holdMin × aircraft / cycle
  zones: Zone[] // the stretches of the line, to count the active ones
}

/** ELMFIRE's scenario (scenario.ts), with the hourly FWI the fast model reads when it was computed once. */
export interface Scenario extends BaseScenario {
  fwiSeries?: FWIHourly[]
}

export function simulate(scenario: Scenario, decision: Decision | null): Run {
  const t0 = performance.now()
  const { grid, suppression: sup, durationMin } = scenario
  const { cols, rows, cellsize, fuelCode, slope, aspect, fuelClass } = grid
  const n = cols * rows

  const { ros0, load } = fuelTables()
  const { slopeMin, slopeMax } = params
  const upPerDeg = Math.LN2 / params.slopeDoubleDeg
  const downPerDeg = Math.log(params.slopeDown) / params.slopeDoubleDeg

  const fwiSeries = scenario.fwiSeries ?? computeFWISeries(scenario.weather)
  const minutes = durationMin + 1
  const windFactor = new Float32Array(minutes * K)
  for (let m = 0; m < minutes; m++) stepFactors(scenario, fwiSeries, m, windFactor, m * K)
  const cosUp = cosUpTable()

  // What the decision does to the ground: cells held by its barriers from their minute, cells slowed by
  // aerial drops. A cell can be in two zones (a point and a line, two points): the one holding with the lowest factor counts.
  const zoneOf = [new Int16Array(n).fill(-1), new Int16Array(n).fill(-1)]
  const lineAt = new Float32Array(n).fill(Infinity)
  const zones: Zone[] = decision ? apply(scenario, decision, zoneOf, lineAt) : []
  const lines = decision ? lineAt.some((t) => t < Infinity) : false
  const [zoneA, zoneB] = zoneOf

  const arrival = new Float32Array(n).fill(Infinity)
  const heap = new Heap()
  const start = cellOf(grid, scenario.ignition)
  if (start < 0) throw new Error('ignition outside the grid')
  arrival[start] = 0
  heap.push(0, start)

  while (heap.size) {
    const t = heap.topKey()
    const i = heap.pop()
    if (t > arrival[i] || t > durationMin) continue
    const col = i % cols
    const row = (i - col) / cols
    const m = Math.min(Math.floor(t), durationMin) * K
    // How fast the front moves here, normal to itself: the steepest rise of the arrival time from the
    // cells behind (the fastest path reaches a flank cell obliquely, at near the head's speed, but the
    // front there only widens at the flank's rate, and that is what the units face).
    let grad = 0
    for (let k = 0; k < K; k++) {
      const c = col + OFFSETS[k][0]
      const r = row + OFFSETS[k][1]
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      const back = arrival[r * cols + c]
      if (back < t) grad = Math.max(grad, (t - back) / (STEP[k] * cellsize))
    }
    const frontRos = grad > 0 ? 1 / grad : Infinity
    const rosHere = ros0[fuelCode[i]] || 1
    for (let k = 0; k < K; k++) {
      const c = col + OFFSETS[k][0]
      const r = row + OFFSETS[k][1]
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      const j = r * cols + c
      const code = fuelCode[j]
      let ros = ros0[code]
      if (ros === 0) continue
      const up = slope[j] * cosUp[aspect[j] * K + k]
      ros *= windFactor[m + k] * Math.min(slopeMax, Math.max(slopeMin, Math.exp((up >= 0 ? upPerDeg : -downPerDeg) * up)))
      let tj = t + (STEP[k] * cellsize) / ros
      if (lineAt[j] <= tj) continue // the barrier holds before the fire gets there
      if (zoneA[j] >= 0) {
        // The front arrives in j with the speed it has in i, scaled to j's fuel; at the ignition, the step's.
        const front = grad > 0 ? (frontRos * ros0[code]) / rosHere : ros
        const flame = flameLengthM(sup, intensityKWPerM(sup, load[code], front))
        let factor = 1
        for (const z of [zoneA[j], zoneB[j]])
          if (z >= 0 && flame <= zones[z].holdFlameM && zones[z].factor < factor && held(grid, zones[z], j, t)) factor = zones[z].factor
        if (factor < 1) {
          ros *= factor
          tj = t + (STEP[k] * cellsize) / ros
        }
      }
      if (lines) {
        if (lineAt[j] <= tj) continue
        let jumped = false
        for (const [mx, my] of MID[k]) if (lineAt[(row + my) * cols + col + mx] <= tj) jumped = true
        if (jumped) continue
      }
      if (tj < arrival[j]) {
        arrival[j] = tj
        heap.push(tj, j)
      }
    }
  }
  void fuelClass
  return { decision, arrival, durationMin, runtimeMs: performance.now() - t0 }
}

/**
 * Flame length (m, Byram) of a head fire running through each cell at minute `minute` after the
 * ignition, with nobody on it: the fastest of the 16 steps out of the cell, as simulate() takes
 * them, and the cell's fuel load. 0 where nothing burns. Read against the units' holdFlameM, it
 * says who can hold the front there (heatLayer.ts).
 */
export function headFlameM(scenario: Scenario, minute: number): Float32Array {
  const { grid, suppression: sup } = scenario
  const { fuelCode, slope, aspect } = grid
  const { ros0, load } = fuelTables()
  const { slopeMin, slopeMax } = params
  const upPerDeg = Math.LN2 / params.slopeDoubleDeg
  const downPerDeg = Math.log(params.slopeDown) / params.slopeDoubleDeg
  const factor = new Float32Array(K)
  stepFactors(scenario, scenario.fwiSeries ?? computeFWISeries(scenario.weather), minute, factor, 0)
  const cosUp = cosUpTable()

  const flame = new Float32Array(fuelCode.length)
  for (let i = 0; i < flame.length; i++) {
    const code = fuelCode[i]
    if (ros0[code] === 0) continue
    let ros = 0
    for (let k = 0; k < K; k++) {
      const up = slope[i] * cosUp[aspect[i] * K + k]
      const step = factor[k] * Math.min(slopeMax, Math.max(slopeMin, Math.exp((up >= 0 ? upPerDeg : -downPerDeg) * up)))
      if (step > ros) ros = step
    }
    flame[i] = flameLengthM(sup, intensityKWPerM(sup, load[code], ros0[code] * ros))
  }
  return flame
}

/** ROS with no wind on flat ground (m/min) and fine fuel load (kg/m²), by Scott & Burgan code, as flat tables for the inner loops. */
function fuelTables(): { ros0: Float32Array; load: Float32Array } {
  const ros0 = new Float32Array(256)
  const load = new Float32Array(256)
  for (const [code, [r, l]] of Object.entries(FUEL)) (ros0[+code] = r * params.fuelScale), (load[+code] = l)
  return { ros0, load }
}

/**
 * Weather factor of each step at minute `m`, into `out` from `at`: the head factor of the wind spread
 * over an ellipse (Canadian FBP length-to-breadth), times fuel drying via the Canadian FWI Initial
 * Spread Index (Van Wagner 1987), or the humidity of the hour without it.
 */
function stepFactors(scenario: Scenario, fwiSeries: FWIHourly[], m: number, out: Float32Array, at: number) {
  const { kmh, fromDeg, rh } = weatherAt(scenario, m)
  let head: number
  if (params.useFWI) {
    const fwi = fwiAt(fwiSeries, scenario.startIndex, m)
    head = (fwi.isi / params.isiRef) * params.fwiHeadBase
  } else {
    head = (1 + params.windGain * kmh) * Math.exp((-params.rhGain * (rh - params.rhRef)) / 100)
  }
  const lb = 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * kmh), 2.155)
  const e = Math.sqrt(1 - 1 / (lb * lb))
  const to = fromDeg + 180
  for (let k = 0; k < K; k++) {
    const cos = Math.cos(((BEARING[k] - to) * Math.PI) / 180)
    out[at + k] = (head * (1 - e)) / (1 - e * cos)
  }
}

/** Slope along a step: cos between the step and the uphill direction (aspect faces downhill), per aspect degree. */
function cosUpTable(): Float32Array {
  const cosUp = new Float32Array(360 * K)
  for (let a = 0; a < 360; a++)
    for (let k = 0; k < K; k++) cosUp[a * K + k] = Math.cos(((BEARING[k] - a - 180) * Math.PI) / 180)
  return cosUp
}

function weatherAt({ weather, startIndex }: Scenario, minute: number): { kmh: number; fromDeg: number; rh: number } {
  const h = startIndex + minute / 60
  const i = Math.min(Math.floor(h), weather.time.length - 1)
  const j = Math.min(i + 1, weather.time.length - 1)
  const f = h - Math.floor(h)
  const turn = ((((weather.windFromDeg[j] - weather.windFromDeg[i]) % 360) + 540) % 360) - 180
  return {
    kmh: weather.windKmh[i] + (weather.windKmh[j] - weather.windKmh[i]) * f,
    fromDeg: weather.windFromDeg[i] + turn * f,
    rh: weather.rhPct[i] + (weather.rhPct[j] - weather.rhPct[i]) * f,
  }
}

/** Whether the zone's units are on the fire at minute `t` and have reached cell `i` by then. */
function held(grid: Grid, zone: Zone, i: number, t: number): boolean {
  const w = zone.windows
  if (zone.drops && t >= zone.drops.from && (w.length === 0 || t >= w[w.length - 1])) {
    // The fire touches this stretch: a drop goes on it now if fewer than `capacity` are still fresh.
    const { zones, capacity, holdMin } = zone.drops
    let active = 0
    for (const z of zones) if (z.windows.length && z.windows[z.windows.length - 1] > t) active++
    if (active < capacity) w.push(t, t + holdMin)
  }
  let worked = 0
  for (let k = 0; k < w.length; k += 2) {
    if (t < w[k]) return false
    if (t < w[k + 1]) {
      if (zone.r0 === Infinity) return true
      const { x, y } = centerXY(grid, i)
      return Math.hypot(x - zone.x, y - zone.y) <= Math.min(zone.reach, zone.r0 + zone.grow * (worked + t - w[k]))
    }
    worked += w[k + 1] - w[k]
  }
  return false
}

const NO_CENTRE = { x: 0, y: 0, r0: Infinity, grow: 0, reach: Infinity }

/** The free run (no decision) a plan is laid against: ELMFIRE's forecast when there is one, as the
 *  editor and the API lay the barriers (scenario.ts), else the fast model's, simulated once. */
const freeRuns = new WeakMap<Scenario, Float32Array>()
export function freeArrival(scenario: Scenario): Float32Array {
  if (scenario.fireArrival) return scenario.fireArrival
  let free = freeRuns.get(scenario)
  if (!free) freeRuns.set(scenario, (free = simulate(scenario, null).arrival))
  return free
}

/** The decision's barriers, exactly as the scenario's `decision.barriers` (docs/contracts.md) takes them: those ELMFIRE gets. */
export function decisionBarriers(scenario: Scenario, decision: Decision): Barrier[] {
  return barriers(scenario, decision, freeArrival(scenario))
}

/** Turns the decision into held cells (its barriers, from their minute) and zones (aerial drops, with their windows). */
function apply(scenario: Scenario, decision: Decision, zoneOf: Int16Array[], lineAt: Float32Array): Zone[] {
  const { grid, suppression: sup, durationMin } = scenario
  for (const b of decisionBarriers(scenario, decision)) for (const cell of stripCells(grid, b)) lineAt[cell] = Math.min(lineAt[cell], b.from_min)

  const zones: Zone[] = []
  /** Puts cell `i` in zone `z`: a free slot, or the slot of a zone with a higher factor than this one. */
  const join = (i: number, z: number) => {
    const [a, b] = zoneOf
    if (a[i] < 0) a[i] = z
    else if (b[i] < 0) b[i] = z
    else {
      const worst = zones[a[i]].factor >= zones[b[i]].factor ? a : b
      if (zones[worst[i]].factor > zones[z].factor) worst[i] = z
    }
  }
  const eta = arrivals(scenario, decision)

  decision.assignments.forEach((a, slot) => {
    const unit = sup.units[a.unit]
    if (!isAerial(unit)) return // ground units are barriers (wetLine.ts)

    if (a.task === 'drops') {
      const line = decision.lines[a.target]
      if (!line?.length || !unit.dropM || !unit.holdMin) return
      // Drops go along the line in order, one every cycle per aircraft, and start over at the end:
      // each stretch of the line is a zone that holds while a drop is fresh on it.
      const cells = rasterise(grid, line)
      const perDrop = Math.max(1, Math.round(unit.dropM[0] / grid.cellsize))
      const stretches: number[][] = []
      for (let k = 0; k < cells.length; k += perDrop) stretches.push(cells.slice(k, k + perDrop))
      const zoneIds = stretches.map((stretch) => {
        const zone = zones.push({ factor: unit.rosFactor, holdFlameM: unit.holdFlameM, windows: [], ...NO_CENTRE }) - 1
        for (const i of stretch) join(i, zone)
        return zone
      })
      const interval = dropCycleMin(unit, sup.dispatch.waterPointKm) / Math.max(1, a.count)
      const drops: Drops = {
        from: eta[slot],
        holdMin: unit.holdMin,
        capacity: Math.max(1, Math.floor(unit.holdMin / interval)),
        zones: zoneIds.map((z) => zones[z]),
      }
      for (const zone of drops.zones) zone.drops = drops
      return
    }

    // Aircraft over a point: the drops keep a stretch of the front slowed for as long as they cycle to the water.
    const point = decision.points[a.target]
    if (!point) return
    const { x, y } = toPTTM06(point)
    const centre = cellOfXY(grid, x, y)
    if (centre.col < 0 || centre.row < 0 || centre.col >= grid.cols || centre.row >= grid.rows) return
    const reach = aerialFrontM(unit, a.count, sup.dispatch.waterPointKm) / 2
    if (reach <= 0 || eta[slot] >= durationMin) return
    const zone = zones.push({ factor: unit.rosFactor, holdFlameM: unit.holdFlameM, windows: [eta[slot], durationMin], x, y, r0: reach, grow: 0, reach }) - 1
    const span = Math.ceil(reach / grid.cellsize)
    for (let r = centre.row - span; r <= centre.row + span; r++)
      for (let c = centre.col - span; c <= centre.col + span; c++) {
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
        const i = r * grid.cols + c
        const at = centerXY(grid, i)
        if (Math.hypot(at.x - x, at.y - y) > reach) continue
        join(i, zone)
      }
  })
  return zones
}

/** Cells under a polyline, in order along it, each once. */
function rasterise(grid: Grid, line: LonLat[]): number[] {
  const cells: number[] = []
  const seen = new Set<number>()
  const pts = line.map(toPTTM06)
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s]
    const b = pts[s + 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.cellsize / 2)))
    for (let q = 0; q <= steps; q++) {
      const { col, row } = cellOfXY(grid, a.x + ((b.x - a.x) * q) / steps, a.y + ((b.y - a.y) * q) / steps)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
      const i = row * grid.cols + col
      if (!seen.has(i)) (seen.add(i), cells.push(i))
    }
  }
  return cells
}

/** Binary min-heap of (key, value) pairs; stale entries are skipped by the caller. */
class Heap {
  private keys: number[] = []
  private vals: number[] = []

  get size() {
    return this.keys.length
  }
  topKey() {
    return this.keys[0]
  }
  push(key: number, val: number) {
    const { keys, vals } = this
    let i = keys.length
    keys.push(key)
    vals.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = key
    vals[i] = val
  }
  pop(): number {
    const { keys, vals } = this
    const top = vals[0]
    const key = keys.pop()!
    const val = vals.pop()!
    const n = keys.length
    if (n === 0) return top
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && keys[c + 1] < keys[c]) c++
      if (keys[c] >= key) break
      keys[i] = keys[c]
      vals[i] = vals[c]
      i = c
    }
    keys[i] = key
    vals[i] = val
    return top
  }
}

export { computeFWISeries, fwiAt, type FWIHourly } from './fwi'
