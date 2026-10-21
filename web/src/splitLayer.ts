// A simulated fire on the terrain, drawn like the observed one (fireLayer.ts, the "intel" look of P2):
// an amber line on the edge of what has burned, the last FRONT_MIN in soft amber, older ground in dark
// ember. One side alone (the free run of the storyboard), or the decisions A and B side by side, shown
// left or right of a split the mouse drags.
//
// Each look is an imagery layer keyed on a field of minutes (encode), so moving the clock only moves the
// layers' colour-to-alpha thresholds and no pixel is uploaded again. Linear filtering interpolates the
// minutes between cell centres: edges are the smooth isolines of the field, not the cells. Per side,
// from the bottom up:
//   line   arrival <= t               the layers above cover all of it but its rim
//   front  inside  <= t               inside: the latest arrival over the cell's 3×3, so a cell is covered
//   scar   inside  <= t − FRONT_MIN    once its neighbours have all burned, and the line stays one cell
//                                     wide wherever the fire meets unburned ground, held edges included

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

// A cell is drawn (R, G, k) with k = 1 + SPAN × minute / duration, 255 where the fire never comes. Cesium
// hides a texel whose largest channel difference from colorToAlpha (R, G, 255) is under the threshold, so
// one threshold shows exactly the cells reached by a minute. SPAN stays under half of 255: between a
// burned cell and one that never burns, the edge then stops halfway, on the cell's border.
const SPAN = 126 // ~2.9 min a level over 6 h
const FRONT_MIN = 30

// The colours come from the globe shader, not the texel: R and G at 255 and a tiny gamma (texel^100) leave
// (1, 1, 0) whatever the minute, and the look's brightness → hue → saturation (Cesium 1.146 GlobeFS)
// turn that yellow into its colour. Should the colours ever come out wrong, false draws the texel as it
// is: amber, pinker late in the run (the key is in blue), darkened by the look's brightness.
const RECOLOUR = true
const RG = RECOLOUR ? [255, 255] : [240, 163]
const KEY = new Color(RG[0] / 255, RG[1] / 255, 1)
const GAMMA = 0.01

interface Look {
  alpha: number
  brightness: number
  hue: number // radians
  saturation: number
}
// Solved offline for the colours on the right by replaying those three steps of the shader. Over a dark
// ground the stack comes out as FireLayer's: its FRONT (#f0a33a at 0.58) behind the line, its SCAR
// (#7a3f1c at 0.62) under the scar.
const LINE: Look = { alpha: 0.9, brightness: 0.791, hue: 0.46, saturation: 0.916 } // #f0a33a, FIRE_AMBER
const FRONT: Look = { alpha: 0.4, brightness: 0.201, hue: 0.371, saturation: 0.446 } // #342c1d
const SCAR: Look = { alpha: 0.7, brightness: 0.164, hue: 0.875, saturation: 1.108 } // #3c1a14

export interface Side {
  name: string
  arrival: Float32Array
}

export class SplitLayer {
  private readonly layers: { layer: ImageryLayer; lagMin: number }[] = [] // line, front and scar of A, then of B
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
      const { line, inside } = shape(grid, side.arrival, durationMin)
      const lineUrl = encode(grid, line, durationMin)
      const insideUrl = encode(grid, inside, durationMin)
      const direction = !split ? SplitDirection.NONE : s === 0 ? SplitDirection.LEFT : SplitDirection.RIGHT
      this.layers.push(
        { layer: this.add(lineUrl, grid, rect, direction, LINE), lagMin: 0 },
        { layer: this.add(insideUrl, grid, rect, direction, FRONT), lagMin: 0 },
        { layer: this.add(insideUrl, grid, rect, direction, SCAR), lagMin: FRONT_MIN },
      )
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
    for (const { layer } of this.layers) layer.show = on
    if (this.root) this.root.hidden = !on
  }

  /** Show both fires as they stand `hours` after the ignition. */
  set(hours: number) {
    for (const { layer, lagMin } of this.layers) layer.colorToAlphaThreshold = threshold(hours * 60 - lagMin, this.durationMin)
  }

  destroy() {
    for (const { layer } of this.layers) this.viewer.imageryLayers.remove(layer, true)
    if (!this.root) return
    this.root.remove()
    this.viewer.scene.splitPosition = 0
  }

  private add(url: string, grid: Grid, rectangle: Rectangle, splitDirection: SplitDirection, look: Look): ImageryLayer {
    const provider = new SingleTileImageryProvider({ url, tileWidth: grid.cols, tileHeight: grid.rows, rectangle })
    const layer = this.viewer.imageryLayers.addImageryProvider(provider)
    layer.splitDirection = splitDirection
    layer.colorToAlpha = KEY
    layer.colorToAlphaThreshold = 2 // nothing until set()
    layer.minificationFilter = TextureMinificationFilter.LINEAR
    layer.magnificationFilter = TextureMagnificationFilter.LINEAR
    Object.assign(layer, RECOLOUR ? { ...look, gamma: GAMMA } : { alpha: look.alpha, brightness: look.brightness })
    return layer
  }
}

