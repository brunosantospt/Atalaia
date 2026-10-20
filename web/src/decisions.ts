// Two decisions for the split, laid out around the ignition and the observed spread axis with the
// same means: A masses everything at the head, B works the flanks with a water shuttle and drops
// along a line on the south flank. "Repor exemplos" in the decision editor brings them back.

import type { Fire, NearStation } from './data'
import { destination } from './geo'
import type { Decision } from './suppression'

export function demoDecisions(fire: Fire, stations: NearStation[]): [Decision, Decision] {
  const ign = fire.ignition
  const axis = fire.periods[0]?.spreadTowardDeg ?? 270
  const near = stations[0]?.id ?? 'none'
  const next = stations[1]?.id ?? near
  // The head itself is beyond any unit (flame over 3.4 m), so what counts is the front each unit
  // holds from its access point and how fast it grows: with the tanker shuttling water the
  // vehicles stay on the flanks next to the head, without it they leave the front to refill.
  const head = destination(ign, axis, 600)
  const flankS = destination(ign, axis - 60, 900)
  const flankN = destination(ign, axis + 60, 900)
  const lineS = [destination(ign, axis - 50, 700), destination(ign, axis - 25, 1500), destination(ign, axis - 15, 2300)]
  return [
    {
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
    },
    {
      id: 'B',
      name: 'Flancos e linha aérea a sul',
      points: { flankS, flankN },
      lines: { lineS },
      assignments: [
        { unit: 'vfci', count: 2, from: near, target: 'flankS', task: 'direct' },
        { unit: 'crew', count: 2, from: next, target: 'flankN', task: 'direct' },
        { unit: 'vttu', count: 1, from: near, target: 'flankS', task: 'shuttle' },
        { unit: 'hebl', count: 2, from: 'air', target: 'lineS', task: 'drops' },
      ],
    },
  ]
}
