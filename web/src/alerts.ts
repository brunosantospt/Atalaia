// Special alerts for the commander, read from the fast model's runs at the clock: homes the fire
// comes within 50 m of in the next hour (and villages, as the 6 h report counts them), units running
// out of water, a head rate of spread past the thresholds of the literature. prepareAlerts() does
// the work once per run (from rerun()); computeAlerts() only indexes it by minute, so the loop can
// call it every frame. Pure: no DOM, no Cesium.

import type { Station } from './data'
import type { Run, Scenario } from './fastModel'
import { fmtNumber } from './format'
import { distanceM, type LonLat } from './geo'
import { cellOf, lonLatAt, type Grid } from './grid'
import type { Context } from './osm'
import { arrivalMin, isAerial, refillMin, workMin, type Decision, type UnitSpec } from './suppression'

export type AlertKind = 'homes' | 'water' | 'ros' | 'wind'
export type AlertLevel = 'warning' | 'critical'

export interface Alert {
  id: string // stable while the condition lasts: the HUD rebuilds its list only when ids or levels change
  kind: AlertKind
  level: AlertLevel
  title: string
  detail: string
  source?: string // where the threshold comes from, for the tooltip
  at?: LonLat // where the camera flies on a click
}

/** Which run the screen shows: the free run, or the side of the split. */
export type AlertSide = 'free' | 'A' | 'B'

const CHAIN_M = 20.1168

/** The thresholds, each with its source (the tooltip shows it). */
export const RULES = {
  homesWindowMin: 60, // "risco iminente": reached within the hour
  homesCriticalMin: 30,
  homesBufferM: 50, // the fuel strip a home must keep around it (DL 124/2006, art. 15.º): fire there reaches the home
  waterLowFraction: 0.25, // a tank under a quarter
  rosWindowMin: 15, // head ROS: advance of the farthest front over the last 15 min
  rosHoldMin: 5, // the alert reads the highest ROS of the last 5 min, so it does not blink at the threshold
  rosWarnMPerMin: (50 * CHAIN_M) / 60, // 16.8 m/min: "very high", 50–150 ch/h (Scott & Burgan 2005)
  rosCriticalMPerMin: 50, // extreme wildfire event, ROS > 50 m/min (Tedim et al. 2018)
}

export const ROS_SOURCE =
  'Limiares: Tedim F. et al. (2018) Defining extreme wildfire events: difficulties, challenges, and impacts. ' +
  'Fire 1(1): 9, doi:10.3390/fire1010009 — incêndio extremo (EWE) com ROS > 50 m/min e I ≥ 10 000 kW/m, ' +
  'além da capacidade de controlo. Scott J.H. & Burgan R.E. (2005) Standard fire behavior fuel models. ' +
  'USDA Forest Service RMRS-GTR-153, tabela 5 — ROS "muito alta" 50–150 ch/h (16,8–50 m/min), "extrema" > 150 ch/h ' +
  '(classes para vento a meia-chama de 5 mi/h, combustível seco D2L2, sem declive). ' +
  'ROS da cabeça: avanço da frente mais distante da ignição nos últimos 15 min, no modelo rápido.'

const WATER_SOURCE =
  'Tanque e caudal de suppression.json (VFCI 3000 L a 200 L/min, VTTU 12 000 L a 400 L/min). Chegada como no modelo ' +
  'rápido: saída do quartel e distância em linha reta × fator de estrada, sem o percurso OSM do editor. Dois ou mais ' +
  'meios revezam-se no reabastecimento; um VTTU em abastecimento poupa-lhes a viagem ao ponto de água e, com o ' +
  'tanque gasto nessas recargas, vai reabastecer (contabilidade aproximada, que o modelo não usa).'

const PLACES_SOURCE = 'Lugares do OpenStreetMap (aldeias, lugarejos), atingidos quando o fogo entra no círculo de 250 m à sua volta, como no relatório das 6 h.'

const HOMES_SOURCE =
  'Habitações do OpenStreetMap. Em risco quando o fogo chega a menos de 50 m: a faixa de gestão de combustível ' +
  'à volta das edificações em espaço rural (DL 124/2006, art. 15.º; regime atual DL 82/2021). As casas em células ' +
  'não combustíveis não ardem no modelo rápido; é o fogo à sua volta que conta.'

