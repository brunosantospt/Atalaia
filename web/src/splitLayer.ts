// A simulated fire as an image over the grid: one side alone (the free run of the storyboard),
// or the decisions A and B side by side, shown left or right of a split the mouse drags. The minute the fire reaches
// each cell is encoded in the image once; moving the clock only moves the layer's
// colour-to-alpha threshold, so no pixel is uploaded again. Two layers per side: the front
// (burned in the last FRONT_MIN) in amber over the scar (older) in brown.

import {
  Color,
  type ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  SplitDirection,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  type Viewer,
} from 'cesium'
import type { Grid } from './grid'
import './split.css'

// A cell is drawn (1, 0.64, k) with k = KEY × arrival / duration, white where the fire never
// arrives. Cesium hides a texel whose largest channel difference from colorToAlpha (white) is
// under the threshold, which here is 1 − k: a threshold of 1 − KEY × t / duration shows exactly
// the cells reached by minute t. KEY keeps the colour amber to salmon; 128 levels is ~3 min over 6 h.
const KEY = 0.5
const FRONT_MIN = 30

export interface Side {
  name: string
  arrival: Float32Array
}

interface Look {
  alpha: number
  brightness?: number
  saturation?: number
}
const FRONT: Look = { alpha: 0.82 }
const SCAR: Look = { alpha: 0.72, brightness: 0.5, saturation: 0.6 }

export class SplitLayer {
  private readonly layers: ImageryLayer[] = [] // front and scar of A, then of B
  private root: HTMLElement | undefined // the handle and labels, only with two sides
  /** Where the split stands, 0 (all B) to 1 (all A). */
  position = 0.5

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    grid: Grid,
    sides: Side[], // one, or A and B
    private readonly durationMin: number,
  ) {
    const rect = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    const split = sides.length > 1
    sides.forEach((side, s) => {
      const url = encode(grid, side.arrival, durationMin)
      const direction = !split ? SplitDirection.NONE : s === 0 ? SplitDirection.LEFT : SplitDirection.RIGHT
      this.layers.push(this.add(url, grid, rect, direction, FRONT), this.add(url, grid, rect, direction, SCAR))
    })
    this.set(0)
    if (!split) return

    this.root = document.createElement('div')
    this.root.className = 'split'
    this.root.innerHTML = `
      <div class="side a"><b>A</b><span></span></div>
      <div class="side b"><b>B</b><span></span></div>
      <div class="handle" title="Arrasta para comparar"></div>`
    this.root.querySelector('.a span')!.textContent = sides[0].name
    this.root.querySelector('.b span')!.textContent = sides[1].name
    parent.append(this.root)

    const handle = this.root.querySelector<HTMLElement>('.handle')!
    let dragging = false
    handle.addEventListener('pointerdown', (e) => {
      dragging = true
      handle.setPointerCapture(e.pointerId)
    })
    handle.addEventListener('pointermove', (e) => {
      if (dragging) this.setPosition(Math.min(Math.max(e.clientX / window.innerWidth, 0.05), 0.95))
    })
    handle.addEventListener('pointerup', () => (dragging = false))
    this.setPosition(this.position)
  }

  /** Where the split stands, 0 (all B) to 1 (all A); the drag keeps a sliver of each side. */
  setPosition(position: number) {
    if (!this.root) return
    this.position = Math.min(Math.max(position, 0), 1)
    this.root.style.setProperty('--split', `${(this.position * 100).toFixed(2)}%`)
    this.viewer.scene.splitPosition = this.position
  }

  show(on: boolean) {
    for (const layer of this.layers) layer.show = on
    if (this.root) this.root.hidden = !on
  }

  /** Show both fires as they stand `hours` after the ignition. */
  set(hours: number) {
    const t = Math.min(Math.max(hours * 60, 0), this.durationMin)
    const front = 1 - (KEY * t) / this.durationMin
    const scar = 1 - (KEY * Math.max(t - FRONT_MIN, 0)) / this.durationMin
    for (let i = 0; i < this.layers.length; i += 2) {
      this.layers[i].colorToAlphaThreshold = front
      this.layers[i + 1].colorToAlphaThreshold = scar
    }
  }

  destroy() {
    for (const layer of this.layers) this.viewer.imageryLayers.remove(layer, true)
    if (!this.root) return
    this.root.remove()
    this.viewer.scene.splitPosition = 0
  }

  private add(url: string, grid: Grid, rectangle: Rectangle, splitDirection: SplitDirection, look: Look): ImageryLayer {
    const provider = new SingleTileImageryProvider({ url, tileWidth: grid.cols, tileHeight: grid.rows, rectangle })
    const layer = this.viewer.imageryLayers.addImageryProvider(provider)
    layer.splitDirection = splitDirection
    layer.colorToAlpha = Color.WHITE
    layer.colorToAlphaThreshold = 1
    // Cells stay cells: a blend of a key with white would read as a later arrival.
    layer.minificationFilter = TextureMinificationFilter.NEAREST
    layer.magnificationFilter = TextureMagnificationFilter.NEAREST
    Object.assign(layer, look)
    return layer
  }
}

/** The arrival grid as a PNG data URL, one pixel per cell. */
function encode(grid: Grid, arrival: Float32Array, durationMin: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = grid.cols
  canvas.height = grid.rows
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(grid.cols, grid.rows)
  const d = image.data
  for (let i = 0; i < arrival.length; i++) {
    const a = arrival[i]
    const o = i * 4
    if (a < durationMin) {
      d[o] = 255
      d[o + 1] = 163
      d[o + 2] = Math.round((255 * KEY * a) / durationMin)
    } else d[o] = d[o + 1] = d[o + 2] = 255
    d[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
