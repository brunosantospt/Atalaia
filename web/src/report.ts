// The report at the end of a run (or at a minute of it): what a decision left burned, from the
// arrival grid of a run (ELMFIRE) and the OSM context. Hectares, homes and villages reached
// with the minute the fire got there, and the roads it crossed.

import type { Run } from './scenario'
import { fmtHa, fmtNumber, fmtTime, wallClock } from './format'
import { cellHa, type Grid } from './grid'
import { roadLabel, type Context, type RoadClass } from './osm'

export interface PlaceHit {
  name: string
  kind: string
  minute: number
}

export interface RoadCut {
  label: string
  cls: RoadClass
  km: number
  minute: number // when the fire first crossed it
}

export interface Report {
  minutes: number
  burnedHa: number
  homes: number
  buildings: number
  firstHomeMin: number | null
  places: PlaceHit[] // reached, earliest first
  roadKm: Record<RoadClass, number>
  roadsCut: RoadCut[] // every road crossed, longest first; only named ones carry a name
}

/** A building is reached when the fire comes this close. Buildings are not fuel in the fire model, so the
 *  cells under them never burn: the report counts them by the burning ground around them instead, the
 *  same strip as the homes alert (alerts.ts, DL 124/2006). The spread itself is unchanged. */
export const BUILDING_REACH_M = 50

/** The cells of the grid that hold buildings, once per context. */
const buildingCells = new WeakMap<Context, Int32Array>()
function cellsWithBuildings(context: Context): Int32Array {
  let cells = buildingCells.get(context)
  if (!cells) {
    const list: number[] = []
    context.buildings.forEach((n, i) => n && list.push(i))
    cells = Int32Array.from(list)
    buildingCells.set(context, cells)
  }
  return cells
}

/** The first minute the fire comes within BUILDING_REACH_M of cell i (Infinity if never). */
function reachedAt(grid: Grid, arrival: Float32Array, i: number): number {
  const r = Math.ceil(BUILDING_REACH_M / grid.cellsize)
  const col = i % grid.cols, row = (i - col) / grid.cols
  let first = Infinity
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const c = col + dx, w = row + dy
    if (c < 0 || w < 0 || c >= grid.cols || w >= grid.rows || Math.hypot(dx, dy) * grid.cellsize > BUILDING_REACH_M) continue
    first = Math.min(first, arrival[w * grid.cols + c])
  }
  return first
}

export function makeReport(grid: Grid, context: Context, run: Run, minutes = run.durationMin): Report {
  const { arrival } = run
  let cells = 0
  for (let i = 0; i < arrival.length; i++) if (arrival[i] <= minutes) cells++
  let homes = 0
  let buildings = 0
  let firstHomeMin: number | null = null
  for (const i of cellsWithBuildings(context)) {
    const t = reachedAt(grid, arrival, i)
    if (t > minutes) continue
    buildings += context.buildings[i]
    if (context.homes[i]) {
      homes += context.homes[i]
      if (firstHomeMin === null || t < firstHomeMin) firstHomeMin = t
    }
  }

  const places: PlaceHit[] = []
  context.osm.places.forEach((p, k) => {
    let first = Infinity
    for (const i of context.placeCells[k]) if (arrival[i] < first) first = arrival[i]
    if (first <= minutes) places.push({ name: p.name, kind: p.kind, minute: first })
  })
  places.sort((a, b) => a.minute - b.minute)

  const roadKm: Record<RoadClass, number> = { paved: 0, track: 0, path: 0 }
  const roadsCut: RoadCut[] = []
  for (const { road, cells: rc, metres } of context.roadCells) {
    let m = 0
    let first = Infinity
    for (let k = 0; k < rc.length; k++) {
      const t = arrival[rc[k]]
      if (t > minutes) continue
      m += metres[k]
      if (t < first) first = t
    }
    if (!m) continue
    const r = context.osm.roads[road]
    roadKm[r.cls] += m / 1000
    roadsCut.push({ label: roadLabel(r), cls: r.cls, km: m / 1000, minute: first })
  }
  // The same named road is often many OSM ways: one line per name.
  const byLabel = new Map<string, RoadCut>()
  for (const cut of roadsCut) {
    const key = `${cut.cls}:${cut.label}`
    const seen = byLabel.get(key)
    if (seen) (seen.km += cut.km), (seen.minute = Math.min(seen.minute, cut.minute))
    else byLabel.set(key, { ...cut })
  }
  return {
    minutes,
    burnedHa: cells * cellHa(grid),
    homes,
    buildings,
    firstHomeMin,
    places,
    roadKm,
    roadsCut: [...byLabel.values()].sort((a, b) => b.km - a.km),
  }
}

