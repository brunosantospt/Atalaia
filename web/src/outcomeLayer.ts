// Three full footprints, stacked largest first. Upload once per simulation, reveal in <1 second.
import { Rectangle, SingleTileImageryProvider, type ImageryLayer, type Viewer } from 'cesium'
import type { Runs } from './editor'
import type { Grid } from './grid'
import { burnedHa } from './scenario'
import { fireEnd } from './report'
import { fmtHa } from './format'
import './outcome.css'

export const OUTCOME_COLORS = { free: '#f06464', A: '#f0b54a', B: '#64d9c5' }
export function outcomeOrder(grid: Grid, runs: Runs) {
  return (['free', 'A', 'B'] as const).map(id => ({ id, area: burnedHa(grid, runs[id], runs[id].durationMin) }))
    .sort((a, b) => b.area - a.area)
}

export class OutcomeLayer {
  private layers: ImageryLayer[] = []
  private root = document.createElement('div')
  private count = -1
  constructor(private viewer: Viewer, parent: HTMLElement, grid: Grid, runs: Runs) {
    this.root.className = 'outcome-legend'
    // The legend lives in the Relatórios panel and stays there; the map reveals the footprints one by one.
    const rectangle = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    for (const { id, area } of outcomeOrder(grid, runs)) {
      const canvas = document.createElement('canvas')
      canvas.width = grid.cols
      canvas.height = grid.rows
      const ctx = canvas.getContext('2d')!
      const image = ctx.createImageData(grid.cols, grid.rows)
      const hex = OUTCOME_COLORS[id].slice(1)
      const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
      const run = runs[id]
      for (let i = 0; i < run.arrival.length; i++)
        if (run.arrival[i] <= run.durationMin) image.data.set([...rgb, 185], i * 4)
      ctx.putImageData(image, 0, 0)
      const layer = viewer.imageryLayers.addImageryProvider(new SingleTileImageryProvider({
        url: canvas.toDataURL(), tileWidth: grid.cols, tileHeight: grid.rows, rectangle,
      }))
      layer.show = false
      this.layers.push(layer)
      const label = document.createElement('div')
      label.style.setProperty('--outcome-color', OUTCOME_COLORS[id])
      const end = fireEnd(grid, run)
      label.textContent = `${id === 'free' ? 'Sem decisão' : `Decisão ${id}`} · ${end.edge || end.cutMin !== undefined ? '≥ ' : ''}${fmtHa(area)}`
      this.root.append(label)
    }
    parent.append(this.root)
  }
  private shownAt = 0

  /** Reveals the footprints one by one, 0.4 s apart, from when the finale comes on screen. Timed by the
   *  wall clock, not the player's: at the end of the story the player is paused, and the finale comes back
   *  (after the editor or a report closes) with all three footprints, not the largest alone. */
  show(on: boolean) {
    if (on && this.count <= 0) this.shownAt = performance.now()
    const count = on ? Math.min(3, 1 + Math.floor((performance.now() - this.shownAt) / 400)) : 0
    if (count === this.count) return
    this.count = count
    this.layers.forEach((layer, i) => (layer.show = i < count))
    this.viewer.scene.requestRender()
  }
  destroy() {
    this.layers.forEach(layer => this.viewer.imageryLayers.remove(layer, true))
    this.root.remove()
  }
}
