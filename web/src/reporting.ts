// Multi-Agency Reporting & Dispatch System (SIOPS / Proteção Civil, PSP/GNR, INEM).
//
// Role-based operational picture:
//  - 'cmd': Proteção Civil & Comando de Bombeiros (master tactical twin with all decision tools)
//  - 'psp': Forças de Segurança & Trânsito (cut-order list, traffic barricades, evacuation perimeters)
//  - 'inem': Emergência Médica (Advanced Medical Post / PMA, triage, safe ambulance evacuation corridors)

import type { Run } from './scenario'
import { fmtKm, fmtTime, wallClock } from './format'
import { distanceM, toPTTM06, type LonLat } from './geo'
import { cellOf, type Grid } from './grid'
import { snapToRoad, type Context, type Place, type Road, type RoadClass } from './osm'
import type { Decision } from './suppression'

export type AgencyRole = 'cmd' | 'psp' | 'inem'

export interface RoadCutItem {
  id: number
  label: string
  cls: RoadClass
  firstArrivalMin: number
  minutesToImpact: number // firstArrivalMin - currentMinutes
  urgency: 'cortado' | 'urgente' | 'preventivo'
  coord: LonLat
  pts: [number, number][]
  isPaved: boolean
  kind?: 'fire' | 'firefighters'
  firefighterUnit?: string
  /** Firefighters only: the far end of the closure on the side away from the fire, where traffic is stopped. */
  barrier?: LonLat
}

export interface MedicalPointItem {
  id: string
  name: string
  kind: 'pma' | 'zcv' | 'triagem'
  location: LonLat
  safeBufferMin: number // minutes until fire can reach within 1.5 km
  hospitalDestination: string
  ambulanceRoute?: LonLat[]
  routeKm?: number
  etaMin?: number
}

export interface MultiAgencyDispatch {
  timestamp: string
  fireName: string
  currentMin: number
  wallClock: string
  psp: {
    title: string
    roads: RoadCutItem[]
    fireCutRoads: RoadCutItem[]
    firefighterRoads: RoadCutItem[]
    cordonM: number
    message: string
  }
  inem: {
    title: string
    pmaList: MedicalPointItem[]
    blockedRoads: string[]
    hospital: string
    message: string
  }
  cmd: {
    summary: string
    totalThreatenedRoads: number
    pmaCount: number
    message: string
  }
}

/** Default regional hospital destination for emergency medical evacuations. */
export const DEFAULT_HOSPITAL: { name: string; location: LonLat } = {
  name: 'Hospital da Senhora da Oliveira (Guimarães)',
  // 41°26′31.7″N 8°18′20.0″W — shared by the landmark and evacuation routing.
  location: { lon: -8.305555555555555, lat: 41.44213888888889 },
}

/**
 * Produces an informative, real-world label for a road:
 * - If official name & ref exist: e.g. "EN 205 (Rua Central)" or "EM 599 (Rua da Castanheira)"
 * - If only name or ref: e.g. "Rua do Cruzeiro" or "EN 304"
 * - If unnamed in OSM: contextualizes with the nearest place/village from osm.places:
 *   e.g. "Caminho Florestal (Lugar de Mós)" or "Estrada Municipal (direção Felgueiras)"
 */
