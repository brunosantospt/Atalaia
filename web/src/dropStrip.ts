// An aircraft's drop: a thin ellipse laid across the fire's spread (the axis wet lines take), not a circle.
// Same area as the circle of radiusM it replaces, eight times longer than wide; the fire model and the
// map both read it from here, so what is drawn is where the fire is slowed.
import type { LonLat } from './geo'
import type { Scenario } from './scenario'
import type { Assignment } from './suppression'
import { wetLineBearing } from './wetLine'

const ASPECT = 8 // length : width

export interface DropStrip { axisDeg: number; lengthM: number; widthM: number
  /** Offsets in metres east/north of the centre (TM06). */
  contains(dx: number, dy: number): boolean }

export function dropStrip(scenario: Scenario, a: Assignment, at: LonLat, radiusM: number): DropStrip {
  const axisDeg = scenario.fireArrival ? wetLineBearing(scenario, scenario.fireArrival, at, a) : 90
  // π·(L/2)·(W/2) = π·r², L = ASPECT·W
  const widthM = 2 * radiusM / Math.sqrt(ASPECT), lengthM = widthM * ASPECT
  const t = axisDeg * Math.PI / 180, ux = Math.sin(t), uy = Math.cos(t) // along the axis
  const a2 = (lengthM / 2) ** 2, b2 = (widthM / 2) ** 2
  return { axisDeg, lengthM, widthM,
    contains: (dx, dy) => (dx * ux + dy * uy) ** 2 / a2 + (dx * uy - dy * ux) ** 2 / b2 <= 1 }
}
