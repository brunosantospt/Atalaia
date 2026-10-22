// Fixed demo coverage. Water/endurance meters never change these model inputs.
import { bearingDeg, destination, distanceM, type LonLat } from './geo'
import type { Scenario } from './scenario'
import { isAerial, type Assignment, type Decision } from './suppression'
import { arrivals, wetLineBearing, type WetLine } from './wetLine'

export const demoLineLength = (a: Pick<Assignment, 'unit'>) => a.unit === 'crew' ? 100 : 200

export function demoLineBearing(scenario: Scenario, decision: Decision, a: Assignment): number {
  const drawn = decision.lines[a.target], point = decision.points[a.target] ?? drawn?.[0]
  if (a.wetLineBearingDeg !== undefined) return a.wetLineBearingDeg
  if (drawn && drawn.length > 1) return bearingDeg(drawn[0], drawn.at(-1)!)
  return point && scenario.fireArrival ? wetLineBearing(scenario, scenario.fireArrival, point, a) : 90
}

/** One straight line per ground unit; no predicted extension along the future perimeter. */
export function demoLines(scenario: Scenario, decision: Decision): WetLine[] {
  const eta = arrivals(scenario, decision)
  // Co-located, aligned resources divide one front. Centre the first group; later
  // orders extend either flank without moving sections already assigned to other orders.
  const fronts: { point: LonLat; bearing: number; positive: number; negative: number; locked: boolean }[] = []
  return decision.assignments.flatMap((a, slot) => {
    const unit = scenario.suppression.units[a.unit]
    if (isAerial(unit) || a.unit === 'vttu' || a.task === 'shuttle') return []
    const drawn = decision.lines[a.target]
    const point = decision.points[a.target] ?? drawn?.[0]
    if (!point) return []
    const lengthM = demoLineLength(a)
    const bearing = demoLineBearing(scenario, decision, a)
    const locked = a.wetLineBearingDeg !== undefined || (drawn?.length ?? 0) > 1
    let front = fronts.find(f => distanceM(f.point,point) <= Math.min(30,scenario.grid.cellsize)
      && Math.abs((((bearing-f.bearing+90)%180+180)%180)-90) < (!locked && !f.locked ? 15 : 0.5))
    if (!front) { front = { point, bearing, positive:0, negative:0, locked }; fronts.push(front) }
    if (locked) front.locked = true
    const first = !front.positive && !front.negative
    if (first) front.positive = front.negative = a.count*lengthM/2
    return Array.from({ length: a.count }, (_, index) => {
      let offset = first ? (index-(a.count-1)/2)*lengthM : 0
      if (!first && front.positive <= front.negative) { offset=front.positive+lengthM/2; front.positive+=lengthM }
      else if (!first) { offset=-front.negative-lengthM/2; front.negative+=lengthM }
      const at: LonLat = destination(front.point, front.bearing, offset)
      const path = [destination(at, front.bearing, lengthM / 2), destination(at, front.bearing + 180, lengthM / 2)]
      return { slot, kind: a.unit === 'crew' ? 'line' as const : 'wet' as const, lengthM,
        barrier: { path: path.map(p => [p.lon, p.lat] as [number, number]), width_m: unit.wetLineWidthM ?? 2, from_min: eta[slot] } }
    })
  })
}
