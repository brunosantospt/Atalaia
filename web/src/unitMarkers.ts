// Screen-space DOM keeps symbols and text out of the globe's darkening/low-resolution passes.
import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, EllipsoidalOccluder, SceneTransforms, type Viewer } from 'cesium'
import type { LonLat } from './geo'
import type { UnitId } from './suppression'
import { unitIconUrl } from './unitIcons'
import './unitMarkers.css'

export interface UnitMarker extends LonLat {
  id: string
  unit: UnitId
  code: string
  position?: () => LonLat
  visible?: () => boolean
  pending?: boolean
  eta?: () => number
  /** Out of water / out of autonomy now: a badge over the icon. */
  status?: () => { dry: boolean; tired: boolean }
  label: string
  color: string
  offsetX: number
  offsetY: number
}

// A water drop struck through (no water) and an emptied battery (no autonomy left: the crew is spent).
const DRY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z" fill="#38bdf8" stroke="#fff" stroke-width="1.4"/><path d="M4 4l16 16" stroke="#ef4444" stroke-width="2.6" stroke-linecap="round"/></svg>'
const TIRED_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="16" height="10" rx="2" fill="#1f2937" stroke="#fff" stroke-width="1.4"/><rect x="19.5" y="10" width="2" height="4" rx=".6" fill="#fff"/><rect x="5" y="9" width="2.5" height="6" rx=".5" fill="#ef4444"/><path d="M11 11h4l-4 3h4" fill="none" stroke="#fbbf24" stroke-width="1.3" stroke-linejoin="round"/></svg>'

export class UnitMarkers {
  private readonly root = document.createElement('div')
  private items: { marker: UnitMarker; element: HTMLElement }[] = []
  private readonly pixel = new Cartesian2()
  private readonly world = new Cartesian3()
  private readonly ground = new Cartographic()

  constructor(private readonly viewer: Viewer, parent: HTMLElement) {
    this.root.className = 'unit-markers'
    parent.append(this.root)
    viewer.scene.postRender.addEventListener(() => this.update())
  }

  /** A CSS clip-path for all of them (the A | B comparison keeps each decision on its side). */
  clip(path: string) { if (this.root.style.clipPath !== path) this.root.style.clipPath = path }

  set(markers: UnitMarker[]) {
    const previous = new Map(this.items.map((i) => [i.marker.id, i.element]))
    this.items = markers.map((marker) => {
      const element = previous.get(marker.id) ?? document.createElement('div')
      element.className = 'unit-marker'
      if (element.dataset.unitId !== marker.id) element.dataset.unitId = marker.id
      if (element.style.getPropertyValue('--origin-color') !== marker.color) element.style.setProperty('--origin-color', marker.color)
      if (!element.firstChild) {
        element.hidden = true
        element.innerHTML = '<span class="unit-map-eta"></span><i class="unit-tether"></i><img alt=""/><span class="unit-map-label"><b></b></span>' +
          `<span class="unit-badges"><i class="unit-badge dry" title="Sem água" hidden>${DRY_SVG}</i><i class="unit-badge tired" title="Autonomia esgotada" hidden>${TIRED_SVG}</i></span>`
      }
      element.classList.toggle('pending', !!marker.pending)
      const tether = element.querySelector<HTMLElement>('.unit-tether')!
      tether.style.width = `${Math.hypot(marker.offsetX, marker.offsetY)}px`
      tether.style.transform = `rotate(${Math.atan2(-marker.offsetY, -marker.offsetX)}rad)`
      const img = element.querySelector('img')!
      const url = unitIconUrl(marker.unit, marker.color)
      if (img.getAttribute('src') !== url) img.src = url
      const id = element.querySelector('b')!
      if (id.textContent !== marker.code) id.textContent = marker.code
      element.setAttribute('aria-label', `${marker.code} · ${marker.label}`)
      return { marker, element }
    })
    if (this.root.children.length !== this.items.length || this.items.some((i, k) => this.root.children[k] !== i.element))
      this.root.replaceChildren(...this.items.map((i) => i.element))
  }

  private update() {
    const { scene } = this.viewer
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, scene.camera.positionWC)
    const positions = this.items.map(({ marker }) => marker.position?.() ?? marker)
    const key = (p: LonLat) => `${p.lon.toFixed(6)}:${p.lat.toFixed(6)}`
    const groups = new Map<string, number[]>()
    positions.forEach((p, i) => { if (this.items[i].marker.visible?.() !== false) groups.set(key(p), [...(groups.get(key(p)) ?? []), i]) })
    for (const [i, { marker: m, element }] of this.items.entries()) {
      if (m.visible?.() === false) { element.hidden = true; continue }
      const eta = element.querySelector<HTMLElement>('.unit-map-eta')!
      const remaining = m.eta?.() ?? 0
      eta.hidden = remaining <= 0
      const text = remaining > 0 ? `ETA ${Math.max(1, Math.ceil(remaining))} min` : ''
      if (eta.textContent !== text) eta.textContent = text
      const state = m.status?.()
      const dry = element.querySelector<HTMLElement>('.unit-badge.dry')!, tired = element.querySelector<HTMLElement>('.unit-badge.tired')!
      if (dry.hidden === !!state?.dry) dry.hidden = !state?.dry
      if (tired.hidden === !!state?.tired) tired.hidden = !state?.tired
      const at = positions[i]
      const group = groups.get(key(at))!
      const index = group.indexOf(i), row = Math.floor(index / 3)
      const columns = Math.min(group.length - row * 3, 3)
      const ox = ((index % 3) - (columns - 1) / 2) * 64, oy = row * 66
      if (m.offsetX !== ox || m.offsetY !== oy) {
        m.offsetX = ox; m.offsetY = oy
        const tether = element.querySelector<HTMLElement>('.unit-tether')!
        tether.style.width = `${Math.hypot(ox, oy)}px`
        tether.style.transform = `rotate(${Math.atan2(-oy, -ox)}rad)`
        scene.requestRender()
      }
      Cartographic.fromDegrees(at.lon, at.lat, 0, this.ground)
      const height = scene.globe.getHeight(this.ground) ?? 0
      Cartesian3.fromDegrees(at.lon, at.lat, height + 1, undefined, this.world)
      const p = occluder.isPointVisible(this.world) && SceneTransforms.worldToWindowCoordinates(scene, this.world, this.pixel)
      const x = p ? p.x + m.offsetX : -1000
      const y = p ? p.y + m.offsetY : -1000
      const visible = !!p && x >= -100 && y >= -50 && x <= scene.canvas.clientWidth + 100 && y <= scene.canvas.clientHeight + 50
      element.hidden = !visible
      if (visible) {
        const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
        if (element.style.transform !== transform) element.style.transform = transform
      }
    }
  }
}