interface RunAlerts {
  homeMin: Float32Array // minute the fire comes within homesBufferM of each home, ascending
  homeAt: LonLat[] // where each of them stands, same order
  homePlace: (string | undefined)[] // the named place it belongs to, if any is close
  placeMin: Float32Array // minute the fire comes within 250 m of each place it reaches (report.ts), ascending
  placeAt: (LonLat & { name: string })[] // and the place, same order
  headM: Float32Array // per minute: distance from the ignition of the farthest burned cell, m
  headAt: Int32Array // per minute: that cell, -1 before the fire starts
  ros: Float32Array // per minute: the highest head ROS of the last rosHoldMin minutes, m/min
  water: WaterTrack[]
  shuttles: Shuttle[]
}

/** Units of one assignment with a tank at a point, cycling between work and refill. */
interface WaterTrack {
  id: string
  label: string // "VFCI de BV Fafe", "2 VFCI de BV Fafe"
  target: string // id in Decision.points
  at: LonLat
  tankL: number
  units: number
  arrive: number // minute at work
  work: number // minutes of water in a tank
  refill: number // minutes away to refill
  shuttled: boolean
}

/** A tanker shuttling water to a point: the refills of the units there come out of its tank. */
interface Shuttle {
  id: string
  label: string
  at: LonLat
  capL: number
  arrive: number
  levelAt: Float32Array // litres left in its tank, per minute (NaN before it arrives)
  backAt: Float32Array // per minute: when it is back from its own refill, NaN while it is at the point
  drawL: number // the largest refill it serves, to say how many are left
}

export interface PreparedAlerts {
  grid: Grid
  durationMin: number
  names: Record<AlertSide, string>
  runs: Record<AlertSide, RunAlerts>
  cache?: { key: string; alerts: Alert[] }
}

export interface AlertInput {
  scenario: Scenario
  context: Context | undefined
  decisions: [Decision, Decision]
  runs: Record<AlertSide, Run>
}

/** Everything the alerts need from the three runs, once per rerun(). */
export function prepareAlerts({ scenario, context, decisions, runs }: AlertInput): PreparedAlerts {
  const { grid } = scenario
  const homes = context ? homesOf(grid, context) : []
  const [a, b] = decisions
  const prepare = (run: Run, decision: Decision | null): RunAlerts => {
    const ecin = decision ? ecinOf(scenario, decision) : []
    const water = decision && !scenario.suppression.unlimitedWater ? waterTracks(scenario, decision, ecin) : []
    return {
      ...homesReached(homes, run),
      ...placesReached(context, run),
      ...headOf(grid, scenario.ignition, run),
      water,
      shuttles: decision && !scenario.suppression.unlimitedWater ? shuttles(scenario, decision, ecin, water) : [],
    }
  }
  return {
    grid,
    durationMin: scenario.durationMin,
    names: { free: 'fogo livre', A: `decisão ${a.id}`, B: `decisão ${b.id}` },
    runs: { free: prepare(runs.free, null), A: prepare(runs.A, a), B: prepare(runs.B, b) },
  }
}

/** The alerts at `minute` of the run on the screen, critical first. Cached by whole minute and side. */
export function computeAlerts(prepared: PreparedAlerts, minute: number, side: AlertSide): Alert[] {
  const m = Math.floor(minute)
  if (!(m >= 0 && m <= prepared.durationMin)) return NONE // before the ignition, or past the runs
  const key = `${side}:${m}`
  if (prepared.cache?.key === key) return prepared.cache.alerts
  const run = prepared.runs[side]
  const name = prepared.names[side]
  const alerts: Alert[] = []
  const homes = homesAlert(run, m, name)
  if (homes) alerts.push(homes)
  const places = placesAlert(run, m, name)
  if (places) alerts.push(places)
  const ros = rosAlert(run, m, name, prepared.grid)
  if (ros) alerts.push(ros)
  for (const track of run.water) {
    const alert = waterAlert(track, m, name)
    if (alert) alerts.push(alert)
  }
  for (const shuttle of run.shuttles) {
    const alert = shuttleAlert(shuttle, m, name)
    if (alert) alerts.push(alert)
  }
  alerts.sort((x, y) => rank(y.level) - rank(x.level))
  prepared.cache = { key, alerts }
  return alerts
}

