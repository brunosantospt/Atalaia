// Deterministic demo estimates: active contact costs resources; quiet protection does not.
import { DEMO_HORIZON_MIN } from './demoModel'
import { distanceM, toPTTM06 } from './geo'
import { cellOfXY, centerXY } from './grid'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'
import { placements, placementAt } from './placementTimeline'
export interface CombatFrame { waterPct:number; autonomyPct:number; active:boolean; contained:boolean; exhausted:boolean; radius:number; arrival:number }
export function combatResources(s:Scenario,d:Decision) {
 const horizon=Math.min(DEMO_HORIZON_MIN,s.durationMin),lists=d.assignments.map((_,i)=>placements(s,d,i))
 const contact=lists.map((list,slot)=>list.map(p=>{
  const sectors=new Map<number,Set<number>>(), a=d.assignments[slot],radius=(a.unit==='crew'?160:300)*Math.sqrt(a.count)
  const xy=toPTTM06(p.point),rc=cellOfXY(s.grid,xy.x,xy.y),extent=Math.ceil(radius/s.grid.cellsize)
  for(let r=Math.max(0,rc.row-extent);r<=Math.min(s.grid.rows-1,rc.row+extent);r++) for(let c=Math.max(0,rc.col-extent);c<=Math.min(s.grid.cols-1,rc.col+extent);c++) {
   const i=r*s.grid.cols+c,at=centerXY(s.grid,i),t=s.fireArrival?.[i]??Infinity
   if(t>=p.arrivalMin&&t<=horizon&&Math.hypot(at.x-xy.x,at.y-xy.y)<=Math.min(radius,(a.unit==='crew'?28:52.5)*Math.sqrt(a.count)+(t-p.arrivalMin)*(a.unit==='crew'?80:150)*Math.sqrt(a.count)/30)) {
    // Once a sector is held, its forecast's interior growth is not fresh contact.
    // A new approach sector (including after a wind turn) starts another contact episode.
    const sector=Math.floor((Math.atan2(at.y-xy.y,at.x-xy.x)+Math.PI)/(Math.PI/4))%8
    if(!sectors.has(sector))sectors.set(sector,new Set())
    sectors.get(sector)!.add(Math.ceil(t))
   }
  }
  const episodes=new Set<number>()
  for(const values of sectors.values()) { let previous=-Infinity;for(const t of [...values].sort((a,b)=>a-b)){if(t-previous>15)episodes.add(t);previous=t} }
  return episodes
 }))
 const water:number[]=d.assignments.map(a=>a.unit==='vttu'?(s.suppression.units.vttu.waterL??12000):a.unit==='crew'?600:(s.suppression.units[a.unit].waterL??3000)*2)
 const capacities=[...water],autonomy=d.assignments.map(()=>90),lastContact=d.assignments.map(()=>-Infinity)
 const frames:CombatFrame[][]=d.assignments.map(()=>[])
 for(let m=0;m<=horizon;m++) {
  const current=lists.map(l=>placementAt(l,m))
  for(const [i,a] of d.assignments.entries()) {
   const p=current[i],on=!!p&&m>=p.arrivalMin,idx=lists[i].indexOf(p)
   if(on&&contact[i][idx]?.has(m))lastContact[i]=m
   const fighting=on&&m-lastContact[i]<=15&&autonomy[i]>0&&a.unit!=='vttu'
   if(on&&autonomy[i]>0&&a.unit!=='vttu') {
    const flow=a.unit==='crew'?10:(s.suppression.units[a.unit].flowLPerMin??200)/2
    for(const [j,tank] of d.assignments.entries()) {
     if(!['crew','vfci'].includes(a.unit)||tank.unit!=='vttu'||!current[j]||m<current[j].arrivalMin||distanceM(p.point,current[j].point)>300||water[i]>=capacities[i])continue
     const transfer=Math.min(capacities[i]-water[i],water[j]*tank.count/a.count,flow*2)
     water[i]+=transfer;water[j]-=transfer*a.count/tank.count
    }
    if(fighting){water[i]=Math.max(0,water[i]-flow);autonomy[i]=Math.max(0,autonomy[i]-1)}
   }
   const radius=on?Math.min((a.unit==='crew'?160:300)*Math.sqrt(a.count),(a.unit==='crew'?28:52.5)*Math.sqrt(a.count)+(m-p.arrivalMin)*(a.unit==='crew'?80:150)*Math.sqrt(a.count)/30):0
   frames[i].push({waterPct:100*water[i]/capacities[i],autonomyPct:100*autonomy[i]/90,active:on&&water[i]>0&&autonomy[i]>0,contained:on&&m-lastContact[i]>15,exhausted:autonomy[i]<=0,radius,arrival:p?.arrivalMin??Infinity})
  }
  d.assignments.forEach((a,i)=>{if(a.unit==='vttu')frames[i][m].waterPct=100*water[i]/capacities[i]})
 }
 return {frames,lists}
}
export function resourceAt(result:ReturnType<typeof combatResources>,slot:number,minute:number) { const f=result.frames[slot];return f[Math.max(0,Math.min(f.length-1,Math.floor(minute)))] }
const cache=new WeakMap<Decision,{key:string;forecast:Float32Array|undefined;result:ReturnType<typeof combatResources>}>()
export function cachedCombatResources(s:Scenario,d:Decision) {
 const key=JSON.stringify([d.assignments,d.points,d.lines,s.durationMin]),old=cache.get(d)
 if(old?.key===key&&old.forecast===s.fireArrival)return old.result
 const result=combatResources(s,d);cache.set(d,{key,forecast:s.fireArrival,result});return result
}