export function getSmartRoadLabel(r: Road, places: Place[] = []): string {
  if (r.name && r.ref) return `${r.ref} (${r.name})`
  if (r.name) return r.name
  if (r.ref) {
    const type = r.ref.startsWith('EN')
      ? 'Estrada Nacional'
      : r.ref.startsWith('EM')
        ? 'Estrada Municipal'
        : r.ref.startsWith('CM')
          ? 'Caminho Municipal'
          : r.ref.startsWith('IC') || r.ref.startsWith('IP')
            ? 'Itinerário'
            : 'Via'
    return `${r.ref} (${type})`
  }

  // Unnamed road: resolve nearest place from pts
  if (places && places.length > 0 && r.pts.length > 0) {
    const midIdx = Math.floor(r.pts.length / 2)
    const pt: LonLat = { lon: r.pts[midIdx][0], lat: r.pts[midIdx][1] }
    let nearest: Place | null = null
    let minD = Infinity

    for (const pl of places) {
      const d = distanceM(pt, pl)
      if (d < minD) {
        minD = d
        nearest = pl
      }
    }

    const baseKind =
      r.cls === 'paved' ? 'Estrada Municipal' : r.cls === 'track' ? 'Caminho Florestal' : 'Trilho Rural'

    if (nearest) {
      if (minD < 500) return `${baseKind} (${nearest.name})`
      return `${baseKind} (direção ${nearest.name})`
    }
    return baseKind
  }

  return r.cls === 'paved' ? 'Estrada Municipal' : r.cls === 'track' ? 'Caminho Florestal' : 'Trilho Rural'
}

/**
 * Finds the exact coordinate on the road polyline closest to the fire arrival cell.
 */
function findRoadCutCoordinate(r: Road, grid: Grid, hitCell: number): LonLat {
  if (!r.pts.length) return { lon: 0, lat: 0 }
  const col = hitCell % grid.cols
  const row = (hitCell - col) / grid.cols
  const targetX = grid.xmin + (col + 0.5) * grid.cellsize
  const targetY = grid.ymin + (grid.rows - row - 0.5) * grid.cellsize

  let best = r.pts[0]
  let bestD = Infinity

  for (const pt of r.pts) {
    const { x, y } = toPTTM06({ lon: pt[0], lat: pt[1] })
    const d = Math.hypot(x - targetX, y - targetY)
    if (d < bestD) {
      bestD = d
      best = pt
    }
  }

  return { lon: best[0], lat: best[1] }
}

/**
 * Detects all road segments threatened or intersected by the active fire spread within `horizonMin`.
 * Prioritizes paved highways and roads with official names/references for police traffic orders.
 */
export function detectThreatenedRoads(
  grid: Grid,
  context: Context,
  run: Run,
  currentMin: number,
  horizonMin = 90,
): RoadCutItem[] {
  const { arrival } = run
  const byLabel = new Map<string, RoadCutItem>()
  const places = context.osm.places

  for (const { road, cells: rc } of context.roadCells) {
    let minT = Infinity
    let hitCell = -1

    for (let k = 0; k < rc.length; k++) {
      const cell = rc[k]
      const t = arrival[cell]
      if (t < minT) {
        minT = t
        hitCell = cell
      }
    }

    if (minT <= currentMin + horizonMin && hitCell >= 0) {
      const r: Road = context.osm.roads[road]
      const label = getSmartRoadLabel(r, places)
      const minutesToImpact = Math.round(minT - currentMin)

      let urgency: 'cortado' | 'urgente' | 'preventivo' = 'preventivo'
      if (minutesToImpact <= 0) urgency = 'cortado'
      else if (minutesToImpact <= 25) urgency = 'urgente'

      const coord = findRoadCutCoordinate(r, grid, hitCell)
      const isPaved = r.cls === 'paved' || !!r.name || !!r.ref

      const existing = byLabel.get(label)
      if (!existing || minT < existing.firstArrivalMin) {
        byLabel.set(label, {
          id: road,
          label,
          cls: r.cls,
          firstArrivalMin: minT,
          minutesToImpact,
          urgency,
          coord,
          pts: r.pts,
          isPaved,
        })
      }
    }
  }

  // Sort: 1) Urgency (cortado/urgente first), 2) Paved/Named roads first, 3) Arrival time
  return [...byLabel.values()].sort((a, b) => {
    // Paved/classified roads get higher priority for traffic police
    if (a.isPaved !== b.isPaved) return a.isPaved ? -1 : 1
    return a.firstArrivalMin - b.firstArrivalMin
  })
}

