// The director's shots: the opening (shots.ts: the drone's sighting, the satellite's, the first ELMFIRE
// prediction), then the decisions A and B as the last ELMFIRE simulation ran them. One
// shot per decision (its means on the ground at the hour the last of them arrives), A against B
// side by side as the fire runs until the later of the two stops, and the outcome with the
// recommendation and when each fire is out. Built again whenever the decisions change.

import type { Pose } from './camera'
import type { Fire, NearStation } from './data'
import type { Reports, Runs } from './editor'
import { burnedHa } from './fastModel'
import { fmtHa, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { bboxCenter, bboxOf, bboxRadiusM, bearingDeg, distanceM, type LonLat } from './geo'
import { lonLatAt, type Grid } from './grid'
import { describeEnd, describeVerdict, endMinute, fireEnd, recommend, type Report } from './report'
import type { Shot, ShotKind } from './shots'
import { arrivalMin, isAerial, type Decision, type Suppression } from './suppression'
import { findAirBase } from './airBases'

const MARGIN = 1.35
const MIN_RANGE_M = 1500
const SPOT = 1.25
/** The kinds the director's cut keeps (key D): the 90 s of the demo, without the step-by-step observed spread. */
export const CUT: ShotKind[] = ['known', 'checkpoint', 'prediction', 'overview', 'ignition', 'reach', 'incident', 'balance', 'decision', 'versus', 'outcome']

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
  // The clock runs until both fires are out, or to the end of the runs.
  const durationMin = Math.max(endMinute(grid, runs.A), endMinute(grid, runs.B))
  const endH = durationMin / 60
  const end = (id: 'free' | 'A' | 'B') => describeEnd(fireEnd(grid, runs[id]), fire.start, runs[id].durationMin)
  const engine = `Simulado com ${runs.A.engine ?? 'ELMFIRE'}.`
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
      const base = isAerial(unit) ? findAirBase(a.from) : undefined
      const target = d.points[a.target] ?? d.lines[a.target]?.[0]
      const km = isAerial(unit)
        ? (base && target ? distanceM(base, target) / 1000 : sup.dispatch.airBaseKm)
        : !station || !target ? sup.dispatch.airBaseKm : distanceM(station, target) / 1000
      const minutes = Math.round(arrivalMin(sup, unit, km, false))
      lastMin = Math.max(lastMin, minutes)
      const fromName = isAerial(unit) ? (base?.short ?? 'da base aérea') : (station?.short ?? '')
      return `${unit.short}×${a.count} ${fromName} T+${minutes} min`
    })
    const hours = Math.min(Math.max(lastMin, 15), durationMin) / 60
    shots.push({
      kind: 'decision',
      word: `Decisão ${id}`,
      title: `${id} · ${d.name}`,
      caption: parts.length
        ? `${parts.join(' · ')}. Às ${clock(hours)} o fogo tem ${fmtHa(areaOf(id, hours * 60))}; livre teria ${fmtHa(areaOf('free', hours * 60))}.`
        : 'Nada no terreno: o fogo corre livre. Abre o editor (E), põe meios no mapa e simula no ELMFIRE.',
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
  const places = (id: 'A' | 'B', rep: Report | undefined) =>
    rep ? ` ${id} atinge ${rep.places.length} ${rep.places.length === 1 ? 'lugar' : 'lugares'}${rep.minutes < durationMin ? ` às ${fmtNumber(rep.minutes / 60)} h` : ''}.` : ''
  shots.push({
    kind: 'versus',
    word: 'A vs B',
    title: `A vs B · ${fmtHa(fireEnd(grid, runs.A).burnedHa)} vs ${fmtHa(fireEnd(grid, runs.B).burnedHa)}`,
    caption: `Arrasta a linha para comparar. A: ${end('A')}. B: ${end('B')}. Livre: ${end('free')}.${places('A', reports?.A)}${places('B', reports?.B)}`,
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
    title: verdict && reports ? describeVerdict(verdict, reports.A, reports.B) : `A: ${end('A')}`,
    caption:
      `A: ${end('A')}. B: ${end('B')}. ` +
      (picked
        ? [
            picked.places.length ? `lugares atingidos ${picked.places.map((p) => `${p.name} T+${Math.round(p.minute)} min`).join(', ')}` : 'nenhum lugar atingido',
            picked.firstHomeMin === null ? 'nenhuma casa' : `1.ª casa T+${Math.round(picked.firstHomeMin)} min`,
            roads.length ? `estradas ${roads.join(', ')}` : 'nenhuma estrada cortada',
          ].join(' · ') + `. ${engine}`
        : `Sem dados OSM: a recomendação precisa dos lugares. ${engine}`),
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
