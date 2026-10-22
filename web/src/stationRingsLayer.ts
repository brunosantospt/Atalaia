// Cesium drawing for the deployment timing guidance.
import { Cartesian3, Color, CustomDataSource, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import { cleanLonLat, type LonLat } from './geo'
import type { Grid } from './grid'
import type { Suppression } from './suppression'
import { deploymentBoundary, type DeploymentSelection, type StationRing } from './stationRings'
import { originColor } from './unitIdentity'

export const fmtRingKm = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`

/** Only the selected station's fire-shaped boundary is shown; its explanation stays in the legend. */
export class StationRingsLayer {
  private readonly source = new CustomDataSource('deployment-boundary')
  private readonly legend: HTMLElement
  private wanted = true
  private eligible = false
  private rings: StationRing[] = []
  private key = ''
  private arrival?: Float32Array
  private hasBoundary = false
  private detailsOpen = false

  constructor(private readonly viewer: Viewer, _ignition: LonLat, overlay: HTMLElement) {
    viewer.dataSources.add(this.source)
    this.legend = document.createElement('div')
    this.legend.className = 'ring-legend'
    this.legend.hidden = true
    overlay.appendChild(this.legend)
  }

  set(rings: StationRing[]) { this.rings = rings; this.key = '' }

  update(grid: Grid, arrival: Float32Array, sup: Suppression, selection?: DeploymentSelection) {
    if (!this.eligible) return
    const stationIndex = this.rings.findIndex((r) => r.station.id === selection?.from)
    if (!selection || stationIndex < 0) {
      this.source.show = false
      this.legend.hidden = true
      this.key = ''
      return
    }
    const key = `${selection.from}|${selection.unit}|${selection.dispatchMin}|${selection.ecin}`
    if (this.key === key && this.arrival === arrival) return
    this.key = key; this.arrival = arrival
    const station = this.rings[stationIndex].station
    const colorCss = originColor(station.id, this.rings.map((r) => r.station))
    const color = Color.fromCssColorString(colorCss)
    const { paths } = deploymentBoundary(grid, arrival, station, sup, sup.units[selection.unit], selection.dispatchMin, selection.ecin)
    this.source.entities.removeAll()
    for (const path of paths) {
      const clean = cleanLonLat(path, true)
      if (clean.length < 3) continue
      this.source.entities.add({ polyline: {
        positions: Cartesian3.fromDegreesArray([...clean, clean[0]].flatMap((p) => [p.lon, p.lat])),
        clampToGround: true, width: 2.5,
        material: new PolylineDashMaterialProperty({ color, dashLength: 16 }),
      } })
    }
    this.hasBoundary = paths.length > 0
    this.legend.innerHTML = `<input type="checkbox" aria-label="Mostrar contorno de chegada do fogo" ${this.wanted ? 'checked' : ''}/><details ${this.detailsOpen ? 'open' : ''}><summary>Onde o fogo chega primeiro que qualquer resposta</summary><span class="ent"><span class="sw" style="border-color:${colorCss}"></span>${esc(station.short)} · ${esc(sup.units[selection.unit].short)} · saída T+${Math.round(selection.dispatchMin)} min</span><p>${paths.length ? 'Dentro do tracejado, a resposta selecionada chega depois do fogo. Escolhe um ponto por fora, antes da frente prevista.' : 'O fogo não chega antes da resposta selecionada na previsão disponível.'} O percurso até ao ponto também é verificado.</p></details>`
    this.legend.querySelector('details')!.addEventListener('toggle', (e) => {
      this.detailsOpen = (e.target as HTMLDetailsElement).open
      this.viewer.scene.requestRender()
    })
    this.legend.querySelector('input')!.addEventListener('change', (e) => {
      this.wanted = (e.target as HTMLInputElement).checked
      this.apply()
    })
    this.apply()
  }

  setEligible(on: boolean) {
    if (on === this.eligible) return
    this.eligible = on
    if (on) this.key = ''
    this.apply()
  }

  private apply() {
    this.source.show = this.eligible && this.wanted && this.hasBoundary
    this.legend.hidden = !this.eligible || !this.key
    this.viewer.scene.requestRender()
  }

  destroy() { this.viewer.dataSources.remove(this.source, true); this.legend.remove() }
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
