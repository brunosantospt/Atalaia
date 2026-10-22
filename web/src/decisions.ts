// The example decision A, laid out around the ignition and the observed spread axis: everything
// at the head. A and B are independent manual plans, simulated with the button-run demo model.

import type { Fire, NearStation } from './data'
import { destination, distanceM } from './geo'
import type { Decision } from './suppression'
import { airBasesForUnit } from './airBases'

export function demoDecision(fire: Fire, stations: NearStation[], unlimitedWater = false): Decision {
  const ign = fire.ignition
  const axis = fire.periods[0]?.spreadTowardDeg ?? 270
  const near = stations[0]?.id ?? 'none'
  const next = stations[1]?.id ?? near
  // Keep the example attack within reach of the slower, three-hour demo front.
  const head = destination(ign, axis, 350)
  let aircraft = 2
  const air = airBasesForUnit('hebl').sort((a, b) => distanceM(ign, a) - distanceM(ign, b)).flatMap((base) => {
    const count = Math.min(aircraft, base.units.hebl ?? 0)
    aircraft -= count
    return count ? [{ unit: 'hebl' as const, count, from: base.id, target: 'head', task: 'direct' as const }] : []
  })
  return {
    id: 'A',
    name: 'Ataque direto à cabeça',
    points: { head },
    lines: {},
    assignments: [
      { unit: 'vfci', count: 2, from: near, target: 'head', task: 'direct' },
      { unit: 'crew', count: 2, from: next, target: 'head', task: 'direct' },
      { unit: 'vttu', count: 1, from: near, target: 'head', task: unlimitedWater ? 'protect' : 'shuttle' },
      ...air,
    ],
  }
}
