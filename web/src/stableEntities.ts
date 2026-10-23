// The editor clears and redraws its entities on every clock minute. Ground-clamped lines and rings take
// a few frames to rebuild, so a plain redraw flashes during playback. This keeps every entity whose
// description is unchanged since the last redraw and only replaces those that really changed.
import { CallbackPositionProperty, CallbackProperty, JulianDate, type Entity, type EntityCollection } from 'cesium'

const ids = new WeakMap<object, number>()
let next = 0
const NOW = JulianDate.now()

/** A string describing the spec, or undefined when it holds anything time-varying (never reused). */
function keyOf(spec: unknown): string | undefined {
  let dynamic = false
  const json = JSON.stringify(spec, (_k, v) => {
    if (dynamic || v === null || typeof v !== 'object' || Array.isArray(v)) return v
    if (v instanceof CallbackProperty || v instanceof CallbackPositionProperty || v.isConstant === false) { dynamic = true; return 0 }
    const proto = Object.getPrototypeOf(v)
    if (proto === Object.prototype) return v
    if (typeof v.getType === 'function' && typeof v.getValue === 'function') // a material
      return { m: v.getType(NOW), v: v.getValue(NOW, {}) }
    const own = Object.values(v)
    if (own.every((x) => typeof x === 'number')) return { c: proto?.constructor?.name, ...v } // Cartesian, Color…
    if (!ids.has(v)) ids.set(v, ++next)
    return { id: ids.get(v) }
  })
  return dynamic ? undefined : json
}

export function stabilize(collection: EntityCollection) {
  const add = collection.add.bind(collection)
  const remove = collection.remove.bind(collection)
  const removeAll = collection.removeAll.bind(collection)
  let kept = new Map<string, Entity[]>() // reusable from the previous redraw
  let drawn = new Map<string, Entity[]>() // added since the last clear
  let loose: Entity[] = [] // uncacheable ones of the previous redraw
  let sweep = false

  collection.removeAll = () => {
    for (const [k, list] of drawn) kept.set(k, [...(kept.get(k) ?? []), ...list])
    drawn = new Map()
    loose.forEach((e) => remove(e))
    loose = []
    if (!sweep) {
      sweep = true
      queueMicrotask(() => { // after the redraw: drop what was not drawn again
        sweep = false
        for (const list of kept.values()) list.forEach((e) => remove(e))
        kept = new Map()
      })
    }
  }
  collection.add = (spec: any) => {
    const key = spec && typeof spec === 'object' && !spec.id ? keyOf(spec) : undefined
    if (key === undefined) {
      const e = add(spec)
      loose.push(e)
      return e
    }
    const reuse = kept.get(key)?.pop()
    const e = reuse ?? add(spec)
    drawn.set(key, [...(drawn.get(key) ?? []), e])
    return e
  }
  // A real clear (switching fire, etc.) when nothing will be drawn again.
  return () => { removeAll(); kept = new Map(); drawn = new Map(); loose = [] }
}
