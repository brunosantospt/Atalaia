// Dynamic Road Routing avoiding the active wildfire perimeter.
// Uses the OpenStreetMap road network (osm.roads) and tests each road segment
// against the fire arrival grid (scenario.ts). Edges crossing cells where the fire
// has arrived (arrival <= currentMinutes) are cut, and Dijkstra finds the safe detour.

import { distanceM, type LonLat } from './geo'
import { cellOf, type Grid } from './grid'
import type { Road } from './osm'

export interface RouteResult {
  /** The sequence of geographic coordinates forming the safe driving path. */
  path: LonLat[]
  /** Total route length in kilometers. */
  distanceKm: number
  /** True if the route had to detour around fire-affected roads. */
  isDetour: boolean
  /** Number of road segments blocked by the active fire. */
  blockedRoadsCount: number
  /** Direct distance in km between origin and destination. */
  directDistKm: number
}

interface Edge {
  target: number
  distM: number
  cells: number[]
  pts: LonLat[]
}

interface Node {
  id: number
  lon: number
  lat: number
  edges: Edge[]
}

/** Binary min-heap: route search must not re-sort the entire frontier at every junction. */
class RouteQueue {
  private values: [number, number][] = []
  get size() { return this.values.length }
  push(value: [number, number]) {
    let i = this.values.length
    this.values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.values[parent][0] <= value[0]) break
      this.values[i] = this.values[parent]
      i = parent
    }
    this.values[i] = value
  }
  pop(): [number, number] {
    const first = this.values[0]
    const last = this.values.pop()!
    if (!this.values.length) return first
    let i = 0
    while (2 * i + 1 < this.values.length) {
      let child = 2 * i + 1
      if (child + 1 < this.values.length && this.values[child + 1][0] < this.values[child][0]) child++
      if (last[0] <= this.values[child][0]) break
      this.values[i] = this.values[child]
      i = child
    }
    this.values[i] = last
    return first
  }
}

export interface RoadGraph {
  nodes: Node[]
  spatialBuckets: Map<string, number[]>
}

const TOLERANCE_M = 35
const BUCKET_LON = 0.00045 // ~33m at lat 41.5N
const BUCKET_LAT = 0.00035 // ~39m

function bucketKey(lon: number, lat: number): string {
  const bx = Math.floor(lon / BUCKET_LON)
  const by = Math.floor(lat / BUCKET_LAT)
  return `${bx},${by}`
}

const graphCache = new WeakMap<Road[], { grid: Grid; graph: RoadGraph }>()

/**
 * Builds and caches a routable topological graph from OSM road polylines.
 * Intersections within TOLERANCE_M are snapped to single nodes.
 */
