// An aircraft's drop: a strip laid across the fire's spread (the axis wet lines take), not a circle.
// Same area as the circle of radiusM it replaces, four times longer than wide; the fire model and the
// map both read it from here, so what is drawn is what slows the fire.
import { destination, type LonLat } from './geo'
import type { Scenario } from './scenario'
import type { Assignment } from './suppression'
import { wetLineBearing } from './wetLine'

const ASPECT = 4 // length : width

export interface DropStrip { axisDeg: number; lengthM: number; widthM: number; corners: LonLat[]
  /** Offsets in metres east/north of the centre (TM06). */
  contains(dx: number, dy: number): boolean }

export function dropStrip(scenario: Scenario, a: Assignment, at: LonLat, radiusM: number): DropStrip {
  const axisDeg = scenario.fireArrival ? wetLineBearing(scenario, scenario.fireArrival, at, a) : 90
  const area = Math.PI * radiusM * radiusM
  const widthM = Math.sqrt(area / ASPECT), lengthM = widthM * ASPECT
  const t = axisDeg * Math.PI / 180, ux = Math.sin(t), uy = Math.cos(t) // along the axis
  const end = (s: number) => destination(at, axisDeg, s * lengthM / 2)
  const side = (p: LonLat, s: number) => destination(p, axisDeg + 90, s * widthM / 2)
  const corners = [side(end(1), 1), side(end(1), -1), side(end(-1), -1), side(end(-1), 1)]
  return { axisDeg, lengthM, widthM, corners,
    contains: (dx, dy) => Math.abs(dx * ux + dy * uy) <= lengthM / 2 && Math.abs(dx * uy - dy * ux) <= widthM / 2 }
}
