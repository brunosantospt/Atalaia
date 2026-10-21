// High-resolution simulated fire on the terrain:
// 1. Anti-pixelated 2x supersampled drape with smooth bilinear arrival field and linear texture filtering
// 2. Active flaming front in vibrant incandescent amber/gold
// 3. Already burned area in deep charred charcoal black/ash
// 4. Lightweight pool of 3D animated flame billboards flickering along the active front
// 5. Smoke plumes drifting with the wind over the fire

import {
  Billboard,
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConeEmitter,
  type ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  NearFarScalar,
  ParticleSystem,
  Rectangle,
  SingleTileImageryProvider,
  SplitDirection,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  Transforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { Weather } from './data'
import { lonLatAt, type Grid } from './grid'
import './split.css'

const KEY = 0.5
const FRONT_MIN = 25 // active flame window in minutes; older cells turn to black ash
const MAX_FLAMES = 120 // pool size of 3D flame billboards along the active front
const SMOKE_PLUMES = 3
const SMOKE_RISE_MS = 4.5
const SMOKE_RELAX_S = 18

export interface Side {
  name: string
  arrival: Float32Array
}

interface Look {
  alpha: number
  brightness?: number
  saturation?: number
}

// Active front: vibrant, incandescent golden-orange
const FRONT: Look = { alpha: 0.94, brightness: 1.25, saturation: 1.3 }
// Burned scar: deep charred charcoal black ash
const SCAR: Look = { alpha: 0.88, brightness: 0.15, saturation: 0.0 }

export class SplitLayer {
  private readonly layers: ImageryLayer[] = []
  private root: HTMLElement | undefined
  position = 0.5
  private visible = true

  // 3D Flames & Smoke
  private readonly flames: BillboardCollection
  private readonly flamePool: Billboard[] = []
  private frame = 0
  private readonly smoke: (ParticleSystem | undefined)[] = new Array(SMOKE_PLUMES).fill(undefined)
  private readonly smokeDrift = Array.from({ length: SMOKE_PLUMES }, () => new Cartesian3())
  private lastSmokeMin = -Infinity
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

    // 2. 3D Flame Billboard pool (without HeightReference to avoid asynchronous clamping errors)
    this.flameImage = makeFlameSprite()
    this.smokeImage = makeSmokeSprite()
    this.flames = viewer.scene.primitives.add(new BillboardCollection())
    const initPos = Cartesian3.fromDegrees(
      (this.grid.rect.west + this.grid.rect.east) / 2,
      (this.grid.rect.south + this.grid.rect.north) / 2,
    )
    for (let i = 0; i < MAX_FLAMES; i++) {
      const bb = this.flames.add({
        position: initPos,
        image: this.flameImage,
        sizeInMeters: true,
        width: 18 * 0.55,
        height: 18,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(600, 1.0, 15_000, 2.5),
        show: false,
      })
      this.flamePool.push(bb)
    }

    this.set(0)
    if (!split) return

    // 3. Split compare slider (when both A and B are present)
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
    for (const s of this.smoke) {
      if (s) s.show = on
    }
    if (this.root) this.root.hidden = !on
  }

  /** Show fires as they stand `hours` after the ignition */
  set(hours: number) {
    const t = Math.min(Math.max(hours * 60, 0), this.durationMin)
    const front = 1 - (KEY * t) / this.durationMin
    const scar = 1 - (KEY * Math.max(t - FRONT_MIN, 0)) / this.durationMin

    // 1. Update drape imagery thresholds
    for (let i = 0; i < this.layers.length; i += 2) {
      this.layers[i].colorToAlphaThreshold = front
      this.layers[i + 1].colorToAlphaThreshold = scar
    }

    if (!this.visible || t <= 0) {
      this.flames.show = false
      for (let i = 0; i < this.flamePool.length; i++) this.flamePool[i].show = false
      for (let p = 0; p < SMOKE_PLUMES; p++) this.removePlume(p)
      return
    }

    // 2. Find currently burning cells on the active front [t - FRONT_MIN, t]
    const { cols } = this.grid
    const isSplit = this.sides.length > 1
    const activeFront: { lon: number; lat: number; age: number; k: number }[] = []

    // Collect active cells from the primary (or both) sides
    for (let sIdx = 0; sIdx < this.sides.length; sIdx++) {
      const arr = this.sides[sIdx].arrival
      for (let k = 0; k < arr.length; k++) {
        const arrivalMin = arr[k]
        const age = t - arrivalMin
        if (age >= 0 && age <= FRONT_MIN) {
          const col = k % cols
          const row = (k - col) / cols
          const pos = lonLatAt(this.grid, col + 0.5, row + 0.5)

          if (isSplit) {
            const normLon = (pos.lon - this.grid.rect.west) / (this.grid.rect.east - this.grid.rect.west)
            if (sIdx === 0 && normLon > this.position) continue
            if (sIdx === 1 && normLon < this.position) continue
          }

          activeFront.push({ lon: pos.lon, lat: pos.lat, age, k })
        }
      }
    }

    // 3. Update flame billboards from pool
    const frame = ++this.frame
    const numActive = activeFront.length
    const step = numActive > MAX_FLAMES ? Math.ceil(numActive / MAX_FLAMES) : 1
    let usedFlames = 0

    for (let i = 0; i < numActive && usedFlames < MAX_FLAMES; i += step) {
      const cell = activeFront[i]
      const bb = this.flamePool[usedFlames]
      const h = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(cell.lon, cell.lat)) ?? 0
      bb.position = Cartesian3.fromDegrees(cell.lon, cell.lat, h)

      const life = Math.min(1, cell.age / 0.8) * Math.max(0, 1 - Math.pow(cell.age / FRONT_MIN, 2.2))
      const flicker = 0.82 + 0.18 * Math.sin(frame * 0.35 + cell.k * 13.7)
      bb.scale = life * flicker
      bb.show = life > 0.03
      usedFlames++
    }

    // Hide remaining billboards in pool
    for (let i = usedFlames; i < MAX_FLAMES; i++) {
      this.flamePool[i].show = false
    }
    this.flames.show = true

    // 4. Update smoke plumes periodically
    if (Math.abs(t - this.lastSmokeMin) >= 1.5 || (this.lastSmokeMin === -Infinity && t > 0)) {
      this.lastSmokeMin = t
      this.updateSmoke(hours, activeFront)
    }
  }

  /** Position smoke plumes over active burning areas and orient with the wind */
  private updateSmoke(hours: number, activeCells: { lon: number; lat: number }[]) {
    if (activeCells.length === 0) {
      for (let p = 0; p < SMOKE_PLUMES; p++) this.removePlume(p)
      return
    }

    // Space plumes apart
    const picked: { lon: number; lat: number }[] = []
    for (const cell of activeCells) {
      if (picked.length >= SMOKE_PLUMES) break
      const farEnough = picked.every((q) => {
        const dLon = (q.lon - cell.lon) * 111_000
        const dLat = (q.lat - cell.lat) * 111_000
        return Math.hypot(dLon, dLat) > 400
      })
      if (farEnough) picked.push(cell)
    }

    // Wind direction and speed from weather
    const hourIdx = Math.min(Math.floor(hours), (this.weather?.windFromDeg.length ?? 1) - 1)
    const windFrom = this.weather?.windFromDeg[hourIdx] ?? 315
    const windKmh = this.weather?.windKmh[hourIdx] ?? 18
    const windTo = CesiumMath.toRadians(windFrom + 180)
    const windMs = windKmh / 3.6
    const driftEnu = new Cartesian3(Math.sin(windTo) * windMs, Math.cos(windTo) * windMs, SMOKE_RISE_MS)

    for (let p = 0; p < SMOKE_PLUMES; p++) {
      const cell = picked[p]
      if (!cell) {
        this.removePlume(p)
        continue
      }
      const h = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(cell.lon, cell.lat)) ?? 0
      const origin = Cartesian3.fromDegrees(cell.lon, cell.lat, h + 5)
      const enu = Transforms.eastNorthUpToFixedFrame(origin)
      Matrix4.multiplyByPointAsVector(enu, driftEnu, this.smokeDrift[p])

      if (!this.smoke[p]) {
        this.smoke[p] = this.makePlume(p)
      }
      this.smoke[p]!.modelMatrix = enu
      this.smoke[p]!.show = this.visible
    }
  }

  private makePlume(p: number): ParticleSystem {
    const drift = this.smokeDrift[p]
    const pull = new Cartesian3()

    return this.viewer.scene.primitives.add(
      new ParticleSystem({
        image: this.smokeImage,
        sizeInMeters: true,
        imageSize: new Cartesian2(36, 36),
        startScale: 1.0,
        endScale: 7.5,
        startColor: new Color(0.18, 0.16, 0.15, 0.4),
        endColor: new Color(0.65, 0.65, 0.68, 0.0),
        emissionRate: 1.4,
        minimumParticleLife: 10,
        maximumParticleLife: 20,
        minimumSpeed: 3,
        maximumSpeed: 7,
        emitter: new ConeEmitter(CesiumMath.toRadians(16)),
        updateCallback: (particle, dt) => {
          Cartesian3.subtract(drift, particle.velocity, pull)
          Cartesian3.multiplyByScalar(pull, Math.min(1, dt / SMOKE_RELAX_S), pull)
          Cartesian3.add(particle.velocity, pull, particle.velocity)
        },
      }),
    ) as ParticleSystem
  }

  private removePlume(p: number) {
    const sys = this.smoke[p]
    if (sys) this.viewer.scene.primitives.remove(sys)
    this.smoke[p] = undefined
  }

  destroy() {
    for (const layer of this.layers) this.viewer.imageryLayers.remove(layer, true)
    this.viewer.scene.primitives.remove(this.flames)
    for (let p = 0; p < SMOKE_PLUMES; p++) this.removePlume(p)
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

/** Procedural flame sprite with bright core and hot amber/red body */
function makeFlameSprite(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const g = canvas.getContext('2d')!
  const grad = g.createRadialGradient(32, 104, 2, 32, 90, 60)
  grad.addColorStop(0, 'rgba(255, 255, 220, 1)')
  grad.addColorStop(0.2, 'rgba(255, 205, 55, 0.95)')
  grad.addColorStop(0.5, 'rgba(255, 95, 10, 0.8)')
  grad.addColorStop(0.85, 'rgba(200, 30, 0, 0.4)')
  grad.addColorStop(1, 'rgba(160, 20, 0, 0)')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(32, 0)
  g.bezierCurveTo(52, 40, 64, 80, 54, 112)
  g.quadraticCurveTo(32, 132, 10, 112)
  g.bezierCurveTo(0, 80, 12, 40, 32, 0)
  g.fill()
  return canvas.toDataURL('image/png')
}

/** Soft circular radial smoke sprite as a data URL */
function makeSmokeSprite(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)')
  grad.addColorStop(0.5, 'rgba(220, 220, 225, 0.4)')
  grad.addColorStop(1, 'rgba(200, 200, 210, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return canvas.toDataURL('image/png')
}