/** Which of two decisions to recommend: the one that reaches fewer buildings, then the one that burns less. */
export interface Verdict {
  pick: 'A' | 'B' | null // null: nothing tells them apart
  by: 'buildings' | 'area' | 'tie'
}

/** "Recomenda-se a decisão B." */
export function describeVerdict(v: Verdict): string {
  return v.pick ? `Recomenda-se a decisão ${v.pick}.` : 'As duas decisões têm resultados equivalentes.'
}

export function recommend(a: Report, b: Report): Verdict {
  if (a.buildings !== b.buildings) return { pick: a.buildings < b.buildings ? 'A' : 'B', by: 'buildings' }
  if (Math.abs(a.burnedHa - b.burnedHa) >= 1) return { pick: a.burnedHa < b.burnedHa ? 'A' : 'B', by: 'area' }
  return { pick: null, by: 'tie' }
}

/** How a run ends: the minute the fire stopped and the area then, or not stopped by the end of the run. */
export interface FireEnd {
  minute: number | null // the last cell reached, when the fire has stopped; null when it still grows at the end
  burnedHa: number // at the end of the run
  edge: boolean // it reached the grid's border: the area is a minimum, and the fire did not stop there
  cutMin?: number // the run was cut at the cap, this minute: the fire was still growing
  capHa?: number
}

const QUIET_MIN = 60 // stopped: no new cell in the run's last hour

const ends = new WeakMap<Run, FireEnd>()
export function fireEnd(grid: Grid, run: Run): FireEnd {
  const known = ends.get(run)
  if (known) return known
  const { arrival, durationMin } = run
  let last = -Infinity
  let cells = 0
  let edge = false
  for (let i = 0; i < arrival.length; i++) {
    const t = arrival[i]
    if (!(t <= durationMin)) continue
    cells++
    if (t > last) last = t
    const col = i % grid.cols
    const row = (i - col) / grid.cols
    if (col === 0 || row === 0 || col === grid.cols - 1 || row === grid.rows - 1) edge = true
  }
  const end = { minute: !edge && last <= durationMin - QUIET_MIN ? Math.max(last, 0) : null, burnedHa: cells * cellHa(grid), edge }
  ends.set(run, end)
  return end
}

export const CAP_HA = 2000 // when fire.json has no referenceCapHa

/**
 * A simulated run cut where it has burned `capHa` (the browser draws every cell, so the scar stays light): cells
 * reached after that minute never burn, and the run ends there. A run that stays under the cap comes back as it is.
 * The cut run's end is the cut itself: judged on its arrival it would read as a fire that stopped there.
 */
export function capRun(grid: Grid, run: Run, capHa: number): Run {
  const limit = Math.ceil(capHa / cellHa(grid) - 1e-9)
  const reached = new Uint32Array(Math.ceil(run.durationMin) + 2)
  for (const a of run.arrival) if (a <= run.durationMin) reached[Math.max(0, Math.ceil(a))]++
  let cells = 0
  let cutMin = -1
  for (let m = 0; m < reached.length; m++) {
    cells += reached[m]
    if (cells >= limit) {
      cutMin = m
      break
    }
  }
  if (cutMin < 0) return run
  const arrival = run.arrival.map((a) => (a > cutMin ? Infinity : a))
  const cut: Run = { ...run, arrival, durationMin: cutMin }
  ends.set(cut, { minute: null, burnedHa: cells * cellHa(grid), edge: false, cutMin, capHa })
  return cut
}

/** "Extinto às 21:40 (T+11h 40min) · 820,0 ha", "Não extinto em 24 h · 1942,2 ha" */
export function describeEnd(end: FireEnd, start: string, durationMin: number): string {
  if (end.cutMin !== undefined) return `corte aos ${Math.round(end.capHa!)} ha (${fmtTime(wallClock(start, end.cutMin / 60))})`
  if (end.minute === null) {
    const hours = fmtNumber(durationMin / 60)
    return end.edge ? `Não extinto em ${hours} h · sai da grelha, mais de ${fmtHa(end.burnedHa)}` : `Não extinto em ${hours} h · ${fmtHa(end.burnedHa)}`
  }
  const m = Math.round(end.minute)
  return `Extinto às ${fmtTime(wallClock(start, m / 60))} (T+${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min) · ${fmtHa(end.burnedHa)}`
}

/** The hour the fire is over in a run: when it stopped, else the end of the run. */
export const endMinute = (grid: Grid, run: Run) => fireEnd(grid, run).minute ?? run.durationMin
