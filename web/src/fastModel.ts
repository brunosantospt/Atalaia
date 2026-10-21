// The fast spread model, in the browser: the minute the fire reaches each cell of the 30 m grid
// is the shortest path from the ignition (Dijkstra), with the rate of spread from the fuel, the
// slope along each step and the wind as an ellipse. Not Rothermel: an answer in ~100 ms so the
// decisions A and B are compared live, each one slowing the fire where its units work
// (suppression.ts). The engines (engines/CONTRACT.md) remain the reference.

import type { Station, Weather } from './data'
import { computeFWISeries, fwiAt, type FWIHourly } from './fwi'
import { distanceM, toPTTM06, type LonLat } from './geo'
import { findAirBase } from './airBases'
import { cellHa, cellOf, cellOfXY, centerXY, type Grid } from './grid'
import {
  aerialFrontM,
  arrivalMin,
  attackMPerH,
  dropCycleMin,
  dutyCycle,
  flameLengthM,
  intensityKWPerM,
  isAerial,
  refillMin,
  workMin,
  type Assignment,
  type Decision,
  type Suppression,
} from './suppression'

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
const BEARING = OFFSETS.map(([dx, dy]) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360)
const STEP = OFFSETS.map(([dx, dy]) => Math.hypot(dx, dy))

export interface Run {
  decision: Decision | null
  arrival: Float32Array // minute the fire reaches each cell, Infinity if never within the duration
  durationMin: number
  runtimeMs: number
}

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

export interface Scenario {
  grid: Grid
  weather: Weather
  startIndex: number // entry of weather.time at the ignition
  ignition: LonLat
  stations: Station[]
  suppression: Suppression
  durationMin: number
  fwiSeries?: FWIHourly[]
}

export function simulate(scenario: Scenario, decision: Decision | null): Run {
  const t0 = performance.now()
  const { grid, suppression: sup, durationMin } = scenario
  const { cols, rows, cellsize, fuelCode, slope, aspect, fuelClass } = grid
  const n = cols * rows

  // ROS and load by code, as flat tables for the inner loop.
  const ros0 = new Float32Array(256)
  const load = new Float32Array(256)
  for (const [code, [r, l]] of Object.entries(FUEL)) (ros0[+code] = r * params.fuelScale), (load[+code] = l)
  const { windGain, slopeMin, slopeMax } = params
  const upPerDeg = Math.LN2 / params.slopeDoubleDeg
  const downPerDeg = Math.log(params.slopeDown) / params.slopeDoubleDeg

  // Weather factor per minute and step: the head factor of the wind spread over an ellipse (Canadian
  // FBP length-to-breadth), times the drying of the fuel with the humidity of the hour.
  // Weather factor per minute and step: the head factor of the wind spread over an ellipse (Canadian
  // FBP length-to-breadth), times fuel drying via Canadian FWI Initial Spread Index (Van Wagner 1987).
  const fwiSeries = scenario.fwiSeries ?? computeFWISeries(scenario.weather)
  const minutes = durationMin + 1
  const windFactor = new Float32Array(minutes * K)
  for (let m = 0; m < minutes; m++) {
    const { kmh, fromDeg, rh } = weatherAt(scenario, m)
    let head: number
    if (params.useFWI) {
      const fwi = fwiAt(fwiSeries, scenario.startIndex, m)
      head = (fwi.isi / params.isiRef) * params.fwiHeadBase
    } else {
      head = (1 + windGain * kmh) * Math.exp((-params.rhGain * (rh - params.rhRef)) / 100)
    }
    const lb = 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * kmh), 2.155)
    const e = Math.sqrt(1 - 1 / (lb * lb))
    const to = fromDeg + 180
    for (let k = 0; k < K; k++) {
      const cos = Math.cos(((BEARING[k] - to) * Math.PI) / 180)
      windFactor[m * K + k] = (head * (1 - e)) / (1 - e * cos)
    }
  }
  // Slope along a step: cos between the step and the uphill direction (aspect faces downhill), per aspect degree.
  const cosUp = new Float32Array(360 * K)
  for (let a = 0; a < 360; a++)
    for (let k = 0; k < K; k++) cosUp[a * K + k] = Math.cos(((BEARING[k] - a - 180) * Math.PI) / 180)

  // What the decision does to the ground: cells slowed by units at a point, cells held by a line.
  // A cell can be in two zones (a point and a line, two points): the one holding with the lowest factor counts.
  const zoneOf = [new Int16Array(n).fill(-1), new Int16Array(n).fill(-1)]
  const lineAt = new Float32Array(n).fill(Infinity)
  const zones: Zone[] = decision ? apply(scenario, decision, zoneOf, lineAt) : []
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
      if (lineAt[j] <= tj) continue // the line is built before the fire gets there
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
      if (tj < arrival[j]) {
        arrival[j] = tj
        heap.push(tj, j)
      }
    }
  }
  void fuelClass
  return { decision, arrival, durationMin, runtimeMs: performance.now() - t0 }
}

