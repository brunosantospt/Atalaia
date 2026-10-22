// The free run (ELMFIRE, no forces) read for the storyboard: how far the fire gets before each
// means arrives (its ETA from the drone's detection), the chance the initial attack contains it
// then (Hirsch), the best case (the first of them), and the moment the satellite would have
// detected it instead (T_sat).

import type { Fire, NearStation } from './data'
import type { Detection } from './detection'
import { distanceM, type LonLat } from './geo'
import { contours } from './contours'
import type { Run } from './fastModel'
import { cellHa, lonLatAt, type Grid } from './grid'
import { arrivalMin, containmentProbability, type Suppression } from './suppression'

/** The fire as it stands at one minute of the free run. */
export interface Moment {
  minutes: number // since the ignition
  areaHa: number
  poc: number // probability of containment by an initial attack starting now, 0..1
  rings: LonLat[][] // outline of the burned cells
  center: LonLat
  head: LonLat // the burned cell furthest from the ignition
  radiusM: number // from the centre to the furthest burned cell
}

export interface Eta extends Moment {
  id: string // marker id: 'eta:vfci:way/123'
  unit: string // 'VFCI', 'HEBL'
  from: string // 'BV Vieira do Minho', 'base aérea a 40 km'
}

export interface Reach {
  detection: Detection
  etas: Eta[] // by arrival
  best: Eta // the first means on the fire after the drone's detection: the most that burns if all goes well
  tsat: Moment
  final: Moment // where the run ends: cut at the cap, or out
  areaByMin: Float32Array // hectares burned by each minute of the free run
  intensityKWPerM: number // fireline intensity the POC is computed with
  intensitySource: string
}

export function computeReach(
  grid: Grid,
  run: Run,
  fire: Fire,
  stations: NearStation[],
  sup: Suppression,
  detection: Detection,
): Reach {
  const areaByMin = new Float32Array(run.durationMin + 1)
  for (const a of run.arrival) if (a <= run.durationMin) areaByMin[Math.ceil(a)]++
  for (let m = 1; m < areaByMin.length; m++) areaByMin[m] += areaByMin[m - 1]
  const ha = cellHa(grid)
  for (let m = 0; m < areaByMin.length; m++) areaByMin[m] *= ha

  // Hirsch's POC needs the fireline intensity: the dataset's own figure for the first burn period
  // when it has one, else a shrub fire under moderate wind (Byram, ~2 000 kW/m).
  const observed = fire.periods[0]?.intensityKWPerM
  const intensityKWPerM = observed ?? 2000
  const intensitySource = observed ? 'PT-FireSprd, período 1' : 'valor de referência'

  const moment = (minutes: number): Moment => {
    const t = Math.min(Math.max(Math.round(minutes), 0), run.durationMin)
    let n = 0
    let sumCol = 0
    let sumRow = 0
    let head = fire.ignition
    let headM = -1
    for (let i = 0; i < run.arrival.length; i++) {
      if (run.arrival[i] > t) continue
      const col = i % grid.cols
      const row = (i - col) / grid.cols
      n++
      sumCol += col + 0.5
      sumRow += row + 0.5
      const p = lonLatAt(grid, col + 0.5, row + 0.5)
      const d = distanceM(fire.ignition, p)
      if (d > headM) [head, headM] = [p, d]
    }
    const center = n ? lonLatAt(grid, sumCol / n, sumRow / n) : fire.ignition
    let radiusM = 0
    for (let i = 0; i < run.arrival.length; i++) {
      if (run.arrival[i] > t) continue
      const col = i % grid.cols
      radiusM = Math.max(radiusM, distanceM(center, lonLatAt(grid, col + 0.5, (i - col) / grid.cols + 0.5)))
    }
    const areaHa = areaByMin[t]
    return {
      minutes: t,
      areaHa,
      poc: containmentProbability(sup, areaHa, intensityKWPerM),
      rings: contours(grid, run.arrival, t),
      center,
      head,
      radiusM,
    }
  }

  // The first vehicle of each station near the fire is its ECIN, out in 2 min; one helicopter from the nearest base.
  const t0 = detection.droneMin
  const etas: Eta[] = stations.map((s) => ({
    id: `eta:vfci:${s.id}`,
    unit: sup.units.vfci.short,
    from: s.short,
    ...moment(t0 + arrivalMin(sup, sup.units.vfci, s.km, true)),
  }))
  etas.push({
    id: 'eta:hebl',
    unit: sup.units.hebl.short,
    from: `base aérea a ${sup.dispatch.airBaseKm} km`,
    ...moment(t0 + arrivalMin(sup, sup.units.hebl, sup.dispatch.airBaseKm, false)),
  })
  etas.sort((a, b) => a.minutes - b.minutes)

  // etas is never empty: the helicopter is always there.
  return { detection, etas, best: etas[0], tsat: moment(detection.satelliteMin), final: moment(run.durationMin), areaByMin, intensityKWPerM, intensitySource }
}

/** Hectares the free run has burned `hours` after the ignition. */
export function freeAreaHa(reach: Reach, hours: number): number {
  const m = Math.min(Math.max(hours * 60, 0), reach.areaByMin.length - 1)
  const i = Math.floor(m)
  const j = Math.min(i + 1, reach.areaByMin.length - 1)
  return reach.areaByMin[i] + (reach.areaByMin[j] - reach.areaByMin[i]) * (m - i)
}