const NONE: Alert[] = []
export const rank = (level: AlertLevel) => (level === 'critical' ? 1 : 0)

// ---------- homes ----------

interface Home extends LonLat {
  cells: number[] // the cells within homesBufferM of it
  place: string | undefined
}

const PLACE_NAME_M = 1500

function homesOf(grid: Grid, context: Context): Home[] {
  const out: Home[] = []
  const { places } = context.osm
  for (const [lon, lat, home] of context.osm.buildings) {
    if (!home) continue
    const p = { lon, lat }
    const cell = cellOf(grid, p)
    if (cell < 0) continue
    const cells = around(grid, cell, RULES.homesBufferM)
    let place: string | undefined
    let best = PLACE_NAME_M
    for (const q of places) {
      const d = distanceM(p, q)
      if (d < best) (best = d), (place = q.name)
    }
    out.push({ lon, lat, cells, place })
  }
  return out
}

/** Cells whose centre lies within `radiusM` of the centre of `cell`. */
function around(grid: Grid, cell: number, radiusM: number): number[] {
  const { cols, rows, cellsize } = grid
  const c0 = cell % cols
  const r0 = (cell - c0) / cols
  const span = Math.floor(radiusM / cellsize)
  const out: number[] = []
  for (let r = r0 - span; r <= r0 + span; r++)
    for (let c = c0 - span; c <= c0 + span; c++)
      if (c >= 0 && r >= 0 && c < cols && r < rows && Math.hypot(c - c0, r - r0) * cellsize <= radiusM) out.push(r * cols + c)
  return out
}

function homesReached(homes: Home[], run: Run): Pick<RunAlerts, 'homeMin' | 'homeAt' | 'homePlace'> {
  const hit: { t: number; home: Home }[] = []
  for (const home of homes) {
    let t = Infinity
    for (const i of home.cells) t = Math.min(t, run.arrival[i])
    if (t <= run.durationMin) hit.push({ t, home })
  }
  hit.sort((x, y) => x.t - y.t)
  return {
    homeMin: Float32Array.from(hit, (h) => h.t),
    homeAt: hit.map(({ home: { lon, lat } }) => ({ lon, lat })),
    homePlace: hit.map((h) => h.home.place),
  }
}