/** Calculates safety buffer (minutes) of a proposed Medical Point relative to fire perimeter. */
export function evaluateMedicalPointSafety(
  grid: Grid,
  arrival: Float32Array,
  point: LonLat,
  radiusM = 1200,
): number {
  const col = Math.floor((point.lon - grid.rect.west) / ((grid.rect.east - grid.rect.west) / grid.cols))
  const row = Math.floor((grid.rect.north - point.lat) / ((grid.rect.north - grid.rect.south) / grid.rows))
  const span = Math.ceil(radiusM / grid.cellsize)

  let minArrival = Infinity
  for (let r = Math.max(0, row - span); r <= Math.min(grid.rows - 1, row + span); r++) {
    for (let c = Math.max(0, col - span); c <= Math.min(grid.cols - 1, col + span); c++) {
      const idx = r * grid.cols + c
      if (arrival[idx] < minArrival) minArrival = arrival[idx]
    }
  }

  return minArrival === Infinity ? 999 : Math.round(minArrival)
}

/**
 * Clips road points to at most `radiusM` (default 1000m) along the road in either direction
 * from the point closest to `center`.
 */
const roadBucketCache = new WeakMap<Road[], Map<string, number[]>>()
const BUCKET_DEG = 0.001 // ~80m spatial bucket

function getRoadSpatialBuckets(roads: Road[]): Map<string, number[]> {
  const cached = roadBucketCache.get(roads)
  if (cached) return cached

  const buckets = new Map<string, number[]>()
  roads.forEach((r, idx) => {
    if (!r.pts || r.pts.length < 2) return
    const p1 = r.pts[0]
    const p2 = r.pts[r.pts.length - 1]
    const k1 = `${Math.floor(p1[0] / BUCKET_DEG)},${Math.floor(p1[1] / BUCKET_DEG)}`
    const k2 = `${Math.floor(p2[0] / BUCKET_DEG)},${Math.floor(p2[1] / BUCKET_DEG)}`
    let b1 = buckets.get(k1)
    if (!b1) { b1 = []; buckets.set(k1, b1) }
    b1.push(idx)
    if (k1 !== k2) {
      let b2 = buckets.get(k2)
      if (!b2) { b2 = []; buckets.set(k2, b2) }
      b2.push(idx)
    }
  })

  roadBucketCache.set(roads, buckets)
  return buckets
}

function findConnectingRoad(
  roads: Road[],
  pt: LonLat,
  visited: Set<number>,
  preferName?: string,
  preferRef?: string,
): { roadIdx: number; fromStart: boolean } | null {
  const buckets = getRoadSpatialBuckets(roads)
  const bx = Math.floor(pt.lon / BUCKET_DEG)
  const by = Math.floor(pt.lat / BUCKET_DEG)
  let best: { roadIdx: number; fromStart: boolean } | null = null
  let bestScore = -Infinity

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = buckets.get(`${bx + dx},${by + dy}`)
      if (!bucket) continue
      for (const idx of bucket) {
        if (visited.has(idx)) continue
        const r = roads[idx]
        if (!r.pts || r.pts.length < 2) continue
        const pStart: LonLat = { lon: r.pts[0][0], lat: r.pts[0][1] }
        const pEnd: LonLat = { lon: r.pts[r.pts.length - 1][0], lat: r.pts[r.pts.length - 1][1] }
        const dStart = distanceM(pt, pStart)
        const dEnd = distanceM(pt, pEnd)

        if (dStart <= 30 || dEnd <= 30) {
          const fromStart = dStart <= dEnd
          const minD = Math.min(dStart, dEnd)
          let score = 100 - minD
          if (preferName && r.name && r.name === preferName) score += 500
          if (preferRef && r.ref && r.ref === preferRef) score += 500
          if (score > bestScore) {
            bestScore = score
            best = { roadIdx: idx, fromStart }
          }
        }
      }
    }
  }
  return best
}

/** How far along the road network from a working vehicle the fire is looked for. */
const TO_FIRE_MAX_M = 3000
/** How far the road is closed past a working vehicle, on the side away from the fire. */
export const OTHER_SIDE_M = 1000
/** Sampling step when looking for the fire along a road: half a grid cell. */
const FIRE_STEP_M = 15

