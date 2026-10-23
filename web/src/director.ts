// Chronological incident playback. Every interval advances the incident clock by at most five
// minutes; the editor is a separate, paused working view. The simulated arrival field establishes containment.
import type { Fire, NearStation } from './data'
import type { Runs } from './editor'
import type { Detection } from './detection'
import { burnedHa, type Run } from './scenario'
import { fmtHa } from './format'
import { bboxCenter, bboxOf, bboxRadiusM } from './geo'
import { lonLatAt, type Grid } from './grid'
import { endMinute, fireEnd } from './report'
import type { Shot, ShotKind } from './shots'
import type { Decision, Suppression } from './suppression'
import { departures } from './unitMotion'
import { fieldIds } from './unitIdentity'
import { arrivals } from './wetLine'

export const CUT: ShotKind[] = ['ignition', 'response', 'checkpoint', 'control', 'incident', 'outcome']
export const MAX_STEP_MIN = 5
export interface IncidentInput {
  fire: Fire
  grid: Grid
  stations: NearStation[]
  suppression: Suppression
  detection: Detection
  decisions?: [Decision, Decision]
  runs?: Runs
  free: Run
  post: boolean
  decision: number
  fovy: number
}

export function incidentShots(input: IncidentInput): Shot[] {
  const { fire, grid, stations, suppression, detection, decisions, runs, free, post, decision, fovy } = input
  const id = decision === 1 ? 'B' : 'A'
  const active = runs?.[id] ?? free
  const end = fireEnd(grid, active)
  const shift = fire.windShift?.minutes
  // Before the incident, stop at the wind change. The next forecast is explicitly requested there.
  const stop = !post && shift !== undefined ? shift : Math.max(post ? shift ?? 0 : 0, endMinute(grid, active))
  const eta = decisions ? arrivals({ stations, suppression, dispatchMin: detection.droneMin }, decisions[decision]) : []
  const selected = decisions?.[decision]
  const dep = selected ? departures(suppression, selected, detection.droneMin) : []
  const ids = selected ? fieldIds(selected, stations) : []
  const first = eta.length ? Math.min(...eta) : detection.droneMin
  const points = [fire.ignition]
  for (let i = 0; i < active.arrival.length; i += 5)
    if (active.arrival[i] <= stop) points.push(lonLatAt(grid, i % grid.cols, Math.floor(i / grid.cols)))
  const box = bboxOf(points)
  const centre = bboxCenter(box)
  const radius = Math.max(650, bboxRadiusM(box))
  const path = [{ ...centre, h: 0, heading: 0, pitch: -65, range: Math.max(1500, radius * 1.35 / Math.tan(fovy / 2)) }]
  const firstTarget = selected && eta.length ? selected.points[selected.assignments[eta.indexOf(first)].target] ?? selected.lines[selected.assignments[eta.indexOf(first)].target]?.[0] : undefined
  // While the means drive out, a wider view that takes in the bases they leave from and the fire.
  const bases = selected ? selected.assignments.map(a => stations.find(st => st.id === a.from)).filter(st => !!st) : []
  const outBox = bboxOf([...points, ...bases.map(st => ({ lon: st!.lon, lat: st!.lat }))])
  const mobilizePath = bases.length ? [{ ...bboxCenter(outBox), h: 0, heading: 0, pitch: -70, range: Math.max(1800, bboxRadiusM(outBox) * 1.25 / Math.tan(fovy / 2)) }] : path
  const dispatchMin = selected ? Math.min(...selected.assignments.map(a => a.dispatchMin ?? detection.droneMin)) : Infinity
  const ignitionPath = [{ ...fire.ignition, h: 0, heading: 0, pitch: -58, range: 650 }]
  const arrivalPath = [{ ...(firstTarget ?? centre), h: 0, heading: 0, pitch: -60, range: 1100 }]
  const cache = new Map<number, number>()
  const area = (h: number) => {
    const m = Math.round(h * 60)
    if (!cache.has(m)) cache.set(m, burnedHa(grid, active, m))
    return `${runs ? id + ' · ' : ''}${fmtHa(cache.get(m)!)}`
  }
  type Event = { minute: number; kind: ShotKind; word: string; caption: string; gate?: Shot['gate'] }
  const events: Event[] = [
    { minute: 0, kind: 'ignition', word: 'Ignição', caption: 'Início do incêndio. A previsão avança com o relógio.' },
    ...(selected && eta.length ? [] : [{ minute: detection.droneMin, kind: 'response' as const, word: 'Decidir resposta',
      caption: 'Colocação dos meios e simulação com o modelo rápido.', gate: runs ? undefined : 'decision' as const }]),
    { minute: detection.satelliteMin, kind: 'checkpoint', word: 'Verificação satélite', caption: 'Verificação térmica no instante previsto para o satélite (hipótese do cenário).' },
  ]
  if (selected && eta.length) {
    const dispatch = Math.min(...selected.assignments.map(a => a.dispatchMin ?? detection.droneMin))
    events.push({ minute: dispatch, kind: 'response', word: 'Mobilização', caption: 'Os meios saem das suas bases e seguem para as posições.' })
    const labels = ids.filter((_,i)=>Math.abs(eta[i]-first)<1e-6).flat().join(', ')
    events.push({ minute:first,kind:'response',word:'Primeiros meios',caption:`${labels} no local. O combate continua com a expansão do fogo.` })

  }
  if (runs) {
    const control = end.minute !== null ? Math.max(first, end.minute) : Math.min(stop, Math.max(first, detection.satelliteMin) + 5)
    events.push({ minute: control, kind: 'control', word: end.minute !== null && end.minute <= stop ? 'Fogo controlado' : 'Combate em curso',
      caption: end.minute !== null && end.minute <= stop ? 'A previsão do modelo rápido deixa de atingir novas células; sem crescimento na última hora do cálculo.' : 'O modelo ainda não confirma contenção; a resposta pode ser ajustada.' })
  }
  if (shift !== undefined && shift <= stop)
    events.push({ minute: shift, kind: 'incident', word: 'Mudança de vento', caption: 'Revisão das decisões e nova simulação com o vento atual.', gate: !post ? 'wind' : undefined })
  if (post && shift !== undefined && stop > shift + 5 && (end.minute === null || end.minute > shift + 5))
    events.push({ minute: shift + 5, kind: 'control', word: 'Resposta revista',
      caption: `Nova previsão do modelo rápido com a decisão ${id}. Acompanhamento da frente até à contenção.` })
  // End points include real milestones, so none can be skipped by an accelerated clock.
  const times = new Set([0, stop, ...(firstTarget && first + 5 < stop ? [first + 5] : []), ...dep.filter(m => m <= stop), ...events.filter(e => e.minute <= stop).map(e => e.minute)])
  for (let m = 5; m < stop; m += MAX_STEP_MIN) times.add(m)
  const ordered = [...times].sort((a, b) => a - b)
  let current = events[0]
  const shots: Shot[] = []
  for (let k = 0; k < ordered.length; k++) {
    const minute = ordered[k]
    const matching = events.filter(e => Math.abs(e.minute - minute) < 1e-6)
    const event = matching.find(e => e.gate === 'arrival') ?? matching.at(-1)
    if (event) current = event
    const to = ordered[k + 1] ?? minute
    const close = !!firstTarget && minute >= first && minute < first + 5
    // Before the drone's alert: close on the ignition and quick (about 1–2 s in all); the alert pulls back out.
    const early = minute < detection.droneMin
    const shotPath = early ? ignitionPath : close ? arrivalPath : minute >= dispatchMin && minute < first ? mobilizePath : path
    const previousPath = shots.at(-1)?.path
    const cameraChange = !previousPath || previousPath !== shotPath
    shots.push({
      kind: current.kind, word: current.word, title: current.word,
      caption: current.caption, place: centre, simulated: true, step: -1,
      hours: minute / 60, hoursTo: to / 60, areaHa: 0, untimed: false,
      path: shotPath, driftDeg: 0, spot: radius * 1.5,
      moveS: cameraChange ? (early ? 0.8 : 1.5) : 0.001, holdS: early ? 0.4 : Math.max(0.5, (to-minute)*0.8),
      reveal: ['ignition:0'], conceal: [], decision: runs ? decision : undefined,
      milestone: !!event, gate: event?.gate, area,
    })
  }
  // Always show the aftermath; distinguish the forecast horizon from confirmed containment.
  if ((post || shift === undefined) && runs) {
    const finalPath = outcomePose(input)
    shots.push({ ...shots.at(-1)!, kind: 'outcome', word: 'Área ardida', title: 'Rescaldo',
      caption: `Rescaldo: sem decisão, decisão A e decisão B. ${end.minute === null ? 'Fim da previsão; contenção não confirmada.' : 'Contenção prevista pelo modelo.'}`,
      milestone: true, hours: stop / 60, hoursTo: stop / 60, moveS: 1.5, holdS: 4, gate: undefined,
      path: finalPath, spot: finalPath[0].range * Math.tan(fovy / 2) * 1.5, decision: undefined })
  } else if (post || shift === undefined) {
    const last = shots.at(-1)!
    last.caption = end.cutMin !== undefined ? 'Limite de área atingido. Contenção não confirmada.' : end.edge ? 'A frente saiu da grelha. Contenção não confirmada.' : 'Fim da previsão. Contenção não confirmada.'
  }
  return shots
}

function outcomePose({ fire, grid, runs, fovy }: IncidentInput) {
  const points = [fire.ignition]
  for (const run of Object.values(runs!))
    for (let i = 0; i < run.arrival.length; i += 5)
      if (run.arrival[i] <= run.durationMin) points.push(lonLatAt(grid, i % grid.cols, Math.floor(i / grid.cols)))
  const box = bboxOf(points)
  return [{ ...bboxCenter(box), h: 0, heading: 0, pitch: -88, range: Math.max(1500, 1.4 * bboxRadiusM(box) / Math.tan(fovy / 2)) }]
}
