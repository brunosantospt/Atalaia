// Cesium timing boundaries, controlled from the decision editor.
import { CustomDataSource, Rectangle, SingleTileImageryProvider, type ImageryLayer, type Viewer } from 'cesium'
import type { LonLat } from './geo'
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
  private region?: ImageryLayer // the zone as one soft, translucent grey surface

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
      if (this.region) this.region.show = false
      this.hasBoundary = false
      if (this.key || !this.selectionText.textContent) this.describe()
      this.key = ''
      return
    }
    const key = `${selection.from}|${selection.unit}|${selection.dispatchMin}|${selection.ecin}`
    if (this.key === key && this.arrival === arrival) return
    this.key = key; this.arrival = arrival
    const station = this.rings[stationIndex].station
    const { blocked } = deploymentBoundary(grid, arrival, station, sup, sup.units[selection.unit], selection.dispatchMin, selection.ecin)
    this.hasBoundary = this.drawRegion(grid, blocked)
    this.describe(selection, sup)
    this.apply()
  }

  private describe(selection?: DeploymentSelection, sup?: Suppression) {
    const station = this.rings.find(r => r.station.id === selection?.from)?.station
    this.selectionText.textContent = station && selection && sup
      ? `${station.short} · ${sup.units[selection.unit].short} · saída T+${Math.round(selection.dispatchMin)} min`
      : 'Contorno visível ao selecionar um meio terrestre e o quartel.'
    this.explanation.textContent = !station
      ? 'Com um meio terrestre selecionado, compara-se a sua chegada com a frente do fogo.'
      : this.hasBoundary
      ? 'Na zona cinzenta, o fogo chega antes desta resposta. Os pontos fora dela recebem a resposta antes da frente prevista.'
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

  /** The cells the fire reaches first, upscaled and blurred into one smooth grey shape draped on the terrain. */
  private drawRegion(grid: Grid, blocked: Uint8Array): boolean {
    if (this.region) this.viewer.imageryLayers.remove(this.region, true)
    this.region = undefined
    if (!blocked.some(Boolean)) return false
    const cells = document.createElement('canvas')
    cells.width = grid.cols; cells.height = grid.rows
    const image = cells.getContext('2d')!.createImageData(grid.cols, grid.rows)
    blocked.forEach((b, i) => b && image.data.set([200, 205, 210, 255], i * 4))
    cells.getContext('2d')!.putImageData(image, 0, 0)
    // Upscale with a blur, then cut at half: a smooth, crisp-edged shape (not a fog), flat translucent grey.
    const SCALE = 6
    const smooth = document.createElement('canvas')
    smooth.width = grid.cols * SCALE; smooth.height = grid.rows * SCALE
    const ctx = smooth.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.filter = `blur(${SCALE}px)`
    ctx.drawImage(cells, 0, 0, smooth.width, smooth.height)
    ctx.filter = 'none'
    const px = ctx.getImageData(0, 0, smooth.width, smooth.height)
    for (let i = 3; i < px.data.length; i += 4) {
      const inside = px.data[i] >= 128
      px.data[i - 3] = 120; px.data[i - 2] = 126; px.data[i - 1] = 134
      px.data[i] = inside ? 110 : 0
    }
    ctx.putImageData(px, 0, 0)
    const rectangle = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    this.region = this.viewer.imageryLayers.addImageryProvider(new SingleTileImageryProvider({
      url: smooth.toDataURL(), tileWidth: smooth.width, tileHeight: smooth.height, rectangle,
    }))
    // Just above the base map, so the fire and its forecasts draw over it.
    const layers = this.viewer.imageryLayers
    layers.lowerToBottom(this.region)
    layers.raise(this.region)
    return true
  }

  private apply() {
    this.source.show = this.eligible && this.wanted && this.hasBoundary
    if (this.region) this.region.show = this.source.show
    this.legend.hidden = !this.eligible
    this.viewer.scene.requestRender()
  }

  destroy() { if (this.region) this.viewer.imageryLayers.remove(this.region, true); this.viewer.dataSources.remove(this.source, true); this.legend.remove() }
}
