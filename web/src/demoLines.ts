// Fixed demo coverage. Water/endurance meters never change these model inputs.
import { bearingDeg, destination, type LonLat } from './geo'
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
  return decision.assignments.flatMap((a, slot) => {
    const unit = scenario.suppression.units[a.unit]
    if (isAerial(unit) || a.unit === 'vttu' || a.task === 'shuttle') return []
    const drawn = decision.lines[a.target]
    const point = decision.points[a.target] ?? drawn?.[0]
    if (!point) return []
    if (a.task === 'protect') {
      const r = Math.min(65 * Math.sqrt(a.count), 100)
      const ring = Array.from({ length: 9 }, (_, k) => destination(point, (k * 360) / 8, r))
      return [{
        slot,
        kind: 'wet' as const,
        lengthM: Math.round(2 * Math.PI * r),
        barrier: { path: ring.map(p => [p.lon, p.lat] as [number, number]), width_m: Math.max(6, (unit.wetLineWidthM ?? 2) * 2), from_min: eta[slot] }
      }]
    }
    const lengthM = demoLineLength(a)
    const bearing = demoLineBearing(scenario, decision, a)
    // Multiple units form parallel strips, rather than making each unit's line longer.
    return Array.from({ length: a.count }, (_, i) => {
      const at: LonLat = destination(point, bearing + 90, (i - (a.count - 1) / 2) * Math.max(4, unit.wetLineWidthM ?? 2))
      const path = [destination(at, bearing, lengthM / 2), destination(at, bearing + 180, lengthM / 2)]
      return { slot, kind: a.unit === 'crew' ? 'line' as const : 'wet' as const, lengthM,
        barrier: { path: path.map(p => [p.lon, p.lat] as [number, number]), width_m: unit.wetLineWidthM ?? 2, from_min: eta[slot] } }
    })
  })
}
