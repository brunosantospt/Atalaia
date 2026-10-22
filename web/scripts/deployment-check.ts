import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { NearStation } from '../src/data'
import type { Scenario } from '../src/fastModel'
import { destination, distanceM, toPTTM06 } from '../src/geo'
import { lonLatAt, type Grid } from '../src/grid'
import { approachIntercept, beyondRing, blockedByRing, computeRings, radiiOf } from '../src/stationRings'
import { arrivalMin, type Decision, type Suppression } from '../src/suppression'
import { arrivals, wetLines } from '../src/wetLine'

const sup: Suppression = JSON.parse(await readFile(new URL('../public/suppression.json', import.meta.url), 'utf8'))
sup.dispatch.roadFactor = 1
sup.dispatch.ecinTurnoutMin = 2
sup.dispatch.volunteerTurnoutMin = 20
sup.units.vfci.speedKmh = 60
sup.units.vfci.followsEdge = false
const ignition = { lon: -8.2715, lat: 41.428556 }
const xy = toPTTM06(ignition)
const n = 400
const half = n * 30 / 2
const west = destination(ignition, 270, half).lon
const east = destination(ignition, 90, half).lon
const south = destination(ignition, 180, half).lat
const north = destination(ignition, 0, half).lat
const grid: Grid = {
  cols: n, rows: n, cellsize: 30, xmin: xy.x - half, ymin: xy.y - half, srs: 'EPSG:3763',
  wgs84: { sw: [west, south], se: [east, south], ne: [east, north], nw: [west, north] },
  rect: { west, east, south, north }, classes: ['grass'],
  fuelClass: new Uint8Array(n * n), fuelCode: new Uint16Array(n * n).fill(102),
  slope: new Uint8Array(n * n), aspect: new Uint16Array(n * n),
}
const station: NearStation = {
  ...destination(ignition, 90, 3000), id: 'test', name: 'Test quartel', short: 'BV Test',
  kind: 'volunteer', place: null, section: null, km: 3,
}
// A circular fire spreading 100 m/min and a vehicle approaching at 1000 m/min.
const fire = Float32Array.from({ length: n * n }, (_, i) => distanceM(ignition, lonLatAt(grid, i % n + .5, Math.floor(i / n) + .5)) / 100)
const detection = { droneMin: 10, satelliteMin: 30, notes: '', sources: {} }
const [ring] = computeRings(grid, fire, ignition, [station], sup, detection)
// r / 100 = 10 + 2 + (3000 - r) / 1000 => r = 1363.636 m.
assert.ok(Math.abs(ring.radiusM - 1363.636) < 45, `interception radius ${ring.radiusM}`)
assert.ok(ring.arriveMin < 15, 'meet before reaching the ignition at T+15')
const radii = radiiOf([ring])
const outer = destination(ignition, 90, 2000)
const inner = destination(ignition, 90, 500)
assert.equal(beyondRing(radii, ignition, station.id, outer), true, 'outer placements allowed')
assert.equal(beyondRing(radii, ignition, station.id, destination(ignition, 90, 5000)), true, 'no maximum deployment radius')
assert.equal(beyondRing(radii, ignition, station.id, inner), false, 'inner placements refused')
assert.equal(approachIntercept(grid, fire, station, outer, sup, sup.units.vfci, 10), undefined)
assert.ok(approachIntercept(grid, fire, station, destination(ignition, 270, 4000), sup, sup.units.vfci, 10), 'route to an outer point across the fire is intercepted')
assert.ok(computeRings(grid, fire, ignition, [station], sup, detection, 20)[0].radiusM > ring.radiusM, 'later dispatch changes interception')
assert.equal(computeRings(grid, new Float32Array(n * n).fill(Infinity), ignition, [station], sup, detection)[0].radiusM, 0, 'no fire crossing imposes no boundary')
const scenario: Scenario = {
  grid, ignition, stations: [station], suppression: sup, dispatchMin: 10, durationMin: 360, startIndex: 0,
  weather: { timeZone: 'Europe/Lisbon', time: ['2024-09-16T10:00'], tempC: [30], rhPct: [20], precipMm: [0], windKmh: [0], windFromDeg: [0], gustKmh: [0] },
}
const d: Decision = {
  id: 'A', name: 'ETA regression', points: { outer, inner }, lines: {}, assignments: [
    { unit: 'vfci', count: 1, from: station.id, target: 'outer', task: 'direct', dispatchMin: 50 },
    { unit: 'vfci', count: 1, from: station.id, target: 'inner', task: 'direct', dispatchMin: 70 },
  ],
}
assert.equal(blockedByRing(radii, ignition, sup, d, 'vfci', station.id, 'outer'), false)
assert.equal(blockedByRing(radii, ignition, sup, d, 'vfci', station.id, 'inner'), true)
assert.equal(blockedByRing(radii, ignition, sup, d, 'hebl', station.id, 'inner'), false, 'aircraft exempt')
const eta = arrivals(scenario, d)
assert.ok(Math.abs(eta[0] - 53) < .01, 'dispatch T+50 + 2 turnout + 1 travel')
assert.ok(Math.abs(eta[1] - 92.5) < .01, 'second assignment uses volunteer turnout and its own destination')
const legacy = { ...d, assignments: [{ ...d.assignments[0], dispatchMin: undefined }] }
assert.ok(Math.abs(arrivals(scenario, legacy)[0] - 13) < .01, 'legacy examples start at detection')
const first = { ...d, assignments: [d.assignments[0]] }
assert.equal(wetLines(scenario, first, fire)[0].barrier.from_min, Math.ceil(arrivals(scenario, first)[0] - 1e-6), 'ELMFIRE barrier and displayed ETA share absolute time')
const line = { ...first, points: {}, lines: { outer: [outer, inner] } }
assert.equal(arrivals(scenario, line)[0], eta[0], 'line ETA goes to first vertex')
const aircraft = { ...first, assignments: [{ ...first.assignments[0], unit: 'hebl' as const, from: 'cma-fafe' }] }
assert.ok(arrivals(scenario, aircraft)[0] > 50 + (sup.units.hebl.turnoutMin ?? 0), 'aircraft ETA also includes placement time and flight')
assert.ok(arrivalMin(sup, sup.units.vfci, 1, true) < eta[0], 'ETA is an absolute fire minute, not just trip duration')
console.log('OK: interception geometry, outer/inner placement, approach crossing, dispatch times, ground/air/line ETAs and barrier activation')
