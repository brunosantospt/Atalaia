// Button-run demo approximation, restored from the former browser model. Fuel, slope and
// directional weather drive a shortest-arrival calculation. This is not an ELMFIRE substitute
// for operational forecasts. The worker keeps its computation off the map/UI thread.
import { computeFWISeries, fwiAt } from './fwi'
import { toPTTM06 } from './geo'
import { cellOf, cellOfXY, centerXY } from './grid'
import type { Scenario, Run } from './scenario'
import { isAerial, type Decision } from './suppression'
import { combatResources } from './combatResources'
import { placementAt } from './placementTimeline'
import { placements } from './placementTimeline'
const FUEL: Record<number, [number, number]> = {
  101: [1.5, 0.1],
  102: [2.5, 0.25],
  121: [1.8, 0.35],
  122: [2.2, 0.5],
  145: [2.4, 1.4],
  162: [1.0, 0.6],
  165: [1.0, 1.6],
  183: [0.3, 0.6],
  186: [0.6, 0.8],
  188: [0.7, 1.3],
  // Portuguese fuel models (Fernandes et al. 2009 / Paixão 2017)
  211: [1.8, 1.2], // F-EUC
  212: [1.2, 1.0], // F-FOL
  213: [1.5, 1.4], // F-PIN
  214: [1.4, 1.1], // F-RAC
  221: [1.6, 1.5], // M-CAD
  222: [2.0, 1.6], // M-ESC
  223: [2.2, 1.8], // M-EUC
  224: [1.3, 1.2], // M-EUCd
  225: [1.4, 1.2], // M-F
  226: [1.1, 0.8], // M-H
  227: [1.6, 1.6], // M-PIN
  231: [1.5, 0.8], // V-Ha
  232: [1.2, 0.5], // V-Hb
  233: [3.5, 2.4], // V-MAa (mato alto denso)
  234: [2.6, 1.6], // V-MAb (mato médio)
  235: [1.6, 1.2], // V-MH
  236: [2.2, 1.8], // V-MMa
  237: [1.8, 1.4], // V-MMb
}

