// Isolines of a field sampled on the grid (the minute the fire reaches each cell): the cells
// reached by a given minute, outlined. Marching squares over the cell centres, segments
// chained into rings, in WGS84 through the grid's rectangle (grid.ts).

import type { LonLat } from './geo'
import { lonLatAt, type Grid } from './grid'

// Corners of a square of four cell centres: TL 8, TR 4, BR 2, BL 1; edges 0 top, 1 right, 2 bottom, 3 left.
const CASES: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 3], [2, 1]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
]

/** Rings (open or closed) around the cells where `field <= level`, as lon/lat. */
export function contours(grid: Grid, field: Float32Array, level: number): LonLat[][] {
  const { cols, rows } = grid
  const far = level + 1e4 // stands in for Infinity, so the crossing sits almost on the inner cell
  const v = (c: number, r: number) => {
    const x = field[r * cols + c]
    return x <= level ? x : Number.isFinite(x) ? x : far
  }
  // A crossing on an edge between two cell centres, keyed so both squares sharing the edge agree.
  const points = new Map<number, [number, number]>()
  const key = (c: number, r: number, vertical: boolean) => (r * cols + c) * 2 + (vertical ? 1 : 0)
  const cross = (c: number, r: number, vertical: boolean): number => {
    const k = key(c, r, vertical)
    if (!points.has(k)) {
      const a = v(c, r)
      const b = vertical ? v(c, r + 1) : v(c + 1, r)
      const t = Math.min(Math.max((level - a) / (b - a), 0), 1)
      points.set(k, vertical ? [c + 0.5, r + 0.5 + t] : [c + 0.5 + t, r + 0.5])
    }
    return k
  }
  const segments: [number, number][] = []
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const code =
        (v(c, r) <= level ? 8 : 0) | (v(c + 1, r) <= level ? 4 : 0) | (v(c + 1, r + 1) <= level ? 2 : 0) | (v(c, r + 1) <= level ? 1 : 0)
      for (const [e1, e2] of CASES[code]) segments.push([edge(c, r, e1), edge(c, r, e2)])
    }
  function edge(c: number, r: number, e: number): number {
    return e === 0 ? cross(c, r, false) : e === 1 ? cross(c + 1, r, true) : e === 2 ? cross(c, r + 1, false) : cross(c, r, true)
  }

  // Chain the segments through their shared crossings.
  const at = new Map<number, number[]>()
  segments.forEach(([a, b], i) => {
    at.set(a, [...(at.get(a) ?? []), i])
    at.set(b, [...(at.get(b) ?? []), i])
  })
  const used = new Uint8Array(segments.length)
  const rings: LonLat[][] = []
  const walk = (from: number, start: number): number[] => {
    const path: number[] = []
    let k = from
    let seg = start
    for (;;) {
      const next = at.get(k)?.find((i) => i !== seg && !used[i])
      if (next === undefined) return path
      used[next] = 1
      const [a, b] = segments[next]
      k = a === k ? b : a
      path.push(k)
      seg = next
    }
  }
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const [a, b] = segments[i]
    const keys = [...walk(a, i).reverse(), a, b, ...walk(b, i)]
    if (keys.length < 4) continue
    rings.push(keys.map((k) => points.get(k)!).map(([c, r]) => lonLatAt(grid, c, r)))
  }
  return rings
}
