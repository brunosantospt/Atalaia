// Demo replanning: score complete histories, changing only orders issued from "now" onward.
// Keeping past placements in every candidate preserves both burned cells and resource use.
import { findAirBase } from './airBases'
import { combatResources, resourceAt } from './combatResources'
import { DEMO_HORIZON_MIN, simulateFast } from './demoModel'
import { SAFETY_MIN } from './deployment'
import { distanceM, lerpLonLat, type LonLat } from './geo'
import { cellHa, cellOf, lonLatAt } from './grid'
import { better, ILS_NAME, type Ground, type Options, type Result, type Score } from './optimize'
import { placements, relocationPosition, type Placement } from './placementTimeline'
import { findSafeRoute } from './routing'
import type { Run, Scenario } from './scenario'
import { isAerial, isRoadVehicle, type Decision } from './suppression'
import { departures, unitJourney } from './unitMotion'

/** Match the map's initial journey; subsequent orders carry their exact route. */
export function positionForReplan(s:Scenario,ground:Ground,d:Decision,slot:number,minute:number,arrival:Float32Array):LonLat|undefined {
  const history=placements(s,d,slot),a=d.assignments[slot],first=history[0]
  if(!first||first.orderedMin>minute)return undefined
  const moved=relocationPosition(history,minute)
  if(moved)return moved
  const spec=s.suppression.units[a.unit]
  const base=isAerial(spec)?findAirBase(a.from):s.stations.find(p=>p.id===a.from)
  if(!base)return minute>=first.arrivalMin?first.point:undefined
  const departure=departures(s.suppression,d,s.dispatchMin)[slot]
  if(minute<departure)return undefined
  const route=isRoadVehicle(spec)&&ground.roads?.length
    ?findSafeRoute(s.grid,ground.roads,arrival,a.dispatchMin??s.dispatchMin??0,base,first.point)?.path:undefined
  return unitJourney(route??[base,first.point],departure,first.arrivalMin)(minute)
}

/** Sample the whole journey against the predicted fire at the time the unit passes. */
export function routeIsSafe(s:Scenario,path:LonLat[],minute:number,speed:number,arrival:Float32Array):boolean {
  let elapsed=0
  for(let i=1;i<path.length;i++) {
    const length=distanceM(path[i-1],path[i]),steps=Math.max(1,Math.ceil(length/(s.grid.cellsize/2)))
    for(let k=0;k<=steps;k++) {
      const cell=cellOf(s.grid,lerpLonLat(path[i-1],path[i],k/steps))
      const at=minute+(elapsed+length*k/steps)/1000/speed*60
      if(cell<0||arrival[cell]<=at)return false
    }
    elapsed+=length
  }
  return true
}

