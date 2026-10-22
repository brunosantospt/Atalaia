// The stations in play and their rings: for each of the nearest stations, how far from the ignition its
// means may be put. The fire has grown by the time a station's first vehicle arrives (drone detection +
// turnout + road, as reach.ts counts it), so the ring is the furthest the free run has got by then, plus
// the working reach of the station's ground means: they can still work the front from the edge.

import { Cartesian3, Cartesian2, Color, CustomDataSource, HeightReference, LabelStyle, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import type { NearStation, Station } from './data'
import type { Detection } from './detection'
import { cleanLonLat, destination, distanceM, type LonLat } from './geo'
import { lonLatAt, type Grid } from './grid'
import type { Inventory } from './inventory'
import { arrivalMin, isAerial, type Decision, type Suppression, type UnitId } from './suppression'

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
  arriveMin: number // T+ minutes since the ignition when its first vehicle is at the fire
  reachM: number // the working reach added to the fire's extent
  radiusM: number
}

/** The ring of each station, from the free run's arrival minutes (one per cell of the grid). */
export function computeRings(
  grid: Grid,
  arrival: ArrayLike<number>,
  ignition: LonLat,
  stations: NearStation[],
  sup: Suppression,
  detection: Detection,
  inventory: Inventory | null,
): StationRing[] {
  const times = stations.map((s) => detection.droneMin + arrivalMin(sup, sup.units.vfci, s.km, true))
  const latest = Math.max(...times, 0)
  const extent = times.map(() => 0)
  for (let i = 0; i < arrival.length; i++) {
    const a = arrival[i]
    if (!(a <= latest)) continue
    const col = i % grid.cols
    const d = distanceM(ignition, lonLatAt(grid, col + 0.5, (i - col) / grid.cols + 0.5))
    for (let k = 0; k < times.length; k++) if (a <= times[k] && d > extent[k]) extent[k] = d
  }
  return stations.map((station, k) => {
    const reachM = groundReachM(station, sup, inventory)
    return { station, arriveMin: times[k], reachM, radiusM: extent[k] + reachM }
  })
}

/** The largest working reach among the ground kinds the station has (the VFCI's when its stock is unknown). */
function groundReachM(station: Station, sup: Suppression, inventory: Inventory | null): number {
  const stock = inventory?.[station.id]
  const has = (u: UnitId) => (u === 'crew' ? !!stock && stock.decir.ecin + stock.decir.eip > 0 : !!stock && (stock.units[u] ?? 0) > 0)
  const kinds = (Object.keys(sup.units) as UnitId[]).filter((u) => !isAerial(sup.units[u]) && sup.units[u].reachM && has(u))
  return Math.max(sup.units.vfci.reachM ?? 0, ...kinds.map((u) => sup.units[u].reachM!))
}

/** The radius of each station's ring by station id: what Scenario.rings holds. */
export const radiiOf = (rings: StationRing[]): Record<string, number> => Object.fromEntries(rings.map((r) => [r.station.id, r.radiusM]))

/** Whether p is where a ground unit of station `from` may work; true for stations without a ring (air bases too). */
export function inRing(rings: Record<string, number> | undefined, ignition: LonLat, from: string, p: LonLat): boolean {
  const r = rings?.[from]
  return r === undefined || distanceM(ignition, p) <= r
}

/** Whether an assignment of a decision is a ground one with its point or a vertex of its line outside its station's ring. */
export function outsideRing(rings: Record<string, number> | undefined, ignition: LonLat, sup: Suppression, d: Decision, unit: UnitId, from: string, target: string): boolean {
  if (isAerial(sup.units[unit])) return false
  const where = d.points[target] ? [d.points[target]] : (d.lines[target] ?? [])
  return where.some((p) => !inRing(rings, ignition, from, p))
}

const COLORS = ['#c3a6f5', '#f19ec2', '#d8d2a8'] // lilac, pink, sand: apart from the wet lines, the routes and the fire
export const fmtRingKm = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`

/** The rings on the ground (thin, dashed, one colour per station, labelled) and their legend entry, which toggles them. */
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
            text: `${r.station.short} · chega T+${Math.round(r.arriveMin)} min · até ${fmtRingKm(r.radiusM)}`,
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
    this.legend.innerHTML = `<input type="checkbox" ${this.wanted ? 'checked' : ''} /><b>Alcance dos quartéis</b>${parts.map((p) => `<span class="ent">${p}</span>`).join('')}`
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
