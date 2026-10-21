// Realistic continuous wildfire simulation on the 3D terrain:
// 1. Radiant, multi-tonal active flame ribbon draped directly over the topography (incandescent white-gold crest,
//    bright golden yellow, fiery orange, deep amber-crimson, smoldering embers).
// 2. Subtle layers of dark charcoal, soot, and ash for the burned area, keeping mountain relief and contours visible.
// 3. Soft, atmospheric smoke veil drifting downwind over the burned basin.
// 4. Zero billboard sprites or emoji-like icons — 100% continuous GPU-accelerated terrain shader.
// 5. Screen-space A/B split comparison slider adhering to 3D terrain.

import {
  ClassificationType,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  Material,
  Rectangle,
  RectangleGeometry,
  type Viewer,
} from 'cesium'
import type { Weather } from './data'
import type { Grid } from './grid'
import './split.css'

export interface Side {
  name: string
  arrival: Float32Array
}

const FIRE_SHADER = /* glsl */ `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);

  // 1. Screen-space A/B Split slider clipping
  if (splitSide >= 0.0) {
    float screenWidth = max(czm_viewport.z, 1.0);
    float screenX = gl_FragCoord.x / screenWidth;
    if (splitSide < 0.5 && screenX > split) {
      m.alpha = 0.0;
      return m;
    }
    if (splitSide > 0.5 && screenX < split) {
      m.alpha = 0.0;
      return m;
    }
  }

  // 2. Texture lookup: R = arrival time (0..span), G = burned mask (0..1)
  vec4 s = texture(image, materialInput.st);
  float arrivalMin = s.r * span;
  float age = minutes - arrivalMin;

  // Unburned cell or flame hasn't arrived yet
  if (s.g < 0.20 || age < 0.0) {
    m.alpha = 0.0;
    return m;
  }

  // Smooth sub-meter anti-aliased edge
  float edgeFade = smoothstep(0.18, 0.65, s.g);

  // Micro heat-shimmer and organic wave turbulence along the fireline
  float flicker = 0.88 + 0.12 * sin(czm_frameNumber * 0.35 + materialInput.st.s * 820.0 + materialInput.st.t * 540.0);
  float wave = 0.94 + 0.06 * sin(czm_frameNumber * 0.15 + materialInput.st.s * 310.0 - materialInput.st.t * 220.0);

  // 3. Natural Muted Wildfire Palette (Acinzentado & Menos Vivo)
  // Thin, sharp glowing perimeter edge cooling rapidly into realistic mineral ash and charcoal
  vec3 cWhiteGold    = vec3(0.96, 0.93, 0.80);    // warm white-gold glowing crest
  vec3 cWarmAmber    = vec3(0.88, 0.64, 0.24);    // natural desaturated golden amber
  vec3 cMutedFlame   = vec3(0.78, 0.40, 0.12);    // organic muted fire flame
  vec3 cCoolingEmber = vec3(0.40, 0.16, 0.06);    // dark reddish-amber cooling coals
  vec3 cAshGray      = vec3(0.24, 0.23, 0.22);    // subtle mineral ash gray (predominant)
  vec3 cDarkCharcoal = vec3(0.13, 0.125, 0.12);   // soft soot and charcoal
  vec3 cAshHighlight = vec3(0.29, 0.28, 0.26);    // lighter ash deposits on ridges
  vec3 cSmoke        = vec3(0.55, 0.54, 0.52);    // soft pale grayish-white smoke veil

  vec3 color;
  vec3 emission;
  float alpha;

  if (age < 1.4) {
    // 1. Leading incandescent edge (0.0 to 1.4 min): Thin, sharp glowing crest line
    float t = age / 1.4;
    color = mix(cWhiteGold, cWarmAmber, t) * flicker;
    emission = color * 1.35;
    alpha = 0.95;
  } else if (age < 4.2) {
    // 2. Active flaming ribbon (1.4 to 4.2 min): Warm golden amber to muted flame
    float t = (age - 1.4) / 2.8;
    color = mix(cWarmAmber, cMutedFlame, t) * flicker;
    emission = color * 1.05;
    alpha = 0.92;
  } else if (age < 8.5) {
    // 3. Cooling embers (4.2 to 8.5 min): Muted flame to cooling dark coals
    float t = (age - 4.2) / 4.3;
    color = mix(cMutedFlame, cCoolingEmber, t) * wave;
    emission = cCoolingEmber * (1.0 - t * 0.70) * 0.40;
    alpha = mix(0.90, 0.82, t);
  } else {
    // 4. Burned area: subtle mineral ash gray and soft charcoal with organic relief variations
    float sootNoise = 0.88 + 0.24 * fract(sin(dot(materialInput.st * 340.0, vec2(12.9898, 78.233))) * 43758.5453);
    float k = clamp((age - 8.5) / 35.0, 0.0, 1.0);
    
    // Base tone: blend of ash gray and charcoal with noise
    vec3 baseScar = mix(cCoolingEmber * 0.35, cDarkCharcoal * sootNoise, k);

    // Subtle ash deposit highlights following terrain relief
    float ashMod = 0.50 + 0.50 * sin(materialInput.st.s * 75.0 + materialInput.st.t * 55.0);
    vec3 finalScar = mix(baseScar, mix(cAshGray, cAshHighlight, ashMod), clamp((age - 8.5) / 25.0, 0.40, 0.85));

    // Soft, pale grayish-white smoke haze lingering over recently burned basin
    if (age < 55.0) {
      float smokeHaze = (1.0 - (age - 8.5) / 46.5) * 0.22;
      finalScar = mix(finalScar, cSmoke, smokeHaze);
    }

    color = finalScar;
    emission = cCoolingEmber * (1.0 - k) * 0.08;
    // Calibrated alpha preserves 3D terrain relief, shadows, and satellite imagery underneath
    alpha = mix(0.78, 0.70, k);
  }

  m.diffuse = color;
  m.emission = emission;
  m.alpha = alpha * edgeFade;
  return m;
}
`

