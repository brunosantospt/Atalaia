// Markers: a ring on the terrain, and an HTML tag over the canvas tied to it by a leader line.
// Tags sit on the side of their point away from the screen centre, so they never cover the
// action, and on each side they are pushed apart vertically so they never overlap.

import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Ellipsoid,
  EllipsoidalOccluder,
  type Entity,
  SceneTransforms,
  type Viewer,
} from 'cesium'
import { cleanLonLat, destination } from './geo'
import { landmarkIconUrl, landmarkColor } from './landmarkIcons'
import { BEST_CSS } from './reachLayer'
import type { MarkerKind, MarkerSpec } from './shots'

const RING_COLOR: Record<MarkerKind, Color> = {
  ignition: Color.fromCssColorString('#f0a33a'),
  step: Color.fromCssColorString('#f0a33a').withAlpha(0.8),
  station: Color.fromCssColorString('#d9dcdf').withAlpha(0.85),
  hospital: Color.fromCssColorString('#6ee7b7'),
  airbase: Color.fromCssColorString('#7dd3fc'),
  best: Color.fromCssColorString(BEST_CSS),
  tsat: Color.fromCssColorString('#f0a33a'),
}
const LEAD_PX = 54 // horizontal gap between a point and its tag
const GAP_PX = 6 // between stacked tags
const IN_PX = 24 // how far into a HUD panel a point may sit and still get its tag

/** The part of the screen the HUD leaves free for tags, in CSS pixels. */
export interface SafeArea {
  top: number
  bottom: number
  left: number
  right: number
  avoid: DOMRect[] // panels inside the area that a tag may not cover
}
const SVG = 'http://www.w3.org/2000/svg'

interface Marker {
  spec: MarkerSpec
  world: Cartesian3
  ring: Entity | undefined // none when the spec's ringM is 0
  icon: HTMLImageElement | undefined
  tag: HTMLElement
  line: SVGLineElement
  dot: SVGCircleElement
  side: 'left' | 'right'
  size?: { w: number; h: number }
}

