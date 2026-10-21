// High-resolution realistic wildfire simulation on the terrain:
// 1. Continuous, unbroken 3D flame ribbon along the active front (multi-tongued wildfire billboards)
// 2. Dense, billowing dark volumetric smoke cloud layer rising over the burned basin and drifting with the wind
// 3. Deep charred pitch-black earth and ash scar behind the active front
// 4. Supersampled bilinear anti-pixelated ground drape with linear texture filtering

import {
  Billboard,
  BillboardCollection,
  Cartesian3,
  Cartographic,
  Color,
  type ImageryLayer,
  Math as CesiumMath,
  NearFarScalar,
  Rectangle,
  SingleTileImageryProvider,
  SplitDirection,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { Weather } from './data'
import { lonLatAt, type Grid } from './grid'
import './split.css'

const KEY = 0.5
const FLAME_WINDOW_MIN = 18 // minutes a cell actively carries tall flames
const SMOKE_WINDOW_MIN = 65 // minutes a cell emits rising billowing smoke
const MAX_FLAMES = 260 // dense pool of flame billboards forming a continuous fire ribbon
const MAX_SMOKE = 150 // volumetric smoke puffs forming the dark billowing smoke blanket

export interface Side {
  name: string
  arrival: Float32Array
}

interface Look {
  alpha: number
  brightness?: number
  saturation?: number
}

// Active front: incandescent, vibrant fire glow on the ground
const FRONT: Look = { alpha: 0.95, brightness: 1.35, saturation: 1.35 }
// Burned scar: deep charred pitch-black earth and ash
const SCAR: Look = { alpha: 0.92, brightness: 0.04, saturation: 0.0 }

export class SplitLayer {
  private readonly layers: ImageryLayer[] = []
  private root: HTMLElement | undefined
  position = 0.5
  private visible = true

  // 3D Flames & Volumetric Smoke
  private readonly flames: BillboardCollection
  private readonly flamePool: Billboard[] = []
  private readonly smoke: BillboardCollection
  private readonly smokePool: Billboard[] = []
  private frame = 0
  private readonly flameImage: string
  private readonly smokeImage: string

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    private readonly grid: Grid,
    private readonly sides: Side[],
    private readonly durationMin: number,
    private readonly weather?: Weather,
  ) {
    const rect = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    const split = sides.length > 1

    // 1. Drape imagery layers: supersampled with bilinear anti-pixelation
    const scale = 2
    const outW = grid.cols * scale
    const outH = grid.rows * scale

    sides.forEach((side, s) => {
      const url = encodeHighRes(grid, side.arrival, durationMin, scale)
      const direction = !split ? SplitDirection.NONE : s === 0 ? SplitDirection.LEFT : SplitDirection.RIGHT
      this.layers.push(
        this.add(url, outW, outH, rect, direction, FRONT),
        this.add(url, outW, outH, rect, direction, SCAR),
      )
    })

    // 2. Dense 3D Flame Ribbon pool
    this.flameImage = makeFlameSprite()
    this.flames = viewer.scene.primitives.add(new BillboardCollection())
    const initPos = Cartesian3.fromDegrees(
      (this.grid.rect.west + this.grid.rect.east) / 2,
      (this.grid.rect.south + this.grid.rect.north) / 2,
      200,
    )
    for (let i = 0; i < MAX_FLAMES; i++) {
      const bb = this.flames.add({
        position: initPos,
        image: this.flameImage,
        sizeInMeters: true,
        width: 48,
        height: 38,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(800, 1.0, 18_000, 2.6),
        show: false,
      })
      this.flamePool.push(bb)
    }

    // 3. Volumetric Billowing Smoke Blanket pool
    this.smokeImage = makeSmokeSprite()
    this.smoke = viewer.scene.primitives.add(new BillboardCollection())
    for (let i = 0; i < MAX_SMOKE; i++) {
      const bb = this.smoke.add({
        position: initPos,
        image: this.smokeImage,
        sizeInMeters: true,
        width: 140,
        height: 140,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(800, 1.0, 22_000, 2.2),
        show: false,
      })
      this.smokePool.push(bb)
    }

    this.set(0)
    if (!split) return

    // 4. Split compare slider (when both A and B are present)
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

  setPosition(position: number) {
    if (!this.root) return
    this.position = Math.min(Math.max(position, 0), 1)
    this.root.style.setProperty('--split', `${(this.position * 100).toFixed(2)}%`)
    this.viewer.scene.splitPosition = this.position
  }

  show(on: boolean) {
    this.visible = on
    for (const layer of this.layers) layer.show = on
    this.flames.show = on
    this.smoke.show = on
    if (this.root) this.root.hidden = !on
  }

  /** Show fires as they stand `hours` after the ignition */
  set(hours: number) {
    const t = Math.min(Math.max(hours * 60, 0), this.durationMin)
    const front = 1 - (KEY * t) / this.durationMin
    const scar = 1 - (KEY * Math.max(t - FLAME_WINDOW_MIN, 0)) / this.durationMin

    // 1. Update drape imagery thresholds (active flame vs black charred scar)
    for (let i = 0; i < this.layers.length; i += 2) {
      this.layers[i].colorToAlphaThreshold = front
      this.layers[i + 1].colorToAlphaThreshold = scar
    }

    if (!this.visible || t <= 0) {
      this.flames.show = false
      this.smoke.show = false
      for (let i = 0; i < this.flamePool.length; i++) this.flamePool[i].show = false
      for (let i = 0; i < this.smokePool.length; i++) this.smokePool[i].show = false
      return
    }

    const { cols } = this.grid
    const isSplit = this.sides.length > 1
    const frame = ++this.frame

    // Wind direction and speed from weather
    const hourIdx = Math.min(Math.floor(hours), (this.weather?.windFromDeg.length ?? 1) - 1)
    const windFrom = this.weather?.windFromDeg[hourIdx] ?? 315
    const windToRad = CesiumMath.toRadians(windFrom + 180) // direction wind is blowing towards
    const windSin = Math.sin(windToRad)
    const windCos = Math.cos(windToRad)

    // 2. Identify active front cells for the continuous flame ribbon [t - FLAME_WINDOW_MIN, t]
    // and smoke cells for the billowing smoke cloud [t - SMOKE_WINDOW_MIN, t]
    const flameCells: { lon: number; lat: number; age: number; k: number }[] = []
    const smokeCells: { lon: number; lat: number; age: number; k: number }[] = []

    for (let sIdx = 0; sIdx < this.sides.length; sIdx++) {
      const arr = this.sides[sIdx].arrival
      for (let k = 0; k < arr.length; k++) {
        const arrivalMin = arr[k]
        const age = t - arrivalMin
        if (age < 0 || age > SMOKE_WINDOW_MIN) continue

        const col = k % cols
        const row = (k - col) / cols
        const pos = lonLatAt(this.grid, col + 0.5, row + 0.5)

        if (isSplit) {
          const normLon = (pos.lon - this.grid.rect.west) / (this.grid.rect.east - this.grid.rect.west)
          if (sIdx === 0 && normLon > this.position) continue
          if (sIdx === 1 && normLon < this.position) continue
        }

        if (age <= FLAME_WINDOW_MIN) {
          flameCells.push({ lon: pos.lon, lat: pos.lat, age, k })
        }
        smokeCells.push({ lon: pos.lon, lat: pos.lat, age, k })
      }
    }

    // 3. Update continuous 3D Flame Ribbon
    const numFlames = flameCells.length
    const flameStep = numFlames > MAX_FLAMES ? Math.ceil(numFlames / MAX_FLAMES) : 1
    let usedFlames = 0

    for (let i = 0; i < numFlames && usedFlames < MAX_FLAMES; i += flameStep) {
      const cell = flameCells[i]
      const bb = this.flamePool[usedFlames]
      const h = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(cell.lon, cell.lat)) ?? 0

      // Jitter slightly along normal to create natural irregular fiery teeth
      const jitterLon = (Math.sin(cell.k * 53.3) * 0.15 * (this.grid.rect.east - this.grid.rect.west)) / cols
      const jitterLat = (Math.cos(cell.k * 67.7) * 0.15 * (this.grid.rect.north - this.grid.rect.south)) / this.grid.rows
      bb.position = Cartesian3.fromDegrees(cell.lon + jitterLon, cell.lat + jitterLat, h - 0.5)

      const life = Math.min(1, cell.age / 0.5) * Math.max(0, 1 - Math.pow(cell.age / FLAME_WINDOW_MIN, 2.5))
      const flicker = 0.84 + 0.16 * Math.sin(frame * 0.45 + cell.k * 17.1)
      bb.scale = life * flicker
      bb.show = life > 0.02
      usedFlames++
    }
    for (let i = usedFlames; i < MAX_FLAMES; i++) this.flamePool[i].show = false
    this.flames.show = true

    // 4. Update dense, billowing volumetric Smoke Blanket
    const numSmoke = smokeCells.length
    const smokeStep = numSmoke > MAX_SMOKE ? Math.ceil(numSmoke / MAX_SMOKE) : 1
    let usedSmoke = 0

    for (let i = 0; i < numSmoke && usedSmoke < MAX_SMOKE; i += smokeStep) {
      const cell = smokeCells[i]
      const bb = this.smokePool[usedSmoke]
      const h = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(cell.lon, cell.lat)) ?? 0

      // As smoke ages, it rises vertically and drifts downwind
      const driftM = Math.min(500, cell.age * 9.0)
      const dLon = (windSin * driftM) / 111_000
      const dLat = (windCos * driftM) / 111_000
      const riseM = 22 + Math.min(180, cell.age * 2.8)

      bb.position = Cartesian3.fromDegrees(cell.lon + dLon, cell.lat + dLat, h + riseM)

      // Smoke billow scale & opacity curve: blooms rapidly, hangs dense, then disperses
      const smokeLife = Math.min(1, cell.age / 2.0) * Math.max(0, 1 - Math.pow(cell.age / SMOKE_WINDOW_MIN, 2.0))
      const billow = 0.92 + 0.08 * Math.sin(frame * 0.18 + cell.k * 11.3)
      bb.scale = smokeLife * billow
      bb.show = smokeLife > 0.03
      usedSmoke++
    }
    for (let i = usedSmoke; i < MAX_SMOKE; i++) this.smokePool[i].show = false
    this.smoke.show = true
  }

  destroy() {
    for (const layer of this.layers) this.viewer.imageryLayers.remove(layer, true)
    this.viewer.scene.primitives.remove(this.flames)
    this.viewer.scene.primitives.remove(this.smoke)
    if (!this.root) return
    this.root.remove()
    this.viewer.scene.splitPosition = 0
  }

  private add(
    url: string,
    tileWidth: number,
    tileHeight: number,
    rectangle: Rectangle,
    splitDirection: SplitDirection,
    look: Look,
  ): ImageryLayer {
    const provider = new SingleTileImageryProvider({
      url,
      tileWidth,
      tileHeight,
      rectangle,
    })
    const layer = this.viewer.imageryLayers.addImageryProvider(provider)
    layer.splitDirection = splitDirection
    layer.colorToAlpha = Color.WHITE
    layer.colorToAlphaThreshold = 1
    // Linear texture filtering removes the Minecraft blocky edges
    layer.minificationFilter = TextureMinificationFilter.LINEAR
    layer.magnificationFilter = TextureMagnificationFilter.LINEAR
    Object.assign(layer, look)
    return layer
  }
}

