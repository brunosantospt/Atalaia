// These gauges are display-only demo estimates; never consumed by either spread engine.
import { workMin, type UnitId, type UnitSpec } from './suppression'
export function unitStatus(unit: UnitSpec, kind: UnitId, arrival: number, now: number) {
  const onScene = now >= arrival
  const elapsed = Math.max(0, now - arrival)
  const tank = workMin(unit)
  const capacity = Number.isFinite(tank) ? tank : kind === 'crew' ? 60 : unit.holdMin ?? 60
  return {
    onScene, elapsed, eta: Math.max(0, arrival - now),
    remaining: Math.max(0, capacity - elapsed),
    waterPct: Math.max(0, Math.min(100, Math.round(100 * (1 - elapsed / capacity)))),
  }
}