export function getOrCreateRoadGraph(grid: Grid, roads: Road[]): RoadGraph {
  const cached = graphCache.get(roads)
  if (cached?.grid === grid) return cached.graph

  const nodes: Node[] = []
  const spatialBuckets = new Map<string, number[]>()

  function findOrCreateNode(lon: number, lat: number): number {
    const bx = Math.floor(lon / BUCKET_LON)
    const by = Math.floor(lat / BUCKET_LAT)
    const p: LonLat = { lon, lat }

    // Check 9 neighboring spatial buckets
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${bx + dx},${by + dy}`
        const bucket = spatialBuckets.get(key)
        if (!bucket) continue
        for (const candidateId of bucket) {
          const node = nodes[candidateId]
          if (distanceM(p, node) <= TOLERANCE_M) {
            return candidateId
          }
        }
      }
    }

    const id = nodes.length
    nodes.push({ id, lon, lat, edges: [] })
    const key = bucketKey(lon, lat)
    const b = spatialBuckets.get(key)
    if (b) b.push(id)
    else spatialBuckets.set(key, [id])
    return id
  }

  for (const road of roads) {
    const pts = road.pts
    if (pts.length < 2) continue

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const u = findOrCreateNode(p1[0], p1[1])
      const v = findOrCreateNode(p2[0], p2[1])
      if (u === v) continue

      const dist = distanceM({ lon: p1[0], lat: p1[1] }, { lon: p2[0], lat: p2[1] })

      // Sample segment at ~30m steps to find all grid cells intersected
      const cells: number[] = []
      const steps = Math.max(1, Math.ceil(dist / 30))
      for (let s = 0; s <= steps; s++) {
        const frac = s / steps
        const samplePoint: LonLat = {
          lon: p1[0] + frac * (p2[0] - p1[0]),
          lat: p1[1] + frac * (p2[1] - p1[1]),
        }
        const cell = cellOf(grid, samplePoint)
        if (cell >= 0 && !cells.includes(cell)) {
          cells.push(cell)
        }
      }

      const forwardPts: LonLat[] = [{ lon: p1[0], lat: p1[1] }, { lon: p2[0], lat: p2[1] }]
      const reversePts: LonLat[] = [{ lon: p2[0], lat: p2[1] }, { lon: p1[0], lat: p1[1] }]

      nodes[u].edges.push({ target: v, distM: dist, cells, pts: forwardPts })
      nodes[v].edges.push({ target: u, distM: dist, cells, pts: reversePts })
    }
  }

  const graph: RoadGraph = { nodes, spatialBuckets }
  graphCache.set(roads, { grid, graph })
  return graph
}

/**
 * Finds the nearest graph node to a geographic coordinate.
 */
function findNearestNode(graph: RoadGraph, point: LonLat): { nodeId: number; distM: number } {
  const { nodes } = graph
  let bestId = 0
  let bestDist = Infinity

  const bx = Math.floor(point.lon / BUCKET_LON)
  const by = Math.floor(point.lat / BUCKET_LAT)

  // Expand search radius in bucket steps
  for (let radius = 0; radius <= 20; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const bucket = graph.spatialBuckets.get(`${bx + dx},${by + dy}`)
        if (!bucket) continue
        for (const id of bucket) {
          const d = distanceM(point, nodes[id])
          if (d < bestDist) {
            bestDist = d
            bestId = id
          }
        }
      }
    }
    if (bestDist < Infinity && bestDist < radius * 35) break
  }

  if (bestDist === Infinity) {
    // Fallback: full linear scan
    for (let i = 0; i < nodes.length; i++) {
      const d = distanceM(point, nodes[i])
      if (d < bestDist) {
        bestDist = d
        bestId = i
      }
    }
  }

  return { nodeId: bestId, distM: bestDist }
}

/**
 * Computes a safe driving route along OSM roads from origin to destination,
 * dynamically detouring around roads cut by the wildfire at currentMinutes.
 */
function calculateSafeRoute(
  grid: Grid,
  roads: Road[],
  arrival: Float32Array | undefined,
  currentMinutes: number,
  origin: LonLat,
  destination: LonLat,
): RouteResult | null {
  // 1. Check if destination itself is actively burning or already burned
  if (arrival) {
    const destCell = cellOf(grid, destination)
    if (destCell >= 0 && arrival[destCell] <= currentMinutes) {
      return null
    }
  }

  const directDist = distanceM(origin, destination)
  const graph = getOrCreateRoadGraph(grid, roads)
  if (graph.nodes.length === 0) {
    return {
      path: [origin, destination],
      distanceKm: directDist / 1000,
      isDetour: false,
      blockedRoadsCount: 0,
      directDistKm: directDist / 1000,
    }
  }

  const start = findNearestNode(graph, origin)
  const end = findNearestNode(graph, destination)

  if (start.nodeId === end.nodeId) {
    return {
      path: [origin, destination],
      distanceKm: directDist / 1000,
      isDetour: false,
      blockedRoadsCount: 0,
      directDistKm: directDist / 1000,
    }
  }

  // 2. Count blocked road segments for statistics & avoidance
  let blockedCount = 0

  // 3. Dijkstra on unblocked edges
  const dist = new Float64Array(graph.nodes.length).fill(Infinity)
  const prevNode = new Int32Array(graph.nodes.length).fill(-1)
  const prevEdgePts: LonLat[][] = new Array(graph.nodes.length)

  dist[start.nodeId] = 0

  // Priority queue: [cost, nodeId]
  const pq = new RouteQueue()
  pq.push([0, start.nodeId])

  while (pq.size > 0) {
    const [d, u] = pq.pop()

    if (d > dist[u]) continue
    if (u === end.nodeId) break

    for (const edge of graph.nodes[u].edges) {
      // Check if edge is cut by active fire
      let isCut = false
      if (arrival) {
        for (let i = 0; i < edge.cells.length; i++) {
          const c = edge.cells[i]
          if (c >= 0 && arrival[c] <= currentMinutes) {
            isCut = true
            blockedCount++
            break
          }
        }
      }

      if (isCut) continue // Dynamic fire avoidance!

      const alt = d + edge.distM
      if (alt < dist[edge.target]) {
        dist[edge.target] = alt
        prevNode[edge.target] = u
        prevEdgePts[edge.target] = edge.pts
        pq.push([alt, edge.target])
      }
    }
  }

  if (dist[end.nodeId] === Infinity) {
    // All road corridors to destination are severed by fire front
    return null
  }

  // 4. Reconstruct path following detailed road geometries
  const segments: LonLat[][] = []
  let curr = end.nodeId
  while (curr !== -1 && curr !== start.nodeId) {
    const pts = prevEdgePts[curr]
    if (pts) segments.push(pts)
    curr = prevNode[curr]
  }
  segments.reverse()

  const path: LonLat[] = [origin]
  for (const seg of segments) {
    for (let k = 0; k < seg.length; k++) {
      const pt = seg[k]
      const last = path[path.length - 1]
      if (Math.abs(last.lon - pt.lon) > 1e-7 || Math.abs(last.lat - pt.lat) > 1e-7) {
        path.push(pt)
      }
    }
  }
  path.push(destination)

  const totalKm = (dist[end.nodeId] + start.distM + end.distM) / 1000
  const directDistKm = directDist / 1000
  const isDetour = totalKm > directDistKm * 1.35 || blockedCount > 0

  return {
    path,
    distanceKm: totalKm,
    isDetour,
    blockedRoadsCount: blockedCount,
    directDistKm,
  }
}

const routeCache = new WeakMap<Road[], {
  grid: Grid; arrival: Float32Array | undefined; minute: number
  queries: Map<string, RouteResult | null>
}>()

/** Share the route between list badges and map drawing; without a fire field, time is irrelevant. */
export function findSafeRoute(
  grid: Grid, roads: Road[], arrival: Float32Array | undefined, currentMinutes: number,
  origin: LonLat, destination: LonLat,
): RouteResult | null {
  const minute = arrival ? currentMinutes : 0
  let cache = routeCache.get(roads)
  if (!cache || cache.grid !== grid || cache.arrival !== arrival || cache.minute !== minute) {
    cache = { grid, arrival, minute, queries: new Map() }
    routeCache.set(roads, cache)
  }
  const key = `${origin.lon}|${origin.lat}|${destination.lon}|${destination.lat}`
  if (cache.queries.has(key)) return cache.queries.get(key)!
  const result = calculateSafeRoute(grid, roads, arrival, minute, origin, destination)
  if (cache.queries.size >= 128) cache.queries.clear()
  cache.queries.set(key, result)
  return result
}