export function optimizeRelocations(input:Scenario,ground:Ground,a:Decision,options:Options):Result {
  const started=performance.now(),minute=Math.max(0,options.replanMin??0)
  const durationMin=Math.min(DEMO_HORIZON_MIN,input.durationMin)
  // Recompute the free forecast exactly as Simular does, including the selected wind phase.
  const free=simulateFast({...input,durationMin},null)
  const s={...input,durationMin,fireArrival:free.arrival}
  const baseline=simulateFast(s,a),resources=combatResources(s,a)
  const used=a.assignments.reduce((n,x)=>n+x.count,0),ha=cellHa(s.grid)
  const score=(run:Run):Score=>({
    places:ground.placeCells.filter(cells=>cells.some(i=>run.arrival[i]<=durationMin)).length,
    ha:Array.from(run.arrival).reduce((n,t)=>n+(t<=durationMin?ha:0),0),units:used,
  })
  const initial=score(baseline)
  let best:Decision={...structuredClone(a),id:'B',name:ILS_NAME},bestScore=initial,plans=1
  const timeUp=()=>performance.now()-started>=(options.budgetMs??10000)||plans>=(options.maxPlans??Infinity)
  const report=(phase:'search'|'done')=>options.onProgress?.({phase,plans,elapsedMs:performance.now()-started,best:bestScore,a:initial,decision:structuredClone(best)})
  report('search')
  if(minute>=durationMin)return finish()

  // A modest terrain lattice keeps this bounded on the full demo grid.
  const terrain:LonLat[]=[]
  for(let row=2;row<s.grid.rows;row+=5)for(let col=2;col<s.grid.cols;col+=5) {
    const cell=row*s.grid.cols+col
    if(baseline.arrival[cell]>minute&&free.arrival[cell]<=durationMin)
      terrain.push(lonLatAt(s.grid,col+.5,row+.5))
  }
  type Candidate={slot:number;placement:Placement;aerial:boolean;speed:number;retarget?:boolean}
  const candidates:Candidate[][]=a.assignments.map(()=>[])
  // Units still at their base (not yet departed, no later orders) may instead get a different first destination.
  const leaving=departures(s.suppression,a,s.dispatchMin)
  const pending=a.assignments.map((x,slot)=>{
    if(positionForReplan(s,ground,a,slot,minute,baseline.arrival)||x.placements?.length)return undefined
    const spec=s.suppression.units[x.unit]
    const base=isAerial(spec)?findAirBase(x.from):s.stations.find(p=>p.id===x.from)
    const target=placements(s,a,slot)[0]
    return base&&target?{base:{lon:base.lon,lat:base.lat},target:target.point,departure:Math.max(minute,leaving[slot])}:undefined
  })
  const origins=a.assignments.map((_,slot)=>positionForReplan(s,ground,a,slot,minute,baseline.arrival)??pending[slot]?.base)
  const eligible=a.assignments.map((x,slot)=>{
    const state=resourceAt(resources,slot,minute)
    return !!origins[slot]&&!state.exhausted&&(x.unit!=='vttu'||state.waterPct>0)
  })
  const make=(slot:number,point:LonLat):Candidate|undefined=>{
    const x=a.assignments[slot],spec=s.suppression.units[x.unit],origin=origins[slot]!
    const retarget=pending[slot],start=retarget?retarget.departure:minute
    const aerial=isAerial(spec),speed=Math.max(1,x.unit==='crew'?4:spec.speedKmh)
    if(distanceM(origin,point)<30)return undefined
    let path=[origin,point]
    if(isRoadVehicle(spec)) {
      if(!ground.roads?.length)return undefined
      const route=findSafeRoute(s.grid,ground.roads,baseline.arrival,start,origin,point)
      if(!route)return undefined
      path=route.path
    }
    const length=path.slice(1).reduce((n,p,i)=>n+distanceM(path[i],p),0)
    const arrivalMin=start+length/1000/speed*60,cell=cellOf(s.grid,point)
    if(arrivalMin>=durationMin||cell<0)return undefined
    if(!aerial&&(baseline.arrival[cell]<=arrivalMin+SAFETY_MIN||!routeIsSafe(s,path,start,speed,baseline.arrival)))return undefined
    return {slot,placement:{point,orderedMin:start,arrivalMin,path},aerial,speed,retarget:!!retarget}
  }
  // Rank nearby positions by future fire contact and distance; do not send units to old burned ground.
  for(let slot=0;slot<a.assignments.length&&!timeUp();slot++) {
    if(!eligible[slot])continue
    const spec=s.suppression.units[a.assignments[slot].unit],origin=pending[slot]?.target??origins[slot]!
    const spots=isRoadVehicle(spec)?ground.access:[...terrain,...ground.access]
    const ranked=spots.map(point=>{
      const cell=cellOf(s.grid,point),distance=distanceM(origin,point)
      const fire=cell<0?Infinity:Number.isFinite(baseline.arrival[cell])?baseline.arrival[cell]:free.arrival[cell]
      const kmh=a.assignments[slot].unit==='crew'?4:Math.max(1,spec.speedKmh)
      const eta=(pending[slot]?.departure??minute)+distanceM(origins[slot]!,point)/1000/kmh*60 // from where it actually sets off
      return {point,distance,fire,rank:Math.abs(fire-(eta+25))+distance/100}
    }).filter(p=>p.distance>=30&&p.distance<=2000&&p.fire>minute&&p.fire<=durationMin)
      .sort((p,q)=>p.rank-q.rank)
    for(const spot of ranked) {
      if(timeUp()||candidates[slot].length>=12)break
      if(candidates[slot].some(c=>distanceM(c.placement.point,spot.point)<80))continue
      const candidate=make(slot,spot.point)
      if(candidate)candidates[slot].push(candidate)
    }
  }
  const changed=new Map<number,Candidate>()
  const apply=(d:Decision,c:Candidate)=>{
    if(c.retarget) { // a new first destination: same unit, same dispatch, new target
      const id=`ils-${c.slot}`,x=d.assignments[c.slot]
      d.points[id]=structuredClone(c.placement.point);x.target=id;delete x.arrivalMin;x.placements=[]
      return
    }
    // Preserve issued orders, even an ongoing journey. The new saved route starts at its actual position.
    d.assignments[c.slot].placements=[
      ...structuredClone((a.assignments[c.slot].placements??[]).filter(p=>p.orderedMin<=minute)),
      structuredClone(c.placement),
    ]
  }
  const seen=new Set<string>()
  const evaluate=(moves:Candidate[])=>{
    if(timeUp())return
    const proposal=structuredClone(best),all=new Map(changed)
    for(const c of moves){apply(proposal,c);all.set(c.slot,c)}
    const key=JSON.stringify(proposal.assignments)
    if(seen.has(key))return
    seen.add(key)
    const run=simulateFast(s,proposal);plans++
    const next=score(run)
    if(!better(next,bestScore))return
    // Withdrawing protection may expose a road; check again against this candidate's own result.
    if([...all.values()].some(c=>!c.aerial&&!routeIsSafe(s,c.placement.path!,minute,c.speed,run.arrival)))return
    best=proposal;bestScore=next
    for(const c of moves)changed.set(c.slot,c)
    report('search')
  }
  // Round-robin candidates so a short budget is shared by all units; two passes allow coordination.
  for(let pass=0;pass<2&&!timeUp();pass++)for(let rank=0;rank<12&&!timeUp();rank++)
    for(let slot=0;slot<candidates.length&&!timeUp();slot++) {
      const candidate=candidates[slot][rank]
      if(!candidate)continue
      evaluate([candidate])
      // A dry attack unit and its supplying tanker may only improve the result together.
      if(['crew','vfci'].includes(a.assignments[slot].unit)) {
        const tank=a.assignments.findIndex((x,i)=>x.unit==='vttu'&&eligible[i])
        if(tank>=0&&!timeUp()) {
          const near=ground.access.filter(p=>distanceM(p,candidate.placement.point)<250)
            .sort((p,q)=>distanceM(p,candidate.placement.point)-distanceM(q,candidate.placement.point))
          const support=near.slice(0,4).map(p=>make(tank,p)).find(Boolean)
          if(support)evaluate([candidate,support])
        }
      }
    }
  return finish()
  function finish():Result {
    report('done')
    return {decision:best,improved:better(bestScore,initial),best:bestScore,a:initial,plans,elapsedMs:performance.now()-started}
  }
}
