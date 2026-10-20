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
  rosFactor: number // ROS the fire keeps inside the unit's radius while it holds
  radiusM: number // front covered from the access point, per unit
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
