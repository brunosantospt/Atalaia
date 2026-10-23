// A simulated fire on the terrain, drawn like the observed one (fireLayer.ts, the "intel" look of P2):
// an amber line on the edge of what has burned, the last FRONT_MIN in soft amber, older ground in dark
// ember. One side alone (the free run of the storyboard), or the decisions A and B side by side, shown
// left or right of a split the mouse drags.
//
// Each look is an imagery layer keyed on a field of minutes (encode), so moving the clock only moves the
// layers' colour-to-alpha thresholds and no pixel is uploaded again. Magnified texels are not filtered:
// a cell is lit exactly when its minute is reached, never half a cell early. Per side, from the bottom up:
//   line   arrival <= t               the layers above cover all of it but its rim
//   front  inside  <= t               inside: the latest arrival over the cell's 3×3, so a cell is covered
//   scar   inside  <= t − FRONT_MIN    once its neighbours have all burned, and the line stays one cell
//                                     wide wherever the fire meets unburned ground, held edges included

import {
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  type Entity,
  HeightReference,
  type PerspectiveFrustum,
  type ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  SplitDirection,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  type Viewer,
} from 'cesium'
import type { Grid } from './grid'
import { FrontFlames } from './frontFlames'
import './split.css'

// A cell is drawn (R, G, k) with k = 1 + ceil(level(minute)), 255 where the fire never comes. Cesium
// hides a texel whose largest channel difference from colorToAlpha (R, G, 255) is under the threshold
// (strictly), so one threshold shows the cells whose level is reached by a minute. The level is finer in
// the first FINE_MIN, where the detections and the first decisions are (HEAD levels a minute), then spread
// over the rest of the run: ceil on the cell and floor on the clock mean a cell never shows early, and
// late by under a level (1/HEAD min in the first hour, ~2.3 min a level in a 6 h run after it).
const SPAN = 253 // levels 1..254; 255 is the ground that never burns
const FINE_MIN = 60
const HEAD = 2
const FRONT_MIN = 30

