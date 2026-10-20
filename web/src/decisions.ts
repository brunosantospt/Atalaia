// Two decisions for the split spike, laid out around the ignition and the observed spread axis:
// A attacks the head, B builds a line ahead of it and protects the flank. The decision editor
// (P9) will replace this with what is drawn on screen.

import type { Fire, NearStation } from './data'
import { destination } from './geo'
import type { Decision } from './suppression'

export function demoDecisions(fire: Fire, stations: NearStation[]): [Decision, Decision] {
  const ign = fire.ignition
  const axis = fire.periods[0]?.spreadTowardDeg ?? 270
  const near = stations[0]?.id ?? 'none'
  const next = stations[1]?.id ?? near
  // The head is beyond any ground unit (7 000 kW/m): A throws water at it anyway, B works the flanks,
  // where the fire runs at a tenth of the head and a line can hold.
  const head = destination(ign, axis, 600)
  const south = destination(ign, axis - 90, 250)
  const north = destination(ign, axis + 90, 250)
  const alongSouth = (m: number) => destination(south, axis, m)
  return [
    {
      id: 'A',
      name: 'Ataque direto à cabeça',
      points: { head, south },
      lines: {},
      assignments: [
        { unit: 'vfci', count: 2, from: near, target: 'head', task: 'direct' },
        { unit: 'crew', count: 1, from: near, target: 'south', task: 'direct' },
        { unit: 'hebl', count: 1, from: 'air', target: 'head', task: 'direct' },
      ],
    },
    {
      id: 'B',
      name: 'Flancos e linha a sul',
      points: { north, south },
      lines: { south: [alongSouth(-200), alongSouth(300), alongSouth(800)] },
      assignments: [
        { unit: 'crew', count: 2, from: next, target: 'south', task: 'line' },
        { unit: 'vfci', count: 1, from: near, target: 'north', task: 'protect' },
        { unit: 'vttu', count: 1, from: near, target: 'south', task: 'shuttle' },
      ],
    },
  ]
}
