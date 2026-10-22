// Exercise actual hover event handling without a GPU, browser, or ELMFIRE job.
import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import { Cartesian2, Event as CesiumEvent } from 'cesium'
import { Editor } from '../src/editor'
import { Hud } from '../src/hud'
import { mapHover } from '../src/mapHover'

class Canvas extends EventTarget {
  getBoundingClientRect() { return { left: 10, top: 20 } }
  pointer(type: string, x = 50, buttons = 0) {
    this.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: 70, buttons }))
  }
}
const canvas = new Canvas()
const camera = { moveStart: new CesiumEvent(), moveEnd: new CesiumEvent() }
const positions: Cartesian2[] = []
let enabled = true
let hides = 0
const dispose = mapHover(canvas as unknown as HTMLCanvasElement, camera,
  (p) => positions.push(Cartesian2.clone(p)), () => hides++, () => enabled)
for (let i = 0; i < 500; i++) canvas.pointer('pointermove', i)
assert.equal(positions.length, 0, 'hover never picks synchronously in the mouse event')
await wait(110)
assert.deepEqual(positions, [new Cartesian2(489, 50)], '500 moves coalesce to one pick at the latest canvas-relative position')
canvas.pointer('pointermove')
canvas.pointer('pointerdown', 50, 1)
for (let i = 0; i < 500; i++) canvas.pointer('pointermove', i, 1)
await wait(110)
assert.equal(positions.length, 1, 'camera drag cancels pending hover and does no picking')
camera.moveStart.raiseEvent()
canvas.pointer('pointerup', 90)
canvas.pointer('pointermove', 100)
await wait(110)
assert.equal(positions.length, 1, 'inertial camera movement also suppresses hover')
camera.moveEnd.raiseEvent()
await wait(110)
assert.deepEqual(positions.at(-1), new Cartesian2(90, 50), 'hover resumes at the current pointer after camera settles')
enabled = false
canvas.pointer('pointermove')
await wait(110)
assert.equal(positions.length, 2, 'disabled hover or empty editor does no picking')
enabled = true
canvas.pointer('pointermove')
canvas.dispatchEvent(new Event('wheel'))
await wait(110)
assert.equal(positions.length, 2, 'zoom cancels pending hover')
canvas.pointer('pointermove')
canvas.pointer('pointerleave')
await wait(110)
assert.equal(positions.length, 2, 'leaving canvas cancels stale tooltips')
dispose()
canvas.pointer('pointermove')
await wait(110)
assert.equal(positions.length, 2, 'disposal removes handlers')
assert(hides > 0)

const editor = Object.create(Editor.prototype)
let picks = 0
let tooltipBuilds = 0
const item = {}
const tooltip = { style: { left: '', top: '' }, hidden: false }
Object.assign(editor, {
  source: { entities: { values: [] } }, agency: { entities: { values: [] } },
  viewer: { scene: { pick: () => { picks++; return { id: { _unitInfo: item } } }, canvas: { style: {} } } },
  el: { classList: { contains: () => false } }, minutes: 10,
  showUnitTooltip: () => { tooltipBuilds++; editor.cutTooltip = tooltip },
})
editor.hover(new Cartesian2())
assert.equal(picks, 0, 'empty map skips the extra Cesium object-picking render')
editor.source.entities.values = [{}]
editor.hover(new Cartesian2(1, 2))
editor.hover(new Cartesian2(3, 4))
assert.equal(tooltipBuilds, 1, 'same hovered unit repositions tooltip without rebuilding its DOM')
assert.equal(tooltip.style.left, '17px', 'tooltip sits beside the cursor, inside viewport bounds')
editor.minutes++
editor.hover(new Cartesian2())
assert.equal(tooltipBuilds, 2, 'clock change refreshes tooltip ETA')

Object.assign(editor, {
  loaded: { fire: { name: 'Test', start: '2024-09-16T10:00:00' }, scenario: { grid: {} } },
  decisions: [{ id: 'A' }], active: 0, runs: { A: {} }, pmaList: [],
})
const dispatch = editor.getMultiAgencyDispatch()
assert.strictEqual(editor.getMultiAgencyDispatch(), dispatch, 'paused dispatch reuses the road/medical report')
editor.minutes++
assert.notStrictEqual(editor.getMultiAgencyDispatch(), dispatch, 'clock change invalidates dispatch')
const changed = editor.getMultiAgencyDispatch()
editor.pmaList = []
assert.notStrictEqual(editor.getMultiAgencyDispatch(), changed, 'medical point edits invalidate dispatch')
const medicalChanged = editor.getMultiAgencyDispatch()
editor.runs = { A: {} }
assert.notStrictEqual(editor.getMultiAgencyDispatch(), medicalChanged, 'a new simulation invalidates dispatch')
const runChanged = editor.getMultiAgencyDispatch()
editor.loaded = { ...editor.loaded, fire: { ...editor.loaded.fire, name: 'Another fire' } }
assert.notStrictEqual(editor.getMultiAgencyDispatch(), runChanged, 'a new fire invalidates dispatch')
const hud = Object.create(Hud.prototype)
let writes = 0
Object.assign(hud, { refs: { pspBriefingBody: { set innerHTML(_html: string) { writes++ } } } })
hud.updateBriefings(dispatch)
hud.updateBriefings(dispatch)
assert.equal(writes, 1, 'unchanged briefing does not rebuild DOM every second')
console.log('OK: 500 moves → 1 hover pick; 500 drag moves → 0 picks; disabled hover/zoom/inertia/leave guarded; tooltips and dispatch reused')