// The colours come from the globe shader, not the texel: R and G at 255 and a tiny gamma (texel^100) leave
// (1, 1, 0) whatever the minute, and the look's brightness → hue → saturation (Cesium 1.146 GlobeFS)
// turn that yellow into its colour. Should the colours ever come out wrong, false draws the texel as it
// is: amber, pinker late in the run (the key is in blue), darkened by the look's brightness.
const RECOLOUR = true
const RG = RECOLOUR ? [255, 255] : [240, 163]
const KEY = new Color(RG[0] / 255, RG[1] / 255, 1)
const GAMMA = 0.01
const GLOW_PX = 10 // a fire under this radius on screen gets the glowing spot

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
  private readonly layers: { layer: ImageryLayer; lagMin: number; scale: Scale }[] = [] // line, front and scar of A, then of B
  private glow: Entity | undefined // a spot for a fire too small to read on screen (one side only)
  private burned: { minute: Float32Array; lon: Float64Array; lat: Float64Array; cell: number } | undefined
  private on = true
  private readonly flames: FrontFlames[] = [] // live flames on each side's front
  private root: HTMLElement | undefined // the handle and labels, only with two sides
  /** Where the split stands, 0 (all B) to 1 (all A). */
  position = 0.5
  /** Called on every move of the split (the units follow it in the comparison). */
  moved?: (position: number) => void

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    grid: Grid,
    sides: Side[], // one, or A and B
    durationMin: number,
  ) {
    const rect = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    const split = sides.length > 1
    sides.forEach((side, s) => {
      const { line, inside } = shape(grid, side.arrival, durationMin)
      const scale = scaleOf(line)
      const lineUrl = encode(grid, line, scale, durationMin)
      const insideUrl = encode(grid, inside, scale, durationMin)
      const direction = !split ? SplitDirection.NONE : s === 0 ? SplitDirection.LEFT : SplitDirection.RIGHT
      this.flames.push(new FrontFlames(viewer, grid, side.arrival, durationMin, direction))
      this.layers.push(
        { layer: this.add(lineUrl, grid, rect, direction, LINE), lagMin: 0, scale },
        { layer: this.add(insideUrl, grid, rect, direction, FRONT), lagMin: 0, scale },
        { layer: this.add(insideUrl, grid, rect, direction, SCAR), lagMin: FRONT_MIN, scale },
      )
    })
    if (!split) this.burned = burnedCells(grid, sides[0].arrival, durationMin)
    this.set(0)
    if (!split) return

    this.root = document.createElement('div')
    this.root.className = 'split'
    this.root.innerHTML = `
      <div class="side a"><b>A</b><span></span></div>
      <div class="side b"><b>B</b><span></span></div>
      <div class="handle" title="Arrastar para comparar"></div>`
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
      if (dragging) this.setPosition(Math.min(Math.max(e.clientX / window.innerWidth, 0), 1))
    })
    handle.addEventListener('pointerup', () => (dragging = false))
    this.setPosition(this.position)
  }

  presentation(on: boolean) {
    if (this.root) this.root.style.display = on ? '' : 'none'
  }

  /** Where the split stands, 0 (all B) to 1 (all A); the drag keeps a sliver of each side. */
  setPosition(position: number) {
    if (!this.root) return
    this.position = Math.min(Math.max(position, 0), 1)
    this.root.style.setProperty('--split', `${(this.position * 100).toFixed(2)}%`)
    this.viewer.scene.splitPosition = this.position
    this.moved?.(this.position)
    this.viewer.scene.requestRender()
  }

  show(on: boolean) {
    this.on = on
    for (const { layer } of this.layers) layer.show = on
    for (const f of this.flames) f.show(on)
    if (this.root) this.root.hidden = !on
    if (!on && this.glow) this.glow.show = false
  }

  /** Show both fires as they stand `hours` after the ignition. */
  set(hours: number) {
    for (const { layer, lagMin, scale } of this.layers) layer.colorToAlphaThreshold = threshold(hours * 60 - lagMin, scale)
    for (const f of this.flames) f.set(hours * 60)
    this.updateGlow(hours * 60)
  }

  /** A fire of a few cells is a speck: below GLOW_PX of radius on screen, a glowing spot marks where it burns. */
  private updateGlow(t: number) {
    const b = this.burned
    if (!b || !this.on) return
    let n = 0 // cells with arrival <= t (minutes are sorted)
    for (let lo = 0, hi = b.minute.length; ; ) {
      if (lo >= hi) {
        n = lo
        break
      }
      const mid = (lo + hi) >> 1
      if (b.minute[mid] <= t) lo = mid + 1
      else hi = mid
    }
    let show = false
    if (n > 0) {
      let lon = 0
      let lat = 0
      for (let i = 0; i < n; i++) {
        lon += b.lon[i]
        lat += b.lat[i]
      }
      lon /= n
      lat /= n
      const scene = this.viewer.scene
      const h = scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? 0
      const pos = Cartesian3.fromDegrees(lon, lat, h)
      const fovy = (scene.camera.frustum as PerspectiveFrustum).fovy
      const metres = Math.sqrt((n * b.cell * b.cell) / Math.PI)
      const px = fovy ? (metres * scene.drawingBufferHeight) / (2 * Cartesian3.distance(scene.camera.positionWC, pos) * Math.tan(fovy / 2)) : 0
      show = px < GLOW_PX
      if (show) {
        this.glow ??= this.viewer.entities.add({
          point: {
            pixelSize: 18,
            color: Color.fromCssColorString('#f0a33a').withAlpha(0.6),
            outlineColor: Color.fromCssColorString('#ffd9a0').withAlpha(0.9),
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        this.glow.position = new ConstantPositionProperty(pos)
      }
    }
    if (this.glow) this.glow.show = show
  }

  destroy() {
    for (const { layer } of this.layers) this.viewer.imageryLayers.remove(layer, true)
    for (const f of this.flames) f.destroy()
    if (this.glow) this.viewer.entities.remove(this.glow)
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
    layer.minificationFilter = TextureMinificationFilter.LINEAR // far away a cell is under a pixel: blur is fine
    layer.magnificationFilter = TextureMagnificationFilter.LINEAR // close up: smooth edges, not cell blocks (Tests na demo); an edge moves under a cell
    Object.assign(layer, RECOLOUR ? { ...look, gamma: GAMMA } : { alpha: look.alpha, brightness: look.brightness })
    return layer
  }
}

/** Levels a minute: `head` up to FINE_MIN, `tail` after it; the last finite arrival fills SPAN levels. */
interface Scale {
  head: number
  tail: number
}

function scaleOf(minutes: Float32Array): Scale {
  let last = 0
  for (const m of minutes) if (m !== Infinity && m > last) last = m
  if (last <= FINE_MIN) return { head: Math.min(4 * HEAD, SPAN / Math.max(last, 1)), tail: 0 }
  return { head: HEAD, tail: (SPAN - HEAD * FINE_MIN) / (last - FINE_MIN) }
}

const level = (s: Scale, m: number) => (m <= FINE_MIN ? s.head * m : s.head * FINE_MIN + s.tail * (m - FINE_MIN))

/** The colour-to-alpha threshold that shows the cells reached by minute `t` (see encode): level k = 1 + ceil(level(arrival)) is
 *  lit when k <= 1 + floor(level(t)), i.e. its difference (255 − k) / 255 is at least (254 − floor) / 255. Nothing before 0. */
export function threshold(t: number, scale: Scale): number {
  if (t < 0) return 2
  const reached = Math.min(SPAN, Math.floor(level(scale, t) + 1e-9))
  return (253.5 - reached) / 255
}

/** The burning cells by arrival, with their centres, for the glow. */
function burnedCells(grid: Grid, arrival: Float32Array, durationMin: number) {
  const order: number[] = []
  arrival.forEach((m, i) => m < durationMin && order.push(i))
  order.sort((a, b) => arrival[a] - arrival[b])
  const { west, east, south, north } = grid.rect
  const minute = new Float32Array(order.length)
  const lon = new Float64Array(order.length)
  const lat = new Float64Array(order.length)
  order.forEach((i, k) => {
    const r = Math.floor(i / grid.cols)
    minute[k] = arrival[i]
    lon[k] = west + ((i - r * grid.cols + 0.5) / grid.cols) * (east - west)
    lat[k] = north - ((r + 0.5) / grid.rows) * (north - south)
  })
  return { minute, lon, lat, cell: grid.cellsize }
}

/** The arrival grid as drawn, the model's own minutes (no closing, no smoothing: a cell shows exactly when it
 *  burns), and `inside`, the latest minute over each cell's 3×3. */
function shape(grid: Grid, arrival: Float32Array, durationMin: number): { line: Float32Array; inside: Float32Array } {
  const { cols, rows } = grid
  const line = arrival.map((m) => (m < durationMin ? m : Infinity))
  const inside = new Float32Array(line.length).fill(Infinity)
  // Only the box around what burns has work to do; 1 cell out covers the 3×3.
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
  r0 = Math.max(r0 - 1, 0)
  r1 = Math.min(r1 + 1, rows - 1)
  c0 = Math.max(c0 - 1, 0)
  c1 = Math.min(c1 + 1, cols - 1)

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
function encode(grid: Grid, minutes: Float32Array, scale: Scale, durationMin: number): string {
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
    d[o + 2] = m < durationMin ? 1 + Math.min(SPAN, Math.ceil(level(scale, m) - 1e-9)) : 255
    d[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
