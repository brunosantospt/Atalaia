// Decision B by iterated local search (Mendes & Alvelos, EJOR 2023; docs/ils.md): A's means on
// the ground again, each unit on a road it reaches before the fire, so that the fire reaches fewer
// places and then burns less by the end of the run. A is the starting solution, so B is never worse
// than A in the fast model. No DOM: it runs in a Web Worker (optimize.worker.ts) and in node.
//
// Adaptations of the article (ils.md §5), for a 30 m grid and units that hold hundreds of metres:
// - a unit stands on a road access point (osm.ts, one every 80 m), not on a cell; aerial units
//   also on a lattice of every 5th cell, since they drop anywhere;
// - the means are A's, unit by unit, with A's task: B moves them, stacks them or leaves one at
//   the station; a crew or an aircraft can also go from one of A's lines to a point (direct
//   attack) and back, or to another of A's lines of its kind;
// - B draws no line of its own: it may move one of A's lines up to 300 m away from the fire, cut
//   up to 300 m off either end, or build it from the other end, always with A's shape, and only
//   when the crews build most of it before the free run gets there;
// - a point is open to a unit when the free run (no one on the fire: the earliest the fire can be
//   anywhere) gets there SAFETY_MIN after the unit, so it is safe whatever the other units do;
// - the constructions draw on the free run instead of a Dijkstra after each unit, the local search
//   takes the first move that improves, in random order, and the perturbation also tries the
//   roads around the places the fire reaches (the protection of values the article leaves for
//   future work).

import { findAirBase } from './airBases'
import { freeArrival, simulate, type Run, type Scenario } from './fastModel'
import { bearingDeg, destination, distanceM, lerpLonLat, toPTTM06, type LonLat } from './geo'
import { cellHa, cellOf, lonLatAt, type Grid } from './grid'
import type { Context } from './osm'
import { wetLines, stripCells } from './wetLine'
import { beyondRing, approachIntercept } from './stationRings'
import { arrivalMin, isAerial, type Assignment, type Decision, type Task, type UnitId } from './suppression'

/** What the search needs of the OSM context: where units can stand and the places to keep the fire from. */
export interface Ground {
  access: LonLat[]
  places: LonLat[]
  placeCells: Int32Array[]
}

export const groundOf = (context: Context): Ground => ({
  access: context.access.map(({ lon, lat }) => ({ lon, lat })),
  places: context.osm.places.map(({ lon, lat }) => ({ lon, lat })),
  placeCells: context.placeCells,
})

/** How good a plan is at the end of the run, compared in this order: places reached, hectares, units out. */
export interface Score {
  places: number
  ha: number
  units: number
}

export interface Progress {
  phase: 'construct' | 'search' | 'done'
  plans: number // distinct plans simulated
  elapsedMs: number
  best: Score
  a: Score
  decision?: Decision // the best so far, when it changed
}

export interface Result {
  decision: Decision // B: the best plan found, or A itself when nothing beat it
  improved: boolean
  best: Score
  a: Score
  plans: number
  elapsedMs: number
}

export interface Options {
  budgetMs?: number
  maxPlans?: number // and at most this many distinct plans: the same B on any machine (scripts/ils-check.ts)
  seed?: number
  onProgress?: (p: Progress) => void
}

export const ILS_NAME = 'Proposta ILS · meios do A'

// The article's parameters for its largest grids (ils.md §2.4), scaled to a ~10 s budget at ~5 ms a plan.
const NCH = 100 // random constructions, at most
const CONSTRUCT_SHARE = 0.25 // of the budget
const RCL = 6 // L
const LN = 8 // neighbourhood
const MAX_PERTURB = 250
const MAX_STALL = 50
const P_REMOVE = 0.075
const P_ADD = 0.025
const NEAR_M = 300 // the local search moves a unit to the spots within this of where it is
const GAP_M = 200 // spots of one candidate list are this far apart, or they are one stretch of road
const PLACE_M = 600 // roads that guard a place
const PER_PLACE = 2
const SAFETY_MIN = 10 // a ground unit is on its point at least this long before the fire can be there
const AIR_STEP = 5 // aerial lattice: every 5th cell, 150 m
const PROGRESS_MS = 250
const SHIFT_M = [0, 100, 200, 300] // one of A's lines, moved this far away from the fire
const TRIM_M = [0, 100, 200, 300] // or this much shorter at either end
const KEEP = 0.5 // of a line's length, at least
const BUILT_SHARE = 0.8 // of a moved line's cells, built before the free run gets there
const P_SHAPE = 0.3 // the perturbation also moves one of the lines worked
// A line's shape in B as one number, digit by digit: its shift, the cuts at its start and at its
// end, and whether it is built from the other end. Shape 0 is A's line.
const RADIX = [SHIFT_M.length, TRIM_M.length, TRIM_M.length, 2]
const SHAPES = RADIX.reduce((m, r) => m * r, 1)

interface Spot extends LonLat {
  cell: number
  x: number
  y: number
  road: boolean // a ground unit can stand here
  air: boolean // an aerial unit can work here
  id?: string // A's point id
}

