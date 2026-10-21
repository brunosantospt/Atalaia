// Decision B by iterated local search (Mendes & Alvelos, EJOR 2023; docs/ils.md): A's means on
// the ground again, each unit on a road it reaches before the fire, so that the fire reaches fewer
// places and then burns less by the end of the run. A is the starting solution, so B is never worse
// than A in the fast model. No DOM: it runs in a Web Worker (optimize.worker.ts) and in node.
//
// Adaptations of the article (ils.md §5), for a 30 m grid and units that hold hundreds of metres:
// - a unit stands on a road access point (osm.ts, one every 80 m), not on a cell; aerial units
//   also on a lattice of every 5th cell, since they drop anywhere;
// - the means are A's, unit by unit, with A's task: B moves them, stacks them or leaves one at
//   the station; A's lines stay as drawn;
// - a point is open to a unit when the free run (no one on the fire: the earliest the fire can be
//   anywhere) gets there SAFETY_MIN after the unit, so it is safe whatever the other units do;
// - the constructions draw on the free run instead of a Dijkstra after each unit, the local search
//   takes the first move that improves, in random order, and the perturbation also tries the
//   roads around the places the fire reaches (the protection of values the article leaves for
//   future work).

import { findAirBase } from './airBases'
import { simulate, type Run, type Scenario } from './fastModel'
import { distanceM, toPTTM06, type LonLat } from './geo'
import { cellHa, cellOf, lonLatAt } from './grid'
import type { Context } from './osm'
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

interface Spot extends LonLat {
  cell: number
  x: number
  y: number
  road: boolean // a ground unit can stand here
  air: boolean // an aerial unit can work here
  id?: string // A's point id
}

/** One unit of A at a point: what B places. */
interface Unit {
  unit: UnitId
  from: string
  task: Task // direct, protect or shuttle
  slot: number // its assignment in A: B lists them in A's order, so each station's first stays its ECIN
  ecin: boolean
  aerial: boolean
  water: boolean // a ground unit with a tank, that a shuttle serves
  home: number // its spot in A
  eta: Float32Array // minutes from the call to each spot, the station's crew out as volunteers
  etaIgnition: number
}

interface State {
  pos: Int32Array // spot of each unit, -1 at the station
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