/** The colour-to-alpha threshold that shows the cells reached by minute `t` (see encode), none before 0. */
function threshold(t: number, durationMin: number): number {
  return t > 0 ? 1 - (1.5 + (SPAN * Math.min(t, durationMin)) / durationMin) / 255 : 2
}

/** The arrival grid as drawn: never-burned specks inside the fire closed, the minutes smoothed over
 *  burned cells only (held edges stay sharp), and `inside`, the latest minute over each cell's 3×3.
 *  Drawing only: hectares and reports keep the model's own grid. */
function shape(grid: Grid, arrival: Float32Array, durationMin: number): { line: Float32Array; inside: Float32Array } {
  const { cols, rows } = grid
  const line = arrival.map((m) => (m < durationMin ? m : Infinity))
  const inside = new Float32Array(line.length).fill(Infinity)
  // Only the box around what burns has work to do; 3 cells out covers the two passes that grow it.
  let r0 = rows
  let r1 = -1
  let c0 = cols
  let c1 = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === Infinity) continue
    const r = Math.floor(i / cols)
    const c = i - r * cols
    r0 = Math.min(r0, r)
    r1 = Math.max(r1, r)
    c0 = Math.min(c0, c)
    c1 = Math.max(c1, c)
  }
  if (r1 < 0) return { line, inside }
  r0 = Math.max(r0 - 3, 0)
  r1 = Math.min(r1 + 3, rows - 1)
  c0 = Math.max(c0 - 3, 0)
  c1 = Math.min(c1 + 3, cols - 1)

  // A cell the fire never reaches but burns on 6 of its 8 sides (a stream, a road, one built-up cell)
  // would show as a hole ringed by the line: it closes with its last neighbour.
  for (let pass = 0; pass < 2; pass++) {
    const src = line.slice()
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (src[r * cols + c] !== Infinity) continue
        let burned = 0
        let last = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
            const m = src[rr * cols + cc]
            if (m !== Infinity) {
              burned++
              last = Math.max(last, m)
            }
          }
        if (burned >= 6) line[r * cols + c] = last
      }
  }

  // Smooth the minutes (1 2 1 binomial), over burned cells only.
  const raw = line.slice()
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c
      if (raw[i] === Infinity) continue
      let sum = 0
      let weight = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
          const m = raw[rr * cols + cc]
          if (m === Infinity) continue
          const w = (2 - Math.abs(dr)) * (2 - Math.abs(dc))
          sum += w * m
          weight += w
        }
      line[i] = sum / weight
    }

  // Inside: the latest minute around, never next to ground that never burns or past the grid's edge.
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (line[r * cols + c] === Infinity) continue
      let last = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = c + dc
          last = rr < 0 || cc < 0 || rr >= rows || cc >= cols ? Infinity : Math.max(last, line[rr * cols + cc])
        }
      inside[r * cols + c] = last
    }
  return { line, inside }
}

/** A field of minutes as a PNG data URL, one pixel per cell, row 0 on the north edge. */
function encode(grid: Grid, minutes: Float32Array, durationMin: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = grid.cols
  canvas.height = grid.rows
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(grid.cols, grid.rows)
  const d = image.data
  for (let i = 0; i < minutes.length; i++) {
    const m = minutes[i]
    const o = i * 4
    d[o] = RG[0]
    d[o + 1] = RG[1]
    // Never 0: the gamma's pow(0, 100) is the one value a GPU may get wrong.
    d[o + 2] = m < durationMin ? 1 + Math.round((SPAN * m) / durationMin) : 255
    d[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