/** One unit of A at a point or on a line: what B places. */
interface Unit {
  unit: UnitId
  from: string
  task: Task // at a point: direct, protect or shuttle (direct for A's line crews and drops)
  onLine?: 'line' | 'drops' // what it does on a line, when A has lines of that kind
  slot: number // its assignment in A: B lists them in A's order, so each station's first stays its ECIN
  ecin: boolean
  aerial: boolean
  water: boolean // a ground unit with a tank, that a shuttle serves
  home: number // where A has it: a spot, or line l as -2 - l
  eta: Float32Array // minutes from the call to each spot, the station's crew out as volunteers
  dispatchMin: number // absolute T+ of this assignment
  etaIgnition: number
}

interface State {
  pos: Int32Array // spot of each unit, -1 at the station, -2 - l on line l; then the shape of each of A's lines
  score: Score
  run: Run
}

const WORST: Score = { places: Infinity, ha: Infinity, units: Infinity }

export function better(a: Score, b: Score): boolean {
  if (a.places !== b.places) return a.places < b.places
  if (Math.abs(a.ha - b.ha) > 1e-6) return a.ha < b.ha
  return a.units < b.units
}

const named = (a: Decision): Decision => ({ ...(JSON.parse(JSON.stringify(a)) as Decision), id: 'B', name: ILS_NAME })