/** Hectares reached by minute `t`. */
export function burnedHa(grid: Grid, run: Run, t: number): number {
  let cells = 0
  for (let i = 0; i < run.arrival.length; i++) if (run.arrival[i] <= t) cells++
  return cells * cellHa(grid)
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

/** Turns the assignments into zones (units at a point, with their work and refill cycles) and held lines. */
function apply(scenario: Scenario, decision: Decision, zoneOf: Int16Array[], lineAt: Float32Array): Zone[] {
  const { grid, stations, suppression: sup, durationMin } = scenario
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
  const ecinUsed = new Set<string>() // the first ground crew of a station is its ECIN, out in 2 min
  // A tanker shuttling water to a point spares the units there the trip to the water point.
  const shuttled = new Set(decision.assignments.filter((a) => a.task === 'shuttle').map((a) => a.target))

  for (const a of decision.assignments) {
    const unit = sup.units[a.unit]
    const station = stations.find((s) => s.id === a.from)
    const ground = unit.turnoutMin === undefined
    const ecin = ground && !ecinUsed.has(a.from)
    if (ground) ecinUsed.add(a.from)
    if (a.task === 'shuttle') continue

    if (a.task === 'line') {
      const schedule = lineSchedule(scenario, decision, a, ecin)
      if (!schedule) continue
      schedule.cells.forEach((cell, k) => (lineAt[cell] = Math.min(lineAt[cell], schedule.at[k])))
      continue
    }

    if (a.task === 'drops') {
      const line = decision.lines[a.target]
      if (!line?.length || !isAerial(unit) || !unit.dropM || !unit.holdMin) continue
      // Drops go along the line in order, one every cycle per aircraft, and start over at the end:
      // each stretch of the line is a zone that holds while a drop is fresh on it.
      const cells = rasterise(grid, line)
      const perDrop = Math.max(1, Math.round(unit.dropM[0] / grid.cellsize))
      const stretches: number[][] = []
      for (let k = 0; k < cells.length; k += perDrop) stretches.push(cells.slice(k, k + perDrop))
      const zoneIds = stretches.map(
        (stretch) => {
          const zone = zones.push({ factor: unit.rosFactor, holdFlameM: unit.holdFlameM, windows: [], ...NO_CENTRE }) - 1
          for (const i of stretch) join(i, zone)
          return zone
        },
      )
      const base = findAirBase(a.from)
      const airKm = base && line?.length ? distanceM(base, line[0]) / 1000 : sup.dispatch.airBaseKm
      const interval = dropCycleMin(unit, sup.dispatch.waterPointKm) / Math.max(1, a.count)
      const drops: Drops = {
        from: arrivalMin(sup, unit, airKm, false),
        holdMin: unit.holdMin,
        capacity: Math.max(1, Math.floor(unit.holdMin / interval)),
        zones: zoneIds.map((z) => zones[z]),
      }
      for (const zone of drops.zones) zone.drops = drops
      continue
    }

    // Units at a point: a front held from the access point, growing while they work.
    const point = decision.points[a.target]
    if (!point) continue
    const { x, y } = toPTTM06(point)
    const centre = cellOfXY(grid, x, y)
    if (centre.col < 0 || centre.row < 0 || centre.col >= grid.cols || centre.row >= grid.rows) continue
    const base = isAerial(unit) ? findAirBase(a.from) : undefined
    const km = isAerial(unit)
      ? (base ? distanceM(base, point) / 1000 : sup.dispatch.airBaseKm)
      : (station ? distanceM(station, point) / 1000 : sup.dispatch.airBaseKm)
    const arrive = arrivalMin(sup, unit, km, ecin)
    const waterKm = shuttled.has(a.target) ? 0 : sup.dispatch.waterPointKm
    const windows: number[] = []
    let r0: number
    let grow: number
    let reach: number
    if (isAerial(unit)) {
      // The drops keep a stretch of the front slowed for as long as the aircraft cycles to the water.
      r0 = aerialFrontM(unit, a.count, sup.dispatch.waterPointKm) / 2
      grow = 0
      reach = r0
      windows.push(arrive, durationMin)
    } else {
      const work = workMin(unit)
      const refill = refillMin(unit, waterKm)
      const relay = a.count > 1 || refill === 0 // two or more take turns to refill, so the front stays manned
      if (relay) windows.push(arrive, durationMin)
      else for (let t = arrive; t < durationMin; t += work + refill) windows.push(t, Math.min(t + work, durationMin))
      r0 = unit.radiusM * Math.sqrt(a.count)
      const fuelClass = grid.fuelClass[centre.row * grid.cols + centre.col]
      // In 'protect' task, units hold a stationary defensive perimeter around structures/villages (grow = 0, reach = r0)
      // In 'direct' attack, units advance offensively along the fireline into the brush (grow = attackMPerH, reach = reachM)
      grow =
        a.task === 'protect'
          ? 0
          : (attackMPerH(unit, fuelClass) * a.count * (relay ? dutyCycle(unit, waterKm) : 1)) / 60
      reach = a.task === 'protect' ? r0 : (unit.reachM ?? r0)
    }
    if (windows.length === 0 || r0 <= 0) continue
    const zone = zones.push({ factor: unit.rosFactor, holdFlameM: unit.holdFlameM, windows, x, y, r0, grow, reach }) - 1

    const span = Math.ceil(reach / grid.cellsize)
    for (let r = centre.row - span; r <= centre.row + span; r++)
      for (let c = centre.col - span; c <= centre.col + span; c++) {
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
        const i = r * grid.cols + c
        const at = centerXY(grid, i)
        if (Math.hypot(at.x - x, at.y - y) > reach) continue
        join(i, zone)
      }
  }
  return zones
}

/** A line crew's schedule: the cells of its line in order and the minute each is built, from its arrival. */
export function lineSchedule(
  scenario: Scenario,
  decision: Decision,
  a: Assignment,
  ecin = false,
): { cells: number[]; at: number[] } | undefined {
  const { grid, stations, suppression: sup } = scenario
  const unit = sup.units[a.unit]
  const line = decision.lines[a.target]
  if (!line?.length || !unit.lineMPerH) return undefined
  const base = isAerial(unit) ? findAirBase(a.from) : undefined
  const station = !base ? stations.find((s) => s.id === a.from) : undefined
  const km = base ? distanceM(base, line[0]) / 1000 : station ? distanceM(station, line[0]) / 1000 : sup.dispatch.airBaseKm
  let t = arrivalMin(sup, unit, km, ecin)
  const cells = rasterise(grid, line)
  const at = cells.map((cell) => {
    const rate = (unit.lineMPerH![grid.fuelClass[cell]] * a.count) / 60 // m/min
    if (rate > 0) t += grid.cellsize / rate
    else t = Infinity
    return t
  })
  return { cells, at }
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
