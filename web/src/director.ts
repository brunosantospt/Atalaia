// Chronological incident playback. Every interval advances the incident clock by at most five
// minutes; the editor is a separate, paused working view. Only ELMFIRE can establish containment.
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
  const first = eta.length ? Math.min(...eta) : detection.droneMin
  const points = [fire.ignition]
  for (let i = 0; i < active.arrival.length; i += 5)
    if (active.arrival[i] <= stop) points.push(lonLatAt(grid, i % grid.cols, Math.floor(i / grid.cols)))
  const box = bboxOf(points)
  const centre = bboxCenter(box)
  const radius = Math.max(650, bboxRadiusM(box))
  const path = [{ ...centre, h: 0, heading: 0, pitch: -65, range: Math.max(1500, radius * 1.35 / Math.tan(fovy / 2)) }]
  const ignitionPath = [{ ...fire.ignition, h: 0, heading: 0, pitch: -50, range: 1500 }]
  const cache = new Map<number, number>()
  const area = (h: number) => {
    const m = Math.round(h * 60)
    if (!cache.has(m)) cache.set(m, burnedHa(grid, active, m))
    return `${runs ? id + ' · ' : ''}${fmtHa(cache.get(m)!)}`
  }
  type Event = { minute: number; kind: ShotKind; word: string; caption: string; gate?: Shot['gate'] }
  const events: Event[] = [
    { minute: 0, kind: 'ignition', word: 'Ignição', caption: 'Início do incêndio. A previsão avança com o relógio.' },
    { minute: first, kind: 'response', word: eta.length ? 'Primeiros meios' : 'Decidir resposta',
      caption: eta.length ? `Chega o primeiro meio da decisão ${id}.` : 'Abra o editor, coloque os meios e simule A e B no ELMFIRE.', gate: runs ? undefined : 'decision' },
    { minute: detection.satelliteMin, kind: 'checkpoint', word: 'Verificação satélite', caption: 'Verificação térmica no instante previsto para o satélite (hipótese do cenário).' },
  ]
  if (runs) {
    const control = end.minute !== null ? Math.max(first, end.minute) : Math.min(stop, Math.max(first, detection.satelliteMin) + 5)
    events.push({ minute: control, kind: 'control', word: end.minute !== null && end.minute <= stop ? 'Fogo controlado' : 'Combate em curso',
      caption: end.minute !== null && end.minute <= stop ? 'A previsão ELMFIRE deixa de atingir novas células; sem crescimento na última hora do cálculo.' : 'O ELMFIRE ainda não confirma contenção. Acompanhe a frente e ajuste a resposta.' })
  }
  if (shift !== undefined && shift <= stop)
    events.push({ minute: shift, kind: 'incident', word: 'Mudança de vento', caption: 'Atualizar a previsão ELMFIRE com o novo vento; depois rever as decisões.', gate: !post ? 'wind' : undefined })
  if (post && shift !== undefined && stop > shift + 5 && (end.minute === null || end.minute > shift + 5))
    events.push({ minute: shift + 5, kind: 'control', word: 'Resposta revista',
      caption: `Nova previsão ELMFIRE com a decisão ${id}. Acompanhe a frente até confirmar contenção.` })
  // End points include real milestones, so none can be skipped by an accelerated clock.
  const times = new Set([0, stop, ...events.filter(e => e.minute <= stop).map(e => e.minute)])
  for (let m = 5; m < stop; m += MAX_STEP_MIN) times.add(m)
  const ordered = [...times].sort((a, b) => a - b)
  let current = events[0]
  const shots: Shot[] = []
  for (let k = 0; k < ordered.length; k++) {
    const minute = ordered[k]
    const event = events.filter(e => Math.abs(e.minute - minute) < 1e-6).at(-1)
    if (event) current = event
    const to = ordered[k + 1] ?? minute
    shots.push({
      kind: current.kind, word: current.word, title: current.word,
      caption: current.caption, place: centre, simulated: true, step: -1,
      hours: minute / 60, hoursTo: to / 60, areaHa: 0, untimed: false,
      path: current.kind === 'ignition' ? ignitionPath : path, driftDeg: 0, spot: radius * 1.5,
      moveS: k === 0 ? 1.5 : 0.12, holdS: event ? 3 : 0.7,
      reveal: ['ignition:0'], conceal: [], decision: runs ? decision : undefined,
      milestone: !!event, gate: event?.gate, area,
    })
  }
  // The film ends in a three-footprint comparison only when the chosen response actually contains it.
  if ((post || shift === undefined) && runs && end.minute !== null) {
    const finalPath = outcomePose(input)
    shots.push({ ...shots.at(-1)!, kind: 'outcome', word: 'Área ardida', title: 'Sem decisão · decisão A · decisão B',
      caption: 'As três áreas sobrepõem-se rapidamente, da maior para a menor. Cores identificam cada cenário.',
      milestone: true, hours: stop / 60, hoursTo: stop / 60, moveS: 0.2, holdS: 4, gate: undefined,
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
