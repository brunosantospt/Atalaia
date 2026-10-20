// Lines on the terrain for the reach of the fire (reach.ts): scale rings around the ignition,
// the outline of the fire at each means' ETA, and the dashed ghost of the fire at T_sat.
// Each group is shown when its id is revealed by the shots, like the markers.

import { Cartesian3, Color, CustomDataSource, type Entity, PolylineDashMaterialProperty, type Viewer } from 'cesium'
import { destination, type LonLat } from './geo'
import type { Reach } from './reach'

export const SCALE_RINGS_M = [1000, 2000, 5000]
const SCALE = Color.fromCssColorString('#d9dcdf').withAlpha(0.35)
const ETA = Color.fromCssColorString('#d9dcdf').withAlpha(0.9) // light over the amber fire
const TSAT = Color.fromCssColorString('#f0a33a').withAlpha(0.95)

export class ReachLayer {
  private readonly source = new CustomDataSource('reach')
  private readonly groups = new Map<string, Entity[]>()
  private shown = ''

  constructor(
    private readonly viewer: Viewer,
    ignition: LonLat,
    reach: Reach,
  ) {
    viewer.dataSources.add(this.source)
    this.groups.set(
      'scale',
      SCALE_RINGS_M.map((m) => this.line(Array.from({ length: 73 }, (_, i) => destination(ignition, i * 5, m)), SCALE, 1)),
    )
    for (const eta of reach.etas)
      this.groups.set(
        eta.id,
        eta.rings.map((ring) => this.line(ring, ETA, 1.5)),
      )
    this.groups.set(
      'tsat',
      reach.tsat.rings.map((ring) =>
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

  private line(points: LonLat[], material: Color | PolylineDashMaterialProperty, width: number): Entity {
    return this.source.entities.add({
      show: false,
      polyline: {
        positions: Cartesian3.fromDegreesArray(points.flatMap((p) => [p.lon, p.lat])),
        clampToGround: true,
        width,
        material,
      },
    })
  }
}
