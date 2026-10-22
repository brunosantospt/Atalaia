// The heat map profile (basemap.ts): the flame a head fire would have in each cell at the hour on
// the clock (fastModel.headFlameM), in the classes of the fire characteristics chart, which are
// where the units stop holding (holdFlameM in suppression.json). Recomputed every half hour of fire
// time, as the wind and the drying change; the new image goes on before the old one comes off, so
// the map never blinks. A legend on the HUD reads the classes, and the cell under the cursor.

import { type ImageryLayer, Rectangle, SingleTileImageryProvider, type Viewer } from 'cesium'
import { headFlameM, type Scenario } from './fastModel'
import { fmtNumber, fmtTime, wallClock } from './format'
import type { LonLat } from './geo'
import { cellOf, type Grid } from './grid'
import type { Suppression } from './suppression'
import './heat.css'

const STEP_MIN = 30
const FADE_MS = 400 // the old image stays this long under the new one while it loads
// Green where everyone holds, red where nobody does: the colours of the danger scale on the news.
const RAMP = ['#4fae62', '#e5c443', '#ef7a2e', '#d3263b']
const ALPHA = 0.72
// Pixels per cell side. The flame is interpolated between cell centres before it is classed, so the
// edges between classes are smooth curves and not the 30 m staircase of the grid.
const UP = 3

interface HeatClass {
  upToM: number // Infinity for the last
  color: string
  range: string
  who: string
}

export class HeatLayer {
  private readonly classes: HeatClass[]
  private readonly rect: Rectangle
  private readonly legend: HTMLElement
  private layers: ImageryLayer[] = [] // the one shown last, and those fading under it
  private flame: Float32Array | undefined
  private step = -1 // half hour of fire time on screen
  private on = false

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    private readonly scenario: Scenario,
    private readonly start: string, // the fire's start, for the wall clock of the legend
  ) {
    const { grid } = scenario
    this.classes = heatClasses(scenario.suppression)
    this.rect = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    this.legend = document.createElement('aside')
    this.legend.className = 'heat-legend'
    this.legend.hidden = true
    this.legend.innerHTML = `
      <div class="head"><span>Chama potencial da cabeça</span><span data-ref="time"></span></div>
      <ol></ol>
      <div class="cursor" data-ref="cursor">Passa o rato no mapa</div>`
    this.legend.querySelector('ol')!.append(
      ...this.classes.map((c) => {
        const li = document.createElement('li')
        li.innerHTML = '<i></i><b></b><span></span>'
        li.querySelector('i')!.style.background = c.color
        li.querySelector('b')!.textContent = c.range
        li.querySelector('span')!.textContent = c.who
        return li
      }),
    )
    parent.append(this.legend)
  }

  show(on: boolean) {
    this.on = on
    this.legend.hidden = !on
    for (const layer of this.layers) layer.show = on
  }

  /** The heat map as it stands `hours` after the ignition, to the half hour; nothing is done while hidden. */
  set(hours: number) {
    if (!this.on) return
    const { durationMin } = this.scenario
    const step = Math.floor(Math.min(Math.max(hours * 60, 0), durationMin) / STEP_MIN)
    if (step === this.step) return
    this.step = step
    this.flame = headFlameM(this.scenario, step * STEP_MIN)
    this.layers.push(this.add(encode(this.scenario.grid, this.flame, this.classes)))
    const fading = this.layers.slice(0, -1)
    setTimeout(() => {
      for (const layer of fading) this.viewer.imageryLayers.remove(layer, true)
      this.layers = this.layers.filter((l) => !fading.includes(l))
    }, FADE_MS)
    this.ref('time').textContent = fmtTime(wallClock(this.start, (step * STEP_MIN) / 60))
  }

  /** Reads the cell under the cursor in the legend: its flame and who holds it. */
  hover(p: LonLat | undefined) {
    if (!this.on) return
    const i = p && this.flame ? cellOf(this.scenario.grid, p) : -1
    const cursor = this.ref('cursor')
    if (i < 0) {
      cursor.textContent = 'Passa o rato no mapa'
      cursor.style.removeProperty('--swatch')
      return
    }
    const flame = this.flame![i]
    const c = flame > 0 ? this.classes.find((k) => flame <= k.upToM)! : undefined
    cursor.textContent = c ? `Aqui ${fmtNumber(flame, 1)} m · ${c.who}` : 'Aqui não arde'
    if (c) cursor.style.setProperty('--swatch', c.color)
    else cursor.style.removeProperty('--swatch')
  }

  destroy() {
    for (const layer of this.layers) this.viewer.imageryLayers.remove(layer, true)
    this.layers = []
    this.legend.remove()
  }

  private ref(name: string): HTMLElement {
    return this.legend.querySelector<HTMLElement>(`[data-ref="${name}"]`)!
  }

  /** Just above the satellite: under the fire, the split and every line on the ground. */
  private add(url: string): ImageryLayer {
    const { grid } = this.scenario
    const provider = new SingleTileImageryProvider({
      url,
      tileWidth: grid.cols * UP,
      tileHeight: grid.rows * UP,
      rectangle: this.rect,
    })
    const layer = this.viewer.imageryLayers.addImageryProvider(provider, 1)
    layer.alpha = ALPHA
    layer.show = this.on
    return layer
  }
}

