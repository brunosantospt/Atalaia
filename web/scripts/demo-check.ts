// Validate shipped demo data and the actual story without starting an engine or browser.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MAPS } from '../src/basemap'
import { nearestStations, type Fire, type Station, type Weather } from '../src/data'
import { buildStory } from '../src/shots'
import { CUT } from '../src/director'
import { demoDecision } from '../src/decisions'
import { findAirBase } from '../src/airBases'
import { originColor } from '../src/unitIdentity'
const read = async (name: string) => JSON.parse(await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'))
const folder = 'fires/Penha_Guimaraes_hipotetico'
const fire: Fire = await read(`${folder}/fire.json`)
const weather: Weather = await read(`${folder}/weather.json`)
const forecast = await read(`${folder}/weather_noshift.json`)
assert.equal((weather as Weather & { source: { windMult: number } }).source.windMult, .8)
assert.equal(forecast.source.windMult, .8)
assert.equal(Math.max(...weather.windKmh), 24, 'synthetic wind peak is halved to 24 km/h')
assert.equal(fire.windShift!.kmh[1], 24, 'incident card uses the halved wind')
assert.ok(fire.steps.find((s) => s.hours === 1)!.areaHa < 15, 'opening reference is materially milder')
assert.ok(!MAPS.some((m) => (m.id as string) === 'heat'), 'heat map is absent from settings and the M-key cycle')
const { stations }: { stations: Station[] } = await read('stations.json')
const nearby = nearestStations(stations, fire.ignition)
const story = buildStory(fire, { perimeters: [], increments: [], untimed: [] }, nearby, Math.PI / 3)
for (const a of demoDecision(fire, nearby, true).assignments.filter((a) => a.unit === 'hebl' || a.unit === 'avbp')) {
  const base = findAirBase(a.from)
  assert.ok(base, 'example aircraft leave a real base, rather than a generic air origin')
  assert.ok(a.count <= (base.units[a.unit] ?? 0), 'example aircraft respect each base inventory')
  assert.equal(story.markers.find((m) => m.id === `airbase:${a.from}`)?.color, originColor(a.from, nearby), 'base marker shares its dispatched group colour')
}
assert.equal(story.markers.filter((m) => m.kind === 'station' && m.persistent).length, nearby.length)
assert.ok(story.markers.some((m) => m.kind === 'hospital' && m.persistent), 'hospital is available in the opening')
assert.ok(story.markers.some((m) => m.kind === 'airbase' && m.persistent), 'nearby air bases remain visible')
for (const shot of story.shots.filter((s) => CUT.includes(s.kind)))
  assert.ok(shot.caption.length <= 220, `${shot.kind} caption is concise: ${shot.caption.length} chars`)
console.log('OK: ELMFIRE demo has halved wind, milder opening, persistent operational landmarks, concise captions and no heat profile')
