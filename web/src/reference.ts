// The reference run as the fallback when the API is down: the fire's progression.geojson is the same
// ELMFIRE run, hourly, so it is painted back onto the grid as arrival minutes. And the cut of the
// story's steps where a simulated run is cut (report.ts capRun).

import type { Fire, Progression, Ring } from './data'
import type { Grid } from './grid'

/** Arrival minute per cell from the steps' new areas: the minute of the step that added the cell. */
export function arrivalFromProgression(grid: Grid, fire: Fire, progression: Progression): Float32Array {
  const { cols, rows, rect } = grid
  const arrival = new Float32Array(cols * rows).fill(Infinity)
  const x = (lon: number) => ((lon - rect.west) / (rect.east - rect.west)) * cols
  const y = (lat: number) => ((rect.north - lat) / (rect.north - rect.south)) * rows
  fire.steps.forEach((step, k) => {
    const minute = step.hours * 60
    for (const rings of progression.increments[k] ?? []) fillPolygon(arrival, cols, rows, rings, x, y, minute)
  })
  return arrival
}

/** Even-odd scanline fill at the cell centres: holes (the rings after the first) stay empty. */
function fillPolygon(arrival: Float32Array, cols: number, rows: number, rings: Ring[], x: (lon: number) => number, y: (lat: number) => number, minute: number) {
  const edges: [number, number, number, number][] = []
  let top = Infinity
  let bottom = -Infinity
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const [lon0, lat0] = ring[i]
      const [lon1, lat1] = ring[(i + 1) % ring.length]
      const e: [number, number, number, number] = [x(lon0), y(lat0), x(lon1), y(lat1)]
      if (e[1] === e[3]) continue
      edges.push(e)
      top = Math.min(top, e[1], e[3])
      bottom = Math.max(bottom, e[1], e[3])
    }
  for (let row = Math.max(0, Math.ceil(top - 0.5)); row <= Math.min(rows - 1, Math.floor(bottom - 0.5)); row++) {
    const yc = row + 0.5
    const xs: number[] = []
    for (const [x0, y0, x1, y1] of edges) if (yc >= Math.min(y0, y1) && yc < Math.max(y0, y1)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0))
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5))
      const to = Math.min(cols - 1, Math.ceil(xs[k + 1] - 0.5) - 1)
      for (let col = from; col <= to; col++) if (minute < arrival[row * cols + col]) arrival[row * cols + col] = minute
    }
  }
}

/** The steps of a simulated fire up to the minute its run was cut, so the story and the observed layer stop there too. */
export function cutSteps(fire: Fire, progression: Progression, cutMin: number): { fire: Fire; progression: Progression } {
  if (!fire.simulated) return { fire, progression }
  const keep = Math.max(1, fire.steps.filter((s) => s.hours * 60 <= cutMin).length)
  if (keep >= fire.steps.length) return { fire, progression }
  const steps = fire.steps.slice(0, keep)
  const last = steps[keep - 1]
  return {
    fire: {
      ...fire,
      steps,
      bbox: last.bbox,
      areaHa: { timed: last.areaHa, untimed: 0, total: last.areaHa },
      ignitions: fire.ignitions.filter((ign) => ign.hours <= last.hours),
    },
    progression: { perimeters: progression.perimeters.slice(0, keep), increments: progression.increments.slice(0, keep), untimed: [] },
  }
}