/** Nearest point of a road to `p`: the segment it falls on, the point itself, and how far it is. */
function projectOnRoad(pts: [number, number][], p: LonLat): { seg: number; at: LonLat; distM: number } {
  let best = { seg: 0, at: { lon: pts[0][0], lat: pts[0][1] }, distM: Infinity }
  for (let i = 0; i < pts.length - 1; i++) {
    const a: LonLat = { lon: pts[i][0], lat: pts[i][1] }
    const b: LonLat = { lon: pts[i + 1][0], lat: pts[i + 1][1] }
    const dx = (b.lon - a.lon) * 83300
    const dy = (b.lat - a.lat) * 111139
    const px = (p.lon - a.lon) * 83300
    const py = (p.lat - a.lat) * 111139
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0
    const at: LonLat = { lon: a.lon + t * (b.lon - a.lon), lat: a.lat + t * (b.lat - a.lat) }
    const d = distanceM(p, at)
    if (d < best.distM) best = { seg: i, at, distM: d }
  }
  return best
}

/**
 * Walks the road network from `start` through `ahead` (the rest of its road, in walking order), going on
 * into a connecting road at each end, for at most `maxM`. Stops at the first point where `stop` holds.
 */
function walkRoad(
  start: LonLat,
  ahead: [number, number][],
  maxM: number,
  roads: Road[],
  visited: Set<number>,
  stop: (p: LonLat) => boolean,
): { pts: [number, number][]; stopped: boolean } {
  const out: [number, number][] = []
  let curr = start
  let pts = ahead
  let i = 0
  let walked = 0
  while (walked < maxM) {
    if (i >= pts.length) {
      const conn = findConnectingRoad(roads, curr, visited)
      if (!conn) break
      visited.add(conn.roadIdx)
      const r = roads[conn.roadIdx].pts
      pts = (conn.fromStart ? r : [...r].reverse()).slice(1)
      i = 0
      continue
    }
    const next: LonLat = { lon: pts[i][0], lat: pts[i][1] }
    const d = distanceM(curr, next)
    const end = d > 0 ? Math.min(1, (maxM - walked) / d) : 1
    const steps = Math.max(1, Math.ceil((d * end) / FIRE_STEP_M))
    for (let k = 1; k <= steps; k++) {
      const f = (end * k) / steps
      const p: LonLat = { lon: curr.lon + f * (next.lon - curr.lon), lat: curr.lat + f * (next.lat - curr.lat) }
      if (stop(p)) {
        out.push([p.lon, p.lat])
        return { pts: out, stopped: true }
      }
    }
    if (end < 1) {
      out.push([curr.lon + end * (next.lon - curr.lon), curr.lat + end * (next.lat - curr.lat)])
      break
    }
    out.push([next.lon, next.lat])
    walked += d
    curr = next
    i++
  }
  return { pts: out, stopped: false }
}

/** `path` up to the point the fire reaches first, and when; undefined if the fire never reaches it. */
function cutAtEarliest(
  path: [number, number][],
  arrivalAt: (p: LonLat) => number,
): { path: [number, number][]; min: number } | undefined {
  let min = Infinity
  let cut: [number, number][] = []
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]]
    const steps = Math.max(1, Math.ceil(distanceM({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }) / FIRE_STEP_M))
    for (let k = 1; k <= steps; k++) {
      const p: LonLat = { lon: a[0] + (k / steps) * (b[0] - a[0]), lat: a[1] + (k / steps) * (b[1] - a[1]) }
      const t = arrivalAt(p)
      if (t < min) {
        min = t
        cut = [...path.slice(0, i), [p.lon, p.lat]]
      }
    }
  }
  return min < Infinity ? { path: cut, min } : undefined
}