const OFFSETS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]
const BEARING = OFFSETS.map(([dx,dy]) => (Math.atan2(dx,-dy)*180/Math.PI+360)%360)
const STEP = OFFSETS.map(([dx,dy]) => Math.hypot(dx,dy))
const K = OFFSETS.length
const fwiCache = new WeakMap<Scenario['weather'], ReturnType<typeof computeFWISeries>>()
export function simulateFast(scenario: Scenario, decision: Decision | null): Run {
  const t0 = performance.now()
  const { grid } = scenario
  const durationMin = Math.min(180, scenario.durationMin)
  const { cols, rows, cellsize, fuelCode, slope, aspect } = grid
  const n = cols * rows
  const minuteCount = Math.ceil(durationMin) + 1
  const wind = new Float32Array(minuteCount * K)
  let series = fwiCache.get(scenario.weather)
  if (!series) { series = computeFWISeries(scenario.weather); fwiCache.set(scenario.weather, series) }
  let forecastSeries = scenario.forecastWeather ? fwiCache.get(scenario.forecastWeather) : series
  if (!forecastSeries) {
    forecastSeries = computeFWISeries(scenario.forecastWeather!)
    fwiCache.set(scenario.forecastWeather!, forecastSeries)
  }
  for (let m = 0; m < minuteCount; m++) {
    const { kmh, fromDeg } = weatherAt(scenario, m)
    const beforeShift = m < (scenario.windShiftMin ?? -Infinity)
    const sample = scenario.windShiftMin !== undefined && !beforeShift ? Math.max(m, Math.ceil(scenario.windShiftMin/60)*60) : m
    const head = Math.max(.05, fwiAt(beforeShift ? forecastSeries : series, scenario.startIndex, sample).isi / 11.2 * 4.6)
    const lb = 1 + 8.729 * Math.pow(1 - Math.exp(-.03 * kmh), 2.155)
    const e = Math.sqrt(1 - 1 / (lb * lb))
    for (let k = 0; k < K; k++)
      wind[m*K+k] = head * (1-e) / (1-e*Math.cos((BEARING[k]-fromDeg-180)*Math.PI/180))
  }
  const cosUp = new Float32Array(360*K)
  for (let a = 0; a < 360; a++) for (let k = 0; k < K; k++) cosUp[a*K+k] = Math.cos((BEARING[k]-a-180)*Math.PI/180)
  const ros0 = new Float32Array(256)
  for (const [code, [r]] of Object.entries(FUEL)) ros0[+code] = r * 2.8
  const protectedCells = new Map<number, Uint8Array>()
  const resources = decision ? combatResources(scenario,decision) : undefined
  if (decision && resources) for (const [slot,a] of decision.assignments.entries()) {
    if (!['crew','vfci'].includes(a.unit)) continue
    for(let minute=0;minute<=durationMin;minute++) {
      const state=resources.frames[slot][minute]
      if(!state.active)continue
      const p=placementAt(resources.lists[slot],minute),xy=toPTTM06(p.point),rc=cellOfXY(grid,xy.x,xy.y),extent=Math.ceil(state.radius/cellsize)
      for(let r=Math.max(0,rc.row-extent);r<=Math.min(rows-1,rc.row+extent);r++) for(let c=Math.max(0,rc.col-extent);c<=Math.min(cols-1,rc.col+extent);c++) {
        const i=r*cols+c,at=centerXY(grid,i)
        if(Math.hypot(at.x-xy.x,at.y-xy.y)>state.radius)continue
        let mask=protectedCells.get(i)
        if(!mask){mask=new Uint8Array(minuteCount);protectedCells.set(i,mask)}
        mask[minute]=1
      }
    }
  }
  const held = (cell:number,minute:number) => !!protectedCells.get(cell)?.[Math.min(minuteCount-1,Math.floor(minute))]
  // Simplified aerial support: a supplied aircraft slows its assigned zone from its ETA.
  // It never reads the display water meter or modifies the ground coverage geometry.
  const airZones: { cells: Set<number>; from: number; until: number; slot:number; factor: number }[] = []
  if (decision) {
    decision.assignments.forEach((a, slot) => {
      const spec = scenario.suppression.units[a.unit]
      if (!isAerial(spec)) return
      const history=placements(scenario,decision,slot)
      for(const [index,placement] of history.entries()) {
      const points=[placement.point]
      const cells = new Set<number>(), radius = spec.radiusM * Math.sqrt(a.count)
      for (const point of points) {
        const xy = toPTTM06(point), rc = cellOfXY(grid, xy.x, xy.y), extent = Math.ceil(radius/cellsize)
        for (let r = Math.max(0,rc.row-extent); r <= Math.min(rows-1,rc.row+extent); r++)
          for (let c = Math.max(0,rc.col-extent); c <= Math.min(cols-1,rc.col+extent); c++) {
            const at = centerXY(grid,r*cols+c)
            if (Math.hypot(at.x-xy.x,at.y-xy.y) <= radius) cells.add(r*cols+c)
          }
      }
      airZones.push({ cells, from: placement.arrivalMin, until:history[index+1]?.orderedMin??Infinity, slot, factor: spec.rosFactor })
      }
    })
  }
  const arrival = new Float32Array(n).fill(Infinity)
  const start = cellOf(grid, scenario.ignition)
  if (start < 0) throw new Error('Ignição fora da grelha')
  const heap = new Heap()
  arrival[start] = 0; heap.push(0,start)
  while (heap.size) {
    const t = heap.topKey(), i = heap.pop()
    if (t > arrival[i]) continue
    const col = i % cols, row = (i-col)/cols
    for (let k = 0; k < K; k++) {
      const [dx,dy] = OFFSETS[k]
      const c = col+dx, r = row+dy
      if (c<0 || r<0 || c>=cols || r>=rows) continue
      const j = r*cols+c
      const base = ros0[fuelCode[j]]
      if (!base) continue
      const up = slope[j]*cosUp[(aspect[j]%360)*K+k]
      const slopeFactor = Math.min(4,Math.max(.4,Math.exp(Math.max(0,up)*Math.LN2/10)))
      // Integrate each crossing through changing wind, rather than freezing the
      // departure wind for an edge that may take many minutes to cross.
      let tj = t, remaining = STEP[k]*cellsize
      while (remaining > 1e-6 && tj < durationMin) {
        const minute = Math.floor(tj), end = Math.min(minute+1, durationMin)
        if (held(i,tj)||held(j,tj)||(dx&&dy&&(held(row*cols+c,tj)||held(r*cols+col,tj)))) { tj=end; continue }
        let factor = 1
        for (const zone of airZones) if (zone.from <= tj && tj < zone.until && resources?.frames[zone.slot][minute]?.active && zone.cells.has(j)) factor = Math.min(factor, zone.factor)
        const speed = base*wind[minute*K+k]*slopeFactor*Math.max(.05,factor)
        const dt = Math.min(end-tj, remaining/speed)
        remaining -= speed*dt
        tj += dt
      }
      if (remaining > 1e-6) continue
      if (tj > durationMin || tj >= arrival[j]) continue
      arrival[j] = tj; heap.push(arrival[j],j)
    }
  }
  return { decision, arrival, durationMin, runtimeMs: performance.now()-t0, engine: 'Modelo rápido · demo' }
}

function weatherAt({ weather: actual, forecastWeather, windShiftMin, startIndex }: Scenario, minute: number): { kmh: number; fromDeg: number; rh: number } {
  const weather = windShiftMin !== undefined && minute < windShiftMin ? forecastWeather ?? actual : actual
  const sample = windShiftMin !== undefined && minute >= windShiftMin ? Math.max(minute, Math.ceil(windShiftMin/60)*60) : minute
  const h = startIndex + sample / 60
  const i = Math.min(Math.floor(h), weather.time.length - 1)
  const j = Math.min(i + 1, weather.time.length - 1)
  const f = h - Math.floor(h)
  const turn = ((((weather.windFromDeg[j] - weather.windFromDeg[i]) % 360) + 540) % 360) - 180
  return {
    kmh: weather.windKmh[i] + (weather.windKmh[j] - weather.windKmh[i]) * f,
    fromDeg: weather.windFromDeg[i] + turn * f,
    rh: weather.rhPct[i] + (weather.rhPct[j] - weather.rhPct[i]) * f,
  }
}

class Heap {
  private keys: number[] = []
  private vals: number[] = []

  get size() {
    return this.keys.length
  }
  topKey() {
    return this.keys[0]
  }
  push(key: number, val: number) {
    const { keys, vals } = this
    let i = keys.length
    keys.push(key)
    vals.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = key
    vals[i] = val
  }
  pop(): number {
    const { keys, vals } = this
    const top = vals[0]
    const key = keys.pop()!
    const val = vals.pop()!
    const n = keys.length
    if (n === 0) return top
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && keys[c + 1] < keys[c]) c++
      if (keys[c] >= key) break
      keys[i] = keys[c]
      vals[i] = vals[c]
      i = c
    }
    keys[i] = key
    vals[i] = val
    return top
  }
}