export class SplitLayer {
  private readonly primitives: GroundPrimitive[] = []
  private readonly materials: Material[] = []
  private root: HTMLElement | undefined
  position = 0.5
  private visible = true

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    grid: Grid,
    sides: Side[],
    private readonly durationMin: number,
    _weather?: Weather,
  ) {
    const rect = Rectangle.fromDegrees(grid.rect.west, grid.rect.south, grid.rect.east, grid.rect.north)
    const isSplit = sides.length > 1
    const span = Math.max(1, durationMin)

    // Build one GPU GroundPrimitive per side (Side A on left, Side B on right, or single Free run)
    sides.forEach((side, s) => {
      const canvas = encodeGridTexture(grid, side.arrival, durationMin, 2)
      const splitSide = isSplit ? (s === 0 ? 0.0 : 1.0) : -1.0

      const material = new Material({
        fabric: {
          uniforms: {
            image: canvas,
            minutes: 0,
            span,
            split: this.position,
            splitSide,
          },
          source: FIRE_SHADER,
        },
        translucent: true,
      })
      this.materials.push(material)

      const primitive = viewer.scene.primitives.add(
        new GroundPrimitive({
          geometryInstances: new GeometryInstance({
            geometry: new RectangleGeometry({
              rectangle: rect,
              vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
            }),
          }),
          appearance: new EllipsoidSurfaceAppearance({
            material,
            flat: true,
            aboveGround: false,
          }),
          classificationType: ClassificationType.TERRAIN,
        }),
      ) as GroundPrimitive

      this.primitives.push(primitive)
    })

    this.set(0)
    if (!isSplit) return

    // Interactive A/B split comparison slider
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
    this.position = Math.min(Math.max(position, 0), 1)
    if (this.root) {
      this.root.style.setProperty('--split', `${(this.position * 100).toFixed(2)}%`)
    }
    for (const mat of this.materials) {
      mat.uniforms.split = this.position
    }
    this.viewer.scene.splitPosition = this.position
  }

  show(on: boolean) {
    this.visible = on
    for (const primitive of this.primitives) {
      primitive.show = on
    }
    if (this.root) this.root.hidden = !on
  }

  /** Advance simulated fire to `hours` after ignition */
  set(hours: number) {
    if (!this.visible) return
    const minutes = Math.min(Math.max(hours * 60, 0), this.durationMin)
    for (const mat of this.materials) {
      mat.uniforms.minutes = minutes
    }
  }

  destroy() {
    for (const primitive of this.primitives) {
      this.viewer.scene.primitives.remove(primitive)
    }
    this.primitives.length = 0
    this.materials.length = 0
    if (this.root) {
      this.root.remove()
      this.root = undefined
    }
    this.viewer.scene.splitPosition = 0
  }
}

/**
 * Encodes grid arrival times into a high-resolution, supersampled canvas texture:
 * - Channel R: normalized arrival time (0..255)
 * - Channel G: burned cell mask (0..255) with smooth bilinear anti-aliasing
 * - Unburned cells adjacent to the perimeter inherit the nearest arrival time so
 *   bilinear texture filtering blends the boundary mask without smearing arrival times.
 */
function encodeGridTexture(grid: Grid, arrival: Float32Array, durationMin: number, scale = 2): HTMLCanvasElement {
  const { cols, rows } = grid
  const span = Math.max(1, durationMin)
  const code = (m: number) => Math.min(255, Math.max(0, Math.round((m / span) * 255)))

  const total = cols * rows
  const arrCode = new Uint8Array(total)
  const burnMask = new Uint8Array(total)

  for (let k = 0; k < total; k++) {
    const a = arrival[k]
    if (Number.isFinite(a) && a < durationMin) {
      arrCode[k] = code(a)
      burnMask[k] = 255
    } else {
      arrCode[k] = 255
      burnMask[k] = 0
    }
  }

  // Flood-fill 2-ring unburned border cells with the nearest arrival code
  // so linear texture filtering blends the mask (G) without smearing arrival (R)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c
      if (burnMask[k] === 0) {
        let minCode = 255
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = r + dr
            const nc = c + dc
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
            const nk = nr * cols + nc
            if (burnMask[nk] > 0) {
              minCode = Math.min(minCode, arrCode[nk])
            }
          }
        }
        arrCode[k] = minCode
      }
    }
  }

  // Supersample grid with bilinear interpolation
  const outW = cols * scale
  const outH = rows * scale
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.createImageData(outW, outH)
  const data = imgData.data

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

      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const k00 = r0 * cols + c0
      const k10 = r0 * cols + c1
      const k01 = r1 * cols + c0
      const k11 = r1 * cols + c1

      const m00 = burnMask[k00]
      const m10 = burnMask[k10]
      const m01 = burnMask[k01]
      const m11 = burnMask[k11]

      const mask = Math.round(w00 * m00 + w10 * m10 + w01 * m01 + w11 * m11)
      const arr = Math.round(
        w00 * arrCode[k00] + w10 * arrCode[k10] + w01 * arrCode[k01] + w11 * arrCode[k11],
      )

      const offset = (py * outW + px) * 4
      data[offset] = arr      // R: arrival time
      data[offset + 1] = mask // G: burned mask
      data[offset + 2] = 255  // B: reserved / suppression line
      data[offset + 3] = 255  // A: opaque
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas
}