/**
 * The stretch of road the GNR closes for a vehicle working on it: from the fire, along the road network,
 * to the vehicle, and on past it for `otherSideM` the other way, so no car comes in from behind. Each way
 * that meets the burnt area within `maxM` is closed up to the fire, so a vehicle between two fronts
 * closes both; when neither does yet, the way towards where the fire arrives first. `pts` is one
 * polyline through the vehicle's point on the road, and `barrier` the far end of the closure on the side
 * away from the fire, where traffic is stopped. Empty when the vehicle is off the road network or the
 * fire never reaches its road.
 */
export function roadToFire(
  roads: Road[],
  roadIndex: number,
  vehicle: LonLat,
  grid: Grid,
  arrival: Float32Array,
  minutes: number,
  maxM = TO_FIRE_MAX_M,
  otherSideM = OTHER_SIDE_M,
): { pts: [number, number][]; barrier?: LonLat } {
  const pts = roads[roadIndex]?.pts
  if (!pts || pts.length < 2) return { pts: [] }
  const { seg, at, distM } = projectOnRoad(pts, vehicle)
  if (distM > 500) return { pts: [] }

  const arrivalAt = (p: LonLat) => {
    const cell = cellOf(grid, p)
    return cell < 0 ? Infinity : arrival[cell]
  }
  const start: [number, number] = [at.lon, at.lat]
  const aheads = [pts.slice(seg + 1), pts.slice(0, seg + 1).reverse()]
  const ways = aheads.map((ahead) => walkRoad(at, ahead, maxM, roads, new Set([roadIndex]), (p) => arrivalAt(p) <= minutes))
  let toFire = ways.flatMap((w, way) => (w.stopped ? [{ way, path: [start, ...w.pts] }] : []))
  if (!toFire.length) {
    const earliest = ways
      .map((w, way) => ({ way, cut: cutAtEarliest([start, ...w.pts], arrivalAt) }))
      .filter((c) => c.cut !== undefined)
      .sort((a, b) => a.cut!.min - b.cut!.min)[0]
    if (earliest) toFire = [{ way: earliest.way, path: earliest.cut!.path }]
  }
  if (!toFire.length) return { pts: [] }

  const closed = toFire.map((c) => c.path)
  let barrier: LonLat | undefined
  if (closed.length === 1) {
    const behind = walkRoad(at, aheads[1 - toFire[0].way], otherSideM, roads, new Set([roadIndex]), () => false).pts
    if (behind.length) {
      closed.push([start, ...behind])
      const [lon, lat] = behind.at(-1)!
      barrier = { lon, lat }
    }
  }
  // Both ways start at the vehicle: turn one round so the line runs end to end through it.
  const path = closed.length > 1 ? [...[...closed[1]].reverse(), ...closed[0].slice(1)] : closed[0]
  return path.length >= 2 ? { pts: path, barrier } : { pts: [] }
}

/**
 * Finds the nearest road index in context.osm.roads within maxM meters.
 */
export function findNearestRoadIndex(context: Context, pt: LonLat, maxM = 500): number {
  if (!context.osm.roads) return -1
  let bestIdx = -1
  let minD = maxM
  for (let i = 0; i < context.osm.roads.length; i++) {
    const r = context.osm.roads[i]
    if (!r.pts) continue
    for (let j = 0; j < r.pts.length; j++) {
      const d = distanceM(pt, { lon: r.pts[j][0], lat: r.pts[j][1] })
      if (d < minD) {
        minD = d
        bestIdx = i
      }
    }
  }
  return bestIdx
}

/**
 * Detects roads where firefighting vehicles are at work, each closed from the fire to the vehicle and
 * on past it the other way (empty `pts` when the fire does not reach that road, but the vehicle still
 * blocks it). `where` gives a vehicle's working point now (its latest placement, after relocations),
 * undefined while it has no order yet; without it, the decision's first point.
 */
