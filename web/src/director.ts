// The director's shots: after the observed replay, the decisions A and B as the editor holds
// them, played on the fast model. One shot per decision (its means on the ground at the hour
// the last of them arrives), A against B side by side as the fire runs to the end of the run,
// and the outcome with the recommendation. Built again whenever the decisions change.

import type { Pose } from './camera'
import type { Fire, NearStation } from './data'
import type { Reports, Runs } from './editor'
import { burnedHa } from './fastModel'
import { fmtHa, fmtKm, fmtTime, wallClock } from './format'
import { bboxCenter, bboxOf, bboxRadiusM, bearingDeg, distanceM, type LonLat } from './geo'
import { lonLatAt, type Grid } from './grid'
import { describeVerdict, recommend, type Report } from './report'
import type { Shot, ShotKind } from './shots'
import { arrivalMin, isAerial, type Decision, type Suppression } from './suppression'

const MARGIN = 1.35
const MIN_RANGE_M = 1500
const SPOT = 1.25
/** The kinds the director's cut keeps (key D): the 90 s of the demo, without the step-by-step observed spread. */
export const CUT: ShotKind[] = ['overview', 'ignition', 'known', 'reach', 'checkpoint', 'balance', 'decision', 'versus', 'outcome']

export function decisionShots(
  fire: Fire,
  grid: Grid,
  stations: NearStation[],
  sup: Suppression,
  decisions: [Decision, Decision],
  runs: Runs,
  reports: Reports | undefined,
  fovy: number,
): Shot[] {
  const half = Math.tan(fovy / 2)
  const fit = (radiusM: number) => Math.max(MIN_RANGE_M, (MARGIN * radiusM) / half)
  const pose = (at: LonLat, heading: number, pitch: number, range: number): Pose => ({ lon: at.lon, lat: at.lat, h: 0, heading, pitch, range })
  const clock = (hours: number) => fmtTime(wallClock(fire.start, hours))
  const ignition = fire.ignition
  const far = fire.steps.reduce((a, b) => (distanceM(ignition, b.center) > distanceM(ignition, a.center) ? b : a))
  const axis = distanceM(ignition, far.center) > 100 ? bearingDeg(ignition, far.center) : 0
  const durationMin = runs.A.durationMin
  const endH = durationMin / 60
  const areaOf = memo((run: 'free' | 'A' | 'B', minute: number) => burnedHa(grid, runs[run], minute))
  const shots: Shot[] = []

  // ---- one shot per decision: its means on the ground, the clock at the last arrival ----
  decisions.forEach((d, i) => {
    const id = d.id as 'A' | 'B'
    const targets = [...Object.values(d.points), ...Object.values(d.lines).flat()]
    const box = bboxOf([ignition, ...targets])
    const r = Math.max(bboxRadiusM(box), 600)
    let lastMin = 0
    const parts = d.assignments.map((a) => {
      const unit = sup.units[a.unit]
      const station = stations.find((s) => s.id === a.from)
      const target = d.points[a.target] ?? d.lines[a.target]?.[0]
      const km = isAerial(unit) || !station || !target ? sup.dispatch.airBaseKm : distanceM(station, target) / 1000
      const minutes = Math.round(arrivalMin(sup, unit, km, false))
      lastMin = Math.max(lastMin, minutes)
      return `${unit.short}×${a.count} ${isAerial(unit) ? 'da base aérea' : (station?.short ?? '')} T+${minutes} min`
    })
    const hours = Math.min(Math.max(lastMin, 15), durationMin) / 60
    shots.push({
      kind: 'decision',
      word: `Decisão ${id}`,
      title: `${id} · ${d.name}`,
      caption: parts.length
        ? `${parts.join(' · ')}. Às ${clock(hours)} o fogo tem ${fmtHa(areaOf(id, hours * 60))}; livre teria ${fmtHa(areaOf('free', hours * 60))}.`
        : 'Nada no terreno: o fogo corre livre. Abre o editor (E) e põe meios no mapa.',
      place: targets[0] ?? ignition,
      simulated: true,
      step: -1,
      hours,
      areaHa: areaOf(id, hours * 60),
      untimed: false,
      path: [pose(bboxCenter(box), axis, -45, fit(r))],
      driftDeg: 5,
      spot: SPOT * r,
      moveS: 4,
      holdS: 7,
      reveal: [],
      conceal: [],
      split: true,
      decision: i,
      area: (h) => `${id} ${fmtHa(areaOf(id, h * 60))}`,
    })
  })

  // ---- A against B, side by side, as the fire runs from the first shot's hour to the end ----
  const burned = burnedBox(grid, runs, durationMin) ?? bboxOf([ignition])
  const r = Math.max(bboxRadiusM(burned), 800)
  const fromH = Math.min(...shots.map((s) => s.hours), endH)
  const pair = (h: number) => `A ${fmtHa(areaOf('A', h * 60))} · B ${fmtHa(areaOf('B', h * 60))}`
  const verdict = reports && recommend(reports.A, reports.B)
  const line = (id: 'A' | 'B', rep: Report | undefined) =>
    `${id}: ${fmtHa(areaOf(id, durationMin))}${rep ? `, ${rep.places.length} ${rep.places.length === 1 ? 'lugar' : 'lugares'}` : ''}`
  shots.push({
    kind: 'versus',
    word: 'A vs B',
    title: `A vs B · ${fmtHa(areaOf('A', durationMin))} vs ${fmtHa(areaOf('B', durationMin))} às ${endH} h`,
    caption: `Arrasta a linha para comparar. Livre: ${fmtHa(areaOf('free', durationMin))}. ${line('A', reports?.A)}. ${line('B', reports?.B)}.`,
    place: bboxCenter(burned),
    simulated: true,
    step: -1,
    hours: fromH,
    areaHa: areaOf('A', durationMin),
    untimed: false,
    path: [pose(bboxCenter(burned), 0, -88, fit(r))],
    driftDeg: 0,
    spot: SPOT * r * 1.1,
    moveS: 4,
    holdS: 12,
    reveal: [],
    conceal: [],
    split: true,
    hoursTo: endH,
    area: pair,
  })

  // ---- the outcome: the recommendation and what it spares ----
  const pick = verdict?.pick ?? null
  const picked = pick && reports ? reports[pick] : undefined
  const roads = picked?.roadsCut.slice(0, 3).map((c) => `${c.label} ${fmtKm(c.km)}`) ?? []
  shots.push({
    kind: 'outcome',
    word: 'Resultado',
    title: verdict && reports ? describeVerdict(verdict, reports.A, reports.B) : `Resultado às ${endH} h`,
    caption: picked
      ? [
          picked.places.length ? `lugares atingidos ${picked.places.map((p) => `${p.name} T+${Math.round(p.minute)} min`).join(', ')}` : 'nenhum lugar atingido',
          picked.firstHomeMin === null ? 'nenhuma casa' : `1.ª casa T+${Math.round(picked.firstHomeMin)} min`,
          roads.length ? `estradas ${roads.join(', ')}` : 'nenhuma estrada cortada',
        ].join(' · ') + '. O motor físico confirma depois; isto é o modelo rápido.'
      : `${pair(endH)}. Sem dados OSM: a recomendação precisa dos lugares.`,
    place: bboxCenter(burned),
    simulated: true,
    step: -1,
    hours: endH,
    areaHa: areaOf(pick ?? 'A', durationMin),
    untimed: false,
    path: [pose(bboxCenter(burned), axis - 20, -58, fit(r))],
    driftDeg: 12,
    spot: SPOT * r,
    moveS: 4,
    holdS: 9,
    reveal: [],
    conceal: [],
    split: true,
    decision: pick === 'B' ? 1 : 0,
    area: pair,
  })
  return shots
}

/** Box of the cells burned by A or B by the end, sampled; undefined when nothing burned. */
function burnedBox(grid: Grid, runs: Runs, minutes: number) {
  const points: LonLat[] = []
  const every = 5
  for (const run of [runs.A, runs.B])
    for (let i = 0; i < run.arrival.length; i += every)
      if (run.arrival[i] <= minutes) points.push(lonLatAt(grid, i % grid.cols, Math.floor(i / grid.cols)))
  return points.length ? bboxOf(points) : undefined
}

/** Burned area by run and minute, computed once per minute asked (the HUD asks every frame). */
function memo(f: (run: 'free' | 'A' | 'B', minute: number) => number) {
  const cache = new Map<string, number>()
  return (run: 'free' | 'A' | 'B', minute: number) => {
    const m = Math.round(minute)
    const key = `${run}:${m}`
    let v = cache.get(key)
    if (v === undefined) cache.set(key, (v = f(run, m)))
    return v
  }
}
