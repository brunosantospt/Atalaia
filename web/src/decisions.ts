// The example decision A, laid out around the ignition and the observed spread axis: everything
// at the head. B is not drawn by hand: it is the ILS's plan for A's means (optimize.ts), which
// the editor searches whenever A changes. "Repor exemplo" in the decision editor brings A back.

import type { Fire, NearStation } from './data'
import { destination } from './geo'
import type { Decision } from './suppression'

export function demoDecision(fire: Fire, stations: NearStation[]): Decision {
  const ign = fire.ignition
  const axis = fire.periods[0]?.spreadTowardDeg ?? 270
  const near = stations[0]?.id ?? 'none'
  const next = stations[1]?.id ?? near
  // The head itself is beyond any unit (flame over 3.4 m), so what counts is the front each unit
  // holds from its access point and how fast it grows: with the tanker shuttling water the
  // vehicles stay on the flanks next to the head, without it they leave the front to refill.
  const head = destination(ign, axis, 600)
  return {
    id: 'A',
    name: 'Ataque direto à cabeça',
    points: { head },
    lines: {},
    assignments: [
      { unit: 'vfci', count: 2, from: near, target: 'head', task: 'direct' },
      { unit: 'crew', count: 2, from: next, target: 'head', task: 'direct' },
      { unit: 'vttu', count: 1, from: near, target: 'head', task: 'shuttle' },
      { unit: 'hebl', count: 2, from: 'air', target: 'head', task: 'direct' },
    ],
  }
}
