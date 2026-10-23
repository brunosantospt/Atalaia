// Live flames on the fire front: every cell that caught fire in the last HOT_MIN gets a soft glowing sprite,
// white-yellow when it ignites, cooling to orange and red and fading as it burns out. Each flickers with its
// own phase, so the front looks alive at any zoom. Display only; the models never read it.
import { BillboardCollection, Cartesian3, Color, HeightReference, NearFarScalar, SplitDirection, type Billboard, type Viewer } from 'cesium'
import type { Grid } from './grid'

const HOT_MIN = 14 // a cell glows this long after it catches fire
const MAX_FLAMES = 2500 // a very fast run thins its front rather than drowning the GPU
const FPS = 24

export class FrontFlames {
  private readonly collection: BillboardCollection
  private readonly minute: Float32Array // arrival of each burning cell, ascending
  private readonly position: Cartesian3[]
  private readonly phase: Float32Array
  private readonly live = new Map<number, Billboard>()
  private now = -Infinity
  private on = true
  private raf = 0
  private last = 0

  constructor(private readonly viewer: Viewer, grid: Grid, arrival: Float32Array, durationMin: number, split = SplitDirection.NONE) {
    this.collection = viewer.scene.primitives.add(new BillboardCollection({ scene: viewer.scene }))
    const order: number[] = []
    arrival.forEach((m, i) => m <= durationMin && order.push(i))
    order.sort((a, b) => arrival[a] - arrival[b])
    const { west, east, south, north } = grid.rect
    this.minute = Float32Array.from(order, (i) => arrival[i])
    this.position = order.map((i) => {
      const col = i % grid.cols, row = (i - col) / grid.cols
      return Cartesian3.fromDegrees(west + (col + 0.5) / grid.cols * (east - west), north - (row + 0.5) / grid.rows * (north - south))
    })
    this.phase = Float32Array.from(order, (i) => ((i * 2654435761) % 1000) / 1000 * Math.PI * 2)
    this.size = grid.cellsize * 2.2
    this.split = split
    this.tick = this.tick.bind(this)
  }
  private readonly size: number
  private readonly split: SplitDirection

  show(on: boolean) {
    this.on = on
    this.collection.show = on
    this.loop()
  }

  /** The front `minutes` after the ignition: flames for the cells that caught fire in the last HOT_MIN. */
  set(minutes: number) {
    this.now = minutes
    const lo = bisect(this.minute, minutes - HOT_MIN), hi = bisect(this.minute, minutes)
    const stride = Math.max(1, Math.ceil((hi - lo) / MAX_FLAMES))
    for (const [k, b] of this.live) if (k < lo || k >= hi || k % stride) { this.collection.remove(b); this.live.delete(k) }
    for (let k = lo; k < hi; k++) {
      if (k % stride || this.live.has(k)) continue
      this.live.set(k, this.collection.add({
        position: this.position[k], image: flameTexture(), width: this.size, height: this.size, sizeInMeters: true,
        heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 4000,
        scaleByDistance: new NearFarScalar(2000, 1, 40000, 2.5), // far away a cell is tiny: keep the glow readable
        splitDirection: this.split,
      }))
    }
    this.paint(performance.now())
    this.loop()
  }

  private paint(ms: number) {
    const s = ms / 1000
    for (const [k, b] of this.live) {
      const age = Math.max(0, this.now - this.minute[k]) / HOT_MIN // 0 just lit … 1 out
      const p = this.phase[k]
      const flicker = 0.72 + 0.18 * Math.sin(s * 9.1 + p) + 0.1 * Math.sin(s * 23.7 + p * 2.3)
      b.scale = (1.15 - 0.55 * age) * flicker
      b.color = heat(age, (1 - age) ** 0.7 * (0.65 + 0.35 * flicker))
    }
  }

  /** Redraw at FPS while flames are on screen; the scene renders on request otherwise. */
  private loop() {
    if (this.raf || !this.on || !this.live.size) return
    this.raf = requestAnimationFrame(this.tick)
  }
  private tick(ms: number) {
    this.raf = 0
    if (!this.on || !this.live.size || this.collection.isDestroyed()) return
    if (ms - this.last >= 1000 / FPS) {
      this.last = ms
      this.paint(ms)
      this.viewer.scene.requestRender()
    }
    this.loop()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.live.clear()
    this.viewer.scene.primitives.remove(this.collection)
  }
}

/** First index whose minute is above `t`. */
function bisect(a: Float32Array, t: number) {
  let lo = 0, hi = a.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= t) lo = mid + 1; else hi = mid }
  return lo
}

/** White-yellow (just lit) → orange → deep red (burning out). */
const HOT = [Color.fromCssColorString('#fff3c4'), Color.fromCssColorString('#ffb020'), Color.fromCssColorString('#ff5a1f'), Color.fromCssColorString('#b3200f')]
const scratch = new Color()
function heat(age: number, alpha: number): Color {
  const x = Math.min(0.999, age) * (HOT.length - 1), i = Math.floor(x)
  Color.lerp(HOT[i], HOT[i + 1], x - i, scratch)
  return new Color(scratch.red, scratch.green, scratch.blue, alpha)
}

let texture: HTMLCanvasElement | undefined
/** A soft round glow, white at the heart: tinted per flame by `heat`. */
function flameTexture(): HTMLCanvasElement {
  if (texture) return texture
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.75)'); r.addColorStop(0.7, 'rgba(255,255,255,.22)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  return (texture = c)
}
