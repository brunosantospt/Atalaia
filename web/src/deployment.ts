// Arrival warnings use the free ELMFIRE forecast and the same ETAs as the editor.
import type { Scenario } from './scenario'
import { cellOf } from './grid'
import { isAerial, type Decision } from './suppression'
import { arrivals } from './wetLine'

export const SAFETY_MIN = 10

export const arrivesInTime = (freeMin: number, etaMin: number, ecinGain: number, aerial: boolean): boolean =>
  freeMin > etaMin - ecinGain + (aerial ? 0 : SAFETY_MIN)

/**
 * The minute the free run reaches an assignment whose units are late, using the safety
 * margin at its point or the start of its line; undefined when in time.
 * In order, each station's first ground assignment is its ECIN, as arrivals() counts it.
 */
export function lateAt(scenario: Scenario, free: Float32Array, d: Decision): (number | undefined)[] {
  const { grid, suppression: sup } = scenario
  const eta = arrivals(scenario, d)
  return d.assignments.map((x, k) => {
    const aerial = isAerial(sup.units[x.unit])
    const p = d.points[x.target] ?? d.lines[x.target]?.[0]
    if (!p) return undefined
    const cell = cellOf(grid, p)
    const fire = cell < 0 ? Infinity : free[cell]
    return arrivesInTime(fire, eta[k], 0, aerial) ? undefined : fire
  })
}