/** Index of the first value above `t` in an ascending array. */
function above(values: Float32Array, t: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function homesAlert(run: RunAlerts, m: number, name: string): Alert | undefined {
  const first = above(run.homeMin, m)
  const n = above(run.homeMin, m + RULES.homesWindowMin) - first
  if (n <= 0) return undefined
  const soon = above(run.homeMin, m + RULES.homesCriticalMin) - first
  const inMin = Math.max(1, Math.ceil(run.homeMin[first] - m))
  const place = run.homePlace[first]
  const parts = [
    `primeira em ~${inMin} min${place ? ` · ${place}` : ''}`,
    soon ? `${soon} em menos de ${RULES.homesCriticalMin} min` : '',
    first ? `${first} já com fogo a < ${RULES.homesBufferM} m` : '',
    name,
  ]
  return {
    id: 'homes',
    kind: 'homes',
    level: soon ? 'critical' : 'warning',
    title: `${n} ${n === 1 ? 'habitação' : 'habitações'} em risco iminente (< 1 h)`,
    detail: parts.filter(Boolean).join(' · '),
    source: HOMES_SOURCE,
    at: run.homeAt[first],
  }
}

/** The places of the report (a 250 m disc around each, osm.ts) and when the fire first enters it. */
function placesReached(context: Context | undefined, run: Run): Pick<RunAlerts, 'placeMin' | 'placeAt'> {
  const hit: { t: number; at: LonLat & { name: string } }[] = []
  context?.osm.places.forEach((p, k) => {
    let t = Infinity
    for (const i of context.placeCells[k]) t = Math.min(t, run.arrival[i])
    if (t <= run.durationMin) hit.push({ t, at: { lon: p.lon, lat: p.lat, name: p.name } })
  })
  hit.sort((x, y) => x.t - y.t)
  return { placeMin: Float32Array.from(hit, (h) => h.t), placeAt: hit.map((h) => h.at) }
}

function placesAlert(run: RunAlerts, m: number, name: string): Alert | undefined {
  const first = above(run.placeMin, m)
  const n = above(run.placeMin, m + RULES.homesWindowMin) - first
  if (n <= 0) return undefined
  const inMin = Math.max(1, Math.ceil(run.placeMin[first] - m))
  const place = run.placeAt[first]
  const others = run.placeAt.slice(first + 1, first + n).map((p) => p.name)
  return {
    id: 'places',
    kind: 'homes',
    level: inMin < RULES.homesCriticalMin ? 'critical' : 'warning',
    title: n === 1 ? `${place.name}: fogo a < 250 m em ~${inMin} min` : `${n} lugares com fogo a < 250 m na próxima hora`,
    detail: [n === 1 ? '' : `${place.name} em ~${inMin} min`, others.length ? `depois ${others.join(', ')}` : '', name]
      .filter(Boolean)
      .join(' · '),
    source: PLACES_SOURCE,
    at: place,
  }
}

// ---------- rate of spread ----------

/** Per minute, the farthest cell burned from the ignition: its advance is the head's rate of spread. */
function headOf(grid: Grid, ignition: LonLat, run: Run): Pick<RunAlerts, 'headM' | 'headAt' | 'ros'> {
  const { cols, cellsize } = grid
  const minutes = run.durationMin + 1
  const headM = new Float32Array(minutes)
  const headAt = new Int32Array(minutes).fill(-1)
  const ros = new Float32Array(minutes)
  const start = cellOf(grid, ignition)
  if (start < 0) return { headM, headAt, ros }
  const c0 = start % cols
  const r0 = (start - c0) / cols
  const { arrival } = run
  // The farthest cell reached in each minute (a cell reached at 3.2 is burned from minute 4), then the running maximum.
  for (let i = 0; i < arrival.length; i++) {
    const t = arrival[i]
    if (!(t <= run.durationMin)) continue
    const m = Math.ceil(t)
    const c = i % cols
    const d = Math.hypot(c - c0, (i - c) / cols - r0) * cellsize
    if (headAt[m] < 0 || d > headM[m]) (headM[m] = d), (headAt[m] = i)
  }
  for (let m = 1; m < minutes; m++)
    if (headAt[m] < 0 || headM[m - 1] > headM[m]) (headM[m] = headM[m - 1]), (headAt[m] = headAt[m - 1])
  for (let m = 0; m < minutes; m++)
    for (let k = Math.max(0, m - RULES.rosHoldMin + 1); k <= m; k++) ros[m] = Math.max(ros[m], headRos(headM, k))
  return { headM, headAt, ros }
}

/** Head rate of spread at minute `m`, m/min, over the last rosWindowMin (less at the start). */
export function headRos(headM: Float32Array, m: number): number {
  const window = Math.min(RULES.rosWindowMin, m)
  if (window < 10) return 0 // the first minutes are the ignition and the grid's steps, not a front
  return (headM[m] - headM[m - window]) / window
}

function rosAlert(run: RunAlerts, m: number, name: string, grid: Grid): Alert | undefined {
  // Past the run's end the front is no longer known.
  if (m >= run.ros.length) return undefined
  const ros = run.ros[m]
  if (ros < RULES.rosWarnMPerMin) return undefined
  const critical = ros >= RULES.rosCriticalMPerMin
  const cell = run.headAt[m]
  return {
    id: 'ros',
    kind: 'ros',
    level: critical ? 'critical' : 'warning',
    title: `Propagação ${critical ? 'extrema' : 'muito rápida'} · ${fmtNumber(ros)} m/min`,
    detail: [
      `cabeça a ${fmtNumber((ros * 60) / 1000, 1)} km/h em ${RULES.rosWindowMin} min`,
      critical
        ? `> ${RULES.rosCriticalMPerMin} m/min: incêndio extremo, além da capacidade de controlo (Tedim et al. 2018)`
        : `> ${fmtNumber(RULES.rosWarnMPerMin, 1)} m/min: muito alta (Scott & Burgan 2005)`,
      name,
    ].join(' · '),
    source: ROS_SOURCE,
    at: cell >= 0 ? cellLonLat(grid, cell) : undefined,
  }
}

function cellLonLat(grid: Grid, cell: number): LonLat {
  const col = cell % grid.cols
  return lonLatAt(grid, col + 0.5, (cell - col) / grid.cols + 0.5)
}

// ---------- water ----------

/** Per assignment, whether it leaves as its station's ECIN (out in 2 min): the first ground unit of a station, as the model has it. */
function ecinOf({ suppression: sup }: Scenario, decision: Decision): boolean[] {
  const used = new Set<string>()
  return decision.assignments.map((a) => {
    if (isAerial(sup.units[a.unit])) return false
    const first = !used.has(a.from)
    used.add(a.from)
    return first
  })
}

/** The units with a tank at a point, their arrival as the fast model counts it (fastModel.ts apply()). */
function waterTracks(scenario: Scenario, decision: Decision, ecin: boolean[]): WaterTrack[] {
  const { grid: g, stations, suppression: sup } = scenario
  const shuttled = new Set(decision.assignments.filter((a) => a.task === 'shuttle').map((a) => a.target))
  const tracks: WaterTrack[] = []
  decision.assignments.forEach((a, k) => {
    const unit = sup.units[a.unit]
    if (isAerial(unit) || (a.task !== 'direct' && a.task !== 'protect')) return
    const work = workMin(unit)
    const point = decision.points[a.target]
    if (work === Infinity || !point || cellOf(g, point) < 0 || a.count < 1) return
    const station = stations.find((s) => s.id === a.from)
    const km = station ? distanceM(station, point) / 1000 : sup.dispatch.airBaseKm
    const isShuttled = shuttled.has(a.target)
    tracks.push({
      id: `water:${decision.id}:${k}`,
      label: unitLabel(unit, a.count, station),
      target: a.target,
      at: point,
      tankL: unit.waterL ?? 0,
      units: a.count,
      arrive: arrivalMin(sup, unit, km, ecin[k]),
      work,
      refill: refillMin(unit, isShuttled ? 0 : sup.dispatch.waterPointKm),
      shuttled: isShuttled,
    })
  })
  return tracks
}

const unitLabel = (unit: UnitSpec, count: number, station: Station | undefined) =>
  `${count > 1 ? `${count} ` : ''}${unit.short}${station ? ` de ${station.short}` : ''}`

/**
 * Minutes of water left in each tank of a track at minute `m`, or minus the minutes until it is back
 * when it is away refilling. Two or more units take turns to refill (as the model has it): unit k
 * starts its first cycle k/n of a cycle late, with a full tank in reserve until then.
 */
function tanks(track: WaterTrack, m: number): number[] {
  const cycle = track.work + track.refill
  const out: number[] = []
  for (let k = 0; k < track.units; k++) {
    const s = m - track.arrive - (track.units > 1 ? (k * cycle) / track.units : 0)
    if (s < 0) {
      out.push(track.work)
      continue
    }
    const phase = s % cycle
    out.push(phase < track.work ? track.work - phase : phase - cycle)
  }
  return out
}

/** Refills the units of a track start, up to `until`: [minute, litres]. */
function refills(track: WaterTrack, unitL: number, until: number): [number, number][] {
  const cycle = track.work + track.refill
  const out: [number, number][] = []
  for (let k = 0; k < track.units; k++) {
    const offset = track.units > 1 ? (k * cycle) / track.units : 0
    for (let t = track.arrive + offset + track.work; t < until; t += cycle) out.push([t, unitL])
  }
  return out
}

function waterAlert(track: WaterTrack, m: number, name: string): Alert | undefined {
  if (m < track.arrive) return undefined
  const left = tanks(track, m)
  const wet = left.filter((x) => x > 0)
  const low = track.work * RULES.waterLowFraction
  const refillText = track.shuttled ? 'reabastece no VTTU do ponto' : 'sem VTTU em abastecimento: vai ao ponto de água'
  if (wet.length === 0) {
    const back = Math.max(1, Math.ceil(-Math.max(...left)))
    return {
      id: track.id,
      kind: 'water',
      level: 'critical',
      title: `${track.label} sem água`,
      detail: `frente sem água ~${back} min · ${refillText} · ${name}`,
      source: WATER_SOURCE,
      at: track.at,
    }
  }
  // Low: the fullest tank under a quarter, with none of the others back before it runs dry.
  const most = Math.max(...wet)
  const returning = left.filter((x) => x <= 0).map((x) => -x)
  if (most >= low || (returning.length && Math.min(...returning) <= most)) return undefined
  return {
    id: track.id,
    kind: 'water',
    level: 'warning',
    title: `${track.label} com pouca água · ~${Math.max(1, Math.floor(most))} min`,
    detail: `menos de ${Math.round(RULES.waterLowFraction * 100)} % do tanque · ${refillText} · ${name}`,
    source: WATER_SOURCE,
    at: track.at,
  }
}

/**
 * The tankers shuttling water: each refill of the units at their point comes out of the tank, roughly.
 * When it cannot give a full one more, the tanker leaves to refill itself and comes back full; the
 * model keeps the units' refills short meanwhile, so this only warns.
 */
function shuttles(scenario: Scenario, decision: Decision, ecin: boolean[], water: WaterTrack[]): Shuttle[] {
  const { stations, suppression: sup, durationMin } = scenario
  const out: Shuttle[] = []
  const byTarget = new Map<string, number[]>()
  decision.assignments.forEach((a, k) => {
    if (a.task === 'shuttle' && decision.points[a.target]) byTarget.set(a.target, [...(byTarget.get(a.target) ?? []), k])
  })
  for (const [target, ks] of byTarget) {
    const point = decision.points[target]
    const first = decision.assignments[ks[0]]
    const tanker = sup.units[first.unit]
    if (!tanker.waterL) continue
    let capL = 0
    let arrive = Infinity
    for (const k of ks) {
      const a = decision.assignments[k]
      const unit = sup.units[a.unit]
      const station = stations.find((s) => s.id === a.from)
      const km = station ? distanceM(station, point) / 1000 : sup.dispatch.airBaseKm
      capL += (unit.waterL ?? 0) * a.count
      arrive = Math.min(arrive, arrivalMin(sup, unit, km, ecin[k]))
    }
    const draws = water
      .filter((t) => t.target === target)
      .flatMap((t) => refills(t, t.tankL, durationMin + 1))
      .sort((x, y) => x[0] - y[0])
    if (!draws.length || capL <= 0) continue
    const drawL = Math.max(...draws.map((d) => d[1]))
    const away = refillMin(tanker, sup.dispatch.waterPointKm)
    const levelAt = new Float32Array(durationMin + 1).fill(NaN)
    const backAt = new Float32Array(durationMin + 1).fill(NaN)
    let level = capL
    let back = -Infinity // minute it is back from its own refill
    let d = 0
    for (let m = Math.ceil(arrive); m <= durationMin; m++) {
      for (; d < draws.length && draws[d][0] <= m; d++) {
        const [t, litres] = draws[d]
        if (t < arrive || t < back) continue // not there yet, or away
        level -= litres
        if (level < drawL) (back = t + away), (level = capL)
      }
      if (m < back) backAt[m] = back
      else levelAt[m] = level
    }
    const station = stations.find((s) => s.id === first.from)
    out.push({
      id: `shuttle:${decision.id}:${target}`,
      label: unitLabel(tanker, ks.reduce((n, k) => n + decision.assignments[k].count, 0), station),
      at: point,
      capL,
      arrive,
      levelAt,
      backAt,
      drawL,
    })
  }
  return out
}

function shuttleAlert(shuttle: Shuttle, m: number, name: string): Alert | undefined {
  if (m >= shuttle.levelAt.length) return undefined
  const back = shuttle.backAt[m]
  if (!Number.isNaN(back)) {
    return {
      id: shuttle.id,
      kind: 'water',
      level: 'warning',
      title: `${shuttle.label} (abastecimento) foi reabastecer`,
      detail: `volta em ~${Math.max(1, Math.ceil(back - m))} min · ${name}`,
      source: WATER_SOURCE,
      at: shuttle.at,
    }
  }
  // Low: a quarter of the tank, or no more than one refill left.
  const level = shuttle.levelAt[m]
  if (Number.isNaN(level) || level >= Math.max(shuttle.capL * RULES.waterLowFraction, 2 * shuttle.drawL)) return undefined
  const left = Math.floor(level / shuttle.drawL)
  return {
    id: shuttle.id,
    kind: 'water',
    level: 'warning',
    title: `${shuttle.label} (abastecimento) com pouca água`,
    detail: `${fmtNumber(level)} L · ${left === 1 ? '1 recarga' : `${left} recargas`} até ir reabastecer · ${name}`,
    source: WATER_SOURCE,
    at: shuttle.at,
  }
}