export function detectFirefighterRoads(
  context: Context,
  decision: Decision | undefined,
  currentMin: number,
  grid: Grid,
  arrival: Float32Array,
  where?: (slot: number) => LonLat | undefined,
): RoadCutItem[] {
  if (!decision || !context || !context.osm.roads) return []
  const result: RoadCutItem[] = []
  const seenRoads = new Set<string>()

  for (const [slot, a] of decision.assignments.entries()) {
    // Only forest vehicles of combat (VFCI) and supply (VTTU) establish road blocks
    // Sapadores a pé / equipas apeadas (crew) do NOT establish road cuts or cut icons
    if (a.unit !== 'vfci' && a.unit !== 'vttu') continue

    const pt = where ? where(slot) : decision.points[a.target] ?? decision.lines[a.target]?.[0]
    if (!pt) continue

    const access = snapToRoad(context, pt, 500)
    const roadIndex = access?.road ?? findNearestRoadIndex(context, pt, 500)
    if (roadIndex < 0 || roadIndex >= context.osm.roads.length) continue

    const road = context.osm.roads[roadIndex]
    if (!road || !road.pts || road.pts.length < 2) continue

    const toFire = roadToFire(context.osm.roads, roadIndex, pt, grid, arrival, currentMin)

    const label = getSmartRoadLabel(road, context.osm.places)
    const roadKey = `${road.id ?? roadIndex}-${Math.round(pt.lon * 1000)}-${Math.round(pt.lat * 1000)}`

    if (!seenRoads.has(roadKey)) {
      seenRoads.add(roadKey)
      result.push({
        id: road.id ?? roadIndex,
        label,
        cls: road.cls,
        firstArrivalMin: currentMin,
        minutesToImpact: 0,
        urgency: 'cortado',
        coord: pt,
        pts: toFire.pts,
        barrier: toFire.barrier,
        isPaved: road.cls === 'paved' || !!road.name || !!road.ref,
        kind: 'firefighters',
        firefighterUnit: a.unit.toUpperCase(),
      })
    }
  }

  return result
}

/** A point this close to a closure is on that stretch of road. */
const SAME_ROAD_M = 30

/**
 * Where the block signs of the vehicles' closures go. Vehicles closing the same stretch of road share
 * their signs: one at each of the two outermost vehicles, none at those in between, and a far barrier
 * only where no other closure of the stretch carries on past it.
 */
export function roadBlockSigns(items: RoadCutItem[]): { at: LonLat; item: RoadCutItem }[] {
  const on = (p: LonLat, item: RoadCutItem) => item.pts.length >= 2 && projectOnRoad(item.pts, p).distM <= SAME_ROAD_M
  // One stretch: closures that reach each other's vehicle.
  const parent = items.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  items.forEach((a, i) => items.forEach((b, j) => {
    if (i < j && (on(a.coord, b) || on(b.coord, a))) parent[root(i)] = root(j)
  }))
  const stretches = new Map<number, RoadCutItem[]>()
  items.forEach((item, i) => stretches.set(root(i), [...(stretches.get(root(i)) ?? []), item]))

  const signs: { at: LonLat; item: RoadCutItem }[] = []
  for (const members of stretches.values()) {
    // The first and the last vehicle on the road are the two furthest apart.
    let ends = [members[0], members[0]]
    let far = -1
    for (const a of members) for (const b of members) {
      const d = distanceM(a.coord, b.coord)
      if (d > far) [far, ends] = [d, [a, b]]
    }
    for (const item of new Set(ends)) signs.push({ at: item.coord, item })
    for (const item of members)
      if (item.barrier && !members.some((other) => other !== item && on(item.barrier!, other))) signs.push({ at: item.barrier, item })
  }
  return signs
}