export function optimize(scenario: Scenario, ground: Ground, a: Decision, options: Options = {}): Result {
  const t0 = performance.now()
  const budget = options.budgetMs ?? 10_000
  const maxPlans = options.maxPlans ?? Infinity
  const timeUp = () => performance.now() - t0 >= budget || memo.size >= maxPlans
  const random = mulberry32(options.seed ?? 1)
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]
  const { grid, stations, suppression: sup, durationMin } = scenario
  const ha = cellHa(grid)
  const ecinGain = sup.dispatch.volunteerTurnoutMin - sup.dispatch.ecinTurnoutMin
  /** Km from where a unit leaves to p, as fastModel.ts counts them: an aircraft from its air base, the rest by road from the station. */
  const kmFrom = (unit: UnitId, from: string) => {
    const origin = isAerial(sup.units[unit]) ? findAirBase(from) : stations.find((s) => s.id === from)
    return (p: LonLat) => (origin ? distanceM(origin, p) / 1000 : sup.dispatch.airBaseKm)
  }

  const reached = (run: Run): number[] => {
    const out: number[] = []
    ground.placeCells.forEach((cells, p) => {
      if (cells.some((i) => run.arrival[i] <= durationMin)) out.push(p)
    })
    return out
  }
  const scoreOf = (run: Run, used: number): Score => {
    let cells = 0
    for (const t of run.arrival) if (t <= durationMin) cells++
    return { places: reached(run).length, ha: cells * ha, units: used }
  }

  // A's units at points and on lines, one by one; anything B cannot place stays as it is.
  const spots: Spot[] = []
  const spot = (p: LonLat, extra: Pick<Spot, 'road' | 'air' | 'id'>): number => {
    const { x, y } = toPTTM06(p)
    return spots.push({ lon: p.lon, lat: p.lat, cell: cellOf(grid, p), x, y, ...extra }) - 1
  }
  const homeOf = new Map<string, number>()
  for (const [id, p] of Object.entries(a.points)) homeOf.set(id, spot(p, { road: false, air: false, id }))
  const lineIds = Object.keys(a.lines)
  const L = lineIds.length
  // What is done on each of A's lines: built by crews, or held by drops.
  const kinds = lineIds.map((id) => new Set(a.assignments.flatMap((x) => (x.target === id && (x.task === 'line' || x.task === 'drops') ? [x.task] : []))))
  const lineTask = (unit: UnitId): Unit['onLine'] => {
    const spec = sup.units[unit]
    return spec.lineMPerH ? 'line' : isAerial(spec) && spec.dropM && spec.holdMin ? 'drops' : undefined
  }
  const seeds: Omit<Unit, 'eta'>[] = []
  const fixed: { x: Assignment; slot: number }[] = []
  const ecinSeen = new Set<string>()
  a.assignments.forEach((x, slot) => {
    const spec = sup.units[x.unit]
    const aerial = isAerial(spec)
    const ecin = !aerial && !ecinSeen.has(x.from)
    if (!aerial) ecinSeen.add(x.from)
    const can = lineTask(x.unit)
    const onLine = x.task === 'line' || x.task === 'drops'
    const home = onLine ? (x.task === can && x.target in a.lines ? -2 - lineIds.indexOf(x.target) : undefined) : homeOf.get(x.target)
    if (home === undefined) return void fixed.push({ x, slot })
    const dispatchMin = x.dispatchMin ?? scenario.dispatchMin ?? 0
    const etaIgnition = dispatchMin + arrivalMin(sup, spec, kmFrom(x.unit, x.from)(scenario.ignition), ecin)
    const task = onLine ? 'direct' : x.task
    const lines = task !== 'shuttle' && kinds.some((k) => can && k.has(can)) ? can : undefined
    for (let c = 0; c < x.count; c++)
      seeds.push({ unit: x.unit, from: x.from, task, onLine: lines, slot, ecin, aerial, water: !aerial && !!spec.waterL, home, dispatchMin, etaIgnition })
  })
  const n = seeds.length
  const aRun = simulate(scenario, a)
  const aScore = scoreOf(aRun, n)
  if (n === 0) {
    const result = { decision: named(a), improved: false, best: aScore, a: aScore, plans: 0, elapsedMs: performance.now() - t0 }
    options.onProgress?.({ phase: 'done', plans: 0, elapsedMs: result.elapsedMs, best: aScore, a: aScore, decision: result.decision })
    return result
  }

  // Where units can stand: A's points, the roads, and for aircraft a lattice over the free run.
  const free = freeArrival(scenario) // no plan gets the fire anywhere sooner
  const at = (arrival: Float32Array, s: number) => (spots[s].cell < 0 ? Infinity : arrival[spots[s].cell])
  for (const p of ground.access) if (cellOf(grid, p) >= 0) spot(p, { road: true, air: true })
  if (seeds.some((u) => u.aerial))
    for (let row = AIR_STEP >> 1; row < grid.rows; row += AIR_STEP)
      for (let col = AIR_STEP >> 1; col < grid.cols; col += AIR_STEP)
        if (free[row * grid.cols + col] <= durationMin) spot(lonLatAt(grid, col + 0.5, row + 0.5), { road: false, air: true })

  // Minutes from the call to each spot, as fastModel.ts counts them: by road from the station, or from the air base.
  const etaCache = new Map<string, Float32Array>()
  const units: Unit[] = seeds.map((u) => {
    const key = `${u.unit}|${u.from}`
    let eta = etaCache.get(key)
    if (!eta) {
      const spec = sup.units[u.unit]
      const km = kmFrom(u.unit, u.from)
      etaCache.set(key, (eta = Float32Array.from(spots, (p) => arrivalMin(sup, spec, km(p), false))))
    }
    return { ...u, eta }
  })

  // Cache approach checks: many ILS plans reuse the same unit and destination.
  const approachCache = new Map<string, boolean>()
  const safeApproach = (u: Unit, p: LonLat, ecin: boolean): boolean => {
    if (u.aerial) return true
    const key = `${u.unit}|${u.from}|${u.dispatchMin}|${ecin}|${p.lon}|${p.lat}`
    const cached = approachCache.get(key)
    if (cached !== undefined) return cached
    const origin = scenario.stations.find((s) => s.id === u.from)
    const safe = !!origin && !approachIntercept(grid, scenario.fireArrival ?? free, origin, p, sup, sup.units[u.unit], u.dispatchMin, ecin)
    approachCache.set(key, safe)
    return safe
  }

  /** Whether unit k can be at spot s: on a road it reaches before the fire (an aircraft over the fire before it passes), or where A had it. */
  const open = (k: number, s: number, ecin = units[k].ecin): boolean => {
    const u = units[k]
    const p = spots[s]
    if (s === u.home) return true
    if (u.aerial ? !p.air : !p.road) return false
    if (!u.aerial && !beyondRing(scenario.rings, scenario.ignition, u.from, p)) return false // inside its station's interception boundary
    return at(free, s) > u.dispatchMin + u.eta[s] - (ecin ? ecinGain : 0) + (u.aerial ? 0 : SAFETY_MIN) && safeApproach(u, p, ecin)
  }
  const isOpen = units.map((_, k) => Uint8Array.from(spots, (_, s) => (open(k, s) ? 1 : 0)))
  // Per unit, the spots it can take, the ones the fire reaches first in front.
  const byFree = units.map((_, k) => {
    const list: number[] = []
    for (let s = 0; s < spots.length; s++) if (isOpen[k][s]) list.push(s)
    return list.sort((p, q) => at(free, p) - at(free, q))
  })

  // Spots by NEAR_M buckets, for the spots around a point or a place.
  const buckets = new Map<string, number[]>()
  spots.forEach((p, s) => {
    const key = `${Math.floor(p.x / NEAR_M)},${Math.floor(p.y / NEAR_M)}`
    const list = buckets.get(key)
    if (list) list.push(s)
    else buckets.set(key, [s])
  })
  const within = (x: number, y: number, m: number): number[] => {
    const out: number[] = []
    const span = Math.ceil(m / NEAR_M)
    const bx = Math.floor(x / NEAR_M)
    const by = Math.floor(y / NEAR_M)
    for (let i = bx - span; i <= bx + span; i++)
      for (let j = by - span; j <= by + span; j++)
        for (const s of buckets.get(`${i},${j}`) ?? []) if (Math.hypot(spots[s].x - x, spots[s].y - y) <= m) out.push(s)
    return out
  }
  const nearCache = new Map<number, number[]>()
  const near = (s: number) => {
    let list = nearCache.get(s)
    if (!list) nearCache.set(s, (list = within(spots[s].x, spots[s].y, NEAR_M).filter((t) => t !== s)))
    return list
  }
  const guards = ground.places.map((p) => {
    const { x, y } = toPTTM06(p)
    const d = (s: number) => Math.hypot(spots[s].x - x, spots[s].y - y)
    return within(x, y, PLACE_M).sort((s, t) => d(s) - d(t))
  })

  // A's lines as B may draw them (shape 0 is A's): moved away from the fire, to the side of the line
  // the free run gets to later (or further from the ignition, when it gets to neither).
  const away = lineIds.map((id) => {
    const line = a.lines[id]
    const later = (bearing: number) => {
      const cells = cellsAlong(grid, line.map((p) => destination(p, bearing, SHIFT_M[1])))
      return cells.reduce((m, c) => m + Math.min(free[c], durationMin), 0) / Math.max(1, cells.length)
    }
    const further = (bearing: number) => distanceM(scenario.ignition, destination(alongM(line, lengthOf(line) / 2), bearing, SHIFT_M[1]))
    const [left, right] = across(line)
    const gain = later(left) - later(right)
    return gain > 1 || (gain >= -1 && further(left) >= further(right)) ? left : right
  })
  const shapes = lineIds.map(() => new Map<number, LonLat[] | undefined>())
  const shapeAt = (l: number, v: number): LonLat[] | undefined => {
    if (!shapes[l].has(v)) shapes[l].set(v, redraw(a.lines[lineIds[l]], away[l], v))
    return shapes[l].get(v)
  }
  const valid = lineIds.map((_, l) => Array.from({ length: SHAPES }, (_, v) => v).filter((v) => shapeAt(l, v)))
  const lineEta = new Map<string, number>()
  /** Minutes from the call to the start of line l in shape v, for unit k (as eta). */
  const etaLine = (k: number, l: number, v: number): number => {
    const u = units[k]
    const key = `${u.unit}|${u.from}|${l}|${v}`
    let eta = lineEta.get(key)
    if (eta === undefined) lineEta.set(key, (eta = arrivalMin(sup, sup.units[u.unit], kmFrom(u.unit, u.from)(shapeAt(l, v)![0]), false)))
    return eta
  }
  /** Whether unit k can work line l in shape v: one of its kind whose start it reaches before the fire, as open() counts it, or A's own. */
  const lineOpen = (k: number, l: number, v: number, ecin = units[k].ecin): boolean => {
    const u = units[k]
    if (u.home === -2 - l && v === 0) return true
    const line = shapeAt(l, v)
    if (!line || !u.onLine || !(kinds[l].has(u.onLine) || u.home === -2 - l)) return false
    if (!u.aerial && !line.every((p) => beyondRing(scenario.rings, scenario.ignition, u.from, p))) return false // every vertex outside the interception boundary
    const cell = cellOf(grid, line[0])
    return (cell < 0 ? Infinity : free[cell]) > u.dispatchMin + etaLine(k, l, v) - (ecin ? ecinGain : 0) + (u.aerial ? 0 : SAFETY_MIN) && safeApproach(u, line[0], ecin)
  }
  const workedBy = (pos: Int32Array, l: number): boolean => {
    for (let k = 0; k < n; k++) if (pos[k] === -2 - l) return true
    return false
  }
  /** The other lines unit k can work, in their shapes in pos. */
  const linesFor = (k: number, pos: Int32Array): number[] => {
    if (!units[k].onLine) return []
    const out: number[] = []
    for (let l = 0; l < L; l++) if (pos[k] !== -2 - l && lineOpen(k, l, pos[n + l])) out.push(-2 - l)
    return out
  }
  /** Whether a line B moved is mostly in place before the free run gets there: built by its crews, or reached by its aircraft. */
  const inTime = (d: Decision, id: string): boolean => {
    // Crew lines are barriers piece by piece (wetLine.ts): a cell of the line holds from its piece's minute.
    const ready = new Map<number, number>()
    const slots = new Set(d.assignments.flatMap((x, i) => (x.target === id && x.task === 'line' ? [i] : [])))
    for (const w of wetLines(scenario, d, free))
      if (w.kind === 'line' && slots.has(w.slot))
        for (const cell of stripCells(grid, w.barrier)) ready.set(cell, Math.min(ready.get(cell) ?? Infinity, w.barrier.from_min))
    const line = d.lines[id]
    const cells = cellsAlong(grid, line)
    if (!slots.size) {
      const t = Math.min(...d.assignments.filter((x) => x.target === id).map((x) => (x.dispatchMin ?? scenario.dispatchMin ?? 0) + arrivalMin(sup, sup.units[x.unit], kmFrom(x.unit, x.from)(line[0]), false)))
      return cells.length > 0 && cells.filter((cell) => t <= free[cell]).length >= BUILT_SHARE * cells.length
    }
    return cells.filter((cell) => (ready.get(cell) ?? Infinity) <= free[cell]).length >= BUILT_SHARE * cells.length
  }

  // A plan as a decision: one assignment per kind of unit and spot or line, in A's order.
  const freshIds: string[] = []
  for (let i = 1; freshIds.length < n; i++) if (!(`p${i}` in a.points)) freshIds.push(`p${i}`)
  const build = (pos: Int32Array): { decision: Decision; feasible: boolean } => {
    const groups = new Map<string, { x: Assignment; slot: number; members: number[]; s: number }>()
    const names = new Map<number, string>()
    let fresh = 0
    for (let k = 0; k < n; k++) {
      const s = pos[k]
      if (s === -1) continue
      const u = units[k]
      if (s >= 0 && !names.has(s)) names.set(s, spots[s].id ?? freshIds[fresh++])
      const task = s >= 0 ? u.task : u.onLine!
      const key = `${s}|${u.unit}|${u.from}|${task}|${u.dispatchMin}`
      const g = groups.get(key)
      if (g) {
        g.x.count++
        g.members.push(k)
        g.slot = Math.min(g.slot, u.slot)
      } else groups.set(key, { x: { unit: u.unit, count: 1, from: u.from, target: s >= 0 ? names.get(s)! : lineIds[-2 - s], task, dispatchMin: u.dispatchMin }, slot: u.slot, members: [k], s })
    }
    const placed = [...groups.values()].sort((p, q) => p.slot - q.slot || q.x.count - p.x.count || p.s - q.s)
    const order = [...fixed.map((f) => ({ ...f, members: [] as number[] })), ...placed].sort((p, q) => p.slot - q.slot)
    // The first ground assignment of a station is its ECIN (fastModel.ts): a unit that only got
    // there in time as the ECIN and is not first any more has to be where the fire allows, and a
    // unit on a line has to reach its start, as B draws it, before the fire.
    const first = new Set<string>()
    let feasible = true
    for (const { x, members } of order) {
      const ground = !isAerial(sup.units[x.unit])
      const ecin = ground && !first.has(x.from)
      if (ground) first.add(x.from)
      for (const k of members) {
        const s = pos[k]
        if (s < -1 ? !lineOpen(k, -2 - s, pos[n - 2 - s], ecin) : !ecin && units[k].ecin && !open(k, s, false)) feasible = false
      }
    }
    const worked = new Set(order.map(({ x }) => x.target))
    const lines = Object.fromEntries(lineIds.flatMap((id, l): [string, LonLat[]][] => (worked.has(id) ? [[id, shapeAt(l, pos[n + l]) ?? a.lines[id]]] : [])))
    const points = Object.fromEntries([...names].map(([s, id]) => [id, { lon: spots[s].lon, lat: spots[s].lat }]))
    const decision: Decision = { id: 'B', name: ILS_NAME, points, lines, assignments: order.map(({ x }) => x) }
    lineIds.forEach((id, l) => {
      if (feasible && pos[n + l] !== 0 && id in lines && !inTime(decision, id)) feasible = false
    })
    return { decision, feasible }
  }

  // Identical units (same kind, station, task and A assignment) are interchangeable: one key per plan.
  const classOf = new Map<string, number[]>()
  units.forEach((u, k) => {
    const key = `${u.unit}|${u.from}|${u.task}|${u.slot}`
    classOf.set(key, [...(classOf.get(key) ?? []), k])
  })
  const classes = [...classOf.values()]
  // A line no one works has no shape in B.
  const fixedOn = lineIds.map((id) => fixed.some(({ x }) => x.target === id))
  const keyOf = (pos: Int32Array) => {
    const key = classes.map((ks) => ks.map((k) => pos[k]).sort((p, q) => p - q).join(',')).join(';')
    return L ? `${key}|${lineIds.map((_, l) => (fixedOn[l] || workedBy(pos, l) ? pos[n + l] : 'x')).join(',')}` : key
  }
  const memo = new Map<string, Score>()
  const used = (pos: Int32Array) => {
    let m = 0
    for (let k = 0; k < n; k++) if (pos[k] !== -1) m++
    return m
  }
  const evaluate = (pos: Int32Array): { score: Score; run?: Run } => {
    const key = keyOf(pos)
    const seen = memo.get(key)
    if (seen) return { score: seen }
    const { decision, feasible } = build(pos)
    if (!feasible) return memo.set(key, WORST), { score: WORST }
    const run = simulate(scenario, decision)
    const score = scoreOf(run, used(pos))
    memo.set(key, score)
    return { score, run }
  }
  const state = (pos: Int32Array, score: Score, run?: Run): State => ({ pos, score, run: run ?? simulate(scenario, build(pos).decision) })

  let phase: Progress['phase'] = 'construct'
  let best: State | undefined
  let lastPost = -Infinity
  const report = (improved: boolean) => {
    const now = performance.now()
    if (!options.onProgress || !best || (!improved && now - lastPost < PROGRESS_MS)) return
    lastPost = now
    options.onProgress({
      phase,
      plans: memo.size,
      elapsedMs: now - t0,
      best: best.score,
      a: aScore,
      decision: improved && better(best.score, aScore) ? build(best.pos).decision : undefined,
    })
  }
  const offer = (s: State) => {
    if (best && !better(s.score, best.score)) return
    best = s
    report(true)
  }

  // A, as the search sees it (one unit at a time on its spot): the starting solution.
  const home = new Int32Array(n + L)
  units.forEach((u, k) => (home[k] = u.home))
  const start = evaluate(home)
  offer(state(home, start.score, start.run))

  // Neighbourhoods.
  const waterAt = (pos: Int32Array): number[] => [...new Set(units.flatMap((u, k) => (u.water && u.task !== 'shuttle' && pos[k] >= 0 ? [pos[k]] : [])))]
  const shuttleTo = (k: number, pos: Int32Array) => waterAt(pos).filter((s) => s !== pos[k] && isOpen[k][s])
  /** The LN spots around s open to all of `members`, the ones the fire reaches first in front. */
  const around = (members: number[], s: number, arrival: Float32Array) =>
    near(s)
      .filter((t) => members.every((k) => isOpen[k][t]))
      .sort((p, q) => at(arrival, p) - at(arrival, q))
      .slice(0, LN)
  /** Up to `count` spots of `list` open to unit k, GAP_M apart from each other and from `taken`. */
  const spread = (k: number, list: number[], count: number, taken: number[] = []): number[] => {
    const out: number[] = []
    const apart = (s: number) => [...taken, ...out].every((t) => Math.hypot(spots[s].x - spots[t].x, spots[s].y - spots[t].y) >= GAP_M)
    for (const s of list) {
      if (out.length >= count) break
      if (isOpen[k][s] && apart(s)) out.push(s)
    }
    return out
  }

  const lineSpots = new Map<string, number[]>()
  /** The LN spots around the start, the middle and the end of line l in shape v open to unit k, the ones the fire reaches first in front. */
  const aroundLine = (k: number, l: number, v: number, arrival: Float32Array): number[] => {
    let list = lineSpots.get(`${l}|${v}`)
    if (!list) {
      const line = shapeAt(l, v)!
      const ends = [line[0], alongM(line, lengthOf(line) / 2), line[line.length - 1]].map(toPTTM06)
      lineSpots.set(`${l}|${v}`, (list = [...new Set(ends.flatMap(({ x, y }) => within(x, y, NEAR_M)))]))
    }
    return list
      .filter((t) => isOpen[k][t])
      .sort((p, q) => at(arrival, p) - at(arrival, q))
      .slice(0, LN)
  }

  /**
   * Moves of one unit to a spot around it (a tanker to another vehicle), off its line to a point
   * near the line or to the first spots the fire reaches, or onto another line; of the units on one
   * spot or one line together; and of each line worked one step to another shape.
   */
  const moves = ({ pos, run }: State): Int32Array[] => {
    const out: Int32Array[] = []
    const together = new Map<number, number[]>()
    let byArrival: number[] | undefined
    const first = (members: number[]) => {
      byArrival ??= [...spots.keys()].sort((p, q) => at(run.arrival, p) - at(run.arrival, q))
      return spread(members[0], byArrival, LN).filter((t) => members.every((k) => isOpen[k][t]))
    }
    for (let k = 0; k < n; k++) {
      const s = pos[k]
      if (s === -1) continue
      together.set(s, [...(together.get(s) ?? []), k])
      const targets =
        s < -1
          ? new Set([...aroundLine(k, -2 - s, pos[n - 2 - s], run.arrival), ...first([k])])
          : units[k].task === 'shuttle'
            ? shuttleTo(k, pos)
            : around([k], s, run.arrival)
      for (const t of [...targets, ...linesFor(k, pos)]) {
        const next = pos.slice()
        next[k] = t
        out.push(next)
      }
    }
    for (const [s, members] of together) {
      if (members.length < 2) continue
      for (const t of s < -1 ? first(members) : around(members, s, run.arrival)) {
        const next = pos.slice()
        for (const k of members) next[k] = t
        out.push(next)
      }
    }
    for (let l = 0; l < L; l++) {
      if (!workedBy(pos, l)) continue
      for (const v of neighbours(pos[n + l])) {
        if (!shapeAt(l, v)) continue
        const next = pos.slice()
        next[n + l] = v
        out.push(next)
      }
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  /** First improvement, in random order, until no move does better. */
  const localSearch = (from: State): State => {
    let current = from
    for (let improved = true; improved && !timeUp(); ) {
      improved = false
      for (const pos of moves(current)) {
        if (timeUp()) break
        const e = evaluate(pos)
        report(false)
        if (!better(e.score, current.score)) continue
        current = state(pos, e.score, e.run)
        offer(current)
        improved = true
        break
      }
    }
    return current
  }

  // Construction: A's assignments in the order they can be on the fire, each on one of the first
  // spots the fire reaches after it (the restricted candidate list), the tankers with the vehicles.
  // A's line crews and drops start on their lines, as A has them.
  const chunks = [...new Set(units.map((u) => u.slot))]
    .map((slot) => units.flatMap((u, k) => (u.slot === slot && u.task !== 'shuttle' && u.home >= 0 ? [k] : [])))
    .filter((ks) => ks.length)
    .sort((p, q) => units[p[0]].etaIgnition - units[q[0]].etaIgnition)
  const shuttles = units.flatMap((u, k) => (u.task === 'shuttle' ? [k] : []))
  const construct = (): Int32Array => {
    const pos = new Int32Array(n + L).fill(-1)
    pos.fill(0, n)
    units.forEach((u, k) => u.home < -1 && (pos[k] = u.home))
    const taken: number[] = []
    for (const chunk of chunks) {
      const rcl = spread(chunk[0], byFree[chunk[0]], RCL, taken)
      if (!rcl.length) continue
      const s = pick(rcl)
      for (const k of chunk) pos[k] = s
      taken.push(s)
    }
    for (const k of shuttles) {
      const to = shuttleTo(k, pos)
      if (to.length) pos[k] = pick(to)
    }
    return pos
  }
  let s0: State = best!
  for (let i = 0; i < NCH && performance.now() - t0 < budget * CONSTRUCT_SHARE && memo.size < maxPlans; i++) {
    const pos = construct()
    const e = evaluate(pos)
    if (better(e.score, s0.score)) offer((s0 = state(pos, e.score, e.run)))
    report(false)
  }

  // Perturbation: leave at the station the unit that gets there last, send one back, or move 3 to
  // 5 of them to the first spots the fire reaches, to the roads around the places it reaches or
  // to a line, and one of the lines worked to any shape.
  const perturb = ({ pos: from, run }: State): Int32Array => {
    const pos = from.slice()
    const placed = units.flatMap((_, k) => (pos[k] !== -1 ? [k] : []))
    const idle = units.flatMap((_, k) => (pos[k] === -1 ? [k] : []))
    const u = random()
    if (u < P_REMOVE && placed.length > 1) {
      const eta = (k: number) => (pos[k] >= 0 ? units[k].eta[pos[k]] : etaLine(k, -2 - pos[k], pos[n - 2 - pos[k]]))
      const last = placed.reduce((p, q) => (eta(q) > eta(p) ? q : p))
      pos[last] = -1
      return pos
    }
    if (u < P_REMOVE + P_ADD && idle.length) {
      const k = pick(idle)
      const to = units[k].task === 'shuttle' ? shuttleTo(k, pos) : [...spread(k, byFree[k], RCL), ...linesFor(k, pos)]
      if (to.length) pos[k] = pick(to)
      return pos
    }
    const byArrival = [...spots.keys()].sort((p, q) => at(run.arrival, p) - at(run.arrival, q))
    const threatened = reached(run)
    const moved = 3 + Math.floor(random() * 3)
    for (let m = 0; m < moved && placed.length; m++) {
      const k = pick(placed)
      const to =
        units[k].task === 'shuttle'
          ? shuttleTo(k, pos)
          : [...spread(k, byArrival, LN), ...threatened.flatMap((p) => guards[p].filter((s) => isOpen[k][s]).slice(0, PER_PLACE)), ...linesFor(k, pos)]
      if (to.length) pos[k] = pick(to)
    }
    if (L) {
      const worked = lineIds.flatMap((_, l) => (workedBy(pos, l) ? [l] : []))
      if (worked.length && random() < P_SHAPE) {
        const l = pick(worked)
        pos[n + l] = pick(valid[l])
      }
    }
    return pos
  }

  phase = 'search'
  let current = localSearch(s0)
  for (let i = 0, stall = 0; i < MAX_PERTURB && stall < MAX_STALL && !timeUp(); i++) {
    const pos = perturb(current)
    const e = evaluate(pos)
    report(false)
    if (e.score === WORST) {
      stall++
      continue
    }
    const next = localSearch(state(pos, e.score, e.run))
    if (better(next.score, current.score)) (current = next), (stall = 0)
    else stall++
  }

  phase = 'done'
  const found = best!
  const improved = better(found.score, aScore)
  const decision = improved ? build(found.pos).decision : named(a)
  const result = { decision, improved, best: improved ? found.score : aScore, a: aScore, plans: memo.size, elapsedMs: performance.now() - t0 }
  options.onProgress?.({ phase, plans: result.plans, elapsedMs: result.elapsedMs, best: result.best, a: aScore, decision })
  return result
}

/** What became of A's units in B: kept, moved, on another task or line, left at the station; and B's units A did not have. */
export interface Change {
  kind: 'same' | 'moved' | 'retasked' | 'removed' | 'added'
  unit: UnitId
  from: string
  task: Task // in A (in B, for added)
  count: number
  a?: LonLat // where it works in A, for units at a point
  b?: LonLat // and in B
  line?: string // the line, for line crews and drops
  taskB?: Task // retasked: what it does in B
  lineB?: string // and on which line
}

export function diffDecisions(a: Decision, b: Decision): Change[] {
  interface One {
    kind: string // unit and station
    unit: UnitId
    from: string
    task: Task
    p?: LonLat
    line?: string
  }
  const expand = (d: Decision): One[] =>
    d.assignments.flatMap((x) => {
      const p = d.points[x.target]
      const one: One = { kind: `${x.unit}|${x.from}`, unit: x.unit, from: x.from, task: x.task, p, line: p ? undefined : x.target }
      return Array.from({ length: x.count }, () => one)
    })
  const changes = new Map<string, Change>()
  const add = (kind: Change['kind'], o: One, pa?: LonLat, pb?: LonLat, to?: One) => {
    const key = [kind, o.kind, o.task, o.line, pa?.lon, pa?.lat, pb?.lon, pb?.lat, to?.task, to?.line].join('|')
    const seen = changes.get(key)
    if (seen) seen.count++
    else changes.set(key, { kind, unit: o.unit, from: o.from, task: o.task, count: 1, a: pa, b: pb, line: o.line, taskB: to?.task, lineB: to?.line })
  }
  const metres = (p?: LonLat, q?: LonLat) => (p && q ? distanceM(p, q) : 0)
  const fromA = expand(a)
  const fromB = expand(b)
  // Kept: the same kind of unit on the same task where it was, or on the same line however B drew
  // it; moved: the rest of A at points, each to the nearest of B of its kind and task; retasked: A's
  // units off their line or onto one.
  const match: Record<'same' | 'moved' | 'retasked', (o: One, x: One) => boolean> = {
    same: (o, x) => o.task === x.task && (o.p && x.p ? metres(o.p, x.p) < 5 : !o.p && !x.p && o.line === x.line),
    moved: (o, x) => o.task === x.task && !!o.p && !!x.p,
    retasked: (o, x) => !o.p || !x.p,
  }
  for (const pass of ['same', 'moved', 'retasked'] as const)
    for (let i = 0; i < fromA.length; i++) {
      const o = fromA[i]
      let j = -1
      fromB.forEach((x, k) => {
        if (x.kind !== o.kind || !match[pass](o, x)) return
        if (j < 0 || metres(o.p, x.p) < metres(o.p, fromB[j].p)) j = k
      })
      if (j < 0) continue
      add(pass, o, o.p, fromB[j].p, pass === 'retasked' ? fromB[j] : undefined)
      fromA.splice(i--, 1)
      fromB.splice(j, 1)
    }
  for (const o of fromA) add('removed', o, o.p)
  for (const o of fromB) add('added', o, undefined, o.p)
  return [...changes.values()]
}

/** What became of one of A's lines in B: moved, cut or built from the other end, drawn anew, or left with no one on it. */
export interface LineChange {
  id: string
  task: Task // what A does on it: line or drops
  kind: 'moved' | 'redrawn' | 'removed'
  shiftM: number // moved: this far
  awayDeg: number // this way
  startM: number // cut this much off its start
  endM: number // and off its end
  reverse: boolean // built (or dropped on) from the other end
}

export function diffLines(a: Decision, b: Decision): LineChange[] {
  const out: LineChange[] = []
  for (const [id, line] of Object.entries(a.lines)) {
    const on = a.assignments.find((x) => x.target === id)
    if (!on) continue
    const base = { id, task: on.task, shiftM: 0, awayDeg: 0, startM: 0, endM: 0, reverse: false }
    const drawn = b.lines[id]
    if (!drawn || !b.assignments.some((x) => x.target === id)) {
      out.push({ ...base, kind: 'removed' })
      continue
    }
    const same = (p: LonLat[]) => p.length === drawn.length && p.every((q, i) => distanceM(q, drawn[i]) < 1)
    if (same(line)) continue
    let found: LineChange | undefined
    for (const awayDeg of across(line))
      for (let v = 1; v < SHAPES && !found; v++) {
        const shape = redraw(line, awayDeg, v)
        if (shape && same(shape)) found = { ...base, kind: 'moved', ...shapeOf(v), awayDeg }
      }
    out.push(found ?? { ...base, kind: 'redrawn' })
  }
  return out
}

/** Metres along a polyline. */
const lengthOf = (line: LonLat[]) => line.reduce((m, p, i) => (i ? m + distanceM(line[i - 1], p) : 0), 0)

/** The point m metres along a polyline. */
function alongM(line: LonLat[], m: number): LonLat {
  for (let i = 1; i < line.length; i++) {
    const d = distanceM(line[i - 1], line[i])
    if (m <= d) return lerpLonLat(line[i - 1], line[i], d > 0 ? Math.max(0, m) / d : 0)
    m -= d
  }
  return line[line.length - 1]
}

/** The part of a polyline from `fromM` to `toM` metres along it, with its clicks in between. */
function stretch(line: LonLat[], fromM: number, toM: number): LonLat[] {
  const out = [alongM(line, fromM)]
  let m = 0
  for (let i = 1; i < line.length - 1; i++) {
    m += distanceM(line[i - 1], line[i])
    if (m > fromM && m < toM) out.push(line[i])
  }
  out.push(alongM(line, toM))
  return out
}

/** The two bearings square to a line: to the chord between its ends, or to its farthest click when it nearly closes on itself. */
function across(line: LonLat[]): [number, number] {
  const first = line[0]
  let last = line[line.length - 1]
  if (distanceM(first, last) < lengthOf(line) / 3) last = line.reduce((p, q) => (distanceM(first, q) > distanceM(first, p) ? q : p))
  const chord = bearingDeg(first, last)
  return [(chord + 270) % 360, (chord + 90) % 360]
}

const digitsOf = (v: number): number[] =>
  RADIX.map((r) => {
    const d = v % r
    v = Math.floor(v / r)
    return d
  })
const shapeIndex = (digits: number[]) => digits.reduceRight((v, d, i) => v * RADIX[i] + d, 0)
const shapeOf = (v: number) => {
  const [shift, start, end, reverse] = digitsOf(v)
  return { shiftM: SHIFT_M[shift], startM: TRIM_M[start], endM: TRIM_M[end], reverse: reverse === 1 }
}
/** The shapes one step from v: one digit up or down. */
const neighbours = (v: number): number[] =>
  digitsOf(v).flatMap((d, i) =>
    [d - 1, d + 1]
      .filter((e) => e >= 0 && e < RADIX[i])
      .map((e) => {
        const digits = digitsOf(v)
        digits[i] = e
        return shapeIndex(digits)
      }),
  )

/** One of A's lines in shape v, moved toward `awayDeg`, with A's clicks; undefined when less than KEEP of it is left. */
function redraw(line: LonLat[], awayDeg: number, v: number): LonLat[] | undefined {
  if (v === 0) return line
  if (line.length < 2) return undefined
  const { shiftM, startM, endM, reverse } = shapeOf(v)
  const len = lengthOf(line)
  if (len - startM - endM < KEEP * len) return undefined
  const moved = shiftM ? line.map((p) => destination(p, awayDeg, shiftM)) : line
  const cut = startM || endM ? stretch(moved, startM, len - endM) : moved
  return reverse ? cut.slice().reverse() : cut
}

/** The cells under a line, in order along it, each once (as fastModel.ts rasterises it). */
function cellsAlong(grid: Grid, line: LonLat[]): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let i = 1; i < line.length; i++) {
    const steps = Math.max(1, Math.ceil(distanceM(line[i - 1], line[i]) / (grid.cellsize / 2)))
    for (let q = 0; q <= steps; q++) {
      const cell = cellOf(grid, lerpLonLat(line[i - 1], line[i], q / steps))
      if (cell >= 0 && !seen.has(cell)) (seen.add(cell), out.push(cell))
    }
  }
  return out
}

/** Seeded PRNG (mulberry32): the same fire and A give the same B. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