/** Supersample the arrival grid with bilinear anti-pixelation into a high-res image */
function encodeHighRes(grid: Grid, arrival: Float32Array, durationMin: number, scale = 2): string {
  const { cols, rows } = grid
  const outW = cols * scale
  const outH = rows * scale
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.createImageData(outW, outH)
  const data = new Uint32Array(imgData.data.buffer)

  const n = cols * rows
  const burnedMask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (arrival[i] < durationMin) burnedMask[i] = 1
  }

  // Pre-fill white (transparent in Cesium colorToAlpha)
  data.fill(0xffffffff)

  for (let py = 0; py < outH; py++) {
    const gy = (py + 0.5) / scale - 0.5
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
    const r1 = Math.max(0, Math.min(rows - 1, r0 + 1))
    const fy = gy - r0

    for (let px = 0; px < outW; px++) {
      const gx = (px + 0.5) / scale - 0.5
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)))
      const c1 = Math.max(0, Math.min(cols - 1, c0 + 1))
      const fx = gx - c0

      const idx00 = r0 * cols + c0
      const idx10 = r0 * cols + c1
      const idx01 = r1 * cols + c0
      const idx11 = r1 * cols + c1

      const b00 = burnedMask[idx00]
      const b10 = burnedMask[idx10]
      const b01 = burnedMask[idx01]
      const b11 = burnedMask[idx11]

      if (b00 + b10 + b01 + b11 === 0) continue

      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const burnWeight = w00 * b00 + w10 * b10 + w01 * b01 + w11 * b11
      if (burnWeight < 0.42) continue

      let sumArr = 0
      let sumW = 0
      if (b00) { sumArr += w00 * arrival[idx00]; sumW += w00 }
      if (b10) { sumArr += w10 * arrival[idx10]; sumW += w10 }
      if (b01) { sumArr += w01 * arrival[idx01]; sumW += w01 }
      if (b11) { sumArr += w11 * arrival[idx11]; sumW += w11 }

      let a = sumW > 0 ? sumArr / sumW : durationMin
      // Sub-cell gradient across border
      if (burnWeight < 0.95) {
        a += (0.95 - burnWeight) * 3.5
      }

      if (a < durationMin) {
        const k = Math.min(255, Math.max(0, Math.round((255 * KEY * a) / durationMin)))
        // Little-endian 0xAABBGGRR: Alpha=255, Blue=k, Green=163, Red=255
        data[py * outW + px] = (0xff << 24) | (k << 16) | (0xa3 << 8) | 0xff
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Procedural multi-tongued wildfire flame sprite forming a continuous fiery wall */
function makeFlameSprite(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')!

  // Broad incandescent glowing base
  const baseGrad = g.createRadialGradient(64, 115, 4, 64, 100, 58)
  baseGrad.addColorStop(0, 'rgba(255, 255, 230, 1.0)')
  baseGrad.addColorStop(0.35, 'rgba(255, 205, 45, 0.95)')
  baseGrad.addColorStop(0.7, 'rgba(255, 85, 12, 0.82)')
  baseGrad.addColorStop(1, 'rgba(180, 20, 0, 0)')
  g.fillStyle = baseGrad
  g.beginPath()
  g.ellipse(64, 115, 60, 20, 0, 0, Math.PI * 2)
  g.fill()

  const drawTongue = (cx: number, cy: number, w: number, h: number, curve: number) => {
    const grad = g.createRadialGradient(cx, cy + h * 0.4, 2, cx, cy, h * 0.72)
    grad.addColorStop(0, 'rgba(255, 255, 240, 1.0)')
    grad.addColorStop(0.28, 'rgba(255, 215, 55, 0.96)')
    grad.addColorStop(0.62, 'rgba(255, 95, 12, 0.88)')
    grad.addColorStop(0.85, 'rgba(210, 35, 5, 0.55)')
    grad.addColorStop(1, 'rgba(120, 10, 0, 0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(cx, cy - h)
    g.bezierCurveTo(cx + w + curve, cy - h * 0.3, cx + w, cy + h * 0.4, cx, cy + h * 0.5)
    g.bezierCurveTo(cx - w, cy + h * 0.4, cx - w + curve, cy - h * 0.3, cx, cy - h)
    g.fill()
  }

  // 5 overlapping fire tongues forming a thick wall of flame
  drawTongue(64, 60, 28, 56, 4)
  drawTongue(42, 68, 24, 46, -3)
  drawTongue(86, 68, 24, 46, 3)
  drawTongue(22, 82, 19, 34, -5)
  drawTongue(106, 82, 19, 34, 5)

  return canvas.toDataURL('image/png')
}

/** Volumetric multi-lobed dark billowing smoke cloud puff */
function makeSmokeSprite(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')!

  const drawPuff = (cx: number, cy: number, r: number, alpha: number) => {
    const grad = g.createRadialGradient(cx, cy, r * 0.08, cx, cy, r)
    grad.addColorStop(0, `rgba(22, 19, 18, ${alpha})`)
    grad.addColorStop(0.48, `rgba(32, 28, 26, ${alpha * 0.72})`)
    grad.addColorStop(0.82, `rgba(45, 40, 38, ${alpha * 0.28})`)
    grad.addColorStop(1, 'rgba(50, 45, 42, 0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()
  }

  // Overlapping soft organic lobes
  drawPuff(64, 64, 58, 0.72)
  drawPuff(46, 50, 46, 0.62)
  drawPuff(82, 52, 46, 0.62)
  drawPuff(54, 82, 42, 0.58)
  drawPuff(76, 78, 42, 0.58)

  return canvas.toDataURL('image/png')
}