/** Formats the copyable direct operational dispatch for PSP / GNR Traffic Division. */
export function formatPSPDispatch(
  fireName: string,
  wallClockStr: string,
  currentMin: number,
  fireRoads: RoadCutItem[],
  firefighterRoads: RoadCutItem[] = [],
): string {
  const lines: string[] = []
  lines.push(`🚨 [DESPACHO OPERACIONAL - PSP / GNR TRÂNSITO]`)
  lines.push(`INCÊNDIO: ${fireName.toUpperCase()}`)
  lines.push(`HORA EMISSÃO: ${wallClockStr} (T+${currentMin} min)`)
  lines.push(`EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS`)
  lines.push(``)
  lines.push(`AÇÃO PRIORITÁRIA: CORTE DE VIAS E DESVIOS DE TRÂNSITO`)
  lines.push(`Perímetro de segurança recomendado: 500m barramento geral, 1200m a sotavento.`)
  lines.push(``)

  lines.push(`━━━ 1. ESTRADAS CORTADAS (ZONAS DE FOGO) ━━━`)
  if (!fireRoads.length) {
    lines.push(`✅ Nenhuma via principal cortada ou ameaçada pelo fogo nos próximos 60 min.`)
  } else {
    fireRoads.forEach((r, idx) => {
      let tag = '[CORTE PREVENTIVO]'
      if (r.urgency === 'cortado') tag = '⛔ [INTERDITADA - FOGO NA VIA]'
      else if (r.urgency === 'urgente') tag = '⚠️ [URGENTE - IMPACTO < 25 MIN]'

      const tempo = r.minutesToImpact <= 0 ? 'Já atingida pelo fogo' : `Impacto em ~${r.minutesToImpact} min`
      lines.push(`${idx + 1}. ${tag} ${r.label}`)
      lines.push(`   Tipo: ${r.cls.toUpperCase()} | Previsão: ${tempo} | GPS: ${r.coord.lat.toFixed(5)}, ${r.coord.lon.toFixed(5)}`)
    })
  }
  lines.push(``)

  lines.push(`━━━ 2. ESTRADAS EM ATUAÇÃO DE VEÍCULOS DE BOMBEIROS (CORTE DO FOGO AO VEÍCULO E NO SENTIDO OPOSTO) ━━━`)
  if (!firefighterRoads.length) {
    lines.push(`Nenhuma estrada cortada por veículos florestais de bombeiros neste momento.`)
  } else {
    lines.push(`⚠️ Via interdita desde o fogo até ao veículo e ${fmtKm(OTHER_SIDE_M / 1000)} para lá dele no sentido oposto: nenhum veículo civil circula nos dois sentidos. Vias reservadas a meios de socorro e combate (permitida a entrada de reforço de bombeiros e veículos):`)
    firefighterRoads.forEach((r, idx) => {
      lines.push(`${idx + 1}. 🚒 [TEATRO DE OPERAÇÕES] ${r.label}`)
      lines.push(`   Meio no local: ${r.firefighterUnit ?? 'Veículo'} | Corte: do fogo até ao veículo | Ponto do veículo: ${r.coord.lat.toFixed(5)}, ${r.coord.lon.toFixed(5)}`)
      if (r.barrier) {
        lines.push(`   ⛔ Barreira no sentido oposto (${fmtKm(OTHER_SIDE_M / 1000)} do veículo): ${r.barrier.lat.toFixed(5)}, ${r.barrier.lon.toFixed(5)}`)
      }
    })
  }

  lines.push(``)
  lines.push(`Canal de Coordenação Rádio: SIRESP Sub-Grupo Proteção Civil 04.`)
  return lines.join('\n')
}

