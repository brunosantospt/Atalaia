import { isAerial, type Decision, type Suppression } from './suppression'
import { distanceM, lerpLonLat, type LonLat } from './geo'
/** An existing route traversed between departure and the deployment ETA. */
export function unitJourney(path: LonLat[], departure: number, arrival: number) {
  const lengths = path.slice(1).map((p, i) => distanceM(path[i], p))
  const total = lengths.reduce((a, b) => a + b, 0)
  return (minute: number): LonLat => {
    if (minute <= departure) return path[0]
    if (minute >= arrival || !total) return path.at(-1)!
    let distance = total * Math.max(0, Math.min(1, (minute - departure) / Math.max(.01, arrival - departure)))
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i]) return lerpLonLat(path[i], path[i + 1], lengths[i] ? distance / lengths[i] : 0)
      distance -= lengths[i]
    }
    return path.at(-1)!
  }
}

/** Same turnout convention as arrivals(): each station's first ground group is its ECIN. */
export function departures(sup: Suppression, decision: Decision, dispatchMin = 0): number[] {
  const used = new Set<string>()
  return decision.assignments.map(a => {
    const unit = sup.units[a.unit], first = !used.has(a.from)
    if (!isAerial(unit)) used.add(a.from)
    return (a.dispatchMin ?? dispatchMin) + (unit.turnoutMin ?? (first ? sup.dispatch.ecinTurnoutMin : sup.dispatch.volunteerTurnoutMin))
  })
}
