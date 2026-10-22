// The observed fire on the ground: the area each step added, the perimeter of the latest
// step, and at the end the area PT-FireSprd could not date. Built once per fire as two
// ground primitives; showing a step only changes per-instance colours.

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineColorAppearance,
  type Scene,
} from 'cesium'
import type { Progression, Ring } from './data'
import { cleanPath } from './geo'

export const FIRE_AMBER = Color.fromCssColorString('#f0a33a')
const FRONT = FIRE_AMBER.withAlpha(0.58) // what the latest step added
const SCAR = Color.fromCssColorString('#7a3f1c').withAlpha(0.62) // burned in earlier steps
const UNTIMED = Color.fromCssColorString('#8c7a6b').withAlpha(0.42) // burned, time unknown
const OUTLINE = FIRE_AMBER.withAlpha(0.95)

export interface FireState {
  step: number // last step shown, -1 for none
  fade: number // 0..1, how far the last step has appeared
  untimed: boolean
}

/** The ring open (no closing duplicate), without zero-length edges; empty when degenerate. */
function positions(ring: Ring): Cartesian3[] {
  return Cartesian3.fromDegreesArray(cleanPath(ring, (p) => p, true).flat())
}

export class FireLayer {
  private readonly areas: GroundPrimitive
  private readonly outlines: GroundPolylinePrimitive
  private readonly areaIds: string[] = []
  private readonly outlineIds: string[] = []
  private shown = ''

  constructor(
    private readonly scene: Scene,
    progression: Progression,
  ) {
    const areaInstances: GeometryInstance[] = []
    const add = (id: string, polygons: Ring[][]) => {
      polygons.forEach((rings, i) => {
        if (positions(rings[0]).length < 3) return
        const hierarchy = new PolygonHierarchy(
          positions(rings[0]),
          rings
            .slice(1)
            .map(positions)
            .filter((h) => h.length >= 3)
            .map((h) => new PolygonHierarchy(h)),
        )
        areaInstances.push(
          new GeometryInstance({
            id: `${id}/${i}`,
            geometry: new PolygonGeometry({ polygonHierarchy: hierarchy }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.TRANSPARENT) },
          }),
        )
        this.areaIds.push(`${id}/${i}`)
      })
    }
    progression.increments.forEach((polygons, step) => add(`inc:${step}`, polygons))
    add('untimed', progression.untimed)

    const outlineInstances: GeometryInstance[] = []
    progression.perimeters.forEach((polygons, step) =>
      polygons.forEach((rings, i) =>
        rings.forEach((ring, j) => {
          const pos = positions(ring)
          if (pos.length < 3) return
          const id = `per:${step}/${i}/${j}`
          outlineInstances.push(
            new GeometryInstance({
              id,
              geometry: new GroundPolylineGeometry({ positions: pos, loop: true, width: 2.5 }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.TRANSPARENT) },
            }),
          )
          this.outlineIds.push(id)
        }),
      ),
    )

    this.areas = scene.primitives.add(
      new GroundPrimitive({
        geometryInstances: areaInstances,
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      }),
    )
    this.outlines = scene.primitives.add(
      new GroundPolylinePrimitive({
        geometryInstances: outlineInstances,
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
      }),
    )
  }

  /** Called every frame; only touches the GPU attributes when the state changed. */
  set(state: FireState) {
    if (!this.areas.ready || !this.outlines.ready) return
    const key = `${state.step}|${state.fade.toFixed(3)}|${state.untimed}`
    if (key === this.shown) return
    this.shown = key

    for (const id of this.areaIds) {
      const [name] = id.split('/')
      let color = Color.TRANSPARENT
      if (name === 'untimed') color = state.untimed ? UNTIMED : Color.TRANSPARENT
      else {
        const step = Number(name.slice(4))
        // The newest step comes in as fire and only turns to scar as the next one arrives.
        if (step === state.step) color = Color.lerp(FRONT.withAlpha(0), FRONT, state.fade, new Color())
        else if (step === state.step - 1) color = Color.lerp(FRONT, SCAR, state.fade, new Color())
        else if (step < state.step) color = SCAR
      }
      this.paint(this.areas, id, color)
    }
    for (const id of this.outlineIds) {
      const step = Number(id.slice(4).split('/')[0])
      let alpha = 0
      if (step === state.step) alpha = state.fade
      else if (step === state.step - 1) alpha = 1 - state.fade // the previous front fades out
      this.paint(this.outlines, id, OUTLINE.withAlpha(OUTLINE.alpha * alpha))
    }
  }

  private paint(primitive: GroundPrimitive | GroundPolylinePrimitive, id: string, color: Color) {
    const attributes = primitive.getGeometryInstanceAttributes(id)
    if (attributes) attributes.color = ColorGeometryInstanceAttribute.toValue(color, attributes.color)
  }

  destroy() {
    this.scene.primitives.remove(this.areas)
    this.scene.primitives.remove(this.outlines)
  }
}
