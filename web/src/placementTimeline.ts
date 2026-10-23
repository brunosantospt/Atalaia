import { unitJourney } from './unitMotion'
import { distanceM, type LonLat } from './geo'
import type { Decision } from './suppression'
import type { Scenario } from './scenario'
import { arrivals } from './wetLine'
export interface Placement { point: LonLat; orderedMin: number; arrivalMin: number; path?: LonLat[] }
export function placements(s: Scenario,d: Decision,slot: number): Placement[] {
 const a=d.assignments[slot], point=d.points[a.target]??d.lines[a.target]?.[0]
 return point ? [{point,orderedMin:a.orderedMin??a.dispatchMin??s.dispatchMin??0,arrivalMin:arrivals(s,d)[slot]},...(a.placements??[])] : []
}
export function placementAt(list: Placement[],minute:number) { return list.filter(p=>p.orderedMin<=minute).at(-1)??list[0] }
export function relocationPosition(list:Placement[],minute:number):LonLat|undefined {
 let index=-1
 list.forEach((p,i)=>{if(p.orderedMin<=minute)index=i})
 if(index<1)return undefined
 const p=list[index],prev=list[index-1]
 return unitJourney(p.path??[prev.point,p.point],p.orderedMin,p.arrivalMin)(minute)
}
export function addPlacement(s:Scenario,d:Decision,slot:number,point:LonLat,minute:number,path?:LonLat[]) {
 const a=d.assignments[slot],list=placements(s,d,slot),last=list.at(-1)!
 if(minute<last.arrivalMin)throw new Error('Nova colocação só depois da chegada.')
 const speed=a.unit==='crew'?4:s.suppression.units[a.unit].speedKmh
 const route=path?.length?path:[last.point,point]
 const metres=route.slice(1).reduce((sum,p,i)=>sum+distanceM(route[i],p),0)
 const arrivalMin=minute+metres/1000/Math.max(1,speed)*60
 ;(a.placements??=[]).push({point,orderedMin:minute,arrivalMin,path:route})
 return arrivalMin
}

/** Correct an order in place; preserve order times and reject overlapping journeys atomically. */
export function editPlacement(s:Scenario,d:Decision,slot:number,index:number,point:LonLat,
 routeFor?:(from:LonLat,to:LonLat,minute:number)=>LonLat[]|undefined) {
 const draft=structuredClone(d),a=draft.assignments[slot]
 if(index===0) {
  const target=`edited-${a.id??slot}`
  draft.points[target]=point;a.target=target;delete a.arrivalMin
  a.arrivalMin=arrivals(s,draft)[slot]
 } else a.placements![index-1].point=point
 const list=placements(s,draft,slot)
 const speed=a.unit==='crew'?4:s.suppression.units[a.unit].speedKmh
 for(let i=Math.max(1,index);i<list.length;i++) {
  const previous=list[i-1],p=list[i]
  if(p.orderedMin<previous.arrivalMin)throw new Error('Esta alteração sobrepõe viagens; a ordem seguinte tem de ser editada primeiro.')
  const route=routeFor?.(previous.point,p.point,p.orderedMin)??[previous.point,p.point]
  p.path=route
  p.arrivalMin=p.orderedMin+route.slice(1).reduce((sum,q,k)=>sum+distanceM(route[k],q),0)/1000/Math.max(1,speed)*60
 }
 d.points=draft.points;d.assignments[slot]=a
}
