import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { optimize, better, diffDecisions, type Ground } from '../src/optimize'
import { positionForReplan, routeIsSafe } from '../src/optimizeRelocations'
import { combatResources, resourceAt } from '../src/combatResources'
import { simulateFast } from '../src/demoModel'
import { destination, distanceM, toPTTM06 } from '../src/geo'
import { placements, relocationPosition } from '../src/placementTimeline'
import type { Grid } from '../src/grid'
import type { Scenario } from '../src/scenario'
import type { Decision, Suppression } from '../src/suppression'
const sup: Suppression = JSON.parse(await readFile(new URL('../public/suppression.json', import.meta.url), 'utf8'))
sup.dispatch.ecinTurnoutMin = 0
const origin = { lon: -8.26944444, lat: 41.42075 }
const p = destination(origin, 90, 150), xy = toPTTM06(origin), n = 61, half = n*15
const grid: Grid = { cols:n, rows:n, cellsize:30, xmin:xy.x-half, ymin:xy.y-half,srs:'EPSG:3763',
  rect:{west:destination(origin,270,half).lon,east:destination(origin,90,half).lon,south:destination(origin,180,half).lat,north:destination(origin,0,half).lat},
  wgs84:{sw:[0,0],se:[0,0],ne:[0,0],nw:[0,0]},classes:['grass'], fuelClass:new Uint8Array(n*n),fuelCode:new Uint16Array(n*n).fill(102),slope:new Uint8Array(n*n),aspect:new Uint16Array(n*n) }
const stations = [{ ...p,id:'bv1',name:'BV 1',short:'BV 1',kind:'volunteer' as const,place:null,section:null },{...p,id:'bv2',name:'BV 2',short:'BV 2',kind:'volunteer' as const,place:null,section:null}]
const scenario: Scenario = { demo:true,grid,ignition:origin,stations,suppression:sup,startIndex:0,durationMin:180, dispatchMin:0,
  weather:{timeZone:'Europe/Lisbon',time:['2024-09-16T10:00','2024-09-16T11:00','2024-09-16T12:00'],tempC:[25,25,25],rhPct:[40,40,40],precipMm:[0,0,0],windKmh:[5,5,5],windFromDeg:[270,270,270],gustKmh:[5,5,5]} }

scenario.forecastWeather=structuredClone(scenario.weather)
scenario.forecastWeather.windKmh=[8,8,8]
scenario.forecastWeather.windFromDeg=[270,270,270]
scenario.weather=structuredClone(scenario.forecastWeather)
scenario.weather.windKmh=[8,20,20]
scenario.weather.windFromDeg=[270,0,0]
scenario.windShiftMin=45
scenario.fireArrival=simulateFast(scenario,null).arrival
const a:Decision={id:'A',name:'A',points:{p:destination(origin,270,400)},lines:{},assignments:[
 {id:'unit-1',unit:'crew',count:1,from:'bv1',target:'p',task:'direct',orderedMin:0,dispatchMin:0,arrivalMin:1,
 placements:[{point:destination(origin,270,300),orderedMin:10,arrivalMin:12}]}
]}
const ground:Ground={access:[],places:[],placeCells:[]}
const snapshot=JSON.stringify(a)
const result=optimize(scenario,ground,a,{replanMin:45,maxPlans:35,budgetMs:30000,seed:1})
console.log('REPLAN',result.a,result.best,result.plans,result.decision.assignments[0].placements)
assert.ok(result.improved,'late relocation must improve this deliberately misplaced response')
assert.equal(JSON.stringify(a),snapshot,'optimizer does not mutate A')
assert.equal(result.decision.assignments.length,a.assignments.length)
assert.deepEqual(result.decision.points,a.points)
const b=result.decision,history=b.assignments[0].placements!
assert.deepEqual(history.slice(0,-1),a.assignments[0].placements)
assert.equal(history.at(-1)!.orderedMin,45)
assert.ok(history.at(-1)!.arrivalMin>45)
assert.ok(distanceM(history.at(-1)!.path![0],a.assignments[0].placements![0].point)<1)
const ar=simulateFast(scenario,a),br=simulateFast(scenario,b)
for(let i=0;i<ar.arrival.length;i++) if(ar.arrival[i]<45||br.arrival[i]<45)
 assert.equal(ar.arrival[i],br.arrival[i],'already burned cells cannot be rewritten')
