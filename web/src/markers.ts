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
import { destination } from './geo'
import type { MarkerKind, MarkerSpec } from './shots'

const RING_COLOR: Record<MarkerKind, Color> = {
  ignition: Color.fromCssColorString('#f0a33a'),
  step: Color.fromCssColorString('#f0a33a').withAlpha(0.8),
  station: Color.fromCssColorString('#d9dcdf').withAlpha(0.85),
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
}
const SVG = 'http://www.w3.org/2000/svg'

interface Marker {
  spec: MarkerSpec
  world: Cartesian3
  ring: Entity
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
      const ring = this.source.entities.add({
        show: false,
        polyline: {
          positions: Cartesian3.fromDegreesArray(circle.flatMap((p) => [p.lon, p.lat])),
          clampToGround: true,
          width: spec.kind === 'station' ? 1.5 : 2,
          material: RING_COLOR[spec.kind],
        },
      })
      const tag = document.createElement('div')
      tag.className = `tag tag-${spec.kind}`
      tag.innerHTML = `<b></b><span></span><small></small>`
      tag.querySelector('b')!.textContent = spec.badge
      tag.querySelector('span')!.textContent = spec.label
      tag.querySelector('small')!.textContent = spec.detail
      const line = document.createElementNS(SVG, 'line')
      const dot = document.createElementNS(SVG, 'circle')
      line.setAttribute('class', `lead lead-${spec.kind}`)
      dot.setAttribute('class', `lead lead-${spec.kind}`)
      dot.setAttribute('r', '3')
      this.svg.append(line, dot)
      this.root.append(tag)
      this.markers.push({
        spec,
        world: Cartesian3.fromDegrees(spec.lon, spec.lat, spec.h + 2),
        ring,
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
      const on = revealed.has(m.spec.id)
      m.ring.show = on
      let visible = false
      if (on && occluder.isPointVisible(m.world)) {
        const p = SceneTransforms.worldToWindowCoordinates(scene, m.world, this.window)
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
