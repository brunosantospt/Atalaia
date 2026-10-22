import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { simulateFast } from '../src/demoModel'
import { simulate as scoreForIls, decisionBarriers as optimizerBarriers } from '../src/fastModel'
import { demoLines } from '../src/demoLines'
import { fieldIds, ensureAssignmentIds } from '../src/unitIdentity'
import { supplyStatuses } from '../src/tankerSupport'
import { arrivals } from '../src/wetLine'
import { windAt } from '../src/windLayer'
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
assert.deepEqual(lines.map(w=>w.lengthM),[100,100,200])
for(const line of lines) assert.ok(Math.abs(distanceM({lon:line.barrier.path[0][0],lat:line.barrier.path[0][1]},{lon:line.barrier.path[1][0],lat:line.barrier.path[1][1]})-line.lengthM)<.01)
assert.ok(lines.every(w=>w.barrier.path.length===2&&!w.grown),'only fixed straight segments')
const run=simulateFast(scenario,d)
assert.deepEqual(scoreForIls(scenario,d).arrival,run.arrival,'optional optimizer scores the same fixed demo physics')
assert.deepEqual(optimizerBarriers(scenario,d),lines.map(w=>w.barrier),'optional optimizer uses the same 100/200 m coverage')
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
// A tanker shares its finite display supply among physical VFCI, only once both arrive.
const supplied: Decision = {id:'A',name:'Supply',points:{p,far:destination(p,0,400)},lines:{},assignments:[
  {unit:'vfci',count:2,from:'bv1',target:'p',task:'direct',dispatchMin:0},
  {unit:'vfci',count:1,from:'bv2',target:'p',task:'direct',dispatchMin:0},
  {unit:'vttu',count:1,from:'bv1',target:'p',task:'shuttle',dispatchMin:20},
  {unit:'vfci',count:1,from:'bv2',target:'far',task:'direct',dispatchMin:0},
]}
const etas=arrivals(scenario,supplied), joined=Math.max(...etas.slice(0,3))
const waiting=supplyStatuses(scenario,supplied,etas[2]-.1)
assert.equal(waiting[0].suppliedBy,0,'tank support must wait for arrival')
const support=supplyStatuses(scenario,supplied,joined)
assert.equal(support[0].capacity,35,'3000 L + one third of 12000 L, at 200 L/min')
assert.equal(support[1].capacity,35)
assert.equal(support[0].suppliedBy,1)
assert.equal(support[2].recipients,3,'count physical engines, not assignment rows')
assert.equal(support[3].capacity,15,'out-of-range engine keeps its own tank')
const later=supplyStatuses(scenario,supplied,joined+10)
assert.equal(later[2].waterPct,50,'three VFCI consume 6000 L in ten minutes')
assert.equal(later[0].remaining,10,'empty time before tanker arrival does not spend future supply')
assert.equal(later[1].remaining,10)
assert.deepEqual(supplyStatuses(scenario,supplied,joined),support,'rewinding recomputes deterministic gauges')
assert.equal(supplyStatuses(scenario,{...supplied,assignments:[supplied.assignments[2]]},100)[0].waterPct,100,'idle tanker retains water')
assert.equal(demoLines(scenario,{...supplied,assignments:[{...supplied.assignments[2],task:'direct'}]}).length,0,'even old direct-attack tankers never create combat lines')
const calm={...scenario.weather,windFromDeg:[350,10,10],windKmh:[10,20,20]}
assert.equal(windAt(calm,0,30).from,0,'wind wraps through north rather than reversing')
assert.equal(windAt(calm,0,30).kmh,15)
// Concentrated resources must add defended frontage, not duplicate parallel strips.
const defence: Decision = {id:'A',name:'Front',points:{p},lines:{},assignments:[{unit:'vfci',count:1,from:'bv1',target:'p',task:'direct',dispatchMin:0,wetLineBearingDeg:0}]}
const one = demoLines(scenario,defence)
const reinforced = {...defence,assignments:[{...defence.assignments[0],count:6}]}
const six = demoLines(scenario,reinforced)
const heldSix = new Set(six.flatMap(w=>stripCells(grid,w.barrier)))
assert.ok(one.flatMap(w=>stripCells(grid,w.barrier)).every(cell=>heldSix.has(cell)),'reinforcements preserve the already defended frontage')
const reinforcedSeparately = {...defence,assignments:[{...defence.assignments[0],count:2},{...defence.assignments[0],count:4,from:'bv2'}]}
const separate = demoLines(scenario,reinforcedSeparately)
assert.deepEqual(separate.map(w=>JSON.stringify(w.barrier.path)).sort(),six.map(w=>JSON.stringify(w.barrier.path)).sort(),'separate orders/origins at the same access point also share the front')
const xyP=toPTTM06(p)
const endpoints=six.flatMap(w=>w.barrier.path.map(([lon,lat])=>toPTTM06({lon,lat})))
assert.ok(Math.max(...endpoints.map(x=>x.y))-Math.min(...endpoints.map(x=>x.y))>1190,'six engines defend about 1200 m of connected front')
const wallScenario={...scenario,durationMin:360}
const freeWall=simulateFast(wallScenario,null), singleWall=simulateFast(wallScenario,defence), strongWall=simulateFast(wallScenario,reinforced)
const pastFront=(run: typeof freeWall) => Array.from(run.arrival).filter((t,i)=>Number.isFinite(t) && (grid.xmin+(i%grid.cols+.5)*grid.cellsize)>xyP.x+60).length
assert.ok(pastFront(freeWall)>0 && pastFront(singleWall)>0,'free fire and a short open flank can spread past the response')
assert.equal(pastFront(strongWall),0,'enough timely sections close the front and block the fire rather than letting it flow between units')
const late = {...reinforced,assignments:[{...reinforced.assignments[0],dispatchMin:350}]}
assert.ok(pastFront(simulateFast(wallScenario,late))>0,'late reinforcements cannot undo fire that has already passed')
const crewWall = {...reinforced,assignments:[{...reinforced.assignments[0],unit:'crew' as const,count:12}]}
assert.equal(pastFront(simulateFast(wallScenario,crewWall)),0,'cooperating foot teams can close the same front')
const turned = {...defence,assignments:[...defence.assignments,{...defence.assignments[0],wetLineBearingDeg:90}]}
const turnedLine=demoLines(scenario,turned)[1]
const mid={lon:(turnedLine.barrier.path[0][0]+turnedLine.barrier.path[1][0])/2,lat:(turnedLine.barrier.path[0][1]+turnedLine.barrier.path[1][1])/2}
assert.ok(distanceM(mid,p)<1,'deliberately rotated sections remain at their selected point')
console.log('COOPERATIVE FRONT:',{free:pastFront(freeWall),one:pastFront(singleWall),six:pastFront(strongWall)})
console.log('OK: physical-unit BV IDs/renumbering, 100/200 m fixed lines, water/endurance display only, journeys, real fast propagation and timed barriers')

