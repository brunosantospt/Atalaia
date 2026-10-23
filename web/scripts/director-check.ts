// Incident chronology and model-backed containment, without starting ELMFIRE.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { incidentShots, MAX_STEP_MIN } from '../src/director'
import { outcomeOrder } from '../src/outcomeLayer'
import { Player } from '../src/player'
import { capRun } from '../src/report'
import type { Fire, NearStation } from '../src/data'
import type { Grid } from '../src/grid'
import type { Decision, Suppression } from '../src/suppression'
import type { Run } from '../src/scenario'
const read = async (path: string) => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), 'utf8'))
const fire: Fire = await read('fires/Penha_Guimaraes_hipotetico/fire.json')
const suppression: Suppression = await read('suppression.json')
const detection = await read('detection.json')
const grid = { cols: 11, rows: 11, cellsize: 30, rect: { west: -8.28, east: -8.26, south: 41.41, north: 41.43 } } as Grid
const run = (last: number, cells = 3): Run => {
  const arrival = new Float32Array(121).fill(Infinity)
  for (let i = 0; i < cells; i++) arrival[56 + i] = last * (i + 1) / cells
  return { arrival, durationMin: 360, runtimeMs: 0, decision: null, engine: 'ELMFIRE test fixture' }
}
const a: Decision = { id: 'A', name: 'A', points: { p: fire.ignition }, lines: {}, assignments: [{ from: 'station', target: 'p', unit: 'vfci', task: 'direct', count: 1, dispatchMin: 10 }] }
const b = structuredClone(a); b.id = 'B'
const stations = [{ ...fire.ignition, id: 'station' }] as NearStation[]
const free = run(300, 5)
const runs = { free, A: run(85), B: run(100, 4) }
const input = { fire, grid, stations, suppression, detection, decisions: [a, b] as [Decision, Decision], runs, free, post: false, decision: 0, fovy: Math.PI / 3 }
const check = (shots: ReturnType<typeof incidentShots>) => {
  for (const [i, shot] of shots.entries()) {
    assert.ok((shot.hoursTo! - shot.hours) * 60 <= MAX_STEP_MIN + 1e-6, 'no interval spans more than five incident minutes')
    assert.ok(shot.hoursTo! >= shot.hours, 'clock never reverses within a step')
    if (i) assert.ok(shot.hours >= shots[i - 1].hoursTo! - 1e-8, 'chronological shot transitions')
    assert.ok(shot.moveS + shot.holdS <= 300, 'presentation duration also stays below five real minutes')
    assert.ok(!['versus', 'prediction', 'balance', 'overview'].includes(shot.kind), 'old presentation scenes removed')
  }
}
const pre = incidentShots(input); check(pre)
assert.equal(pre[0].kind, 'ignition')
assert.equal(pre[0].hours, 0)
assert.ok(pre.some(s => s.kind === 'response'))
assert.ok(!pre.some(s => s.gate === 'arrival'), 'arrivals never pause continuous playback')
assert.equal(new Set(pre.map(s=>s.path)).size,3,'wide, mobilisation (bases in view) and first-arrival framing')
assert.ok(pre.some(s => s.kind === 'checkpoint' && s.hours * 60 === detection.satelliteMin))
assert.ok(pre.some(s => s.kind === 'control' && s.word === 'Fogo controlado'))
assert.equal(pre.at(-1)!.gate, 'wind')
assert.equal(pre.at(-1)!.hours * 60, fire.windShift!.minutes)
assert.ok(!pre.some(s => s.kind === 'outcome'), 'no finale before the wind/review gate')
const post = incidentShots({ ...input, post: true }); check(post)
assert.equal(post.at(-1)!.kind, 'outcome')
assert.equal(post.at(-1)!.hours * 60, fire.windShift!.minutes, 'already-contained changed-wind forecast cannot rewind playback')
const empty = incidentShots({ ...input, runs: undefined, decisions: undefined })
assert.ok(empty.some(s => s.gate === 'decision'), 'first playback asks for a real plan')
const cap = capRun(grid, runs.A, .09)
const capped = incidentShots({ ...input, post: true, runs: { ...runs, A: cap } })
assert.ok(capped.at(-1)!.caption.includes('contenção não confirmada'), 'aftermath explains unconfirmed containment')
assert.ok(!capped.some(s => s.word === 'Fogo controlado'))
const edge = run(50); edge.arrival[0] = 50
assert.equal(incidentShots({ ...input, post: true, runs: { ...runs, A: edge } }).at(-1)!.kind,'outcome')
const growing = run(355)
assert.ok(incidentShots({ ...input, post: true, runs: { ...runs, A: growing } }).at(-1)!.caption.includes('contenção não confirmada'))
assert.deepEqual(outcomeOrder(grid, { free: runs.A, A: free, B: runs.B }).map(x => x.id), ['A', 'B', 'free'], 'final stacking ranks actual areas, never assumes free is worst')
// Opening the editor during a camera move must freeze both the camera and incident time.
const player = new Player({ camera: { lookAt() {}, lookAtTransform() {} }, globe: { getHeight: () => undefined } } as never, pre, pre[0].path[0])
player.phase = 'move'; player.playing = true; player.seek(.4); player.pause()
const paused = player.update(10)
assert.equal(paused.driving, false)
assert.equal(paused.hours, .4)
assert.equal(paused.playing, false)
player.seek(2.5)
assert.equal(player.shots[player.index].kind, 'incident', 'manual seek selects the matching interval')
assert.equal(player.update(0).hours, 2.5)
player.playing = true
assert.equal(player.update(.1).hours, 2.5, 'resuming at the wind gate must not rewind')
// Director growth timelapse is accelerated without consuming arrival or wind gates faster.
const growthShot = { ...pre[0], hours:0, hoursTo:5/60, moveS:.1, holdS:4, gate:undefined }
const clock = (shot: ReturnType<typeof incidentShots>[number]) => {
  const p = new Player({camera:{lookAt(){},lookAtTransform(){}},globe:{getHeight:()=>undefined}} as never,[shot],shot.path[0])
  p.playing=true; p.userMoved=false
  return p
}
assert.equal(clock(growthShot).update(.4).hours,clock(growthShot).update(.1,4).hours,'four times the growth playback for the same real elapsed time')
const arrivalShot = {...growthShot,gate:'arrival' as const}
assert.equal(clock(arrivalShot).update(.1).hours,clock(arrivalShot).update(.1,4).hours,'arrival gates keep their timing')
const windShot = {...growthShot,gate:'wind' as const}
assert.equal(clock(windShot).update(.1).hours,clock(windShot).update(.1,4).hours,'wind decisions keep their timing')
console.log('OK: chronological five-minute blocks, ignition/arrival/satellite/control/wind gates, honest containment, three-footprint ranking, complete editor pause')
