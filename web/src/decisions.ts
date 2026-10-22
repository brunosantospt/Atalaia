// The example decision A, laid out around the ignition and the observed spread axis: everything
// at the head. A and B are independent manual plans, simulated with ELMFIRE.

import type { Fire, NearStation } from './data'
import { destination } from './geo'
import type { Decision } from './suppression'

export function demoDecision(fire: Fire, stations: NearStation[], unlimitedWater = false): Decision {
  const ign = fire.ignition
  const axis = fire.periods[0]?.spreadTowardDeg ?? 270
  const near = stations[0]?.id ?? 'none'
  const next = stations[1]?.id ?? near
  // The head itself is beyond any unit (flame over 3.4 m), so what counts is the front each unit
  // holds from its access point and how fast it grows: with the tanker shuttling water the
  // vehicles stay on the flanks. In unlimited-water mode the tanker protects the point directly.
  const head = destination(ign, axis, 600)
  return {
    id: 'A',
    name: 'Ataque direto à cabeça',
    points: { head },
    lines: {},
    assignments: [
      { unit: 'vfci', count: 2, from: near, target: 'head', task: 'direct' },
      { unit: 'crew', count: 2, from: next, target: 'head', task: 'direct' },
      { unit: 'vttu', count: 1, from: near, target: 'head', task: unlimitedWater ? 'protect' : 'shuttle' },
      { unit: 'hebl', count: 2, from: 'air', target: 'head', task: 'direct' },
    ],
  }
}
