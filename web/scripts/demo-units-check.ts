import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { simulateFast } from '../src/demoModel'
import { simulate as scoreForIls, decisionBarriers as optimizerBarriers } from '../src/fastModel'
import { demoLines } from '../src/demoLines'
import { fieldIds, ensureAssignmentIds } from '../src/unitIdentity'
import { unitStatus } from '../src/unitStatus'
import { unitJourney } from '../src/unitMotion'
import { destination, distanceM, toPTTM06 } from '../src/geo'
import { stripCells } from '../src/wetLine'
import type { Grid } from '../src/grid'
import type { Scenario } from '../src/scenario'
import type { Decision, Suppression } from '../src/suppression'
const sup: Suppression = JSON.parse(await readFile(new URL('../public/suppression.json', import.meta.url), 'utf8'))
sup.dispatch.ecinTurnoutMin = 0
const origin = { lon: -8.26944444, lat: 41.42075 }
const p = destination(origin, 90, 150), xy = toPTTM06(origin), n = 31, half = n*15
const grid: Grid = { cols:n, rows:n, cellsize:30, xmin:xy.x-half, ymin:xy.y-half,srs:'EPSG:3763',
  rect:{west:destination(origin,270,half).lon,east:destination(origin,90,half).lon,south:destination(origin,180,half).lat,north:destination(origin,0,half).lat},
  wgs84:{sw:[0,0],se:[0,0],ne:[0,0],nw:[0,0]},classes:['grass'], fuelClass:new Uint8Array(n*n),fuelCode:new Uint16Array(n*n).fill(102),slope:new Uint8Array(n*n),aspect:new Uint16Array(n*n) }
const stations = [{ ...p,id:'bv1',name:'BV 1',short:'BV 1',kind:'volunteer' as const,place:null,section:null },{...p,id:'bv2',name:'BV 2',short:'BV 2',kind:'volunteer' as const,place:null,section:null}]
const scenario: Scenario = { demo:true,grid,ignition:origin,stations,suppression:sup,startIndex:0,durationMin:120, dispatchMin:0,
  weather:{timeZone:'Europe/Lisbon',time:['2024-09-16T10:00','2024-09-16T11:00','2024-09-16T12:00'],tempC:[25,25,25],rhPct:[40,40,40],precipMm:[0,0,0],windKmh:[5,5,5],windFromDeg:[270,270,270],gustKmh:[5,5,5]} }
const d: Decision = {id:'A',name:'Test',points:{p},lines:{},assignments:[
  {unit:'vfci',count:2,from:'bv1',target:'p',task:'direct',dispatchMin:0,wetLineBearingDeg:0},
  {unit:'crew',count:1,from:'bv1',target:'p',task:'direct',dispatchMin:0},
  {unit:'vfci',count:1,from:'bv2',target:'p',task:'direct',dispatchMin:0},
]}
ensureAssignmentIds(d)
assert.deepEqual(fieldIds(d,stations),[['A1','A2'],['A3'],['B1']])
d.assignments.splice(0,1)
assert.deepEqual(fieldIds(d,stations),[['A1'],['B1']], 'removing two vehicles compacts the current BV count without changing other origins')
d.assignments[0].count=2
assert.deepEqual(fieldIds(d,stations),[['A1','A2'],['B1']])
const before=JSON.stringify(d)
const free=simulateFast(scenario,null)
scenario.fireArrival=free.arrival
const lines=demoLines(scenario,d)
assert.deepEqual(lines.map(w=>w.lengthM),[50,50,100])
for(const line of lines) assert.ok(Math.abs(distanceM({lon:line.barrier.path[0][0],lat:line.barrier.path[0][1]},{lon:line.barrier.path[1][0],lat:line.barrier.path[1][1]})-line.lengthM)<.01)
assert.ok(lines.every(w=>w.barrier.path.length===2&&!w.grown),'only fixed straight segments')
const run=simulateFast(scenario,d)
assert.deepEqual(scoreForIls(scenario,d).arrival,run.arrival,'optional optimizer scores the same fixed demo physics')
assert.deepEqual(optimizerBarriers(scenario,d),lines.map(w=>w.barrier),'optional optimizer uses the same 50/100 m coverage')
for(const line of lines) for(const cell of stripCells(grid,line.barrier))
  assert.ok(run.arrival[cell]<line.barrier.from_min||run.arrival[cell]===Infinity,'an active strip is not burnable')
const changed = structuredClone(scenario)
changed.suppression.units.vfci.waterL=1
changed.suppression.units.vfci.flowLPerMin=1e6
assert.deepEqual(simulateFast(changed,d).arrival,run.arrival,'UI water values cannot change propagation')
assert.equal(JSON.stringify(d),before,'simulation does not mutate the manual plan')
const arrival=20
assert.equal(unitStatus(sup.units.vfci,'vfci',arrival,19).elapsed,0)
assert.equal(unitStatus(sup.units.vfci,'vfci',arrival,19).waterPct,100)
assert.equal(unitStatus(sup.units.vfci,'vfci',arrival,27.5).waterPct,50)
assert.equal(unitStatus(sup.units.vfci,'vfci',arrival,35).remaining,0)
assert.equal(unitStatus(sup.units.crew,'crew',arrival,50).waterPct,50)
const end=destination(origin,90,1000), journey=unitJourney([origin,end],12,22)
assert.deepEqual(journey(10),origin)
assert.deepEqual(journey(22),end)
assert.ok(Math.abs(distanceM(origin,journey(17))-500)<1)
assert.ok(Array.from(free.arrival).filter(Number.isFinite).length>10,'fast model propagates across connected burnable cells')
console.log('OK: physical-unit BV IDs/renumbering, 50/100 m fixed lines, water/endurance display only, journeys, real fast propagation and timed barriers')
