// Deployment timing: approach interception and fire-shaped arrival boundaries for the selected station.

import type { NearStation, Station } from './data'
import type { Detection } from './detection'
import { distanceM, lerpLonLat, type LonLat } from './geo'
import { cellOf, lonLatAt, type Grid } from './grid'
import { arrivalMin, type Suppression, type UnitId, type UnitSpec } from './suppression'

/** How many stations are available for now, anywhere means come from; the rest of the map keeps its stations but none is used. */
export const STATIONS_IN_PLAY = 3
const MAX_KM = 65 // as the regional list was

/** The stations in play: the nearest to the ignition by the model's own travel time (straight line × road factor). */
export function stationsInPlay(stations: Station[], ignition: LonLat, sup: Suppression): NearStation[] {
  const vfci = sup.units.vfci
  return stations
    .map((s) => ({ ...s, km: distanceM(ignition, s) / 1000 }))
    .filter((s) => s.km <= MAX_KM)
    .sort((a, b) => arrivalMin(sup, vfci, a.km, true) - arrivalMin(sup, vfci, b.km, true))
    .slice(0, STATIONS_IN_PLAY)
}

export interface StationRing {
  station: NearStation
  arriveMin: number // T+ at the interception point, not at the ignition
  radiusM: number // minimum distance from the ignition on this station's approach
}

export interface Interception {
  point: LonLat
  arriveMin: number
}

/** First point the fire reaches before (or with) the approaching vehicle. Travel uses the same
 *  station-to-target road-factor estimate as arrivals(), sampled at half-cell intervals. */
export function approachIntercept(
  grid: Grid,
  arrival: ArrayLike<number>,
  origin: LonLat,
  target: LonLat,
  sup: Suppression,
  unit: UnitSpec,
  dispatchMin: number,
  ecin = true,
): Interception | undefined {
  const km = distanceM(origin, target) / 1000
  const steps = Math.max(1, Math.ceil(km * 1000 / (grid.cellsize / 2)))
  for (let k = 0; k <= steps; k++) {
    const fraction = k / steps
    const point = lerpLonLat(origin, target, fraction)
    const cell = cellOf(grid, point)
    const at = dispatchMin + arrivalMin(sup, unit, km * fraction, ecin)
    if (cell >= 0 && arrival[cell] <= at) return { point, arriveMin: at }
  }
  return undefined
}

/** One interception ring per station. No hose/working reach is added to this boundary. */
export function computeRings(
  grid: Grid,
  arrival: ArrayLike<number>,
  ignition: LonLat,
  stations: NearStation[],
  sup: Suppression,
  detection: Detection,
  dispatchMin = detection.droneMin,
): StationRing[] {
  return stations.map((station) => {
    const meet = approachIntercept(grid, arrival, station, ignition, sup, sup.units.vfci, dispatchMin)
    return {
      station,
      arriveMin: meet?.arriveMin ?? dispatchMin + arrivalMin(sup, sup.units.vfci, station.km, true),
      radiusM: meet ? distanceM(ignition, meet.point) : 0,
    }
  })
}

/** Where the fire arrives before this station's selected means, comparing times at EACH cell.
 *  This follows the fire's shape rather than extending a single approach radius in all directions. */
export function deploymentBoundary(
  grid: Grid, arrival: Float32Array, station: NearStation, sup: Suppression,
  unit: UnitSpec, dispatchMin: number, ecin = true,
): { blocked: Uint8Array; paths: LonLat[][] } {
  const blocked = new Uint8Array(grid.cols * grid.rows)
  const cells: number[] = []
  // Travel times do not change as the planning clock advances. Cache fire-minus-travel once,
  // rather than recomputing geodesic distances over the entire grid every simulated minute.
  let cached = boundaryTimes.get(arrival)
  if (!cached || cached.grid !== grid) {
    cached = { grid, selections: new Map() }
    boundaryTimes.set(arrival, cached)
  }
  const key = `${station.lon}|${station.lat}|${unit.speedKmh}|${sup.dispatch.roadFactor}|${arrivalMin(sup, unit, 0, ecin)}`
  let times = cached.selections.get(key)
  if (!times) {
    const indices: number[] = [], limits: number[] = []
    for (let i = 0; i < arrival.length; i++) {
      if (!Number.isFinite(arrival[i])) continue
      const p = lonLatAt(grid, i % grid.cols + .5, Math.floor(i / grid.cols) + .5)
      indices.push(i)
      limits.push(arrival[i] - arrivalMin(sup, unit, distanceM(station, p) / 1000, ecin))
    }
    times = { indices, limits }
    cached.selections.set(key, times)
  }
  for (let k = 0; k < times.indices.length; k++)
    if (times.limits[k] <= dispatchMin) { const i = times.indices[k]; blocked[i] = 1; cells.push(i) }
  const stride = grid.cols + 1
  const edges = new Map<number, number[]>()
  const edge = (from: number, to: number) => edges.set(from, [...(edges.get(from) ?? []), to])
  for (const i of cells) {
    const x = i % grid.cols, y = Math.floor(i / grid.cols)
    const a = y * stride + x, b = a + 1, c = b + stride, d = a + stride
    if (y === 0 || !blocked[i - grid.cols]) edge(a, b)
    if (x === grid.cols - 1 || !blocked[i + 1]) edge(b, c)
    if (y === grid.rows - 1 || !blocked[i + grid.cols]) edge(c, d)
    if (x === 0 || !blocked[i - 1]) edge(d, a)
  }
  const direction = (a: number, b: number) => b - a === 1 ? 0 : b - a === stride ? 1 : b - a === -1 ? 2 : 3
  const paths: LonLat[][] = []
  while (edges.size) {
    const first = edges.keys().next().value!
    const vertices = [first]
    let at = first, heading = 0
    do {
      const next = edges.get(at)
      if (!next?.length) break
      // At diagonally touching cells keep each outline on its own side (right turn first).
      const turn = (to: number) => [1, 0, 3, 2].indexOf((direction(at, to) - heading + 4) % 4)
      next.sort((a, b) => turn(a) - turn(b))
      const to = next.shift()!
      if (!next.length) edges.delete(at)
      heading = direction(at, to)
      vertices.push(to)
      at = to
    } while (at !== first)
    if (at !== first || vertices.length < 5) continue
    const corners = vertices.filter((v, i) => i === 0 || i === vertices.length - 1 || direction(vertices[i - 1], v) !== direction(v, vertices[i + 1]))
    paths.push(corners.map((v) => lonLatAt(grid, v % stride, Math.floor(v / stride))))
  }
  return { blocked, paths }
}

const boundaryTimes = new WeakMap<Float32Array, {
  grid: Grid
  selections: Map<string, { indices: number[]; limits: number[] }>
}>()

export interface DeploymentSelection {
  from: string
  unit: UnitId
  dispatchMin: number
  ecin: boolean
}
