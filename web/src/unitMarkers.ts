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
  label: string
  color: string
  offsetX: number
  offsetY: number
}

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

  set(markers: UnitMarker[]) {
    const previous = new Map(this.items.map((i) => [i.marker.id, i.element]))
    this.items = markers.map((marker) => {
      const element = previous.get(marker.id) ?? document.createElement('div')
      element.className = 'unit-marker'
      if (element.dataset.unitId !== marker.id) element.dataset.unitId = marker.id
      if (element.style.getPropertyValue('--origin-color') !== marker.color) element.style.setProperty('--origin-color', marker.color)
      if (!element.firstChild) {
        element.hidden = true
        element.innerHTML = '<i class="unit-tether"></i><img alt=""/><span class="unit-map-label"><b></b></span>'
      }
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
    positions.forEach((p, i) => groups.set(key(p), [...(groups.get(key(p)) ?? []), i]))
    for (const [i, { marker: m, element }] of this.items.entries()) {
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