export class MarkerLayer {
  private readonly source = new CustomDataSource('markers')
  private readonly root: HTMLElement
  private readonly svg: SVGSVGElement
  private readonly markers: Marker[] = []
  private readonly window = new Cartesian2()

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    specs: MarkerSpec[],
    private readonly safeArea: () => SafeArea,
  ) {
    viewer.dataSources.add(this.source)
    this.root = document.createElement('div')
    this.root.className = 'markers'
    this.svg = document.createElementNS(SVG, 'svg')
    this.root.append(this.svg)
    parent.append(this.root)

    for (const spec of specs) {
      const circle = Array.from({ length: 49 }, (_, i) => destination(spec, (i * 360) / 48, spec.ringM))
      const circleOk = cleanLonLat(circle).length > 0
      const ring = spec.ringM && circleOk
        ? this.source.entities.add({
            show: false,
            polyline: {
              positions: Cartesian3.fromDegreesArray(circle.flatMap((p) => [p.lon, p.lat])),
              clampToGround: true,
              width: spec.kind === 'station' ? 1.5 : 2,
              material: RING_COLOR[spec.kind],
            },
          })
        : undefined
      const tag = document.createElement('div')
      tag.className = `tag tag-${spec.kind}`
      tag.innerHTML = '<span></span>'
      tag.querySelector('span')!.textContent = spec.label
      const line = document.createElementNS(SVG, 'line')
      const dot = document.createElementNS(SVG, 'circle')
      line.setAttribute('class', `lead lead-${spec.kind}`)
      dot.setAttribute('class', `lead lead-${spec.kind}`)
      dot.setAttribute('r', '3')
      if (spec.color) {
        line.style.stroke = spec.color
        dot.style.fill = spec.color
      }
      if (spec.kind === 'best') {
        // Green like its line on the ground (reachLayer.ts); hud.css colours the other kinds.
        line.style.stroke = BEST_CSS
        dot.style.fill = BEST_CSS
      }
      this.svg.append(line, dot)
      this.root.append(tag)
      const icon = spec.persistent || spec.kind === 'ignition' ? document.createElement('img') : undefined
      if (icon) {
        icon.className = 'landmark-icon'
        icon.src = landmarkIcon(spec)
        icon.alt = spec.label
        icon.hidden = true
        this.root.append(icon)
      }
      this.markers.push({
        spec,
        world: Cartesian3.fromDegrees(spec.lon, spec.lat, spec.h + 2),
        ring,
        icon,
        tag,
        line,
        dot,
        side: 'right',
      })
    }
  }

  /** Call after the camera has its final pose for the frame. */
  update(revealed: Set<string>) {
    const { scene } = this.viewer
    const width = scene.canvas.clientWidth
    const safe = this.safeArea()
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, scene.camera.positionWC)
    const placed: { m: Marker; x: number; y: number; ty: number }[] = []

    for (const m of this.markers) {
      const on = !!m.spec.persistent || revealed.has(m.spec.id)
      if (m.ring) m.ring.show = on
      let visible = false
      const p = on && occluder.isPointVisible(m.world) ? SceneTransforms.worldToWindowCoordinates(scene, m.world, this.window) : undefined
      if (m.icon) {
        m.icon.hidden = !p
        if (p) m.icon.style.transform = `translate(${Math.round(p.x - 15)}px, ${Math.round(p.y - 15)}px)`
      }
      if (p) {
        // Points under a HUD panel keep their ring but get no tag: the leader would cross the panel.
        if (p && p.x > safe.left - IN_PX && p.x < safe.right + IN_PX && p.y > safe.top - IN_PX && p.y < safe.bottom + IN_PX) {
          // Change side only once the point is clearly across the centre, so tags do not flicker.
          if (p.x < width / 2 - 40) m.side = 'left'
          else if (p.x > width / 2 + 40) m.side = 'right'
          m.size ??= measure(m.tag)
          placed.push({ m, x: p.x, y: p.y, ty: p.y - (m.size?.h ?? 0) - 18 })
          visible = true
        }
      }
      m.tag.classList.toggle('on', visible)
      m.line.classList.toggle('on', visible)
      m.dot.classList.toggle('on', visible)
    }

    for (const side of ['left', 'right'] as const) {
      const column = placed.filter((p) => p.m.side === side).sort((a, b) => a.ty - b.ty)
      // Push down from the top, then back up if the last ones fell off the bottom.
      let bottom = -Infinity
      for (const p of column) {
        p.ty = Math.max(p.ty, bottom + GAP_PX, safe.top)
        bottom = p.ty + (p.m.size?.h ?? 0)
      }
      let top = safe.bottom
      for (const p of column.reverse()) {
        const h = p.m.size?.h ?? 0
        p.ty = Math.min(p.ty, top - h)
        top = p.ty - GAP_PX
      }
    }

    for (const { m, x, y, ty } of placed) {
      const { w, h } = m.size ?? { w: 0, h: 0 }
      let tx = m.side === 'left' ? x - LEAD_PX - w : x + LEAD_PX
      tx = Math.min(Math.max(tx, safe.left), safe.right - w)
      if (safe.avoid.some((r) => tx < r.right && tx + w > r.left && ty < r.bottom && ty + h > r.top)) {
        m.tag.classList.remove('on')
        m.line.classList.remove('on')
        m.dot.classList.remove('on')
        continue
      }
      m.tag.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`
      const ex = m.side === 'left' ? tx + w : tx
      m.line.setAttribute('x1', x.toFixed(1))
      m.line.setAttribute('y1', y.toFixed(1))
      m.line.setAttribute('x2', ex.toFixed(1))
      m.line.setAttribute('y2', (ty + h / 2).toFixed(1))
      m.dot.setAttribute('cx', x.toFixed(1))
      m.dot.setAttribute('cy', y.toFixed(1))
    }
  }

  destroy() {
    this.viewer.dataSources.remove(this.source, true)
    this.root.remove()
  }
}

/** Tag size once it has laid out; undefined until the fonts and layout give it one. */
function measure(tag: HTMLElement): { w: number; h: number } | undefined {
  const w = tag.offsetWidth
  const h = tag.offsetHeight
  return w > 0 && h > 0 ? { w, h } : undefined
}

/** A constant-size landmark remains readable even when its longer tag is hidden by a HUD panel. */
function landmarkIcon(spec: MarkerSpec): string {
  const symbol = spec.symbol ?? 'helmet'
  return landmarkIconUrl(symbol, landmarkColor(symbol))
}
