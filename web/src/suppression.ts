// The suppression palette: what each kind of unit can do, from public/suppression.json
// (every value has its source there), and the formulas the fast model (fastModel.ts) and
// the decisions A/B apply with them. A decision is a list of assignments of units to a
// point or a line; the model turns each one into attenuation of the fire on the ground.

import type { LonLat } from './geo'

export type UnitId = 'crew' | 'vfci' | 'vttu' | 'hebl' | 'avbp'
export type Task = 'direct' | 'line' | 'drops' | 'protect' | 'shuttle'

export interface UnitSpec {
  name: string
  short: string
  people: number
  holdFlameM: number // the unit holds the fire up to this flame length (Byram)
  holdIntensityKWPerM: number
  rosFactor: number // ROS the fire keeps on the front the unit holds (the edge it has put out)
  radiusM: number // front held from the access point on arrival, per unit
  attackMPerH?: number // ground, with water: front put out per hour of work, per unit (a crew uses lineMPerH)
  reachM?: number // ground: how far from the access point the unit can work (track and hose)
  wetLineLengthM?: number // ground: line laid across the spread at a point, per unit (wetLine.ts)
  wetLineWidthM?: number // ground: its width; a crew's dug line too
  followsEdge?: boolean // ground, at a point: goes on extending its line along the fire edge at attackMPerH (wetLine.ts)
  maxWorkH?: number // ... for this many hours after arriving (a shift)
  speedKmh: number // by road, or in the air
  waterL?: number
  flowLPerMin?: number
  refillMin?: number
  refillKmh?: number
  holdMin?: number // aerial: how long a drop keeps the fire slowed
  cycleMin?: number // aerial: fixed part of the drop cycle
  dropM?: [number, number]
  turnoutMin?: number // aerial: from the call to take-off
  maxRunwayMin?: number
  lineMPerH?: number[] // crew: fireline built per hour, by fuel class of fuel.json
}

export interface Suppression {
  notes: string
  flame: { byramA: number; byramB: number; heatYieldKJPerKg: number }
  hirsch: { a: number; b: number; c: number; d: number }
  dispatch: { ecinTurnoutMin: number; volunteerTurnoutMin: number; roadFactor: number; waterPointKm: number; airBaseKm: number }
  units: Record<UnitId, UnitSpec>
  sources: Record<string, string>
}

/** One line of a decision: `count` units of a kind, from a station, working a point or a line. */
export interface Assignment {
  unit: UnitId
  count: number
  from: string // station id (data.ts), or anything else for an air base
  target: string // id in Decision.points (direct, protect, shuttle) or Decision.lines (line, drops)
  task: Task
  dispatchMin?: number // T+ when ordered out; omitted in older examples
  wetLineBearingDeg?: number // line axis clockwise from north, 0..179; omitted = across spread
}

export interface Decision {
  id: string // 'A' | 'B'
  name: string
  points: Record<string, LonLat> // access points
  lines: Record<string, LonLat[]> // containment lines, as drawn by clicks
  assignments: Assignment[]
}

export async function loadSuppression(): Promise<Suppression> {
  const response = await fetch('/suppression.json')
  if (!response.ok) throw new Error(`/suppression.json: HTTP ${response.status}`)
  return response.json() as Promise<Suppression>
}

/** Byram's fireline intensity, kW/m, from the fine fuel load (kg/m²) and the rate of spread (m/min). */
export function intensityKWPerM(sup: Suppression, loadKgPerM2: number, rosMPerMin: number): number {
  return (sup.flame.heatYieldKJPerKg * loadKgPerM2 * rosMPerMin) / 60
}

/** Byram's flame length, m. */
export function flameLengthM(sup: Suppression, intensityKWPerM: number): number {
  return sup.flame.byramA * Math.pow(Math.max(intensityKWPerM, 0), sup.flame.byramB)
}

/** Whether a unit can hold a front of this flame length. */
export function holds(unit: UnitSpec, flameM: number): boolean {
  return flameM <= unit.holdFlameM
}

/** Minutes a unit works before its tank is empty; Infinity for a unit without water (a crew). */
export function workMin(unit: UnitSpec): number {
  return unit.waterL && unit.flowLPerMin ? unit.waterL / unit.flowLPerMin : Infinity
}

/** Minutes away from the fire to refill: the fixed part plus the round trip to the water point. */
export function refillMin(unit: UnitSpec, waterKm: number): number {
  if (!unit.refillMin || !unit.refillKmh) return 0
  return unit.refillMin + (2 * waterKm * 60) / unit.refillKmh
}

/** Aerial: minutes between two drops of one aircraft, the fixed part plus the round trip to the water. */
export function dropCycleMin(unit: UnitSpec, waterKm: number): number {
  return (unit.cycleMin ?? 0) + (2 * waterKm * 60) / unit.speedKmh
}

/** Fraction of the time a unit with water is on the fire, the rest being the trip to refill (1 for a crew). */
export function dutyCycle(unit: UnitSpec, waterKm: number): number {
  const work = workMin(unit)
  return work === Infinity ? 1 : work / (work + refillMin(unit, waterKm))
}

/** Ground: metres of front one unit puts out per hour, in a fuel class of fuel.json. */
export function attackMPerH(unit: UnitSpec, fuelClass: number): number {
  return unit.attackMPerH ?? unit.lineMPerH?.[fuelClass] ?? 0
}

/** Aerial: metres of front the drops of `count` aircraft keep slowed at any time, cycling to the water. */
export function aerialFrontM(unit: UnitSpec, count: number, waterKm: number): number {
  if (!unit.holdMin || !unit.dropM) return 0
  return (unit.dropM[0] * unit.holdMin * count) / dropCycleMin(unit, waterKm)
}

/** Whether a unit flies: its turnout is its own, not the station's. */
export const isAerial = (unit: UnitSpec) => unit.turnoutMin !== undefined

/** Minutes from the call until the units work: turnout plus the road, or the flight, from `km` away. */
export function arrivalMin(sup: Suppression, unit: UnitSpec, km: number, ecin: boolean): number {
  const turnout = unit.turnoutMin ?? (ecin ? sup.dispatch.ecinTurnoutMin : sup.dispatch.volunteerTurnoutMin)
  const factor = unit.turnoutMin !== undefined ? 1 : sup.dispatch.roadFactor // the air goes straight
  return turnout + (factor * km * 60) / unit.speedKmh
}

/** Hirsch et al. 1998: probability of containment by the initial attack, from the area (ha) and intensity at arrival. */
export function containmentProbability(sup: Suppression, areaHa: number, intensityKWPerM: number): number {
  const { a, b, c, d } = sup.hirsch
  const e = Math.exp(a + b * areaHa + c * intensityKWPerM + d * areaHa * intensityKWPerM)
  return e / (1 + e)
}
