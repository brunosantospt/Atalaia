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
  float edgeFade = smoothstep(0.20, 0.72, s.g);

  // Micro heat-shimmer and organic wave turbulence along the fireline
  float flicker = 0.88 + 0.12 * sin(czm_frameNumber * 0.35 + materialInput.st.s * 820.0 + materialInput.st.t * 540.0);
  float wave = 0.94 + 0.06 * sin(czm_frameNumber * 0.15 + materialInput.st.s * 310.0 - materialInput.st.t * 220.0);

  // 3. Multi-tonal Wildfire Thermal Palette
  // Incandescent white-gold crest -> radiant golden yellow -> intense fire orange -> deep amber -> glowing embers
  vec3 cWhiteGold   = vec3(1.0, 0.98, 0.74);    // incandescent crest along mountain ridges
  vec3 cGolden      = vec3(1.0, 0.82, 0.18);    // radiant golden yellow flame body
  vec3 cOrange      = vec3(1.0, 0.46, 0.04);    // pure fiery vibrant orange
  vec3 cAmber       = vec3(0.85, 0.22, 0.02);   // deep fiery amber-crimson
  vec3 cEmber       = vec3(0.42, 0.10, 0.02);   // glowing dark red coals
  vec3 cCharcoal    = vec3(0.065, 0.058, 0.052);// matte dark charcoal soot
  vec3 cAsh         = vec3(0.12, 0.10, 0.09);   // subtle ash gray-brown
  vec3 cSmoke       = vec3(0.15, 0.14, 0.13);   // soft warm smoke veil

  vec3 color;
  vec3 emission;
  float alpha;

  if (age < 2.5) {
    // Leading active crest (0 to 2.5 min): Incandescent crest, white-gold to golden yellow
    float t = age / 2.5;
    color = mix(cWhiteGold, cGolden, t) * flicker;
    emission = color * 1.4;
    alpha = 0.95;
  } else if (age < 8.0) {
    // Main flaming body (2.5 to 8.0 min): Radiant golden yellow to pure flame orange
    float t = (age - 2.5) / 5.5;
    color = mix(cGolden, cOrange, t) * flicker;
    emission = color * 1.15;
    alpha = 0.93;
  } else if (age < 18.0) {
    // Deep flame ribbon (8.0 to 18.0 min): Flame orange to deep amber-crimson
    float t = (age - 8.0) / 10.0;
    color = mix(cOrange, cAmber, t) * wave;
    emission = color * 0.70;
    alpha = 0.90;
  } else if (age < 35.0) {
    // Smoldering embers (18.0 to 35.0 min): Amber to glowing dark red embers
    float t = (age - 18.0) / 17.0;
    color = mix(cAmber, cEmber, t);
    emission = cEmber * (1.0 - t * 0.70) * 0.45;
    alpha = mix(0.88, 0.80, t);
  } else {
    // Burned area: subtle layers of dark charcoal, soot, and ash keeping terrain relief visible
    float sootNoise = 0.92 + 0.16 * fract(sin(dot(materialInput.st * 380.0, vec2(12.9898, 78.233))) * 43758.5453);
    float k = clamp((age - 35.0) / 45.0, 0.0, 1.0);
    vec3 baseScar = mix(cEmber * 0.45, cCharcoal * sootNoise, k);

    // Subtle ash layer near margins & terrain folds
    float ashMod = 0.85 + 0.15 * sin(materialInput.st.s * 85.0 + materialInput.st.t * 65.0);
    vec3 finalScar = mix(cAsh * ashMod, baseScar, clamp((age - 35.0) / 30.0, 0.35, 1.0));

    // Soft, non-exaggerated smoke veil lingering over recently burned basin
    if (age < 65.0) {
      float smokeHaze = (1.0 - (age - 35.0) / 30.0) * 0.20;
      finalScar = mix(finalScar, cSmoke, smokeHaze);
    }

    color = finalScar;
    emission = cEmber * (1.0 - k) * 0.12;
    // Subtle alpha (0.76 - 0.82) preserves 3D terrain shadows and satellite relief underneath
    alpha = mix(0.82, 0.76, k);
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