/** One class per flame length where some unit stops holding, and one above them all where nobody holds. */
function heatClasses(sup: Suppression): HeatClass[] {
  const units = Object.values(sup.units)
  const limits = [...new Set(units.map((u) => u.holdFlameM))].sort((a, b) => a - b)
  const n = limits.length + 1
  const color = (i: number) => RAMP[Math.round((i * (RAMP.length - 1)) / Math.max(n - 1, 1))]
  const m = (x: number) => fmtNumber(x, 1)
  return [...limits, Infinity].map((upToM, i) => {
    const from = i ? limits[i - 1] : 0
    const holding = units.filter((u) => u.holdFlameM >= upToM).map((u) => u.short)
    return {
      upToM,
      color: color(i),
      range: upToM === Infinity ? `> ${m(from)} m` : i ? `${m(from)}–${m(upToM)} m` : `≤ ${m(upToM)} m`,
      who: i === 0 ? 'todos os meios' : holding.length ? holding.join(', ') : 'ninguém: ataque indireto',
    }
  })
}

/**
 * The flame grid as a PNG data URL, UP pixels a cell, in the class colours; clear where nothing burns.
 * Each pixel blends the four cells around it, the burnable ones only, so a rock or a road next to a
 * shrub does not ring it with low flames; a pixel is clear when most of that weight does not burn.
 */
function encode(grid: Grid, flame: Float32Array, classes: HeatClass[]): string {
  const { cols, rows } = grid
  const rgb = classes.map((c) => [1, 3, 5].map((k) => parseInt(c.color.slice(k, k + 2), 16)))
  const canvas = document.createElement('canvas')
  canvas.width = cols * UP
  canvas.height = rows * UP
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(canvas.width, canvas.height)
  const d = image.data
  for (let py = 0; py < canvas.height; py++) {
    const y = Math.min(Math.max((py + 0.5) / UP - 0.5, 0), rows - 1)
    const r0 = Math.floor(y)
    const r1 = Math.min(r0 + 1, rows - 1)
    const ty = y - r0
    for (let px = 0; px < canvas.width; px++) {
      const x = Math.min(Math.max((px + 0.5) / UP - 0.5, 0), cols - 1)
      const c0 = Math.floor(x)
      const c1 = Math.min(c0 + 1, cols - 1)
      const tx = x - c0
      let weight = 0
      let sum = 0
      for (let n = 0; n < 4; n++) {
        const f = flame[(n < 2 ? r0 : r1) * cols + (n % 2 ? c1 : c0)]
        const wn = (n % 2 ? tx : 1 - tx) * (n < 2 ? 1 - ty : ty)
        if (f > 0) (weight += wn), (sum += wn * f)
      }
      if (weight < 0.5) continue
      const f = sum / weight
      let k = 0
      while (f > classes[k].upToM) k++
      const o = (py * canvas.width + px) * 4
      ;[d[o], d[o + 1], d[o + 2]] = rgb[k]
      d[o + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
