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

export const FIRE_AMBER = Color.fromCssColorString('#d97706')
const FRONT = FIRE_AMBER.withAlpha(0.90) // what the latest step added: warm glowing flame
const SCAR = Color.fromCssColorString('#2a2826').withAlpha(0.75) // burned in earlier steps: subtle mineral ash gray
const UNTIMED = Color.fromCssColorString('#383533').withAlpha(0.65) // burned, time unknown: soft ash soot
const OUTLINE = Color.fromCssColorString('#ea580c').withAlpha(0.85)

export interface FireState {
  step: number // last step shown, -1 for none
  fade: number // 0..1, how far the last step has appeared
  untimed: boolean
}

function positions(ring: Ring): Cartesian3[] {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  return Cartesian3.fromDegreesArray(open.flat())
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
        const hierarchy = new PolygonHierarchy(
          positions(rings[0]),
          rings.slice(1).map((hole) => new PolygonHierarchy(positions(hole))),
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
          const id = `per:${step}/${i}/${j}`
          outlineInstances.push(
            new GeometryInstance({
              id,
              geometry: new GroundPolylineGeometry({ positions: positions(ring), loop: true, width: 2.5 }),
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