  // A's units at points, one by one; its lines (and anything B cannot place) stay as they are.
  const spots: Spot[] = []
  const spot = (p: LonLat, extra: Pick<Spot, 'road' | 'air' | 'id'>): number => {
    const { x, y } = toPTTM06(p)
    return spots.push({ lon: p.lon, lat: p.lat, cell: cellOf(grid, p), x, y, ...extra }) - 1
  }
  const homeOf = new Map<string, number>()
  for (const [id, p] of Object.entries(a.points)) homeOf.set(id, spot(p, { road: false, air: false, id }))
  const seeds: Omit<Unit, 'eta'>[] = []
  const fixed: { x: Assignment; slot: number }[] = []
  const ecinSeen = new Set<string>()
  a.assignments.forEach((x, slot) => {
    const spec = sup.units[x.unit]
    const aerial = isAerial(spec)
    const ecin = !aerial && !ecinSeen.has(x.from)
    if (!aerial) ecinSeen.add(x.from)
    const home = homeOf.get(x.target)
    if (x.task === 'line' || x.task === 'drops' || home === undefined) return void fixed.push({ x, slot })
    const etaIgnition = arrivalMin(sup, spec, kmFrom(x.unit, x.from)(scenario.ignition), ecin)
    for (let c = 0; c < x.count; c++)
      seeds.push({ unit: x.unit, from: x.from, task: x.task, slot, ecin, aerial, water: !aerial && !!spec.waterL, home, etaIgnition })
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
  const free = simulate(scenario, null).arrival // no plan gets the fire anywhere sooner
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

  /** Whether unit k can be at spot s: on a road it reaches before the fire (an aircraft over the fire before it passes), or where A had it. */
  const open = (k: number, s: number, ecin = units[k].ecin): boolean => {
    const u = units[k]
    const p = spots[s]
    if (s === u.home) return true
    if (u.aerial ? !p.air : !p.road) return false
    return at(free, s) > u.eta[s] - (ecin ? ecinGain : 0) + (u.aerial ? 0 : SAFETY_MIN)
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

  // A plan as a decision: one assignment per kind of unit and spot, in A's order, A's lines among them.
  const freshIds: string[] = []
  for (let i = 1; freshIds.length < n; i++) if (!(`p${i}` in a.points)) freshIds.push(`p${i}`)
  const build = (pos: Int32Array): { decision: Decision; feasible: boolean } => {
    const groups = new Map<string, { x: Assignment; slot: number; members: number[]; s: number }>()
    const names = new Map<number, string>()
    let fresh = 0
    for (let k = 0; k < n; k++) {
      const s = pos[k]
      if (s < 0) continue
      const u = units[k]
      if (!names.has(s)) names.set(s, spots[s].id ?? freshIds[fresh++])
      const key = `${s}|${u.unit}|${u.from}|${u.task}`
      const g = groups.get(key)
      if (g) {
        g.x.count++
        g.members.push(k)
        g.slot = Math.min(g.slot, u.slot)
      } else groups.set(key, { x: { unit: u.unit, count: 1, from: u.from, target: names.get(s)!, task: u.task }, slot: u.slot, members: [k], s })
    }
    const placed = [...groups.values()].sort((p, q) => p.slot - q.slot || q.x.count - p.x.count || p.s - q.s)
    const order = [...fixed.map((f) => ({ ...f, members: [] as number[] })), ...placed].sort((p, q) => p.slot - q.slot)
    // The first ground assignment of a station is its ECIN (fastModel.ts): a unit that only got
    // there in time as the ECIN and is not first any more has to be where the fire allows.
    const first = new Set<string>()
    let feasible = true
    for (const { x, members } of order) {
      if (isAerial(sup.units[x.unit])) continue
      const ecin = !first.has(x.from)
      first.add(x.from)
      if (!ecin) for (const k of members) if (units[k].ecin && !open(k, pos[k], false)) feasible = false
    }
    const lines = Object.fromEntries(fixed.filter(({ x }) => x.target in a.lines).map(({ x }) => [x.target, a.lines[x.target]]))
    const points = Object.fromEntries([...names].map(([s, id]) => [id, { lon: spots[s].lon, lat: spots[s].lat }]))
    return { decision: { id: 'B', name: ILS_NAME, points, lines, assignments: order.map(({ x }) => x) }, feasible }
  }

  // Identical units (same kind, station, task and A assignment) are interchangeable: one key per plan.
  const classOf = new Map<string, number[]>()
  units.forEach((u, k) => {
    const key = `${u.unit}|${u.from}|${u.task}|${u.slot}`
    classOf.set(key, [...(classOf.get(key) ?? []), k])
  })
  const classes = [...classOf.values()]
  const keyOf = (pos: Int32Array) => classes.map((ks) => ks.map((k) => pos[k]).sort((p, q) => p - q).join(',')).join(';')
  const memo = new Map<string, Score>()
  const used = (pos: Int32Array) => pos.reduce((m, s) => m + (s >= 0 ? 1 : 0), 0)
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
  const home = Int32Array.from(units, (u) => u.home)
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

  /** Moves of one unit to a spot around it (a tanker to another vehicle), and of the units on one spot together. */
  const moves = ({ pos, run }: State): Int32Array[] => {
    const out: Int32Array[] = []
    const together = new Map<number, number[]>()
    for (let k = 0; k < n; k++) {
      if (pos[k] < 0) continue
      together.set(pos[k], [...(together.get(pos[k]) ?? []), k])
      const targets = units[k].task === 'shuttle' ? shuttleTo(k, pos) : around([k], pos[k], run.arrival)
      for (const s of targets) {
        const next = pos.slice()
        next[k] = s
        out.push(next)
      }
    }
    for (const [s, members] of together) {
      if (members.length < 2) continue
      for (const t of around(members, s, run.arrival)) {
        const next = pos.slice()
        for (const k of members) next[k] = t
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
  const chunks = [...new Set(units.map((u) => u.slot))]
    .map((slot) => units.flatMap((u, k) => (u.slot === slot && u.task !== 'shuttle' ? [k] : [])))
    .filter((ks) => ks.length)
    .sort((p, q) => units[p[0]].etaIgnition - units[q[0]].etaIgnition)
  const shuttles = units.flatMap((u, k) => (u.task === 'shuttle' ? [k] : []))
  const construct = (): Int32Array => {
    const pos = new Int32Array(n).fill(-1)
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
  // 5 of them to the first spots the fire reaches or to the roads around the places it reaches.
  const perturb = ({ pos: from, run }: State): Int32Array => {
    const pos = from.slice()
    const placed = units.flatMap((_, k) => (pos[k] >= 0 ? [k] : []))
    const idle = units.flatMap((_, k) => (pos[k] < 0 ? [k] : []))
    const u = random()
    if (u < P_REMOVE && placed.length > 1) {
      const last = placed.reduce((p, q) => (units[q].eta[pos[q]] > units[p].eta[pos[p]] ? q : p))
      pos[last] = -1
      return pos
    }
    if (u < P_REMOVE + P_ADD && idle.length) {
      const k = pick(idle)
      const to = units[k].task === 'shuttle' ? shuttleTo(k, pos) : spread(k, byFree[k], RCL)
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
          : [...spread(k, byArrival, LN), ...threatened.flatMap((p) => guards[p].filter((s) => isOpen[k][s]).slice(0, PER_PLACE))]
      if (to.length) pos[k] = pick(to)
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

/** What became of A's units in B: kept, moved, left at the station; and B's units A did not have. */
export interface Change {
  kind: 'same' | 'moved' | 'removed' | 'added'
  unit: UnitId
  from: string
  task: Task
  count: number
  a?: LonLat // where it works in A, for units at a point
  b?: LonLat // and in B
  line?: string // the line, for line crews and drops
}

export function diffDecisions(a: Decision, b: Decision): Change[] {
  interface One {
    kind: string // unit, station, task, and the line it works
    unit: UnitId
    from: string
    task: Task
    p?: LonLat
    line?: string
  }
  const expand = (d: Decision): One[] =>
    d.assignments.flatMap((x) => {
      const p = d.points[x.target]
      const line = p ? undefined : x.target
      // A line is the same line only with the same clicks.
      const shape = line ? JSON.stringify(d.lines[line] ?? null) : ''
      const one: One = { kind: `${x.unit}|${x.from}|${x.task}|${line ?? ''}|${shape}`, unit: x.unit, from: x.from, task: x.task, p, line }
      return Array.from({ length: x.count }, () => one)
    })
  const changes = new Map<string, Change>()
  const add = (kind: Change['kind'], o: One, pa?: LonLat, pb?: LonLat) => {
    const key = [kind, o.kind, pa?.lon, pa?.lat, pb?.lon, pb?.lat].join('|')
    const seen = changes.get(key)
    if (seen) seen.count++
    else changes.set(key, { kind, unit: o.unit, from: o.from, task: o.task, count: 1, a: pa, b: pb, line: o.line })
  }
  const metres = (p?: LonLat, q?: LonLat) => (p && q ? distanceM(p, q) : 0)
  const fromA = expand(a)
  const fromB = expand(b)
  // Kept: the same kind of unit where it was; moved: the rest of A, each to the nearest of B of its kind.
  for (const pass of ['same', 'moved'] as const)
    for (let i = 0; i < fromA.length; i++) {
      const o = fromA[i]
      let j = -1
      fromB.forEach((x, k) => {
        if (x.kind !== o.kind) return
        const d = metres(o.p, x.p)
        if ((pass === 'moved' || d < 5) && (j < 0 || d < metres(o.p, fromB[j].p))) j = k
      })
      if (j < 0) continue
      add(pass === 'same' || !o.p ? 'same' : 'moved', o, o.p, fromB[j].p)
      fromA.splice(i--, 1)
      fromB.splice(j, 1)
    }
  for (const o of fromA) add('removed', o, o.p)
  for (const o of fromB) add('added', o, undefined, o.p)
  return [...changes.values()]
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
