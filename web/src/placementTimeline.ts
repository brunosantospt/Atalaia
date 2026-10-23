import { unitJourney } from './unitMotion'
import { distanceM, lerpLonLat, type LonLat } from './geo'
import { isAerial, type Decision } from './suppression'
import type { Scenario } from './scenario'
import { cellOf } from './grid'
import { arrivals } from './wetLine'

export interface Placement {
  point: LonLat
  orderedMin: number
  arrivalMin: number
  path?: LonLat[]
  halted?: boolean
  originalPoint?: LonLat
}

function samplePathAt(path: LonLat[], segLengths: number[], dist: number): LonLat {
  if (dist <= 0) return path[0]
  let rem = dist
  for (let i = 0; i < segLengths.length; i++) {
    if (rem <= segLengths[i]) {
      const frac = segLengths[i] > 0 ? rem / segLengths[i] : 0
      return lerpLonLat(path[i], path[i + 1], frac)
    }
    rem -= segLengths[i]
  }
  return path.at(-1)!
}

function slicePathAt(path: LonLat[], segLengths: number[], dist: number): LonLat[] {
  if (dist <= 0) return [path[0]]
  const result: LonLat[] = [path[0]]
  let rem = dist
  for (let i = 0; i < segLengths.length; i++) {
    if (rem <= segLengths[i]) {
      const frac = segLengths[i] > 0 ? rem / segLengths[i] : 0
      result.push(lerpLonLat(path[i], path[i + 1], frac))
      return result
    }
    result.push(path[i + 1])
    rem -= segLengths[i]
  }
  return result
}

/**
 * When a ground vehicle or crew is approaching a fire, if its destination has already
 * burned before it arrives, halts its progress along its route before entering the
 * fire perimeter so it can deploy effectively without being useless or compromised.
 */
export function resolveHaltedPlacement(
  s: Scenario,
  d: Decision,
  slot: number,
  p: Placement,
  origin?: LonLat
): Placement {
  const a = d.assignments[slot]
  if (!a) return p
  const spec = s.suppression?.units[a.unit]
  if (!spec || isAerial(spec)) return p
  if (!s.fireArrival || !s.grid) return p

  const target = p.point
  const destCell = cellOf(s.grid, target)
  if (destCell < 0) return p

  let tDest = s.fireArrival[destCell]
  if (tDest === Infinity) {
    const cols = s.grid.cols
    const r0 = Math.floor(destCell / cols), c0 = destCell % cols
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = r0 + dr, c = c0 + dc
        if (r >= 0 && r < s.grid.rows && c >= 0 && c < cols) {
          const at = s.fireArrival[r * cols + c]
          if (at < tDest) tDest = at
        }
      }
    }
  }

  if (tDest >= p.arrivalMin) return p

  const path = p.path?.length ? p.path : (origin ? [origin, target] : [target])
  if (path.length < 2) return p

  const segLengths = path.slice(1).map((pt, i) => distanceM(path[i], pt))
  const totalDist = segLengths.reduce((sum, l) => sum + l, 0)
  if (totalDist <= 0) return p

  const departure = p.orderedMin
  const duration = Math.max(0.1, p.arrivalMin - departure)
  const speed = totalDist / duration

  const steps = Math.max(40, Math.ceil(totalDist / 15))
  let lastSafeDist = 0

  for (let step = 0; step <= steps; step++) {
    const dist = (step / steps) * totalDist
    const pt = samplePathAt(path, segLengths, dist)
    const tUnit = departure + dist / speed
    const cell = cellOf(s.grid, pt)
    let tFire = cell >= 0 ? s.fireArrival[cell] : Infinity
    if (tFire === Infinity && cell >= 0) {
      const cols = s.grid.cols, r0 = Math.floor(cell / cols), c0 = cell % cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = r0 + dr, c = c0 + dc
          if (r >= 0 && r < s.grid.rows && c >= 0 && c < cols) {
            const at = s.fireArrival[r * cols + c]
            if (at < tFire) tFire = at
          }
        }
      }
    }

    if (tFire >= tUnit + 1.0) {
      lastSafeDist = dist
    } else {
      break
    }
  }

  const safeDist = Math.max(0, lastSafeDist - 25)
  const haltPoint = samplePathAt(path, segLengths, safeDist)
  const haltArrivalMin = departure + safeDist / speed
  const haltPath = slicePathAt(path, segLengths, safeDist)

  return {
    point: haltPoint,
    orderedMin: p.orderedMin,
    arrivalMin: haltArrivalMin,
    path: haltPath,
    halted: true,
    originalPoint: target,
  }
}

