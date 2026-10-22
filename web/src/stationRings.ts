// Each station's ring marks where its first vehicle meets the spreading fire on its approach
// to the ignition. It is an inner interception boundary, not a maximum deployment distance.

import { Cartesian3, Cartesian2, Color, CustomDataSource, HeightReference, LabelStyle, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import type { NearStation, Station } from './data'
import type { Detection } from './detection'
import { cleanLonLat, destination, distanceM, lerpLonLat, type LonLat } from './geo'
import { cellOf, type Grid } from './grid'
import { arrivalMin, isAerial, type Decision, type Suppression, type UnitId, type UnitSpec } from './suppression'

/** How many stations are available for now, anywhere means come from; the rest of the map keeps its stations but none is used. */
export const STATIONS_IN_PLAY = 3
const MAX_KM = 65 // as the regional list was

/** The stations in play: the nearest to the ignition by the model's own travel time (straight line × road factor). */
export function stationsInPlay(stations: Station[], ignition: LonLat, sup: Suppression): NearStation[] {
  const vfci = sup.units.vfci
  return stations
    .map((s) => ({ ...s, km: distanceM(ignition, s) / 1000 }))
    .filter((s) => s.km <= MAX_KM)
    .sort((a, b) => arrivalMin(sup, vfci, a.km, true) - arrivalMin(sup, vfci, b.km, true))
    .slice(0, STATIONS_IN_PLAY)
}

export interface StationRing {
  station: NearStation
  arriveMin: number // T+ at the interception point, not at the ignition
  radiusM: number // minimum distance from the ignition on this station's approach
}

export interface Interception {
  point: LonLat
  arriveMin: number
}

/** First point the fire reaches before (or with) the approaching vehicle. Travel uses the same
 *  station-to-target road-factor estimate as arrivals(), sampled at half-cell intervals. */
export function approachIntercept(
  grid: Grid,
  arrival: ArrayLike<number>,
  origin: LonLat,
  target: LonLat,
  sup: Suppression,
  unit: UnitSpec,
  dispatchMin: number,
  ecin = true,
): Interception | undefined {
  const km = distanceM(origin, target) / 1000
  const steps = Math.max(1, Math.ceil(km * 1000 / (grid.cellsize / 2)))
  for (let k = 0; k <= steps; k++) {
    const fraction = k / steps
    const point = lerpLonLat(origin, target, fraction)
    const cell = cellOf(grid, point)
    const at = dispatchMin + arrivalMin(sup, unit, km * fraction, ecin)
    if (cell >= 0 && arrival[cell] <= at) return { point, arriveMin: at }
  }
  return undefined
}

/** One interception ring per station. No hose/working reach is added to this boundary. */
export function computeRings(
  grid: Grid,
  arrival: ArrayLike<number>,
  ignition: LonLat,
  stations: NearStation[],
  sup: Suppression,
  detection: Detection,
  dispatchMin = detection.droneMin,
): StationRing[] {
  return stations.map((station) => {
    const meet = approachIntercept(grid, arrival, station, ignition, sup, sup.units.vfci, dispatchMin)
    return {
      station,
      arriveMin: meet?.arriveMin ?? dispatchMin + arrivalMin(sup, sup.units.vfci, station.km, true),
      radiusM: meet ? distanceM(ignition, meet.point) : 0,
    }
  })
}

/** Interception radius by station id; retained in the worker's scenario too. */
export const radiiOf = (rings: StationRing[]): Record<string, number> => Object.fromEntries(rings.map((r) => [r.station.id, r.radiusM]))

/** Outside the interception boundary: farther out has no maximum deployment distance. */
export function beyondRing(rings: Record<string, number> | undefined, ignition: LonLat, from: string, p: LonLat): boolean {
  const r = rings?.[from]
  return r === undefined || r === 0 || distanceM(ignition, p) > r
}

/** Whether a ground assignment puts any point inside its station's interception boundary. */
export function blockedByRing(rings: Record<string, number> | undefined, ignition: LonLat, sup: Suppression, d: Decision, unit: UnitId, from: string, target: string): boolean {
  if (isAerial(sup.units[unit])) return false
  const where = d.points[target] ? [d.points[target]] : (d.lines[target] ?? [])
  return where.some((p) => !beyondRing(rings, ignition, from, p))
}

const COLORS = ['#c3a6f5', '#f19ec2', '#d8d2a8'] // lilac, pink, sand: apart from the wet lines, the routes and the fire
export const fmtRingKm = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`

/** Interception boundaries, labelled with the meeting time and distance from the ignition. */
export class StationRingsLayer {
  private readonly source = new CustomDataSource('station-rings')
  private readonly legend: HTMLElement
  private wanted = true // the legend's checkbox
  private eligible = false // the drawer or a decision shot
  private rings: StationRing[] = []

  constructor(
    private readonly viewer: Viewer,
    private readonly ignition: LonLat,
    overlay: HTMLElement,
  ) {
    viewer.dataSources.add(this.source)
    this.legend = document.createElement('label')
    this.legend.className = 'ring-legend'
    this.legend.hidden = true
    overlay.appendChild(this.legend)
  }

  /** Draws these rings in place of the previous ones. */
  set(rings: StationRing[]) {
    this.rings = rings
    this.source.entities.removeAll()
    const parts: string[] = []
    rings.forEach((r, k) => {
      const color = Color.fromCssColorString(COLORS[k % COLORS.length])
      const path = cleanLonLat(Array.from({ length: 97 }, (_, i) => destination(this.ignition, (i * 360) / 96, r.radiusM)), true)
      if (path.length) {
        const closed = [...path, path[0]]
        this.source.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(closed.flatMap((p) => [p.lon, p.lat])),
            clampToGround: true,
            width: 1.5,
            material: new PolylineDashMaterialProperty({ color: color.withAlpha(0.9), dashLength: 14 }),
          },
        })
        const at = destination(this.ignition, 30 + 120 * k, r.radiusM) // the three labels a third of a turn apart
        this.source.entities.add({
          position: Cartesian3.fromDegrees(at.lon, at.lat),
          label: {
            text: `${r.station.short} · fogo/meios T+${Math.round(r.arriveMin)} min · encontro a ${fmtRingKm(r.radiusM)}`,
            font: '11px ui-monospace, Menlo, monospace',
            fillColor: color,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -10),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
      parts.push(`<span class="sw" style="border-color:${COLORS[k % COLORS.length]}"></span>${esc(r.station.short)} ${fmtRingKm(r.radiusM)}`)
    })
    this.legend.innerHTML = `<input type="checkbox" ${this.wanted ? 'checked' : ''} /><b>Encontro fogo/meios · colocar por fora</b>${parts.map((p) => `<span class="ent">${p}</span>`).join('')}`
    this.legend.querySelector('input')!.addEventListener('change', (e) => {
      this.wanted = (e.target as HTMLInputElement).checked
      this.apply()
    })
    this.apply()
  }

  /** Whether the drawer is open or a decision shot is on: the rings and their legend are there only then. */
  setEligible(on: boolean) {
    if (on === this.eligible) return
    this.eligible = on
    this.apply()
  }

  private apply() {
    this.source.show = this.eligible && this.wanted
    this.legend.hidden = !this.eligible || !this.rings.length
  }

  destroy() {
    this.viewer.dataSources.remove(this.source, true)
    this.legend.remove()
  }
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