// The demo ends at three hours even when the caller requests a longer horizon.
assert.equal(freeWall.durationMin,180)
assert.ok(Array.from(freeWall.arrival).every(t => t <= 180 || t === Infinity))
// Turn the wind from west to north at T+30: the existing scar must remain,
// while subsequent southward spread overtakes the unchanged-wind forecast.
const west = {...scenario.weather, windKmh:[15,15,15], windFromDeg:[270,270,270]}
const north = {...west, windFromDeg:[0,0,0]}
const steady = simulateFast({...scenario, weather:west, durationMin:180},null)
const shifted = simulateFast({...scenario, weather:north, forecastWeather:west, windShiftMin:30, durationMin:180},null)
for (let i=0;i<steady.arrival.length;i++) if (steady.arrival[i]<30 || shifted.arrival[i]<30)
  assert.ok(Math.abs(steady.arrival[i]-shifted.arrival[i])<.001,'wind incident preserves the earlier burn scar')
const south = (run: typeof steady) => Array.from(run.arrival).filter((t,i)=>t<=120 && Math.floor(i/n)>n/2+3).length
assert.ok(south(shifted)>south(steady),'new growth follows the changed wind toward the south')
console.log('WIND TURN:', {steadySouth:south(steady),shiftedSouth:south(shifted)})