export function placements(s: Scenario, d: Decision, slot: number): Placement[] {
  const a = d.assignments[slot]
  if (!a) return []
  const point = d.points[a.target] ?? d.lines[a.target]?.[0]
  if (!point) return []

  const station = s.stations?.find((st) => st.id === a.from)
  const initialOrigin = station ? { lon: station.lon, lat: station.lat } : undefined
  const initialPlacement: Placement = {
    point,
    orderedMin: a.orderedMin ?? a.dispatchMin ?? s.dispatchMin ?? 0,
    arrivalMin: arrivals(s, d)[slot],
  }

  const resolvedInitial = resolveHaltedPlacement(s, d, slot, initialPlacement, initialOrigin)
  return [resolvedInitial, ...(a.placements ?? [])]
}

export function placementAt(list: Placement[], minute: number) {
  return list.filter((p) => p.orderedMin <= minute).at(-1) ?? list[0]
}

export function relocationPosition(list: Placement[], minute: number): LonLat | undefined {
  let index = -1
  list.forEach((p, i) => {
    if (p.orderedMin <= minute) index = i
  })
  if (index < 1) return undefined
  const p = list[index], prev = list[index - 1]
  return unitJourney(p.path ?? [prev.point, p.point], p.orderedMin, p.arrivalMin)(minute)
}

export function addPlacement(s: Scenario, d: Decision, slot: number, point: LonLat, minute: number, path?: LonLat[]) {
  const a = d.assignments[slot], list = placements(s, d, slot), last = list.at(-1)!
  if (minute < last.arrivalMin) throw new Error('Aguarde a chegada antes de criar outra colocação.')
  const speed = a.unit === 'crew' ? 4 : s.suppression.units[a.unit].speedKmh
  const route = path?.length ? path : [last.point, point]
  const metres = route.slice(1).reduce((sum, p, i) => sum + distanceM(route[i], p), 0)
  const arrivalMin = minute + (metres / 1000 / Math.max(1, speed)) * 60
  ;(a.placements ??= []).push({ point, orderedMin: minute, arrivalMin, path: route })
  return arrivalMin
}

/** Correct an order in place; preserve order times and reject overlapping journeys atomically. */
export function editPlacement(
  s: Scenario,
  d: Decision,
  slot: number,
  index: number,
  point: LonLat,
  routeFor?: (from: LonLat, to: LonLat, minute: number) => LonLat[] | undefined
) {
  const draft = structuredClone(d), a = draft.assignments[slot]
  if (index === 0) {
    const target = `edited-${a.id ?? slot}`
    draft.points[target] = point
    a.target = target
    delete a.arrivalMin
    a.arrivalMin = arrivals(s, draft)[slot]
  } else a.placements![index - 1].point = point
  const list = placements(s, draft, slot)
  const speed = a.unit === 'crew' ? 4 : s.suppression.units[a.unit].speedKmh
  for (let i = Math.max(1, index); i < list.length; i++) {
    const previous = list[i - 1], p = list[i]
    if (p.orderedMin < previous.arrivalMin) throw new Error('Esta alteração sobrepõe viagens. Edite primeiro a ordem seguinte.')
    const route = routeFor?.(previous.point, p.point, p.orderedMin) ?? [previous.point, p.point]
    p.path = route
    p.arrivalMin = p.orderedMin + (route.slice(1).reduce((sum, q, k) => sum + distanceM(route[k], q), 0) / 1000 / Math.max(1, speed)) * 60
  }
  d.points = draft.points
  d.assignments[slot] = a
}
