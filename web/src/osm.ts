// The OpenStreetMap context of a fire (scripts/build_osm.py → public/fires/<id>/osm.json):
// roads, buildings, places and water. Laid over the fire's 30 m grid once per fire, it gives
// the decision editor its real access points (a unit stands on a road, not in the bush) and
// the 6 h report its homes, villages and roads reached.

import { distanceM, toPTTM06, type LonLat } from './geo'
import { cellOfXY, type Grid } from './grid'

export type RoadClass = 'paved' | 'track' | 'path'

export interface Road {
  id: number
  cls: RoadClass
  hw: string // the OSM highway value
  name?: string
  ref?: string
  pts: [number, number][] // lon, lat
}

export interface Place extends LonLat {
  name: string
  kind: string // village, hamlet, locality…
}

export interface Water {
  kind: string // river, stream, canal, lake, reservoir
  name?: string
  pts: [number, number][]
}

export interface Osm {
  source: Record<string, string>
  roads: Road[]
  buildings: [number, number, number][] // lon, lat, 1 when a home
  places: Place[]
  water: Water[]
}

/** A spot on a road where a unit can stand, sampled along every road. */
export interface Access extends LonLat {
  road: number // index in osm.roads
}

/** The cells a road crosses and the metres of it in each. */
export interface RoadCells {
  road: number
  cells: Int32Array
  metres: Float32Array
}

export interface Context {
  osm: Osm
  homes: Uint16Array // homes per cell
  buildings: Uint16Array // all buildings per cell
  placeCells: Int32Array[] // cells within PLACE_RADIUS_M of each place
  roadCells: RoadCells[]
  access: Access[]
}

const ACCESS_STEP_M = 80
const PLACE_RADIUS_M = 250
export const ROAD_CLASS_NAME: Record<RoadClass, string> = { paved: 'estrada', track: 'caminho de terra', path: 'trilho' }

export async function loadOsm(id: string): Promise<Osm | null> {
  const response = await fetch(`/fires/${id}/osm.json`)
  if (!response.ok) return null
  return response.json() as Promise<Osm>
}

export function buildContext(grid: Grid, osm: Osm): Context {
  const n = grid.cols * grid.rows
  const homes = new Uint16Array(n)
  const buildings = new Uint16Array(n)
  for (const [lon, lat, home] of osm.buildings) {
    const i = cellIndex(grid, { lon, lat })
    if (i < 0) continue
    buildings[i]++
    if (home) homes[i]++
  }
  const placeCells = osm.places.map((p) => cellsWithin(grid, p, PLACE_RADIUS_M))
  const roadCells: RoadCells[] = []
  const access: Access[] = []
  osm.roads.forEach((road, r) => {
    const { cells, metres } = rasteriseLine(grid, road.pts)
    if (cells.length) roadCells.push({ road: r, cells: Int32Array.from(cells), metres: Float32Array.from(metres) })
    for (const p of sampleLine(road.pts, ACCESS_STEP_M)) if (cellIndex(grid, p) >= 0) access.push({ ...p, road: r })
  })
  return { osm, homes, buildings, placeCells, roadCells, access }
}

/** The nearest access point on a road within `maxM` of `p`, if any. */
export function snapToRoad(context: Context, p: LonLat, maxM = 400): Access | undefined {
  let best: Access | undefined
  let bestM = maxM
  for (const a of context.access) {
    const m = distanceM(p, a)
    if (m < bestM) (bestM = m), (best = a)
  }
  return best
}

/** How a road is called on screen: its name, its reference, or what it is. */
export function roadLabel(road: Road): string {
  return road.name ?? road.ref ?? ROAD_CLASS_NAME[road.cls]
}

function cellIndex(grid: Grid, p: LonLat): number {
  const { x, y } = toPTTM06(p)
  const { col, row } = cellOfXY(grid, x, y)
  return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col
}

function cellsWithin(grid: Grid, p: LonLat, radiusM: number): Int32Array {
  const { x, y } = toPTTM06(p)
  const centre = cellOfXY(grid, x, y)
  const span = Math.ceil(radiusM / grid.cellsize)
  const cells: number[] = []
  for (let r = centre.row - span; r <= centre.row + span; r++)
    for (let c = centre.col - span; c <= centre.col + span; c++) {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      const cx = grid.xmin + (c + 0.5) * grid.cellsize
      const cy = grid.ymin + (grid.rows - r - 0.5) * grid.cellsize
      if (Math.hypot(cx - x, cy - y) <= radiusM) cells.push(r * grid.cols + c)
    }
  return Int32Array.from(cells)
}

/** Metres of a polyline in each cell it crosses, walking it in small steps. */
function rasteriseLine(grid: Grid, pts: [number, number][]): { cells: number[]; metres: number[] } {
  const cells: number[] = []
  const metres: number[] = []
  const index = new Map<number, number>()
  const xy = pts.map(([lon, lat]) => toPTTM06({ lon, lat }))
  const step = grid.cellsize / 3
  for (let s = 0; s + 1 < xy.length; s++) {
    const a = xy[s]
    const b = xy[s + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(length / step))
    const each = length / steps
    for (let q = 0; q < steps; q++) {
      const t = (q + 0.5) / steps
      const { col, row } = cellOfXY(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
      const i = row * grid.cols + col
      let k = index.get(i)
      if (k === undefined) (k = cells.length), index.set(i, k), cells.push(i), metres.push(0)
      metres[k] += each
    }
  }
  return { cells, metres }
}

/** Points every `stepM` along a polyline, the first vertex included. */
function sampleLine(pts: [number, number][], stepM: number): LonLat[] {
  const out: LonLat[] = []
  let carry = 0
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = { lon: pts[s][0], lat: pts[s][1] }
    const b = { lon: pts[s + 1][0], lat: pts[s + 1][1] }
    const length = distanceM(a, b)
    if (s === 0) out.push(a)
    let d = stepM - carry
    while (d < length) {
      const t = d / length
      out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
      d += stepM
    }
    carry = length - (d - stepM)
  }
  return out
}
