// The replay as a list of camera shots, derived only from fire.json and the nearest stations:
// overview with the stations, ignition, one shot per observed step, a pass along the spread
// axis and the final balance. Each shot frames the area in play and says what to reveal.

import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import type { Pose } from './camera'
import type { Fire, NearStation, Progression, Step } from './data'
import { fmtDate, fmtHa, fmtHours, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { bboxCenter, bboxOf, bboxRadiusM, bearingDeg, compass, distanceM, lerpLonLat, type BBox, type LonLat } from './geo'

export type ShotKind = 'overview' | 'ignition' | 'spread' | 'axis' | 'balance'

export interface Shot {
  kind: ShotKind
  word: string // the big word on the HUD
  title: string // caption card
  caption: string
  place: LonLat // whose coordinates sit under the word
  step: number // last fire step shown, -1 before the ignition
  hours: number // fire clock once the camera arrives
  areaHa: number // burned area shown once the camera arrives
  untimed: boolean // also show the area with no time
  path: Pose[] // the camera arrives at path[0] and, while holding, travels the rest
  driftDeg: number // slow orbit while holding when the path is a single pose
  spot: number // spotlight radius, m
  moveS: number
  holdS: number
  reveal: string[] // marker ids that appear with this shot
}

export type MarkerKind = 'ignition' | 'step' | 'station'

export interface MarkerSpec extends LonLat {
  id: string
  kind: MarkerKind
  h: number
  badge: string
  label: string
  detail: string
  ringM: number
}

export interface Story {
  shots: Shot[]
  markers: MarkerSpec[]
}

const MARGIN = 1.3 // frame this much more than the area in play
const MARGIN_STEP = 1.45 // the new area of a step, with some of the scar around it
const MARGIN_OVERVIEW = 1.75 // stations near the frame edge would fall under the HUD panels
const MIN_RANGE_M = 1200
const SPOT = 1.25 // spotlight radius over half the framed diagonal

export function buildStory(fire: Fire, progression: Progression, stations: NearStation[], fovy: number): Story {
  const half = Math.tan(fovy / 2)
  const fit = (radiusM: number, margin = MARGIN) => Math.max(MIN_RANGE_M, (margin * radiusM) / half)
  const framed = (range: number) => (range * half) / MARGIN // ground radius a range shows
  const pose = (at: LonLat, heading: number, pitch: number, range: number): Pose => ({
    lon: at.lon,
    lat: at.lat,
    h: 0, // filled in by addHeights
    heading,
    pitch,
    range,
  })
  const clock = (hours: number) => wallClock(fire.start, hours)
  const steps = fire.steps
  const last = steps.at(-1)!

  // Where each step pushed the fire: the L3 spread direction, else from the previous step's new area.
  const headings: number[] = []
  for (const s of steps) {
    const period = fire.periods.find((p) => p.period === s.period)
    const prev = steps[s.step - 1]
    let heading = period?.spreadTowardDeg ?? undefined
    if (heading === undefined && prev && distanceM(prev.center, s.center) > 100) heading = bearingDeg(prev.center, s.center)
    headings.push(heading ?? headings.at(-1) ?? 0)
  }
  // Steps 1.. give the direction of step 0 too: the ignition shot looks where the fire went.
  headings[0] = headings[1] ?? 0

  const markers: MarkerSpec[] = []
  const shots: Shot[] = []

  // ---- overview, straight down, with the stations ----
  const ignition = fire.ignition
  const all = bboxOf([ignition, ...stations], [fire.bbox])
  const allR = bboxRadiusM(all)
  for (const s of stations) {
    const [prefix, ...name] = s.short.split(' ') // "BV Cabeceirenses": the prefix goes in the badge
    markers.push({
      id: `station:${s.id}`,
      kind: 'station',
      lon: s.lon,
      lat: s.lat,
      h: 0,
      badge: prefix,
      label: `${name.join(' ') || 'Bombeiros'} · ${fmtKm(s.km)}`,
      detail: 'em linha reta',
      ringM: 220,
    })
  }
  shots.push({
    kind: 'overview',
    word: 'Visão geral',
    title: `${fire.name} · ${fmtDate(clock(0))}`,
    caption: stations.length
      ? `${stations.length === 1 ? 'Um quartel' : `${stations.length} quartéis`} a menos de 20 km da ignição, em linha reta.`
      : 'Nenhum quartel a menos de 20 km da ignição.',
    place: bboxCenter(all),
    step: -1,
    hours: 0,
    areaHa: 0,
    untimed: false,
    path: [pose(bboxCenter(all), 0, -88, fit(allR, MARGIN_OVERVIEW))],
    driftDeg: 0,
    spot: SPOT * allR * 1.1,
    moveS: 5,
    holdS: 4,
    // The ignition too: it is where the distances are measured from.
    reveal: ['ignition:0', ...stations.map((s) => `station:${s.id}`)],
  })

  // ---- ignition ----
  fire.ignitions.forEach((ign, i) =>
    markers.push({
      id: `ignition:${i}`,
      kind: 'ignition',
      lon: ign.lon,
      lat: ign.lat,
      h: 0,
      badge: i === 0 ? 'I' : `I${i + 1}`,
      label: `${i === 0 ? 'Ignição' : 'Novo foco'} · ${fmtTime(clock(ign.hours))}`,
      detail: i === 0 ? fmtDate(clock(ign.hours)) : `+${fmtHa(ign.areaHa)}`,
      ringM: 140,
    }),
  )
  const ignitionRange = 2600
  shots.push({
    kind: 'ignition',
    word: 'Ignição',
    title: `Ignição · ${fmtTime(clock(0))}`,
    caption: `Primeiro polígono mapeado: ${fmtHa(steps[0].areaHa)}. A câmara olha para onde o fogo foi, para ${compass(headings[0])}.`,
    place: ignition,
    step: 0,
    hours: steps[0].hours,
    areaHa: steps[0].areaHa,
    untimed: false,
    path: [pose(ignition, headings[0], -32, ignitionRange)],
    driftDeg: 6,
    spot: SPOT * Math.max(framed(ignitionRange), 900),
    moveS: 5,
    holdS: 4,
    reveal: fire.ignitions.flatMap((ign, i) => (ign.hours <= steps[0].hours ? [`ignition:${i}`] : [])),
  })

  // ---- one shot per observed step ----
  for (const s of steps.slice(1)) {
    const prev = steps[s.step - 1]
    const period = fire.periods.find((p) => p.period === s.period)
    const dt = s.hours - prev.hours
    const growth = period?.growthHaPerH ?? (dt > 0 ? s.addedHa / dt : null)
    const newFoci = fire.ignitions.flatMap((ign, i) => (ign.hours > prev.hours && ign.hours <= s.hours ? [i] : []))
    markers.push({
      id: `step:${s.step}`,
      kind: 'step',
      lon: s.center.lon,
      lat: s.center.lat,
      h: 0,
      badge: String(s.step),
      label: `Passo ${s.step} · ${fmtTime(clock(s.hours))}`,
      detail: `+${fmtHa(s.addedHa)}`,
      ringM: 120,
    })
    const box = addedBox(progression, s)
    const r = bboxRadiusM(box)
    const parts = [
      `+${fmtHa(s.addedHa)} em ${fmtHours(dt)}`,
      growth !== null ? `${fmtNumber(growth)} ha/h` : null,
      `avança para ${compass(headings[s.step])}${period?.rosMPerH ? ` a ${Math.round(period.rosMPerH)} m/h` : ''}`,
      newFoci.length ? `${newFoci.length === 1 ? 'um novo foco' : `${newFoci.length} novos focos`}` : null,
    ]
    shots.push({
      kind: 'spread',
      word: 'Propagação',
      title: `Passo ${s.step} · ${fmtTime(clock(prev.hours))} → ${fmtTime(clock(s.hours))}`,
      caption: parts.filter(Boolean).join(' · ') + '.',
      place: s.center,
      step: s.step,
      hours: s.hours,
      areaHa: s.areaHa,
      untimed: false,
      path: [pose(bboxCenter(box), headings[s.step], -40, fit(r, MARGIN_STEP))],
      driftDeg: 6,
      spot: SPOT * r,
      moveS: 4,
      holdS: 4.5,
      reveal: [`step:${s.step}`, ...newFoci.map((i) => `ignition:${i}`)],
    })
  }

  // ---- along the spread axis: from the ignition to the step that got furthest from it ----
  const far = steps.reduce((a, b) => (distanceM(ignition, b.center) > distanceM(ignition, a.center) ? b : a))
  const axisM = distanceM(ignition, far.center)
  if (axisM > 600) {
    const axis = bearingDeg(ignition, far.center)
    const range = Math.min(4000, Math.max(2000, axisM * 0.6))
    shots.push({
      kind: 'axis',
      word: 'Eixo',
      title: 'Eixo de propagação',
      caption: `${fmtKm(axisM / 1000)} da ignição para ${compass(axis)} em ${fmtHours(far.hours)}.`,
      place: lerpLonLat(ignition, far.center, 0.5),
      step: last.step,
      hours: last.hours,
      areaHa: last.areaHa,
      untimed: false,
      path: [0, 0.25, 0.5, 0.75, 1].map((t) => pose(lerpLonLat(ignition, far.center, t), axis, -24, range)),
      driftDeg: 0,
      spot: SPOT * framed(range),
      moveS: 3.5,
      holdS: Math.max(7, axisM / 700),
      reveal: [],
    })
  }

  // ---- balance: the whole scar, including what has no time ----
  const total = fire.areaHa
  const r = bboxRadiusM(fire.bbox)
  const axis = bearingDeg(ignition, far.center)
  shots.push({
    kind: 'balance',
    word: 'Balanço',
    title: `Balanço · ${fmtHa(total.total)} · ${fmtHours(last.hours)} observadas`,
    caption: `${fmtHa(total.timed)} com hora · ${fmtHa(total.untimed)} sem hora (a cinzento), que o PT-FireSprd não consegue datar.`,
    place: bboxCenter(fire.bbox),
    step: last.step,
    hours: last.hours,
    areaHa: total.total,
    untimed: true,
    path: [pose(bboxCenter(fire.bbox), axis - 12, -55, fit(r))],
    driftDeg: 25,
    spot: SPOT * r,
    moveS: 4,
    holdS: 7,
    reveal: [],
  })

  return { shots, markers }
}

/** Box of the area a step added (outer rings of its new polygons); the perimeter box if it has none. */
function addedBox(progression: Progression, step: Step): BBox {
  const rings = (progression.increments[step.step] ?? []).map((polygon) => polygon[0])
  return rings.length ? bboxOf(rings.flat().map(([lon, lat]) => ({ lon, lat }))) : step.bbox
}

/** Puts every shot target and marker on the terrain, so the camera orbits the ground and not sea level. */
export async function addHeights(story: Story, terrain: TerrainProvider): Promise<void> {
  const points: { lon: number; lat: number; h: number }[] = [...story.shots.flatMap((s) => s.path), ...story.markers]
  const cartographics = points.map((p) => Cartographic.fromDegrees(p.lon, p.lat))
  await sampleTerrainMostDetailed(terrain, cartographics)
  cartographics.forEach((c, i) => (points[i].h = Number.isFinite(c.height) ? c.height : 0))
}