/** Formats the copyable direct operational dispatch for INEM (Medical Response & Evacuation). */
export function formatINEMDispatch(
  fireName: string,
  wallClockStr: string,
  currentMin: number,
  pmaList: MedicalPointItem[],
  blockedRoadLabels: string[],
): string {
  const lines: string[] = []
  lines.push(`🚑 [DESPACHO OPERACIONAL - INEM / SAÚDE & EVACUAÇÃO]`)
  lines.push(`INCÊNDIO: ${fireName.toUpperCase()}`)
  lines.push(`HORA EMISSÃO: ${wallClockStr} (T+${currentMin} min)`)
  lines.push(`EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS`)
  lines.push(``)
  lines.push(`AÇÃO: ESTABELECIMENTO DE POSTO MÉDICO AVANÇADO (PMA) E CORREDORES DE SOCORRO`)
  lines.push(``)

  if (!pmaList.length) {
    lines.push(`Nenhum PMA ativado no momento. Ambulâncias em prevenção na base de apoio.`)
  } else {
    lines.push(`PONTOS DE ATUAÇÃO MÉDICA / PMA ATIVOS:`)
    pmaList.forEach((p, idx) => {
      const bufferDesc = p.safeBufferMin > 180 ? '> 3 horas' : `${p.safeBufferMin} min`
      lines.push(`${idx + 1}. 🏥 ${p.name.toUpperCase()} (${p.kind.toUpperCase()})`)
      lines.push(`   Coordenadas GPS: ${p.location.lat.toFixed(5)}, ${p.location.lon.toFixed(5)}`)
      lines.push(`   Margem de segurança ao fogo: ${bufferDesc}`)
      if (p.routeKm) {
        lines.push(`   Corredor de Evacuação: ${p.hospitalDestination} (${fmtKm(p.routeKm)}, ETA ~${p.etaMin} min)`)
      }
    })
  }

  lines.push(``)
  lines.push(`⚠️ ESTRADAS VEDADAS À PASSAGEM DE AMBULÂNCIAS (Chamas / Fumo Denso):`)
  if (!blockedRoadLabels.length) {
    lines.push(`- Redes viárias principais desimpedidas.`)
  } else {
    blockedRoadLabels.slice(0, 6).forEach((lbl) => lines.push(`- ⛔ ${lbl} (Interditada)`))
  }

  lines.push(``)
  lines.push(`Hospital de Retaguarda: ${DEFAULT_HOSPITAL.name}`)
  lines.push(`Canal de Coordenação Saúde: CODU / Linha de Apoio Direto Proteção Civil.`)
  return lines.join('\n')
}

/** Generates the complete multi-agency dispatch packet. */
export function buildMultiAgencyDispatch(
  fireName: string,
  startTime: string,
  currentMin: number,
  grid: Grid,
  context: Context | undefined,
  run: Run,
  pmaList: MedicalPointItem[],
  decision?: Decision,
  where?: (slot: number) => LonLat | undefined,
): MultiAgencyDispatch {
  const clock = fmtTime(wallClock(startTime, currentMin / 60))
  const fireRoads = context ? detectThreatenedRoads(grid, context, run, currentMin) : []
  for (const r of fireRoads) r.kind = 'fire'

  const firefighterRoads = (context && decision) ? detectFirefighterRoads(context, decision, currentMin, grid, run.arrival, where) : []
  const allRoads = [...fireRoads, ...firefighterRoads]
  const blockedLabels = allRoads.map((r) => r.label)

  const pspMessage = formatPSPDispatch(fireName, clock, currentMin, fireRoads, firefighterRoads)
  const inemMessage = formatINEMDispatch(fireName, clock, currentMin, pmaList, blockedLabels)

  const cmdSummary =
    `Despacho emitido às ${clock}: ${fireRoads.length} vias em zona de fogo, ${firefighterRoads.length} vias em combate (PSP); ` +
    `${pmaList.length} pontos de socorro / PMA sob vigilância do INEM.`

  return {
    timestamp: new Date().toISOString(),
    fireName,
    currentMin,
    wallClock: clock,
    psp: {
      title: 'Forças de Segurança (PSP / GNR) - Controlo de Vias',
      roads: allRoads,
      fireCutRoads: fireRoads,
      firefighterRoads,
      cordonM: 500,
      message: pspMessage,
    },
    inem: {
      title: 'Emergência Médica (INEM) - Postos de Socorro & Evacuação',
      pmaList,
      blockedRoads: blockedLabels,
      hospital: DEFAULT_HOSPITAL.name,
      message: inemMessage,
    },
    cmd: {
      summary: cmdSummary,
      totalThreatenedRoads: allRoads.length,
      pmaCount: pmaList.length,
      message: `${pspMessage}\n\n====================\n\n${inemMessage}`,
    },
  }
}
