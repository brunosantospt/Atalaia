// Display-only supply accounting. Neither spread model consumes these gauges.
import { distanceM, type LonLat } from './geo'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'
import { arrivals } from './wetLine'
import { unitStatus } from './unitStatus'

export const TANKER_REACH_M = 300
const target = (d: Decision, slot: number): LonLat | undefined => {
  const a = d.assignments[slot]
  return d.points[a.target] ?? d.lines[a.target]?.[0]
}
export function tankerReach(scenario: Scenario) { return scenario.suppression.units.vttu.reachM ?? TANKER_REACH_M }
export function tankerRecipients(scenario: Scenario, d: Decision, slot: number): number[] {
  const at = target(d, slot)
  if (!at) return []
  return d.assignments.flatMap((a, k) => {
    const p = target(d, k)
    return a.unit === 'vfci' && p && distanceM(at, p) <= tankerReach(scenario) ? [k] : []
  })
}

/** Per assignment: time on scene, minutes of water left (`remaining`, `capacity`, `waterPct`) and the litres in
 *  its own tanks (`litres` of `tankL`; a tanker's share in a VFCI bucket stays counted on the tanker). */
export function supplyStatuses(scenario: Scenario, d: Decision, now: number) {
  const eta = arrivals(scenario, d)
  const statuses = d.assignments.map((a, k) => ({ ...unitStatus(scenario.suppression.units[a.unit], a.unit, eta[k], now), suppliedBy: 0, recipients: 0, litres: 0, tankL: 0 }))
  const tanks = d.assignments.flatMap((a, slot) => a.unit === 'vttu' ? [{ slot, volume: (scenario.suppression.units.vttu.waterL ?? 12000) * a.count, recipients: tankerRecipients(scenario, d, slot), remaining: 0, rate: 0 }] : [])
  tanks.forEach(t => { t.remaining = t.volume })
  for (const [slot, a] of d.assignments.entries()) {
    if (a.unit !== 'vfci') continue
    const spec = scenario.suppression.units.vfci
    const flow = spec.flowLPerMin ?? 200, base = spec.waterL ?? 3000
    const supplies = tanks.filter(t => t.recipients.includes(slot)).map(t => {
      const count = t.recipients.reduce((sum, k) => sum + d.assignments[k].count, 0)
      return { tank: t, at: Math.max(eta[slot], eta[t.slot]), litres: t.volume / Math.max(1, count) }
    }).sort((a, b) => a.at-b.at)
    const buckets = [{ remaining: base, tank: -1 }]
    let clock = eta[slot], capacity = base, connected = 0
    const consume = (until: number) => {
      let need = Math.max(0, until-clock) * flow
      for (const b of buckets) {
        const used = Math.min(b.remaining, need)
        b.remaining -= used; need -= used
      }
      clock = Math.max(clock, until)
    }
    for (const s of supplies) {
      if (s.at > now) continue
      consume(s.at)
      buckets.push({ remaining: s.litres, tank: s.tank.slot })
      capacity += s.litres; connected++
    }
    consume(now)
    for (const s of supplies) {
      const b = buckets.find(b => b.tank === s.tank.slot)
      if (b) s.tank.remaining -= (s.litres-b.remaining)*a.count
      if (now >= s.at) s.tank.rate += flow*a.count
    }
    const remaining = buckets.reduce((sum, b) => sum+b.remaining, 0)
    statuses[slot] = { ...statuses[slot], remaining: remaining/flow, capacity: capacity/flow,
      waterPct: Math.max(0, Math.round(100*remaining/capacity)), suppliedBy: connected, recipients: 0,
      litres: buckets[0].remaining*a.count, tankL: base*a.count }
  }
  for (const t of tanks) {
    const s = statuses[t.slot], rate = t.rate
    statuses[t.slot] = { ...s, remaining: rate ? t.remaining/rate : Infinity, capacity: rate ? t.volume/rate : Infinity,
      waterPct: Math.max(0, Math.round(100*t.remaining/t.volume)), recipients: t.recipients.reduce((n,k)=>n+d.assignments[k].count,0),
      litres: Math.max(0, t.remaining), tankL: t.volume }
  }
  return statuses
}
