// Cesium timing boundaries, controlled from the decision editor.
import { Cartesian3, Color, CustomDataSource, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import { cleanLonLat, type LonLat } from './geo'
import type { Grid } from './grid'
import type { Suppression } from './suppression'
import { deploymentBoundary, type DeploymentSelection, type StationRing } from './stationRings'
import { originColor } from './unitIdentity'

export const fmtRingKm = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`

/** The selected station's boundary is drawn; all station colours remain visible in the editor. */
export class StationRingsLayer {
  private readonly source = new CustomDataSource('deployment-boundary')
  private readonly legend = document.createElement('div')
  private readonly selectionText: HTMLElement
  private readonly explanation: HTMLElement
  private readonly keyList: HTMLElement
  private wanted = true
  private eligible = false
  private rings: StationRing[] = []
  private key = ''
  private arrival?: Float32Array
  private hasBoundary = false

  constructor(private readonly viewer: Viewer, _ignition: LonLat, host: HTMLElement) {
    viewer.dataSources.add(this.source)
    this.legend.className = 'ring-legend'
    this.legend.hidden = true
    this.legend.innerHTML = `
      <label class="ring-toggle"><input type="checkbox" checked><span>Onde o fogo chega primeiro que qualquer resposta</span></label>
      <ul class="ring-key" aria-label="Cores dos quartéis"></ul>
      <details><summary>Como interpretar</summary><p class="ring-selection"></p><p class="ring-explanation"></p>
        <p>Compara a chegada prevista do fogo com a mobilização e a deslocação do meio selecionado. A cor identifica o quartel; ao mudar a origem, muda o contorno. O percurso até ao ponto também é verificado.</p>
      </details>`
    this.selectionText = this.legend.querySelector('.ring-selection')!
    this.explanation = this.legend.querySelector('.ring-explanation')!
    this.keyList = this.legend.querySelector('.ring-key')!
    this.legend.querySelector('input')!.addEventListener('change', (e) => {
      this.wanted = (e.target as HTMLInputElement).checked
      this.apply()
    })
    host.append(this.legend)
  }

  set(rings: StationRing[]) {
    this.rings = rings; this.key = ''
    this.keyList.replaceChildren(...rings.map(({station}) => {
      const row = document.createElement('li')
      row.dataset.station = station.id
      row.innerHTML = '<i class="sw" aria-hidden="true"></i><span></span><small></small>'
      row.querySelector<HTMLElement>('.sw')!.style.borderColor = originColor(station.id, rings.map(r => r.station))
      row.querySelector('span')!.textContent = station.short
      return row
    }))
    this.describe()
  }

  update(grid: Grid, arrival: Float32Array, sup: Suppression, selection?: DeploymentSelection) {
    if (!this.eligible) return
    const stationIndex = this.rings.findIndex((r) => r.station.id === selection?.from)
    if (!selection || stationIndex < 0) {
      this.source.show = false
      this.hasBoundary = false
      if (this.key || !this.selectionText.textContent) this.describe()
      this.key = ''
      return
    }
    const key = `${selection.from}|${selection.unit}|${selection.dispatchMin}|${selection.ecin}`
    if (this.key === key && this.arrival === arrival) return
    this.key = key; this.arrival = arrival
    const station = this.rings[stationIndex].station
    const color = Color.fromCssColorString(originColor(station.id, this.rings.map(r => r.station)))
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
    this.hasBoundary = this.source.entities.values.length > 0
    this.describe(selection, sup)
    this.apply()
  }

  private describe(selection?: DeploymentSelection, sup?: Suppression) {
    const station = this.rings.find(r => r.station.id === selection?.from)?.station
    this.selectionText.textContent = station && selection && sup
      ? `${station.short} · ${sup.units[selection.unit].short} · saída T+${Math.round(selection.dispatchMin)} min`
      : 'Selecione um meio terrestre e o quartel para ver o contorno.'
    this.explanation.textContent = !station
      ? 'Escolha um meio terrestre para comparar a sua chegada com a frente do fogo.'
      : this.hasBoundary
      ? 'Dentro do tracejado, o fogo chega antes desta resposta. Procure um ponto por fora, antes da frente prevista.'
      : 'Sem zona onde o fogo chegue antes da resposta selecionada na previsão disponível.'
    for (const row of this.keyList.querySelectorAll<HTMLElement>('li')) {
      const selected = row.dataset.station === station?.id
      row.classList.toggle('selected', selected)
      row.querySelector('small')!.textContent = selected ? 'selecionado' : ''
    }
  }

  setEligible(on: boolean) {
    if (on === this.eligible) return
    this.eligible = on
    if (on) { this.key = ''; this.describe() }
    this.apply()
  }

  private apply() {
    this.source.show = this.eligible && this.wanted && this.hasBoundary
    this.legend.hidden = !this.eligible
    this.viewer.scene.requestRender()
  }

  destroy() { this.viewer.dataSources.remove(this.source, true); this.legend.remove() }
}
