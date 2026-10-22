// Lines on the terrain for the reach of the fire (reach.ts): the outline of the best case (the
// fire when the first means arrives after the drone's detection), and the dashed ghost of the
// fire when the satellite would detect it. Each group is shown when its id is revealed by the
// shots, like the markers.

import { Cartesian3, Color, CustomDataSource, type Entity, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import { cleanLonLat, type LonLat } from './geo'
import type { Reach } from './reach'

export const BEST_CSS = '#9be3b0' // calm green, apart from the amber fire and the grey HUD; markers.ts tags it too
const BEST = Color.fromCssColorString(BEST_CSS).withAlpha(0.95)
const TSAT = Color.fromCssColorString('#f0a33a').withAlpha(0.95)

export class ReachLayer {
  private readonly source = new CustomDataSource('reach')
  private readonly groups = new Map<string, Entity[]>()
  private shown = ''

  constructor(
    private readonly viewer: Viewer,
    _ignition: LonLat, // kept for main.ts: the scale rings around it are gone
    reach: Reach,
  ) {
    viewer.dataSources.add(this.source)
    this.groups.set(
      'best',
      reach.best.rings.flatMap((ring) => this.line(ring, BEST, 2)),
    )
    this.groups.set(
      'tsat',
      reach.tsat.rings.flatMap((ring) =>
        this.line(ring, new PolylineDashMaterialProperty({ color: TSAT, dashLength: 24, dashPattern: 0b1111000011110000 }), 2.5),
      ),
    )
  }

  update(revealed: Set<string>) {
    const key = [...this.groups.keys()].filter((id) => revealed.has(id)).join(',')
    if (key === this.shown) return
    this.shown = key
    for (const [id, entities] of this.groups) for (const e of entities) e.show = revealed.has(id)
  }

  destroy() {
    this.viewer.dataSources.remove(this.source, true)
  }

  private line(raw: LonLat[], material: Color | PolylineDashMaterialProperty, width: number): Entity[] {
    const points = cleanLonLat(raw)
    if (!points.length) return [] // a zero-length segment stops the renderer
    return [this.source.entities.add({
      show: false,
      polyline: {
        positions: Cartesian3.fromDegreesArray(points.flatMap((p) => [p.lon, p.lat])),
        clampToGround: true,
        width,
        material,
      },
    })]
  }
}