const ra=combatResources(scenario,a),rb=combatResources(scenario,b)
assert.deepEqual(ra.frames[0].slice(0,45),rb.frames[0].slice(0,45),'past resources are identical')
assert.ok(!better(result.a,result.best),'B never scores worse')
assert.equal(diffDecisions(a,b)[0].kind,'moved')
assert.equal(diffDecisions(a,b)[0].orderedMin,45)
const repeat=optimize(scenario,ground,a,{replanMin:45,maxPlans:35,budgetMs:30000,seed:1})
assert.deepEqual(repeat.decision,b,'fixed plan budget is deterministic')
// Redirect a unit in transit from the position shown on the map, not its last destination.
const travelling=structuredClone(a)
travelling.assignments[0].placements![0].arrivalMin=60
const position=positionForReplan(scenario,ground,travelling,0,45,ar.arrival)!
assert.ok(distanceM(position,travelling.assignments[0].placements![0].point)>10)
assert.deepEqual(position,relocationPosition(placements(scenario,travelling,0),45))
const future=structuredClone(a);future.assignments[0].orderedMin=70;future.assignments[0].dispatchMin=70;delete future.assignments[0].placements
const untouched=optimize(scenario,ground,future,{replanMin:45,maxPlans:10,budgetMs:30000})
assert.deepEqual(untouched.decision.assignments,future.assignments,'not-yet-ordered units are not available')
// A blocked route is rejected using passage time, even when it is safe at departure.
assert.equal(routeIsSafe(scenario,[origin,destination(origin,90,100)],0,4,new Float32Array(grid.cols*grid.rows).fill(1)),false)
console.log('OK: changed-wind improvement, immutable past, physical identity, continuous resources, transit origins and future orders')

// Resource use before a new order is replayed, never replenished by moving.
const spent=structuredClone(a)
spent.points.p=destination(origin,90,80)
spent.assignments[0].placements=[]
const oldResources=combatResources(scenario,spent)
const correction=structuredClone(spent)
correction.assignments[0].placements=[{point:destination(origin,180,300),orderedMin:60,arrivalMin:65,path:[spent.points.p,destination(origin,180,300)]}]
const continued=combatResources(scenario,correction)
assert.ok(resourceAt(oldResources,0,59).waterPct<100,'fixture has spent actual water before the relocation')
assert.deepEqual(continued.frames[0].slice(0,60),oldResources.frames[0].slice(0,60))
assert.ok(resourceAt(continued,0,65).waterPct<=resourceAt(oldResources,0,59).waterPct,'relocating cannot refill the tank')
console.log('OK: used water and autonomy carry into the next placement')
// Vehicles use a real polyline route rather than the distance back to their station.
const vehicle=structuredClone(a)
vehicle.assignments[0].unit='vfci'
const goal=history.at(-1)!.point,start=vehicle.assignments[0].placements![0].point
const detour=[start,destination(origin,270,700),destination(destination(origin,270,700),180,650),goal]
const roads:Ground={access:[goal],places:[],placeCells:[],roads:[{id:1,cls:'paved',hw:'residential',pts:detour.map(p=>[p.lon,p.lat])}]}
const driving=optimize(scenario,roads,vehicle,{replanMin:45,maxPlans:5,budgetMs:30000})
assert.ok(driving.improved,'road vehicle relocation improves the fixture')
const route=driving.decision.assignments[0].placements!.at(-1)!
assert.ok(route.path!.length>=4,'saved order retains the road detour')
assert.ok(distanceM(route.path![0],start)<1)
const length=route.path!.slice(1).reduce((n,p,i)=>n+distanceM(route.path![i],p),0)
assert.ok(Math.abs(route.arrivalMin-(45+length/1000/sup.units.vfci.speedKmh*60))<1e-8)
const blockedRoads={...roads,roads:[]}
const blocked=optimize(scenario,blockedRoads,vehicle,{replanMin:45,maxPlans:5,budgetMs:30000})
assert.deepEqual(blocked.decision.assignments,vehicle.assignments,'vehicle never falls back to an off-road straight line')
const futureOrder=structuredClone(vehicle)
futureOrder.assignments[0].placements!.push({point:destination(origin,0,600),orderedMin:120,arrivalMin:125})
const revised=optimize(scenario,roads,futureOrder,{replanMin:45,maxPlans:5,budgetMs:30000})
assert.ok(revised.improved)
assert.deepEqual(revised.decision.assignments[0].placements!.slice(0,-1),vehicle.assignments[0].placements,'only unissued future orders are replaced')
console.log('OK: road route, physical travel ETA, no off-road fallback, future-order replacement')

const planIds=structuredClone(b)
planIds.assignments[0].id='B-01'
assert.equal(diffDecisions(a,planIds)[0].kind,'moved','plan-specific display IDs do not hide relocation changes')
