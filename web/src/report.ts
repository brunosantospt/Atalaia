// The report at the end of a run (6 h by default): what a decision left burned, from the
// arrival grid of the fast model and the OSM context. Hectares, homes and villages reached
// with the minute the fire got there, and the roads it crossed.

import type { Run } from './fastModel'
import { fmtHa, fmtNumber } from './format'
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

export function makeReport(grid: Grid, context: Context, run: Run, minutes = run.durationMin): Report {
  const { arrival } = run
  let cells = 0
  let homes = 0
  let buildings = 0
  let firstHomeMin: number | null = null
  for (let i = 0; i < arrival.length; i++) {
    const t = arrival[i]
    if (t > minutes) continue
    cells++
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

/** Which of two decisions to recommend: the one that reaches fewer places, then the one that burns less. */
export interface Verdict {
  pick: 'A' | 'B' | null // null: nothing tells them apart
  by: 'places' | 'area' | 'tie'
}

/** "Recomendação: A · não atinge nenhum lugar em vez de 4 às 6,0 h" */
export function describeVerdict(v: Verdict, a: Report, b: Report): string {
  if (!v.pick) return `Recomendação: empate · ${a.places.length} lugares e ${fmtHa(a.burnedHa)} em ambas`
  const [mine, other] = v.pick === 'A' ? [a, b] : [b, a]
  const why =
    v.by === 'places'
      ? `${placesText(mine.places.length)} em vez de ${other.places.length}`
      : `os mesmos lugares, ${fmtHa(mine.burnedHa)} em vez de ${fmtHa(other.burnedHa)}`
  return `Recomendação: ${v.pick} · ${why} às ${fmtNumber(mine.minutes / 60, 1)} h`
}

const placesText = (n: number) => (n === 0 ? 'não atinge nenhum lugar' : `atinge ${n} ${n === 1 ? 'lugar' : 'lugares'}`)

export function recommend(a: Report, b: Report): Verdict {
  if (a.places.length !== b.places.length) return { pick: a.places.length < b.places.length ? 'A' : 'B', by: 'places' }
  if (Math.abs(a.burnedHa - b.burnedHa) >= 1) return { pick: a.burnedHa < b.burnedHa ? 'A' : 'B', by: 'area' }
  return { pick: null, by: 'tie' }
}
