import { AIR_BASES } from './airBases'
import type { Decision } from './suppression'

export const STATION_COLORS = ['#c3a6f5', '#f19ec2', '#d8d2a8']
const AIR_COLORS = ['#38bdf8', '#34d399', '#fb923c', '#818cf8', '#facc15', '#2dd4bf', '#f472b6', '#a3e635', '#f87171']

/** One palette for the origin marker, deployment boundary and every dispatched unit. */
export function originColor(id: string, stations: readonly { id: string }[]): string {
  const station = stations.findIndex((s) => s.id === id)
  if (station >= 0) return STATION_COLORS[station % STATION_COLORS.length]
  const base = AIR_BASES.findIndex((b) => b.id === id)
  if (base >= 0) return AIR_COLORS[base % AIR_COLORS.length]
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AIR_COLORS[hash % AIR_COLORS.length]
}

/** Internal group keys survive edits/removals; visible fieldIds() are recounted separately. */
export function ensureAssignmentIds(decision: Decision): void {
  const prefix = `${decision.id}-`
  let next = Math.max(1, decision.nextAssignmentId ?? 1)
  for (const a of decision.assignments) {
    if (!a.id?.startsWith(prefix)) continue
    const n = Number(a.id.slice(prefix.length))
    if (Number.isInteger(n) && n >= next) next = n + 1
  }
  const used = new Set<string>()
  for (const a of decision.assignments) {
    if (!a.id?.startsWith(prefix) || used.has(a.id)) a.id = `${prefix}${String(next++).padStart(2, '0')}`
    used.add(a.id)
  }
  decision.nextAssignmentId = next
}

/** The same origin letter on a BV/CMA and its field units. */
export function originLetter(id: string, stations: readonly { id: string }[]): string {
  const station = stations.findIndex(s => s.id === id)
  const base = AIR_BASES.findIndex(b => b.id === id)
  return String.fromCharCode(65 + (station >= 0 ? station : stations.length + Math.max(0, base)))
}

/** Visible IDs count physical means per origin, so removals compact the remaining numbers. */
export function fieldIds(decision: Decision, stations: readonly { id: string }[]): string[][] {
  const counts = new Map<string, number>()
  return decision.assignments.map(a => Array.from({ length: a.count }, () => {
    const n = (counts.get(a.from) ?? 0) + 1
    counts.set(a.from, n)
    return `${originLetter(a.from, stations)}${n}`
  }))
}
